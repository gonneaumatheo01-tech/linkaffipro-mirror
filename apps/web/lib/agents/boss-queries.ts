/**
 * Lectures de la page Agents → Kevin (`/agents/boss`, phase 26) : le bot du Boss, son prénom, son plafond et sa
 * dépense du mois, les besoins non couverts, les derniers tours de dialogue (texte tel qu'enregistré : un secret y est
 * déjà « [secret] »), l'équipe présentée et le groupe enregistré. Lecture seule.
 */
import { prisma } from "@linkaffipro/db";
import { currentMonth } from "./missions";
import {
  BOSS_BUDGET_KEY,
  BOSS_GROUP_KEY,
  BOSS_NAME_KEY,
  BOSS_TURNS_SHOWN,
  parseBossBudget,
  parseBossName,
  type UnmetCsvRow,
} from "./boss";

export type BossBotView = { id: string; name: string; username: string; isActive: boolean; lastWebhookAt: Date | null; lastError: string | null };
export type BossTurnView = { id: string; createdAt: Date; role: string; text: string; actionKey: string | null; status: string | null; source: string | null; costCents: number };
export type BossUnmetView = UnmetCsvRow & { id: string };
export type TeamMemberView = {
  id: string;
  firstName: string;
  username: string | null;
  role: string;
  roleLabel: string | null;
  responsibilities: unknown;
  available: boolean;
  awayUntil: Date | null;
  startedPrivate: boolean;
};

export type BossPageData = {
  name: string;
  bot: BossBotView | null;
  capCents: number;
  spentCents: number;
  calls: number;
  unmet: BossUnmetView[];
  unmetTotal: number;
  turns: BossTurnView[];
  members: TeamMemberView[];
  groupChatId: string | null;
};

const settingValue = async (key: string) => (await prisma.setting.findUnique({ where: { key } }))?.value;

export async function loadBossUnmet(take = 100): Promise<BossUnmetView[]> {
  return prisma.bossUnmet.findMany({
    orderBy: [{ count: "desc" }, { lastAt: "desc" }],
    take,
    select: { id: true, text: true, count: true, firstAt: true, lastAt: true },
  });
}

export async function loadBossPage(now: Date): Promise<BossPageData> {
  const [name, bot, budget, usage, unmet, unmetTotal, turns, members, group] = await Promise.all([
    settingValue(BOSS_NAME_KEY),
    prisma.bot.findFirst({
      where: { role: "ADMIN" },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, username: true, isActive: true, lastWebhookAt: true, lastError: true },
    }),
    settingValue(BOSS_BUDGET_KEY),
    prisma.agentUsage.findMany({ where: { teamKey: "boss", month: currentMonth(now) }, select: { cents: true, calls: true } }),
    loadBossUnmet(100),
    prisma.bossUnmet.count(),
    prisma.bossTurn.findMany({
      orderBy: { createdAt: "desc" },
      take: BOSS_TURNS_SHOWN,
      select: { id: true, createdAt: true, role: true, text: true, actionKey: true, status: true, source: true, costCents: true },
    }),
    prisma.teamMember.findMany({
      where: { removedAt: null },
      orderBy: [{ role: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        username: true,
        role: true,
        roleLabel: true,
        responsibilities: true,
        available: true,
        awayUntil: true,
        startedPrivateAt: true,
      },
    }),
    settingValue(BOSS_GROUP_KEY),
  ]);
  return {
    name: parseBossName(name),
    bot,
    capCents: parseBossBudget(budget),
    spentCents: usage.reduce((s, u) => s + u.cents, 0),
    calls: usage.reduce((s, u) => s + u.calls, 0),
    unmet,
    unmetTotal,
    turns,
    members: members.map(({ startedPrivateAt, ...m }) => ({ ...m, role: String(m.role), startedPrivate: startedPrivateAt !== null })),
    groupChatId: typeof group === "string" && group ? group : typeof group === "number" ? String(group) : null,
  };
}
