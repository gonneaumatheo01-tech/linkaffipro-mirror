import type { Prisma } from "@linkaffipro/db";
import { isDayKey, parisMidnightUtc, shiftDay } from "@/lib/periods";

// Module sans JSX (importé aussi par le tableau de bord et l'état du système, et par les tests d'intégration).
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** Numéro de page (entier ≥ 1), même règle que `pageOf` (components/admin/pagination.tsx). */
const pageOf = (sp: SP) => {
  const n = Number(one(sp.page));
  return Number.isInteger(n) && n > 0 ? n : 1;
};

/**
 * Événements montrables : les événements joueurs (`player.*`) sans membre viennent de la synchro Link Affi pour des
 * joueurs qui ne sont pas les nôtres (autres affiliés, offres non liées) ; ils restent dans Réglages → Connecteurs.
 */
export const VISIBLE_EVENT_WHERE = {
  NOT: { type: { startsWith: "player." }, memberId: null },
} satisfies Prisma.EventWhereInput;

/** Filtres de la vue « Événements » du Journal (`/settings/journal/events`). */
export type EventFilters = {
  type: string;
  channelId: string;
  botId: string;
  from: string;
  to: string;
  page: number;
};

export function parseEventFilters(sp: SP): EventFilters {
  return {
    type: one(sp.type).trim().slice(0, 60),
    channelId: one(sp.channelId),
    botId: one(sp.botId),
    from: one(sp.from),
    to: one(sp.to),
    page: pageOf(sp),
  };
}

/** Paramètres d'adresse de l'export CSV (`/settings/journal/export?view=events&…`), sans la page. */
export function eventsQuery(f: Omit<EventFilters, "page">): string {
  return new URLSearchParams(
    Object.entries({
      view: "events",
      type: f.type,
      channelId: f.channelId,
      botId: f.botId,
      from: f.from,
      to: f.to,
    }).filter(([, v]) => v),
  ).toString();
}

/** Bornes d'une période saisie en jours (heure de Paris) : début inclus, fin exclue (minuit Paris du lendemain). */
export function parisDayRange(from: string, to: string): { gte?: Date; lt?: Date } | null {
  const range: { gte?: Date; lt?: Date } = {};
  if (isDayKey(from)) range.gte = parisMidnightUtc(from);
  if (isDayKey(to)) range.lt = parisMidnightUtc(shiftDay(to, 1));
  return range.gte || range.lt ? range : null;
}

/** Clause Prisma de la vue « Événements » (fonction pure) : type (famille « telegram. » ou type exact), canal, bot, période. */
export function eventsWhere(f: Omit<EventFilters, "page">): { AND: Prisma.EventWhereInput[] } {
  const and: Prisma.EventWhereInput[] = [VISIBLE_EVENT_WHERE];
  if (f.type) and.push(f.type.endsWith(".") ? { type: { startsWith: f.type } } : { type: f.type });
  if (f.channelId) and.push({ channelId: f.channelId });
  if (f.botId) and.push({ botId: f.botId });
  const range = parisDayRange(f.from, f.to);
  if (range) and.push({ occurredAt: range });
  return { AND: and };
}
