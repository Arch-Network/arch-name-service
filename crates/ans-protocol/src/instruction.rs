use borsh::{BorshDeserialize, BorshSerialize};

use crate::state::{ArchAddress, QuoteCurrency, RecordType, RecordValue};

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
        /// Required when `record_type` is `Text`; empty for typed records.
        text_key: String,
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
    /// Create a fixed-price listing. Seller remains name owner; an active
    /// listing blocks ordinary `Transfer` until cancel or buy.
    ListName {
        name_hash: [u8; 32],
        currency: QuoteCurrency,
        price: u64,
    },
    /// Seller cancels an active listing.
    CancelListing {
        name_hash: [u8; 32],
    },
    /// Buyer purchases an active listing. Payment asset is taken from the
    /// listing currency (ARCH lamports or aBTC token transfer).
    BuyName {
        name_hash: [u8; 32],
    },
    /// Buyer places a fixed-price offer (ARCH lamports escrowed in the offer PDA).
    MakeOffer {
        name_hash: [u8; 32],
        currency: QuoteCurrency,
        price: u64,
    },
    /// Buyer cancels their active offer (refunds ARCH escrow when applicable).
    CancelOffer {
        name_hash: [u8; 32],
    },
    /// Seller accepts a buyer's active offer and transfers the name.
    AcceptOffer {
        name_hash: [u8; 32],
        buyer: ArchAddress,
    },
}
