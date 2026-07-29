use arch_program::pubkey::Pubkey;
use sha2::{Digest, Sha256};

use crate::state::{ArchAddress, RecordType};

const CONFIG_SEED: &[u8] = b"ans:config:v1";
const NAME_SEED: &[u8] = b"ans:name:v1";
const RECORD_SEED: &[u8] = b"ans:record:v1";
const REVERSE_SEED: &[u8] = b"ans:reverse:v1";
const NAMESPACE_DOMAIN: &[u8] = b"arch-name-service:namespace:v1\0";
const RECORD_KEY_DOMAIN: &[u8] = b"arch-name-service:record-key:v1\0";

pub fn namespace_hash(namespace: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(NAMESPACE_DOMAIN);
    hasher.update(namespace.as_bytes());
    hasher.finalize().into()
}

/// Domain-separated hash of a Text record key for PDA seeds.
pub fn record_key_hash(key: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(RECORD_KEY_DOMAIN);
    hasher.update(key.as_bytes());
    hasher.finalize().into()
}

pub fn derive_config_address(
    program_id: ArchAddress,
    network_id: u32,
    namespace: &str,
) -> ArchAddress {
    derive(
        program_id,
        &[
            CONFIG_SEED,
            &network_id.to_le_bytes(),
            &namespace_hash(namespace),
        ],
    )
}

pub fn derive_name_address(
    program_id: ArchAddress,
    namespace: &str,
    name_hash: [u8; 32],
) -> ArchAddress {
    derive(
        program_id,
        &[NAME_SEED, &namespace_hash(namespace), &name_hash],
    )
}

/// Derives a typed record PDA (`ArchOwner` / `BitcoinTaproot` / `TokenAta`).
/// For `Text` records use [`derive_text_record_address`]. Typed PDAs stay
/// byte-identical to program version 1 so live names are not orphaned.
pub fn derive_record_address(
    program_id: ArchAddress,
    namespace: &str,
    name_hash: [u8; 32],
    record_type: RecordType,
) -> ArchAddress {
    debug_assert!(
        record_type != RecordType::Text,
        "Text records require derive_text_record_address"
    );
    derive(
        program_id,
        &[
            RECORD_SEED,
            &namespace_hash(namespace),
            &name_hash,
            &[record_type as u8],
        ],
    )
}

/// Derives a Text record PDA for `(name_hash, key)`. Existing typed-record
/// addresses are unchanged; only the new `Text` discriminant + key hash seed
/// are added.
pub fn derive_text_record_address(
    program_id: ArchAddress,
    namespace: &str,
    name_hash: [u8; 32],
    key: &str,
) -> ArchAddress {
    let key_hash = record_key_hash(key);
    derive(
        program_id,
        &[
            RECORD_SEED,
            &namespace_hash(namespace),
            &name_hash,
            &[RecordType::Text as u8],
            &key_hash,
        ],
    )
}

pub fn derive_record_address_for_value(
    program_id: ArchAddress,
    namespace: &str,
    name_hash: [u8; 32],
    record_type: RecordType,
    text_key: Option<&str>,
) -> ArchAddress {
    match record_type {
        RecordType::Text => derive_text_record_address(
            program_id,
            namespace,
            name_hash,
            text_key.expect("Text record requires a key"),
        ),
        _ => derive_record_address(program_id, namespace, name_hash, record_type),
    }
}

pub fn derive_reverse_address(
    program_id: ArchAddress,
    namespace: &str,
    owner: ArchAddress,
) -> ArchAddress {
    derive(
        program_id,
        &[REVERSE_SEED, &namespace_hash(namespace), &owner],
    )
}

fn derive(program_id: ArchAddress, seeds: &[&[u8]]) -> ArchAddress {
    let program_id = Pubkey::new_from_array(program_id);
    Pubkey::find_program_address(seeds, &program_id)
        .0
        .serialize()
}
