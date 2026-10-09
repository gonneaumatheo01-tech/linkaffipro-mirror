import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SHORT_ID_LENGTH = 8;

/**
 * Génère un identifiant court aléatoire en base62 (8 caractères par défaut).
 * Tirage uniforme : les octets au-delà de 248 (= 4 × 62) sont rejetés.
 */
export function shortId(length = SHORT_ID_LENGTH): string {
  if (!Number.isInteger(length) || length <= 0) throw new Error("length doit être un entier > 0");
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (const b of bytes) {
      if (b >= 248) continue;
      out += ALPHABET[b % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

const SHORT_ID_RE = /^[0-9A-Za-z]+$/;
export function isShortId(value: string, length = SHORT_ID_LENGTH): boolean {
  return value.length === length && SHORT_ID_RE.test(value);
}
