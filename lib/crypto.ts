import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

// Encrypt secrets (OAuth tokens) at rest with AES-256-GCM when ENCRYPTION_KEY is
// set; otherwise store plaintext (clearly tagged) so the feature still works in
// dev. Never log the plaintext or the key.

const ENC_PREFIX = "enc:v1:";
const PLAIN_PREFIX = "plain:";

let warned = false;
function key(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production" && !warned) {
      warned = true;
      // Loud, once: secrets would be stored in plaintext in production.
      console.error("[crypto] ENCRYPTION_KEY is not set — OAuth tokens are stored UNENCRYPTED. Set it in production.");
    }
    return null;
  }
  // Accept any-length secret; derive a stable 32-byte key via sha256.
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const k = key();
  if (!k) return PLAIN_PREFIX + plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length);
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy/raw value
  const k = key();
  if (!k) throw new Error("ENCRYPTION_KEY required to decrypt");
  const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
