use std::str::FromStr;

use arch_program::pubkey::Pubkey;
use bitcoin::{address::NetworkUnchecked, Address, AddressType, Network};

use crate::{
    error::AnsError,
    state::{
        ArchAddress, BitcoinNetwork, NameAccount, RecordType, RecordValue, RegistryConfig,
        TokenProgramConfig,
    },
};

/// Max UTF-8 bytes for a Text record key (SNS-style short identifiers).
pub const MAX_TEXT_KEY_LEN: usize = 32;
/// Max UTF-8 bytes for a Text record value payload.
pub const MAX_TEXT_VALUE_LEN: usize = 256;

pub fn is_active(name: &NameAccount, current_slot: u64) -> bool {
    current_slot < name.expires_at_slot
}

pub fn parse_taproot_address(
    address: &str,
    network: BitcoinNetwork,
) -> Result<RecordValue, AnsError> {
    let unchecked = Address::<NetworkUnchecked>::from_str(address)
        .map_err(|_| AnsError::InvalidTaprootAddress)?;
    let checked = unchecked
        .require_network(bitcoin_network(network))
        .map_err(|_| AnsError::InvalidTaprootAddress)?;
    if checked.address_type() != Some(AddressType::P2tr) || checked.to_string() != address {
        return Err(AnsError::InvalidTaprootAddress);
    }

    let witness_program = checked
        .witness_program()
        .and_then(|program| (program.version() == bitcoin::WitnessVersion::V1).then_some(program))
        .map(|program| program.program().as_bytes().to_vec())
        .filter(|program| program.len() == 32)
        .ok_or(AnsError::InvalidTaprootAddress)?;

    let mut program = [0_u8; 32];
    program.copy_from_slice(&witness_program);
    Ok(RecordValue::BitcoinTaproot {
        witness_program: program,
    })
}

pub fn encode_taproot_address(
    witness_program: [u8; 32],
    network: BitcoinNetwork,
) -> Result<String, AnsError> {
    let program = bitcoin::WitnessProgram::new(bitcoin::WitnessVersion::V1, &witness_program)
        .map_err(|_| AnsError::InvalidTaprootAddress)?;
    Ok(Address::from_witness_program(program, bitcoin_network(network)).to_string())
}

/// Validates a Text record key: lowercase ASCII `[a-z0-9_-]{1,32}`.
pub fn validate_text_key(key: &str) -> Result<(), AnsError> {
    if key.is_empty() || key.len() > MAX_TEXT_KEY_LEN {
        return Err(AnsError::InvalidTextRecord);
    }
    if !key
        .bytes()
        .all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'))
    {
        return Err(AnsError::InvalidTextRecord);
    }
    Ok(())
}

pub fn validate_text_value(value: &str) -> Result<(), AnsError> {
    if value.is_empty() || value.len() > MAX_TEXT_VALUE_LEN {
        return Err(AnsError::InvalidTextRecord);
    }
    if !value.is_ascii() || value.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err(AnsError::InvalidTextRecord);
    }
    Ok(())
}

pub fn validate_record_value(
    config: &RegistryConfig,
    name: &NameAccount,
    record_type: RecordType,
    value: &RecordValue,
) -> Result<(), AnsError> {
    if value.record_type() != record_type {
        return Err(AnsError::RecordTypeMismatch);
    }
    if borsh::to_vec(value)
        .map_err(|_| AnsError::RecordValueTooLarge)?
        .len()
        > max_record_value_len(record_type)
    {
        return Err(AnsError::RecordValueTooLarge);
    }

    match value {
        RecordValue::ArchOwner(owner) if owner == &name.owner => Ok(()),
        RecordValue::ArchOwner(_) => Err(AnsError::OwnerRecordMismatch),
        RecordValue::BitcoinTaproot { witness_program } => {
            encode_taproot_address(*witness_program, config.bitcoin_network).map(|_| ())
        }
        RecordValue::TokenAta { token_id, ata } => {
            validate_token_ata(name.owner, *token_id, *ata, &config.token_programs)
        }
        RecordValue::Text { key, value } => {
            validate_text_key(key)?;
            validate_text_value(value)
        }
    }
}

pub const fn max_record_value_len(record_type: RecordType) -> usize {
    match record_type {
        RecordType::ArchOwner => 33,
        RecordType::BitcoinTaproot => 33,
        RecordType::TokenAta => 65,
        // Borsh: u8 tag + 2×(u32 len + payload); key≤32, value≤256 → 1+4+32+4+256
        RecordType::Text => 297,
    }
}

fn validate_token_ata(
    owner: ArchAddress,
    token_id: ArchAddress,
    ata: ArchAddress,
    configured_programs: &[TokenProgramConfig],
) -> Result<(), AnsError> {
    for programs in configured_programs {
        if derive_token_ata(owner, token_id, programs) == ata {
            return Ok(());
        }
    }
    Err(AnsError::InvalidTokenAta)
}

pub fn derive_token_ata(
    owner: ArchAddress,
    token_id: ArchAddress,
    programs: &TokenProgramConfig,
) -> ArchAddress {
    let token_program = Pubkey::new_from_array(programs.token_program_id);
    let ata_program = Pubkey::new_from_array(programs.associated_token_program_id);
    Pubkey::find_program_address(
        &[&owner, &token_program.serialize(), &token_id],
        &ata_program,
    )
    .0
    .serialize()
}

fn bitcoin_network(network: BitcoinNetwork) -> Network {
    match network {
        BitcoinNetwork::Mainnet => Network::Bitcoin,
        BitcoinNetwork::Testnet => Network::Testnet,
        BitcoinNetwork::Signet => Network::Signet,
        BitcoinNetwork::Regtest => Network::Regtest,
    }
}
