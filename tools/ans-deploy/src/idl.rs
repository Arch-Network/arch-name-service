//! Publish (or upgrade) the ANS registry's on-chain IDL account.
//!
//! Protocol matches Arch Satellite / `clamm-deploy` / arch-cli IDL publisher:
//! selector `sha256("anchor:idl")[..8]`, zlib-compressed JSON payload, canonical
//! account at `create_with_seed(find_program_address([], program), "anchor:idl", program)`.

use std::io::Write;
use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};
use arch_program::{
    account::AccountMeta, instruction::Instruction, pubkey::Pubkey, rent::minimum_rent,
    system_instruction,
};
use arch_program::bitcoin::key::Keypair;
use arch_sdk::{generate_new_keypair, ArchRpcClient, Config};
use flate2::write::ZlibEncoder;
use flate2::Compression;

use crate::tx::send_and_confirm_many;

const IDL_IX_TAG_LE: [u8; 8] = [0x40, 0xf4, 0xbc, 0x78, 0xa7, 0xe9, 0x69, 0x0a];
const IDL_SEED: &str = "anchor:idl";
const MAX_WRITE_SIZE: usize = 600;
const IDL_HEADER_LEN: usize = 8 + 32 + 4;
const IDL_CREATE_MAX_SPACE: usize = 10_000;

const TAG_CREATE: u8 = 0x00;
const TAG_CREATE_BUFFER: u8 = 0x01;
const TAG_WRITE: u8 = 0x02;
const TAG_SET_BUFFER: u8 = 0x03;
const TAG_RESIZE: u8 = 0x06;

#[derive(Debug, Clone, Copy)]
pub enum PublishMode {
    Init,
    Upgrade,
    Auto,
}

pub fn publish(
    client: &ArchRpcClient,
    config: &Config,
    program: Pubkey,
    authority: Pubkey,
    authority_keypair: Keypair,
    idl_path: &str,
    mode: PublishMode,
) -> Result<Vec<String>> {
    if !Path::new(idl_path).exists() {
        bail!("IDL file not found at {idl_path}");
    }

    let (_base, idl_addr) = derive_idl_addresses(&program)?;
    let exists = idl_account_exists(client, idl_addr);

    let do_upgrade = match mode {
        PublishMode::Init => {
            if exists {
                bail!("IDL account already exists at {idl_addr}; use mode=upgrade or auto");
            }
            false
        }
        PublishMode::Upgrade => {
            if !exists {
                bail!("no IDL account at {idl_addr}; use mode=init or auto");
            }
            true
        }
        PublishMode::Auto => exists,
    };

    if do_upgrade {
        upgrade(
            client,
            config,
            program,
            idl_addr,
            authority,
            authority_keypair,
            idl_path,
        )
    } else {
        init(
            client,
            config,
            program,
            idl_addr,
            authority,
            authority_keypair,
            idl_path,
        )
    }
}

fn idl_account_exists(client: &ArchRpcClient, idl_addr: Pubkey) -> bool {
    matches!(
        client.read_account_info(idl_addr),
        Ok(info) if info.data.len() >= IDL_HEADER_LEN
    )
}

fn derive_idl_addresses(program: &Pubkey) -> Result<(Pubkey, Pubkey)> {
    let (base, _bump) = Pubkey::find_program_address(&[], program);
    let idl = Pubkey::create_with_seed(&base, IDL_SEED, program)
        .map_err(|e| anyhow!("derive IDL account address: {e:?}"))?;
    Ok((base, idl))
}

fn init(
    client: &ArchRpcClient,
    config: &Config,
    program: Pubkey,
    idl_addr: Pubkey,
    authority: Pubkey,
    authority_keypair: Keypair,
    idl_path: &str,
) -> Result<Vec<String>> {
    let json = load_and_normalize_idl(idl_path)?;
    let compressed = zlib_compress(&json)?;
    let (base, _) = derive_idl_addresses(&program)?;
    let mut txids = Vec::new();

    println!("Publishing IDL for program {program}");
    println!("  IDL json {} B -> zlib {} B", json.len(), compressed.len());
    println!("  IDL account: {idl_addr}");

    let create_ix = Instruction {
        program_id: program,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(idl_addr, false),
            AccountMeta::new_readonly(base, false),
            AccountMeta::new_readonly(Pubkey::system_program(), false),
            AccountMeta::new_readonly(program, false),
        ],
        data: create_ix_data(compressed.len() as u64),
    };
    txids.push(send_and_confirm_many(
        client,
        config,
        vec![create_ix],
        authority,
        vec![authority_keypair],
        "idl_create",
    )?);

    let target_space = IDL_HEADER_LEN + compressed.len();
    txids.extend(resize_to(
        client,
        config,
        program,
        idl_addr,
        authority,
        authority_keypair,
        target_space,
    )?);

    txids.extend(write_chunks(
        client,
        config,
        program,
        idl_addr,
        authority,
        authority_keypair,
        &compressed,
    )?);

    println!("IDL published successfully.");
    Ok(txids)
}

fn upgrade(
    client: &ArchRpcClient,
    config: &Config,
    program: Pubkey,
    idl_addr: Pubkey,
    authority: Pubkey,
    authority_keypair: Keypair,
    idl_path: &str,
) -> Result<Vec<String>> {
    let idl_account = client
        .read_account_info(idl_addr)
        .map_err(|_| anyhow!("no IDL account at {idl_addr}"))?;
    let json = load_and_normalize_idl(idl_path)?;
    let compressed = zlib_compress(&json)?;
    let required_space = IDL_HEADER_LEN + compressed.len();
    if idl_account.data.len() < required_space {
        bail!(
            "new IDL needs {required_space} bytes but existing IDL account has {}; close and re-init",
            idl_account.data.len()
        );
    }

    let space = required_space as u64;
    let lamports = minimum_rent(space as usize);
    let (buffer_kp, buffer_pubkey, _addr) = generate_new_keypair(config.network);
    let mut txids = Vec::new();

    println!("Upgrading IDL for program {program}");
    println!("  IDL json {} B -> zlib {} B", json.len(), compressed.len());
    println!("  buffer account: {buffer_pubkey}");

    let create_account_ix = system_instruction::create_account(
        &authority,
        &buffer_pubkey,
        lamports,
        space,
        &program,
    );
    let create_buffer_ix = Instruction {
        program_id: program,
        accounts: vec![
            AccountMeta::new(buffer_pubkey, false),
            AccountMeta::new_readonly(authority, true),
        ],
        data: unit_ix_data(TAG_CREATE_BUFFER),
    };
    txids.push(send_and_confirm_many(
        client,
        config,
        vec![create_account_ix, create_buffer_ix],
        authority,
        vec![authority_keypair, buffer_kp],
        "idl_create_buffer",
    )?);

    txids.extend(write_chunks(
        client,
        config,
        program,
        buffer_pubkey,
        authority,
        authority_keypair,
        &compressed,
    )?);

    let set_buffer_ix = Instruction {
        program_id: program,
        accounts: vec![
            AccountMeta::new(buffer_pubkey, false),
            AccountMeta::new(idl_addr, false),
            AccountMeta::new_readonly(authority, true),
        ],
        data: unit_ix_data(TAG_SET_BUFFER),
    };
    txids.push(send_and_confirm_many(
        client,
        config,
        vec![set_buffer_ix],
        authority,
        vec![authority_keypair],
        "idl_set_buffer",
    )?);

    println!("IDL upgraded successfully.");
    Ok(txids)
}

fn resize_to(
    client: &ArchRpcClient,
    config: &Config,
    program: Pubkey,
    idl_addr: Pubkey,
    authority: Pubkey,
    authority_keypair: Keypair,
    target_space: usize,
) -> Result<Vec<String>> {
    let mut txids = Vec::new();
    let mut current = target_space.min(IDL_CREATE_MAX_SPACE);
    // Create already allocated min(header+len, 10k). Grow until target.
    while current < target_space {
        current += (target_space - current).min(IDL_CREATE_MAX_SPACE);
        let resize_ix = Instruction {
            program_id: program,
            accounts: vec![
                AccountMeta::new(idl_addr, false),
                AccountMeta::new(authority, true),
                AccountMeta::new_readonly(Pubkey::system_program(), false),
            ],
            data: resize_ix_data(target_space as u64),
        };
        txids.push(send_and_confirm_many(
            client,
            config,
            vec![resize_ix],
            authority,
            vec![authority_keypair],
            &format!("idl_resize_{current}"),
        )?);
    }
    Ok(txids)
}

fn write_chunks(
    client: &ArchRpcClient,
    config: &Config,
    program: Pubkey,
    target: Pubkey,
    authority: Pubkey,
    authority_keypair: Keypair,
    compressed: &[u8],
) -> Result<Vec<String>> {
    let mut txids = Vec::new();
    let total = compressed.len();
    for (i, chunk) in compressed.chunks(MAX_WRITE_SIZE).enumerate() {
        let write_ix = Instruction {
            program_id: program,
            accounts: vec![
                AccountMeta::new(target, false),
                AccountMeta::new_readonly(authority, true),
            ],
            data: write_ix_data(chunk),
        };
        let offset = i * MAX_WRITE_SIZE;
        txids.push(send_and_confirm_many(
            client,
            config,
            vec![write_ix],
            authority,
            vec![authority_keypair],
            &format!("idl_write_{offset}_{}", offset + chunk.len()),
        )?);
        let _ = total;
    }
    Ok(txids)
}

fn load_and_normalize_idl(path: &str) -> Result<Vec<u8>> {
    let raw = std::fs::read(path).with_context(|| format!("reading IDL at {path}"))?;
    let mut value: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|e| anyhow!("IDL is not valid JSON: {e}"))?;
    let spec = serde_json::Value::String("0.1.0".to_string());
    match value.get_mut("metadata").and_then(|m| m.as_object_mut()) {
        Some(meta) => {
            if meta.get("spec").and_then(|s| s.as_str()) != Some("0.1.0") {
                meta.insert("spec".to_string(), spec);
            }
        }
        None => {
            let root = value
                .as_object_mut()
                .ok_or_else(|| anyhow!("IDL JSON root must be an object"))?;
            let mut meta = serde_json::Map::new();
            meta.insert("spec".to_string(), spec);
            root.insert("metadata".to_string(), serde_json::Value::Object(meta));
        }
    }
    serde_json::to_vec(&value).map_err(|e| anyhow!("re-serialize IDL: {e}"))
}

fn zlib_compress(data: &[u8]) -> Result<Vec<u8>> {
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
    enc.write_all(data)
        .map_err(|e| anyhow!("zlib write: {e}"))?;
    enc.finish().map_err(|e| anyhow!("zlib finish: {e}"))
}

fn create_ix_data(data_len: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 1 + 8);
    data.extend_from_slice(&IDL_IX_TAG_LE);
    data.push(TAG_CREATE);
    data.extend_from_slice(&data_len.to_le_bytes());
    data
}

fn write_ix_data(chunk: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 1 + 4 + chunk.len());
    data.extend_from_slice(&IDL_IX_TAG_LE);
    data.push(TAG_WRITE);
    data.extend_from_slice(&(chunk.len() as u32).to_le_bytes());
    data.extend_from_slice(chunk);
    data
}

fn resize_ix_data(account_space: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 1 + 8);
    data.extend_from_slice(&IDL_IX_TAG_LE);
    data.push(TAG_RESIZE);
    data.extend_from_slice(&account_space.to_le_bytes());
    data
}

fn unit_ix_data(tag: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 1);
    data.extend_from_slice(&IDL_IX_TAG_LE);
    data.push(tag);
    data
}
