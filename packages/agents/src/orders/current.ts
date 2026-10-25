/**
 * Phase 33 (chantier B) — ordres en cours vus par Kevin : lecture des `TeamOrder`, ordre visé sans le nommer (« passe à
 * 3 par jour », « arrête » → l'ordre en cours le plus récent de la conversation), lignes de mémoire injectées dans
 * l'interprète (« ordre n°12 en cours : … »), libellés en français courant (jamais de statut en anglais).
 */
import { nowOf } from "../admin/journal";
import { addDaysToDay, parisDay } from "../rules/time";
import { TEAM_LABELS, isTeamKey, type AgentsDeps } from "../types";
import type { OrderPlan, OrderStep } from "./contract";

/** Ordre tel que lu par Kevin (champs utiles). */
export type TeamOrderRow = {
  id: string;
  number: number;
  requestText: string;
  interpretation: unknown;
  recap: string;
  kind: string;
  teamKey: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  progress: unknown;
  impossible: unknown;
  createdById: string | null;
  chatId: string | null;
  pendingId: string | null;
  planCacheKey: string | null;
  costCents: number;
  createdAt: Date;
};

/** Ce que Kevin garde dans `TeamOrder.interpretation` (plan validé + ce qui sera créé). */
export type StoredInterpretation = OrderPlan & {
  /** Canaux touchés (dérogations prévues ou portée). */
  channelIds?: string[];
  fromDay?: string | null;
  toDay?: string | null;
  plannedSteps?: OrderStep[];
  clamped?: string[];
  /** Plan brut du planificateur (cache 24 h). */
  raw?: OrderPlan | null;
  /** Modification en attente d'un OUI. */
  pendingChange?: { plan: OrderPlan; steps: OrderStep[]; recap: string } | null;
  /** Ordre remplacé (chevauchement : « garde le nouveau »). */
  replaces?: string | null;
};

export const OPEN_ORDER_STATUSES = ["DRAFT", "WAITING_CONFIRM", "RUNNING", "BLOCKED"] as const;
export const LIVE_ORDER_STATUSES = ["WAITING_CONFIRM", "RUNNING", "BLOCKED"] as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "en préparation",
  WAITING_CONFIRM: "attend ton OUI",
  RUNNING: "en cours",
  DONE: "terminé",
  CANCELLED: "annulé",
  BLOCKED: "bloqué",
  FAILED: "en échec",
};

/** Équipes futures (phases 28 à 32) : nommées, pas encore « ordonnables ». */
export const FUTURE_TEAMS: Record<string, string> = {
  montage: "l'équipe Montage",
  analystes: "l'équipe Analystes",
  qa: "l'équipe Contrôle global",
  prospection: "l'équipe Prospection",
};

/** Libellé d'une équipe d'ordre (« Paris sportifs », « Pubs », « Inspiration »…). */
export function orderTeamLabel(teamKey: string): string {
  if (isTeamKey(teamKey)) return TEAM_LABELS[teamKey];
  if (teamKey === "ads") return "Pubs";
  if (teamKey === "inspiration") return "Inspiration";
  if (teamKey === "transverse") return "toutes les équipes";
  const future = FUTURE_TEAMS[teamKey];
  if (future) return future.replace(/^l'équipe /, "");
  return teamKey;
}

/** Unité produite par une équipe (« paris », « posts »). */
export function unitOf(teamKey: string | null | undefined, n = 2): string {
  if (teamKey === "sports") return n > 1 ? "paris" : "pari";
  return n > 1 ? "posts" : "post";
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « 25 octobre » (jour AAAA-MM-JJ). */
export function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** « du 25 au 27 octobre », « le 25 octobre », « du 30 octobre au 2 novembre ». */
export function periodLabel(fromDay: string, toDay: string): string {
  if (fromDay === toDay) return `le ${dayLabel(fromDay)}`;
  const [, m1, d1] = fromDay.split("-").map(Number);
  const [, m2] = toDay.split("-").map(Number);
  return m1 === m2 ? `du ${d1} au ${dayLabel(toDay)}` : `du ${dayLabel(fromDay)} au ${dayLabel(toDay)}`;
}

/** Dernier jour d'une période de `days` jours. */
export function periodEnd(start: string, days: number): string {
  return addDaysToDay(start, Math.max(1, days) - 1);
}

export function interpretationOf(row: Pick<TeamOrderRow, "interpretation">): StoredInterpretation | null {
  const v = row.interpretation;
  return v && typeof v === "object" && !Array.isArray(v) && "steps" in (v as object) ? (v as StoredInterpretation) : null;
}

/** Ordres ouverts, du plus récent au plus ancien (conversation donnée en premier si connue). */
export async function openOrders(deps: Pick<AgentsDeps, "prisma">, opts: { statuses?: readonly string[]; take?: number } = {}): Promise<TeamOrderRow[]> {
  return (await deps.prisma.teamOrder.findMany({
    where: { status: { in: [...(opts.statuses ?? LIVE_ORDER_STATUSES)] as never } },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 20,
  })) as unknown as TeamOrderRow[];
}

export async function orderById(deps: Pick<AgentsDeps, "prisma">, id: string): Promise<TeamOrderRow | null> {
  return (await deps.prisma.teamOrder.findUnique({ where: { id } })) as unknown as TeamOrderRow | null;
}

/** Noms des canaux (titre), pour les textes. */
export async function channelNames(deps: Pick<AgentsDeps, "prisma">, ids: readonly string[]): Promise<Map<string, { name: string; isTest: boolean }>> {
  if (!ids.length) return new Map();
  const rows = (await deps.prisma.channel.findMany({ where: { id: { in: [...ids] } }, select: { id: true, title: true, isTest: true } })) as {
    id: string;
    title: string;
    isTest: boolean;
  }[];
  return new Map(rows.map((r) => [r.id, { name: r.isTest ? "le canal Test" : r.title, isTest: r.isTest }]));
}

/** « le canal Test », « Paris Foot et Casino VIP », « toute l'équipe ». */
export async function scopeLabel(deps: Pick<AgentsDeps, "prisma">, interp: StoredInterpretation | null): Promise<string> {
  if (!interp) return "";
  const scope = interp.scope as { test?: boolean; teamWide?: boolean; channelIds?: string[] } | undefined;
  const ids = interp.channelIds?.length ? interp.channelIds : (scope?.channelIds ?? []);
  if (ids.length) {
    const names = await channelNames(deps, ids);
    const list = ids.map((id) => names.get(id)?.name ?? "un canal");
    return list.length <= 2 ? list.join(" et ") : `${list.slice(0, 2).join(", ")} et ${list.length - 2} autre${list.length > 3 ? "s" : ""}`;
  }
  if (scope?.test) return "le canal Test";
  if (scope?.teamWide) return "tous les canaux de l'équipe";
  return "";
}

/** Ligne courte d'un ordre (« n°12 · paris sur le canal Test · du 25 au 27 octobre · en cours »). */
export async function orderShortLine(deps: Pick<AgentsDeps, "prisma">, row: TeamOrderRow): Promise<string> {
  const interp = interpretationOf(row);
  const team = interp?.asIfTeamKey ?? row.teamKey;
  const where = await scopeLabel(deps, interp);
  const period = interp?.fromDay && interp?.toDay ? periodLabel(interp.fromDay, interp.toDay) : null;
  const what = team === "sports" ? "paris" : isTeamKey(team) && team !== "algo" ? `posts ${orderTeamLabel(team)}` : orderTeamLabel(team);
  return [`n°${row.number}`, `${what}${where ? ` sur ${where}` : ""}`, period, ORDER_STATUS_LABELS[row.status] ?? row.status].filter(Boolean).join(" · ");
}

/** Jour courant d'un ordre (1 à N) et nombre de jours, ou null. */
export function orderDayIndex(interp: StoredInterpretation | null, now: Date): { index: number; days: number } | null {
  if (!interp?.fromDay || !interp.toDay) return null;
  const today = parisDay(now);
  let days = 1;
  for (let d = interp.fromDay; d < interp.toDay && days < 400; d = addDaysToDay(d, 1)) days++;
  let index = 1;
  for (let d = interp.fromDay; d < today && index <= days; d = addDaysToDay(d, 1)) index++;
  return { index: Math.min(Math.max(index, 1), days), days };
}

/**
 * Ordre visé sans le nommer : numéro (« 12 », « n°12 »), sinon nom d'un canal ou d'une équipe contenu dans la
 * référence, sinon l'ordre vivant le plus récent de cette conversation, sinon le plus récent tout court. Plusieurs
 * candidats pour une référence par nom → liste (l'appelant pose la question).
 */
export async function findOrderRef(
  deps: Pick<AgentsDeps, "prisma" | "now">,
  ref: string | undefined,
  opts: { chatId?: bigint | string | null; statuses?: readonly string[] } = {},
): Promise<{ kind: "one"; order: TeamOrderRow } | { kind: "many"; orders: TeamOrderRow[] } | { kind: "none" }> {
  const statuses = opts.statuses ?? LIVE_ORDER_STATUSES;
  const raw = (ref ?? "").trim();
  const num = /^(?:(?:l'|le\s+)?ordre\s*)?(?:n[°o]?\s*|#)?(\d{1,6})$/i.exec(raw);
  if (num) {
    const row = (await deps.prisma.teamOrder.findFirst({ where: { number: Number(num[1]) } })) as unknown as TeamOrderRow | null;
    return row ? { kind: "one", order: row } : { kind: "none" };
  }
  const idRef = /^id:(\S+)$/.exec(raw);
  if (idRef) {
    const row = await orderById(deps, idRef[1]!);
    return row ? { kind: "one", order: row } : { kind: "none" };
  }
  const rows = await openOrders(deps, { statuses, take: 30 });
  if (!rows.length) return { kind: "none" };
  if (raw) {
    const n = norm(raw);
    const hits: TeamOrderRow[] = [];
    for (const r of rows) {
      const interp = interpretationOf(r);
      const where = norm(await scopeLabel(deps, interp));
      const team = norm(orderTeamLabel(interp?.asIfTeamKey ?? r.teamKey));
      const words = n.split(" ").filter((w) => w.length >= 3 && !["ordre", "canal", "equipe", "sur", "les", "des"].includes(w));
      if (words.length && words.some((w) => where.includes(w) || team.includes(w) || norm(r.requestText).includes(w))) hits.push(r);
    }
    if (hits.length === 1) return { kind: "one", order: hits[0]! };
    if (hits.length > 1) return { kind: "many", orders: hits };
  }
  const chat = opts.chatId != null ? String(opts.chatId) : null;
  const inChat = chat ? rows.filter((r) => r.chatId === chat) : [];
  return { kind: "one", order: (inChat[0] ?? rows[0])! };
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Un ordre appartient-il à cette conversation (pur) ? Groupe (identifiant négatif) : ses ordres seulement. Privé :
 * ses ordres et les anciens sans conversation. Conversation inconnue (privé de l'admin, ancien chemin) : tout sauf
 * les ordres des groupes.
 */
export function orderInConversation(orderChatId: string | null, chat: string | null): boolean {
  if (chat === null) return orderChatId === null || !orderChatId.startsWith("-");
  if (chat.startsWith("-")) return orderChatId === chat;
  return orderChatId === chat || orderChatId === null;
}

/**
 * Lignes de mémoire pour l'interprète (règle 5) : les ordres vivants, le plus récent d'abord, pour que « passe à 3
 * par jour », « arrête », « prolonge de 2 jours » se rattachent au bon ordre. Données seulement.
 */
export async function ordersMemoryLines(deps: Pick<AgentsDeps, "prisma" | "now">, chatId?: bigint | string | null): Promise<string[]> {
  try {
    const all = await openOrders(deps, { take: 30 });
    const chat = chatId != null ? String(chatId) : null;
    // Mémoire de CETTE conversation seulement : le groupe ne voit jamais les ordres donnés en privé (ni l'inverse).
    const rows = all.filter((r) => orderInConversation(r.chatId, chat));
    if (!rows.length) return ["Aucun ordre en cours."];
    const sorted = [...rows.filter((r) => chat && r.chatId === chat), ...rows.filter((r) => !chat || r.chatId !== chat)];
    const now = nowOf(deps);
    const out: string[] = [];
    for (const r of sorted.slice(0, 5)) {
      const interp = interpretationOf(r);
      const day = orderDayIndex(interp, now);
      out.push(
        `Ordre n°${r.number} ${ORDER_STATUS_LABELS[r.status] ?? r.status}${day ? ` (jour ${day.index}/${day.days})` : ""} : ${(r.recap.split("\n")[0] ?? "").slice(0, 220)}`,
      );
    }
    return [`Ordres (le premier est celui dont on parle si l'admin ne précise pas) :`, ...out];
  } catch {
    return [];
  }
}
