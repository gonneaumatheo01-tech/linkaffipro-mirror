/**
 * Phase 26, section 4 — rapport du matin dans le groupe de l'équipe (9 h Paris ; `Setting boss.group.morning`
 * explicite, sinon même préférence que le rapport privé `agents.dailyReport` ; il s'ajoute au rapport privé détaillé,
 * il ne le remplace pas). 5 lignes sans titre ni série d'emojis (charte de Kevin) : bonjour, ce qui est
 * prévu aujourd'hui, la veille, ce qui bloque, et les @ des personnes qui ont quelque chose en attente. Alertes
 * graves (équipe mise en pause, plafond atteint) : le responsable de l'équipe est mentionné dans le groupe, l'admin
 * les reçoit déjà en privé (copie).
 */
import { esc, nowOf } from "../../admin/journal";
import { isAgentsPausedAll } from "../../missions/settings";
import { addDaysToDay, parisDay, parisDayStart, parisMonth } from "../../rules/time";
import { TEAM_KEYS, TEAM_LABELS, isTeamKey, type AgentsDeps, type TeamKey } from "../../types";
import { activeBossGroup } from "./group";
import { activeTeamMembers, adminMention, kindForRequest, mentionHtml, parisDateLabel, pickResponsibleFrom, teamForKey, type TeamMemberRow } from "./members";
import { pick, voiceTemplate, type VoiceTable } from "../voice";

export type MorningFigures = {
  day: string;
  planned: { team: TeamKey; posts: number }[];
  yesterday: { published: number; refused: number; failed: number };
  blockers: string[];
  /** Personne (null = admin) → ce qu'elle a en attente. */
  waiting: { member: TeamMemberRow | null; questions: number; validations: number }[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Rapport du matin déjà mis en mots (valeurs échappées, mentions HTML prêtes) : base des variantes. */
export type MorningParts = {
  dayLabel: string;
  /** « Casino 4, Rencontres 3 » (vide : aucun post prévu). */
  planned: { total: number; detail: string };
  yesterday: { published: number; refused: number; failed: number };
  /** « Paris sportifs en pause, plafond IA atteint (Casino) » (vide : rien ne bloque). */
  blockers: string;
  /** « @lea 1 question, @matheo 2 posts à valider » (vide : rien en attente). */
  waiting: string;
};

const yesterdayFigures = (y: MorningParts["yesterday"]) =>
  `${plural(y.published, "publié")}, ${plural(y.refused, "refusé")}${y.failed ? `, ${y.failed} en échec` : ""}`;

/** Les 5 lignes, chacune avec 2 à 4 tournures (même ordre : bonjour, prévu, hier, ce qui bloque, en attente). */
function morningLineVariants(p: MorningParts): string[][] {
  const y = yesterdayFigures(p.yesterday);
  return [
    [`Bonjour l'équipe, le point du ${p.dayLabel}.`, `Salut l'équipe, point rapide du ${p.dayLabel}.`, `Hello l'équipe, petit point du ${p.dayLabel}.`],
    p.planned.total
      ? [
          `Aujourd'hui, ${plural(p.planned.total, "post prévu", "posts prévus")} : ${p.planned.detail}.`,
          `Au programme aujourd'hui : ${plural(p.planned.total, "post")} (${p.planned.detail}).`,
        ]
      : [
          "Aujourd'hui, aucun post prévu : aucun canal n'a son plan activé, ou les équipes sont en pause.",
          "Rien de prévu aujourd'hui : pas de canal au plan activé, ou les équipes sont en pause.",
        ],
    [`Hier : ${y}.`, `Bilan d'hier : ${y}.`],
    p.blockers ? [`Ce qui bloque : ${p.blockers}.`, `Ça bloque sur : ${p.blockers}.`] : ["Rien ne bloque.", "Aucun blocage en ce moment."],
    p.waiting ? [`En attente : ${p.waiting}.`, `À voir : ${p.waiting}.`] : ["Rien en attente, merci à tous.", "Personne n'a rien en attente, merci à tous."],
  ];
}

const MORNING_SAMPLES: MorningParts[] = [
  {
    dayLabel: "samedi 24 octobre",
    planned: { total: 7, detail: "Casino 4, Rencontres 3" },
    yesterday: { published: 5, refused: 1, failed: 2 },
    blockers: "Paris sportifs en pause, plafond IA atteint (Casino), 3 posts arrêtés par un plafond",
    waiting: "@lea 1 question, @marc 2 questions et 1 post à valider, @matheo 2 posts à valider",
  },
  { dayLabel: "lundi 26 octobre", planned: { total: 0, detail: "" }, yesterday: { published: 1, refused: 0, failed: 0 }, blockers: "", waiting: "" },
];

/** Textes de Kevin du rapport du matin (charte `docs/KEVIN-VOIX.md`, contrôlés par `voice.test.ts`). */
export const TEAM_MORNING_VARIANTS = {
  /** Le message entier (5 lignes), une tournure par ligne. */
  report: voiceTemplate(MORNING_SAMPLES, (p) => {
    const lines = morningLineVariants(p);
    return [0, 1, 2].map((i) => lines.map((l) => l[i % l.length]!).join("\n"));
  }),
} satisfies VoiceTable;

/** « samedi 24 octobre » depuis « 2026-10-24 » (jour de Paris) (pur). */
function dayLabelOf(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? parisDateLabel(parisDayStart(day)) : day;
}

/**
 * Les 5 lignes du rapport du matin (pur sauf les mentions, données en paramètre ; `chatId` : rotation des tournures).
 * Sans titre ni série d'emojis : bonjour, prévu, hier, ce qui bloque, en attente avec les @.
 */
export function morningLines(f: MorningFigures, mentionOf: (m: TeamMemberRow | null) => string, chatId: bigint | null = null): string[] {
  const total = f.planned.reduce((s, p) => s + p.posts, 0);
  const waiting = f.waiting.filter((w) => w.questions + w.validations > 0);
  const parts: MorningParts = {
    dayLabel: esc(dayLabelOf(f.day)),
    planned: {
      total,
      detail: esc(
        f.planned
          .filter((p) => p.posts > 0)
          .map((p) => `${TEAM_LABELS[p.team]} ${p.posts}`)
          .join(", "),
      ),
    },
    yesterday: f.yesterday,
    blockers: f.blockers.slice(0, 3).map(esc).join(", "),
    waiting: waiting
      .slice(0, 4)
      .map((w) => `${mentionOf(w.member)} ${[w.questions ? plural(w.questions, "question") : null, w.validations ? `${plural(w.validations, "post")} à valider` : null].filter(Boolean).join(" et ")}`)
      .join(", "),
  };
  return morningLineVariants(parts).map((variants, i) => pick(variants, `morning.line${i}`, chatId));
}

/** Chiffres du rapport du matin, depuis la base (mêmes comptes que le rapport du Grand Chef). */
export async function morningFigures(deps: AgentsDeps): Promise<MorningFigures> {
  const now = nowOf(deps);
  const day = parisDay(now);
  const since = parisDayStart(addDaysToDay(day, -1));
  const until = parisDayStart(day);
  const [configs, plans, published, refused, failed, pausedAll, usage, blockedMissions, requests, validations, members] = await Promise.all([
    deps.prisma.agentTeamConfig.findMany({}),
    deps.prisma.channelAgentPlan.findMany({ where: { enabled: true } }),
    deps.prisma.agentMission.count({ where: { status: "DONE", updatedAt: { gte: since, lt: until } } }),
    deps.prisma.agentMission.count({ where: { status: "CANCELLED", updatedAt: { gte: since, lt: until } } }),
    deps.prisma.agentMission.count({ where: { status: { in: ["FAILED", "BLOCKED_BUDGET"] }, updatedAt: { gte: since, lt: until } } }),
    isAgentsPausedAll(deps.prisma),
    deps.prisma.agentUsage.findMany({ where: { month: parisMonth(now), alerted100: true } }),
    deps.prisma.agentMission.count({ where: { status: "BLOCKED_BUDGET" } }),
    deps.prisma.humanRequest.findMany({ where: { status: { in: ["QUEUED", "PENDING"] } } }),
    deps.prisma.agentValidation.findMany({ where: { status: "PENDING" } }),
    activeTeamMembers(deps),
  ]);
  const cfg = new Map((configs as { teamKey: string; paused: boolean; pausedReason?: string | null }[]).map((c) => [c.teamKey, c]));
  const planned = TEAM_KEYS.filter((t) => t !== "algo").map((team) => ({
    team,
    posts: pausedAll || cfg.get(team)?.paused ? 0 : (plans as { teamKey: string; postsPerDay: number }[]).filter((p) => p.teamKey === team).reduce((s, p) => s + p.postsPerDay, 0),
  }));
  const blockers: string[] = [];
  if (pausedAll) blockers.push("pause générale");
  for (const t of TEAM_KEYS) {
    const c = cfg.get(t);
    if (c?.paused) blockers.push(`${TEAM_LABELS[t]} en pause${c.pausedReason ? ` (${c.pausedReason})` : ""}`);
  }
  for (const u of usage as { teamKey: string; provider: string }[])
    if (isTeamKey(u.teamKey)) blockers.push(`plafond ${u.provider === "video" ? "vidéo" : u.provider === "llm" ? "IA" : u.provider} atteint (${TEAM_LABELS[u.teamKey]})`);
  if (blockedMissions) blockers.push(`${plural(blockedMissions, "post")} arrêté${blockedMissions > 1 ? "s" : ""} par un plafond`);

  const waiting = new Map<string, { member: TeamMemberRow | null; questions: number; validations: number }>();
  const bucket = (id: bigint | null | undefined) => {
    const member = id ? (members.find((m) => m.telegramUserId === id) ?? null) : null;
    const key = member ? member.id : "admin";
    const cur = waiting.get(key) ?? { member, questions: 0, validations: 0 };
    waiting.set(key, cur);
    return cur;
  };
  for (const r of requests as { status: string; kind: string; teamKey: string | null; assigneeTelegramId?: bigint | null }[]) {
    // Question déjà posée : son responsable ; en file : celui à qui elle partira.
    const id = r.status === "PENDING" ? (r.assigneeTelegramId ?? null) : pickResponsibleFrom(members, teamForKey(r.teamKey), kindForRequest(r.kind), now).assignee?.telegramUserId ?? null;
    bucket(id).questions++;
  }
  for (const v of validations as { assigneeTelegramId?: bigint | null }[]) bucket(v.assigneeTelegramId ?? null).validations++;
  return { day, planned, yesterday: { published, refused, failed }, blockers, waiting: [...waiting.values()] };
}

/** Envoie le rapport du matin dans le groupe ; rend vrai s'il est parti (sinon l'appelant l'envoie en privé). */
export async function sendGroupMorningReport(deps: AgentsDeps, groupId: bigint): Promise<boolean> {
  if (!deps.admin?.sendTo) return false;
  const f = await morningFigures(deps);
  const admin = await adminMention(deps);
  const lines = morningLines(f, (m) => (m ? mentionHtml(m) : admin), groupId);
  try {
    return (await deps.admin.sendTo(groupId, lines.join("\n"))) !== null;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] rapport du matin non envoyé dans le groupe");
    return false;
  }
}

/**
 * Alerte grave d'une équipe (mise en pause automatique, plafond atteint) : copie dans le groupe en mentionnant le
 * membre qui s'occupe de l'équipe (l'admin la reçoit déjà en privé). Rien sans groupe ni responsable. Ne lève jamais.
 */
export async function copyAlertToGroup(deps: AgentsDeps, teamKey: TeamKey, html: string): Promise<boolean> {
  try {
    const group = await activeBossGroup(deps);
    if (!group || !deps.admin?.sendTo) return false;
    const members = await activeTeamMembers(deps);
    const now = nowOf(deps);
    const who = pickResponsibleFrom(members, teamKey, null, now).assignee;
    if (!who) return false;
    return (await deps.admin.sendTo(group, `${mentionHtml(who)} ${html}\n(${await adminMention(deps)} en copie)`)) !== null;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] alerte non copiée dans le groupe");
    return false;
  }
}
