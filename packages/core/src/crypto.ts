import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

/** Lit et valide la clé AES-256 (32 octets en base64) depuis une chaîne. */
export function parseEncryptionKey(keyBase64: string | undefined): Buffer {
  if (!keyBase64) throw new Error("APP_ENCRYPTION_KEY manquante");
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY doit faire 32 octets en base64");
  return key;
}

/**
 * Chiffre un texte avec AES-256-GCM. Format de sortie : `v1.<iv>.<tag>.<données>` (base64url).
 */
export function encrypt(plain: string, keyBase64: string | undefined = process.env.APP_ENCRYPTION_KEY): string {
  const key = parseEncryptionKey(keyBase64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string, keyBase64: string | undefined = process.env.APP_ENCRYPTION_KEY): string {
  const key = parseEncryptionKey(keyBase64);
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Format chiffré inconnu");
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const out = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]);
  return out.toString("utf8");
}

/** Hache une adresse IP avec un sel (SHA-256, hex). Jamais l'IP en clair en base. */
export function hashIp(ip: string, salt: string | undefined = process.env.IP_HASH_SALT): string {
  if (!salt) throw new Error("IP_HASH_SALT manquant");
  return createHash("sha256").update(`${salt}:${ip.trim()}`).digest("hex");
}

/** Jeton aléatoire sûr (hex). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Comparaison à temps constant de deux chaînes. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
