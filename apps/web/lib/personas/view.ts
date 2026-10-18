/**
 * Affichage des personas (phase 17) : liste, choix de l'offre et du modèle, ce que montre le panneau « Tester » (style
 * détecté, refus des contrôles, pannes de l'IA). Fonctions pures, testées dans view.test.ts. Mots du client
 * (docs/REFONTE-UX.md) : « Rencontres », « parcours », jamais de terme technique en surface.
 */
import type { StyleProfile, VeniceModelInfo } from "@linkaffipro/chat";
import { selectableModels } from "@linkaffipro/chat";
import { personaRole } from "./form";

// ------------------------------------------------------------------
// Liste
// ------------------------------------------------------------------

/** Prénom affiché (« Sans prénom » tant qu'il n'est pas saisi). */
export function personaDisplayName(name: string | null | undefined): string {
  return name?.trim() || "Sans prénom";
}

export type PersonaListItem = {
  id: string;
  name: string;
  gender: string;
  isActive: boolean;
  offer: { name: string; isActive: boolean } | null;
  bots: Array<{ username: string; mode: string }>;
  conversations: number;
};

export type PersonaListRow = {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  stateLabel: "Active" | "Inactive";
  offerLabel: string;
  /** L'offre liée n'est plus active chez Link Affi : aucun lien ne peut partir. */
  offerInactive: boolean;
  botsLabel: string;
  /** Bots en mode assistant qui l'utilisent. */
  assistantBots: number;
  conversations: number;
};

/** Ligne de la liste des personas (5 colonnes : prénom, état, offre liée, bots, conversations). */
export function personaListRow(p: PersonaListItem): PersonaListRow {
  const assistantBots = p.bots.filter((b) => b.mode === "ASSISTANT");
  return {
    id: p.id,
    name: personaDisplayName(p.name),
    role: personaRole(p.gender),
    isActive: p.isActive,
    stateLabel: p.isActive ? "Active" : "Inactive",
    offerLabel: p.offer ? p.offer.name : "Aucune",
    offerInactive: Boolean(p.offer && !p.offer.isActive),
    botsLabel: assistantBots.length ? assistantBots.map((b) => `@${b.username}`).join(", ") : "—",
    assistantBots: assistantBots.length,
    conversations: p.conversations,
  };
}

// ------------------------------------------------------------------
// Choix de l'offre, de la campagne et du modèle
// ------------------------------------------------------------------

export type OfferChoice = {
  id: string;
  name: string;
  programName: string;
  vertical: string | null;
  isActive: boolean;
};

export type ChoiceGroup = { label: string; options: Array<{ value: string; label: string }> };

/**
 * Offres Link Affi proposées : celles de l'univers Rencontres d'abord, puis les autres ; l'offre déjà liée reste
 * proposée même si elle n'est plus active (signalée).
 */
export function offerChoiceGroups(offers: readonly OfferChoice[]): ChoiceGroup[] {
  const label = (o: OfferChoice) =>
    `${o.name}${o.programName && o.programName !== o.name ? ` · ${o.programName}` : ""}${o.isActive ? "" : " (inactive)"}`;
  const sorted = [...offers].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const dating = sorted.filter((o) => o.vertical === "DATING");
  const others = sorted.filter((o) => o.vertical !== "DATING");
  const groups: ChoiceGroup[] = [];
  if (dating.length)
    groups.push({
      label: "Rencontres",
      options: dating.map((o) => ({ value: o.id, label: label(o) })),
    });
  if (others.length)
    groups.push({
      label: dating.length ? "Autres univers" : "Offres",
      options: others.map((o) => ({ value: o.id, label: label(o) })),
    });
  return groups;
}

export type CampaignChoice = { id: string; name: string; affiliateCampaignIds: string[] };

/** Avertissement doux : l'offre choisie n'est pas une offre de la campagne choisie. */
export function campaignOfferNote(
  campaign: CampaignChoice | null,
  affiliateCampaignId: string,
): string | null {
  if (!campaign || !affiliateCampaignId) return null;
  if (campaign.affiliateCampaignIds.includes(affiliateCampaignId)) return null;
  return `Cette offre ne fait pas partie de la campagne « ${campaign.name} » : les liens envoyés seront quand même comptés sur cette campagne.`;
}

const usd = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Modèles proposés pour une persona : « Modèle par défaut des réglages » (valeur vide), puis les modèles du cache des
 * réglages (du moins cher au plus cher) ; le modèle actuel reste proposé même s'il n'est plus dans la liste.
 */
export function personaModelOptions(
  models: readonly VeniceModelInfo[],
  defaultModel: string,
  current: string,
): Array<{ value: string; label: string }> {
  const options = [{ value: "", label: `Modèle par défaut des réglages (${defaultModel})` }];
  for (const m of selectableModels(models)) {
    const price =
      m.inputUsdPerM === null || m.outputUsdPerM === null
        ? "prix inconnu"
        : `lu ${usd.format(m.inputUsdPerM)} · écrit ${usd.format(m.outputUsdPerM)} par million de jetons`;
    options.push({
      value: m.id,
      label: `${m.name === m.id ? m.id : `${m.name} (${m.id})`} — ${price}`,
    });
  }
  if (current && !options.some((o) => o.value === current))
    options.splice(1, 0, {
      value: current,
      label: `${current} — modèle actuel, absent de la liste`,
    });
  return options;
}

// ------------------------------------------------------------------
// Panneau « Tester »
// ------------------------------------------------------------------

const LENGTH: Record<string, string> = {
  short: "Messages courts",
  medium: "Messages moyens",
  long: "Messages longs",
};
const EMOJIS: Record<string, string> = {
  none: "Aucun emoji",
  few: "Quelques emojis",
  many: "Beaucoup d'emojis",
};
const REGISTER: Record<string, string> = {
  casual: "Registre familier",
  neutral: "Registre neutre",
  formal: "Registre soutenu",
};
const TONE: Record<string, string> = {
  shy: "Timide",
  direct: "Direct",
  flirty: "Joueur, dragueur",
  dry: "Sec, peu bavard",
  chatty: "Bavard",
};
const LANG: Record<string, string> = {
  fr: "français",
  en: "anglais",
  es: "espagnol",
  pt: "portugais",
  de: "allemand",
  it: "italien",
};

/** Style détecté chez la personne, en lignes courtes (vide tant que rien n'est connu). */
export function styleLines(style: StyleProfile | null | undefined): string[] {
  if (!style) return [];
  const out: string[] = [];
  if (style.tone && TONE[style.tone]) out.push(`Ton : ${TONE[style.tone]!.toLowerCase()}`);
  if (style.length && LENGTH[style.length]) out.push(LENGTH[style.length]!);
  if (style.emojis && EMOJIS[style.emojis]) out.push(EMOJIS[style.emojis]!);
  if (style.register && REGISTER[style.register]) out.push(REGISTER[style.register]!);
  if (style.language && LANG[style.language]) out.push(`Écrit en ${LANG[style.language]}`);
  if (typeof style.interest === "number") out.push(`Intérêt estimé : ${style.interest}/10`);
  return out;
}

/** Raisons de refus d'une réponse par les contrôles du code (codes de packages/chat), en français. */
const REJECT_LABELS: Record<string, string> = {
  invalid_output: "réponse illisible",
  truncated: "réponse coupée",
  empty: "réponse vide",
  too_many_messages: "trop de messages d'un coup",
  too_long: "message trop long",
  markdown: "mise en forme interdite",
  link: "lien ou pseudo dans le texte",
  explicit: "contenu explicite",
  denies_assistant: "a nié être une assistante",
  missing_assistant_admission: "n'a pas dit franchement être une IA",
  intro_missing: "ne s'est pas présentée comme l'assistante du canal",
  invented_number: "chiffre inventé",
};

export function rejectLabel(code: string): string {
  return REJECT_LABELS[code] ?? "réponse refusée";
}

/** Raisons de refus distinctes, en français, dans l'ordre. */
export function rejectLabels(codes: readonly string[]): string[] {
  return [...new Set(codes.map(rejectLabel))];
}

/** Panne de l'IA (codes de Venice) expliquée à l'équipe. */
export function aiFailureText(code: string | null | undefined): string {
  switch (code) {
    case "auth":
      return "Venice refuse la clé : un administrateur doit la vérifier dans Réglages → IA de conversation.";
    case "balance":
      return "Le solde du compte Venice est épuisé : rechargez-le, puis réessayez.";
    case "no_key":
      return "Aucune clé Venice : un administrateur doit la coller dans Réglages → IA de conversation.";
    case "rate_limit":
      return "Venice est surchargé pour l'instant (trop de demandes).";
    case "bad_model":
      return "Le modèle choisi n'existe plus chez Venice : choisissez-en un autre (Avancé de la persona ou Réglages → IA de conversation).";
    case "content_policy":
      return "Venice a refusé de répondre à ce message.";
    case "timeout":
      return "Venice a mis trop de temps à répondre.";
    case "invalid_output":
      return "Les réponses de l'IA ne respectaient pas les règles, même au second essai.";
    default:
      return "L'IA ne répond pas pour l'instant.";
  }
}

/** Pourquoi « Tester » est impossible pour l'instant (clé absente, plafond atteint), ou null. */
export function testBlockedReason(p: {
  hasKey: boolean;
  isAdmin: boolean;
  spentEur: number;
  capEur: number;
}): string | null {
  if (!p.hasKey)
    return p.isAdmin
      ? "Collez d'abord la clé Venice dans Réglages → IA de conversation : le test utilise la vraie IA."
      : "Un administrateur doit d'abord coller la clé Venice dans Réglages → IA de conversation : le test utilise la vraie IA.";
  if (p.spentEur >= p.capEur)
    return "Plafond mensuel atteint : plus aucun appel à l'IA ce mois-ci, test compris (un administrateur peut le relever dans Réglages → IA de conversation).";
  return null;
}
