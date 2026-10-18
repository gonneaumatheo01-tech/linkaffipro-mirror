/**
 * Chiffres de l'assistant de conversation (`/conversations/stats`, contrat docs/ASSISTANT-CONVERSATION.md § 6) :
 * par persona et par source du /start, et parcours par étape. Règles pures (testées) ; la lecture en base est dans
 * `stats-queries.ts`.
 *
 * Définitions (période en jours de Paris) :
 * - conversations : commencées dans la période ; réponses : parmi elles, celles où la personne a écrit au moins une
 *   fois après le premier message de l'assistante (ou de l'équipe) ;
 * - liens envoyés / ouverts : liens de l'offre envoyés dans la période / ouverts pour la première fois dans la période ;
 * - inscriptions et premiers dépôts : joueurs rattachés au clic d'un lien de l'offre d'une conversation, aux dates
 *   réelles de Link Affi (date d'inscription, date du premier dépôt), comme le reste des Statistiques ;
 * - coût de l'IA : appels de la période, hors « Tester » ;
 * - parcours : conversations commencées dans la période arrivées à chaque étape (étape actuelle ou passage enregistré ;
 *   « Inscrit » aussi pour toute conversation dont une inscription est rattachée, même fermée entre-temps).
 */
import type { ConversationStage } from "@linkaffipro/db";
import { JOURNEY_STAGES, NONE_KEY, personaLabel, sourceLabel } from "./labels";

/** Conversation commencée dans la période. */
export type StatsConversation = {
  personaId: string | null;
  source: string | null;
  stage: ConversationStage;
  /** La personne a écrit après le premier message de l'assistante (ou de l'équipe). */
  replied: boolean;
  /** Étapes atteintes d'après les passages enregistrés (`stage_changed`). */
  reached: readonly ConversationStage[];
  /**
   * Une inscription est rattachée à la conversation (`convertedAt`). Compte pour « Inscrit » même sans passage
   * d'étape : une conversation fermée (/stop, « Fermer », bot bloqué) puis convertie garde l'étape « Fermée ».
   */
  converted: boolean;
};

/** Événement rattaché à une persona et une source (lien envoyé, lien ouvert, coût). */
export type StatsKeyed = { personaId: string | null; source: string | null };
export type StatsCost = StatsKeyed & { costEur: number };
export type StatsPlayer = StatsKeyed & { registered: boolean; ftd: boolean };

export type StatsInput = {
  conversations: readonly StatsConversation[];
  linksSent: readonly StatsKeyed[];
  linksOpened: readonly StatsKeyed[];
  players: readonly StatsPlayer[];
  costs: readonly StatsCost[];
  /** Nom des personas, par identifiant. */
  personaNames: Readonly<Record<string, string>>;
};

export type Figures = {
  conversations: number;
  replies: number;
  linksSent: number;
  linksOpened: number;
  registrations: number;
  ftds: number;
  costEur: number;
};

export type FigureRow = Figures & {
  /** Clé de la ligne : identifiant de la persona ou source ; NONE_KEY pour « Sans persona » / « Sans source ». */
  key: string;
  label: string;
  /** Réponses ÷ conversations (null sans conversation). */
  replyRate: number | null;
  /** Coût de l'IA ÷ inscriptions (null sans inscription). */
  costPerRegistration: number | null;
};

export type JourneyStep = {
  stage: ConversationStage;
  count: number;
  /** Part des conversations commencées (null sans conversation). */
  share: number | null;
};

export type ConversationStats = {
  total: FigureRow;
  byPersona: FigureRow[];
  bySource: FigureRow[];
  journey: JourneyStep[];
};

export function emptyFigures(): Figures {
  return {
    conversations: 0,
    replies: 0,
    linksSent: 0,
    linksOpened: 0,
    registrations: 0,
    ftds: 0,
    costEur: 0,
  };
}

/** Coût arrondi au dix-millième d'euro (comme `AiConversationUsage.costEur`). */
function roundCost(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export function replyRate(f: Pick<Figures, "conversations" | "replies">): number | null {
  return f.conversations > 0 ? f.replies / f.conversations : null;
}

export function costPerRegistration(f: Pick<Figures, "costEur" | "registrations">): number | null {
  return f.registrations > 0 ? roundCost(f.costEur / f.registrations) : null;
}

function finish(key: string, label: string, f: Figures): FigureRow {
  const fig = { ...f, costEur: roundCost(f.costEur) };
  return {
    ...fig,
    key,
    label,
    replyRate: replyRate(fig),
    costPerRegistration: costPerRegistration(fig),
  };
}

type Bucket = Map<string, Figures>;

function bump(bucket: Bucket, key: string, apply: (f: Figures) => void): void {
  let f = bucket.get(key);
  if (!f) {
    f = emptyFigures();
    bucket.set(key, f);
  }
  apply(f);
}

const personaKey = (k: StatsKeyed) => k.personaId ?? NONE_KEY;
const sourceKey = (k: StatsKeyed) => k.source ?? NONE_KEY;

/** Lignes triées : le plus de conversations d'abord, puis le plus d'inscriptions, puis par nom ; « Sans … » en dernier. */
function sortRows(rows: FigureRow[]): FigureRow[] {
  return rows.sort(
    (a, b) =>
      Number(a.key === NONE_KEY) - Number(b.key === NONE_KEY) ||
      b.conversations - a.conversations ||
      b.registrations - a.registrations ||
      b.linksSent - a.linksSent ||
      a.label.localeCompare(b.label, "fr"),
  );
}

/**
 * Une conversation est-elle arrivée à cette étape (étape actuelle, passage enregistré, Accueil pour toutes, et
 * « Inscrit » dès qu'une inscription est rattachée, même pendant une fermeture) ?
 */
export function reachedStage(
  c: Pick<StatsConversation, "stage" | "reached" | "converted">,
  stage: ConversationStage,
): boolean {
  if (stage === "WELCOME") return true;
  if (stage === "CONVERTED" && c.converted) return true;
  return c.stage === stage || c.reached.includes(stage);
}

/** Parcours : conversations arrivées à chaque étape, de l'accueil jusqu'à l'inscription. */
export function journeySteps(conversations: readonly StatsConversation[]): JourneyStep[] {
  const total = conversations.length;
  return JOURNEY_STAGES.map((stage) => {
    const count = conversations.filter((c) => reachedStage(c, stage)).length;
    return { stage, count, share: total > 0 ? count / total : null };
  });
}

/** Tous les chiffres de la période : total, par persona, par source et parcours. */
export function aggregateConversationStats(input: StatsInput): ConversationStats {
  const total = emptyFigures();
  const persona: Bucket = new Map();
  const source: Bucket = new Map();
  const each = (k: StatsKeyed, apply: (f: Figures) => void) => {
    apply(total);
    bump(persona, personaKey(k), apply);
    bump(source, sourceKey(k), apply);
  };
  for (const c of input.conversations)
    each(c, (f) => {
      f.conversations += 1;
      if (c.replied) f.replies += 1;
    });
  for (const l of input.linksSent) each(l, (f) => void (f.linksSent += 1));
  for (const l of input.linksOpened) each(l, (f) => void (f.linksOpened += 1));
  for (const p of input.players)
    each(p, (f) => {
      if (p.registered) f.registrations += 1;
      if (p.ftd) f.ftds += 1;
    });
  for (const c of input.costs) each(c, (f) => void (f.costEur += c.costEur));

  const byPersona = sortRows(
    [...persona.entries()].map(([key, f]) =>
      finish(key, personaLabel(key === NONE_KEY ? null : (input.personaNames[key] ?? null)), f),
    ),
  );
  const bySource = sortRows(
    [...source.entries()].map(([key, f]) =>
      finish(key, sourceLabel(key === NONE_KEY ? null : key), f),
    ),
  );
  return {
    total: finish("total", "Toutes les conversations", total),
    byPersona,
    bySource,
    journey: journeySteps(input.conversations),
  };
}

/** Le plafond du mois et ce qui est déjà dépensé : part utilisée (0 à 1), null sans plafond. */
export function capShare(spentEur: number, capEur: number): number | null {
  if (!(capEur > 0)) return null;
  return Math.min(1, Math.max(0, spentEur / capEur));
}
