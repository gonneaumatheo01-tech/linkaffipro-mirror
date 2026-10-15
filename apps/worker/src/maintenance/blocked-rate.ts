/**
 * Alerte « des personnes bloquent le bot après l'accueil » (phase 14, décision E10). Constat du 15 octobre : 19
 * personnes venues d'une pub TikTok ont bloqué @womendatingoobot dans les 2 minutes après l'accueil ; Telegram peut
 * limiter un bot signalé.
 *
 * Fenêtre glissante : demandes dont l'accueil (message WELCOME envoyé par le bot de la demande) est parti il y a entre
 * 1 heure et 24 heures. Vrai blocage (décision E1) : mise à jour Telegram « bot bloqué » en privé (`member.blocked`) ou
 * refus « bot was blocked by the user » (`dm.blocked` avec `telegramError`), du même bot, dans l'heure qui suit
 * l'accueil. Jamais un message refusé parce que la personne n'a pas démarré le bot (`dm.unreachable`).
 * Au plus une alerte par canal toutes les 6 heures (`shouldCreateForChannel`).
 */
import { prisma, toJsonValue } from "@linkaffipro/db";
import { provenanceFromJson } from "@linkaffipro/core";
import { logger } from "../logger";
import {
  detectBotBlockedRate,
  shouldCreateForChannel,
  BOT_BLOCKED_RATE_DEDUP_MS,
  type BotBlockedRateSnapshot,
  type Detected,
} from "./alert-rules";

const HOUR_MS = 3600_000;
const WINDOW_MS = 24 * HOUR_MS;
/** Un accueil est rattaché à la demande s'il est mis en file entre 1 minute avant et 10 minutes après elle. */
const WELCOME_MATCH_BEFORE_MS = 60_000;
const WELCOME_MATCH_AFTER_MS = 10 * 60_000;

/** Une demande dont l'accueil est parti, avec sa provenance et le blocage éventuel (pour l'agrégation pure). */
export type BlockedRateRequest = {
  channelId: string;
  channelTitle: string;
  botId: string;
  botUsername: string | null;
  /** Clé de provenance (lien précis, sinon type et canal d'origine). */
  groupKey: string;
  /** Après « venues » : « de Pub 1 », « de « Tir Cadré » », « d'un autre lien ». */
  fromText: string;
  blocked: boolean;
};

/** Agrégation par canal et par provenance (pure). */
export function blockedRateByChannel(
  rows: readonly BlockedRateRequest[],
): BotBlockedRateSnapshot[] {
  const channels = new Map<
    string,
    {
      title: string;
      requests: number;
      blocked: number;
      bots: Map<string, { username: string | null; blocked: number; requests: number }>;
      groups: Map<string, { fromText: string; requests: number; blocked: number }>;
    }
  >();
  for (const r of rows) {
    const c = channels.get(r.channelId) ?? {
      title: r.channelTitle,
      requests: 0,
      blocked: 0,
      bots: new Map(),
      groups: new Map(),
    };
    c.requests++;
    if (r.blocked) c.blocked++;
    const b = c.bots.get(r.botId) ?? { username: r.botUsername, blocked: 0, requests: 0 };
    b.requests++;
    if (r.blocked) b.blocked++;
    c.bots.set(r.botId, b);
    const g = c.groups.get(r.groupKey) ?? { fromText: r.fromText, requests: 0, blocked: 0 };
    g.requests++;
    if (r.blocked) g.blocked++;
    c.groups.set(r.groupKey, g);
    channels.set(r.channelId, c);
  }
  return [...channels.entries()].map(([channelId, c]) => {
    const bot = [...c.bots.values()].sort(
      (a, b) => b.blocked - a.blocked || b.requests - a.requests,
    )[0];
    return {
      channelId,
      channelTitle: c.title,
      botUsername: bot?.username ?? null,
      requests: c.requests,
      blocked: c.blocked,
      groups: [...c.groups.values()],
    };
  });
}

function objectOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Provenance d'une demande pour l'alerte : clé et texte « venues … ». */
export function provenanceGroupOf(
  source: Record<string, unknown>,
  titles: ReadonlyMap<string, string>,
): { groupKey: string; fromText: string } {
  const p = provenanceFromJson(source.provenance);
  const link = objectOf(source.inviteLink);
  const linkName = typeof link.name === "string" && link.name ? link.name : null;
  if (!p)
    return linkName
      ? { groupKey: `link:${String(link.id)}`, fromText: `de ${linkName}` }
      : { groupKey: "unknown", fromText: "d'un autre lien" };
  if (p.type === "GATE") {
    const title = p.sourceChannelId ? titles.get(p.sourceChannelId) : undefined;
    return {
      groupKey: `gate:${p.sourceChannelId ?? ""}`,
      fromText: title ? `de « ${title} »` : "d'un de nos canaux",
    };
  }
  if (p.type === "LINKAFFI" && p.linkaffi?.affiliateName)
    return {
      groupKey: `link:${p.inviteLinkId ?? p.linkaffi.affiliateName}`,
      fromText: `de l'affilié ${p.linkaffi.affiliateName}`,
    };
  if (p.type === "UNKNOWN") return { groupKey: "unknown", fromText: "d'un autre lien" };
  if (linkName)
    return { groupKey: `link:${p.inviteLinkId ?? linkName}`, fromText: `de ${linkName}` };
  return {
    groupKey: `type:${p.type}`,
    fromText:
      p.type === "AD"
        ? "d'une pub"
        : p.type === "SHARE"
          ? "d'un lien de partage"
          : "d'un lien du canal",
  };
}

/** Demandes des dernières 24 heures dont l'accueil est parti depuis au moins 1 heure, avec les vrais blocages. */
export async function botBlockedRateSnapshot(now = new Date()): Promise<BotBlockedRateSnapshot[]> {
  const oldestWelcome = new Date(now.getTime() - WINDOW_MS);
  const newestWelcome = new Date(now.getTime() - HOUR_MS);
  const memberships = await prisma.membership.findMany({
    where: {
      requestedAt: {
        gte: new Date(oldestWelcome.getTime() - WELCOME_MATCH_AFTER_MS),
        lte: new Date(newestWelcome.getTime() + WELCOME_MATCH_BEFORE_MS),
      },
      channel: { isActive: true },
    },
    select: {
      id: true,
      memberId: true,
      channelId: true,
      requestedAt: true,
      source: true,
      channel: { select: { title: true } },
    },
    take: 20_000,
  });
  if (memberships.length === 0) return [];
  const memberIds = [...new Set(memberships.map((m) => m.memberId))];
  const [welcomes, blocks] = await Promise.all([
    prisma.outboundMessage.findMany({
      where: {
        memberId: { in: memberIds },
        kind: "WELCOME",
        status: "SENT",
        sentAt: { gte: oldestWelcome, lte: newestWelcome },
      },
      select: { memberId: true, botId: true, queuedAt: true, sentAt: true },
      orderBy: { queuedAt: "asc" },
    }),
    prisma.event.findMany({
      where: {
        memberId: { in: memberIds },
        occurredAt: { gte: oldestWelcome, lte: now },
        OR: [
          { type: "member.blocked" },
          {
            type: "dm.blocked",
            payload: { path: ["telegramError"], string_contains: "blocked by the user" },
          },
        ],
      },
      select: { memberId: true, botId: true, occurredAt: true },
    }),
  ]);
  const sourceChannelIds = new Set<string>();
  for (const m of memberships) {
    const p = provenanceFromJson(objectOf(m.source).provenance);
    if (p?.type === "GATE" && p.sourceChannelId) sourceChannelIds.add(p.sourceChannelId);
  }
  const botIds = [...new Set(welcomes.map((w) => w.botId))];
  const [titlesRows, bots] = await Promise.all([
    sourceChannelIds.size
      ? prisma.channel.findMany({
          where: { id: { in: [...sourceChannelIds] } },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    botIds.length
      ? prisma.bot.findMany({ where: { id: { in: botIds } }, select: { id: true, username: true } })
      : Promise.resolve([]),
  ]);
  const titles = new Map(titlesRows.map((c) => [c.id, c.title]));
  const usernames = new Map(bots.map((b) => [b.id, b.username]));
  const rows: BlockedRateRequest[] = [];
  for (const m of memberships) {
    const source = objectOf(m.source);
    const botId = typeof source.botId === "string" ? source.botId : null;
    if (!botId) continue;
    const t = m.requestedAt.getTime();
    const welcome = welcomes.find(
      (w) =>
        w.memberId === m.memberId &&
        w.botId === botId &&
        w.queuedAt.getTime() >= t - WELCOME_MATCH_BEFORE_MS &&
        w.queuedAt.getTime() <= t + WELCOME_MATCH_AFTER_MS,
    );
    if (!welcome?.sentAt) continue;
    const sentAt = welcome.sentAt.getTime();
    const blocked = blocks.some(
      (b) =>
        b.memberId === m.memberId &&
        b.botId === botId &&
        b.occurredAt.getTime() >= sentAt &&
        b.occurredAt.getTime() <= sentAt + HOUR_MS,
    );
    rows.push({
      channelId: m.channelId,
      channelTitle: m.channel.title,
      botId,
      botUsername: usernames.get(botId) ?? null,
      ...provenanceGroupOf(source, titles),
      blocked,
    });
  }
  return blockedRateByChannel(rows);
}

/**
 * Passage de l'alerte « bot bloqué » (avec les autres alertes, toutes les 5 minutes) : une alerte par canal au-dessus du
 * seuil, au plus une toutes les 6 heures par canal ; les alertes ouvertes d'un canal revenu sous le seuil sont
 * résolues. Les nouvelles alertes sont notifiées par Telegram avec les autres (`runAlerts`).
 */
export async function syncBotBlockedRateAlerts(
  now = new Date(),
  snapshot?: BotBlockedRateSnapshot[],
): Promise<{ created: number; resolved: number; detected: Detected[] }> {
  const detected = detectBotBlockedRate(snapshot ?? (await botBlockedRateSnapshot(now)));
  const recent = await prisma.alert.findMany({
    where: {
      kind: "bot_blocked_rate",
      OR: [
        { createdAt: { gte: new Date(now.getTime() - BOT_BLOCKED_RATE_DEDUP_MS) } },
        { resolvedAt: null },
      ],
    },
    select: { id: true, createdAt: true, payload: true, resolvedAt: true },
  });
  const current = new Set(detected.map((d) => String(d.payload.channelId)));
  let created = 0;
  for (const d of detected) {
    const channelId = String(d.payload.channelId);
    if (!shouldCreateForChannel(channelId, recent, now)) continue;
    // Nouvelle alerte du canal : l'ancienne (plus de 6 heures) est close.
    const stale = recent
      .filter(
        (a) =>
          a.resolvedAt === null &&
          (a.payload as { channelId?: unknown } | null)?.channelId === channelId,
      )
      .map((a) => a.id);
    if (stale.length)
      await prisma.alert.updateMany({ where: { id: { in: stale } }, data: { resolvedAt: now } });
    await prisma.alert.create({
      data: {
        kind: d.kind,
        severity: d.severity,
        message: d.message,
        payload: toJsonValue(d.payload),
        createdAt: now,
      },
    });
    created++;
  }
  const toResolve = recent
    .filter(
      (a) =>
        a.resolvedAt === null &&
        !current.has(String((a.payload as { channelId?: unknown } | null)?.channelId ?? "")),
    )
    .map((a) => a.id);
  if (toResolve.length)
    await prisma.alert.updateMany({ where: { id: { in: toResolve } }, data: { resolvedAt: now } });
  if (created || toResolve.length)
    logger.info({ created, resolved: toResolve.length }, "alertes « bot bloqué » traitées");
  return { created, resolved: toResolve.length, detected };
}
