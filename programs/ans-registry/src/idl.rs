//! Minimal Anchor/Satellite-compatible on-chain IDL account handlers.
//!
//! Arch Explorer indexes IDLs from the canonical `anchor:idl` account owned by
//! the program. Satellite programs get these handlers for free; ANS is a native
//! `arch_program` so we implement the same instruction protocol here.
//!
//! Selector prefix: `sha256("anchor:idl")[..8]` LE = `40 f4 bc 78 a7 e9 69 0a`.
//! Account layout: `[8 disc][32 authority][4 data_len LE][zlib JSON…]`.

use arch_program::{
    account::AccountInfo,
    program::{invoke_signed_unchecked, next_account_info},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::minimum_rent,
    system_instruction,
};

/// `sha256("anchor:idl")[..8]` little-endian.
const IDL_IX_TAG_LE: [u8; 8] = [0x40, 0xf4, 0xbc, 0x78, 0xa7, 0xe9, 0x69, 0x0a];

/// `sha256("internal:IdlAccount")[..8]` — Satellite `#[account("internal")]`.
const IDL_ACCOUNT_DISC: [u8; 8] = [24, 70, 98, 191, 58, 144, 123, 158];

const IDL_SEED: &str = "anchor:idl";
const IDL_HEADER_LEN: usize = 8 + 32 + 4;
const IDL_CREATE_MAX_SPACE: usize = 10_000;
const ERASED_AUTHORITY: [u8; 32] = [0u8; 32];

const TAG_CREATE: u8 = 0;
const TAG_CREATE_BUFFER: u8 = 1;
const TAG_WRITE: u8 = 2;
const TAG_SET_BUFFER: u8 = 3;
const TAG_SET_AUTHORITY: u8 = 4;
const TAG_CLOSE: u8 = 5;
const TAG_RESIZE: u8 = 6;

/// Returns `Some` when `data` is an IDL instruction; otherwise `None`.
pub fn try_process<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    data: &[u8],
) -> Option<Result<(), ProgramError>> {
    if data.len() < 9 || data[..8] != IDL_IX_TAG_LE {
        return None;
    }
    Some(process(program_id, accounts, &data[8..]))
}

fn process<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    data: &[u8],
) -> Result<(), ProgramError> {
    let tag = *data.first().ok_or(ProgramError::InvalidInstructionData)?;
    let rest = &data[1..];
    match tag {
        TAG_CREATE => {
            let data_len = read_u64(rest)?;
            create_account(program_id, accounts, data_len)
        }
        TAG_CREATE_BUFFER => create_buffer(program_id, accounts),
        TAG_WRITE => {
            let chunk = read_vec(rest)?;
            write(program_id, accounts, chunk)
        }
        TAG_SET_BUFFER => set_buffer(program_id, accounts),
        TAG_SET_AUTHORITY => {
            let new_authority = read_pubkey(rest)?;
            set_authority(program_id, accounts, new_authority)
        }
        TAG_CLOSE => close(program_id, accounts),
        TAG_RESIZE => {
            let data_len = read_u64(rest)?;
            resize(program_id, accounts, data_len)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn create_account<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    data_len: u64,
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let from = next_account_info(iterator)?;
    let to = next_account_info(iterator)?;
    let base = next_account_info(iterator)?;
    let system_program = next_account_info(iterator)?;
    let program = next_account_info(iterator)?;

    if !from.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if program.key != program_id || !program.is_executable {
        return Err(ProgramError::IncorrectProgramId);
    }
    if system_program.key != &Pubkey::system_program() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let (expected_base, bump) = Pubkey::find_program_address(&[], program_id);
    if base.key != &expected_base {
        return Err(ProgramError::InvalidSeeds);
    }
    let expected_to = Pubkey::create_with_seed(&expected_base, IDL_SEED, program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;
    if to.key != &expected_to {
        return Err(ProgramError::InvalidSeeds);
    }

    let space = (IDL_HEADER_LEN + data_len as usize).min(IDL_CREATE_MAX_SPACE);
    let lamports = minimum_rent(space);
    let bump_seed = [bump];
    let signer_seeds: &[&[u8]] = &[&bump_seed];
    invoke_signed_unchecked(
        &system_instruction::create_account_with_seed(
            from.key,
            to.key,
            base.key,
            IDL_SEED,
            lamports,
            space as u64,
            program_id,
        ),
        accounts,
        &[signer_seeds],
    )?;

    write_header(to, from.key.serialize(), 0)?;
    Ok(())
}

fn create_buffer<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let buffer = next_account_info(iterator)?;
    let authority = next_account_info(iterator)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if authority.key.serialize() == ERASED_AUTHORITY {
        return Err(ProgramError::InvalidArgument);
    }
    if buffer.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    if buffer.data_len() < IDL_HEADER_LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }
    // Must be uninitialized (zeroed) before CreateBuffer.
    if buffer.data.borrow()[..8] != [0u8; 8] {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    write_header(buffer, authority.key.serialize(), 0)?;
    Ok(())
}

fn write<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    chunk: &[u8],
) -> Result<(), ProgramError> {
    let (idl, authority) = idl_authority_accounts(program_id, accounts)?;
    let mut data = idl.try_borrow_mut_data()?;
    let prev_len = read_data_len(&data)? as usize;
    let new_len = prev_len
        .checked_add(chunk.len())
        .ok_or(ProgramError::InvalidInstructionData)?;
    let end = IDL_HEADER_LEN
        .checked_add(new_len)
        .ok_or(ProgramError::InvalidInstructionData)?;
    if end > data.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[IDL_HEADER_LEN + prev_len..end].copy_from_slice(chunk);
    write_data_len(&mut data, new_len as u32)?;
    let _ = authority;
    Ok(())
}

fn set_buffer<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let buffer = next_account_info(iterator)?;
    let idl = next_account_info(iterator)?;
    let authority = next_account_info(iterator)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    require_idl_account(program_id, buffer)?;
    require_idl_account(program_id, idl)?;
    require_authority(buffer, authority)?;
    require_authority(idl, authority)?;

    let buffer_data = buffer.try_borrow_data()?;
    let idl_len = read_data_len(&buffer_data)? as usize;
    let needed = IDL_HEADER_LEN
        .checked_add(idl_len)
        .ok_or(ProgramError::InvalidInstructionData)?;
    drop(buffer_data);

    let mut idl_data = idl.try_borrow_mut_data()?;
    if idl_data.len() < needed {
        return Err(ProgramError::AccountDataTooSmall);
    }
    let buffer_data = buffer.try_borrow_data()?;
    idl_data[IDL_HEADER_LEN..needed]
        .copy_from_slice(&buffer_data[IDL_HEADER_LEN..needed]);
    write_data_len(&mut idl_data, idl_len as u32)?;
    Ok(())
}

fn set_authority<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    new_authority: [u8; 32],
) -> Result<(), ProgramError> {
    let (idl, _authority) = idl_authority_accounts(program_id, accounts)?;
    let mut data = idl.try_borrow_mut_data()?;
    data[8..40].copy_from_slice(&new_authority);
    Ok(())
}

fn close<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let account = next_account_info(iterator)?;
    let authority = next_account_info(iterator)?;
    let destination = next_account_info(iterator)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    require_idl_account(program_id, account)?;
    require_authority(account, authority)?;
    if !destination.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let lamports = account.lamports();
    **account.try_borrow_mut_lamports()? = 0;
    **destination.try_borrow_mut_lamports()? = destination
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::InsufficientFunds)?;
    account.realloc(0, false)?;
    Ok(())
}

fn resize<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    data_len: u64,
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let idl = next_account_info(iterator)?;
    let authority = next_account_info(iterator)?;
    let system_program = next_account_info(iterator)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system_program.key != &Pubkey::system_program() {
        return Err(ProgramError::IncorrectProgramId);
    }
    require_idl_account(program_id, idl)?;
    require_authority(idl, authority)?;

    let data = idl.try_borrow_data()?;
    if read_data_len(&data)? != 0 {
        // Refuse to grow an account that already holds IDL bytes.
        return Err(ProgramError::InvalidAccountData);
    }
    drop(data);

    let target = data_len as usize;
    let current = idl.data_len();
    if target <= current {
        return Ok(());
    }
    let grow_by = (target - current).min(IDL_CREATE_MAX_SPACE);
    let new_space = current
        .checked_add(grow_by)
        .ok_or(ProgramError::InvalidInstructionData)?;
    // Cap this call at `target` when the remaining delta is smaller than the
    // 10kb step (matches Satellite's Resize semantics).
    let new_space = new_space.min(target);

    let required = minimum_rent(new_space);
    let current_lamports = idl.lamports();
    if required > current_lamports {
        let needed = required - current_lamports;
        let mut payer = authority.try_borrow_mut_lamports()?;
        let mut account = idl.try_borrow_mut_lamports()?;
        if **payer < needed {
            return Err(ProgramError::InsufficientFunds);
        }
        **payer -= needed;
        **account += needed;
    }
    idl.realloc(new_space, false)?;
    Ok(())
}

fn idl_authority_accounts<'a, 'b>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'b>],
) -> Result<(&'a AccountInfo<'b>, &'a AccountInfo<'b>), ProgramError> {
    let iterator = &mut accounts.iter();
    let idl = next_account_info(iterator)?;
    let authority = next_account_info(iterator)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    require_idl_account(program_id, idl)?;
    require_authority(idl, authority)?;
    Ok((idl, authority))
}

fn require_idl_account(program_id: &Pubkey, account: &AccountInfo) -> Result<(), ProgramError> {
    if account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    if account.data_len() < IDL_HEADER_LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }
    let data = account.try_borrow_data()?;
    if data[..8] != IDL_ACCOUNT_DISC {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn require_authority(idl: &AccountInfo, authority: &AccountInfo) -> Result<(), ProgramError> {
    let data = idl.try_borrow_data()?;
    let stored = &data[8..40];
    if stored == ERASED_AUTHORITY || stored != authority.key.serialize() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn write_header(account: &AccountInfo, authority: [u8; 32], data_len: u32) -> Result<(), ProgramError> {
    if account.data_len() < IDL_HEADER_LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }
    let mut data = account.try_borrow_mut_data()?;
    data[..8].copy_from_slice(&IDL_ACCOUNT_DISC);
    data[8..40].copy_from_slice(&authority);
    data[40..44].copy_from_slice(&data_len.to_le_bytes());
    Ok(())
}

fn read_data_len(data: &[u8]) -> Result<u32, ProgramError> {
    if data.len() < IDL_HEADER_LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }
    Ok(u32::from_le_bytes(data[40..44].try_into().unwrap()))
}

fn write_data_len(data: &mut [u8], data_len: u32) -> Result<(), ProgramError> {
    if data.len() < IDL_HEADER_LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[40..44].copy_from_slice(&data_len.to_le_bytes());
    Ok(())
}

fn read_u64(data: &[u8]) -> Result<u64, ProgramError> {
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(u64::from_le_bytes(data[..8].try_into().unwrap()))
}

fn read_pubkey(data: &[u8]) -> Result<[u8; 32], ProgramError> {
    if data.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&data[..32]);
    Ok(out)
}

fn read_vec(data: &[u8]) -> Result<&[u8], ProgramError> {
    if data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let len = u32::from_le_bytes(data[..4].try_into().unwrap()) as usize;
    if data.len() < 4 + len {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(&data[4..4 + len])
}
