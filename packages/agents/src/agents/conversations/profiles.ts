/**
 * Chiffres par profil de conversation (pur, testé) : un profil = un bot (assistant, ou bot fantôme d'un compte réel),
 * une persona et une source du /start. Définitions alignées sur Conversations → Chiffres :
 * - réponse : la personne écrit (hors commande) après le premier message de l'assistante ou de l'équipe, ou la
 *   conversation a passé une étape qui suppose une réponse (le fil a pu être effacé par /reset) ;
 * - messages avant le lien : messages de la personne avant le premier lien de l'offre envoyé ;
 * - décrochage : conversation non convertie, fermée ou muette depuis 24 h ; étape = étape actuelle, ou l'étape quittée
 *   pour « Fermée » ;
 * - délai de réponse : entre le dernier message envoyé et la réponse qui le suit ;
 * - liens, ouvertures (clics), inscriptions, premiers dépôts et coût de l'IA : datés dans la période.
 */
import type { ConversationProfileStats } from "../../algo/contracts";
import { parisParts } from "../../rules/time";

export const NONE = "-";
const STAGE_ORDER = ["WELCOME", "CHAT", "PROPOSAL", "LINK_SENT", "FOLLOW_UP", "CONVERTED", "CLOSED"] as const;
/** Étapes qui supposent une réponse de la personne. */
const REPLY_STAGES = new Set(["CHAT", "PROPOSAL", "LINK_SENT", "FOLLOW_UP", "CONVERTED"]);
const SILENT_AFTER_MS = 24 * 3_600_000;

export type ProfileRef = { botId: string; personaId: string | null; source: string | null };

export type ProfileConversationRow = ProfileRef & {
  id: string;
  stage: string;
  status: string;
  createdAt: Date;
  convertedAt: Date | null;
  lastInboundAt: Date | null;
  lastAssistantAt: Date | null;
};

/** Message sans texte (le calcul n'en a pas besoin). */
export type ProfileMessageRow = {
  conversationId: string;
  direction: "IN" | "OUT";
  author: string;
  isCommand: boolean;
  createdAt: Date;
};

export type ProfileEventRow = {
  conversationId: string;
  type: string;
  fromStage: string | null;
  toStage: string | null;
  createdAt: Date;
};

export type ProfileLinkRow = ProfileRef & { conversationId: string | null; sentAt: Date; firstOpenedAt: Date | null };
export type ProfilePlayerRow = ProfileRef & { registeredAt: Date | null; ftdAt: Date | null };
export type ProfileCostRow = ProfileRef & { costEur: number };
export type ProfileBotInfo = { label: string; kind: "BOT" | "ACCOUNT" };

export type ProfileInput = {
  start: Date;
  end: Date;
  conversations: readonly ProfileConversationRow[];
  messages: readonly ProfileMessageRow[];
  events: readonly ProfileEventRow[];
  links: readonly ProfileLinkRow[];
  players: readonly ProfilePlayerRow[];
  costs: readonly ProfileCostRow[];
  bots: Readonly<Record<string, ProfileBotInfo>>;
  personaNames: Readonly<Record<string, string>>;
  minConversations: number;
};

export function profileKey(r: ProfileRef): string {
  return `${r.botId}:${r.personaId ?? NONE}:${r.source ?? NONE}`;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const inRange = (d: Date | null, start: Date, end: Date) => Boolean(d && d >= start && d < end);
const isMember = (m: ProfileMessageRow) => m.direction === "IN" && m.author === "MEMBER" && !m.isCommand;
const isSentByUs = (m: ProfileMessageRow) => m.direction === "OUT" && (m.author === "ASSISTANT" || m.author === "TEAM");

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** La personne a-t-elle répondu au premier message envoyé ? (messages triés par date) */
export function hasReplied(messages: readonly ProfileMessageRow[], events: readonly ProfileEventRow[]): boolean {
  const firstOut = messages.find(isSentByUs);
  if (firstOut && messages.some((m) => isMember(m) && m.createdAt > firstOut.createdAt)) return true;
  return events.some((e) => e.type === "stage_changed" && e.toStage !== null && REPLY_STAGES.has(e.toStage));
}

/** Délais (s) entre notre dernier message et la réponse de la personne qui le suit. */
export function replyDelays(messages: readonly ProfileMessageRow[]): number[] {
  const out: number[] = [];
  let lastOut: Date | null = null;
  for (const m of messages) {
    if (isSentByUs(m)) lastOut = m.createdAt;
    else if (isMember(m) && lastOut) {
      out.push(Math.max(0, Math.round((m.createdAt.getTime() - lastOut.getTime()) / 1000)));
      lastOut = null;
    }
  }
  return out;
}

/** Étape où la conversation a décroché, ou null si elle est convertie ou encore active. */
export function dropStageOf(
  c: ProfileConversationRow,
  events: readonly ProfileEventRow[],
  now: Date,
): string | null {
  if (c.convertedAt || c.stage === "CONVERTED") return null;
  const last = Math.max(c.lastInboundAt?.getTime() ?? 0, c.lastAssistantAt?.getTime() ?? 0, c.createdAt.getTime());
  const closed = c.stage === "CLOSED" || c.status === "CLOSED";
  if (!closed && now.getTime() - last < SILENT_AFTER_MS) return null;
  if (c.stage !== "CLOSED") return c.stage;
  const toClosed = [...events]
    .filter((e) => e.type === "stage_changed" && e.toStage === "CLOSED" && e.fromStage)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return toClosed?.fromStage ?? "CLOSED";
}

/** Étape la plus fréquente ; à égalité, la plus tôt dans le parcours. */
export function mostFrequentStage(stages: readonly string[]): string | null {
  if (!stages.length) return null;
  const counts = new Map<string, number>();
  for (const s of stages) counts.set(s, (counts.get(s) ?? 0) + 1);
  const rank = (s: string) => {
    const i = (STAGE_ORDER as readonly string[]).indexOf(s);
    return i < 0 ? STAGE_ORDER.length : i;
  };
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))[0]![0];
}

/** Les 3 heures de Paris où les gens écrivent le plus (les plus fréquentes d'abord, puis par heure). */
export function topReplyHours(dates: readonly Date[], max = 3): number[] {
  const counts = new Map<number, number>();
  for (const d of dates) {
    const h = parisParts(d).hour;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, max)
    .map(([h]) => h);
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

type Acc = ProfileRef & {
  convs: ProfileConversationRow[];
  linksSent: number;
  clicks: number;
  registrations: number;
  ftds: number;
  cost: number;
};

/** Tous les profils de la période, le plus de conversations d'abord. */
export function aggregateProfiles(input: ProfileInput, now: Date): ConversationProfileStats[] {
  const accs = new Map<string, Acc>();
  const acc = (r: ProfileRef): Acc => {
    const k = profileKey(r);
    let a = accs.get(k);
    if (!a) {
      a = { botId: r.botId, personaId: r.personaId, source: r.source, convs: [], linksSent: 0, clicks: 0, registrations: 0, ftds: 0, cost: 0 };
      accs.set(k, a);
    }
    return a;
  };
  for (const c of input.conversations) acc(c).convs.push(c);
  for (const l of input.links) {
    if (inRange(l.sentAt, input.start, input.end)) acc(l).linksSent += 1;
    if (inRange(l.firstOpenedAt, input.start, input.end)) acc(l).clicks += 1;
  }
  for (const p of input.players) {
    const reg = inRange(p.registeredAt, input.start, input.end);
    const ftd = inRange(p.ftdAt, input.start, input.end);
    if (!reg && !ftd) continue;
    const a = acc(p);
    if (reg) a.registrations += 1;
    if (ftd) a.ftds += 1;
  }
  for (const c of input.costs) acc(c).cost += c.costEur;

  const sortedMessages = [...input.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const messagesOf = groupBy(sortedMessages, (m) => m.conversationId);
  const eventsOf = groupBy(input.events, (e) => e.conversationId);
  const firstLinkOf = new Map<string, Date>();
  for (const l of input.links) {
    if (!l.conversationId) continue;
    const cur = firstLinkOf.get(l.conversationId);
    if (!cur || l.sentAt < cur) firstLinkOf.set(l.conversationId, l.sentAt);
  }

  const out: ConversationProfileStats[] = [];
  for (const [key, a] of accs) {
    let replied = 0;
    const beforeLink: number[] = [];
    const delays: number[] = [];
    const drops: string[] = [];
    const memberDates: Date[] = [];
    for (const c of a.convs) {
      const msgs = messagesOf.get(c.id) ?? [];
      const evs = eventsOf.get(c.id) ?? [];
      if (hasReplied(msgs, evs)) replied += 1;
      const link = firstLinkOf.get(c.id);
      if (link) beforeLink.push(msgs.filter((m) => isMember(m) && m.createdAt < link).length);
      delays.push(...replyDelays(msgs));
      const drop = dropStageOf(c, evs, now);
      if (drop) drops.push(drop);
      for (const m of msgs) if (isMember(m)) memberDates.push(m.createdAt);
    }
    const bot = input.bots[a.botId];
    const cost = round4(a.cost);
    out.push({
      key,
      botId: a.botId,
      botLabel: bot?.label ?? "Bot supprimé",
      kind: bot?.kind ?? "BOT",
      personaId: a.personaId,
      personaName: a.personaId ? (input.personaNames[a.personaId] ?? null) : null,
      source: a.source,
      conversations: a.convs.length,
      replyRate: a.convs.length ? replied / a.convs.length : null,
      medianMessagesBeforeLink: median(beforeLink),
      dropStage: mostFrequentStage(drops),
      medianReplyDelaySec: median(delays),
      replyHours: topReplyHours(memberDates),
      linksSent: a.linksSent,
      clicks: a.clicks,
      registrations: a.registrations,
      ftds: a.ftds,
      aiCostEur: cost,
      costPerRegistrationEur: a.registrations > 0 ? round4(cost / a.registrations) : null,
      enoughData: a.convs.length >= input.minConversations,
    });
  }
  return out.sort(
    (x, y) => y.conversations - x.conversations || y.registrations - x.registrations || x.key.localeCompare(y.key),
  );
}

/** Libellé court d'un profil (alertes, rapports) : jamais de texte de conversation. */
export function profileLabel(p: Pick<ConversationProfileStats, "botLabel" | "personaName" | "source">): string {
  return `${p.botLabel} · ${p.personaName ?? "sans persona"} · ${p.source ? `source « ${p.source} »` : "sans source"}`;
}
