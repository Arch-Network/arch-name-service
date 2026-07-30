//! Minimal permanent-registration registry for the ANS testnet alpha.

use ans_protocol::{
    derive::{
        derive_config_address, derive_listing_address, derive_name_address, derive_offer_address,
        derive_record_address_for_value, derive_reverse_address, namespace_hash, record_key_hash,
    },
    instruction::NameInstruction,
    name::validate_label,
    state::{
        decode_state, encode_state, AccountHeader, ArchAddress, BitcoinNetwork, ListingAccount,
        OfferAccount, QuoteCurrency, RecordAccount, RecordType, RecordValue, RegistryConfig,
        LISTING_ACCOUNT_DISCRIMINATOR, NAME_ACCOUNT_DISCRIMINATOR, OFFER_ACCOUNT_DISCRIMINATOR,
        REGISTRY_CONFIG_DISCRIMINATOR,
    },
};
use arch_program::{
    account::{AccountInfo, AccountMeta},
    instruction::Instruction,
    program::{invoke, invoke_signed_unchecked, next_account_info},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::minimum_rent,
    system_instruction,
};
use borsh::BorshDeserialize;

mod availability;
mod idl;
mod marketplace;
mod transition;
#[cfg(test)]
mod transition_tests;

const TESTNET_NAMESPACE: &str = ".arch";
const TESTNET_NETWORK_ID: u32 = 2;
/// Arch Token program (`TokenT4em53UrV4gSvZ3nCS2mZeHaqTLapwt6iZt6Mk`).
const TOKEN_PROGRAM_ID_BYTES: [u8; 32] = [
    6, 221, 246, 225, 185, 234, 132, 65, 44, 16, 184, 223, 2, 28, 16, 15, 200, 135, 25, 7, 195, 9,
    195, 53, 53, 222, 32, 156, 52, 23, 99, 191,
];
/// Testnet aBTC mint (Arch Bitcoin, 8 decimals).
const TESTNET_ABTC_MINT: [u8; 32] = [
    0x72, 0x61, 0x79, 0xcf, 0x49, 0xb6, 0xdc, 0x40, 0x7c, 0x14, 0x38, 0xce, 0xc9, 0x88, 0x15, 0xd9,
    0x22, 0x77, 0xb6, 0x25, 0xb0, 0x9d, 0xe8, 0x18, 0x18, 0xf5, 0xf3, 0xa5, 0x79, 0x89, 0xf1, 0xf1,
];
const SPL_TOKEN_TRANSFER_TAG: u8 = 3;

#[cfg(feature = "entrypoint")]
arch_program::entrypoint!(process_instruction);

pub fn process_instruction<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> Result<(), ProgramError> {
    // Anchor/Satellite IDL account protocol (Create/Write/Resize/…). Must be
    // checked before Borsh NameInstruction decode so the 8-byte IDL selector
    // is not mistaken for a registry instruction.
    if let Some(result) = idl::try_process(program_id, accounts, instruction_data) {
        return result;
    }
    let instruction = NameInstruction::deserialize(&mut &instruction_data[..])
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    match instruction {
        NameInstruction::InitializeRegistry {
            network_id,
            namespace_authority,
        } => initialize_registry(program_id, accounts, network_id, namespace_authority),
        NameInstruction::Register { label, .. } => register(program_id, accounts, label),
        NameInstruction::Transfer {
            name_hash,
            new_owner,
        } => transfer(program_id, accounts, name_hash, new_owner),
        NameInstruction::SetRecord {
            name_hash,
            record_type,
            value,
            expected_revision,
        } => set_record(
            program_id,
            accounts,
            name_hash,
            record_type,
            value,
            expected_revision,
        ),
        NameInstruction::DeleteRecord {
            name_hash,
            record_type,
            text_key,
            expected_revision,
        } => delete_record(
            program_id,
            accounts,
            name_hash,
            record_type,
            text_key,
            expected_revision,
        ),
        NameInstruction::SetPrimary { name_hash } => set_primary(program_id, accounts, name_hash),
        NameInstruction::ClearPrimary => clear_primary(program_id, accounts),
        NameInstruction::ListName {
            name_hash,
            currency,
            price,
        } => list_name(program_id, accounts, name_hash, currency, price),
        NameInstruction::CancelListing { name_hash } => {
            cancel_listing(program_id, accounts, name_hash)
        }
        NameInstruction::BuyName { name_hash } => buy_name(program_id, accounts, name_hash),
        NameInstruction::MakeOffer {
            name_hash,
            currency,
            price,
        } => make_offer(program_id, accounts, name_hash, currency, price),
        NameInstruction::CancelOffer { name_hash } => {
            cancel_offer(program_id, accounts, name_hash)
        }
        NameInstruction::AcceptOffer { name_hash, buyer } => {
            accept_offer(program_id, accounts, name_hash, buyer)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize_registry(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    network_id: u32,
    namespace_authority: ArchAddress,
) -> Result<(), ProgramError> {
    if network_id != TESTNET_NETWORK_ID {
        return Err(ProgramError::InvalidInstructionData);
    }
    let iterator = &mut accounts.iter();
    let authority = next_account_info(iterator)?;
    let config = next_account_info(iterator)?;
    require_signer(authority)?;
    let expected = derive_config_address(program_id.serialize(), network_id, TESTNET_NAMESPACE);
    require_address(config, expected)?;
    let state = RegistryConfig {
        header: AccountHeader::initialized(REGISTRY_CONFIG_DISCRIMINATOR),
        program_version: 1,
        network_id,
        namespace: TESTNET_NAMESPACE.to_owned(),
        namespace_authority,
        grace_period_slots: 0,
        min_registration_slots: 0,
        max_registration_slots: 0,
        bitcoin_network: BitcoinNetwork::Testnet,
        token_programs: Vec::new(),
        paused: false,
        mainnet_enabled: false,
    };
    if authority.key.serialize() != state.namespace_authority {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let bytes = encode_state(&state);
    let network = network_id.to_le_bytes();
    let namespace = namespace_hash(TESTNET_NAMESPACE);
    let seeds = [
        b"ans:config:v1".as_slice(),
        network.as_slice(),
        namespace.as_slice(),
    ];
    // Fresh account: create at full encoded size with rent. Program-owned but
    // incomplete (e.g. prior zero-size create / rent failure): top up and write.
    if config.owner == program_id {
        if config_is_initialized(config) {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
    } else if config.data_is_empty() {
        create_pda(program_id, authority, config, accounts, &seeds, bytes.len())?;
    } else {
        return Err(ProgramError::IncorrectProgramId);
    }
    store(authority, config, &state)
}

fn register(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    label: String,
) -> Result<(), ProgramError> {
    validate_label(&label).map_err(|_| ProgramError::InvalidInstructionData)?;
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    require_signer(owner)?;
    let config = load_config(program_id, config_account)?;
    ensure_unpaused(&config)?;
    let name = transition::register(label, owner.key.serialize())
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    require_address(
        name_account,
        derive_name_address(program_id.serialize(), &config.namespace, name.name_hash),
    )?;
    let namespace = namespace_hash(TESTNET_NAMESPACE);
    let seeds = [
        b"ans:name:v1".as_slice(),
        namespace.as_slice(),
        name.name_hash.as_slice(),
    ];
    let bytes = encode_state(&name);
    // One PDA per canonical name. Initialized accounts are permanently taken on
    // testnet; only empty/zeroed incomplete creates may be resumed.
    if name_account.owner == program_id {
        match availability::ensure_program_owned_name_available(&name_account.data.borrow()) {
            Ok(()) => {}
            Err(ans_protocol::AnsError::NameTaken) => {
                return Err(ProgramError::AccountAlreadyInitialized);
            }
            Err(_) => return Err(ProgramError::InvalidAccountData),
        }
    } else if name_account.data_is_empty() {
        create_pda(program_id, owner, name_account, accounts, &seeds, bytes.len())?;
    } else {
        return Err(ProgramError::IncorrectProgramId);
    }
    store(owner, name_account, &name)
}

fn transfer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
    new_owner: ArchAddress,
) -> Result<(), ProgramError> {
    if new_owner == [0; 32] {
        return Err(ProgramError::InvalidInstructionData);
    }
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let listing_account = next_account_info(iterator)?;
    require_signer(owner)?;
    let config = load_config(program_id, config_account)?;
    ensure_unpaused(&config)?;
    let mut name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(owner, &name.owner)?;
    require_address(
        listing_account,
        derive_listing_address(program_id.serialize(), &config.namespace, name_hash),
    )?;
    if listing_is_active(listing_account)? {
        return Err(ProgramError::Custom(2));
    }
    transition::transfer(&mut name, new_owner);
    store(owner, name_account, &name)
}

fn set_record(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
    record_type: RecordType,
    value: RecordValue,
    expected_revision: u64,
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let record_account = next_account_info(iterator)?;
    require_signer(owner)?;
    let config = load_config(program_id, config_account)?;
    let name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(owner, &name.owner)?;
    let text_key_owned = value.text_key().map(str::to_owned);
    let text_key = text_key_owned.as_deref();
    if record_type == RecordType::Text && text_key.is_none() {
        return Err(ProgramError::InvalidInstructionData);
    }
    require_address(
        record_account,
        derive_record_address_for_value(
            program_id.serialize(),
            &config.namespace,
            name_hash,
            record_type,
            text_key,
        ),
    )?;
    let existing = if record_account.data_is_empty() {
        None
    } else {
        if record_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        Some(load::<RecordAccount>(record_account)?)
    };
    let record = transition::set_record(
        &config,
        &name,
        existing.as_ref(),
        record_type,
        value,
        expected_revision,
    )
    .map_err(|_| ProgramError::InvalidInstructionData)?;
    if existing.is_none() {
        let namespace = namespace_hash(TESTNET_NAMESPACE);
        let record_kind = [record_type as u8];
        let key_hash = text_key.map(record_key_hash);
        let bytes = encode_state(&record);
        if record_account.owner == program_id {
            // Resume a prior underfunded create.
        } else if record_account.data_is_empty() {
            if let Some(ref key_hash) = key_hash {
                let seeds = [
                    b"ans:record:v1".as_slice(),
                    namespace.as_slice(),
                    name_hash.as_slice(),
                    record_kind.as_slice(),
                    key_hash.as_slice(),
                ];
                create_pda(
                    program_id,
                    owner,
                    record_account,
                    accounts,
                    &seeds,
                    bytes.len(),
                )?;
            } else {
                let seeds = [
                    b"ans:record:v1".as_slice(),
                    namespace.as_slice(),
                    name_hash.as_slice(),
                    record_kind.as_slice(),
                ];
                create_pda(
                    program_id,
                    owner,
                    record_account,
                    accounts,
                    &seeds,
                    bytes.len(),
                )?;
            }
        } else {
            return Err(ProgramError::IncorrectProgramId);
        }
    }
    store(owner, record_account, &record)
}

fn delete_record(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
    record_type: RecordType,
    text_key: String,
    expected_revision: u64,
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let record_account = next_account_info(iterator)?;
    require_signer(owner)?;
    let config = load_config(program_id, config_account)?;
    let name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(owner, &name.owner)?;
    let key_opt = match record_type {
        RecordType::Text => {
            if text_key.is_empty() {
                return Err(ProgramError::InvalidInstructionData);
            }
            Some(text_key.as_str())
        }
        _ => {
            if !text_key.is_empty() {
                return Err(ProgramError::InvalidInstructionData);
            }
            None
        }
    };
    require_address(
        record_account,
        derive_record_address_for_value(
            program_id.serialize(),
            &config.namespace,
            name_hash,
            record_type,
            key_opt,
        ),
    )?;
    if record_account.owner != program_id || record_account.data_is_empty() {
        return Err(ProgramError::UninitializedAccount);
    }
    let existing = load::<RecordAccount>(record_account)?;
    if existing.revision != expected_revision
        || existing.record_type != record_type
        || existing.name_hash != name_hash
        || existing.owner_snapshot != name.owner
        || existing.record_epoch != name.record_epoch
    {
        return Err(ProgramError::InvalidAccountData);
    }
    if record_type == RecordType::Text && existing.value.text_key() != Some(text_key.as_str()) {
        return Err(ProgramError::InvalidAccountData);
    }
    record_account.realloc(0, false)
}

fn set_primary(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let reverse_account = next_account_info(iterator)?;
    require_signer(owner)?;
    let config = load_config(program_id, config_account)?;
    let mut name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(owner, &name.owner)?;
    require_address(
        reverse_account,
        derive_reverse_address(program_id.serialize(), &config.namespace, name.owner),
    )?;
    let reverse = transition::set_primary(&mut name);
    if reverse_account.owner == program_id {
        // Existing reverse PDA (or prior underfunded create).
    } else if reverse_account.data_is_empty() {
        let namespace = namespace_hash(TESTNET_NAMESPACE);
        let seeds = [
            b"ans:reverse:v1".as_slice(),
            namespace.as_slice(),
            name.owner.as_slice(),
        ];
        let bytes = encode_state(&reverse);
        create_pda(
            program_id,
            owner,
            reverse_account,
            accounts,
            &seeds,
            bytes.len(),
        )?;
    } else {
        return Err(ProgramError::IncorrectProgramId);
    }
    store(owner, name_account, &name)?;
    store(owner, reverse_account, &reverse)
}

fn clear_primary(program_id: &Pubkey, accounts: &[AccountInfo]) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let owner = next_account_info(iterator)?;
    let reverse_account = next_account_info(iterator)?;
    require_signer(owner)?;
    if reverse_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let reverse = load::<ans_protocol::ReverseAccount>(reverse_account)?;
    require_owner(owner, &reverse.owner)?;
    reverse_account.realloc(0, false)
}

fn list_name(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
    currency: QuoteCurrency,
    price: u64,
) -> Result<(), ProgramError> {
    if price == 0 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let iterator = &mut accounts.iter();
    let seller = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let listing_account = next_account_info(iterator)?;
    require_signer(seller)?;
    let config = load_config(program_id, config_account)?;
    ensure_unpaused(&config)?;
    let name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(seller, &name.owner)?;
    let listing_address =
        derive_listing_address(program_id.serialize(), &config.namespace, name_hash);
    require_address(listing_account, listing_address)?;
    if listing_is_active(listing_account)? {
        return Err(ProgramError::Custom(2));
    }
    let listing = marketplace::create_listing(name_hash, name.owner, currency, price);
    let bytes = encode_state(&listing);
    let namespace = namespace_hash(TESTNET_NAMESPACE);
    let seeds: [&[u8]; 3] = [b"ans:listing:v1", namespace.as_slice(), name_hash.as_slice()];
    if listing_account.owner == program_id {
        // Re-list into an existing deactivated listing PDA.
    } else if listing_account.data_is_empty() {
        create_pda(
            program_id,
            seller,
            listing_account,
            accounts,
            &seeds,
            bytes.len(),
        )?;
    } else {
        return Err(ProgramError::IncorrectProgramId);
    }
    store(seller, listing_account, &listing)
}

fn cancel_listing(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let seller = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let listing_account = next_account_info(iterator)?;
    require_signer(seller)?;
    let config = load_config(program_id, config_account)?;
    ensure_unpaused(&config)?;
    let name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(seller, &name.owner)?;
    let mut listing = load_active_listing(program_id, listing_account, &config, name_hash)?;
    if listing.seller != name.owner {
        return Err(ProgramError::InvalidAccountData);
    }
    marketplace::deactivate_listing(&mut listing);
    store(seller, listing_account, &listing)
}

fn buy_name(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let buyer = next_account_info(iterator)?;
    let seller = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let listing_account = next_account_info(iterator)?;
    require_signer(buyer)?;
    let config = load_config(program_id, config_account)?;
    ensure_unpaused(&config)?;
    let mut name = load_name(program_id, name_account, &config, name_hash)?;
    let mut listing = load_active_listing(program_id, listing_account, &config, name_hash)?;
    if name.owner != listing.seller {
        return Err(ProgramError::InvalidAccountData);
    }
    if seller.key.serialize() != listing.seller {
        return Err(ProgramError::InvalidAccountData);
    }
    if buyer.key.serialize() == listing.seller {
        return Err(ProgramError::InvalidInstructionData);
    }
    match listing.currency {
        QuoteCurrency::Arch => {
            transfer_lamports(buyer, seller, listing.price)?;
        }
        QuoteCurrency::Btc => {
            let buyer_ata = next_account_info(iterator)?;
            let seller_ata = next_account_info(iterator)?;
            let mint = next_account_info(iterator)?;
            let token_program = next_account_info(iterator)?;
            if mint.key.serialize() != TESTNET_ABTC_MINT {
                return Err(ProgramError::InvalidAccountData);
            }
            if token_program.key.serialize() != TOKEN_PROGRAM_ID_BYTES {
                return Err(ProgramError::IncorrectProgramId);
            }
            transfer_abtc(
                buyer,
                buyer_ata,
                seller_ata,
                mint,
                token_program,
                listing.price,
            )?;
        }
    }
    transition::transfer(&mut name, buyer.key.serialize());
    marketplace::deactivate_listing(&mut listing);
    store(buyer, name_account, &name)?;
    store(buyer, listing_account, &listing)
}

fn make_offer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
    currency: QuoteCurrency,
    price: u64,
) -> Result<(), ProgramError> {
    if price == 0 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let iterator = &mut accounts.iter();
    let buyer = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let offer_account = next_account_info(iterator)?;
    require_signer(buyer)?;
    let config = load_config(program_id, config_account)?;
    ensure_unpaused(&config)?;
    let name = load_name(program_id, name_account, &config, name_hash)?;
    if name.owner == buyer.key.serialize() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let offer_address = derive_offer_address(
        program_id.serialize(),
        &config.namespace,
        name_hash,
        buyer.key.serialize(),
    );
    require_address(offer_account, offer_address)?;
    if offer_is_active(offer_account)? {
        return Err(ProgramError::Custom(2));
    }
    let offer = marketplace::create_offer(name_hash, buyer.key.serialize(), currency, price);
    let bytes = encode_state(&offer);
    let namespace = namespace_hash(TESTNET_NAMESPACE);
    let buyer_bytes = buyer.key.serialize();
    let seeds: [&[u8]; 4] = [
        b"ans:offer:v1",
        namespace.as_slice(),
        name_hash.as_slice(),
        buyer_bytes.as_slice(),
    ];
    if offer_account.owner == program_id {
        // Reuse deactivated offer PDA.
    } else if offer_account.data_is_empty() {
        create_pda(
            program_id,
            buyer,
            offer_account,
            accounts,
            &seeds,
            bytes.len(),
        )?;
    } else {
        return Err(ProgramError::IncorrectProgramId);
    }
    store(buyer, offer_account, &offer)?;
    if currency == QuoteCurrency::Arch {
        transfer_lamports(buyer, offer_account, price)?;
    }
    Ok(())
}

fn cancel_offer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let buyer = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let offer_account = next_account_info(iterator)?;
    require_signer(buyer)?;
    let config = load_config(program_id, config_account)?;
    ensure_unpaused(&config)?;
    let mut offer = load_active_offer(
        program_id,
        offer_account,
        &config,
        name_hash,
        buyer.key.serialize(),
    )?;
    if offer.currency == QuoteCurrency::Arch {
        transfer_lamports(offer_account, buyer, offer.price)?;
    }
    marketplace::deactivate_offer(&mut offer);
    store(buyer, offer_account, &offer)
}

fn accept_offer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name_hash: [u8; 32],
    buyer_key: ArchAddress,
) -> Result<(), ProgramError> {
    let iterator = &mut accounts.iter();
    let seller = next_account_info(iterator)?;
    let buyer = next_account_info(iterator)?;
    let config_account = next_account_info(iterator)?;
    let name_account = next_account_info(iterator)?;
    let offer_account = next_account_info(iterator)?;
    let listing_account = next_account_info(iterator)?;
    require_signer(seller)?;
    let config = load_config(program_id, config_account)?;
    ensure_unpaused(&config)?;
    let mut name = load_name(program_id, name_account, &config, name_hash)?;
    require_owner(seller, &name.owner)?;
    if buyer.key.serialize() != buyer_key {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut offer = load_active_offer(program_id, offer_account, &config, name_hash, buyer_key)?;
    match offer.currency {
        QuoteCurrency::Arch => {
            transfer_lamports(offer_account, seller, offer.price)?;
        }
        QuoteCurrency::Btc => {
            require_signer(buyer)?;
            let buyer_ata = next_account_info(iterator)?;
            let seller_ata = next_account_info(iterator)?;
            let mint = next_account_info(iterator)?;
            let token_program = next_account_info(iterator)?;
            if mint.key.serialize() != TESTNET_ABTC_MINT {
                return Err(ProgramError::InvalidAccountData);
            }
            if token_program.key.serialize() != TOKEN_PROGRAM_ID_BYTES {
                return Err(ProgramError::IncorrectProgramId);
            }
            transfer_abtc(
                buyer,
                buyer_ata,
                seller_ata,
                mint,
                token_program,
                offer.price,
            )?;
        }
    }
    transition::transfer(&mut name, buyer_key);
    marketplace::deactivate_offer(&mut offer);
    require_address(
        listing_account,
        derive_listing_address(program_id.serialize(), &config.namespace, name_hash),
    )?;
    if listing_is_active(listing_account)? {
        let mut listing = load::<ListingAccount>(listing_account)?;
        marketplace::deactivate_listing(&mut listing);
        store(seller, listing_account, &listing)?;
    }
    store(seller, name_account, &name)?;
    store(seller, offer_account, &offer)
}

fn transfer_lamports(
    from: &AccountInfo,
    to: &AccountInfo,
    amount: u64,
) -> Result<(), ProgramError> {
    let mut from_lamports = from.try_borrow_mut_lamports()?;
    let mut to_lamports = to.try_borrow_mut_lamports()?;
    if **from_lamports < amount {
        return Err(ProgramError::InsufficientFunds);
    }
    **from_lamports -= amount;
    **to_lamports = to_lamports
        .checked_add(amount)
        .ok_or(ProgramError::InsufficientFunds)?;
    Ok(())
}

fn transfer_abtc<'a>(
    authority: &AccountInfo<'a>,
    source: &AccountInfo<'a>,
    destination: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    amount: u64,
) -> Result<(), ProgramError> {
    let mut data = Vec::with_capacity(9);
    data.push(SPL_TOKEN_TRANSFER_TAG);
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: *token_program.key,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new(*destination.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data,
    };
    // Keep mint in the account metas passed to invoke for token programs that
    // expect remaining accounts; classic SPL Transfer does not require it.
    let _ = mint;
    invoke(&ix, &[source.clone(), destination.clone(), authority.clone()])
}

fn listing_is_active(account: &AccountInfo) -> Result<bool, ProgramError> {
    if account.owner == &Pubkey::system_program() || account.data_is_empty() {
        return Ok(false);
    }
    let listing = load::<ListingAccount>(account)?;
    listing
        .header
        .validate(LISTING_ACCOUNT_DISCRIMINATOR)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(listing.active)
}

fn offer_is_active(account: &AccountInfo) -> Result<bool, ProgramError> {
    if account.owner == &Pubkey::system_program() || account.data_is_empty() {
        return Ok(false);
    }
    let offer = load::<OfferAccount>(account)?;
    offer
        .header
        .validate(OFFER_ACCOUNT_DISCRIMINATOR)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(offer.active)
}

fn load_active_offer(
    program_id: &Pubkey,
    account: &AccountInfo,
    config: &RegistryConfig,
    name_hash: [u8; 32],
    buyer: ArchAddress,
) -> Result<OfferAccount, ProgramError> {
    if account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let offer = load::<OfferAccount>(account)?;
    offer
        .header
        .validate(OFFER_ACCOUNT_DISCRIMINATOR)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if offer.name_hash != name_hash || offer.buyer != buyer || !offer.active {
        return Err(ProgramError::Custom(3));
    }
    require_address(
        account,
        derive_offer_address(program_id.serialize(), &config.namespace, name_hash, buyer),
    )?;
    Ok(offer)
}

fn load_active_listing(
    program_id: &Pubkey,
    account: &AccountInfo,
    config: &RegistryConfig,
    name_hash: [u8; 32],
) -> Result<ListingAccount, ProgramError> {
    if account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let listing = load::<ListingAccount>(account)?;
    listing
        .header
        .validate(LISTING_ACCOUNT_DISCRIMINATOR)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if listing.name_hash != name_hash || !listing.active {
        return Err(ProgramError::Custom(3));
    }
    require_address(
        account,
        derive_listing_address(program_id.serialize(), &config.namespace, name_hash),
    )?;
    Ok(listing)
}

fn load_config(program_id: &Pubkey, account: &AccountInfo) -> Result<RegistryConfig, ProgramError> {
    if account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let config = load::<RegistryConfig>(account)?;
    config
        .header
        .validate(REGISTRY_CONFIG_DISCRIMINATOR)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if config.namespace != TESTNET_NAMESPACE || config.network_id != TESTNET_NETWORK_ID {
        return Err(ProgramError::InvalidAccountData);
    }
    require_address(
        account,
        derive_config_address(program_id.serialize(), config.network_id, &config.namespace),
    )?;
    Ok(config)
}

fn load_name(
    program_id: &Pubkey,
    account: &AccountInfo,
    config: &RegistryConfig,
    name_hash: [u8; 32],
) -> Result<ans_protocol::NameAccount, ProgramError> {
    if account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let name = load::<ans_protocol::NameAccount>(account)?;
    name.header
        .validate(NAME_ACCOUNT_DISCRIMINATOR)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if name.name_hash != name_hash {
        return Err(ProgramError::InvalidAccountData);
    }
    require_address(
        account,
        derive_name_address(program_id.serialize(), &config.namespace, name_hash),
    )?;
    Ok(name)
}

fn create_pda(
    program_id: &Pubkey,
    payer: &AccountInfo,
    account: &AccountInfo,
    accounts: &[AccountInfo],
    seeds: &[&[u8]],
    space: usize,
) -> Result<(), ProgramError> {
    // Arch create_account CPIs require the PDA bump in the signer seeds,
    // matching Autara's global-config / market creation path. Allocate the
    // full encoded size up front so the account is rent-exempt without a
    // later underfunded realloc.
    let (expected, bump) = Pubkey::find_program_address(seeds, program_id);
    if account.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    let bump = [bump];
    let mut signer_seeds = seeds.to_vec();
    signer_seeds.push(&bump);
    invoke_signed_unchecked(
        &system_instruction::create_account(
            payer.key,
            account.key,
            minimum_rent(space),
            space as u64,
            program_id,
        ),
        accounts,
        &[&signer_seeds],
    )
}

fn fund_rent_exempt(payer: &AccountInfo, account: &AccountInfo, space: usize) -> Result<(), ProgramError> {
    let required = minimum_rent(space);
    let current = account.lamports();
    if current >= required {
        return Ok(());
    }
    let needed = required.saturating_sub(current);
    let mut payer_lamports = payer.try_borrow_mut_lamports()?;
    let mut account_lamports = account.try_borrow_mut_lamports()?;
    if **payer_lamports < needed {
        return Err(ProgramError::InsufficientFunds);
    }
    **payer_lamports -= needed;
    **account_lamports += needed;
    Ok(())
}

fn config_is_initialized(account: &AccountInfo) -> bool {
    load::<RegistryConfig>(account)
        .ok()
        .and_then(|config| {
            config
                .header
                .validate(REGISTRY_CONFIG_DISCRIMINATOR)
                .ok()
                .map(|_| true)
        })
        .unwrap_or(false)
}

fn load<T: BorshDeserialize>(account: &AccountInfo) -> Result<T, ProgramError> {
    if account.owner == &Pubkey::system_program() {
        return Err(ProgramError::UninitializedAccount);
    }
    decode_state(&account.data.borrow()).map_err(|_| ProgramError::InvalidAccountData)
}

fn store<T: borsh::BorshSerialize>(
    payer: &AccountInfo,
    account: &AccountInfo,
    state: &T,
) -> Result<(), ProgramError> {
    let bytes = encode_state(state);
    fund_rent_exempt(payer, account, bytes.len())?;
    if account.data_len() != bytes.len() {
        account.realloc(bytes.len(), false)?;
    }
    account.data.borrow_mut().copy_from_slice(&bytes);
    Ok(())
}

fn require_signer(account: &AccountInfo) -> Result<(), ProgramError> {
    if account.is_signer {
        Ok(())
    } else {
        Err(ProgramError::MissingRequiredSignature)
    }
}

fn require_owner(signer: &AccountInfo, owner: &ArchAddress) -> Result<(), ProgramError> {
    if signer.key.serialize() == *owner {
        Ok(())
    } else {
        Err(ProgramError::MissingRequiredSignature)
    }
}

fn require_address(account: &AccountInfo, expected: ArchAddress) -> Result<(), ProgramError> {
    if account.key.serialize() == expected {
        Ok(())
    } else {
        Err(ProgramError::InvalidSeeds)
    }
}

fn ensure_unpaused(config: &RegistryConfig) -> Result<(), ProgramError> {
    if config.paused {
        Err(ProgramError::Custom(1))
    } else {
        Ok(())
    }
}
