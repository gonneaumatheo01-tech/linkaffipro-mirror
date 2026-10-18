/**
 * Filtres de la boîte de réception (`/conversations`) : étape, qui répond, source du /start, persona, « non lues »
 * (dernier message de la personne, sans réponse, hors conversations définitives : voir `inbox.ts`), page. Lecture tolérante des paramètres d'adresse et liens qui
 * gardent les autres filtres (mémorisés par `RememberFilters`). Règles pures (testées).
 */
import type { ConversationStage, ConversationStatus } from "@linkaffipro/db";
import { NONE_KEY } from "./labels";

const STAGES: readonly ConversationStage[] = [
  "WELCOME",
  "CHAT",
  "PROPOSAL",
  "LINK_SENT",
  "FOLLOW_UP",
  "CONVERTED",
  "CLOSED",
];
const STATUSES: readonly ConversationStatus[] = ["BOT", "HUMAN", "PAUSED", "CLOSED"];

/** Source du /start telle que la réception la garde ([A-Za-z0-9_-], 64 caractères au plus). */
const SOURCE_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Identifiant de persona (cuid). */
const ID_RE = /^[a-z0-9]{8,40}$/;

export type InboxFilters = {
  stage: ConversationStage | "";
  status: ConversationStatus | "";
  /** "" (toutes), NONE_KEY (sans source) ou la source. */
  source: string;
  /** "" (toutes), NONE_KEY (sans persona) ou l'identifiant. */
  persona: string;
  /** Seulement les conversations dont le dernier message est celui de la personne (sans réponse). */
  unread: boolean;
  page: number;
};

type Param = string | string[] | undefined;

function one(v: Param): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s.trim() : "";
}

export function parseInboxFilters(sp: Record<string, Param>): InboxFilters {
  const stage = one(sp.stage);
  const status = one(sp.status);
  const source = one(sp.source);
  const persona = one(sp.persona);
  const page = Number(one(sp.page));
  const unread = one(sp.unread);
  return {
    stage: (STAGES as readonly string[]).includes(stage) ? (stage as ConversationStage) : "",
    status: (STATUSES as readonly string[]).includes(status) ? (status as ConversationStatus) : "",
    source: source === NONE_KEY || SOURCE_RE.test(source) ? source : "",
    persona: persona === NONE_KEY || ID_RE.test(persona) ? persona : "",
    unread: unread === "1" || unread === "true" || unread === "on",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Nombre de filtres posés (la page n'en est pas un). */
export function activeInboxFilterCount(f: InboxFilters): number {
  return [f.stage, f.status, f.source, f.persona, f.unread ? "1" : ""].filter(Boolean).length;
}

export function hasInboxFilters(f: InboxFilters): boolean {
  return activeInboxFilterCount(f) > 0;
}

/** Paramètres d'adresse des filtres (page comprise si > 1), sans valeur vide. */
export function inboxParams(f: InboxFilters, opts: { withPage?: boolean } = {}): URLSearchParams {
  const p = new URLSearchParams();
  if (f.stage) p.set("stage", f.stage);
  if (f.status) p.set("status", f.status);
  if (f.source) p.set("source", f.source);
  if (f.persona) p.set("persona", f.persona);
  if (f.unread) p.set("unread", "1");
  if (opts.withPage !== false && f.page > 1) p.set("page", String(f.page));
  return p;
}

/**
 * Adresse « toute la liste » : jamais l'adresse nue, que `RememberFilters` remplacerait par les filtres mémorisés
 * (« Toutes » ramènerait sinon les « Non lues » d'avant). Un paramètre vide ne compte ni comme filtre ni en mémoire.
 */
export const INBOX_ALL_HREF = "/conversations?stage=";

/** Adresse de la boîte de réception avec ces filtres, modifiés par `patch` (un changement de filtre revient page 1). */
export function inboxHref(f: InboxFilters, patch: Partial<InboxFilters> = {}): string {
  const next: InboxFilters = { ...f, ...patch };
  if (!("page" in patch)) next.page = 1;
  const q = inboxParams(next).toString();
  return q ? `/conversations?${q}` : INBOX_ALL_HREF;
}

/** Filtres vides (« Voir toutes les conversations »). */
export function clearedInboxFilters(): InboxFilters {
  return { stage: "", status: "", source: "", persona: "", unread: false, page: 1 };
}

/** Adresse de l'export CSV de la liste (mêmes filtres, sans la page). */
export function inboxExportHref(f: InboxFilters): string {
  const q = inboxParams(f, { withPage: false }).toString();
  return q ? `/api/conversations/export?${q}` : "/api/conversations/export";
}
