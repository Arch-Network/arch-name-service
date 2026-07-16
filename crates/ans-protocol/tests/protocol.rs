use ans_protocol::{
    derive::{
        derive_config_address, derive_name_address, derive_record_address, derive_reverse_address,
    },
    name::{canonicalize_name, name_hash},
    resolve::{resolve_owner, resolve_primary, resolve_record, AccountAt},
    state::{
        decode_state, encode_state, AccountHeader, BitcoinNetwork, NameAccount, RecordAccount,
        RecordType, RecordValue, RegistryConfig, ReverseAccount, TokenProgramConfig,
        NAME_ACCOUNT_DISCRIMINATOR, RECORD_ACCOUNT_DISCRIMINATOR, REGISTRY_CONFIG_DISCRIMINATOR,
        REVERSE_ACCOUNT_DISCRIMINATOR,
    },
    validate::{derive_token_ata, encode_taproot_address, parse_taproot_address},
    AnsError,
};

const PROGRAM_ID: [u8; 32] = [7; 32];
const OWNER: [u8; 32] = [9; 32];
const TOKEN_ID: [u8; 32] = [3; 32];

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

fn named_accounts() -> (AccountAt<RegistryConfig>, AccountAt<NameAccount>) {
    let config = config();
    let hash = name_hash("alice.arch").unwrap();
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
    (
        AccountAt {
            address: derive_config_address(PROGRAM_ID, config.network_id, &config.namespace),
            state: config,
        },
        AccountAt {
            address: derive_name_address(PROGRAM_ID, ".arch", hash),
            state: name,
        },
    )
}

#[test]
fn canonicalization_enforces_the_arch_namespace_and_label_policy() {
    assert_eq!(
        canonicalize_name("valid-name9.arch").unwrap(),
        "valid-name9.arch"
    );
    assert_eq!(
        canonicalize_name("Valid.arch"),
        Err(AnsError::InvalidLabelCharacter)
    );
    assert_eq!(
        canonicalize_name("name--two.arch"),
        Err(AnsError::InvalidHyphenPlacement)
    );
    assert_eq!(
        canonicalize_name("alice.test"),
        Err(AnsError::InvalidSuffix)
    );
}

#[test]
fn state_codec_round_trips_and_rejects_trailing_bytes() {
    let config = config();
    let mut bytes = encode_state(&config);
    assert_eq!(decode_state::<RegistryConfig>(&bytes).unwrap(), config);
    bytes.push(0);
    assert!(decode_state::<RegistryConfig>(&bytes).is_err());
}

#[test]
fn forward_resolution_requires_a_live_name_at_its_derived_address() {
    let (config, name) = named_accounts();
    assert_eq!(
        resolve_owner(PROGRAM_ID, &config, "alice.arch", &name, 199).unwrap(),
        OWNER
    );
    assert_eq!(
        resolve_owner(PROGRAM_ID, &config, "alice.arch", &name, 200),
        Err(AnsError::InactiveName)
    );
}

#[test]
fn stale_records_do_not_resolve_after_a_transfer_epoch_change() {
    let (config, name) = named_accounts();
    let record = RecordAccount {
        header: AccountHeader::initialized(RECORD_ACCOUNT_DISCRIMINATOR),
        name_hash: name.state.name_hash,
        record_type: RecordType::ArchOwner,
        owner_snapshot: OWNER,
        record_epoch: 3,
        revision: 1,
        value: RecordValue::ArchOwner(OWNER),
        updated_at_slot: 110,
    };
    let record = AccountAt {
        address: derive_record_address(
            PROGRAM_ID,
            &config.state.namespace,
            name.state.name_hash,
            RecordType::ArchOwner,
        ),
        state: record,
    };

    assert_eq!(
        resolve_record(
            PROGRAM_ID,
            &config,
            "alice.arch",
            &name,
            &record,
            RecordType::ArchOwner,
            150,
        ),
        Err(AnsError::StaleRecord)
    );
}

#[test]
fn reverse_resolution_rechecks_live_name_ownership_and_nonce() {
    let (config, name) = named_accounts();
    let reverse = AccountAt {
        address: derive_reverse_address(PROGRAM_ID, &config.state.namespace, OWNER),
        state: ReverseAccount {
            header: AccountHeader::initialized(REVERSE_ACCOUNT_DISCRIMINATOR),
            owner: OWNER,
            primary_name_hash: name.state.name_hash,
            binding_nonce: name.state.primary_binding_nonce,
            updated_at_slot: 120,
        },
    };
    assert_eq!(
        resolve_primary(PROGRAM_ID, &config, &reverse, &name, 150).unwrap(),
        "alice.arch"
    );
}

#[test]
fn taproot_records_are_canonical_and_network_specific() {
    let record = encode_taproot_address([11; 32], BitcoinNetwork::Testnet).unwrap();
    let parsed = parse_taproot_address(&record, BitcoinNetwork::Testnet).unwrap();
    assert_eq!(
        parsed,
        RecordValue::BitcoinTaproot {
            witness_program: [11; 32]
        }
    );
    assert_eq!(
        parse_taproot_address(&record, BitcoinNetwork::Mainnet),
        Err(AnsError::InvalidTaprootAddress)
    );
}

#[test]
fn token_records_must_use_the_configured_ata_derivation() {
    let (config, name) = named_accounts();
    let token_program = &config.state.token_programs[0];
    let ata = derive_token_ata(OWNER, TOKEN_ID, token_program);
    let record = AccountAt {
        address: derive_record_address(
            PROGRAM_ID,
            &config.state.namespace,
            name.state.name_hash,
            RecordType::TokenAta,
        ),
        state: RecordAccount {
            header: AccountHeader::initialized(RECORD_ACCOUNT_DISCRIMINATOR),
            name_hash: name.state.name_hash,
            record_type: RecordType::TokenAta,
            owner_snapshot: OWNER,
            record_epoch: name.state.record_epoch,
            revision: 1,
            value: RecordValue::TokenAta {
                token_id: TOKEN_ID,
                ata,
            },
            updated_at_slot: 120,
        },
    };

    assert!(resolve_record(
        PROGRAM_ID,
        &config,
        "alice.arch",
        &name,
        &record,
        RecordType::TokenAta,
        150,
    )
    .is_ok());
}
