use crate::{
    derive::{
        derive_config_address, derive_name_address, derive_record_address, derive_reverse_address,
    },
    error::AnsError,
    name::{canonicalize_name, name_hash},
    state::{
        ArchAddress, NameAccount, RecordAccount, RecordType, RecordValue, RegistryConfig,
        ReverseAccount, NAME_ACCOUNT_DISCRIMINATOR, RECORD_ACCOUNT_DISCRIMINATOR,
        REGISTRY_CONFIG_DISCRIMINATOR, REVERSE_ACCOUNT_DISCRIMINATOR,
    },
    validate::{is_active, validate_record_value},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccountAt<T> {
    pub address: ArchAddress,
    pub state: T,
}

pub fn resolve_owner(
    program_id: ArchAddress,
    config: &AccountAt<RegistryConfig>,
    requested_name: &str,
    name: &AccountAt<NameAccount>,
    current_slot: u64,
) -> Result<ArchAddress, AnsError> {
    validate_config(program_id, config)?;
    validate_name(
        program_id,
        &config.state,
        requested_name,
        name,
        current_slot,
    )?;
    Ok(name.state.owner)
}

pub fn resolve_record(
    program_id: ArchAddress,
    config: &AccountAt<RegistryConfig>,
    requested_name: &str,
    name: &AccountAt<NameAccount>,
    record: &AccountAt<RecordAccount>,
    record_type: RecordType,
    current_slot: u64,
) -> Result<RecordValue, AnsError> {
    validate_config(program_id, config)?;
    validate_name(
        program_id,
        &config.state,
        requested_name,
        name,
        current_slot,
    )?;

    let state = &record.state;
    state.header.validate(RECORD_ACCOUNT_DISCRIMINATOR)?;
    if record.address
        != derive_record_address(
            program_id,
            &config.state.namespace,
            name.state.name_hash,
            record_type,
        )
    {
        return Err(AnsError::InvalidAccountDerivation);
    }
    if state.name_hash != name.state.name_hash
        || state.record_type != record_type
        || state.owner_snapshot != name.state.owner
        || state.record_epoch != name.state.record_epoch
    {
        return Err(AnsError::StaleRecord);
    }
    validate_record_value(&config.state, &name.state, record_type, &state.value)?;
    Ok(state.value.clone())
}

pub fn resolve_primary(
    program_id: ArchAddress,
    config: &AccountAt<RegistryConfig>,
    reverse: &AccountAt<ReverseAccount>,
    name: &AccountAt<NameAccount>,
    current_slot: u64,
) -> Result<String, AnsError> {
    validate_config(program_id, config)?;
    reverse
        .state
        .header
        .validate(REVERSE_ACCOUNT_DISCRIMINATOR)?;
    if reverse.address
        != derive_reverse_address(program_id, &config.state.namespace, reverse.state.owner)
    {
        return Err(AnsError::InvalidAccountDerivation);
    }
    if name.address
        != derive_name_address(
            program_id,
            &config.state.namespace,
            reverse.state.primary_name_hash,
        )
    {
        return Err(AnsError::InvalidAccountDerivation);
    }
    name.state.header.validate(NAME_ACCOUNT_DISCRIMINATOR)?;
    if !is_active(&name.state, current_slot)
        || name.state.name_hash != reverse.state.primary_name_hash
        || name.state.owner != reverse.state.owner
        || name.state.primary_binding_nonce != reverse.state.binding_nonce
    {
        return Err(AnsError::InvalidReverseBinding);
    }
    canonicalize_name(&format!("{}.arch", name.state.canonical_label))
}

fn validate_config(
    program_id: ArchAddress,
    config: &AccountAt<RegistryConfig>,
) -> Result<(), AnsError> {
    config
        .state
        .header
        .validate(REGISTRY_CONFIG_DISCRIMINATOR)?;
    if config.address
        != derive_config_address(program_id, config.state.network_id, &config.state.namespace)
    {
        return Err(AnsError::InvalidAccountDerivation);
    }
    Ok(())
}

fn validate_name(
    program_id: ArchAddress,
    config: &RegistryConfig,
    requested_name: &str,
    name: &AccountAt<NameAccount>,
    current_slot: u64,
) -> Result<(), AnsError> {
    name.state.header.validate(NAME_ACCOUNT_DISCRIMINATOR)?;
    let canonical_name = canonicalize_name(requested_name)?;
    let expected_hash = name_hash(&canonical_name)?;
    if name.address != derive_name_address(program_id, &config.namespace, expected_hash) {
        return Err(AnsError::InvalidAccountDerivation);
    }
    if !is_active(&name.state, current_slot) {
        return Err(AnsError::InactiveName);
    }
    if name.state.name_hash != expected_hash
        || canonical_name.strip_suffix(".arch") != Some(name.state.canonical_label.as_str())
    {
        return Err(AnsError::NameMismatch);
    }
    Ok(())
}
