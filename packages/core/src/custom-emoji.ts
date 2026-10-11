/**
 * Emojis animés (emojis personnalisés des packs Premium Telegram), phase 12 : règles pures partagées par le site
 * (éditeur, formulaires), le bot (bibliothèque) et le worker (envoi, repli).
 *
 * Dans un texte HTML Telegram, un emoji animé s'écrit `<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>` : le
 * contenu de la balise est l'emoji de remplacement (affiché si l'animation n'est pas disponible, et compté dans la
 * longueur du texte). Depuis le Bot API 9.4 (9 février 2026), un bot peut en envoyer en privé, en groupe et en
 * supergroupe si son propriétaire a Telegram Premium ; jamais dans un canal. Un message de CANAL (Channel.type CHANNEL)
 * qui en contient est donc publié par le compte Telegram connecté (MTProto), sans boutons (Telegram réserve les boutons
 * aux bots) ; dans un groupe ou un supergroupe, le bot publie lui-même les emojis animés, avec ses boutons (le site
 * n'appelle `planPostPublisher` que pour un canal : `apps/web/lib/posts/publisher.ts`).
 */

/** Balise d'un emoji animé (attribut `emoji-id` entre guillemets doubles ou simples, contenu sans autre balise). */
export const CUSTOM_EMOJI_TAG_RE =
  /<tg-emoji\s+emoji-id\s*=\s*(?:"(\d{1,20})"|'(\d{1,20})')\s*>([^<]*)<\/tg-emoji>/gi;

/** Identifiant Telegram d'emoji personnalisé valide (entier 64 bits positif, en chaîne). */
export function isValidCustomEmojiId(id: string): boolean {
  return /^\d{1,20}$/.test(id) && id !== "0";
}

/** Identifiants des emojis animés d'un texte, sans doublon, dans l'ordre d'apparition. */
export function customEmojiIdsOf(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(CUSTOM_EMOJI_TAG_RE)) {
    const id = m[1] ?? m[2]!;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Le texte contient-il au moins un emoji animé ? */
export function hasCustomEmoji(html: string | null | undefined): boolean {
  if (!html) return false;
  CUSTOM_EMOJI_TAG_RE.lastIndex = 0;
  return new RegExp(CUSTOM_EMOJI_TAG_RE.source, "i").test(html);
}

/** Remplace chaque emoji animé par son emoji de remplacement (envoi par un bot dans un canal, refus de Telegram). */
export function withFallbackEmojis(html: string): string {
  return html.replace(CUSTOM_EMOJI_TAG_RE, (_all, _a: string, _b: string, inner: string) => inner);
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Balise d'un emoji animé (emoji de remplacement échappé ; « ⭐ » s'il est vide). */
export function customEmojiTag(customEmojiId: string, fallback: string): string {
  if (!isValidCustomEmojiId(customEmojiId))
    throw new Error(`Identifiant d'emoji animé invalide : ${customEmojiId}`);
  return `<tg-emoji emoji-id="${customEmojiId}">${escapeText(fallback || "⭐")}</tg-emoji>`;
}

/**
 * Nom court d'un pack d'emojis à partir de ce que l'équipe colle : « https://t.me/addemoji/NomDuPack »,
 * « t.me/addemoji/NomDuPack », « tg://addemoji?set=NomDuPack » ou le nom seul. Null si ce n'est pas un pack d'emojis
 * (un lien t.me/addstickers est un pack d'autocollants, pas d'emojis).
 */
export function parseEmojiPackLink(input: string): string | null {
  const s = input.trim();
  const name =
    s.match(
      /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/addemoji\/([A-Za-z0-9_]+)\/?(?:[?#].*)?$/i,
    )?.[1] ??
    s.match(/^tg:\/\/addemoji\?set=([A-Za-z0-9_]+)/i)?.[1] ??
    (/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s) ? s : null);
  return name && name.length <= 64 ? name : null;
}

/** Choix de l'équipe pour un message de canal qui a à la fois des emojis animés et des boutons. */
export type EmojiButtonsChoice = "emojis" | "buttons";

export type PostPublishPlan =
  /** Publié par le bot, avec ses boutons ; `text` = texte à enregistrer (emojis remplacés si l'équipe a gardé les boutons). */
  | { publisher: "BOT"; text: string; keepButtons: true; needsChoice: false }
  /** Publié par le compte Telegram connecté, sans boutons. */
  | { publisher: "ACCOUNT"; text: string; keepButtons: false; needsChoice: false }
  /** Emojis animés ET boutons sans choix : l'équipe doit choisir avant d'enregistrer. */
  | { publisher: null; text: string; keepButtons: boolean; needsChoice: true };

/**
 * Qui publie un message de canal :
 * - aucun emoji animé → le bot, comme avant ;
 * - emojis animés sans bouton → le compte Telegram connecté ;
 * - emojis animés et boutons → choix imposé : « Garder les emojis animés (sans boutons) » → compte ; « Garder les
 *   boutons (emojis normaux) » → bot, chaque emoji animé remplacé par son emoji de remplacement.
 */
export function planPostPublisher(input: {
  text: string;
  hasButtons: boolean;
  choice?: EmojiButtonsChoice | null;
}): PostPublishPlan {
  if (!hasCustomEmoji(input.text))
    return { publisher: "BOT", text: input.text, keepButtons: true, needsChoice: false };
  if (!input.hasButtons)
    return { publisher: "ACCOUNT", text: input.text, keepButtons: false, needsChoice: false };
  if (input.choice === "emojis")
    return { publisher: "ACCOUNT", text: input.text, keepButtons: false, needsChoice: false };
  if (input.choice === "buttons")
    return {
      publisher: "BOT",
      text: withFallbackEmojis(input.text),
      keepButtons: true,
      needsChoice: false,
    };
  return { publisher: null, text: input.text, keepButtons: input.hasButtons, needsChoice: true };
}

/**
 * État du compte Telegram connecté pour publier des messages avec emojis animés (`Setting` `mtproto.publishStatus`,
 * écrit par le worker, tâche `custom-emoji` `account-status`, lu par le site avant de programmer).
 */
export type MtprotoPublishStatus = {
  /** Date du dernier relevé (ISO). */
  checkedAt: string;
  /** Session connectée et utilisable. */
  connected: boolean;
  /** Compte Telegram Premium (null : inconnu). */
  premium: boolean | null;
  user: { id: string; firstName: string; username: string | null } | null;
  /** Erreur lisible en français (session expirée, FLOOD_WAIT…), null si tout va bien. */
  error: string | null;
  /** Par canal (identifiant `Channel.id`) : le compte peut-il y publier ? */
  channels: Record<string, { canPost: boolean; checkedAt: string; error?: string | null }>;
};

/** Ce qui empêche le compte connecté de publier dans ce canal (texte français), ou null s'il le peut. */
export function accountPublishProblem(
  status: MtprotoPublishStatus | null | undefined,
  channelId: string,
): string | null {
  if (!status || !status.connected)
    return "Aucun compte Telegram connecté : connectez votre compte dans Réglages → Connexions → Telegram.";
  if (status.error) return status.error;
  if (status.premium === false)
    return "Le compte Telegram connecté n'a pas Telegram Premium : les emojis animés ne peuvent pas être publiés.";
  const ch = status.channels[channelId];
  if (!ch) return "Droits du compte sur ce canal pas encore vérifiés : cliquez sur « Vérifier ».";
  if (!ch.canPost)
    return (
      ch.error ??
      "Le compte Telegram connecté n'est pas administrateur de ce canal avec le droit de publier."
    );
  return null;
}
