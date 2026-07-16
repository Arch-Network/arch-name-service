//! Minimal permanent-registration registry for the ANS testnet alpha.

use ans_protocol::{
    derive::{
        derive_config_address, derive_name_address, derive_record_address, derive_reverse_address,
        namespace_hash,
    },
    instruction::NameInstruction,
    name::validate_label,
    state::{
        decode_state, encode_state, AccountHeader, ArchAddress, BitcoinNetwork, RecordAccount,
        RegistryConfig, NAME_ACCOUNT_DISCRIMINATOR, REGISTRY_CONFIG_DISCRIMINATOR,
    },
    RecordType,
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
    if !config.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
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
    let network = network_id.to_le_bytes();
    let namespace = namespace_hash(TESTNET_NAMESPACE);
    let seeds = [
        b"ans:config:v1".as_slice(),
        network.as_slice(),
        namespace.as_slice(),
    ];
    create_pda(program_id, authority, config, accounts, &seeds)?;
    store(config, &state)
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
    if !name_account.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let namespace = namespace_hash(TESTNET_NAMESPACE);
    let seeds = [
        b"ans:name:v1".as_slice(),
        namespace.as_slice(),
        name.name_hash.as_slice(),
    ];
    create_pda(program_id, owner, name_account, accounts, &seeds)?;
    store(name_account, &name)
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
    store(name_account, &name)
}

fn set_record(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
    record_type: RecordType,
    value: ans_protocol::RecordValue,
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
    require_address(
        record_account,
        derive_record_address(
            program_id.serialize(),
            &config.namespace,
            name_hash,
            record_type,
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
        let seeds = [
            b"ans:record:v1".as_slice(),
            namespace.as_slice(),
            name_hash.as_slice(),
            record_kind.as_slice(),
        ];
        create_pda(program_id, owner, record_account, accounts, &seeds)?;
    }
    store(record_account, &record)
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
    if reverse_account.data_is_empty() {
        let namespace = namespace_hash(TESTNET_NAMESPACE);
        let seeds = [
            b"ans:reverse:v1".as_slice(),
            namespace.as_slice(),
            name.owner.as_slice(),
        ];
        create_pda(program_id, owner, reverse_account, accounts, &seeds)?;
    } else if reverse_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    store(name_account, &name)?;
    store(reverse_account, &reverse)
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
) -> Result<(), ProgramError> {
    invoke_signed_unchecked(
        &system_instruction::create_account(payer.key, account.key, minimum_rent(0), 0, program_id),
        accounts,
        &[seeds],
    )
}

fn load<T: BorshDeserialize>(account: &AccountInfo) -> Result<T, ProgramError> {
    if account.owner == &Pubkey::system_program() {
        return Err(ProgramError::UninitializedAccount);
    }
    decode_state(&account.data.borrow()).map_err(|_| ProgramError::InvalidAccountData)
}

fn store<T: borsh::BorshSerialize>(account: &AccountInfo, state: &T) -> Result<(), ProgramError> {
    let bytes = encode_state(state);
    account.realloc(bytes.len(), false)?;
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
