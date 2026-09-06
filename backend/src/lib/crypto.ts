import crypto from 'crypto';
import { env } from '../env';

// A free, self-hosted stand-in for the platform spec's KMS-based envelope
// encryption (§4.2/§4.3): AES-256-GCM with a key derived from an env var,
// using Node's built-in crypto module — no external service, no cost.
//
// This is genuinely reasonable for a self-hosted single-tenant-per-deploy
// setup. It is NOT the same guarantee as per-workspace KMS-managed keys
// (one compromised env var here can decrypt every workspace's credentials
// in this deployment, whereas the spec's design isolates blast radius per
// workspace). Swap this module for a real KMS call when you're ready to
// pay for that isolation — nothing else in the codebase needs to change,
// since every caller only ever sees encrypt()/decrypt().
function encryptionKey() {
  return crypto.createHash('sha256').update(env.CREDENTIALS_ENCRYPTION_KEY).digest();
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
