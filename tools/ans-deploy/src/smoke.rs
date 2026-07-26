use std::time::{SystemTime, UNIX_EPOCH};

use ans_protocol::{
    derive::{derive_name_address, derive_record_address, derive_reverse_address},
    name::name_hash,
    resolve::{resolve_owner, resolve_primary, resolve_record, AccountAt},
    state::{decode_state, NameAccount, RecordAccount, RecordType, RecordValue, ReverseAccount},
    AnsError, NameInstruction, RegistryConfig,
};
use anyhow::{bail, Context, Result};
use arch_program::{
    account::AccountMeta, bitcoin::key::Keypair, instruction::Instruction, pubkey::Pubkey,
};
use arch_sdk::{with_secret_key_file, ArchRpcClient, Config};
use borsh::to_vec;
use serde::Serialize;

use crate::{tx::send_and_confirm, TransactionRecord, TESTNET_NAMESPACE};

const SMOKE_SLOT: u64 = 0;

#[derive(Serialize)]
pub struct SmokeReport {
    pub label: String,
    pub canonical_name: String,
    pub owner: String,
    pub new_owner: String,
    pub name_account: String,
    pub record_account: String,
    pub reverse_account: String,
    pub passed: bool,
}

/// Runs register → set_record → set_primary → transfer and asserts resolution.
/// Reloads the owner keypair from `owner_key_path` for each signed transaction.
pub fn run_smoke(
    client: &ArchRpcClient,
    config: &Config,
    program_id: Pubkey,
    registry_config: Pubkey,
    owner_key_path: &str,
    owner: Pubkey,
    new_owner: Pubkey,
    registry: &RegistryConfig,
) -> Result<(SmokeReport, Vec<TransactionRecord>)> {
    let label = smoke_label();
    let canonical_name = format!("{label}.arch");
    let hash = name_hash(&canonical_name).context("hash smoke label")?;
    let name_account = Pubkey::new_from_array(derive_name_address(
        program_id.serialize(),
        TESTNET_NAMESPACE,
        hash,
    ));
    let record_account = Pubkey::new_from_array(derive_record_address(
        program_id.serialize(),
        TESTNET_NAMESPACE,
        hash,
        RecordType::ArchOwner,
    ));
    let reverse_account = Pubkey::new_from_array(derive_reverse_address(
        program_id.serialize(),
        TESTNET_NAMESPACE,
        owner.serialize(),
    ));
    let system_program = Pubkey::system_program();
    let mut transactions = Vec::new();

    let load_owner = || -> Result<Keypair> {
        with_secret_key_file(owner_key_path)
            .map(|(keypair, _)| keypair)
            .with_context(|| format!("load smoke owner keypair from {owner_key_path}"))
    };

    let register_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(owner, true),
            AccountMeta::new_readonly(registry_config, false),
            AccountMeta::new(name_account, false),
            AccountMeta::new_readonly(system_program, false),
        ],
        data: to_vec(&NameInstruction::Register {
            label: label.clone(),
            duration_slots: 0,
        })?,
    };
    transactions.push(TransactionRecord {
        operation: "smoke_register".to_owned(),
        txid: send_and_confirm(
            client,
            config,
            register_ix,
            owner,
            vec![load_owner()?],
            "smoke_register",
        )?,
    });

    let config_at = AccountAt {
        address: registry_config.serialize(),
        state: registry.clone(),
    };
    let name_state = read_account::<NameAccount>(client, name_account, program_id)?;
    let name_at = AccountAt {
        address: name_account.serialize(),
        state: name_state,
    };
    let resolved_owner = resolve_owner(
        program_id.serialize(),
        &config_at,
        &canonical_name,
        &name_at,
        SMOKE_SLOT,
    )
    .context("resolve_owner after register")?;
    if resolved_owner != owner.serialize() {
        bail!(
            "resolve_owner after register expected {}, got {}",
            owner,
            hex(&resolved_owner)
        );
    }

    let set_record_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(owner, true),
            AccountMeta::new_readonly(registry_config, false),
            AccountMeta::new(name_account, false),
            AccountMeta::new(record_account, false),
            AccountMeta::new_readonly(system_program, false),
        ],
        data: to_vec(&NameInstruction::SetRecord {
            name_hash: hash,
            record_type: RecordType::ArchOwner,
            value: RecordValue::ArchOwner(owner.serialize()),
            expected_revision: 0,
        })?,
    };
    transactions.push(TransactionRecord {
        operation: "smoke_set_record".to_owned(),
        txid: send_and_confirm(
            client,
            config,
            set_record_ix,
            owner,
            vec![load_owner()?],
            "smoke_set_record",
        )?,
    });

    let name_state = read_account::<NameAccount>(client, name_account, program_id)?;
    let record_state = read_account::<RecordAccount>(client, record_account, program_id)?;
    let name_at = AccountAt {
        address: name_account.serialize(),
        state: name_state,
    };
    let record_at = AccountAt {
        address: record_account.serialize(),
        state: record_state,
    };
    let resolved_record = resolve_record(
        program_id.serialize(),
        &config_at,
        &canonical_name,
        &name_at,
        &record_at,
        RecordType::ArchOwner,
        SMOKE_SLOT,
    )
    .context("resolve_record after set_record")?;
    if resolved_record != RecordValue::ArchOwner(owner.serialize()) {
        bail!("resolve_record returned unexpected value after set_record");
    }

    let set_primary_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(owner, true),
            AccountMeta::new_readonly(registry_config, false),
            AccountMeta::new(name_account, false),
            AccountMeta::new(reverse_account, false),
            AccountMeta::new_readonly(system_program, false),
        ],
        data: to_vec(&NameInstruction::SetPrimary { name_hash: hash })?,
    };
    transactions.push(TransactionRecord {
        operation: "smoke_set_primary".to_owned(),
        txid: send_and_confirm(
            client,
            config,
            set_primary_ix,
            owner,
            vec![load_owner()?],
            "smoke_set_primary",
        )?,
    });

    let name_state = read_account::<NameAccount>(client, name_account, program_id)?;
    let reverse_state = read_account::<ReverseAccount>(client, reverse_account, program_id)?;
    let name_at = AccountAt {
        address: name_account.serialize(),
        state: name_state,
    };
    let reverse_at = AccountAt {
        address: reverse_account.serialize(),
        state: reverse_state,
    };
    let resolved_primary = resolve_primary(
        program_id.serialize(),
        &config_at,
        &reverse_at,
        &name_at,
        SMOKE_SLOT,
    )
    .context("resolve_primary after set_primary")?;
    if resolved_primary != canonical_name {
        bail!("resolve_primary expected {canonical_name}, got {resolved_primary}");
    }

    let transfer_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(owner, true),
            AccountMeta::new_readonly(registry_config, false),
            AccountMeta::new(name_account, false),
        ],
        data: to_vec(&NameInstruction::Transfer {
            name_hash: hash,
            new_owner: new_owner.serialize(),
        })?,
    };
    transactions.push(TransactionRecord {
        operation: "smoke_transfer".to_owned(),
        txid: send_and_confirm(
            client,
            config,
            transfer_ix,
            owner,
            vec![load_owner()?],
            "smoke_transfer",
        )?,
    });

    let name_state = read_account::<NameAccount>(client, name_account, program_id)?;
    let record_state = read_account::<RecordAccount>(client, record_account, program_id)?;
    let reverse_state = read_account::<ReverseAccount>(client, reverse_account, program_id)?;
    let name_at = AccountAt {
        address: name_account.serialize(),
        state: name_state,
    };
    let record_at = AccountAt {
        address: record_account.serialize(),
        state: record_state,
    };
    let reverse_at = AccountAt {
        address: reverse_account.serialize(),
        state: reverse_state,
    };

    let transferred_owner = resolve_owner(
        program_id.serialize(),
        &config_at,
        &canonical_name,
        &name_at,
        SMOKE_SLOT,
    )
    .context("resolve_owner after transfer")?;
    if transferred_owner != new_owner.serialize() {
        bail!(
            "resolve_owner after transfer expected {}, got {}",
            new_owner,
            hex(&transferred_owner)
        );
    }

    match resolve_record(
        program_id.serialize(),
        &config_at,
        &canonical_name,
        &name_at,
        &record_at,
        RecordType::ArchOwner,
        SMOKE_SLOT,
    ) {
        Err(AnsError::StaleRecord) => {}
        Ok(_) => bail!("resolve_record should be stale after transfer"),
        Err(other) => bail!("resolve_record after transfer: expected StaleRecord, got {other:?}"),
    }

    match resolve_primary(
        program_id.serialize(),
        &config_at,
        &reverse_at,
        &name_at,
        SMOKE_SLOT,
    ) {
        Err(AnsError::InvalidReverseBinding) => {}
        Ok(name) => bail!("resolve_primary should fail after transfer, got {name}"),
        Err(other) => {
            bail!("resolve_primary after transfer: expected InvalidReverseBinding, got {other:?}")
        }
    }

    Ok((
        SmokeReport {
            label,
            canonical_name,
            owner: owner.to_string(),
            new_owner: new_owner.to_string(),
            name_account: name_account.to_string(),
            record_account: record_account.to_string(),
            reverse_account: reverse_account.to_string(),
            passed: true,
        },
        transactions,
    ))
}

fn read_account<T: borsh::BorshDeserialize>(
    client: &ArchRpcClient,
    address: Pubkey,
    program_id: Pubkey,
) -> Result<T> {
    let account = client
        .read_account_info(address)
        .with_context(|| format!("read account {address}"))?;
    if account.owner != program_id {
        bail!(
            "account {address} owner {} != program {program_id}",
            account.owner
        );
    }
    decode_state(&account.data).with_context(|| format!("decode account {address}"))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn smoke_label() -> String {
    if let Ok(label) = std::env::var("SMOKE_LABEL") {
        return label;
    }
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("smoke{secs}")
}
