/**
 * Titre et photo des canaux qui ont une page d'atterrissage (phase 15, D7) : le nom affiché sur la page est toujours le
 * vrai titre Telegram, jamais saisi. Il est relu par les mises à jour du bot (`upsertChannel`, qui publie
 * l'invalidation quand le titre change) et par une relecture `getChat` périodique du worker, avec la petite photo
 * (160 px) seulement si une page active du canal l'affiche. Tout changement publie l'invalidation du HTML gardé en
 * mémoire par le service web (`{ channelId }`).
 *
 * Limites de Telegram : un seul appel `getChat` par canal à chaque relecture (photo : `getFile` + téléchargement
 * seulement quand elle a changé), canaux relus l'un après l'autre avec une pause, arrêt du passage au premier 429 ou
 * à la première panne de Telegram. Dépendances injectées (`chat.test.ts`) ; accès base dans `prisma-links.ts`.
 */
import { telegramErrorText } from "../join-flow/gate-links";
import { isTransientLandingError, type LandingInvalidate } from "./links";

/** Un canal est relu au plus tôt 30 minutes après sa dernière relecture. */
export const LANDING_CHAT_STALE_MS = 30 * 60_000;
/** Canaux relus par passage (le worker passe toutes les 5 minutes). */
export const LANDING_CHAT_BATCH = 40;
/** Pause entre deux canaux (bien en dessous des 30 appels par seconde permis à un bot). */
export const LANDING_CHAT_SPACING_MS = 250;
/** Taille maximale de la petite photo (JPEG 160 px : quelques Ko en pratique). */
export const LANDING_PHOTO_MAX_BYTES = 256 * 1024;

/** Réponse utile de `getChat` (sous-ensemble de `ChatFullInfo`). */
export type LandingChatInfo = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  photo?: { small_file_id: string; small_file_unique_id: string };
};

/** Client Telegram d'un de nos bots pour la relecture (grammY `Api` + téléchargement d'un fichier). */
export type LandingChatClient = {
  getChat(chatId: number): Promise<LandingChatInfo>;
  getFile(fileId: string): Promise<{ file_path?: string }>;
  download(filePath: string, maxBytes: number): Promise<Uint8Array>;
};

export type LandingChatChannel = {
  id: string;
  title: string;
  username: string | null;
  telegramChatId: bigint;
  /** Photo enregistrée (identifiant unique Telegram), null si aucune. */
  photoFileUniqueId: string | null;
  /** Une page active du canal affiche la photo. */
  wantsPhoto: boolean;
  /** Nos bots administrateurs du canal, celui qui agit pour le canal d'abord. */
  bots: Array<{ botId: string; username: string }>;
};

export type LandingChatUpdate = {
  checkedAt: Date;
  title?: string;
  username?: string | null;
  /** Nouvelle photo, ou null : photo retirée chez Telegram. Absent : inchangée. */
  photo?: { bytes: Uint8Array; uniqueId: string } | null;
};

export interface LandingChatDeps {
  /** Canaux qui ont une page active, jamais relus ou relus avant `checkedBefore`, les plus anciens d'abord. */
  listChannels(input: { checkedBefore: Date; limit: number }): Promise<LandingChatChannel[]>;
  clientFor(botId: string): Promise<LandingChatClient | null>;
  saveChat(channelId: string, data: LandingChatUpdate): Promise<void>;
  publishInvalidate(msg: LandingInvalidate): Promise<unknown>;
  warn?(message: string, details: Record<string, unknown>): void;
  /** Pause entre deux canaux (tests : immédiate). */
  sleep?(ms: number): Promise<void>;
}

export type LandingChatOutcome = {
  channelId: string;
  /** updated : titre ou photo changés ; unchanged ; failed : aucun bot n'a pu lire le canal ; retry : Telegram surchargé. */
  status: "updated" | "unchanged" | "failed" | "retry";
  titleChanged: boolean;
  photoChanged: boolean;
  error?: string;
};

function warnOf(deps: Pick<LandingChatDeps, "warn">) {
  return (
    deps.warn ??
    ((message: string, details: Record<string, unknown>) =>
      console.warn(`[landing] ${message}`, details))
  );
}

/** Titre affiché d'un chat (comme `upsertChannel`) : son titre, sinon @nom, sinon rien. */
function titleOf(chat: LandingChatInfo): string | null {
  if (chat.title) return chat.title;
  if (chat.username) return `@${chat.username}`;
  return null;
}

/**
 * Relit un canal chez Telegram (`getChat`, par le premier de nos bots qui y arrive) : titre, nom public et, si une page
 * l'affiche, petite photo. Écrit l'heure de relecture (même si aucun bot n'a pu lire le canal : pas d'appel à chaque
 * passage), et publie l'invalidation si le titre ou la photo ont changé. Telegram surchargé ou injoignable : rien
 * n'est écrit (`retry`).
 */
export async function refreshLandingChat(
  deps: LandingChatDeps,
  channel: LandingChatChannel,
  now: Date = new Date(),
): Promise<LandingChatOutcome> {
  const warn = warnOf(deps);
  const out: LandingChatOutcome = {
    channelId: channel.id,
    status: "unchanged",
    titleChanged: false,
    photoChanged: false,
  };
  const errors: string[] = [];
  let chat: LandingChatInfo | null = null;
  let client: LandingChatClient | null = null;
  for (const bot of channel.bots) {
    try {
      client = await deps.clientFor(bot.botId);
      if (!client) continue;
      chat = await client.getChat(Number(channel.telegramChatId));
      break;
    } catch (err) {
      if (isTransientLandingError(err)) {
        warn("relecture du canal remise au passage suivant", {
          channelId: channel.id,
          bot: bot.username,
          error: telegramErrorText(err),
        });
        return { ...out, status: "retry", error: telegramErrorText(err) };
      }
      errors.push(`@${bot.username} : ${telegramErrorText(err)}`);
    }
  }
  if (!chat || !client) {
    const error = errors.length ? errors.join(" ; ") : "aucun de nos bots n'est administrateur";
    warn("titre du canal impossible à relire", { channelId: channel.id, error });
    await deps.saveChat(channel.id, { checkedAt: now });
    return { ...out, status: "failed", error };
  }

  const data: LandingChatUpdate = { checkedAt: now };
  const title = titleOf(chat);
  if (title && title !== channel.title) {
    data.title = title;
    out.titleChanged = true;
  }
  const username = chat.username ?? null;
  if (username !== channel.username) data.username = username;

  if (channel.wantsPhoto) {
    const photo = chat.photo;
    if (!photo) {
      if (channel.photoFileUniqueId) {
        data.photo = null;
        out.photoChanged = true;
      }
    } else if (photo.small_file_unique_id !== channel.photoFileUniqueId) {
      try {
        const file = await client.getFile(photo.small_file_id);
        if (!file.file_path) throw new Error("Telegram n'a pas donné le chemin du fichier");
        const bytes = await client.download(file.file_path, LANDING_PHOTO_MAX_BYTES);
        data.photo = { bytes, uniqueId: photo.small_file_unique_id };
        out.photoChanged = true;
      } catch (err) {
        // Photo impossible à récupérer : le titre est quand même enregistré, la photo sera reprise plus tard.
        warn("photo du canal non récupérée", {
          channelId: channel.id,
          error: telegramErrorText(err),
        });
      }
    }
  }

  await deps.saveChat(channel.id, data);
  if (out.titleChanged || out.photoChanged) {
    out.status = "updated";
    await deps.publishInvalidate({ channelId: channel.id });
  }
  return out;
}

export type LandingChatsReport = {
  /** Canaux relus (titre lu chez Telegram). */
  checked: number;
  /** Canaux dont le titre ou la photo ont changé. */
  updated: number;
  /** Canaux qu'aucun de nos bots n'a pu lire. */
  failed: number;
  /** Canaux laissés au passage suivant (Telegram surchargé). */
  retryLater: number;
};

/**
 * Passage périodique (worker, toutes les 5 minutes) : relit les canaux qui ont une page active et dont la dernière
 * relecture date de plus de 30 minutes (jamais relus d'abord), au plus `limit` par passage, avec une pause entre deux.
 */
export async function refreshLandingChats(
  deps: LandingChatDeps,
  opts: { now?: Date; limit?: number; spacingMs?: number; staleMs?: number } = {},
): Promise<LandingChatsReport> {
  const now = opts.now ?? new Date();
  const channels = await deps.listChannels({
    checkedBefore: new Date(now.getTime() - (opts.staleMs ?? LANDING_CHAT_STALE_MS)),
    limit: opts.limit ?? LANDING_CHAT_BATCH,
  });
  const report: LandingChatsReport = { checked: 0, updated: 0, failed: 0, retryLater: 0 };
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (const [i, channel] of channels.entries()) {
    if (i > 0) await sleep(opts.spacingMs ?? LANDING_CHAT_SPACING_MS);
    const r = await refreshLandingChat(deps, channel, now);
    if (r.status === "retry") {
      report.retryLater += channels.length - i;
      break;
    }
    if (r.status === "failed") report.failed++;
    else report.checked++;
    if (r.status === "updated") report.updated++;
  }
  return report;
}
