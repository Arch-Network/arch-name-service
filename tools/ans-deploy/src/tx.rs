use anyhow::{bail, Context, Result};
use arch_program::{
    bitcoin::key::Keypair, instruction::Instruction, pubkey::Pubkey, sanitized::ArchMessage,
};
use arch_sdk::{build_and_sign_transaction, ArchRpcClient, Config, Status};

pub fn send_and_confirm(
    client: &ArchRpcClient,
    config: &Config,
    instruction: Instruction,
    fee_payer: Pubkey,
    signers: Vec<Keypair>,
    operation: &str,
) -> Result<String> {
    send_and_confirm_many(client, config, vec![instruction], fee_payer, signers, operation)
}

pub fn send_and_confirm_many(
    client: &ArchRpcClient,
    config: &Config,
    instructions: Vec<Instruction>,
    fee_payer: Pubkey,
    signers: Vec<Keypair>,
    operation: &str,
) -> Result<String> {
    let blockhash = client
        .get_best_finalized_block_hash()
        .with_context(|| format!("fetch blockhash for {operation}"))?;
    let transaction = build_and_sign_transaction(
        ArchMessage::new(&instructions, Some(fee_payer), blockhash),
        signers,
        config.network,
    )
    .with_context(|| format!("build {operation} transaction"))?;
    let txid = client
        .send_transaction(transaction)
        .with_context(|| format!("send {operation} transaction"))?;
    let processed = client
        .wait_for_processed_transaction(&txid)
        .with_context(|| format!("confirm {operation} transaction"))?;
    if let Status::Failed(error) = processed.status {
        bail!("{operation} transaction {txid} failed: {error}");
    }
    if !matches!(processed.status, Status::Processed) {
        bail!("{operation} transaction {txid} did not finish processing");
    }
    Ok(txid.to_string())
}
