/**
 * Message de canal publié par le compte Telegram connecté (phase 12, `Post.publisher = ACCOUNT`) : Telegram interdit
 * les emojis animés aux bots dans les canaux. Publication MTProto (GramJS) sous le verrou de la session
 * (`withMtprotoLock` : un seul client à la fois avec le relevé des vues, l'import des emojis et le site) :
 * texte + entités (positions UTF-16), un média avec sa légende, ou un album (légende sur le premier) ; silencieux et
 * aperçu de lien comme demandé ; épingler, désépingler les précédents et supprimer après N minutes par la même session.
 * Jamais de boutons (réservés aux bots), jamais de modification ensuite par le bot.
 *
 * Doublons : le message reste « en cours d'envoi » (SENDING, non modifiable sur le site) pendant les attentes ; chaque
 * étape publiée est enregistrée aussitôt (`telegramMessageIds`), la reprise saute les étapes faites, et chaque envoi
 * porte un identifiant déterministe (message, heure programmée, étape) que Telegram refuse de publier deux fois. Ce refus
 * (RANDOM_ID_DUPLICATE : l'étape est partie lors d'un essai dont la réponse s'est perdue) vaut « étape publiée » : ses
 * messages sont retrouvés dans le canal (sinon le message passe « envoyé » avec une note, jamais « en échec »).
 * Des messages déjà publiés dans un autre canal (canal changé après une publication interrompue) ne sont jamais repris.
 * - FLOOD_WAIT (attente imposée) ou session occupée : nouvel essai planifié après l'attente (tâche différée). Les
 *   reports sont comptés pour la programmation en cours et par cause (événements `post.deferred`), jamais avec le
 *   compteur cumulé `attempts` ;
 * - session expirée ou révoquée : message en échec avec un texte clair, compte « à reconnecter », alerte ;
 * - droit de publier retiré, Premium perdu : message en échec, état du compte mis à jour (le site bloque la suite).
 */
import { prisma, recordEvent, toJsonValue, type Prisma } from "@linkaffipro/db";
import {
  AccountPostInvalid,
  MtprotoAuthError,
  MtprotoFloodWait,
  MtprotoRpcError,
  planAccountPost,
  stepsAlreadyDone,
  withAccountChannel,
  type AccountMedia,
  type AccountPostStep,
  type AccountStepResult,
} from "@linkaffipro/mtproto";
import {
  enqueue,
  getRedis,
  MtprotoLockBusy,
  MtprotoLockUnavailable,
  withMtprotoLock,
} from "@linkaffipro/queue";
import {
  markAccountNotPremium,
  markAccountSessionExpired,
  markChannelCannotPost,
  SESSION_EXPIRED_MESSAGE,
  sessionProblemMessage,
} from "../custom-emoji/account";
import { logger } from "../logger";
import { loadActiveSession } from "../views/credentials";
import { mediaKindOf } from "./media";
import { sendableBytes } from "../montage/media-bytes";
import { RateLimiter } from "./rate-limit";

/** Message et son canal tels que lus par le client partagé (petite photo du canal omise, voir `@linkaffipro/db`). */
export type AccountPost = Prisma.PostGetPayload<{
  include: { channel: { omit: { photoSmall: true } } };
}>;

/** Attente du verrou de la session avant de reporter l'envoi (le relevé des vues le rend entre deux canaux). */
export const ACCOUNT_LOCK_WAIT_MS = 60_000;
/** Délai du nouvel essai quand la session est occupée ou que la connexion a échoué. */
export const ACCOUNT_RETRY_DELAY_MS = 60_000;
/** Reports au plus pour une même programmation quand la session est occupée, et de même pour les attentes imposées. */
export const MAX_ACCOUNT_DEFERRALS = 8;
/** Pannes réseau ou inconnues reportées au plus pour une même programmation (au-delà : échec). */
export const MAX_NETWORK_DEFERRALS = 3;

/** Cause d'un report : session occupée, attente imposée par Telegram, réseau ou panne inconnue. */
export type DeferralCause = "busy" | "flood" | "network";
/** Plafond des reports par cause, pour une même programmation (une nouvelle heure programmée repart de zéro). */
export const MAX_DEFERRALS: Record<DeferralCause, number> = {
  busy: MAX_ACCOUNT_DEFERRALS,
  flood: MAX_ACCOUNT_DEFERRALS,
  network: MAX_NETWORK_DEFERRALS,
};
/** Marge avant l'heure programmée pour retrouver une étape déjà publiée (horloges de Telegram et du serveur). */
const FIND_PUBLISHED_MARGIN_MS = 5 * 60_000;
/** Attente imposée par Telegram au-delà de laquelle le message n'est plus reporté (il partirait bien trop tard). */
export const MAX_FLOOD_WAIT_S = 3600;

/** Erreurs Telegram qui disent que le compte ne peut pas publier dans ce canal. */
const CHANNEL_RIGHT_CODES = new Set([
  "CHAT_WRITE_FORBIDDEN",
  "CHAT_ADMIN_REQUIRED",
  "CHANNEL_PRIVATE",
  "CHANNEL_INVALID",
  "PEER_ID_INVALID",
  "USER_BANNED_IN_CHANNEL",
  "CHAT_SEND_MEDIA_FORBIDDEN",
  "USER_NOT_PARTICIPANT",
]);

export const EMOJIS_DROPPED_MESSAGE =
  "Publié, mais Telegram a retiré les emojis animés : vérifiez que le compte Telegram connecté a toujours Telegram Premium.";
/** Telegram dit que le message était déjà publié (essai précédent), mais il n'a pas été retrouvé dans le canal. */
export const ALREADY_PUBLISHED_NOT_FOUND_MESSAGE =
  "Publié lors d'un essai précédent (Telegram l'a confirmé), mais le message n'a pas été retrouvé dans le canal : pas de vues, d'épinglage ni de suppression automatique pour cette partie. Vérifiez le canal et supprimez-la à la main si besoin.";
/** Messages déjà publiés dans un autre canal que celui du message (canal changé après une publication interrompue). */
export const OTHER_CHANNEL_MESSAGE =
  "Une partie de ce message est déjà publiée dans un autre canal : supprimez-la dans Telegram, puis dupliquez ce message et programmez la copie (elle partira en entier).";

/** Opérations extérieures (remplacées dans les tests unitaires). */
export type AccountPostDeps = {
  loadSession: typeof loadActiveSession;
  lock: <T>(fn: () => Promise<T>, opts: { owner: string; waitMs: number }) => Promise<T>;
  openChannel: typeof withAccountChannel;
  /** Limite de débit par canal (20 messages par minute, partagée avec les bots). */
  paceChannel: (chatId: string) => Promise<void>;
  now: () => Date;
  /** Reports déjà faits pour cette programmation (`seed`) et cette cause. */
  countDeferrals: (post: AccountPost, seed: string, cause: DeferralCause) => Promise<number>;
  /** Canal où sont publiés les messages déjà enregistrés d'un message jamais terminé, null si inconnu. */
  partialChannelOf: (postId: string) => Promise<string | null>;
};

/** Reports journalisés (`post.deferred`) pour une programmation et une cause. */
export async function countDeferralEvents(
  post: AccountPost,
  seed: string,
  cause: DeferralCause,
): Promise<number> {
  // Les reports suivent l'heure programmée : la fenêtre ne sert qu'à lire peu de lignes (index type + date).
  const since = new Date((post.scheduledAt?.getTime() ?? Date.now()) - 24 * 3600_000);
  return prisma.event.count({
    where: {
      type: "post.deferred",
      occurredAt: { gte: since },
      AND: [
        { payload: { path: ["postId"], equals: post.id } },
        { payload: { path: ["seed"], equals: seed } },
        { payload: { path: ["cause"], equals: cause } },
      ],
    },
  });
}

/**
 * Canal des messages déjà publiés d'un message interrompu : le dernier échec ou report journalisé de ce message qui en
 * cite (`messageChannelId`, sinon le canal de l'événement). Null si aucun.
 */
export async function partialPublicationChannel(postId: string): Promise<string | null> {
  const events = await prisma.event.findMany({
    where: {
      type: { in: ["post.failed", "post.deferred"] },
      payload: { path: ["postId"], equals: postId },
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { channelId: true, payload: true },
  });
  for (const e of events) {
    const p = (e.payload ?? {}) as { messageIds?: unknown; messageChannelId?: unknown };
    if (!Array.isArray(p.messageIds) || p.messageIds.length === 0) continue;
    return typeof p.messageChannelId === "string" ? p.messageChannelId : e.channelId;
  }
  return null;
}

export const defaultAccountPostDeps: AccountPostDeps = {
  loadSession: loadActiveSession,
  lock: (fn, opts) => withMtprotoLock(getRedis(), fn, opts),
  openChannel: withAccountChannel,
  paceChannel: (chatId) => new RateLimiter(getRedis()).forChannel(chatId),
  now: () => new Date(),
  countDeferrals: countDeferralEvents,
  partialChannelOf: partialPublicationChannel,
};

function messageIdsOf(raw: unknown): number[] {
  return Array.isArray(raw)
    ? raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
    : [];
}

/** Durée lisible (« 45 s », « 3 min »). */
export function waitLabel(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  return `${Math.round(seconds / 60)} min`;
}

function parisTime(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { timeStyle: "short", timeZone: "Europe/Paris" }).format(
    d,
  );
}

async function loadMedias(post: AccountPost): Promise<AccountMedia[]> {
  const ids = Array.isArray(post.mediaAssetIds) ? (post.mediaAssetIds as string[]) : [];
  if (ids.length === 0) return [];
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: ids } } });
  const byId = new Map(assets.map((a) => [a.id, a]));
  const out: AccountMedia[] = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) continue;
    out.push({
      kind: mediaKindOf(a.mimeType),
      // Phase 28 : un short gardé dans Telegram est retrouvé (et refusé s'il n'est pas validé).
      bytes: a.storage === "telegram" || a.kind === "SHORT" ? await sendableBytes(a) : new Uint8Array(a.bytes),
      filename: a.filename,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
      duration: a.duration,
    });
  }
  return out;
}

async function failPost(
  post: AccountPost,
  message: string,
  sent: number[],
  messageChannelId: string = post.channelId,
): Promise<void> {
  const error =
    sent.length > 0 && messageChannelId === post.channelId
      ? `Publication interrompue après ${sent.length} message(s) : ${message}`
      : message;
  await prisma.post.update({
    where: { id: post.id },
    data: {
      status: "FAILED",
      lastError: error,
      attempts: { increment: 1 },
      ...(sent.length > 0 ? { telegramMessageIds: sent } : {}),
    },
  });
  await recordEvent({
    type: "post.failed",
    channelId: post.channelId,
    botId: post.botId,
    payload: toJsonValue({
      postId: post.id,
      error,
      publisher: "ACCOUNT",
      messageIds: sent,
      // Canal où ces messages sont publiés (peut différer du canal du message s'il a été changé entre-temps).
      ...(sent.length > 0 ? { messageChannelId } : {}),
    }),
  });
  logger.error(
    { postId: post.id, err: error },
    "échec de publication par le compte Telegram connecté",
  );
}

/**
 * Nouvel essai plus tard, sans doublon : le message reste « en cours d'envoi » et une tâche différée le reprend. Sans file
 * (Redis en panne), il redevient « programmé » à la même heure : le balayage le reprendra (même identifiant d'envoi).
 */
async function deferPost(
  post: AccountPost,
  delayMs: number,
  message: string,
  now: Date,
  info: { cause: DeferralCause; seed: string; sent: number[] },
): Promise<void> {
  // `attempts` reste cumulé (identifiant de tâche unique dans claim.ts) ; les plafonds se lisent dans le journal.
  await prisma.post.update({
    where: { id: post.id },
    data: { lastError: message, attempts: { increment: 1 } },
  });
  await recordEvent({
    type: "post.deferred",
    channelId: post.channelId,
    botId: post.botId,
    payload: toJsonValue({
      postId: post.id,
      publisher: "ACCOUNT",
      cause: info.cause,
      seed: info.seed,
      delayMs,
      reason: message,
      messageIds: info.sent,
      ...(info.sent.length > 0 ? { messageChannelId: post.channelId } : {}),
    }),
  });
  try {
    await enqueue(
      "telegram-send",
      { type: "post", postId: post.id },
      { jobId: `post:${post.id}:retry:${now.getTime()}`, delay: delayMs, attempts: 1 },
    );
  } catch (err) {
    logger.warn(
      { postId: post.id, err: String(err) },
      "nouvel essai non enfilé : message remis en programmé",
    );
    await prisma.post.update({ where: { id: post.id }, data: { status: "SCHEDULED" } });
  }
  logger.warn({ postId: post.id, delayMs, message }, "publication par le compte reportée");
}

export type AccountSendOutcome =
  | { status: "sent"; messageIds: number[] }
  | { status: "deferred"; delayMs: number }
  | { status: "failed"; error: string };

/** Publie un message de canal par le compte Telegram connecté (appelé par `sendPost` pour un message ACCOUNT). */
export async function sendPostAccount(
  post: AccountPost,
  deps: AccountPostDeps = defaultAccountPostDeps,
): Promise<AccountSendOutcome> {
  const now = deps.now();
  const already = messageIdsOf(post.telegramMessageIds);
  const fail = async (
    message: string,
    sent: number[] = already,
    messageChannelId?: string,
  ): Promise<AccountSendOutcome> => {
    await failPost(post, message, sent, messageChannelId);
    return { status: "failed", error: message };
  };

  const { active, reason } = await deps.loadSession();
  if (!active) return fail(`${sessionProblemMessage(reason)} Puis reprogrammez ce message.`);

  const medias = await loadMedias(post);
  let steps: AccountPostStep[];
  try {
    steps = planAccountPost({
      html: post.text ?? "",
      mediaCount: medias.length,
      disableLinkPreview: post.disableLinkPreview,
    });
  } catch (err) {
    if (err instanceof AccountPostInvalid) return fail(err.message);
    throw err;
  }
  if (already.length > 0 && !post.sentAt) {
    // Publication interrompue puis message modifié : si ses messages déjà publiés sont dans un autre canal, les étapes
    // ne doivent ni être sautées ici, ni leurs identifiants servir (vues, épinglage, suppression) dans ce canal.
    const where = await deps.partialChannelOf(post.id);
    if (where && where !== post.channelId) return fail(OTHER_CHANNEL_MESSAGE, already, where);
  }
  const startAt = stepsAlreadyDone(steps, already.length);
  const sent = [...already];
  if (startAt < 0) {
    // Une partie a déjà été publiée (échec puis reprogrammé) et le message a été modifié depuis : on ne republie rien à
    // l'aveugle (doublon dans le canal).
    return fail(
      "Une partie de ce message est déjà publiée dans le canal et il a été modifié depuis : supprimez cette partie dans Telegram ou dupliquez le message, puis reprogrammez-le.",
    );
  }

  if (Array.isArray(post.buttons) && post.buttons.length > 0)
    logger.warn(
      { postId: post.id },
      "boutons ignorés : un message publié par le compte n'a pas de boutons",
    );

  const chatId = post.channel.telegramChatId.toString();
  // Graine stable pendant les reports (même heure programmée), nouvelle si l'équipe reprogramme le message.
  const seedBase = `post:${post.id}:${post.scheduledAt?.getTime() ?? 0}`;
  let emojiSent = 0;
  let emojiKept = 0;
  let emojiKnown = true;
  /** Étapes déjà publiées lors d'un essai précédent (Telegram a refusé le doublon), et celles introuvables. */
  let duplicateSteps = 0;
  let missingSteps = 0;
  const notBefore = new Date(
    (post.scheduledAt?.getTime() ?? now.getTime() - 24 * 3600_000) - FIND_PUBLISHED_MARGIN_MS,
  );

  try {
    await deps.lock(
      () =>
        deps.openChannel(
          { session: active.session, channelId: post.channel.telegramChatId },
          active.creds,
          async (ch) => {
            for (let i = startAt; i < steps.length; i++) {
              await deps.paceChannel(chatId);
              let r: AccountStepResult;
              try {
                r = await ch.send(steps[i]!, medias, {
                  silent: post.disableNotification,
                  randomSeed: `${seedBase}:${i}`,
                });
              } catch (err) {
                if (!(err instanceof MtprotoRpcError && err.code === "RANDOM_ID_DUPLICATE"))
                  throw err;
                // Étape partie lors d'un essai précédent dont la réponse s'est perdue : on la retrouve dans le canal.
                // Attente imposée ou session invalide pendant la recherche : levées (nouvel essai, même graine).
                duplicateSteps++;
                const found = await ch
                  .findPublished(steps[i]!, { notBefore, exclude: [...sent] })
                  .catch((e: unknown) => {
                    if (e instanceof MtprotoFloodWait || e instanceof MtprotoAuthError) throw e;
                    logger.warn(
                      { postId: post.id, step: i, err: String(e) },
                      "étape déjà publiée : recherche dans le canal impossible",
                    );
                    return null;
                  });
                if (!found) missingSteps++;
                logger.warn(
                  { postId: post.id, step: i, ids: found?.ids ?? [] },
                  "étape déjà publiée lors d'un essai précédent",
                );
                r = found ?? { ids: [], customEmojiSent: 0, customEmojiKept: null };
              }
              sent.push(...r.ids);
              if (r.ids.length === 0)
                // Publié, mais Telegram n'a pas renvoyé l'identifiant : pas de relevé des vues ni de suppression.
                logger.warn({ postId: post.id, step: i }, "identifiant du message publié inconnu");
              emojiSent += r.customEmojiSent;
              if (r.customEmojiKept === null) emojiKnown = false;
              else emojiKept += r.customEmojiKept;
              // Chaque étape publiée est enregistrée aussitôt : une reprise ne la republie jamais.
              await prisma.post.update({
                where: { id: post.id },
                data: { telegramMessageIds: sent },
              });
            }
            if (post.unpinPrevious)
              await ch
                .unpinAll()
                .catch((e: unknown) =>
                  logger.warn({ postId: post.id, err: String(e) }, "désépinglage impossible"),
                );
            if (post.pinAfterSend && sent[0])
              await ch
                .pin(sent[0])
                .catch((e: unknown) =>
                  logger.warn({ postId: post.id, err: String(e) }, "épinglage impossible"),
                );
          },
        ),
      { owner: "worker:post", waitMs: ACCOUNT_LOCK_WAIT_MS },
    );
  } catch (err) {
    return handleSendError(post, err, sent, active.id, now, deps, seedBase);
  }

  const emojisDropped = emojiKnown && emojiSent > 0 && emojiKept < emojiSent;
  if (emojisDropped) await markAccountNotPremium(now);
  await prisma.post.update({
    where: { id: post.id },
    data: {
      status: "SENT",
      sentAt: now,
      telegramMessageIds: sent,
      lastError:
        missingSteps > 0
          ? ALREADY_PUBLISHED_NOT_FOUND_MESSAGE
          : emojisDropped
            ? EMOJIS_DROPPED_MESSAGE
            : null,
      viewsNextAt: new Date(now.getTime() + 15 * 60_000),
    },
  });
  await prisma.postStats.upsert({
    where: { postId: post.id },
    create: { postId: post.id },
    update: {},
  });
  await recordEvent({
    type: "post.sent",
    channelId: post.channelId,
    botId: post.botId,
    payload: toJsonValue({
      postId: post.id,
      messageIds: sent,
      publisher: "ACCOUNT",
      customEmoji: { sent: emojiSent, kept: emojiKnown ? emojiKept : null },
      ...(duplicateSteps > 0
        ? { alreadyPublishedSteps: duplicateSteps, notFoundSteps: missingSteps }
        : {}),
      // Telegram réserve le « contenu protégé » d'un message aux bots : non appliqué par le compte.
      ...(post.protectContent ? { protectContentApplied: false } : {}),
    }),
  });
  await prisma.telegramUserSession
    .update({ where: { id: active.id }, data: { lastUsedAt: now } })
    .catch(() => undefined);
  if (post.deleteAfterMinutes && post.deleteAfterMinutes > 0)
    await enqueue(
      "telegram-send",
      { type: "delete-post", postId: post.id },
      { jobId: `delete-post:${post.id}:${now.getTime()}`, delay: post.deleteAfterMinutes * 60_000 },
    );
  logger.info(
    { postId: post.id, chatId, ids: sent },
    "message publié par le compte Telegram connecté",
  );
  return { status: "sent", messageIds: sent };
}

async function handleSendError(
  post: AccountPost,
  err: unknown,
  sent: number[],
  sessionId: string,
  now: Date,
  deps: AccountPostDeps,
  seed: string,
): Promise<AccountSendOutcome> {
  const fail = async (message: string): Promise<AccountSendOutcome> => {
    await failPost(post, message, sent);
    return { status: "failed", error: message };
  };
  /**
   * Report : `reason` = ce qui bloque, `next` = quand le nouvel essai aura lieu. Plafonné par cause pour la programmation
   * en cours (`exhausted` = message d'échec au-delà).
   */
  const defer = async (
    cause: DeferralCause,
    delayMs: number,
    reason: string,
    next: string,
    exhausted = `${reason}, après plusieurs essais : message non publié, reprogrammez-le.`,
  ): Promise<AccountSendOutcome> => {
    const done = await deps.countDeferrals(post, seed, cause);
    if (done + 1 > MAX_DEFERRALS[cause]) return fail(exhausted);
    await deferPost(post, delayMs, `${reason} : ${next}`, now, { cause, seed, sent });
    return { status: "deferred", delayMs };
  };

  if (err instanceof MtprotoLockBusy || err instanceof MtprotoLockUnavailable)
    return defer(
      "busy",
      ACCOUNT_RETRY_DELAY_MS,
      "Compte Telegram connecté occupé (relevé des vues ou import en cours)",
      "nouvel essai dans une minute.",
    );
  if (err instanceof MtprotoFloodWait) {
    if (err.seconds > MAX_FLOOD_WAIT_S)
      return fail(
        `Telegram impose au compte connecté une attente de ${waitLabel(err.seconds)} : message non publié, reprogrammez-le plus tard.`,
      );
    const delayMs = (err.seconds + 5) * 1000;
    return defer(
      "flood",
      delayMs,
      `Telegram demande d'attendre ${waitLabel(err.seconds)}`,
      `nouvel essai à ${parisTime(new Date(now.getTime() + delayMs))}.`,
    );
  }
  if (err instanceof MtprotoAuthError) {
    await markAccountSessionExpired(sessionId, err, now);
    return fail(`${SESSION_EXPIRED_MESSAGE} Puis reprogrammez ce message.`);
  }
  if (err instanceof MtprotoRpcError) {
    if (CHANNEL_RIGHT_CODES.has(err.code))
      await markChannelCannotPost(post.channelId, err.message, now);
    if (err.code === "PREMIUM_ACCOUNT_REQUIRED") await markAccountNotPremium(now);
    return fail(err.message);
  }
  // Réseau ou panne inconnue : la connexion n'a peut-être pas abouti, on réessaie quelques fois (même identifiant
  // d'envoi : un message déjà parti n'est pas publié deux fois).
  const detail = err instanceof Error ? err.message : String(err);
  logger.warn(
    { postId: post.id, err: detail },
    "publication par le compte : erreur réseau ou inconnue",
  );
  return defer(
    "network",
    ACCOUNT_RETRY_DELAY_MS,
    "Telegram ne répond pas au compte connecté",
    "nouvel essai dans une minute.",
    "Telegram ne répond pas au compte connecté : message non publié, reprogrammez-le.",
  );
}

export type AccountDeleteOutcome =
  | { status: "deleted" }
  | { status: "deferred"; delayMs: number }
  | { status: "kept"; error: string };

/** Erreurs de suppression qui disent que le message n'est plus là (supprimé à la main, trop ancien). */
const GONE_CODES = new Set(["MESSAGE_DELETE_FORBIDDEN", "MSG_ID_INVALID", "MESSAGE_ID_INVALID"]);

/**
 * Supprime les messages d'un message de canal publié par le compte, par la même session (jamais par le bot). Session
 * occupée ou attente imposée : nouvel essai différé. Session absente ou expirée, droit retiré : le message reste
 * « envoyé » avec la raison (il est toujours dans le canal), à supprimer à nouveau après reconnexion.
 */
export async function deletePostAccount(
  post: AccountPost,
  deps: AccountPostDeps = defaultAccountPostDeps,
): Promise<AccountDeleteOutcome> {
  const now = deps.now();
  const ids = messageIdsOf(post.telegramMessageIds);
  if (ids.length === 0) return { status: "deleted" };
  const keep = async (message: string): Promise<AccountDeleteOutcome> => {
    const error = `Suppression impossible : ${message}`;
    await prisma.post.update({ where: { id: post.id }, data: { lastError: error } });
    logger.warn({ postId: post.id, err: error }, "suppression par le compte impossible");
    return { status: "kept", error };
  };
  const later = async (delayMs: number): Promise<AccountDeleteOutcome> => {
    await enqueue(
      "telegram-send",
      { type: "delete-post", postId: post.id },
      { jobId: `delete-post:${post.id}:retry:${now.getTime()}`, delay: delayMs },
    );
    return { status: "deferred", delayMs };
  };

  const { active, reason } = await deps.loadSession();
  if (!active) return keep(sessionProblemMessage(reason));
  let error: string | null = null;
  try {
    await deps.lock(
      () =>
        deps.openChannel(
          { session: active.session, channelId: post.channel.telegramChatId },
          active.creds,
          (ch) => ch.deleteMessages(ids),
        ),
      { owner: "worker:post-delete", waitMs: ACCOUNT_LOCK_WAIT_MS },
    );
  } catch (err) {
    if (err instanceof MtprotoLockBusy || err instanceof MtprotoLockUnavailable)
      return later(ACCOUNT_RETRY_DELAY_MS);
    if (err instanceof MtprotoFloodWait) return later((err.seconds + 5) * 1000);
    if (err instanceof MtprotoAuthError) {
      await markAccountSessionExpired(active.id, err, now);
      return keep(SESSION_EXPIRED_MESSAGE);
    }
    if (err instanceof MtprotoRpcError && GONE_CODES.has(err.code)) error = err.message;
    else return keep(err instanceof Error ? err.message : String(err));
  }
  await prisma.post.update({
    where: { id: post.id },
    data: { status: "DELETED", lastError: error },
  });
  await recordEvent({
    type: "post.deleted",
    channelId: post.channelId,
    botId: post.botId,
    payload: toJsonValue({ postId: post.id, error, publisher: "ACCOUNT" }),
  });
  return { status: "deleted" };
}
