use borsh::{BorshDeserialize, BorshSerialize};

use crate::error::AnsError;

pub const STATE_VERSION: u16 = 1;
pub const REGISTRY_CONFIG_DISCRIMINATOR: [u8; 8] = *b"ANSCFG01";
pub const NAME_ACCOUNT_DISCRIMINATOR: [u8; 8] = *b"ANSNAME1";
pub const RECORD_ACCOUNT_DISCRIMINATOR: [u8; 8] = *b"ANSRECR1";
pub const REVERSE_ACCOUNT_DISCRIMINATOR: [u8; 8] = *b"ANSREVR1";

pub type ArchAddress = [u8; 32];

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct AccountHeader {
    pub discriminator: [u8; 8],
    pub initialized: bool,
    pub state_version: u16,
}

impl AccountHeader {
    pub const fn initialized(discriminator: [u8; 8]) -> Self {
        Self {
            discriminator,
            initialized: true,
            state_version: STATE_VERSION,
        }
    }

    pub fn validate(&self, discriminator: [u8; 8]) -> Result<(), AnsError> {
        if self.discriminator != discriminator {
            return Err(AnsError::InvalidDiscriminator);
        }
        if !self.initialized || self.state_version != STATE_VERSION {
            return Err(AnsError::UnsupportedAccountVersion);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum BitcoinNetwork {
    Mainnet,
    Testnet,
    Signet,
    Regtest,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct TokenProgramConfig {
    pub token_program_id: ArchAddress,
    pub associated_token_program_id: ArchAddress,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct RegistryConfig {
    pub header: AccountHeader,
    pub program_version: u16,
    pub network_id: u32,
    pub namespace: String,
    /// Testnet-only authority that initializes the dedicated `.arch` namespace.
    /// It has no per-name authority and cannot transfer or mutate registrations.
    pub namespace_authority: ArchAddress,
    pub grace_period_slots: u64,
    pub min_registration_slots: u64,
    pub max_registration_slots: u64,
    pub bitcoin_network: BitcoinNetwork,
    pub token_programs: Vec<TokenProgramConfig>,
    pub paused: bool,
    pub mainnet_enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct NameAccount {
    pub header: AccountHeader,
    pub name_hash: [u8; 32],
    pub canonical_label: String,
    pub owner: ArchAddress,
    pub registered_at_slot: u64,
    pub expires_at_slot: u64,
    pub record_epoch: u64,
    pub primary_binding_nonce: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum RecordType {
    ArchOwner,
    BitcoinTaproot,
    TokenAta,
    /// Extensible UTF-8 profile / payment / content record (SNS-parity catalog).
    /// PDA seeds include a domain-separated hash of the record key so many
    /// Text rows can exist per name without growing this enum forever.
    Text,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum RecordValue {
    ArchOwner(ArchAddress),
    BitcoinTaproot {
        witness_program: [u8; 32],
    },
    TokenAta {
        token_id: ArchAddress,
        ata: ArchAddress,
    },
    Text {
        key: String,
        value: String,
    },
}

impl RecordValue {
    pub fn record_type(&self) -> RecordType {
        match self {
            Self::ArchOwner(_) => RecordType::ArchOwner,
            Self::BitcoinTaproot { .. } => RecordType::BitcoinTaproot,
            Self::TokenAta { .. } => RecordType::TokenAta,
            Self::Text { .. } => RecordType::Text,
        }
    }

    pub fn text_key(&self) -> Option<&str> {
        match self {
            Self::Text { key, .. } => Some(key.as_str()),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct RecordAccount {
    pub header: AccountHeader,
    pub name_hash: [u8; 32],
    pub record_type: RecordType,
    pub owner_snapshot: ArchAddress,
    pub record_epoch: u64,
    pub revision: u64,
    pub value: RecordValue,
    pub updated_at_slot: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct ReverseAccount {
    pub header: AccountHeader,
    pub owner: ArchAddress,
    pub primary_name_hash: [u8; 32],
    pub binding_nonce: u64,
    pub updated_at_slot: u64,
}

pub fn encode_state<T: BorshSerialize>(state: &T) -> Vec<u8> {
    borsh::to_vec(state).expect("Borsh serialization to Vec cannot fail")
}

pub fn decode_state<T: BorshDeserialize>(bytes: &[u8]) -> Result<T, std::io::Error> {
    borsh::from_slice(bytes)
}
