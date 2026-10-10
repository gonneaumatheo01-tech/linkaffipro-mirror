import { prisma } from "@linkaffipro/db";
import { listAdminChannels, MtprotoFloodWait, type AdminChannel } from "@linkaffipro/mtproto";
import { readOurAdminsForChat } from "@linkaffipro/telegram";
import { getTelegramSessionSecret, getTelegramSessionView, getTelegramUserApi } from "@/lib/views/session";

export type AccountChannelRow = AdminChannel & {
  /** Canal déjà en base (id interne et titre), sinon null. */
  known: { id: string } | null;
  /** Nos bots administrateurs du canal (vérifié par getChatAdministrators). */
  botAdmins: string[];
  /** Pourquoi la vérification des bots n'a pas abouti (aucun de nos bots n'y est administrateur, ou erreur). */
  checkNote: string | null;
};

/** Le compte Telegram (MTProto, phase 7) est-il connecté et utilisable ? */
export async function isAccountSessionActive(): Promise<boolean> {
  const view = await getTelegramSessionView();
  if (!view || view.status !== "ACTIVE") return false;
  return (await getTelegramUserApi()) !== null;
}

/** Message d'erreur lisible, sans session ni secret. */
export function describeAccountError(err: unknown): string {
  if (err instanceof MtprotoFloodWait)
    return `Telegram demande d'attendre ${err.seconds} seconde${err.seconds > 1 ? "s" : ""} avant de réessayer.`;
  if (err instanceof Error) return err.message;
  return "Erreur inconnue.";
}

/**
 * Canaux dont le compte connecté est administrateur ou créateur, avec pour chacun : déjà connu ?, nos bots administrateurs.
 * Aucune écriture (l'import est une action séparée). Aucune modification des droits Telegram.
 */
export async function listAccountChannels(): Promise<{ ok: true; rows: AccountChannelRow[]; firstBot: string | null } | { ok: false; error: string }> {
  const [secret, creds] = await Promise.all([getTelegramSessionSecret(), getTelegramUserApi()]);
  if (!secret || secret.status !== "ACTIVE") return { ok: false, error: "Le compte Telegram n'est pas connecté (Réglages → Connecteurs → Telegram)." };
  if (!creds) return { ok: false, error: "L'application Telegram (api_id / api_hash) n'est pas configurée (Réglages → Connecteurs → Telegram)." };
  let channels: AdminChannel[];
  try {
    channels = await listAdminChannels(secret.session, creds);
  } catch (err) {
    return { ok: false, error: describeAccountError(err) };
  }
  await prisma.telegramUserSession.updateMany({ where: { id: "main" }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  const ids = channels.map((c) => BigInt(c.telegramChatId));
  const [known, bots] = await Promise.all([
    prisma.channel.findMany({ where: { telegramChatId: { in: ids } }, select: { id: true, telegramChatId: true } }),
    prisma.bot.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, username: true, telegramBotId: true, tokenEncrypted: true } }),
  ]);
  const knownById = new Map(known.map((k) => [k.telegramChatId.toString(), k]));
  const rows: AccountChannelRow[] = [];
  for (const c of channels) {
    const read = await readOurAdminsForChat(BigInt(c.telegramChatId), bots);
    rows.push({
      ...c,
      known: knownById.get(c.telegramChatId) ? { id: knownById.get(c.telegramChatId)!.id } : null,
      botAdmins: read.ok ? read.admins.map((a) => a.username) : [],
      checkNote: read.ok ? null : read.reason === "not_admin" ? "aucun de nos bots n'est administrateur" : read.reason === "no_bot" ? "aucun bot actif" : `vérification impossible (${read.message})`,
    });
  }
  return { ok: true, rows, firstBot: bots[0]?.username ?? null };
}
