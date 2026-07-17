use ans_protocol::{
    state::{
        AccountHeader, BitcoinNetwork, RecordType, RecordValue, RegistryConfig,
        REGISTRY_CONFIG_DISCRIMINATOR,
    },
    AnsError,
};

use crate::transition::{register, set_primary, set_record, transfer, PERMANENT_EXPIRY};

fn config() -> RegistryConfig {
    RegistryConfig {
        header: AccountHeader::initialized(REGISTRY_CONFIG_DISCRIMINATOR),
        program_version: 1,
        network_id: 2,
        namespace: ".arch".to_owned(),
        namespace_authority: [1; 32],
        grace_period_slots: 0,
        min_registration_slots: 0,
        max_registration_slots: 0,
        bitcoin_network: BitcoinNetwork::Testnet,
        token_programs: vec![],
        paused: false,
        mainnet_enabled: false,
    }
}

#[test]
fn registration_is_permanent_and_transfer_invalidates_records() {
    let mut name = register("alice".to_owned(), [2; 32]).unwrap();
    assert_eq!(name.expires_at_slot, PERMANENT_EXPIRY);
    let record = set_record(
        &config(),
        &name,
        None,
        RecordType::ArchOwner,
        RecordValue::ArchOwner([2; 32]),
        0,
    )
    .unwrap();

    transfer(&mut name, [3; 32]);
    assert_ne!(record.record_epoch, name.record_epoch);
    assert_ne!(record.owner_snapshot, name.owner);
}

#[test]
fn record_revisions_require_compare_and_swap() {
    let name = register("alice".to_owned(), [2; 32]).unwrap();
    let current = set_record(
        &config(),
        &name,
        None,
        RecordType::ArchOwner,
        RecordValue::ArchOwner([2; 32]),
        0,
    )
    .unwrap();
    assert_eq!(
        set_record(
            &config(),
            &name,
            Some(&current),
            RecordType::ArchOwner,
            RecordValue::ArchOwner([2; 32]),
            0,
        ),
        Err(AnsError::StaleRecord)
    );
}

#[test]
fn primary_binding_changes_on_transfer() {
    let mut name = register("alice".to_owned(), [2; 32]).unwrap();
    let reverse = set_primary(&mut name);
    transfer(&mut name, [3; 32]);
    assert_ne!(reverse.binding_nonce, name.primary_binding_nonce);
}
