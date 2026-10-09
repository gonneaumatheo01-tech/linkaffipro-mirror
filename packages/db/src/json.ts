import type { Prisma } from "@prisma/client";

/**
 * Convertit une valeur quelconque en JSON sérialisable (BigInt → chaîne, Date → ISO, undefined retiré).
 * Utile pour stocker des updates Telegram bruts dans une colonne JSON.
 */
export function toJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as T;
}

/** Même chose, typé pour une colonne JSON Prisma. */
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return toJson(value) as Prisma.InputJsonValue;
}
