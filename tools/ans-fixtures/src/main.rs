use std::{env, fs, path::PathBuf};

use ans_protocol::{
    derive::{
        derive_config_address, derive_name_address, derive_record_address, derive_reverse_address,
        namespace_hash,
    },
    name::{canonicalize_name, name_hash},
    resolve::{resolve_owner, resolve_primary, resolve_record, AccountAt},
    state::{
        encode_state, AccountHeader, BitcoinNetwork, NameAccount, RecordAccount, RecordType,
        RecordValue, RegistryConfig, ReverseAccount, TokenProgramConfig,
        NAME_ACCOUNT_DISCRIMINATOR, RECORD_ACCOUNT_DISCRIMINATOR, REGISTRY_CONFIG_DISCRIMINATOR,
        REVERSE_ACCOUNT_DISCRIMINATOR,
    },
    validate::{derive_token_ata, encode_taproot_address},
    NameInstruction,
};
use borsh::to_vec;
use serde::Serialize;

const PROGRAM_ID: [u8; 32] = [7; 32];
const OWNER: [u8; 32] = [9; 32];
const TOKEN_ID: [u8; 32] = [3; 32];

#[derive(Serialize)]
struct Fixtures {
    program_id: String,
    owner: String,
    names: NameFixtures,
    derivations: DerivationFixtures,
    accounts: AccountFixtures,
    instructions: InstructionFixtures,
    resolution: ResolutionFixtures,
    taproot: TaprootFixtures,
}

#[derive(Serialize)]
struct NameFixtures {
    canonical: String,
    name_hash: String,
    namespace_hash: String,
}

#[derive(Serialize)]
struct DerivationFixtures {
    config: String,
    name: String,
    record_arch_owner: String,
    reverse: String,
    token_ata: String,
}

#[derive(Serialize)]
struct AccountFixtures {
    registry_config: String,
    name_account: String,
    record_account: String,
    reverse_account: String,
}

#[derive(Serialize)]
struct InstructionFixtures {
    initialize_registry: String,
    register: String,
    transfer: String,
    set_record_arch_owner: String,
    set_primary: String,
    clear_primary: String,
}

#[derive(Serialize)]
struct ResolutionFixtures {
    owner_active_ok: bool,
    owner_inactive_error: String,
    stale_record_error: String,
    primary_ok: String,
}

#[derive(Serialize)]
struct TaprootFixtures {
    witness_program: String,
    testnet_address: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out = output_dir()?;
    fs::create_dir_all(&out)?;

    let config = config();
    let hash = name_hash("alice.arch")?;
    let name = NameAccount {
        header: AccountHeader::initialized(NAME_ACCOUNT_DISCRIMINATOR),
        name_hash: hash,
        canonical_label: "alice".to_owned(),
        owner: OWNER,
        registered_at_slot: 100,
        expires_at_slot: 200,
        record_epoch: 4,
        primary_binding_nonce: 8,
    };
    let record = RecordAccount {
        header: AccountHeader::initialized(RECORD_ACCOUNT_DISCRIMINATOR),
        name_hash: hash,
        record_type: RecordType::ArchOwner,
        owner_snapshot: OWNER,
        record_epoch: 3,
        revision: 1,
        value: RecordValue::ArchOwner(OWNER),
        updated_at_slot: 110,
    };
    let reverse = ReverseAccount {
        header: AccountHeader::initialized(REVERSE_ACCOUNT_DISCRIMINATOR),
        owner: OWNER,
        primary_name_hash: hash,
        binding_nonce: 8,
        updated_at_slot: 120,
    };

    let config_at = AccountAt {
        address: derive_config_address(PROGRAM_ID, config.network_id, &config.namespace),
        state: config.clone(),
    };
    let name_at = AccountAt {
        address: derive_name_address(PROGRAM_ID, ".arch", hash),
        state: name.clone(),
    };
    let record_at = AccountAt {
        address: derive_record_address(PROGRAM_ID, ".arch", hash, RecordType::ArchOwner),
        state: record.clone(),
    };
    let reverse_at = AccountAt {
        address: derive_reverse_address(PROGRAM_ID, ".arch", OWNER),
        state: reverse.clone(),
    };

    let owner_active_ok =
        resolve_owner(PROGRAM_ID, &config_at, "alice.arch", &name_at, 199).is_ok();
    let owner_inactive_error = format!(
        "{:?}",
        resolve_owner(PROGRAM_ID, &config_at, "alice.arch", &name_at, 200).unwrap_err()
    );
    let stale_record_error = format!(
        "{:?}",
        resolve_record(
            PROGRAM_ID,
            &config_at,
            "alice.arch",
            &name_at,
            &record_at,
            RecordType::ArchOwner,
            150,
        )
        .unwrap_err()
    );
    let primary_ok = resolve_primary(PROGRAM_ID, &config_at, &reverse_at, &name_at, 150)?;

    let token_program = &config.token_programs[0];
    let ata = derive_token_ata(OWNER, TOKEN_ID, token_program);
    let taproot = encode_taproot_address([11; 32], BitcoinNetwork::Testnet)?;

    let fixtures = Fixtures {
        program_id: hex(&PROGRAM_ID),
        owner: hex(&OWNER),
        names: NameFixtures {
            canonical: canonicalize_name("alice.arch")?,
            name_hash: hex(&hash),
            namespace_hash: hex(&namespace_hash(".arch")),
        },
        derivations: DerivationFixtures {
            config: hex(&config_at.address),
            name: hex(&name_at.address),
            record_arch_owner: hex(&record_at.address),
            reverse: hex(&reverse_at.address),
            token_ata: hex(&ata),
        },
        accounts: AccountFixtures {
            registry_config: hex(&encode_state(&config)),
            name_account: hex(&encode_state(&name)),
            record_account: hex(&encode_state(&record)),
            reverse_account: hex(&encode_state(&reverse)),
        },
        instructions: InstructionFixtures {
            initialize_registry: hex(&to_vec(&NameInstruction::InitializeRegistry {
                network_id: 2,
                namespace_authority: [8; 32],
            })?),
            register: hex(&to_vec(&NameInstruction::Register {
                label: "alice".to_owned(),
                duration_slots: 0,
            })?),
            transfer: hex(&to_vec(&NameInstruction::Transfer {
                name_hash: hash,
                new_owner: [5; 32],
            })?),
            set_record_arch_owner: hex(&to_vec(&NameInstruction::SetRecord {
                name_hash: hash,
                record_type: RecordType::ArchOwner,
                value: RecordValue::ArchOwner(OWNER),
                expected_revision: 0,
            })?),
            set_primary: hex(&to_vec(&NameInstruction::SetPrimary { name_hash: hash })?),
            clear_primary: hex(&to_vec(&NameInstruction::ClearPrimary)?),
        },
        resolution: ResolutionFixtures {
            owner_active_ok,
            owner_inactive_error,
            stale_record_error,
            primary_ok,
        },
        taproot: TaprootFixtures {
            witness_program: hex(&[11; 32]),
            testnet_address: taproot,
        },
    };

    let path = out.join("protocol.json");
    fs::write(&path, serde_json::to_vec_pretty(&fixtures)?)?;
    println!("wrote {}", path.display());
    Ok(())
}

fn config() -> RegistryConfig {
    RegistryConfig {
        header: AccountHeader::initialized(REGISTRY_CONFIG_DISCRIMINATOR),
        program_version: 1,
        network_id: 31337,
        namespace: ".arch".to_owned(),
        namespace_authority: [8; 32],
        grace_period_slots: 50,
        min_registration_slots: 10,
        max_registration_slots: 100_000,
        bitcoin_network: BitcoinNetwork::Testnet,
        token_programs: vec![TokenProgramConfig {
            token_program_id: [2; 32],
            associated_token_program_id: [4; 32],
        }],
        paused: false,
        mainnet_enabled: false,
    }
}

fn output_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(path) = env::args().nth(1) {
        return Ok(PathBuf::from(path));
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    Ok(manifest_dir
        .join("../../packages/ans-sdk/fixtures")
        .canonicalize()
        .unwrap_or_else(|_| manifest_dir.join("../../packages/ans-sdk/fixtures")))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
