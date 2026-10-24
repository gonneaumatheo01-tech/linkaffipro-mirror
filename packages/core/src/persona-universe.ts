/**
 * Univers d'une persona et identité permise (phase 25, CONTRAT ; propriétaire : chantier B). Sur un bot Casino ou
 * Paris sportifs, l'identité assistante est imposée : jamais « fille », jamais le mode illusion.
 */
export const PERSONA_UNIVERSES = ["dating", "casino", "sports"] as const;
export type PersonaUniverse = (typeof PERSONA_UNIVERSES)[number];

export function isPersonaUniverse(v: unknown): v is PersonaUniverse {
  return typeof v === "string" && (PERSONA_UNIVERSES as readonly string[]).includes(v);
}

/** Identités permises dans un univers (GIRL seulement pour Rencontres). */
export function allowedIdentities(universe: PersonaUniverse): readonly ("ASSISTANT" | "GIRL")[] {
  return universe === "dating" ? ["ASSISTANT", "GIRL"] : ["ASSISTANT"];
}

/** Fiche d'informations : 40 entrées au plus. */
export const PERSONA_FAQ_MAX = 40;
export type PersonaFaqEntry = { q: string; a: string };

/** Libellés affichés des univers. */
export const PERSONA_UNIVERSE_LABELS: Record<PersonaUniverse, string> = {
  dating: "Rencontres",
  casino: "Casino",
  sports: "Paris sportifs",
};

/** Univers lu en base : toute valeur inconnue (ou absente) reste Rencontres, comportement d'avant la phase 25. */
export function parsePersonaUniverse(v: unknown): PersonaUniverse {
  return isPersonaUniverse(v) ? v : "dating";
}

/** Casino ou Paris sportifs : identité assistante imposée, fiche d'informations, passage à un humain. */
export function isAssistantOnlyUniverse(v: unknown): boolean {
  return v === "casino" || v === "sports";
}

/**
 * Identité effective d'une persona : en Casino ou Paris sportifs, toujours ASSISTANT (une persona réglée « fille » par
 * erreur, par un ancien formulaire ou un script, n'est jamais présentée comme une fille). Ailleurs, « GIRL » seulement si
 * c'est la valeur enregistrée.
 */
export function effectiveIdentityKind(universe: unknown, identity: unknown): "ASSISTANT" | "GIRL" {
  if (isAssistantOnlyUniverse(universe)) return "ASSISTANT";
  return identity === "GIRL" ? "GIRL" : "ASSISTANT";
}

/** Longueurs maximales d'une entrée de la fiche d'informations (le prompt reste borné). */
export const PERSONA_FAQ_Q_MAX = 300;
export const PERSONA_FAQ_A_MAX = 1000;

/**
 * Fiche d'informations lue en base (`Persona.faq`, JSON) : entrées `{ q, a }` nettoyées (espaces retirés, longueurs
 * bornées), entrées sans question ou sans réponse écartées, 40 au plus. Toute autre forme donne une fiche vide.
 */
export function parsePersonaFaq(v: unknown): PersonaFaqEntry[] {
  if (!Array.isArray(v)) return [];
  const out: PersonaFaqEntry[] = [];
  for (const item of v) {
    if (out.length >= PERSONA_FAQ_MAX) break;
    if (!item || typeof item !== "object") continue;
    const { q, a } = item as { q?: unknown; a?: unknown };
    if (typeof q !== "string" || typeof a !== "string") continue;
    const question = q.trim().slice(0, PERSONA_FAQ_Q_MAX);
    const answer = a.trim().slice(0, PERSONA_FAQ_A_MAX);
    if (question && answer) out.push({ q: question, a: answer });
  }
  return out;
}

/** Texte du bouton du lien d'offre proposé par défaut selon l'univers (sans promesse de gain). */
export const UNIVERSE_OFFER_BUTTON_DEFAULTS: Record<PersonaUniverse, string> = {
  dating: "Découvrir l'app",
  casino: "🎁 Accès VIP et bonus",
  sports: "🏆 Groupe VIP pronostics",
};

/**
 * Texte du bouton réellement affiché : celui de la persona, sauf s'il est vide ou resté au texte par défaut de
 * Rencontres sur une persona Casino / Paris (« Découvrir l'app » n'y a pas de sens).
 */
export function offerButtonTextFor(universe: unknown, text: string | null | undefined): string {
  const u = parsePersonaUniverse(universe);
  const t = (text ?? "").trim();
  if (!t) return UNIVERSE_OFFER_BUTTON_DEFAULTS[u];
  if (u !== "dating" && t === UNIVERSE_OFFER_BUTTON_DEFAULTS.dating) return UNIVERSE_OFFER_BUTTON_DEFAULTS[u];
  return t;
}

// ------------------------------------------------------------------
// Passage à un humain (Casino / Paris sportifs)
// ------------------------------------------------------------------

/**
 * Motifs du passage à un humain, valeurs stables de `Conversation.needsHumanReason` et du payload de l'événement
 * `needs_human` : question hors fiche, réclamation, demande d'argent, mineur possible, insulte.
 */
export const NEEDS_HUMAN_REASONS = ["off_faq", "complaint", "money", "minor", "insult"] as const;
export type NeedsHumanReason = (typeof NEEDS_HUMAN_REASONS)[number];

export function isNeedsHumanReason(v: unknown): v is NeedsHumanReason {
  return typeof v === "string" && (NEEDS_HUMAN_REASONS as readonly string[]).includes(v);
}

export const NEEDS_HUMAN_REASON_LABELS: Record<NeedsHumanReason, string> = {
  off_faq: "Question hors fiche",
  complaint: "Réclamation",
  money: "Demande d'argent",
  minor: "Peut-être mineur",
  insult: "Insulte",
};

/** Libellé d'un motif (« À traiter » pour une valeur inconnue). */
export function needsHumanReasonLabel(reason: unknown): string {
  return isNeedsHumanReason(reason) ? NEEDS_HUMAN_REASON_LABELS[reason] : "À traiter";
}

/**
 * L'assistante se tait-elle jusqu'à la reprise par l'équipe ? Oui pour tout motif sauf la question hors fiche (la
 * personne peut encore poser une question à laquelle la fiche répond) ; un motif inconnu se tait aussi (prudence).
 */
export function needsHumanSilencesAssistant(reason: unknown): boolean {
  return reason !== "off_faq";
}

/** Gravité d'un motif : le plus grave l'emporte quand plusieurs se suivent avant la reprise par l'équipe. */
const NEEDS_HUMAN_RANK: Record<NeedsHumanReason, number> = {
  off_faq: 0,
  insult: 1,
  complaint: 2,
  money: 3,
  minor: 4,
};

/**
 * Nouvel état « à traiter » : l'heure du premier passage est gardée (ancienneté dans la boîte de réception), le motif
 * le plus grave l'emporte.
 */
export function mergeNeedsHuman(
  current: { at: Date | null; reason: string | null },
  incoming: NeedsHumanReason,
  now: Date,
): { at: Date; reason: NeedsHumanReason } {
  if (!current.at) return { at: now, reason: incoming };
  const cur = isNeedsHumanReason(current.reason) ? current.reason : null;
  const reason = cur && NEEDS_HUMAN_RANK[cur] >= NEEDS_HUMAN_RANK[incoming] ? cur : incoming;
  return { at: current.at, reason };
}

/** Alerte groupée des conversations à traiter : au plus une toutes les 30 minutes. */
export const NEEDS_HUMAN_DIGEST_INTERVAL_MS = 30 * 60_000;
