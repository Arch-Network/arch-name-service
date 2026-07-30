export const STATE_VERSION = 1;
export const REGISTRY_CONFIG_DISCRIMINATOR = new TextEncoder().encode("ANSCFG01");
export const NAME_ACCOUNT_DISCRIMINATOR = new TextEncoder().encode("ANSNAME1");
export const RECORD_ACCOUNT_DISCRIMINATOR = new TextEncoder().encode("ANSRECR1");
export const REVERSE_ACCOUNT_DISCRIMINATOR = new TextEncoder().encode("ANSREVR1");
export const LISTING_ACCOUNT_DISCRIMINATOR = new TextEncoder().encode("ANSLIST1");
export const OFFER_ACCOUNT_DISCRIMINATOR = new TextEncoder().encode("ANSOFFR1");

export const CONFIG_SEED = new TextEncoder().encode("ans:config:v1");
export const NAME_SEED = new TextEncoder().encode("ans:name:v1");
export const RECORD_SEED = new TextEncoder().encode("ans:record:v1");
export const REVERSE_SEED = new TextEncoder().encode("ans:reverse:v1");
export const LISTING_SEED = new TextEncoder().encode("ans:listing:v1");
export const OFFER_SEED = new TextEncoder().encode("ans:offer:v1");
export const NAMESPACE_DOMAIN = new TextEncoder().encode("arch-name-service:namespace:v1\0");
export const NAME_HASH_DOMAIN = new TextEncoder().encode("arch-name-service:name-hash:v1\0");
export const RECORD_KEY_DOMAIN = new TextEncoder().encode("arch-name-service:record-key:v1\0");
export const ARCH_SUFFIX = ".arch";
export const MAX_TEXT_KEY_LEN = 32;
export const MAX_TEXT_VALUE_LEN = 256;
/**
 * Arch system program — matches `Pubkey::system_program()` / base58
 * `11111111111111111111111111111111` (32 zero bytes). Live testnet account is
 * executable under this id; `…0001` is a normal funded account, not the program.
 */
export const SYSTEM_PROGRAM_ID = new Uint8Array(32);

/** Arch Token program (`TokenT4em53UrV4gSvZ3nCS2mZeHaqTLapwt6iZt6Mk`). */
export const TOKEN_PROGRAM_ID = Uint8Array.from([
  6, 221, 246, 225, 185, 234, 132, 65, 44, 16, 184, 223, 2, 28, 16, 15, 200, 135, 25, 7, 195, 9,
  195, 53, 53, 222, 32, 156, 52, 23, 99, 191,
]);

/** Testnet aBTC mint (8 decimals) — marketplace BTC quote asset. */
export const TESTNET_ABTC_MINT = Uint8Array.from(
  "726179cf49b6dc407c1438cec98815d92277b625b09de81818f5f3a57989f1f1"
    .match(/.{2}/g)!
    .map((b) => parseInt(b, 16)),
);

/** Associated Token program (`ATok9pxLsNzM5zJJ3UQpXBrMriHpZiY5Yio3GKYU4we3`). */
export const ASSOCIATED_TOKEN_PROGRAM_ID = Uint8Array.from([
  140, 151, 35, 17, 132, 146, 123, 119, 181, 241, 128, 17, 143, 204, 104, 52, 20, 183, 124, 82, 30,
  90, 119, 8, 28, 247, 29, 95, 96, 106, 83, 132,
]);
