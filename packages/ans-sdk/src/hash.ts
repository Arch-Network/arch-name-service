import { sha256 } from "@noble/hashes/sha2";

import { NAME_HASH_DOMAIN, NAMESPACE_DOMAIN } from "./constants.js";

export function namespaceHash(namespace: string): Uint8Array {
  const hasher = sha256.create();
  hasher.update(NAMESPACE_DOMAIN);
  hasher.update(new TextEncoder().encode(namespace));
  return hasher.digest();
}

export function hashName(canonicalName: string): Uint8Array {
  const hasher = sha256.create();
  hasher.update(NAME_HASH_DOMAIN);
  hasher.update(new TextEncoder().encode(canonicalName));
  return hasher.digest();
}
