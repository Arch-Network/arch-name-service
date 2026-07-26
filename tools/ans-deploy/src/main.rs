mod smoke;
mod tx;

use std::{env, fs, path::Path};

use ans_protocol::{
    derive::derive_config_address,
    state::{decode_state, REGISTRY_CONFIG_DISCRIMINATOR},
    BitcoinNetwork, NameInstruction, RegistryConfig,
};
use anyhow::{bail, Context, Result};
use arch_program::bitcoin::Network;
use arch_program::{account::AccountMeta, instruction::Instruction, pubkey::Pubkey};
use arch_sdk::{with_secret_key_file, ArchRpcClient, Config, ProgramDeployer};
use borsh::to_vec;
use serde::Serialize;

use smoke::{run_smoke, SmokeReport};
use tx::send_and_confirm;

#[derive(Serialize)]
struct Deployment {
    network: String,
    dry_run: bool,
    rpc_url: String,
    program_id: String,
    deployer: String,
    namespace_authority: String,
    deployer_payer: PayerStatus,
    namespace_authority_payer: PayerStatus,
    program_deployed: bool,
    registry_config: String,
    registry_initialized: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    smoke: Option<SmokeReport>,
    transactions: Vec<TransactionRecord>,
}

#[derive(Serialize)]
struct PayerStatus {
    present: bool,
    system_owned: bool,
    lamports: Option<u64>,
    required_lamports: u64,
    suitable: bool,
}

#[derive(Serialize)]
pub(crate) struct TransactionRecord {
    pub operation: String,
    pub txid: String,
}

const TESTNET_NETWORK_ID: u32 = 2;
pub(crate) const TESTNET_NAMESPACE: &str = ".arch";
const FAUCET_AIRDROP_LAMPORTS: u64 = 1_000_000;
const MIN_DEPLOYER_LAMPORTS: u64 = 5 * FAUCET_AIRDROP_LAMPORTS;
const MIN_NAMESPACE_AUTHORITY_LAMPORTS: u64 = FAUCET_AIRDROP_LAMPORTS;

fn main() -> Result<()> {
    let (action, dry_run) = parse_args()?;
    let network = env::var("NETWORK").unwrap_or_else(|_| "testnet".to_owned());
    if network != "testnet" {
        bail!("ANS testnet registry deployer only accepts NETWORK=testnet");
    }

    let rpc_url =
        env::var("ARCH_RPC_URL").unwrap_or_else(|_| "https://rpc.testnet.arch.network".to_owned());
    let program_path = required("PROGRAM_KEY_PATH")?;
    let deployer_path = required("DEPLOYER_KEY_PATH")?;
    let authority_path = required("NAMESPACE_AUTHORITY_KEY_PATH")?;
    let (program_keypair, program_id) = with_secret_key_file(&program_path)
        .with_context(|| format!("load program keypair from {program_path}"))?;
    let (deployer_keypair, deployer) = with_secret_key_file(&deployer_path)
        .with_context(|| format!("load deployer keypair from {deployer_path}"))?;
    let (_, namespace_authority) = with_secret_key_file(&authority_path)
        .with_context(|| format!("load namespace authority keypair from {authority_path}"))?;
    let config = config(rpc_url.clone());
    let client = ArchRpcClient::new(&config);
    let registry_config = Pubkey::new_from_array(derive_config_address(
        program_id.serialize(),
        TESTNET_NETWORK_ID,
        TESTNET_NAMESPACE,
    ));
    let deployer_payer = payer_status(&client, deployer, MIN_DEPLOYER_LAMPORTS);
    let namespace_authority_payer = payer_status(
        &client,
        namespace_authority,
        MIN_NAMESPACE_AUTHORITY_LAMPORTS,
    );
    let program_deployed = client
        .read_account_info(program_id)
        .map(|account| account.is_executable)
        .unwrap_or(false);
    let registry_initialized =
        verify_registry_config(&client, registry_config, program_id, namespace_authority)?;

    let mut deployment = Deployment {
        network,
        dry_run,
        rpc_url: rpc_url.clone(),
        program_id: program_id.to_string(),
        deployer: deployer.to_string(),
        namespace_authority: namespace_authority.to_string(),
        deployer_payer,
        namespace_authority_payer,
        program_deployed,
        registry_config: registry_config.to_string(),
        registry_initialized,
        smoke: None,
        transactions: Vec::new(),
    };
    println!("{}", serde_json::to_string_pretty(&deployment)?);

    let output_path =
        env::var("OUTPUT_PATH").unwrap_or_else(|_| "deployments/testnet.json".to_owned());
    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&output_path, serde_json::to_vec_pretty(&deployment)?)?;

    match action.as_str() {
        "preflight" => {
            require_deploy_payer(&deployment.deployer_payer)?;
            require_namespace_authority_payer(&deployment.namespace_authority_payer)?;
        }
        "fund" => {
            if dry_run {
                println!("DRY RUN: no faucet request sent.");
            } else {
                for _ in 0..5 {
                    client
                        .create_and_fund_account_with_faucet(&deployer_keypair)
                        .context("fund deployer payer with testnet faucet")?;
                }
                client
                    .create_and_fund_account_with_faucet(&namespace_authority_keypair(
                        &authority_path,
                    )?)
                    .context("fund namespace authority payer with testnet faucet")?;
                deployment.deployer_payer = payer_status(&client, deployer, MIN_DEPLOYER_LAMPORTS);
                deployment.namespace_authority_payer = payer_status(
                    &client,
                    namespace_authority,
                    MIN_NAMESPACE_AUTHORITY_LAMPORTS,
                );
                require_deploy_payer(&deployment.deployer_payer)?;
                require_namespace_authority_payer(&deployment.namespace_authority_payer)?;
                fs::write(&output_path, serde_json::to_vec_pretty(&deployment)?)?;
                println!("Funded deployer and namespace authority with the testnet faucet.");
            }
        }
        "deploy" => {
            if dry_run {
                println!("DRY RUN: no transaction sent.");
            } else {
                require_deploy_payer(&deployment.deployer_payer)?;
                let elf_path = env::var("PROGRAM_ELF_PATH")
                    .unwrap_or_else(|_| "target/deploy/ans_registry.so".to_owned());
                if !Path::new(&elf_path).is_file() {
                    bail!("SBF ELF not found at {elf_path}");
                }
                ProgramDeployer::new(&config)
                    .try_deploy_program(
                        "ans-registry".to_owned(),
                        program_keypair,
                        deployer_keypair,
                        &elf_path,
                    )
                    .context("deploy ANS registry program")?;
                deployment.program_deployed = client
                    .read_account_info(program_id)
                    .map(|account| account.is_executable)
                    .unwrap_or(false);
                if !deployment.program_deployed {
                    bail!("program deployer returned success but program is not executable");
                }
                fs::write(&output_path, serde_json::to_vec_pretty(&deployment)?)?;
                println!("Program deployment completed successfully.");
            }
        }
        "initialize" => {
            if registry_initialized {
                println!("Registry config already matches the expected testnet configuration.");
            } else if dry_run {
                println!("DRY RUN: registry initialization transaction not sent.");
            } else {
                require_namespace_authority_payer(&deployment.namespace_authority_payer)?;
                if !program_deployed {
                    bail!(
                        "ANS registry program is not executable; deploy it before initialization"
                    );
                }
                let authority_keypair = namespace_authority_keypair(&authority_path)?;
                let txid = initialize_registry(
                    &client,
                    &config,
                    program_id,
                    registry_config,
                    namespace_authority,
                    authority_keypair,
                )?;
                deployment.transactions.push(TransactionRecord {
                    operation: "initialize_registry".to_owned(),
                    txid,
                });
                deployment.registry_initialized = verify_registry_config(
                    &client,
                    registry_config,
                    program_id,
                    namespace_authority,
                )?;
                if !deployment.registry_initialized {
                    bail!("registry initialization was accepted but config verification failed");
                }
                fs::write(&output_path, serde_json::to_vec_pretty(&deployment)?)?;
                println!("Registry initialized and verified.");
            }
        }
        "smoke" => {
            if dry_run {
                println!("DRY RUN: smoke lifecycle transactions not sent.");
            } else {
                require_namespace_authority_payer(&deployment.namespace_authority_payer)?;
                if !program_deployed {
                    bail!("ANS registry program is not executable; deploy it before smoke");
                }
                if !registry_initialized {
                    bail!("registry is not initialized; run initialize before smoke");
                }
                let registry = load_registry_config(&client, registry_config, program_id)?;
                let (report, txs) = run_smoke(
                    &client,
                    &config,
                    program_id,
                    registry_config,
                    &authority_path,
                    namespace_authority,
                    deployer,
                    &registry,
                )?;
                deployment.transactions.extend(txs);
                deployment.smoke = Some(report);
                fs::write(&output_path, serde_json::to_vec_pretty(&deployment)?)?;
                println!("{}", serde_json::to_string_pretty(&deployment)?);
                println!("Smoke lifecycle passed (register → record → primary → transfer).");
            }
        }
        _ => unreachable!("parse_args validates action"),
    }
    Ok(())
}

fn parse_args() -> Result<(String, bool)> {
    let mut action = "deploy".to_owned();
    let mut dry_run = env_flag("DRY_RUN");
    for arg in env::args().skip(1) {
        match arg.as_str() {
            "--dry-run" => dry_run = true,
            "preflight" | "fund" | "deploy" | "initialize" | "smoke" => action = arg,
            _ => bail!(
                "usage: ans-deploy [preflight|fund|deploy|initialize|smoke] [--dry-run]"
            ),
        }
    }
    Ok((action, dry_run))
}

fn config(rpc_url: String) -> Config {
    Config {
        node_endpoint: String::new(),
        node_username: String::new(),
        node_password: String::new(),
        network: Network::Testnet4,
        arch_node_url: rpc_url,
        titan_url: String::new(),
    }
}

fn payer_status(client: &ArchRpcClient, payer: Pubkey, required_lamports: u64) -> PayerStatus {
    match client.read_account_info(payer) {
        Ok(account) => {
            let system_owned = account.owner == Pubkey::system_program();
            PayerStatus {
                present: true,
                system_owned,
                lamports: Some(account.lamports),
                required_lamports,
                suitable: system_owned && account.lamports >= required_lamports,
            }
        }
        Err(_) => PayerStatus {
            present: false,
            system_owned: false,
            lamports: None,
            required_lamports,
            suitable: false,
        },
    }
}

fn require_deploy_payer(status: &PayerStatus) -> Result<()> {
    if status.suitable {
        Ok(())
    } else {
        bail!(
            "deployer payer is unsuitable: it must be present, system-owned, and hold at least {} lamports; run `ans-deploy fund`, then `ans-deploy preflight`",
            status.required_lamports
        )
    }
}

fn require_namespace_authority_payer(status: &PayerStatus) -> Result<()> {
    if status.suitable {
        Ok(())
    } else {
        bail!(
            "namespace authority payer is unsuitable: it must be present, system-owned, and hold at least {} lamports; run `ans-deploy fund`, then `ans-deploy preflight`",
            status.required_lamports
        )
    }
}

fn namespace_authority_keypair(path: &str) -> Result<arch_program::bitcoin::key::Keypair> {
    with_secret_key_file(path)
        .map(|(keypair, _)| keypair)
        .with_context(|| format!("load namespace authority keypair from {path}"))
}

fn verify_registry_config(
    client: &ArchRpcClient,
    address: Pubkey,
    program_id: Pubkey,
    namespace_authority: Pubkey,
) -> Result<bool> {
    let Ok(account) = client.read_account_info(address) else {
        return Ok(false);
    };
    if account.owner != program_id {
        bail!("registry config {address} exists but is not owned by ANS program {program_id}");
    }
    let config =
        decode_state::<RegistryConfig>(&account.data).context("decode existing ANS registry config")?;
    Ok(config.header.discriminator == REGISTRY_CONFIG_DISCRIMINATOR
        && config.header.initialized
        && config.header.state_version == 1
        && config.program_version == 1
        && config.network_id == TESTNET_NETWORK_ID
        && config.namespace == TESTNET_NAMESPACE
        && config.namespace_authority == namespace_authority.serialize()
        && config.grace_period_slots == 0
        && config.min_registration_slots == 0
        && config.max_registration_slots == 0
        && config.bitcoin_network == BitcoinNetwork::Testnet
        && config.token_programs.is_empty()
        && !config.paused
        && !config.mainnet_enabled)
}

fn load_registry_config(
    client: &ArchRpcClient,
    address: Pubkey,
    program_id: Pubkey,
) -> Result<RegistryConfig> {
    let account = client
        .read_account_info(address)
        .with_context(|| format!("read registry config {address}"))?;
    if account.owner != program_id {
        bail!("registry config {address} is not owned by program {program_id}");
    }
    decode_state(&account.data).context("decode registry config for smoke")
}

fn initialize_registry(
    client: &ArchRpcClient,
    config: &Config,
    program_id: Pubkey,
    registry_config: Pubkey,
    namespace_authority: Pubkey,
    authority_keypair: arch_program::bitcoin::key::Keypair,
) -> Result<String> {
    // System program must be present for the on-chain create_account CPI.
    // Autara's create_global_config instruction uses the same account shape.
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(namespace_authority, true),
            AccountMeta::new(registry_config, false),
            AccountMeta::new_readonly(Pubkey::system_program(), false),
        ],
        data: to_vec(&NameInstruction::InitializeRegistry {
            network_id: TESTNET_NETWORK_ID,
            namespace_authority: namespace_authority.serialize(),
        })?,
    };
    send_and_confirm(
        client,
        config,
        instruction,
        namespace_authority,
        vec![authority_keypair],
        "initialize_registry",
    )
}

fn required(name: &str) -> Result<String> {
    env::var(name).with_context(|| format!("{name} must be set"))
}

fn env_flag(name: &str) -> bool {
    matches!(env::var(name).as_deref(), Ok("1") | Ok("true") | Ok("TRUE"))
}
