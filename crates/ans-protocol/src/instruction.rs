use borsh::{BorshDeserialize, BorshSerialize};

use crate::state::{ArchAddress, RecordType, RecordValue};

/// Borsh instruction payloads for the future Arch program. Authorization and
/// account ordering are intentionally enforced by the program implementation,
/// not by this portable codec crate.
#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum NameInstruction {
    /// Initializes the one testnet `.arch` registry configuration. The
    /// namespace authority is dedicated to this initialization only.
    InitializeRegistry {
        network_id: u32,
        namespace_authority: ArchAddress,
    },
    Register {
        label: String,
        duration_slots: u64,
    },
    Renew {
        name_hash: [u8; 32],
        duration_slots: u64,
    },
    Transfer {
        name_hash: [u8; 32],
        new_owner: ArchAddress,
    },
    SetRecord {
        name_hash: [u8; 32],
        record_type: RecordType,
        value: RecordValue,
        expected_revision: u64,
    },
    DeleteRecord {
        name_hash: [u8; 32],
        record_type: RecordType,
        expected_revision: u64,
    },
    SetPrimary {
        name_hash: [u8; 32],
    },
    ClearPrimary,
    ReclaimExpired {
        label: String,
        duration_slots: u64,
    },
    UpdateConfig {
        paused: Option<bool>,
        grace_period_slots: Option<u64>,
    },
}
