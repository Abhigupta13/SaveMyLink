/**
 * Symmetric encryption for secrets that have to come back out again — today, a user's own
 * Sarvam API key. Hashing is the right answer for a PIN or a password; it is the wrong answer
 * for a key we have to present to Sarvam on their behalf.
 *
 * AES-256-GCM, so a tampered ciphertext fails to open rather than decrypting to garbage that
 * then gets sent somewhere as a credential. The key is sha256(NEXTAUTH_SECRET) — the same
 * derivation `safeCookie.ts` uses, so there is exactly one secret to rotate and no new
 * environment variable to forget on a deploy.
 *
 * The prefix is a version, not decoration: rotating the derivation later means reading old
 * boxes while writing new ones, and without a marker that is a guessing game.
 *
 * ponytail: one process-wide key. Per-user keys would survive a stolen NEXTAUTH_SECRET, but
 * they need a passphrase the user types every time — that is the Round 7 conversation.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const V = 'v1';

const boxKey = () => {
  const secret = process.env.NEXTAUTH_SECRET;
  // Deriving from an empty string would "work" and encrypt everything under a publicly
  // known key. Refuse instead — a missing secret is a broken deploy, not a degraded one.
  if (!secret) throw new Error('NEXTAUTH_SECRET is required to store a secret');
  return createHash('sha256').update(secret).digest();
};

/** `v1.iv.ciphertext.tag`, all base64url — safe to put in a DB field, a cookie or a URL. */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', boxKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [V, iv.toString('base64url'), enc.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

/** null for anything that is not an intact box we sealed — never a partial or guessed result. */
export function open(box?: string | null): string | null {
  try {
    const [v, iv, enc, tag] = String(box || '').split('.');
    if (v !== V || !iv || !enc || !tag) return null;
    const decipher = createDecipheriv('aes-256-gcm', boxKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;   // wrong secret, tampered ciphertext, junk input — all the same answer
  }
}
