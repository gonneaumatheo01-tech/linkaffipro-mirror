/**
 * Phase 26 (chantier C) — relance quotidienne du Boss : au plus UNE par jour de Paris (`Setting` `boss.nudge.lastDay`,
 * posé avant l'envoi), à partir de 10 h (après le rapport du matin), et seulement si quelque chose bloque :
 * - une question ouverte depuis plus de 24 h dont le rappel des 24 h (`sweepHumanRequests`) est déjà parti depuis
 *   plus d'un jour : la question est renvoyée telle quelle (mêmes mots, mêmes boutons, réponse au message d'origine),
 *   jamais un second texte à côté du rappel existant ;
 * - une équipe en pause automatique (3 missions échouées de suite) ;
 * - des missions arrêtées par un plafond (`BLOCKED_BUDGET`) ou un plafond du mois atteint (`AgentUsage.alerted100`),
 *   y compris celui de l'IA du Boss (`Setting` `boss.budget`).
 * Envoyée par `deps.admin.send` (le messager admin passe par le bot du Boss). Signée « Kevin » seulement quand le Boss
 * existe (avant : bot casino de repli, texte neutre « Agents : … ») ; le menu du site s'appelle « Agents → Kevin ». Appelée par la tâche `human-requests`
 * de la file `agents-orchestrator`, juste après le balayage des demandes. Ne lève jamais.
 */
import { agentEvent, esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import { confirmButtonsOf, formatQuestion, withAskedMessageId } from "../human/requests";
import { sendRequestFollowUp } from "../human/delivery";
import { PROVIDER_LABELS } from "../orchestrator/budgets";
import { AUTO_PAUSE_REASON } from "../orchestrator/pause";
import { parisDay, parisMonth, parisParts } from "../rules/time";
import { isTeamKey, TEAM_LABELS, type AgentsDeps, type ProviderKey } from "../types";
import { BOSS_TEAM_KEY } from "./contract";
import { bossBudgetState } from "./llm";
import { readBossName } from "./memory";
import { pick, voiceTemplate, type VoiceTable } from "./voice";

const posts = (n: number) => `${n} post${n > 1 ? "s" : ""} arrêté${n > 1 ? "s" : ""}`;

/** Textes fixes de la relance du jour (charte `docs/KEVIN-VOIX.md`). */
export const NUDGE_VARIANTS = {
  autoPause: voiceTemplate([{ team: "Casino", key: "casino" }], (p: { team: string; key: string }) => [
    `L'équipe ${p.team} s'est mise en pause toute seule après 3 posts ratés de suite. Écris « reprends ${p.key} » quand c'est réglé.`,
    `${p.team} est en pause automatique (3 posts ratés d'affilée). Dès que c'est réglé, écris « reprends ${p.key} ».`,
  ]),
  cap: voiceTemplate(
    [
      { provider: "vidéo", team: "Rencontres", spent: "100 €", stopped: 1 },
      { provider: "IA", team: "Casino", spent: "20 €", stopped: 0 },
    ],
    (p: { provider: string; team: string; spent: string; stopped: number }) => {
      const stop = p.stopped ? `, ${posts(p.stopped)}` : "";
      return [
        `Plafond ${p.provider} de l'équipe ${p.team} atteint (${p.spent})${stop}. Monte-le dans Agents → Réglages, ou on attend le mois prochain ?`,
        `L'équipe ${p.team} a atteint son plafond ${p.provider} (${p.spent})${stop}. Tu le montes dans Agents → Réglages ou on attend le mois prochain ?`,
      ];
    },
  ),
  blocked: voiceTemplate(
    [
      { team: "Casino", n: 1 },
      { team: "Rencontres", n: 3 },
    ],
    (p: { team: string; n: number }) => [
      `Équipe ${p.team} : ${posts(p.n)} par un plafond. Regarde Agents → Réglages.`,
      `${posts(p.n).replace(/^./, (c) => c.toUpperCase())} chez ${p.team} à cause d'un plafond. Ça se règle dans Agents → Réglages.`,
    ],
  ),
  bossCap: voiceTemplate([{ spent: "5,2 €", cap: "5 €" }], (p: { spent: string; cap: string }) => [
    `Mon plafond d'IA du mois est atteint (${p.spent} pour ${p.cap}) : je ne comprends plus que les commandes exactes. Monte-le dans Agents → Kevin.`,
    `Mon plafond d'IA du mois est atteint (${p.spent} pour ${p.cap}). D'ici là je ne suis que les commandes exactes ; tu peux le monter dans Agents → Kevin.`,
  ]),
  dialogCap: voiceTemplate([{ spent: "5,2 €", cap: "5 €" }], (p: { spent: string; cap: string }) => [
    `Plafond d'IA du dialogue du mois atteint (${p.spent} pour ${p.cap}) : seules les commandes exactes marchent. Monte-le dans Agents → Kevin.`,
  ]),
  request: voiceTemplate([{ ago: "1 jour" }, { ago: "3 jours" }], (p: { ago: string }) => [
    `Une question attend ta réponse depuis ${p.ago}. Je te la remets juste en dessous.`,
    `Une question t'attend depuis ${p.ago}, je te la renvoie juste après.`,
  ]),
  head: voiceTemplate(
    [
      { name: "Kevin", n: 1 },
      { name: "Kevin", n: 3 },
    ],
    (p: { name: string; n: number }) => {
      const what = p.n === 1 ? "une chose bloque" : `${p.n} choses bloquent`;
      const What = what.charAt(0).toUpperCase() + what.slice(1);
      return [`<b>${p.name}</b> : ${what}.`, `Petit point de <b>${p.name}</b> : ${what}.`, `${What}, je te fais le point (<b>${p.name}</b>).`];
    },
  ),
  headNeutral: voiceTemplate([{ n: 1 }, { n: 2 }], (p: { n: number }) => [`Agents : ${p.n === 1 ? "une chose bloque" : `${p.n} choses bloquent`}.`]),
  more: voiceTemplate([{ n: 1 }, { n: 2 }], (p: { n: number }) => [`(et ${p.n} autre${p.n > 1 ? "s" : ""} : écris « agents »)`]),
} satisfies VoiceTable;

export const BOSS_NUDGE_SETTING = "boss.nudge.lastDay";
/** Pas de relance avant 10 h (Paris) : le rapport du matin part à 9 h. */
export const BOSS_NUDGE_FROM_HOUR = 10;
/** Une question est « en souffrance » 24 h après la question ET 24 h après son rappel. */
const STALE_MS = 24 * 3600_000;
/** Missions arrêtées par un plafond prises en compte : 7 derniers jours. */
const BLOCKED_WINDOW_MS = 7 * 24 * 3600_000;
const MAX_BULLETS = 4;

export type BossNudgeResult = {
  sent: boolean;
  reason?: "no-messenger" | "too-early" | "already" | "nothing" | "error";
  blockers?: string[];
};

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;

function teamLabel(teamKey: string): string {
  if (isTeamKey(teamKey)) return TEAM_LABELS[teamKey];
  return teamKey === "ads" ? "Ads" : teamKey;
}

function providerLabel(p: string): string {
  return (PROVIDER_LABELS as Record<string, string>)[p as ProviderKey] ?? p;
}

function dayOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  const d = (v as { day?: unknown } | null | undefined)?.day;
  return typeof d === "string" ? d : null;
}

function agoDays(from: Date, now: Date): string {
  const days = Math.max(1, Math.round((now.getTime() - from.getTime()) / (24 * 3600_000)));
  return days === 1 ? "1 jour" : `${days} jours`;
}

/** Le Boss (Kevin, bot `role: ADMIN` actif) existe-t-il ? Faux sur un doute (texte neutre). */
async function bossExists(deps: AgentsDeps): Promise<boolean> {
  try {
    const row = await deps.prisma.bot.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function bossDailyNudge(deps: AgentsDeps): Promise<BossNudgeResult> {
  try {
    if (!deps.admin) return { sent: false, reason: "no-messenger" };
    const now = nowOf(deps);
    if (parisParts(now).hour < BOSS_NUDGE_FROM_HOUR) return { sent: false, reason: "too-early" };
    const day = parisDay(now);
    if (dayOf(await readSetting(deps, BOSS_NUDGE_SETTING)) === day) return { sent: false, reason: "already" };

    const month = parisMonth(now);
    const staleBefore = new Date(now.getTime() - STALE_MS);
    const [late, autoPaused, blocked, capped, boss] = await Promise.all([
      deps.prisma.humanRequest.findMany({ where: { status: "PENDING", askedAt: { lt: staleBefore } }, orderBy: { askedAt: "asc" } }),
      deps.prisma.agentTeamConfig.findMany({ where: { paused: true, pausedReason: AUTO_PAUSE_REASON }, select: { teamKey: true } }),
      deps.prisma.agentMission.findMany({
        where: { status: "BLOCKED_BUDGET", lastActivityAt: { gte: new Date(now.getTime() - BLOCKED_WINDOW_MS) } },
        select: { teamKey: true },
      }),
      deps.prisma.agentUsage.findMany({ where: { month, alerted100: true }, select: { teamKey: true, provider: true, cents: true } }),
      bossBudgetState(deps.prisma, now),
    ]);
    // Rappel des 24 h pas encore parti (ou parti depuis moins d'un jour) : c'est le balayage des demandes qui s'en
    // charge, la relance ne double jamais un rappel.
    const staleRequest = late.find((r) => r.remindedAt !== null && r.remindedAt.getTime() < staleBefore.getTime()) ?? null;

    const bullets: { kind: string; text: string }[] = [];
    for (const t of autoPaused)
      bullets.push({
        kind: "auto-pause",
        text: pick(NUDGE_VARIANTS.autoPause({ team: teamLabel(t.teamKey), key: t.teamKey }), "nudge.autoPause"),
      });
    const blockedByTeam = new Map<string, number>();
    for (const m of blocked) blockedByTeam.set(m.teamKey, (blockedByTeam.get(m.teamKey) ?? 0) + 1);
    for (const u of capped.filter((c) => c.teamKey !== BOSS_TEAM_KEY)) {
      const n = blockedByTeam.get(u.teamKey) ?? 0;
      blockedByTeam.delete(u.teamKey);
      bullets.push({
        kind: "cap",
        text: pick(NUDGE_VARIANTS.cap({ provider: providerLabel(u.provider), team: teamLabel(u.teamKey), spent: eur(u.cents), stopped: n }), "nudge.cap"),
      });
    }
    for (const [teamKey, n] of blockedByTeam)
      bullets.push({
        kind: "blocked-budget",
        text: pick(NUDGE_VARIANTS.blocked({ team: teamLabel(teamKey), n }), "nudge.blocked"),
      });
    // Avant la création de Kevin (bot casino de repli), la relance ne parle pas en son nom.
    const hasBoss = await bossExists(deps);
    if (!boss.allowed && boss.capCents > 0)
      bullets.push({
        kind: "boss-cap",
        text: pick((hasBoss ? NUDGE_VARIANTS.bossCap : NUDGE_VARIANTS.dialogCap)({ spent: eur(boss.spentCents), cap: eur(boss.capCents) }), "nudge.bossCap"),
      });
    if (staleRequest)
      bullets.push({
        kind: "request",
        text: pick(NUDGE_VARIANTS.request({ ago: agoDays(staleRequest.askedAt ?? now, now) }), "nudge.request"),
      });
    if (!bullets.length) return { sent: false, reason: "nothing" };

    // Marqué avant l'envoi : jamais deux relances le même jour, même si l'envoi échoue.
    await writeSetting(deps, BOSS_NUDGE_SETTING, { day, at: now.toISOString() });
    const shown = bullets.slice(0, MAX_BULLETS);
    const more = bullets.length - shown.length;
    const head = hasBoss
      ? pick(NUDGE_VARIANTS.head({ name: esc(await readBossName(deps)), n: bullets.length }), "nudge.head")
      : pick(NUDGE_VARIANTS.headNeutral({ n: bullets.length }), "nudge.head");
    // Une seule chose : une phrase, pas de puce.
    const lines = shown.length === 1 ? [head, esc(shown[0]!.text)] : [head, ...shown.map((b) => `• ${esc(b.text)}`)];
    if (more > 0) lines[lines.length - 1] += ` ${pick(NUDGE_VARIANTS.more({ n: more }), "nudge.more")}`;
    await deps.admin.send(lines.join("\n"));

    if (staleRequest) {
      // Phase 26 : dans la conversation de la question (le groupe, avec la mention du responsable), sinon chez l'admin.
      const sent = await sendRequestFollowUp(deps, staleRequest, formatQuestion(staleRequest, { reminder: true }), {
        replyToMessageId: staleRequest.telegramMessageId ?? undefined,
        buttons: confirmButtonsOf(staleRequest),
      });
      await deps.prisma.humanRequest.update({
        where: { id: staleRequest.id },
        data: { remindedAt: now, ...(sent ? withAskedMessageId(staleRequest, sent.messageId) : {}) },
      });
    }
    const kinds = bullets.map((b) => b.kind);
    await agentEvent(deps, "boss.nudge.sent", { day, blockers: kinds });
    return { sent: true, blockers: kinds };
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] relance du jour non envoyée");
    return { sent: false, reason: "error" };
  }
}
