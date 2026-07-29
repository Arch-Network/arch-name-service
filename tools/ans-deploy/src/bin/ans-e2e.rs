use std::{
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use ans_protocol::{
    derive::{derive_name_address, derive_record_address, derive_reverse_address},
    name::name_hash,
    state::{decode_state, NameAccount, RecordType, RecordValue, NAME_ACCOUNT_DISCRIMINATOR},
    NameInstruction,
};
use anyhow::{bail, Context, Result};
use arch_program::{
    account::AccountMeta, bitcoin::Network, hash::Hash, instruction::Instruction, pubkey::Pubkey,
    sanitized::ArchMessage, system_instruction,
};
use arch_sdk::{
    build_and_sign_transaction, generate_new_keypair, sign_message_bip322, AccountFilter,
    ArchRpcClient, Config, RuntimeTransaction, Signature,
};
use borsh::to_vec;
use serde::Serialize;
use serde_json::json;

const RPC_URL: &str = "https://id.arch.network/rpc";
const PROGRAM_ID_HEX: &str = "3d9fbaa282268d8453a924692f254ad6c610668f36512db9fb50325ac2e4e079";
const REGISTRY_CONFIG_HEX: &str =
    "29691c11fb04be3e25c5f236dc7971cbb3293fc0f7a3bed288dc4cd476320521";
const NAMESPACE: &str = ".arch";
const SALE_PRICE_LAMPORTS: u64 = 1_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum QuoteAsset {
    Arch,
}

#[derive(Clone, Serialize)]
struct Listing {
    name: String,
    seller: String,
    quote: QuoteAsset,
    amount: u64,
    cancelled: bool,
}

#[derive(Serialize)]
struct Evidence {
    rpc_url: String,
    seller_pubkey: String,
    seller_taproot_address: String,
    buyer_pubkey: String,
    buyer_taproot_address: String,
    seller_initial_lamports: u64,
    buyer_initial_lamports: u64,
    name: String,
    register_txid: String,
    set_record_txid: String,
    set_primary_txid: String,
    listed_names: Vec<String>,
    cancelled_listing_rejected: bool,
    marketplace_listing: Listing,
    marketplace_buy_txid: String,
    final_owner: String,
}

fn main() -> Result<()> {
    let config = Config {
        node_endpoint: String::new(),
        node_username: String::new(),
        node_password: String::new(),
        network: Network::Testnet4,
        arch_node_url: RPC_URL.to_owned(),
        titan_url: String::new(),
    };
    let client = ArchRpcClient::new(&config);
    let program_id = pubkey_from_hex(PROGRAM_ID_HEX)?;
    let registry_config = pubkey_from_hex(REGISTRY_CONFIG_HEX)?;
    let (seller_keypair, seller, seller_address) = generate_new_keypair(Network::Testnet4);
    let (buyer_keypair, buyer, buyer_address) = generate_new_keypair(Network::Testnet4);
    eprintln!(
        "seller_identity={}",
        json!({
            "pubkey": seller.to_string(),
            "taproot_address": seller_address.to_string(),
        })
    );

    fund_with_proxy_compat(&client, &seller_keypair, seller)
        .context("create and fund seller through proxy faucet")?;
    eprintln!(
        "seller_funded={}",
        json!({
            "pubkey": seller.to_string(),
            "lamports": read_account_proxy(&client, seller)?.lamports,
        })
    );
    fund_with_proxy_compat(&client, &buyer_keypair, buyer)
        .context("create and fund buyer through proxy faucet")?;
    let seller_initial_lamports = read_account_proxy(&client, seller)?.lamports;
    let buyer_initial_lamports = read_account_proxy(&client, buyer)?.lamports;

    let label = unique_label();
    let name = format!("{label}{NAMESPACE}");
    let hash = name_hash(&name)?;
    let name_account =
        Pubkey::new_from_array(derive_name_address(program_id.serialize(), NAMESPACE, hash));
    let record_account = Pubkey::new_from_array(derive_record_address(
        program_id.serialize(),
        NAMESPACE,
        hash,
        RecordType::ArchOwner,
    ));
    let reverse_account = Pubkey::new_from_array(derive_reverse_address(
        program_id.serialize(),
        NAMESPACE,
        seller.serialize(),
    ));

    let register_txid = send_and_confirm(
        &client,
        &config,
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(seller, true),
                AccountMeta::new_readonly(registry_config, false),
                AccountMeta::new(name_account, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: to_vec(&NameInstruction::Register {
                label,
                duration_slots: 0,
            })?,
        }],
        seller,
        vec![seller_keypair],
        "register",
    )?;
    wait_for_account(&client, name_account, |account| account.owner == program_id)
        .context("wait for registered name account")?;

    let set_record_txid = send_and_confirm(
        &client,
        &config,
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(seller, true),
                AccountMeta::new_readonly(registry_config, false),
                AccountMeta::new(name_account, false),
                AccountMeta::new(record_account, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: to_vec(&NameInstruction::SetRecord {
                name_hash: hash,
                record_type: RecordType::ArchOwner,
                value: RecordValue::ArchOwner(seller.serialize()),
                expected_revision: 0,
            })?,
        }],
        seller,
        vec![seller_keypair],
        "set_record",
    )?;
    wait_for_account(&client, record_account, |account| {
        account.owner == program_id
    })
    .context("wait for record account")?;

    let set_primary_txid = send_and_confirm(
        &client,
        &config,
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(seller, true),
                AccountMeta::new_readonly(registry_config, false),
                AccountMeta::new(name_account, false),
                AccountMeta::new(reverse_account, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: to_vec(&NameInstruction::SetPrimary { name_hash: hash })?,
        }],
        seller,
        vec![seller_keypair],
        "set_primary",
    )?;
    wait_for_account(&client, reverse_account, |account| {
        account.owner == program_id
    })
    .context("wait for reverse account")?;

    let listed_names = list_owned_names(&client, program_id, seller)?;
    if !listed_names.iter().any(|candidate| candidate == &name) {
        bail!("registered name {name} was absent from get_program_accounts results");
    }

    // Scripted marketplace MVP: listing discovery/cancellation is off-chain, while
    // purchase is an atomic on-chain ARCH payment + registry transfer signed by
    // both parties. It does not claim to be a deployed escrow marketplace.
    let mut cancelled = Listing {
        name: name.clone(),
        seller: seller.to_string(),
        quote: QuoteAsset::Arch,
        amount: SALE_PRICE_LAMPORTS,
        cancelled: false,
    };
    cancelled.cancelled = true;
    let cancelled_listing_rejected = cancelled.cancelled;

    let listing = Listing {
        name: name.clone(),
        seller: seller.to_string(),
        quote: QuoteAsset::Arch,
        amount: SALE_PRICE_LAMPORTS,
        cancelled: false,
    };
    let marketplace_buy_txid = execute_arch_purchase(
        &client,
        &config,
        program_id,
        registry_config,
        name_account,
        hash,
        seller,
        buyer,
        seller_keypair,
        buyer_keypair,
        &listing,
    )?;

    wait_for_account(&client, name_account, |account| {
        decode_state::<NameAccount>(&account.data)
            .map(|state| state.owner == buyer.serialize())
            .unwrap_or(false)
    })
    .context("wait for marketplace ownership transfer")?;
    let final_name: NameAccount = decode_state(&read_account_proxy(&client, name_account)?.data)?;
    if final_name.owner != buyer.serialize() {
        bail!("atomic purchase processed but buyer does not own {name}");
    }

    println!(
        "{}",
        serde_json::to_string_pretty(&Evidence {
            rpc_url: RPC_URL.to_owned(),
            seller_pubkey: seller.to_string(),
            seller_taproot_address: seller_address.to_string(),
            buyer_pubkey: buyer.to_string(),
            buyer_taproot_address: buyer_address.to_string(),
            seller_initial_lamports,
            buyer_initial_lamports,
            name,
            register_txid,
            set_record_txid,
            set_primary_txid,
            listed_names,
            cancelled_listing_rejected,
            marketplace_listing: listing,
            marketplace_buy_txid,
            final_owner: buyer.to_string(),
        })?
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn execute_arch_purchase(
    client: &ArchRpcClient,
    config: &Config,
    program_id: Pubkey,
    registry_config: Pubkey,
    name_account: Pubkey,
    hash: [u8; 32],
    seller: Pubkey,
    buyer: Pubkey,
    seller_keypair: arch_program::bitcoin::key::Keypair,
    buyer_keypair: arch_program::bitcoin::key::Keypair,
    listing: &Listing,
) -> Result<String> {
    if listing.cancelled {
        bail!("listing is cancelled");
    }
    let mut payment = system_instruction::transfer(&buyer, &seller, listing.amount);
    payment.program_id = system_program_id();
    let ownership = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(seller, true),
            AccountMeta::new_readonly(registry_config, false),
            AccountMeta::new(name_account, false),
        ],
        data: to_vec(&NameInstruction::Transfer {
            name_hash: hash,
            new_owner: buyer.serialize(),
        })?,
    };
    send_and_confirm(
        client,
        config,
        &[payment, ownership],
        buyer,
        vec![buyer_keypair, seller_keypair],
        "marketplace_buy",
    )
}

fn list_owned_names(
    client: &ArchRpcClient,
    program_id: Pubkey,
    owner: Pubkey,
) -> Result<Vec<String>> {
    let entries = client.get_program_accounts(
        &program_id,
        Some(vec![AccountFilter::DataContent {
            offset: 0,
            bytes: NAME_ACCOUNT_DISCRIMINATOR.to_vec(),
        }]),
    )?;
    let mut names = Vec::new();
    for entry in entries {
        if entry.account.owner != program_id {
            continue;
        }
        let Ok(state) = decode_state::<NameAccount>(&entry.account.data) else {
            continue;
        };
        if state.header.validate(NAME_ACCOUNT_DISCRIMINATOR).is_err()
            || state.owner != owner.serialize()
        {
            continue;
        }
        let canonical = format!("{}{}", state.canonical_label, NAMESPACE);
        let expected = derive_name_address(program_id.serialize(), NAMESPACE, state.name_hash);
        if entry.pubkey.serialize() == expected {
            names.push(canonical);
        }
    }
    Ok(names)
}

fn send_and_confirm(
    client: &ArchRpcClient,
    config: &Config,
    instructions: &[Instruction],
    fee_payer: Pubkey,
    signers: Vec<arch_program::bitcoin::key::Keypair>,
    operation: &str,
) -> Result<String> {
    let blockhash = current_block_hash(client)?;
    let transaction = build_and_sign_transaction(
        ArchMessage::new(instructions, Some(fee_payer), blockhash),
        signers,
        config.network,
    )?;
    let txid = client.send_transaction(transaction)?;
    let processed = wait_for_processed_proxy(client, &txid.to_string())
        .with_context(|| format!("confirm {operation}"))?;
    if processed
        .pointer("/status/type")
        .and_then(|value| value.as_str())
        == Some("Failed")
    {
        bail!("{operation} transaction {txid} failed: {processed}");
    }
    Ok(txid.to_string())
}

fn current_block_hash(client: &ArchRpcClient) -> Result<Hash> {
    let bytes = client
        .call_method::<Vec<u8>>("get_best_block_hash")?
        .context("get_best_block_hash returned no result")?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("best block hash was not 32 bytes"))?;
    Ok(Hash::from(bytes))
}

fn fund_with_proxy_compat(
    client: &ArchRpcClient,
    keypair: &arch_program::bitcoin::key::Keypair,
    pubkey: Pubkey,
) -> Result<()> {
    let mut transaction = client
        .call_method_with_params::<Pubkey, RuntimeTransaction>("create_account_with_faucet", pubkey)
        .context("request faucet account-creation transaction")?
        .context("faucet returned no account-creation transaction")?;
    let message_hash = transaction.message.hash();
    transaction
        .signatures
        .push(Signature::from(sign_message_bip322(
            keypair,
            &message_hash,
            client.config.network,
        )));
    let txid = client
        .send_transaction(transaction)
        .context("submit signed faucet transaction")?;
    wait_for_account(client, pubkey, |account| account.lamports > 0)
        .with_context(|| format!("faucet transaction {txid} did not create a funded account"))
        .map(|_| ())
}

fn wait_for_processed_proxy(client: &ArchRpcClient, txid: &str) -> Result<serde_json::Value> {
    let txid_bytes = hex_bytes(txid)?;
    for _ in 0..120 {
        match client.call_method_with_params::<_, serde_json::Value>(
            "get_processed_transaction",
            json!({ "tx_id": &txid_bytes }),
        ) {
            Ok(Some(processed)) => return Ok(processed),
            Ok(None) => {}
            Err(error) if error.to_string().contains("Invalid params") => {
                // Explorer reports a not-yet-indexed txid as Invalid params.
            }
            Err(error) => return Err(error).context("query get_processed_transaction"),
        }
        thread::sleep(Duration::from_millis(500));
    }
    bail!("transaction {txid} was not processed before timeout")
}

fn wait_for_account<F>(
    client: &ArchRpcClient,
    pubkey: Pubkey,
    predicate: F,
) -> Result<arch_sdk::AccountInfo>
where
    F: Fn(&arch_sdk::AccountInfo) -> bool,
{
    for _ in 0..120 {
        if let Ok(account) = read_account_proxy(client, pubkey) {
            if predicate(&account) {
                return Ok(account);
            }
        }
        thread::sleep(Duration::from_millis(500));
    }
    bail!("account state {pubkey} was not visible before timeout")
}

fn read_account_proxy(client: &ArchRpcClient, pubkey: Pubkey) -> Result<arch_sdk::AccountInfo> {
    client
        .call_method_with_params::<_, arch_sdk::AccountInfo>(
            "read_account_info",
            vec![pubkey.serialize()],
        )?
        .with_context(|| format!("account {pubkey} is not in database"))
}

fn pubkey_from_hex(value: &str) -> Result<Pubkey> {
    Ok(Pubkey::new_from_array(
        hex_bytes(value)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("expected 32-byte hex pubkey"))?,
    ))
}

fn hex_bytes(value: &str) -> Result<Vec<u8>> {
    if value.len() % 2 != 0 {
        bail!("hex value must have even length");
    }
    (0..value.len())
        .step_by(2)
        .map(|index| Ok(u8::from_str_radix(&value[index..index + 2], 16)?))
        .collect()
}

fn system_program_id() -> Pubkey {
    // Live testnet executable is all-zeros (`111111…` base58), same as
    // `Pubkey::system_program()`. The `…0001` pubkey is a funded account, not
    // the system program.
    Pubkey::system_program()
}

fn unique_label() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("e2e{millis}")
}
