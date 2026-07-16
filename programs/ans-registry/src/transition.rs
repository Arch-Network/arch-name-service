use ans_protocol::{
    name::name_hash,
    state::{
        AccountHeader, ArchAddress, NameAccount, RecordAccount, RecordType, RecordValue,
        ReverseAccount, NAME_ACCOUNT_DISCRIMINATOR, RECORD_ACCOUNT_DISCRIMINATOR,
        REVERSE_ACCOUNT_DISCRIMINATOR,
    },
    validate::validate_record_value,
    AnsError, RegistryConfig,
};

pub const PERMANENT_EXPIRY: u64 = u64::MAX;

pub fn register(label: String, owner: ArchAddress) -> Result<NameAccount, AnsError> {
    Ok(NameAccount {
        header: AccountHeader::initialized(NAME_ACCOUNT_DISCRIMINATOR),
        name_hash: name_hash(&format!("{label}.arch"))?,
        canonical_label: label,
        owner,
        registered_at_slot: 0,
        expires_at_slot: PERMANENT_EXPIRY,
        record_epoch: 1,
        primary_binding_nonce: 0,
    })
}

pub fn transfer(name: &mut NameAccount, new_owner: ArchAddress) {
    name.owner = new_owner;
    name.record_epoch = name.record_epoch.saturating_add(1);
    name.primary_binding_nonce = name.primary_binding_nonce.saturating_add(1);
}

pub fn set_record(
    config: &RegistryConfig,
    name: &NameAccount,
    existing: Option<&RecordAccount>,
    record_type: RecordType,
    value: RecordValue,
    expected_revision: u64,
) -> Result<RecordAccount, AnsError> {
    validate_record_value(config, name, record_type, &value)?;
    let revision = match existing {
        Some(record) if record.revision == expected_revision => record.revision.saturating_add(1),
        Some(_) => return Err(AnsError::StaleRecord),
        None if expected_revision == 0 => 1,
        None => return Err(AnsError::StaleRecord),
    };
    Ok(RecordAccount {
        header: AccountHeader::initialized(RECORD_ACCOUNT_DISCRIMINATOR),
        name_hash: name.name_hash,
        record_type,
        owner_snapshot: name.owner,
        record_epoch: name.record_epoch,
        revision,
        value,
        updated_at_slot: 0,
    })
}

pub fn set_primary(name: &mut NameAccount) -> ReverseAccount {
    name.primary_binding_nonce = name.primary_binding_nonce.saturating_add(1);
    ReverseAccount {
        header: AccountHeader::initialized(REVERSE_ACCOUNT_DISCRIMINATOR),
        owner: name.owner,
        primary_name_hash: name.name_hash,
        binding_nonce: name.primary_binding_nonce,
        updated_at_slot: 0,
    }
}
