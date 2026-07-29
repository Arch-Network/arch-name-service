//! Registration availability checks for name PDAs.
//!
//! A canonical `.arch` name maps to exactly one PDA. Once that account holds an
//! initialized `NameAccount`, further `Register` calls must fail. Incomplete
//! creates (empty or zeroed program-owned data) may be resumed; any other
//! non-blank payload is rejected fail-closed so a taken name cannot be
//! overwritten through a decode quirk.

use ans_protocol::{
    state::{decode_state, NameAccount, NAME_ACCOUNT_DISCRIMINATOR},
    AnsError,
};

/// Whether raw account bytes decode as an initialized ANS name account.
pub fn is_initialized_name_account(data: &[u8]) -> bool {
    decode_state::<NameAccount>(data)
        .ok()
        .and_then(|existing| {
            existing
                .header
                .validate(NAME_ACCOUNT_DISCRIMINATOR)
                .ok()
                .map(|_| true)
        })
        .unwrap_or(false)
}

/// True when the account has no bytes, or only zero bytes left by a full-size
/// `create_account` that never reached `store`.
pub fn is_resumable_name_account_data(data: &[u8]) -> bool {
    data.is_empty() || data.iter().all(|&byte| byte == 0)
}

/// Gate for writing a new registration into a program-owned name PDA.
pub fn ensure_program_owned_name_available(data: &[u8]) -> Result<(), AnsError> {
    if is_initialized_name_account(data) {
        return Err(AnsError::NameTaken);
    }
    if is_resumable_name_account_data(data) {
        return Ok(());
    }
    // Non-blank, non-initialized junk: refuse to clobber rather than treat as
    // an open registration slot.
    Err(AnsError::UnsupportedAccountVersion)
}

#[cfg(test)]
mod tests {
    use ans_protocol::state::{encode_state, AccountHeader, NAME_ACCOUNT_DISCRIMINATOR};

    use super::*;
    use crate::transition::{register, PERMANENT_EXPIRY};

    #[test]
    fn initialized_name_account_is_taken() {
        let name = register("alice".to_owned(), [2; 32]).unwrap();
        let bytes = encode_state(&name);
        assert!(is_initialized_name_account(&bytes));
        assert_eq!(
            ensure_program_owned_name_available(&bytes),
            Err(AnsError::NameTaken)
        );
    }

    #[test]
    fn empty_and_zeroed_accounts_are_resumable() {
        assert_eq!(ensure_program_owned_name_available(&[]), Ok(()));
        assert_eq!(ensure_program_owned_name_available(&[0; 64]), Ok(()));
        assert!(is_resumable_name_account_data(&[]));
        assert!(is_resumable_name_account_data(&[0; 64]));
    }

    #[test]
    fn non_blank_junk_is_not_treated_as_available() {
        let junk = vec![1u8; 32];
        assert!(!is_initialized_name_account(&junk));
        assert_eq!(
            ensure_program_owned_name_available(&junk),
            Err(AnsError::UnsupportedAccountVersion)
        );
    }

    #[test]
    fn uninitialized_header_does_not_count_as_taken() {
        let mut name = register("bob".to_owned(), [9; 32]).unwrap();
        name.header = AccountHeader {
            discriminator: NAME_ACCOUNT_DISCRIMINATOR,
            initialized: false,
            state_version: 1,
        };
        name.expires_at_slot = PERMANENT_EXPIRY;
        let bytes = encode_state(&name);
        // Decodes, but header.validate fails → not taken; also non-blank → rejected.
        assert!(!is_initialized_name_account(&bytes));
        assert_eq!(
            ensure_program_owned_name_available(&bytes),
            Err(AnsError::UnsupportedAccountVersion)
        );
    }
}
