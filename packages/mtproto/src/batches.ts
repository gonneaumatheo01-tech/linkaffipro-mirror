/** Taille maximale d'un lot d'identifiants pour `messages.getMessagesViews` (limite Telegram : 100). */
export const VIEWS_BATCH_SIZE = 100;

/** Découpe une liste en lots de `size` éléments (dernier lot plus court), sans doublons ni valeurs invalides. */
export function chunkMessageIds(ids: readonly number[], size: number = VIEWS_BATCH_SIZE): number[][] {
  if (size < 1) throw new Error("La taille d'un lot doit être d'au moins 1");
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  const out: number[][] = [];
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out;
}

/**
 * Convertit l'identifiant Telegram d'un canal tel que stocké en base (BigInt, forme `-100…`) en nombre sûr pour GramJS.
 * Refuse les valeurs hors de l'intervalle des entiers sûrs (jamais le cas pour un canal, mais on vérifie).
 */
export function channelIdToNumber(telegramChatId: bigint | number | string): number {
  const big = typeof telegramChatId === "bigint" ? telegramChatId : BigInt(String(telegramChatId));
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error(`Identifiant de canal hors limites : ${big.toString()}`);
  return Number(big);
}
