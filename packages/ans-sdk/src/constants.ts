export const STATE_VERSION = 1;
export const REGISTRY_CONFIG_DISCRIMINATOR = new TextEncoder().encode("ANSCFG01");
export const NAME_ACCOUNT_DISCRIMINATOR = new TextEncoder().encode("ANSNAME1");
export const RECORD_ACCOUNT_DISCRIMINATOR = new TextEncoder().encode("ANSRECR1");
export const REVERSE_ACCOUNT_DISCRIMINATOR = new TextEncoder().encode("ANSREVR1");

export const CONFIG_SEED = new TextEncoder().encode("ans:config:v1");
export const NAME_SEED = new TextEncoder().encode("ans:name:v1");
export const RECORD_SEED = new TextEncoder().encode("ans:record:v1");
export const REVERSE_SEED = new TextEncoder().encode("ans:reverse:v1");
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
