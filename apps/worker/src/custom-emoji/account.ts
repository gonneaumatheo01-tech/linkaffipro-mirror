/**
 * Compte Telegram connecté, phase 12 (file `custom-emoji`) :
 * - `account-status` : Premium ? droit de publier dans chaque canal ? → `Setting` `mtproto.publishStatus` (forme
 *   `MtprotoPublishStatus` de @linkaffipro/core), lu par le site avant de programmer un message avec emojis animés ;
 * - passage périodique : état rafraîchi s'il date de plus d'une heure (ou si la session a changé d'état) ;
 * - `import-account` : packs d'emojis animés installés sur le compte → bibliothèque (source ACCOUNT), puis aperçus. Les
 *   packs déjà complets dans la bibliothèque ne sont pas relus : une reprise après une attente imposée par Telegram
 *   continue là où la lecture s'était arrêtée ; au plus `MAX_IMPORT_RESUMES` reprises, puis l'import est signalé partiel.
 * Toujours sous le verrou de la session (`withMtprotoLock`) : un seul client Telegram à la fois avec le relevé des vues,
 * la publication des messages et le site.
 */
import type { MtprotoPublishStatus } from "@linkaffipro/core";
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import {
  getAccountPublishInfo,
  listInstalledEmojiPacks,
  MtprotoAuthError,
  MtprotoFloodWait,
  TELEGRAM_SESSION_ID,
  type AccountPublishInfo,
  type InstalledPacksOptions,
  type InstalledPacksResult,
  type MtprotoCredentials,
} from "@linkaffipro/mtproto";
import {
  enqueue,
  getRedis,
  MtprotoLockBusy,
  MtprotoLockUnavailable,
  withMtprotoLock,
} from "@linkaffipro/queue";
import { logger } from "../logger";
import { loadActiveSession } from "../views/credentials";
import { enqueuePreviewJobs } from "./previews";

/** Réglage partagé avec le site : état du compte pour publier. */
export const PUBLISH_STATUS_SETTING = "mtproto.publishStatus";
/** État considéré à jour pendant une heure (passage périodique). */
export const STATUS_MAX_AGE_MS = 3600_000;
/** Canaux vérifiés au plus par passage. */
const STATUS_MAX_CHANNELS = 200;
/** Attente du verrou de la session : courte pour un relevé, plus longue pour une demande de l'équipe. */
const LOCK_WAIT_MS = 30_000;
/** Nouvel essai d'une demande de l'équipe quand la session est occupée. */
const BUSY_RETRY_MS = 60_000;
/** Attente imposée par Telegram au-delà de laquelle on n'enfile plus de nouvel essai automatique. */
const MAX_RESUME_WAIT_S = 6 * 3600;
/** Reprises automatiques au plus d'un import interrompu par Telegram (au-delà : import signalé partiel). */
export const MAX_IMPORT_RESUMES = 5;

export const NOT_CONNECTED_MESSAGE =
  "Aucun compte Telegram connecté : connectez votre compte dans Réglages → Connexions → Telegram.";
export const SESSION_EXPIRED_MESSAGE =
  "La session du compte Telegram connecté a expiré ou a été révoquée : reconnectez-le dans Réglages → Connexions → Telegram.";
export const APP_MISSING_MESSAGE =
  "Les identifiants de l'application Telegram manquent : complétez Réglages → Connexions → Telegram.";

/** Raison (française, pour l'équipe) pour laquelle aucune session n'est utilisable, d'après `loadActiveSession`. */
export function sessionProblemMessage(reason: string | null): string {
  const r = reason ?? "";
  if (/non connecté/.test(r)) return NOT_CONNECTED_MESSAGE;
  if (/application/.test(r)) return APP_MISSING_MESSAGE;
  if (/non prêt \((ERROR)\)|illisible|vide/.test(r)) return SESSION_EXPIRED_MESSAGE;
  if (/non prêt/.test(r)) return NOT_CONNECTED_MESSAGE;
  return SESSION_EXPIRED_MESSAGE;
}

/** Lit l'état enregistré (null si absent ou mal formé). */
export function parsePublishStatus(value: unknown): MtprotoPublishStatus | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<MtprotoPublishStatus>;
  if (typeof v.checkedAt !== "string" || typeof v.connected !== "boolean") return null;
  return {
    checkedAt: v.checkedAt,
    connected: v.connected,
    premium: typeof v.premium === "boolean" ? v.premium : null,
    user: v.user && typeof v.user === "object" ? v.user : null,
    error: typeof v.error === "string" ? v.error : null,
    channels: v.channels && typeof v.channels === "object" ? v.channels : {},
  };
}

export async function readPublishStatus(): Promise<MtprotoPublishStatus | null> {
  const row = await prisma.setting.findUnique({ where: { key: PUBLISH_STATUS_SETTING } });
  return parsePublishStatus(row?.value);
}

async function writePublishStatus(status: MtprotoPublishStatus): Promise<void> {
  const value = toJsonValue(status);
  await prisma.setting.upsert({
    where: { key: PUBLISH_STATUS_SETTING },
    create: { key: PUBLISH_STATUS_SETTING, value },
    update: { value },
  });
}

/** Modifie l'état enregistré (créé « non connecté » s'il n'existe pas encore). */
export async function patchPublishStatus(
  patch: (prev: MtprotoPublishStatus) => MtprotoPublishStatus,
  now: Date = new Date(),
): Promise<MtprotoPublishStatus> {
  const prev = (await readPublishStatus()) ?? {
    checkedAt: now.toISOString(),
    connected: false,
    premium: null,
    user: null,
    error: null,
    channels: {},
  };
  const next = patch(prev);
  await writePublishStatus(next);
  return next;
}

/**
 * Session refusée par Telegram (expirée, révoquée, utilisée ailleurs) : compte « à reconnecter » (TelegramUserSession
 * en ERROR, comme le relevé des vues), état de publication « non connecté » ; l'alerte « compte Telegram à reconnecter »
 * prévient l'administrateur.
 */
export async function markAccountSessionExpired(
  sessionId: string,
  err: MtprotoAuthError | null,
  now: Date = new Date(),
): Promise<void> {
  await prisma.telegramUserSession
    .update({
      where: { id: sessionId },
      data: { status: "ERROR", lastError: SESSION_EXPIRED_MESSAGE },
    })
    .catch(() => undefined);
  await patchPublishStatus(
    (prev) => ({
      ...prev,
      checkedAt: now.toISOString(),
      connected: false,
      error: SESSION_EXPIRED_MESSAGE,
    }),
    now,
  );
  logger.error(
    { code: err?.code ?? null },
    "compte Telegram connecté : session invalide, à reconnecter",
  );
}

/** Mémorise qu'un canal refuse la publication par le compte (droit retiré entre deux vérifications). */
export async function markChannelCannotPost(
  channelId: string,
  error: string,
  now: Date = new Date(),
): Promise<void> {
  await patchPublishStatus(
    (prev) => ({
      ...prev,
      channels: {
        ...prev.channels,
        [channelId]: { canPost: false, checkedAt: now.toISOString(), error },
      },
    }),
    now,
  );
}

/** Mémorise que le compte n'a plus Telegram Premium (Telegram a refusé ou retiré les emojis animés). */
export async function markAccountNotPremium(now: Date = new Date()): Promise<void> {
  await patchPublishStatus((prev) => ({ ...prev, premium: false }), now);
}

export type AccountStatusDeps = {
  loadSession: typeof loadActiveSession;
  lock: <T>(fn: () => Promise<T>, opts: { owner: string; waitMs: number }) => Promise<T>;
  readInfo: (
    session: string,
    creds: MtprotoCredentials,
    chatIds: readonly string[],
  ) => Promise<AccountPublishInfo>;
  listPacks: (
    session: string,
    creds: MtprotoCredentials,
    opts?: InstalledPacksOptions,
  ) => Promise<InstalledPacksResult>;
};

export const defaultAccountDeps: AccountStatusDeps = {
  loadSession: loadActiveSession,
  lock: (fn, opts) => withMtprotoLock(getRedis(), fn, opts),
  readInfo: getAccountPublishInfo,
  listPacks: (session, creds, opts) => listInstalledEmojiPacks(session, creds, opts),
};

export type AccountStatusResult = {
  checked: number;
  connected: boolean;
  premium: boolean | null;
  skipped?: string;
  retryInMs?: number;
};

async function retryLater(
  data:
    | { type: "account-status"; channelIds?: string[] }
    | { type: "import-account"; requestedById?: string | null },
  delayMs: number,
  now: Date,
): Promise<void> {
  await enqueue("custom-emoji", data, {
    jobId: `custom-emoji:${data.type}:retry:${now.getTime()}`,
    delay: delayMs,
  }).catch((err: unknown) => logger.warn({ err: String(err) }, "nouvel essai non enfilé"));
}

/**
 * Relève l'état du compte : Premium, et droit de publier dans les canaux demandés (`channelIds` = `Channel.id`), sinon
 * dans tous les canaux actifs. Les canaux non vérifiés gardent leur état précédent (si c'est le même compte).
 * Une demande explicite de l'équipe (bouton « Vérifier ») est réessayée si la session est occupée ou si Telegram impose
 * une attente ; le passage périodique, lui, attend le suivant.
 */
export async function refreshAccountStatus(
  input: { channelIds?: string[]; explicit?: boolean } = {},
  deps: AccountStatusDeps = defaultAccountDeps,
  now: Date = new Date(),
): Promise<AccountStatusResult> {
  const explicit = input.explicit ?? input.channelIds !== undefined;
  const { active, reason } = await deps.loadSession();
  if (!active) {
    const error = sessionProblemMessage(reason);
    const s = await patchPublishStatus(
      (prev) => ({ ...prev, checkedAt: now.toISOString(), connected: false, error }),
      now,
    );
    return {
      checked: 0,
      connected: false,
      premium: s.premium,
      skipped: reason ?? "compte non connecté",
    };
  }
  const channels = await prisma.channel.findMany({
    where: input.channelIds ? { id: { in: input.channelIds } } : { isActive: true },
    orderBy: { createdAt: "asc" },
    take: STATUS_MAX_CHANNELS,
    select: { id: true, telegramChatId: true },
  });
  let info: AccountPublishInfo;
  try {
    info = await deps.lock(
      () =>
        deps.readInfo(
          active.session,
          active.creds,
          channels.map((c) => c.telegramChatId.toString()),
        ),
      { owner: "worker:account-status", waitMs: explicit ? LOCK_WAIT_MS * 2 : LOCK_WAIT_MS },
    );
  } catch (err) {
    if (err instanceof MtprotoLockBusy || err instanceof MtprotoLockUnavailable) {
      if (explicit)
        await retryLater(
          { type: "account-status", channelIds: input.channelIds },
          BUSY_RETRY_MS,
          now,
        );
      return {
        checked: 0,
        connected: true,
        premium: null,
        skipped: "session occupée",
        ...(explicit ? { retryInMs: BUSY_RETRY_MS } : {}),
      };
    }
    if (err instanceof MtprotoFloodWait) {
      const delay = (err.seconds + 5) * 1000;
      if (explicit && err.seconds <= MAX_RESUME_WAIT_S)
        await retryLater({ type: "account-status", channelIds: input.channelIds }, delay, now);
      logger.warn(
        { seconds: err.seconds },
        "état du compte Telegram : attente imposée par Telegram",
      );
      return {
        checked: 0,
        connected: true,
        premium: null,
        skipped: "attente imposée par Telegram",
        retryInMs: delay,
      };
    }
    if (err instanceof MtprotoAuthError) {
      await markAccountSessionExpired(active.id, err, now);
      return { checked: 0, connected: false, premium: null, skipped: "session invalide" };
    }
    // Réseau ou erreur inconnue : l'état précédent reste (il ne doit pas bloquer la programmation à tort).
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "état du compte Telegram illisible",
    );
    throw err;
  }
  const at = now.toISOString();
  const byChatId = new Map(channels.map((c) => [c.telegramChatId.toString(), c.id]));
  const checked: MtprotoPublishStatus["channels"] = {};
  for (const [chatId, right] of Object.entries(info.channels)) {
    const id = byChatId.get(chatId);
    if (id) checked[id] = { canPost: right.canPost, checkedAt: at, error: right.error };
  }
  await patchPublishStatus(
    (prev) => ({
      checkedAt: at,
      connected: true,
      premium: info.premium,
      user: { id: info.user.id, firstName: info.user.firstName, username: info.user.username },
      error: null,
      // Un autre compte connecté entre-temps : les anciens droits ne valent plus.
      channels: { ...(prev.user?.id === info.user.id ? prev.channels : {}), ...checked },
    }),
    now,
  );
  await prisma.telegramUserSession
    .update({ where: { id: active.id }, data: { lastUsedAt: now } })
    .catch(() => undefined);
  return { checked: Object.keys(checked).length, connected: true, premium: info.premium };
}

/**
 * Passage périodique : session devenue inutilisable → état « non connecté » (sans appel à Telegram) ; session active
 * et état absent, « non connecté » ou vieux de plus d'une heure → nouveau relevé de tous les canaux actifs.
 */
export async function tickAccountStatus(
  deps: AccountStatusDeps = defaultAccountDeps,
  now: Date = new Date(),
): Promise<AccountStatusResult | { skipped: string }> {
  const [row, prev] = await Promise.all([
    prisma.telegramUserSession.findUnique({
      where: { id: TELEGRAM_SESSION_ID },
      select: { status: true },
    }),
    readPublishStatus(),
  ]);
  if (!row || row.status !== "ACTIVE") {
    if (!prev || prev.connected) {
      const error = row?.status === "ERROR" ? SESSION_EXPIRED_MESSAGE : NOT_CONNECTED_MESSAGE;
      await patchPublishStatus(
        (p) => ({ ...p, checkedAt: now.toISOString(), connected: false, error }),
        now,
      );
    }
    return { skipped: "compte non connecté" };
  }
  const age = prev ? now.getTime() - new Date(prev.checkedAt).getTime() : Number.POSITIVE_INFINITY;
  if (prev && prev.connected && !prev.error && age < STATUS_MAX_AGE_MS)
    return { skipped: "état à jour" };
  return refreshAccountStatus({ explicit: false }, deps, now);
}

export type AccountImportResult = {
  added: number;
  already: number;
  packs: number;
  totalPacks?: number;
  /** Packs déjà complets dans la bibliothèque, non relus. */
  skippedPacks?: number;
  /** Lecture interrompue par Telegram, reprises automatiques épuisées : import partiel (à relancer plus tard). */
  partialStopped?: boolean;
  skipped?: string;
  retryInMs?: number;
};

/** Emojis de la bibliothèque par pack (retirés compris : un emoji retiré reste retiré, son pack est complet). */
async function libraryPackCounts(): Promise<Map<string, number>> {
  const rows = await prisma.customEmoji.groupBy({
    by: ["setName"],
    where: { setName: { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.setName as string, r._count._all]));
}

/**
 * Passages d'import interrompus par Telegram juste avant celui-ci (événements `custom_emoji.added` du compte marqués
 * `partial`, du plus récent au plus ancien) : la série s'arrête au dernier import complet ou abandonné.
 */
async function previousPartialImports(): Promise<number> {
  const events = await prisma.event.findMany({
    where: { type: "custom_emoji.added", payload: { path: ["source"], equals: "ACCOUNT" } },
    // Identifiant en second : deux passages dans la même milliseconde gardent leur ordre d'écriture.
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: MAX_IMPORT_RESUMES + 1,
    select: { payload: true },
  });
  let n = 0;
  for (const e of events) {
    const p = (e.payload ?? {}) as { partial?: unknown; resumeStopped?: unknown };
    if (p.partial !== true || p.resumeStopped === true) break;
    n++;
  }
  return n;
}

/** Utilisateur qui a demandé l'import, s'il existe encore (clé étrangère de `CustomEmoji.addedById`). */
async function existingUserId(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true } }).catch(() => null);
  return u?.id ?? null;
}

/**
 * Import des packs d'emojis animés installés sur le compte connecté : chaque emoji est ajouté une seule fois (unicité de
 * `customEmojiId`, source ACCOUNT) ; un emoji déjà connu est seulement complété (pack, format, emoji de remplacement
 * manquants), et un emoji retiré par un administrateur reste retiré. Événement `custom_emoji.added` à chaque import
 * terminé (même sans nouvel emoji : le site sait que l'import est fini), puis aperçus des nouveaux.
 */
export async function importAccountEmojis(
  input: { requestedById?: string | null } = {},
  deps: AccountStatusDeps = defaultAccountDeps,
  now: Date = new Date(),
): Promise<AccountImportResult> {
  const { active, reason } = await deps.loadSession();
  if (!active) {
    logger.warn({ reason }, "import des emojis du compte : aucune session utilisable");
    return { added: 0, already: 0, packs: 0, skipped: reason ?? "compte non connecté" };
  }
  // Packs déjà complets dans la bibliothèque : non relus (reprise là où la lecture s'était arrêtée).
  const known = await libraryPackCounts();
  const skipPack = (p: { shortName: string; count: number }) =>
    p.count > 0 && (known.get(p.shortName) ?? 0) >= p.count;
  let res: InstalledPacksResult;
  try {
    res = await deps.lock(() => deps.listPacks(active.session, active.creds, { skipPack }), {
      owner: "worker:emoji-import",
      waitMs: LOCK_WAIT_MS * 2,
    });
  } catch (err) {
    if (err instanceof MtprotoLockBusy || err instanceof MtprotoLockUnavailable) {
      await retryLater(
        { type: "import-account", requestedById: input.requestedById ?? null },
        BUSY_RETRY_MS,
        now,
      );
      return {
        added: 0,
        already: 0,
        packs: 0,
        skipped: "session occupée",
        retryInMs: BUSY_RETRY_MS,
      };
    }
    if (err instanceof MtprotoFloodWait) {
      const delay = (err.seconds + 5) * 1000;
      if (err.seconds <= MAX_RESUME_WAIT_S)
        await retryLater(
          { type: "import-account", requestedById: input.requestedById ?? null },
          delay,
          now,
        );
      return {
        added: 0,
        already: 0,
        packs: 0,
        skipped: "attente imposée par Telegram",
        retryInMs: delay,
      };
    }
    if (err instanceof MtprotoAuthError) {
      await markAccountSessionExpired(active.id, err, now);
      return { added: 0, already: 0, packs: 0, skipped: "session invalide" };
    }
    throw err;
  }

  // Un emoji par identifiant (le premier pack qui le contient l'emporte).
  const rows = new Map<
    string,
    {
      customEmojiId: string;
      fallback: string;
      format: string | null;
      setName: string;
      setTitle: string;
    }
  >();
  for (const p of res.packs)
    for (const e of p.emojis)
      if (!rows.has(e.customEmojiId))
        rows.set(e.customEmojiId, { ...e, setName: p.shortName, setTitle: p.title });
  const ids = [...rows.keys()];
  const existing = ids.length
    ? await prisma.customEmoji.findMany({
        where: { customEmojiId: { in: ids } },
        select: {
          customEmojiId: true,
          fallback: true,
          format: true,
          setName: true,
          setTitle: true,
          previewMime: true,
        },
      })
    : [];
  const byId = new Map(existing.map((e) => [e.customEmojiId, e]));
  const fresh = ids.filter((id) => !byId.has(id));
  const addedById = await existingUserId(input.requestedById);
  if (fresh.length > 0)
    await prisma.customEmoji.createMany({
      data: fresh.map((id) => {
        const r = rows.get(id)!;
        return {
          customEmojiId: id,
          fallback: r.fallback,
          format: r.format,
          setName: r.setName,
          setTitle: r.setTitle,
          source: "ACCOUNT" as const,
          addedById,
        };
      }),
      skipDuplicates: true,
    });
  const updates = existing.flatMap((e) => {
    const r = rows.get(e.customEmojiId)!;
    const data = {
      ...(e.setName ? {} : { setName: r.setName }),
      ...(e.setTitle ? {} : { setTitle: r.setTitle }),
      ...(e.format || !r.format ? {} : { format: r.format }),
      ...(e.fallback.trim() ? {} : { fallback: r.fallback }),
    };
    return Object.keys(data).length > 0
      ? [prisma.customEmoji.update({ where: { customEmojiId: e.customEmojiId }, data })]
      : [];
  });
  for (let i = 0; i < updates.length; i += 200)
    await prisma.$transaction(updates.slice(i, i + 200));

  const needPreview = [
    ...fresh,
    ...existing.filter((e) => !e.previewMime).map((e) => e.customEmojiId),
  ];
  // Aperçus en tâches d'un lot, moins prioritaires : une vérification du compte ou un nouvel import passe devant.
  if (needPreview.length > 0) await enqueuePreviewJobs(needPreview, `account:${now.getTime()}`);

  const partial = res.floodWaitSeconds !== null;
  const canResume = partial && res.floodWaitSeconds! <= MAX_RESUME_WAIT_S;
  // Reprises épuisées : l'import s'arrête et l'équipe voit qu'il est partiel (relancer plus tard reprend la suite).
  const resumeStopped = canResume && (await previousPartialImports()) >= MAX_IMPORT_RESUMES;
  await recordEvent({
    type: "custom_emoji.added",
    payload: toJsonValue({
      count: fresh.length,
      source: "ACCOUNT",
      ids: fresh.slice(0, 2000),
      already: existing.length,
      packs: res.packs.length,
      totalPacks: res.total,
      skippedPacks: res.skippedPacks,
      partial,
      ...(partial ? { resumeStopped: resumeStopped || !canResume } : {}),
      userId: addedById,
    }),
  });
  await prisma.telegramUserSession
    .update({ where: { id: active.id }, data: { lastUsedAt: now } })
    .catch(() => undefined);
  let retryInMs: number | undefined;
  if (canResume && !resumeStopped) {
    // Lecture interrompue par Telegram : la suite reprend après l'attente, sans relire les packs déjà complets.
    retryInMs = (res.floodWaitSeconds! + 5) * 1000;
    await retryLater(
      { type: "import-account", requestedById: input.requestedById ?? null },
      retryInMs,
      now,
    );
  }
  logger.info(
    {
      added: fresh.length,
      already: existing.length,
      packs: res.packs.length,
      total: res.total,
      skippedPacks: res.skippedPacks,
      partial,
      resumeStopped,
    },
    resumeStopped
      ? "emojis du compte importés en partie : reprises épuisées, import à relancer plus tard"
      : "emojis du compte importés",
  );
  return {
    added: fresh.length,
    already: existing.length,
    packs: res.packs.length,
    totalPacks: res.total,
    skippedPacks: res.skippedPacks,
    ...(partial && (resumeStopped || !canResume) ? { partialStopped: true } : {}),
    ...(retryInMs ? { retryInMs } : {}),
  };
}
