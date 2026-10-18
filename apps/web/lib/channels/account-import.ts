import { prisma } from "@linkaffipro/db";
import {
  listAdminChannels,
  MtprotoAuthError,
  MtprotoFloodWait,
  TELEGRAM_SESSION_ID,
  type AdminChannel,
} from "@linkaffipro/mtproto";
import {
  getRedis,
  MtprotoLockBusy,
  MtprotoLockUnavailable,
  withMtprotoLock,
} from "@linkaffipro/queue";
import {
  listActiveBots,
  mapWithLimit,
  readOurAdminsForChat,
  type ReadAdminsResult,
} from "@linkaffipro/telegram";
import {
  getTelegramSessionSecret,
  getTelegramSessionView,
  getTelegramUserApi,
} from "@/lib/views/session";

export type AccountChannelRow = AdminChannel & {
  /** Canal déjà en base (id interne et titre), sinon null. */
  known: { id: string } | null;
  /** Nos bots administrateurs du canal (vérifié par getChatAdministrators). */
  botAdmins: string[];
  /** Pourquoi la vérification des bots n'a pas abouti (aucun de nos bots n'y est administrateur, ou erreur). */
  checkNote: string | null;
};

/** Canaux lus en parallèle (getChatAdministrators) : 5 à la fois, assez rapide sans dépasser les limites de Telegram. */
const READ_CONCURRENCY = 5;
/** Attente maximale du verrou de la session si le worker relève les vues au même moment. */
const LOCK_WAIT_MS = 15_000;

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
  if (err instanceof MtprotoAuthError)
    return "La session Telegram n'est plus valable : reconnectez le compte dans Réglages → Connexions → Telegram.";
  if (err instanceof MtprotoLockBusy) return err.message;
  // Redis lent ou absent : message simple, le détail technique reste dans les journaux.
  if (err instanceof MtprotoLockUnavailable) {
    console.warn("[channels/import] verrou de la session Telegram indisponible", err.cause);
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Erreur inconnue.";
}

/** Ligne « Nos bots administrateurs » d'un canal du compte, à partir de la lecture des administrateurs. Pure (testée). */
export function accountRow(
  c: AdminChannel,
  read: ReadAdminsResult,
  knownId: string | null,
): AccountChannelRow {
  return {
    ...c,
    known: knownId ? { id: knownId } : null,
    botAdmins: read.ok ? read.admins.map((a) => a.username) : [],
    checkNote: read.ok
      ? null
      : read.reason === "not_admin"
        ? "aucun de nos bots n'est administrateur"
        : read.reason === "no_bot"
          ? "aucun bot actif"
          : `vérification impossible (${read.message})`,
  };
}

/**
 * Canaux dont le compte connecté est administrateur ou créateur, avec pour chacun : déjà connu ?, nos bots administrateurs.
 * Aucune écriture (l'import est une action séparée). Aucune modification des droits Telegram.
 * La session est tenue sous le verrou partagé avec le worker (jamais deux connexions en même temps).
 */
export async function listAccountChannels(): Promise<
  { ok: true; rows: AccountChannelRow[]; firstBot: string | null } | { ok: false; error: string }
> {
  const [secret, creds] = await Promise.all([getTelegramSessionSecret(), getTelegramUserApi()]);
  if (!secret || secret.status !== "ACTIVE")
    return {
      ok: false,
      error: "Le compte Telegram n'est pas connecté (Réglages → Connexions → Telegram).",
    };
  if (!creds)
    return {
      ok: false,
      error:
        "L'application Telegram (api_id / api_hash) n'est pas configurée (Réglages → Connexions → Telegram).",
    };
  let channels: AdminChannel[];
  try {
    channels = await withMtprotoLock(getRedis(), () => listAdminChannels(secret.session, creds), {
      waitMs: LOCK_WAIT_MS,
      owner: "web:import",
    });
  } catch (err) {
    if (err instanceof MtprotoAuthError) {
      // Même règle que le worker : la session est marquée « à reconnecter ».
      await prisma.telegramUserSession
        .updateMany({
          where: { id: TELEGRAM_SESSION_ID },
          data: { status: "ERROR", lastError: err.message },
        })
        .catch(() => undefined);
    }
    return { ok: false, error: describeAccountError(err) };
  }
  await prisma.telegramUserSession
    .updateMany({ where: { id: TELEGRAM_SESSION_ID }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  const ids = channels.map((c) => BigInt(c.telegramChatId));
  const [known, bots] = await Promise.all([
    prisma.channel.findMany({
      where: { telegramChatId: { in: ids } },
      select: { id: true, telegramChatId: true },
    }),
    listActiveBots(),
  ]);
  const knownById = new Map(known.map((k) => [k.telegramChatId.toString(), k.id]));
  // Un seul appel réussi par canal suffit (liste complète grâce à return_bots) ; 5 canaux à la fois.
  const rows = await mapWithLimit(channels, READ_CONCURRENCY, async (c) =>
    accountRow(
      c,
      await readOurAdminsForChat(BigInt(c.telegramChatId), bots),
      knownById.get(c.telegramChatId) ?? null,
    ),
  );
  // Bot à ajouter comme administrateur (aide de la page) : jamais un assistant de conversation (phase 17).
  const firstBot = bots.find((b) => (b.mode ?? "STANDARD") === "STANDARD")?.username ?? null;
  return { ok: true, rows, firstBot };
}
