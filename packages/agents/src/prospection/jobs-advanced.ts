/**
 * Phase 32 — socle : planification et aiguillage des tâches avancées de la file `agents-prospection`.
 * Appelé par `prospectionSchedule` (toutes les 10 minutes, heure de Paris) et par `runProspectionJob`.
 * - nuit 02:00-06:00 : relectures dues du Veilleur (une fois par nuit, étalées), recherche par compte réel si le
 *   client l'a activée (un lot par verticale) ;
 * - 06:30 : réseaux puis valeurs estimées (une fois par jour) ;
 * - 09:10 : message du matin des alertes (une fois par jour, après le Top 10 de 9 h) ;
 * - lundi 09:20 : rappel du rattachement Link Affi des signés ;
 * - le 1er du mois dès 07:00 : résultats Link Affi du mois passé, puis calibrage proposé, puis rapport mensuel.
 * Chaque envoi est réservé AVANT (repère `Setting prospection.sent.<quoi>.<période>`, création unique) et libéré si
 * l'envoi échoue, comme en phase 31.
 */
import { agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { fromParis, parisDay, parisMinutes, parisWeekday } from "../rules/time";
import { prospectionAdvancedPort } from "./advanced-port";
import type { ProspectionQueueJob } from "./contract";
import { ACCOUNT_SEARCH, PROSPECTION_ADVANCED_RUNS_SETTING, WATCH_LIMITS, type ProspectionAdvancedJob } from "./contract-advanced";
import type { ProspectionKevinDeps } from "./kevin-port";

type Runs2 = { requalify?: string; networks?: string; account?: string };

const SENT = "prospection.sent.";
const NIGHT = { startHour: 2, endHour: 6 } as const;
const MORNING_BUILD_MIN = 6 * 60 + 30;
const LINK_REMINDERS_MIN = 9 * 60 + 20;
const MONTHLY_MIN = 7 * 60;

function previousMonth(day: string): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

async function claim(deps: ProspectionKevinDeps, key: string): Promise<boolean> {
  try {
    await deps.prisma.setting.create({ data: { key, value: { at: nowOf(deps).toISOString() } } });
    return true;
  } catch {
    return false;
  }
}
async function release(deps: ProspectionKevinDeps, key: string): Promise<void> {
  await deps.prisma.setting.deleteMany({ where: { key } }).catch(() => undefined);
}
async function claimed(deps: ProspectionKevinDeps, key: string): Promise<boolean> {
  return (await deps.prisma.setting.findUnique({ where: { key } })) !== null;
}

/** Réserve, exécute, libère en cas d'échec. */
async function once<T>(deps: ProspectionKevinDeps, key: string, run: () => Promise<T>): Promise<T | { skipped: string }> {
  if (!(await claim(deps, key))) return { skipped: "déjà fait" };
  try {
    return await run();
  } catch (err) {
    await release(deps, key);
    throw err;
  }
}

type Queue = (deps: ProspectionKevinDeps, job: ProspectionQueueJob, opts?: { jobId?: string; delayMs?: number; priority?: number }) => Promise<void>;

/** Planification avancée (appelée par `prospectionSchedule` avec sa fonction de mise en file). */
export async function prospectionAdvancedSchedule(deps: ProspectionKevinDeps, queue: Queue): Promise<Record<string, unknown>> {
  const now = nowOf(deps);
  const day = parisDay(now);
  const minutes = parisMinutes(now);
  const out: Record<string, unknown> = {};
  const raw = await readSetting(deps, PROSPECTION_ADVANCED_RUNS_SETTING);
  const runs: Runs2 = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Runs2) : {};
  const port = prospectionAdvancedPort(deps);
  const inNight = minutes >= NIGHT.startHour * 60 && minutes < NIGHT.endHour * 60;

  // Nuit : relectures dues, étalées jusqu'à 6 h.
  if (inNight && runs.requalify !== day) {
    runs.requalify = day;
    await writeSetting(deps, PROSPECTION_ADVANCED_RUNS_SETTING, runs);
    const ids = await port.dueForRequalify(deps, now, WATCH_LIMITS.perNight);
    const windowLeft = fromParis(day, NIGHT.endHour * 60).getTime() - now.getTime();
    const spacing = ids.length > 1 ? Math.max(0, Math.min(5 * 60_000, Math.floor(windowLeft / ids.length))) : 0;
    for (const [i, prospectId] of ids.entries()) await queue(deps, { type: "prospection.requalify-one", prospectId }, { jobId: `prospection.requalify-one:${day}:${prospectId}`, delayMs: i * spacing });
    out.requalify = ids.length;
  }

  // Nuit : recherche par compte réel, seulement si le client l'a activée (un lot par verticale).
  if (inNight && runs.account !== day && (await readSetting(deps, ACCOUNT_SEARCH.enabled.key)) === true) {
    runs.account = day;
    await writeSetting(deps, PROSPECTION_ADVANCED_RUNS_SETTING, runs);
    for (const vertical of ["SPORTS", "CASINO"] as const)
      await queue(deps, { type: "prospection.account-search", lot: { vertical, languages: [] } }, { jobId: `prospection.account-search:${day}:${vertical}` });
    out.account = 2;
  }

  // Matin : réseaux puis valeurs (une fois par jour, avant le Top de 9 h).
  if (minutes >= MORNING_BUILD_MIN && runs.networks !== day) {
    runs.networks = day;
    await writeSetting(deps, PROSPECTION_ADVANCED_RUNS_SETTING, runs);
    await queue(deps, { type: "prospection.networks" }, { jobId: `prospection.networks:${day}` });
    await queue(deps, { type: "prospection.values" }, { jobId: `prospection.values:${day}` });
    out.morning = true;
  }

  const queued: string[] = [];
  // 09:10 : message du matin des alertes.
  if (minutes >= WATCH_LIMITS.digestHour * 60 + WATCH_LIMITS.digestMinute && !(await claimed(deps, `${SENT}alerts-digest.${day}`))) {
    await queue(deps, { type: "prospection.alerts-digest" }, { jobId: `prospection.alerts-digest:${day}` });
    queued.push("alerts-digest");
  }
  // Lundi 09:20 : rattachement Link Affi des signés.
  const weekday = parisWeekday(now);
  if (weekday === 1 && minutes >= LINK_REMINDERS_MIN && !(await claimed(deps, `${SENT}link-reminders.${day}`))) {
    await queue(deps, { type: "prospection.link-reminders" }, { jobId: `prospection.link-reminders:${day}` });
    queued.push("link-reminders");
  }
  // 1er du mois : résultats du mois passé → calibrage → rapport (dans cet ordre, une tâche les enchaîne).
  if (day.endsWith("-01") && minutes >= MONTHLY_MIN) {
    const month = previousMonth(day);
    if (!(await claimed(deps, `${SENT}monthly.${month}`))) {
      await queue(deps, { type: "prospection.learn-pull", month }, { jobId: `prospection.learn-pull:${month}` });
      queued.push("monthly");
    }
  }
  out.queued = queued;
  return out;
}

/** Aiguillage des tâches avancées. */
export async function runProspectionAdvancedJob(deps: ProspectionKevinDeps, job: ProspectionAdvancedJob): Promise<Record<string, unknown>> {
  const port = prospectionAdvancedPort(deps);
  const now = nowOf(deps);
  const day = parisDay(now);
  switch (job.type) {
    case "prospection.requalify-one":
      return { requalified: await port.requalifyProspect(deps, job.prospectId) };
    case "prospection.alerts-digest":
      return { digest: await once(deps, `${SENT}alerts-digest.${day}`, () => port.sendAlertsDigest(deps, now)) };
    case "prospection.networks":
      return { networks: await port.rebuildNetworks(deps) };
    case "prospection.values":
      return { values: await port.refreshValues(deps, now) };
    case "prospection.link-reminders":
      return { reminders: await once(deps, `${SENT}link-reminders.${day}`, () => port.runLinkReminders(deps, now)) };
    case "prospection.learn-pull": {
      // Mensuel (avec `month`) : résultats → calibrage → rapport, une seule fois. À la demande (sans `month`) : résultats seuls.
      if (!job.month) return { pulled: await port.pullAffiliateResults(deps, null) };
      const month = job.month;
      return {
        monthly: await once(deps, `${SENT}monthly.${month}`, async () => {
          const pulled = await port.pullAffiliateResults(deps, month);
          const calibration = await port.proposeCalibration(deps, now);
          const report = await port.sendMonthlyReport(deps, month);
          await agentEvent(deps, "prospection.monthly.done", { month, pulled, calibration, report });
          return { pulled, calibration, report };
        }),
      };
    }
    case "prospection.calibrate":
      return { calibration: await port.proposeCalibration(deps, now) };
    case "prospection.monthly-report":
      return { report: await port.sendMonthlyReport(deps, job.month ?? previousMonth(day)) };
    case "prospection.account-search":
      return { search: await port.runAccountSearch(deps, job.lot) };
    default:
      return { skipped: "unknown" };
  }
}

