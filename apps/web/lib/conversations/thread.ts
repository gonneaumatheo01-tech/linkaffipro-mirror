/**
 * Fil d'une conversation (fiche `/conversations/[id]` et route du fil en direct) : messages prêts à afficher (bulles
 * personne / assistante / équipe / système, médias décrits, lien de l'offre envoyé, état de l'envoi d'un message de
 * l'équipe), fusion des nouveaux messages reçus toutes les 4 s, repère d'état (un changement recharge la page).
 * Aucun repère interne n'est jamais affiché (refus de l'IA, modèle, tour…). Règles pures (testées), sans Prisma ni
 * React : le composant client les importe.
 */
import { assistantNoun, messageText } from "./labels";

export type ThreadSide = "in" | "out" | "system";
export type ThreadAuthor = "MEMBER" | "ASSISTANT" | "TEAM" | "SYSTEM";
export type DeliveryStatus = "QUEUED" | "SENT" | "FAILED" | "BLOCKED";

/** Message du fil, sérialisable (passé au composant client et renvoyé par la route du fil en direct). */
export type ThreadMessage = {
  id: string;
  side: ThreadSide;
  author: ThreadAuthor;
  /** Qui parle, en clair : « Léa (assistante) », « Équipe · Marie », « Message automatique ». */
  authorLabel: string;
  /** Texte lisible (média décrit « [photo] » + légende). */
  text: string;
  /** Date ISO. */
  at: string;
  /** La personne a appuyé sur Démarrer (/start), avec la source éventuelle. */
  start: { source: string | null } | null;
  /** Identifiant de suivi du lien de l'offre joint à ce message (bouton « Lien de l'offre envoyé »). */
  offerSubId: string | null;
  /** Relance après un silence. */
  followUp: boolean;
  /** Message d'attente envoyé pendant une panne de l'IA. */
  neutral: boolean;
  /** État de l'envoi (messages sortants ; null : pas d'envoi suivi). */
  delivery: DeliveryStatus | null;
  /** Raison d'un envoi raté (message de l'équipe). */
  deliveryError: string | null;
};

/** Ligne de `ConversationMessage` lue pour le fil (avec l'envoi et l'auteur de l'équipe). */
export type ThreadMessageRow = {
  id: string;
  direction: "IN" | "OUT";
  author: ThreadAuthor;
  text: string;
  media: unknown;
  meta: unknown;
  createdAt: Date;
  teamUser: { name: string } | null;
  outboundMessage: { status: DeliveryStatus; error: string | null } | null;
};

export type ThreadPersona = { name: string; gender: string } | null;

function metaOf(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

/** « Léa (assistante) » ; « Assistante » sans persona. */
export function assistantLabel(persona: ThreadPersona): string {
  if (!persona) return "Assistante";
  return `${persona.name} (${assistantNoun(persona.gender)})`;
}

/** Message de la base → message du fil. */
export function toThreadMessage(row: ThreadMessageRow, persona: ThreadPersona): ThreadMessage {
  const meta = metaOf(row.meta);
  const command = typeof meta.command === "string" ? meta.command : null;
  const isStart = row.direction === "IN" && command === "start";
  const side: ThreadSide =
    row.author === "SYSTEM" || isStart ? "system" : row.direction === "IN" ? "in" : "out";
  const authorLabel =
    row.author === "MEMBER"
      ? "La personne"
      : row.author === "ASSISTANT"
        ? assistantLabel(persona)
        : row.author === "TEAM"
          ? `Équipe${row.teamUser?.name ? ` · ${row.teamUser.name}` : ""}`
          : "Message automatique";
  const offerSubId = typeof meta.offerSubId === "string" ? meta.offerSubId : null;
  return {
    id: row.id,
    side,
    author: row.author,
    authorLabel,
    text: isStart ? "" : messageText(row.text, row.media),
    at: row.createdAt.toISOString(),
    start: isStart ? { source: typeof meta.source === "string" ? meta.source : null } : null,
    offerSubId,
    followUp: meta.followUp === true,
    neutral: meta.neutral === true,
    delivery: row.direction === "OUT" ? (row.outboundMessage?.status ?? null) : null,
    deliveryError:
      row.direction === "OUT" && row.outboundMessage && row.outboundMessage.status !== "SENT"
        ? row.outboundMessage.error
        : null,
  };
}

/** Avancement d'un envoi : il ne fait qu'avancer (en file → parti ou raté), jamais revenir en arrière. */
export function deliveryRank(d: DeliveryStatus | null): number {
  return d === null ? 0 : d === "QUEUED" ? 1 : 2;
}

/**
 * Fusionne deux lectures du fil (page affichée et fil en direct, dans n'importe quel ordre) : chaque message une
 * seule fois, avec l'envoi le plus avancé des deux lectures (« en cours d'envoi » ne remplace jamais « parti »), dans
 * l'ordre chronologique (puis par identifiant). Les listes n'ont pas besoin d'être triées.
 */
export function mergeThread(
  current: readonly ThreadMessage[],
  incoming: readonly ThreadMessage[],
): ThreadMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) {
    const known = byId.get(m.id);
    if (!known || deliveryRank(m.delivery) >= deliveryRank(known.delivery)) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** Fusionne deux lectures des liens de l'offre : un lien ouvert le reste, le nombre d'ouvertures ne baisse pas. */
export function mergeOffers(
  a: Readonly<Record<string, OfferState>>,
  b: Readonly<Record<string, OfferState>> | null | undefined,
): Record<string, OfferState> {
  const out: Record<string, OfferState> = { ...a };
  for (const [subId, o] of Object.entries(b ?? {})) {
    const k = out[subId];
    out[subId] = k
      ? {
          openedAt:
            k.openedAt && o.openedAt
              ? k.openedAt < o.openedAt
                ? k.openedAt
                : o.openedAt
              : (k.openedAt ?? o.openedAt),
          opens: Math.max(k.opens, o.opens),
        }
      : o;
  }
  return out;
}

/** Curseur du fil : date ISO du message le plus récent (ou la valeur d'avant s'il n'y a rien). */
export function threadCursor(messages: readonly ThreadMessage[], fallback: string): string {
  let max = fallback;
  for (const m of messages) if (m.at > max) max = m.at;
  return max;
}

/**
 * Marge de relecture du fil en direct : les messages créés dans la minute qui précède le curseur sont renvoyés (un
 * message enregistré juste avant un autre, mais visible juste après, n'est jamais perdu) ; le fil les déduplique.
 */
export const THREAD_LOOKBACK_MS = 60_000;

/** Début de la relecture : curseur moins la marge ; null si le curseur est absent ou illisible (tout le fil). */
export function threadSince(after: string | null | undefined): Date | null {
  if (!after) return null;
  const t = Date.parse(after);
  return Number.isFinite(t) ? new Date(t - THREAD_LOOKBACK_MS) : null;
}

/** Nombre de messages lus au plus pour le fil (les plus récents). */
export const THREAD_LIMIT = 200;

/** Rafraîchissement du fil en direct (onglet visible seulement). */
export const THREAD_POLL_MS = 4000;

/** Événement de fenêtre qui demande au fil de se relire tout de suite (après « Envoyer »). */
export const THREAD_REFRESH_EVENT = "lap:conversation-refresh";

/** État de la conversation dont un changement doit recharger la fiche (boutons, en-tête, phrase d'explication). */
export type ThreadState = {
  status: string;
  stage: string;
  closedReason: string | null;
  stopped: boolean;
  minor: boolean;
  memberBlocked: boolean;
  takenOverById: string | null;
  /** Nombre de /reset (un /reset efface les messages : le fil est relu en entier). */
  resets: number;
};

/** Repère d'état : identique tant que rien de visible hors du fil n'a changé. */
export function threadStateKey(s: ThreadState): string {
  return [
    s.status,
    s.stage,
    s.closedReason ?? "",
    s.stopped ? "s" : "",
    s.minor ? "m" : "",
    s.memberBlocked ? "b" : "",
    s.takenOverById ?? "",
    String(s.resets),
  ].join("|");
}

/** Lien de l'offre envoyé : ouvert (date de la première ouverture) ou pas encore. */
export type OfferState = { openedAt: string | null; opens: number };

/** Réponse de GET /api/conversations/[id]/messages. */
export type ThreadUpdate = {
  messages: ThreadMessage[];
  offers: Record<string, OfferState>;
  stateKey: string;
  cursor: string;
  /**
   * Date ISO à partir de laquelle `messages` contient TOUS les messages qui existent encore : un message affiché daté
   * de ce moment ou après, absent de la réponse, n'existe plus (envoi de l'assistante raté puis retiré par le worker).
   */
  windowStart: string;
};

/**
 * Début de la fenêtre complète d'une relecture : `since` (ou le tout début du fil si toute la conversation a été lue) ;
 * si la lecture a atteint la limite de 200 messages, juste après le plus ancien message renvoyé (les messages du même
 * instant peuvent manquer). `rows` : du plus récent au plus ancien, comme la lecture en base.
 */
export function threadWindowStart(
  since: Date | null,
  rows: ReadonlyArray<{ createdAt: Date }>,
  limit: number = THREAD_LIMIT,
): string {
  const oldest = rows[rows.length - 1];
  if (rows.length >= limit && oldest) return new Date(oldest.createdAt.getTime() + 1).toISOString();
  return (since ?? new Date(0)).toISOString();
}

/**
 * Messages affichés qui n'existent plus : datés du début de la fenêtre complète ou après, mais absents de la relecture
 * (le worker retire le message d'un envoi raté : bot bloqué, personne injoignable). Le fil les retire, jamais une bulle
 * « Envoi en cours… » pour un message que la personne n'a jamais reçu. `shown` : messages affichés AVANT l'envoi de la
 * relecture (ils existaient donc avant sa lecture en base).
 */
export function vanishedFromThread(
  shown: readonly ThreadMessage[],
  update: Pick<ThreadUpdate, "messages" | "windowStart">,
): Set<string> {
  const present = new Set(update.messages.map((m) => m.id));
  const gone = new Set<string>();
  for (const m of shown) if (m.at >= update.windowStart && !present.has(m.id)) gone.add(m.id);
  return gone;
}

/**
 * Messages retirés du fil après une relecture : ceux d'avant, plus ceux qui viennent de disparaître, moins ceux que la
 * relecture renvoie (jamais un message existant caché).
 */
export function nextRemoved(
  removed: ReadonlySet<string>,
  vanished: ReadonlySet<string>,
  incoming: readonly ThreadMessage[],
): Set<string> {
  const out = new Set([...removed, ...vanished]);
  for (const m of incoming) out.delete(m.id);
  return out;
}
