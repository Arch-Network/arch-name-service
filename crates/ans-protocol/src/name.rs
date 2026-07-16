use sha2::{Digest, Sha256};

use crate::error::AnsError;

pub const ARCH_SUFFIX: &str = ".arch";
pub const NAME_HASH_DOMAIN: &[u8] = b"arch-name-service:name-hash:v1\0";

pub fn canonicalize_name(input: &str) -> Result<String, AnsError> {
    let label = input
        .strip_suffix(ARCH_SUFFIX)
        .ok_or(AnsError::InvalidSuffix)?;
    validate_label(label)?;
    Ok(format!("{label}{ARCH_SUFFIX}"))
}

pub fn validate_label(label: &str) -> Result<(), AnsError> {
    if !(1..=63).contains(&label.len()) {
        return Err(AnsError::InvalidLabelLength);
    }
    if label.starts_with('-') || label.ends_with('-') || label.contains("--") {
        return Err(AnsError::InvalidHyphenPlacement);
    }
    if !label
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(AnsError::InvalidLabelCharacter);
    }
    Ok(())
}

pub fn name_hash(canonical_name: &str) -> Result<[u8; 32], AnsError> {
    let canonical_name = canonicalize_name(canonical_name)?;
    let mut hasher = Sha256::new();
    hasher.update(NAME_HASH_DOMAIN);
    hasher.update(canonical_name.as_bytes());
    Ok(hasher.finalize().into())
}
