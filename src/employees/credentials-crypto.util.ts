import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/** Reversible encryption for the auto-generated staff login password —
 * separate from the bcrypt hash used to actually check a login (bcrypt
 * is one-way by design). This lets the owner look the password back up
 * from the employee's detail screen. Deliberately NOT used for
 * anything else (the owner's own account, reset-password flows, etc.)
 * — those stay bcrypt-only.
 *
 * scryptSync derives a fixed 32-byte key from whatever secret string is
 * configured, so the configured secret doesn't need to be exactly the
 * right length itself. */
function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'fitnexus-credentials-salt', 32);
}

export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(encoded: string, secret: string): string {
  const [ivB64, tagB64, ciphertextB64] = encoded.split('.');
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted value.');
  }
  const key = deriveKey(secret);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
