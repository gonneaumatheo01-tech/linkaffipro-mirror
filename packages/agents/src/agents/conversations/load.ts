/**
 * Lecture en base des chiffres par profil (requêtes « à plat », sans texte de message). Un lien, un joueur ou un coût
 * prend le profil de sa conversation ; sans conversation (supprimée depuis), un lien garde le bot, la persona et la
 * source copiés sur lui ; un coût sans conversation n'est rattaché à aucun bot et n'est pas compté.
 */
import type { AgentsPrisma } from "../../types";
import type {
  ProfileBotInfo,
  ProfileConversationRow,
  ProfileCostRow,
  ProfileEventRow,
  ProfileInput,
  ProfileLinkRow,
  ProfileMessageRow,
  ProfilePlayerRow,
  ProfileRef,
} from "./profiles";

const CHUNK = 5_000;

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

function isCommand(meta: unknown): boolean {
  return Boolean(meta && typeof meta === "object" && (meta as { command?: unknown }).command != null);
}

const refOf = (c: ProfileRef): ProfileRef => ({ botId: c.botId, personaId: c.personaId, source: c.source });

/** Profil (bot, persona, source) des conversations demandées, lues une seule fois. */
async function conversationRefs(prisma: AgentsPrisma, known: Map<string, ProfileRef>, ids: Iterable<string>): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => !known.has(id));
  for (const part of chunks(missing)) {
    const rows = await prisma.conversation.findMany({
      where: { id: { in: part } },
      select: { id: true, botId: true, personaId: true, source: true },
    });
    for (const r of rows) known.set(r.id, refOf(r));
  }
}

export async function loadProfileInput(
  prisma: AgentsPrisma,
  window: { start: Date; end: Date },
  minConversations: number,
): Promise<ProfileInput> {
  const { start, end } = window;
  const convRows = await prisma.conversation.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: {
      id: true,
      botId: true,
      personaId: true,
      source: true,
      stage: true,
      status: true,
      createdAt: true,
      convertedAt: true,
      lastInboundAt: true,
      lastAssistantAt: true,
    },
  });
  const conversations: ProfileConversationRow[] = convRows.map((c) => ({ ...c, stage: String(c.stage), status: String(c.status) }));
  const refs = new Map<string, ProfileRef>(conversations.map((c) => [c.id, refOf(c)]));
  const ids = conversations.map((c) => c.id);

  const messages: ProfileMessageRow[] = [];
  const events: ProfileEventRow[] = [];
  for (const part of chunks(ids)) {
    const [msgs, evs] = await Promise.all([
      prisma.conversationMessage.findMany({
        where: { conversationId: { in: part } },
        select: { conversationId: true, direction: true, author: true, meta: true, createdAt: true },
      }),
      prisma.conversationEvent.findMany({
        where: { conversationId: { in: part }, type: "stage_changed" },
        select: { conversationId: true, type: true, fromStage: true, toStage: true, createdAt: true },
      }),
    ]);
    for (const m of msgs)
      messages.push({
        conversationId: m.conversationId,
        direction: m.direction === "IN" ? "IN" : "OUT",
        author: String(m.author),
        isCommand: isCommand(m.meta),
        createdAt: m.createdAt,
      });
    for (const e of evs)
      events.push({
        conversationId: e.conversationId,
        type: e.type,
        fromStage: e.fromStage ? String(e.fromStage) : null,
        toStage: e.toStage ? String(e.toStage) : null,
        createdAt: e.createdAt,
      });
  }

  const linkRows = await prisma.assistantOfferLink.findMany({
    where: { OR: [{ sentAt: { gte: start, lt: end } }, { firstOpenedAt: { gte: start, lt: end } }] },
    select: { conversationId: true, botId: true, personaId: true, source: true, sentAt: true, firstOpenedAt: true },
  });

  const playerRows = await prisma.player.findMany({
    where: {
      clickId: { not: null },
      OR: [{ registeredAt: { gte: start, lt: end } }, { ftdAt: { gte: start, lt: end } }],
    },
    select: { clickId: true, registeredAt: true, ftdAt: true },
  });
  const clickIds = [...new Set(playerRows.map((p) => p.clickId).filter((x): x is string => Boolean(x)))];
  const clickConv = new Map<string, string>();
  const clickOffer = new Map<string, ProfileRef & { conversationId: string | null }>();
  for (const part of chunks(clickIds)) {
    const [clicks, offers] = await Promise.all([
      prisma.click.findMany({ where: { id: { in: part }, conversationId: { not: null } }, select: { id: true, conversationId: true } }),
      prisma.assistantOfferLink.findMany({
        where: { clickId: { in: part } },
        select: { clickId: true, conversationId: true, botId: true, personaId: true, source: true },
      }),
    ]);
    for (const c of clicks) if (c.conversationId) clickConv.set(c.id, c.conversationId);
    for (const o of offers) if (o.clickId) clickOffer.set(o.clickId, o);
  }

  const costRows = await prisma.aiConversationUsage.findMany({
    where: { createdAt: { gte: start, lt: end }, purpose: { not: "TEST" }, conversationId: { not: null } },
    select: { conversationId: true, costEur: true },
  });

  await conversationRefs(prisma, refs, [
    ...linkRows.map((l) => l.conversationId),
    ...clickConv.values(),
    ...[...clickOffer.values()].map((o) => o.conversationId),
    ...costRows.map((c) => c.conversationId),
  ].filter((x): x is string => Boolean(x)));

  const links: ProfileLinkRow[] = linkRows.map((l) => ({
    ...((l.conversationId && refs.get(l.conversationId)) || refOf(l)),
    conversationId: l.conversationId,
    sentAt: l.sentAt,
    firstOpenedAt: l.firstOpenedAt,
  }));

  const players: ProfilePlayerRow[] = [];
  for (const p of playerRows) {
    if (!p.clickId) continue;
    const convId = clickConv.get(p.clickId);
    const offer = clickOffer.get(p.clickId);
    const ref =
      (convId && refs.get(convId)) || (offer?.conversationId && refs.get(offer.conversationId)) || (offer ? refOf(offer) : null);
    if (ref) players.push({ ...ref, registeredAt: p.registeredAt, ftdAt: p.ftdAt });
  }

  const costs: ProfileCostRow[] = [];
  for (const c of costRows) {
    const ref = c.conversationId ? refs.get(c.conversationId) : undefined;
    if (ref) costs.push({ ...ref, costEur: Number(c.costEur) });
  }

  const botIds = [...new Set([...refs.values(), ...links].map((r) => r.botId))];
  const personaIds = [...new Set([...refs.values(), ...links].map((r) => r.personaId).filter((x): x is string => Boolean(x)))];
  const [bots, accounts, personas] = await Promise.all([
    prisma.bot.findMany({ where: { id: { in: botIds } }, select: { id: true, name: true, username: true } }),
    prisma.telegramUserAccount.findMany({ where: { botId: { in: botIds } }, select: { botId: true, label: true } }),
    prisma.persona.findMany({ where: { id: { in: personaIds } }, select: { id: true, name: true } }),
  ]);
  const botInfo: Record<string, ProfileBotInfo> = {};
  for (const b of bots) botInfo[b.id] = { label: b.username ? `@${b.username}` : b.name, kind: "BOT" };
  // Bot fantôme d'un compte réel : le profil porte le nom du compte.
  for (const a of accounts) if (a.botId) botInfo[a.botId] = { label: a.label, kind: "ACCOUNT" };

  return {
    start,
    end,
    conversations,
    messages,
    events,
    links,
    players,
    costs,
    bots: botInfo,
    personaNames: Object.fromEntries(personas.map((p) => [p.id, p.name])),
    minConversations,
  };
}
