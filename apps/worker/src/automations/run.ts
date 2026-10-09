import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import type { AutomationsJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { buildMemberContext } from "./context";
import { executePlan, selectRules, type LogEntry } from "./engine";
import { prismaExecutor } from "./executor";

type EventJob = Extract<AutomationsJob, { type: "event" }>;

/** Évalue un événement : règles correspondantes → exécutions. */
export async function handleEvent(job: EventJob, now = new Date()): Promise<{ started: number }> {
  const rules = await prisma.automationRule.findMany({ where: { trigger: job.trigger, isActive: true } });
  if (rules.length === 0) return { started: 0 };
  const snapshot = await buildMemberContext(job.memberId, job.context ?? {}, now);
  if (!snapshot) return { started: 0 };
  let started = 0;
  for (const rule of selectRules(rules, job.trigger, snapshot.ctx)) {
    if (rule.oncePerMember) {
      const already = await prisma.automationRun.findFirst({ where: { ruleId: rule.id, memberId: job.memberId, status: { not: "CANCELLED" } }, select: { id: true } });
      if (already) continue;
    }
    const run = await prisma.automationRun.create({ data: { ruleId: rule.id, memberId: job.memberId, status: "RUNNING", context: toJsonValue({ ...(job.context ?? {}), ...snapshot.ctx, trigger: job.trigger }) } });
    await executeRun(run.id, rule, snapshot, 0, [], now);
    started++;
  }
  // Niveau de dépense atteint : évalué après une inscription ou un dépôt.
  if ((job.trigger === "REGISTERED" || job.trigger === "DEPOSITED") && snapshot.ctx.spendLevel && snapshot.ctx.spendLevel !== "AUCUN") {
    const levelRules = await prisma.automationRule.findMany({ where: { trigger: "SPEND_LEVEL_REACHED", isActive: true } });
    for (const rule of selectRules(levelRules, "SPEND_LEVEL_REACHED", snapshot.ctx)) {
      if (rule.oncePerMember) {
        const already = await prisma.automationRun.findFirst({ where: { ruleId: rule.id, memberId: job.memberId, status: { not: "CANCELLED" } }, select: { id: true } });
        if (already) continue;
      }
      const run = await prisma.automationRun.create({ data: { ruleId: rule.id, memberId: job.memberId, status: "RUNNING", context: toJsonValue({ ...snapshot.ctx, trigger: "SPEND_LEVEL_REACHED" }) } });
      await executeRun(run.id, rule, snapshot, 0, [], now);
      started++;
    }
  }
  return { started };
}

type RuleLike = { id: string; name: string; actions: unknown };

async function executeRun(runId: string, rule: RuleLike, snapshot: Awaited<ReturnType<typeof buildMemberContext>> & object, step: number, previousLog: LogEntry[], now: Date, test = false): Promise<void> {
  const result = await executePlan(rule.actions, step, prismaExecutor(snapshot, { ruleName: rule.name, test }), now, { skipTags: test });
  const log = [...previousLog, ...result.log];
  const status = result.error ? "FAILED" : result.done ? "DONE" : "PENDING";
  await prisma.automationRun.update({ where: { id: runId }, data: { status, step: result.nextStep, resumeAt: result.resumeAt, log: toJsonValue(log), error: result.error } });
  if (step === 0) await prisma.automationRule.update({ where: { id: rule.id }, data: { runs: { increment: 1 }, lastRunAt: now } }).catch(() => undefined);
  await recordEvent({ type: "automation.run", memberId: snapshot.memberId, payload: { ruleId: rule.id, runId, status, step: result.nextStep, test } });
  if (result.error) logger.warn({ runId, rule: rule.id, err: result.error }, "automatisation en erreur");
}

/** Reprend les exécutions en attente dont l'heure est venue (après une action « attendre »). */
export async function resumePending(now = new Date(), limit = 100): Promise<number> {
  const due = await prisma.automationRun.findMany({ where: { status: "PENDING", resumeAt: { lte: now } }, orderBy: { resumeAt: "asc" }, take: limit, include: { rule: true } });
  let resumed = 0;
  for (const run of due) {
    const claimed = await prisma.automationRun.updateMany({ where: { id: run.id, status: "PENDING" }, data: { status: "RUNNING" } });
    if (claimed.count === 0) continue;
    if (!run.rule.isActive) {
      await prisma.automationRun.update({ where: { id: run.id }, data: { status: "CANCELLED", error: "Règle désactivée" } });
      continue;
    }
    const snapshot = await buildMemberContext(run.memberId, (run.context as Record<string, unknown>) ?? {}, now);
    if (!snapshot) {
      await prisma.automationRun.update({ where: { id: run.id }, data: { status: "SKIPPED", error: "Membre introuvable ou anonymisé" } });
      continue;
    }
    await executeRun(run.id, run.rule, snapshot, run.step, Array.isArray(run.log) ? (run.log as LogEntry[]) : [], now);
    resumed++;
  }
  return resumed;
}

/** Exécute une règle pour un membre donné (test depuis l'interface) : sans oncePerMember, sans étiquette, messages en kind TEST. */
export async function runRuleForMember(ruleId: string, memberId: string, now = new Date()): Promise<{ runId: string; status: string; error: string | null }> {
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } });
  const snapshot = await buildMemberContext(memberId, {}, now);
  if (!snapshot) throw new Error("Membre introuvable.");
  const run = await prisma.automationRun.create({ data: { ruleId: rule.id, memberId, status: "RUNNING", context: toJsonValue({ ...snapshot.ctx, trigger: rule.trigger, test: true }) } });
  await executeRun(run.id, rule, snapshot, 0, [], now, true);
  const after = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true, error: true } });
  return { runId: run.id, status: after.status, error: after.error };
}

/** Balayage des membres inactifs pour les règles INACTIVE (au plus `limit` membres par règle et par passage). */
export async function sweepInactive(now = new Date(), limit = 200): Promise<number> {
  const rules = await prisma.automationRule.findMany({ where: { trigger: "INACTIVE", isActive: true } });
  let emitted = 0;
  for (const rule of rules) {
    const days = (rule.conditions as { inactiveDays?: number } | null)?.inactiveDays;
    if (!days) continue;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const candidates = await prisma.member.findMany({
      where: { anonymizedAt: null, lastSeenAt: { lt: cutoff }, automationRuns: { none: { ruleId: rule.id, status: { not: "CANCELLED" } } }, botStates: { some: { canDm: true } } },
      select: { id: true },
      take: limit,
    });
    for (const m of candidates) {
      const r = await handleEvent({ type: "event", trigger: "INACTIVE", memberId: m.id, context: {} }, now);
      emitted += r.started;
    }
  }
  return emitted;
}
