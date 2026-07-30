//! Protocol foundations for Arch Name Service.
//!
//! This crate is pure and deterministic: an SDK, indexer, or future on-chain
//! program can use the same codecs, derivations, and resolution predicates.
//! It neither performs RPC requests nor authorizes state transitions.

pub mod derive;
pub mod error;
pub mod instruction;
pub mod name;
pub mod resolve;
pub mod state;
pub mod validate;

pub use error::AnsError;
pub use instruction::NameInstruction;
pub use resolve::{resolve_owner, resolve_primary, resolve_record, AccountAt};
pub use state::{
    ArchAddress, BitcoinNetwork, ListingAccount, NameAccount, OfferAccount, QuoteCurrency,
    RecordAccount, RecordType, RecordValue, RegistryConfig, ReverseAccount,
};
