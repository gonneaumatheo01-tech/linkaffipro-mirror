/**
 * Libellés de la boîte de réception de l'assistant de conversation (phase 17, contrat docs/ASSISTANT-CONVERSATION.md
 * § 6) : nom d'une personne (jamais son identifiant Telegram), « l'assistante » / « l'assistant » selon la persona,
 * médias décrits, source du /start, raison d'une fermeture, étapes du parcours. Règles pures (testées), sans
 * dépendance (le fil en direct, composant client, les importe). Libellés des étapes et de « qui répond » :
 * `statusLabel("conversationStage" | "conversationStatus", …)` de `lib/status-badges` (« L'assistante répond » par
 * défaut), accordé à la persona quand elle est connue (`botStatusLabel`).
 */
import type { ConversationStage } from "@linkaffipro/db";
import { fmtMoney } from "@/lib/format";

/** Nom affiché quand la personne n'a ni prénom ni pseudo (jamais son identifiant Telegram). */
export const PERSON_FALLBACK = "Personne sans nom";

/** Nom d'une personne : prénom (et nom), sinon @pseudo ; « Membre anonymisé » après une suppression à sa demande. */
export function personName(m: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  anonymizedAt?: Date | null;
}): string {
  if (m.anonymizedAt) return "Membre anonymisé";
  const full = [m.firstName, m.lastName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (full) return full;
  const pseudo = (m.username ?? "").trim();
  return pseudo ? `@${pseudo}` : PERSON_FALLBACK;
}

/** « l'assistante » (persona féminine, par défaut) ou « l'assistant » (persona masculine). */
export function assistantWord(gender: string | null | undefined): string {
  return gender === "M" ? "l'assistant" : "l'assistante";
}

/** « assistante » / « assistant » (sans article). */
export function assistantNoun(gender: string | null | undefined): string {
  return gender === "M" ? "assistant" : "assistante";
}

/**
 * « Qui répond » quand l'assistante a la main : « L'assistante répond » (par défaut, comme le reste de l'interface et
 * le guide) ou « L'assistant répond » (persona masculine). Les autres statuts : `statusLabel("conversationStatus", …)`.
 */
export function botStatusLabel(gender: string | null | undefined): string {
  return `L'${assistantNoun(gender)} répond`;
}

/** « Qui répond » quand la conversation est laissée à l'assistante mais que personne ne répondra (`reply-state.ts`). */
export const NOBODY_REPLIES_LABEL = "Personne ne répond";

/** Libellé du bouton qui rend la conversation : « Rendre à l'assistante » / « Rendre à l'assistant ». */
export function releaseLabel(gender: string | null | undefined): string {
  return `Rendre à ${assistantWord(gender)}`;
}

export type MediaKind = "photo" | "sticker" | "voice" | "video" | "document" | "other";

/** Médias reçus ou envoyés, décrits entre crochets dans le fil (le fichier n'est jamais affiché). */
export const MEDIA_LABELS: Record<MediaKind, string> = {
  photo: "[photo]",
  sticker: "[autocollant]",
  voice: "[message vocal]",
  video: "[vidéo]",
  document: "[fichier]",
  other: "[pièce jointe]",
};

/** Nature du média d'un message (`ConversationMessage.media`), lecture tolérante ; null sans média. */
export function mediaKindOf(media: unknown): MediaKind | null {
  if (!media || typeof media !== "object" || Array.isArray(media)) return null;
  const kind = (media as { kind?: unknown }).kind;
  return typeof kind === "string" && kind in MEDIA_LABELS ? (kind as MediaKind) : "other";
}

/** Texte lisible d'un message : le média décrit (« [photo] »), puis la légende ou le texte. */
export function messageText(text: string, media: unknown): string {
  const kind = mediaKindOf(media);
  const body = (text ?? "").trim();
  if (!kind) return body;
  return body ? `${MEDIA_LABELS[kind]} ${body}` : MEDIA_LABELS[kind];
}

/** Extrait d'une ligne (espaces fusionnés), coupé à `max` caractères avec « … ». */
export function excerpt(text: string, max = 80): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  return `${chars
    .slice(0, max - 1)
    .join("")
    .trimEnd()}…`;
}

/** Valeur des filtres « Sans source » et « Sans persona » (jamais une source valide : [A-Za-z0-9_-]). */
export const NONE_KEY = "~";

/** Source du /start affichée (« tk01 »), « Sans source » quand la personne a seulement appuyé sur Démarrer. */
export function sourceLabel(source: string | null | undefined): string {
  return source ? source : "Sans source";
}

/** Persona affichée, « Sans persona » si elle n'existe plus. */
export function personaLabel(name: string | null | undefined): string {
  return name ? name : "Sans persona";
}

/** Raison de fermeture « Fermer » de l'équipe (sans bloquer) ; « TEAM » = « Bloquer » (contrat § 1). */
export const TEAM_CLOSED_REASON = "TEAM_CLOSED";

/** Raison d'une fermeture, en clair. */
export const CLOSED_REASON_LABELS: Record<string, string> = {
  STOP: "La personne a demandé l'arrêt (/stop)",
  MINOR: "La personne a dit avoir moins de 18 ans",
  TEAM: "Bloquée par l'équipe",
  [TEAM_CLOSED_REASON]: "Fermée par l'équipe",
  BLOCKED: "La personne a bloqué le bot",
  UNREACHABLE: "Le bot ne peut plus lui écrire",
};

export function closedReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return CLOSED_REASON_LABELS[reason] ?? "Fermée";
}

/** Étapes du parcours, dans l'ordre (sans « Fermée ») : Accueil → … → Inscrit. */
export const JOURNEY_STAGES: readonly ConversationStage[] = [
  "WELCOME",
  "CHAT",
  "PROPOSAL",
  "LINK_SENT",
  "FOLLOW_UP",
  "CONVERTED",
];

/** Auteur du dernier message, en tête d'un extrait de la liste (rien pour la personne elle-même). */
export function lastAuthorPrefix(
  author: string | null | undefined,
  gender: string | null | undefined,
): string {
  if (author === "ASSISTANT") {
    const noun = assistantNoun(gender);
    return `${noun.charAt(0).toLocaleUpperCase("fr")}${noun.slice(1)} : `;
  }
  if (author === "TEAM") return "Équipe : ";
  if (author === "SYSTEM") return "Message automatique : ";
  return "";
}

/** Coût de l'IA affiché : « 1,24 € », « moins de 0,01 € » pour quelques appels, « 0,00 € » sans appel. */
export function aiCostText(eur: number): string {
  if (eur > 0 && eur < 0.01) return `moins de ${fmtMoney(0.01)}`;
  return fmtMoney(eur);
}
