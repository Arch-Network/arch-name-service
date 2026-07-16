use arch_program::pubkey::Pubkey;
use sha2::{Digest, Sha256};

use crate::state::{ArchAddress, RecordType};

const CONFIG_SEED: &[u8] = b"ans:config:v1";
const NAME_SEED: &[u8] = b"ans:name:v1";
const RECORD_SEED: &[u8] = b"ans:record:v1";
const REVERSE_SEED: &[u8] = b"ans:reverse:v1";
const NAMESPACE_DOMAIN: &[u8] = b"arch-name-service:namespace:v1\0";

pub fn namespace_hash(namespace: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(NAMESPACE_DOMAIN);
    hasher.update(namespace.as_bytes());
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

pub fn derive_record_address(
    program_id: ArchAddress,
    namespace: &str,
    name_hash: [u8; 32],
    record_type: RecordType,
) -> ArchAddress {
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
