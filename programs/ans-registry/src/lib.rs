//! Minimal permanent-registration registry for the ANS testnet alpha.

use ans_protocol::{
    derive::{
        derive_config_address, derive_name_address, derive_record_address_for_value,
        derive_reverse_address, namespace_hash, record_key_hash,
    },
    instruction::NameInstruction,
    name::validate_label,
    state::{
        decode_state, encode_state, AccountHeader, ArchAddress, BitcoinNetwork, RecordAccount,
        RecordType, RecordValue, RegistryConfig, NAME_ACCOUNT_DISCRIMINATOR,
        REGISTRY_CONFIG_DISCRIMINATOR,
    },
};
use arch_program::{
    account::AccountInfo,
    program::{invoke_signed_unchecked, next_account_info},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::minimum_rent,
    system_instruction,
};
use borsh::BorshDeserialize;

mod availability;
mod idl;
mod transition;
#[cfg(test)]
mod transition_tests;

const TESTNET_NAMESPACE: &str = ".arch";
const TESTNET_NETWORK_ID: u32 = 2;

#[cfg(feature = "entrypoint")]
arch_program::entrypoint!(process_instruction);

pub fn process_instruction<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> Result<(), ProgramError> {
    // Anchor/Satellite IDL account protocol (Create/Write/Resize/…). Must be
    // checked before Borsh NameInstruction decode so the 8-byte IDL selector
    // is not mistaken for a registry instruction.
    if let Some(result) = idl::try_process(program_id, accounts, instruction_data) {
        return result;
    }
    let instruction = NameInstruction::deserialize(&mut &instruction_data[..])
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    match instruction {
        NameInstruction::InitializeRegistry {
            network_id,
            namespace_authority,
        } => initialize_registry(program_id, accounts, network_id, namespace_authority),
        NameInstruction::Register { label, .. } => register(program_id, accounts, label),
        NameInstruction::Transfer {
            name_hash,
            new_owner,
        } => transfer(program_id, accounts, name_hash, new_owner),
        NameInstruction::SetRecord {
            name_hash,
            record_type,
            value,
            expected_revision,
        } => set_record(
            program_id,
            accounts,
            name_hash,
            record_type,
            value,
            expected_revision,
        ),
        NameInstruction::DeleteRecord {
            name_hash,
            record_type,
            text_key,
            expected_revision,
        } => delete_record(
            program_id,
            accounts,
            name_hash,
            record_type,
            text_key,
            expected_revision,
        ),
        NameInstruction::SetPrimary { name_hash } => set_primary(program_id, accounts, name_hash),
        NameInstruction::ClearPrimary => clear_primary(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize_registry(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    network_id: u32,
    namespace_authority: ArchAddress,
) -> Result<(), ProgramError> {
    if network_id != TESTNET_NETWORK_ID {
        return Err(ProgramError::InvalidInstructionData);
    }
    let iterator = &mut accounts.iter();
    let authority = next_account_info(iterator)?;
    let config = next_account_info(iterator)?;
    require_signer(authority)?;
    let expected = derive_config_address(program_id.serialize(), network_id, TESTNET_NAMESPACE);
    require_address(config, expected)?;
    let state = RegistryConfig {
        header: AccountHeader::initialized(REGISTRY_CONFIG_DISCRIMINATOR),
        program_version: 1,
        network_id,
        namespace: TESTNET_NAMESPACE.to_owned(),
        namespace_authority,
        grace_period_slots: 0,
        min_registration_slots: 0,
        max_registration_slots: 0,
        bitcoin_network: BitcoinNetwork::Testnet,
        token_programs: Vec::new(),
        paused: false,
        mainnet_enabled: false,
    };
    if authority.key.serialize() != state.namespace_authority {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let bytes = encode_state(&state);
    let network = network_id.to_le_bytes();
    let namespace = namespace_hash(TESTNET_NAMESPACE);
    let seeds = [
        b"ans:config:v1".as_slice(),
        network.as_slice(),
        namespace.as_slice(),
    ];
    // Fresh account: create at full encoded size with rent. Program-owned but
    // incomplete (e.g. prior zero-size create / rent failure): top up and write.
    if config.owner == program_id {
        if config_is_initialized(config) {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
    } else if config.data_is_empty() {
        create_pda(program_id, authority, config, accounts, &seeds, bytes.len())?;
    } else {
        return Err(ProgramError::IncorrectProgramId);
    }
    store(authority, config, &state)
}

fn register(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    label: String,
) -> Result<(), ProgramError> {
    validate_label(&label).map_err(|_| ProgramError::InvalidInstructionData)?;
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    require_signer(owner)?;
    let config = load_config(program_id, config_account)?;
    ensure_unpaused(&config)?;
    let name = transition::register(label, owner.key.serialize())
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    require_address(
        name_account,
        derive_name_address(program_id.serialize(), &config.namespace, name.name_hash),
    )?;
    let namespace = namespace_hash(TESTNET_NAMESPACE);
    let seeds = [
        b"ans:name:v1".as_slice(),
        namespace.as_slice(),
        name.name_hash.as_slice(),
    ];
    let bytes = encode_state(&name);
    // One PDA per canonical name. Initialized accounts are permanently taken on
    // testnet; only empty/zeroed incomplete creates may be resumed.
    if name_account.owner == program_id {
        match availability::ensure_program_owned_name_available(&name_account.data.borrow()) {
            Ok(()) => {}
            Err(ans_protocol::AnsError::NameTaken) => {
                return Err(ProgramError::AccountAlreadyInitialized);
            }
            Err(_) => return Err(ProgramError::InvalidAccountData),
        }
    } else if name_account.data_is_empty() {
        create_pda(program_id, owner, name_account, accounts, &seeds, bytes.len())?;
    } else {
        return Err(ProgramError::IncorrectProgramId);
    }
    store(owner, name_account, &name)
}

fn transfer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
    new_owner: ArchAddress,
) -> Result<(), ProgramError> {
    if new_owner == [0; 32] {
        return Err(ProgramError::InvalidInstructionData);
    }
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    require_signer(owner)?;
    let config = load_config(program_id, config_account)?;
    let mut name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(owner, &name.owner)?;
    transition::transfer(&mut name, new_owner);
    store(owner, name_account, &name)
}

fn set_record(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
    record_type: RecordType,
    value: RecordValue,
    expected_revision: u64,
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let record_account = next_account_info(iterator)?;
    require_signer(owner)?;
    let config = load_config(program_id, config_account)?;
    let name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(owner, &name.owner)?;
    let text_key_owned = value.text_key().map(str::to_owned);
    let text_key = text_key_owned.as_deref();
    if record_type == RecordType::Text && text_key.is_none() {
        return Err(ProgramError::InvalidInstructionData);
    }
    require_address(
        record_account,
        derive_record_address_for_value(
            program_id.serialize(),
            &config.namespace,
            name_hash,
            record_type,
            text_key,
        ),
    )?;
    let existing = if record_account.data_is_empty() {
        None
    } else {
        if record_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        Some(load::<RecordAccount>(record_account)?)
    };
    let record = transition::set_record(
        &config,
        &name,
        existing.as_ref(),
        record_type,
        value,
        expected_revision,
    )
    .map_err(|_| ProgramError::InvalidInstructionData)?;
    if existing.is_none() {
        let namespace = namespace_hash(TESTNET_NAMESPACE);
        let record_kind = [record_type as u8];
        let key_hash = text_key.map(record_key_hash);
        let bytes = encode_state(&record);
        if record_account.owner == program_id {
            // Resume a prior underfunded create.
        } else if record_account.data_is_empty() {
            if let Some(ref key_hash) = key_hash {
                let seeds = [
                    b"ans:record:v1".as_slice(),
                    namespace.as_slice(),
                    name_hash.as_slice(),
                    record_kind.as_slice(),
                    key_hash.as_slice(),
                ];
                create_pda(
                    program_id,
                    owner,
                    record_account,
                    accounts,
                    &seeds,
                    bytes.len(),
                )?;
            } else {
                let seeds = [
                    b"ans:record:v1".as_slice(),
                    namespace.as_slice(),
                    name_hash.as_slice(),
                    record_kind.as_slice(),
                ];
                create_pda(
                    program_id,
                    owner,
                    record_account,
                    accounts,
                    &seeds,
                    bytes.len(),
                )?;
            }
        } else {
            return Err(ProgramError::IncorrectProgramId);
        }
    }
    store(owner, record_account, &record)
}

fn delete_record(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
    record_type: RecordType,
    text_key: String,
    expected_revision: u64,
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let record_account = next_account_info(iterator)?;
    require_signer(owner)?;
    let config = load_config(program_id, config_account)?;
    let name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(owner, &name.owner)?;
    let key_opt = match record_type {
        RecordType::Text => {
            if text_key.is_empty() {
                return Err(ProgramError::InvalidInstructionData);
            }
            Some(text_key.as_str())
        }
        _ => {
            if !text_key.is_empty() {
                return Err(ProgramError::InvalidInstructionData);
            }
            None
        }
    };
    require_address(
        record_account,
        derive_record_address_for_value(
            program_id.serialize(),
            &config.namespace,
            name_hash,
            record_type,
            key_opt,
        ),
    )?;
    if record_account.owner != program_id || record_account.data_is_empty() {
        return Err(ProgramError::UninitializedAccount);
    }
    let existing = load::<RecordAccount>(record_account)?;
    if existing.revision != expected_revision
        || existing.record_type != record_type
        || existing.name_hash != name_hash
        || existing.owner_snapshot != name.owner
        || existing.record_epoch != name.record_epoch
    {
        return Err(ProgramError::InvalidAccountData);
    }
    if record_type == RecordType::Text && existing.value.text_key() != Some(text_key.as_str()) {
        return Err(ProgramError::InvalidAccountData);
    }
    record_account.realloc(0, false)
}

fn set_primary(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let reverse_account = next_account_info(iterator)?;
    require_signer(owner)?;
    let config = load_config(program_id, config_account)?;
    let mut name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(owner, &name.owner)?;
    require_address(
        reverse_account,
        derive_reverse_address(program_id.serialize(), &config.namespace, name.owner),
    )?;
    let reverse = transition::set_primary(&mut name);
    if reverse_account.owner == program_id {
        // Existing reverse PDA (or prior underfunded create).
    } else if reverse_account.data_is_empty() {
        let namespace = namespace_hash(TESTNET_NAMESPACE);
        let seeds = [
            b"ans:reverse:v1".as_slice(),
            namespace.as_slice(),
            name.owner.as_slice(),
        ];
        let bytes = encode_state(&reverse);
        create_pda(
            program_id,
            owner,
            reverse_account,
            accounts,
            &seeds,
            bytes.len(),
        )?;
    } else {
        return Err(ProgramError::IncorrectProgramId);
    }
    store(owner, name_account, &name)?;
    store(owner, reverse_account, &reverse)
}

fn clear_primary(program_id: &Pubkey, accounts: &[AccountInfo]) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let reverse_account = next_account_info(iterator)?;
    require_signer(owner)?;
    if reverse_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let reverse = load::<ans_protocol::ReverseAccount>(reverse_account)?;
    require_owner(owner, &reverse.owner)?;
    reverse_account.realloc(0, false)
}

fn load_config(program_id: &Pubkey, account: &AccountInfo) -> Result<RegistryConfig, ProgramError> {
    if account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let config = load::<RegistryConfig>(account)?;
    config
        .header
        .validate(REGISTRY_CONFIG_DISCRIMINATOR)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if config.namespace != TESTNET_NAMESPACE || config.network_id != TESTNET_NETWORK_ID {
        return Err(ProgramError::InvalidAccountData);
    }
    require_address(
        account,
        derive_config_address(program_id.serialize(), config.network_id, &config.namespace),
    )?;
    Ok(config)
}

fn load_name(
    program_id: &Pubkey,
    account: &AccountInfo,
    config: &RegistryConfig,
    name_hash: [u8; 32],
) -> Result<ans_protocol::NameAccount, ProgramError> {
    if account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let name = load::<ans_protocol::NameAccount>(account)?;
    name.header
        .validate(NAME_ACCOUNT_DISCRIMINATOR)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if name.name_hash != name_hash {
        return Err(ProgramError::InvalidAccountData);
    }
    require_address(
        account,
        derive_name_address(program_id.serialize(), &config.namespace, name_hash),
    )?;
    Ok(name)
}

fn create_pda(
    program_id: &Pubkey,
    payer: &AccountInfo,
    account: &AccountInfo,
    accounts: &[AccountInfo],
    seeds: &[&[u8]],
    space: usize,
) -> Result<(), ProgramError> {
    // Arch create_account CPIs require the PDA bump in the signer seeds,
    // matching Autara's global-config / market creation path. Allocate the
    // full encoded size up front so the account is rent-exempt without a
    // later underfunded realloc.
    let (expected, bump) = Pubkey::find_program_address(seeds, program_id);
    if account.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    let bump = [bump];
    let mut signer_seeds = seeds.to_vec();
    signer_seeds.push(&bump);
    invoke_signed_unchecked(
        &system_instruction::create_account(
            payer.key,
            account.key,
            minimum_rent(space),
            space as u64,
            program_id,
        ),
        accounts,
        &[&signer_seeds],
    )
}

fn fund_rent_exempt(payer: &AccountInfo, account: &AccountInfo, space: usize) -> Result<(), ProgramError> {
    let required = minimum_rent(space);
    let current = account.lamports();
    if current >= required {
        return Ok(());
    }
    let needed = required.saturating_sub(current);
    let mut payer_lamports = payer.try_borrow_mut_lamports()?;
    let mut account_lamports = account.try_borrow_mut_lamports()?;
    if **payer_lamports < needed {
        return Err(ProgramError::InsufficientFunds);
    }
    **payer_lamports -= needed;
    **account_lamports += needed;
    Ok(())
}

fn config_is_initialized(account: &AccountInfo) -> bool {
    load::<RegistryConfig>(account)
        .ok()
        .and_then(|config| {
            config
                .header
                .validate(REGISTRY_CONFIG_DISCRIMINATOR)
                .ok()
                .map(|_| true)
        })
        .unwrap_or(false)
}

fn load<T: BorshDeserialize>(account: &AccountInfo) -> Result<T, ProgramError> {
    if account.owner == &Pubkey::system_program() {
        return Err(ProgramError::UninitializedAccount);
    }
    decode_state(&account.data.borrow()).map_err(|_| ProgramError::InvalidAccountData)
}

fn store<T: borsh::BorshSerialize>(
    payer: &AccountInfo,
    account: &AccountInfo,
    state: &T,
) -> Result<(), ProgramError> {
    let bytes = encode_state(state);
    fund_rent_exempt(payer, account, bytes.len())?;
    if account.data_len() != bytes.len() {
        account.realloc(bytes.len(), false)?;
    }
    account.data.borrow_mut().copy_from_slice(&bytes);
    Ok(())
}

fn require_signer(account: &AccountInfo) -> Result<(), ProgramError> {
    if account.is_signer {
        Ok(())
    } else {
        Err(ProgramError::MissingRequiredSignature)
    }
}

fn require_owner(signer: &AccountInfo, owner: &ArchAddress) -> Result<(), ProgramError> {
    if signer.key.serialize() == *owner {
        Ok(())
    } else {
        Err(ProgramError::MissingRequiredSignature)
    }
}

fn require_address(account: &AccountInfo, expected: ArchAddress) -> Result<(), ProgramError> {
    if account.key.serialize() == expected {
        Ok(())
    } else {
        Err(ProgramError::InvalidSeeds)
    }
}

fn ensure_unpaused(config: &RegistryConfig) -> Result<(), ProgramError> {
    if config.paused {
        Err(ProgramError::Custom(1))
    } else {
        Ok(())
    }
}
