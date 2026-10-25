/**
 * Phase 33, chantier C — « qu'est-ce qui est parti ? » : posts des agents publiés aujourd'hui ou hier (vues à 1 h si
 * relevées), ce qui attend une validation (boutons existants ✅ / ✏️ / ❌), ce qui a raté et pourquoi, en français.
 * Lecture seule.
 */
import { nowOf } from "../../admin/journal";
import { parseSteps } from "../../missions/mission";
import { addDaysToDay, parisDay, parisDayStart } from "../../rules/time";
import { validationButtons } from "../../validation/requests";
import { AGENT_LABELS, isAgentKey, TEAM_LABELS, type AdminButton, type AgentsDeps, type TeamKey } from "../../types";
import { dayLabel, hourLabel, plainPreview, type ViewResult } from "./common";

export type ViewDoneInput = { channelId?: string | null; teamKey?: TeamKey | null; day?: string | null };

type MissionRow = { id: string; planDay: string | null; teamKey: string; channelId: string | null; status: string; currentStep: number; steps: unknown; postId: string | null; lastError: string | null; payload: unknown; updatedAt: Date };
type PostRow = { id: string; channelId: string; status: string; sentAt: Date | null; text: string; agentMissionId: string | null };
type ValidationRow = { id: string; number: number; missionId: string; teamKey: string; reason: string; previewText: string; createdAt: Date };

/** Erreur technique → phrase courte en français (pur). */
export function failureText(error: string | null | undefined): string {
  const e = (error ?? "").trim();
  if (!e) return "raison inconnue";
  if (/plafond/i.test(e)) return "plafond du mois atteint";
  if (/timeout|timed out|délai/i.test(e)) return "le fournisseur a mis trop de temps à répondre";
  if (/429|rate/i.test(e)) return "le fournisseur a refusé (trop de demandes)";
  if (/fetch failed|ECONN|réseau|network/i.test(e)) return "problème de réseau avec le fournisseur";
  return plainPreview(e, 90);
}

/** Validations en attente (toutes, ou celles de missions précises), avec les boutons existants. */
export async function pendingValidations(deps: AgentsDeps, opts: { missionIds?: string[] | null; teamKey?: TeamKey | null } = {}): Promise<{ rows: Array<ValidationRow & { channel: string | null }>; buttons: AdminButton[][] }> {
  const rows = (await deps.prisma.agentValidation.findMany({
    where: { status: "PENDING", ...(opts.missionIds ? { missionId: { in: opts.missionIds } } : {}), ...(opts.teamKey ? { teamKey: opts.teamKey } : {}) },
    orderBy: { createdAt: "asc" },
    take: 20,
  })) as ValidationRow[];
  const missions = rows.length ? ((await deps.prisma.agentMission.findMany({ where: { id: { in: rows.map((r) => r.missionId) } }, select: { id: true, channelId: true } })) as Array<{ id: string; channelId: string | null }>) : [];
  const chIds = [...new Set(missions.map((m) => m.channelId).filter((x): x is string => !!x))];
  const channels = chIds.length ? ((await deps.prisma.channel.findMany({ where: { id: { in: chIds } }, select: { id: true, title: true } })) as Array<{ id: string; title: string }>) : [];
  const title = new Map(channels.map((c) => [c.id, c.title]));
  const chOf = new Map(missions.map((m) => [m.id, m.channelId ? (title.get(m.channelId) ?? null) : null]));
  // Les boutons existants (✅ / ✏️ / ❌) des 3 premières, avec leur numéro.
  const buttons = rows.slice(0, 3).map((r) => validationButtons(r.id)[0]!.map((b) => ({ ...b, text: `${b.text} n°${r.number}` })));
  return { rows: rows.map((r) => ({ ...r, channel: chOf.get(r.missionId) ?? null })), buttons };
}

export function validationLines(rows: ReadonlyArray<ValidationRow & { channel: string | null }>): string[] {
  if (!rows.length) return ["Rien n'attend ta validation."];
  const lines = [`${rows.length} ${rows.length > 1 ? "posts attendent" : "post attend"} ta validation :`];
  for (const r of rows.slice(0, 5)) lines.push(`n°${r.number} · ${r.channel ?? TEAM_LABELS[r.teamKey as TeamKey] ?? r.teamKey} · ${plainPreview(r.reason, 60)}`);
  lines.push(`Appuie sur un bouton, ou réponds « ok ${rows[0]!.number} » pour publier.`);
  return lines;
}

export async function viewDone(deps: AgentsDeps, input: ViewDoneInput = {}): Promise<ViewResult> {
  const now = nowOf(deps);
  const day = input.day ?? parisDay(now);
  const from = parisDayStart(day);
  const to = parisDayStart(addDaysToDay(day, 1));
  const missions = (await deps.prisma.agentMission.findMany({
    where: {
      OR: [{ planDay: day }, { updatedAt: { gte: from, lt: to } }],
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(input.teamKey ? { teamKey: input.teamKey } : {}),
    },
    take: 400,
  })) as MissionRow[];
  const postIds = missions.map((m) => m.postId).filter((x): x is string => !!x);
  const posts = postIds.length ? ((await deps.prisma.post.findMany({ where: { id: { in: postIds } } })) as PostRow[]) : [];
  const sent = posts.filter((p) => p.status === "SENT" && p.sentAt && p.sentAt >= from && p.sentAt < to).sort((a, b) => a.sentAt!.getTime() - b.sentAt!.getTime());
  const insights = sent.length ? ((await deps.prisma.postInsight.findMany({ where: { postId: { in: sent.map((p) => p.id) } }, select: { postId: true, views1h: true } })) as Array<{ postId: string; views1h: number | null }>) : [];
  const views = new Map(insights.map((i) => [i.postId, i.views1h]));
  const chIds = [...new Set([...missions.map((m) => m.channelId), ...sent.map((p) => p.channelId)].filter((x): x is string => !!x))];
  const channels = chIds.length ? ((await deps.prisma.channel.findMany({ where: { id: { in: chIds } }, select: { id: true, title: true } })) as Array<{ id: string; title: string }>) : [];
  const title = new Map(channels.map((c) => [c.id, c.title]));
  const failed = missions.filter((m) => m.status === "FAILED" && (m.planDay === day || (m.updatedAt >= from && m.updatedAt < to)));
  const { rows: waiting, buttons } = await pendingValidations(deps, { missionIds: missions.map((m) => m.id) });

  const when = dayLabel(day, now);
  const facts = {
    jour: day,
    partis: sent.map((p) => ({ canal: title.get(p.channelId) ?? null, heure: p.sentAt!.toISOString(), texte: plainPreview(p.text, 200), vues1h: views.get(p.id) ?? null })),
    aValider: waiting.map((w) => ({ numero: w.number, canal: w.channel, motif: w.reason })),
    rates: failed.map((m) => {
      const step = parseSteps(m.steps)[m.currentStep];
      return { canal: m.channelId ? (title.get(m.channelId) ?? null) : null, etape: step && isAgentKey(step.agent) ? AGENT_LABELS[step.agent] : null, raison: failureText(m.lastError ?? step?.error) };
    }),
  };
  const lines: string[] = [];
  if (sent.length) {
    lines.push(`${sent.length} ${sent.length > 1 ? "posts partis" : "post parti"} ${when} :`);
    for (const p of sent.slice(0, 4)) {
      const v = views.get(p.id);
      lines.push(`${hourLabel(p.sentAt!)} · ${title.get(p.channelId) ?? "canal"}${typeof v === "number" ? ` · ${v} vues à 1 h` : ""} : « ${plainPreview(p.text, 80)} »`);
    }
  } else lines.push(`Rien n'est parti ${when}.`);
  if (waiting.length) lines.push(`${waiting.length} ${waiting.length > 1 ? "attendent" : "attend"} ta validation (${waiting.slice(0, 3).map((w) => `n°${w.number}`).join(", ")}).`);
  for (const f of facts.rates.slice(0, 2)) lines.push(`Raté${f.canal ? ` sur ${f.canal}` : ""}${f.etape ? ` à l'étape ${f.etape}` : ""} : ${f.raison}.`);
  return { facts, lines, ...(buttons.length ? { buttons } : {}) };
}
