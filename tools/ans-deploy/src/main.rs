use std::{env, fs, path::Path};

use anyhow::{bail, Context, Result};
use arch_program::bitcoin::Network;
use arch_sdk::{with_secret_key_file, Config, ProgramDeployer};
use serde::Serialize;

#[derive(Serialize)]
struct Deployment {
    network: String,
    dry_run: bool,
    rpc_url: String,
    program_id: String,
    deployer: String,
    namespace_authority: String,
}

fn main() -> Result<()> {
    let dry_run = env::args().any(|arg| arg == "--dry-run") || env_flag("DRY_RUN");
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

    let deployment = Deployment {
        network,
        dry_run,
        rpc_url: rpc_url.clone(),
        program_id: program_id.to_string(),
        deployer: deployer.to_string(),
        namespace_authority: namespace_authority.to_string(),
    };
    println!("{}", serde_json::to_string_pretty(&deployment)?);

    let output_path =
        env::var("OUTPUT_PATH").unwrap_or_else(|_| "deployments/testnet.json".to_owned());
    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&output_path, serde_json::to_vec_pretty(&deployment)?)?;

    if dry_run {
        println!("DRY RUN: no transaction sent.");
        return Ok(());
    }

    let elf_path = env::var("PROGRAM_ELF_PATH")
        .unwrap_or_else(|_| "target/deploy/ans_registry.so".to_owned());
    if !Path::new(&elf_path).is_file() {
        bail!("SBF ELF not found at {elf_path}");
    }
    let config = Config {
        node_endpoint: String::new(),
        node_username: String::new(),
        node_password: String::new(),
        network: Network::Testnet,
        arch_node_url: rpc_url,
        titan_url: String::new(),
    };
    ProgramDeployer::new(&config)
        .try_deploy_program(
            "ans-registry".to_owned(),
            program_keypair,
            deployer_keypair,
            &elf_path,
        )
        .context("deploy ANS registry program")?;
    println!("Program deployment submitted successfully.");
    Ok(())
}

fn required(name: &str) -> Result<String> {
    env::var(name).with_context(|| format!("{name} must be set"))
}

fn env_flag(name: &str) -> bool {
    matches!(env::var(name).as_deref(), Ok("1") | Ok("true") | Ok("TRUE"))
}
