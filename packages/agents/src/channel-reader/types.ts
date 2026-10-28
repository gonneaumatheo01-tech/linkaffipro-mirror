/**
 * Lecteur des canaux Telegram publics (aperçu `t.me/s/<nom>`), partagé par la Prospection et les Analystes : types
 * communs. Aucun média téléchargé ; liens jamais suivis.
 */

export type ChannelPostMediaKind = "text" | "photo" | "video" | "poll" | "document" | "other";

/** Limites de lecture de l'aperçu web. */
export const PREVIEW_LIMITS = {
  /** Posts lus au plus par lecture. */
  maxPostsPerRead: 200,
  /** Ancienneté maximale lue (jours). */
  maxAgeDays: 90,
  /** Une requête toutes les 3 secondes. */
  webDelayMs: 3000,
} as const;

/** Post lu (format commun). */
export type ChannelPostInput = {
  externalId: number;
  postedAt: Date;
  text: string | null;
  mediaKind: ChannelPostMediaKind;
  views: number | null;
  hasButton: boolean;
  /** Liens présents (comptés, jamais suivis ni réutilisés). */
  linkCount: number;
};

/** Résultat d'une lecture. `unavailable` : canal privé, restreint, introuvable, aperçu fermé… (raison en français). */
export type ChannelReadResult =
  | { ok: true; title: string | null; username: string | null; chatId: bigint | null; posts: ChannelPostInput[] }
  | { ok: false; reason: "private" | "restricted" | "not_found" | "no_account" | "rate_limited" | "error"; message: string };

/** Accès réseau injecté (tests : pages `t.me/s` enregistrées). */
export type PreviewFetch = (url: string) => Promise<{ status: number; body: string }>;
