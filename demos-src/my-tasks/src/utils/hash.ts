import * as Crypto from 'expo-crypto';

/**
 * The database never stores email addresses. Accounts and friend lookups use
 * this one-way SHA-256 hash of the normalized address as an opaque ID instead.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function sha256Hex(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

export function emailHash(email: string): Promise<string> {
  return sha256Hex(normalizeEmail(email));
}
