import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import { getServerEnv } from "./env";

// AES-256-GCM helpers for encrypting Plaid access tokens at rest.
//
// Storage layout in PlaidItem:
//   - accessTokenCiphertext: ciphertext bytes
//   - accessTokenIv:         12-byte GCM nonce
//   - accessTokenAuthTag:    16-byte GCM auth tag
//   - encryptionKeyVersion:  which key in the env was used (for rotation)

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

export interface EncryptedToken {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
  keyVersion: number;
}

// Copy a node Buffer's bytes into a fresh Uint8Array backed by a real
// ArrayBuffer (not ArrayBufferLike). Needed so the values type-unify
// with Prisma's `Bytes` field input.
function toBytes(b: Buffer): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(b.byteLength);
  const out = new Uint8Array(ab);
  out.set(b);
  return out;
}

function loadKey(): { key: Buffer; version: number } {
  // Pull from getServerEnv() so the key bytes and the key version always
  // come from the same cached snapshot. Reading process.env directly here
  // could disagree with the cached snapshot during a rolling deploy.
  const env = getServerEnv();
  const key = Buffer.from(env.tokenEncryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`,
    );
  }
  return { key, version: env.tokenEncryptionKeyVersion };
}

export function encryptToken(plaintext: string): EncryptedToken {
  const { key, version } = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: toBytes(ciphertext),
    iv: toBytes(iv),
    authTag: toBytes(cipher.getAuthTag()),
    keyVersion: version,
  };
}

export function decryptToken(record: {
  accessTokenCiphertext: Uint8Array;
  accessTokenIv: Uint8Array;
  accessTokenAuthTag: Uint8Array;
  encryptionKeyVersion: number;
}): string {
  const { key, version } = loadKey();
  if (record.encryptionKeyVersion !== version) {
    throw new Error(
      `Token was encrypted with key version ${record.encryptionKeyVersion}, ` +
        `but TOKEN_ENCRYPTION_KEY_VERSION is ${version}. Rotate or load the older key.`,
    );
  }
  const decipher = createDecipheriv(
    ALGO,
    key,
    Buffer.from(record.accessTokenIv),
  );
  decipher.setAuthTag(Buffer.from(record.accessTokenAuthTag));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.accessTokenCiphertext)),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
