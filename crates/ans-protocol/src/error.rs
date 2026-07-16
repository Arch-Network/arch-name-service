use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AnsError {
    #[error("name must use the .arch suffix")]
    InvalidSuffix,
    #[error("name label must be 1 to 63 bytes")]
    InvalidLabelLength,
    #[error("name label contains an invalid character")]
    InvalidLabelCharacter,
    #[error("name label cannot start, end, or contain consecutive hyphens")]
    InvalidHyphenPlacement,
    #[error("account discriminator is invalid")]
    InvalidDiscriminator,
    #[error("account is not initialized or has an unsupported state version")]
    UnsupportedAccountVersion,
    #[error("account address does not match its deterministic derivation")]
    InvalidAccountDerivation,
    #[error("name account does not match the requested name")]
    NameMismatch,
    #[error("name is not active at the supplied slot")]
    InactiveName,
    #[error("record does not match the active name state")]
    StaleRecord,
    #[error("record type and value disagree")]
    RecordTypeMismatch,
    #[error("Arch owner record must equal the name owner")]
    OwnerRecordMismatch,
    #[error("Bitcoin address is not a canonical Taproot address for this network")]
    InvalidTaprootAddress,
    #[error("token account is not the configured canonical ATA")]
    InvalidTokenAta,
    #[error("record value exceeds its type-specific maximum")]
    RecordValueTooLarge,
    #[error("reverse account does not point to the active owner and name")]
    InvalidReverseBinding,
}
