/**
 * Phase 31, chantier D — tâches de la file `agents-prospection` (le worker ne fait qu'appeler `runProspectionJob`) :
 * - `prospection.schedule` (toutes les 10 minutes, heure de Paris) : questions des offres au premier démarrage (une
 *   fois), découverte de nuit 02:00-06:00 par lots (`planDiscoveryLots`, une fois par nuit, lots étalés sur la
 *   fenêtre), enrichissement en continu (canaux trouvés par priorité puis date, lectures ratées dont l'heure de reprise
 *   est passée, dans `enrich_daily_cap`), Top du jour à `daily_top_hour` (9 h), rappels à 9 h 05, rapport du lundi à
 *   9 h AVANT le Top, « pas intéressé » depuis 60 jours → de nouveau à contacter, retours promis par Kevin (canal
 *   ajouté à la main, recherche demandée) ;
 * - `prospection.discover` / `.enrich` / `.score` / `.dossier` : une étape d'un canal, la suivante est mise en file ;
 * - `prospection.daily-top`, `.reminders`, `.weekly-report` : une seule fois par jour (ou par semaine), même si la tâche
 *   est remise : repère posé en base AVANT l'envoi (`Setting prospection.sent.<quoi>.<période>`, création unique) ;
 * - `prospection.requalify` : phase 32 (rien pour l'instant).
 * `prospection.enabled = false` : rien ne tourne. L'équipe n'écrit jamais à un tiers : seul Kevin écrit, à l'admin ou
 * au groupe de l'équipe (`deps.admin`).
 */
import { adminTelegramId, agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { pick } from "../boss/voice";
import { addDaysToDay, fromParis, parisDay, parisMinutes, parisWeekday } from "../rules/time";
import { PROSPECTION_LIMITS, PROSPECTION_SETTINGS, type DiscoveryLot, type ProspectionQueueJob } from "./contract";
import { ensureProspectionOfferQuestions } from "./kevin-offers";
import { prospectionAdvancedSchedule, runProspectionAdvancedJob } from "./jobs-advanced";
import { prospectionPort, type ProspectionKevinDeps } from "./kevin-port";
import { activeOffers, handle, prospectionEnabled, type ProspectRow } from "./kevin-read";
import { countriesText, PROSPECTION_KEVIN_VARIANTS as V, VERTICAL_WORDS } from "./kevin-texts";
import { numberSetting, stringArray } from "./score/settings";

/** Repères des passages (jour de Paris) et file d'enrichissement récente. */
export const PROSPECTION_RUNS_SETTING = "prospection.runs";
/** Repère unique d'un envoi (`prospection.sent.daily-top.2026-10-26`) : posé avant l'envoi, jamais deux fois. */
export const PROSPECTION_SENT_PREFIX = "prospection.sent.";
/** Canal ajouté à la main : Kevin prévient quand il est lu (`{ chatId, name, at }`). */
export const PROSPECTION_WATCH_PREFIX = "prospection.watch.";
/** Recherche demandée par le client : Kevin prévient aux premiers canaux bons à contacter. */
export const PROSPECTION_REQUEST_PREFIX = "prospection.request.";

/** Découverte : de 2 h à 6 h (Paris). */
export const PROSPECTION_DISCOVERY_WINDOW = { startHour: 2, endHour: 6 } as const;
/** Rappels : 5 minutes après le Top du jour. */
export const PROSPECTION_REMINDERS_OFFSET_MIN = 5;
/** Enrichissements mis en file par passage (10 minutes) au plus. */
export const PROSPECTION_ENRICH_PER_TICK = 30;
/** Un canal déjà mis en file n'est pas repris pendant une heure. */
const ENRICH_RECENT_MS = 3600_000;
/** Une recherche demandée sans résultat : Kevin le dit au bout de 7 jours. */
const REQUEST_GIVE_UP_MS = 7 * 86400_000;
/** Priorité BullMQ (1 = la plus urgente) : canal ajouté à la main avant les autres. */
const PRIORITY_MANUAL = 1;
const PRIORITY_NORMAL = 10;
/** Un canal ajouté à la main porte cette priorité (contrat du Sourceur). */
const MANUAL_PRIORITY_MIN = 10;

type Runs = { discover?: string; skipped?: string; enrich?: { day: string; count: number; recent: Record<string, string> } };
type Watch = { chatId: string | null; name: string; at: string };
export type ProspectionRequestWatch = { chatId: string | null; countries: string[]; vertical: "CASINO" | "SPORTS"; what: string; at: string; notifiedAt?: string | null };

const sentKey = (what: string, period: string) => `${PROSPECTION_SENT_PREFIX}${what}.${period}`;
const mondayOf = (day: string, weekday: number) => addDaysToDay(day, -(weekday - 1));

// ------------------------------------------------------------------------------------------------ outils

/** Message de Kevin (admin, ou conversation donnée : groupe de l'équipe, privé d'un membre). Ne lève jamais. */
export async function sendProspectionKevin(deps: ProspectionKevinDeps, chatId: string | null, html: string): Promise<boolean> {
  if (!deps.admin) return false;
  try {
    const admin = await adminTelegramId(deps);
    if (chatId && /^-?\d+$/.test(chatId) && (!admin || BigInt(chatId) !== admin) && deps.admin.sendTo) await deps.admin.sendTo(BigInt(chatId), html);
    else await deps.admin.send(html);
    return true;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[prospection] message de Kevin non envoyé");
    return false;
  }
}

/** Mise en file (worker) ; sans file (tests, outils), la tâche tourne tout de suite. */
export async function queueProspection(deps: ProspectionKevinDeps, job: ProspectionQueueJob, opts: { jobId?: string; delayMs?: number; priority?: number } = {}): Promise<void> {
  const enqueue = deps.prospection?.enqueue;
  if (enqueue) await enqueue(job, opts);
  else await runProspectionJob(deps, job);
}

/** Repère unique d'un envoi : true si on vient de le poser (personne d'autre ne l'a fait). */
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

async function readRuns(deps: ProspectionKevinDeps): Promise<Runs> {
  const v = await readSetting(deps, PROSPECTION_RUNS_SETTING);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Runs) : {};
}

async function loadRow(deps: ProspectionKevinDeps, id: string): Promise<ProspectRow | null> {
  return (await deps.prisma.prospect.findUnique({ where: { id } })) as ProspectRow | null;
}

// ------------------------------------------------------------------------------------------------ point d'entrée

export async function runProspectionJob(deps: ProspectionKevinDeps, job: ProspectionQueueJob): Promise<Record<string, unknown>> {
  if (!(await prospectionEnabled(deps))) {
    // Liste demandée par le client pendant la pause : Kevin le dit (la personne n'attend pas pour rien).
    if (job.type === "prospection.daily-top" && job.requested) await sendProspectionKevin(deps, job.requested.chatId ?? null, pick(V.disabled, "prospection.disabled", job.requested.chatId ?? null));
    return { skipped: "disabled" };
  }
  const port = prospectionPort(deps);
  switch (job.type) {
    case "prospection.schedule":
      return prospectionSchedule(deps);
    case "prospection.discover":
      return { discovered: await port.runDiscovery(deps, job.lot) };
    case "prospection.enrich":
      return enrichStep(deps, job.prospectId);
    case "prospection.score":
      return scoreStep(deps, job.prospectId);
    case "prospection.dossier":
      return { dossier: await port.buildDossier(deps, job.prospectId) };
    case "prospection.daily-top":
      return job.requested ? requestedTop(deps, job.requested) : scheduledTop(deps);
    case "prospection.reminders":
      return remindersStep(deps);
    case "prospection.weekly-report":
      return { weekly: await ensureWeeklyReport(deps) };
    case "prospection.requalify":
      // Ancienne tâche de la phase 31 : la relecture passe par `prospection.requalify-one` (phase 32).
      return { skipped: "remplacée par prospection.requalify-one" };
    default:
      return runProspectionAdvancedJob(deps, job);
  }
}

// ------------------------------------------------------------------------------------------------ planification

export async function prospectionSchedule(deps: ProspectionKevinDeps): Promise<Record<string, unknown>> {
  const now = nowOf(deps);
  const day = parisDay(now);
  const minutes = parisMinutes(now);
  const weekday = parisWeekday(now);
  const out: Record<string, unknown> = {};
  const runs = await readRuns(deps);
  const next: Runs = { ...runs };

  // Premier démarrage sans offre : 3 questions au client, une seule fois.
  try {
    out.offers = (await ensureProspectionOfferQuestions(deps)).queued;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[prospection] questions des offres non posées");
  }

  // Découverte de nuit : une fois par nuit, lots étalés jusqu'à 6 h.
  const { startHour, endHour } = PROSPECTION_DISCOVERY_WINDOW;
  if (minutes >= startHour * 60 && minutes < endHour * 60 && runs.discover !== day) {
    next.discover = day;
    await writeSetting(deps, PROSPECTION_RUNS_SETTING, next);
    const lots = await prospectionPort(deps).planDiscoveryLots(deps, now);
    const windowLeft = fromParis(day, endHour * 60).getTime() - now.getTime();
    const spacing = lots.length > 1 ? Math.max(0, Math.min(20 * 60_000, Math.floor(windowLeft / lots.length))) : 0;
    for (const [i, lot] of lots.entries()) await queueProspection(deps, { type: "prospection.discover", lot }, { jobId: `prospection.discover:${day}:${i}`, delayMs: i * spacing });
    out.discover = lots.length;
  }

  // Enrichissement continu (plafond du jour).
  out.enrich = await queueEnrichments(deps, next, day, now);

  // « Pas intéressé » depuis 60 jours → de nouveau à contacter (une fois par jour).
  if (next.skipped !== day) {
    next.skipped = day;
    out.requalified = await requalifySkipped(deps);
  }
  await writeSetting(deps, PROSPECTION_RUNS_SETTING, next);

  // Rapport du lundi, Top du jour, rappels.
  const topHour = await numberSetting(deps, PROSPECTION_SETTINGS.dailyTopHour.key, PROSPECTION_SETTINGS.dailyTopHour.value);
  const queued: string[] = [];
  if (minutes >= topHour * 60) {
    if (weekday === 1 && !(await claimed(deps, sentKey("weekly-report", mondayOf(day, weekday))))) {
      await queueProspection(deps, { type: "prospection.weekly-report" }, { jobId: `prospection.weekly-report:${mondayOf(day, weekday)}` });
      queued.push("weekly-report");
    }
    if (!(await claimed(deps, sentKey("daily-top", day)))) {
      await queueProspection(deps, { type: "prospection.daily-top" }, { jobId: `prospection.daily-top:${day}` });
      queued.push("daily-top");
    }
  }
  if (minutes >= topHour * 60 + PROSPECTION_REMINDERS_OFFSET_MIN && !(await claimed(deps, sentKey("reminders", day)))) {
    await queueProspection(deps, { type: "prospection.reminders" }, { jobId: `prospection.reminders:${day}` });
    queued.push("reminders");
  }
  out.queued = queued;
  out.requests = await checkRequestWatches(deps, now);
  // Phase 32 : Veilleur, réseaux, valeurs, alertes du matin, boucle Link Affi, compte réel.
  try {
    out.advanced = await prospectionAdvancedSchedule(deps, queueProspection);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[prospection] planification avancée en échec");
  }
  return out;
}

async function queueEnrichments(deps: ProspectionKevinDeps, runs: Runs, day: string, now: Date): Promise<number> {
  const cap = await numberSetting(deps, PROSPECTION_SETTINGS.enrichDailyCap.key, PROSPECTION_SETTINGS.enrichDailyCap.value);
  const state = runs.enrich && runs.enrich.day === day ? { ...runs.enrich, recent: { ...runs.enrich.recent } } : { day, count: 0, recent: { ...(runs.enrich?.recent ?? {}) } };
  for (const [id, at] of Object.entries(state.recent)) if (now.getTime() - new Date(at).getTime() > ENRICH_RECENT_MS) delete state.recent[id];
  const room = Math.min(PROSPECTION_ENRICH_PER_TICK, Math.max(0, cap - state.count));
  let queued = 0;
  if (room > 0) {
    const recent = Object.keys(state.recent);
    const fresh = (await deps.prisma.prospect.findMany({
      where: { status: "DISCOVERED", ...(recent.length ? { id: { notIn: recent } } : {}) } as never,
      orderBy: [{ priority: "desc" }, { discoveredAt: "asc" }],
      take: room,
    })) as ProspectRow[];
    // Lectures ratées : l'Enrichisseur remet lui-même l'essai 6 h plus tard ; ici, le filet pour une reprise perdue.
    const retry = fresh.length < room
      ? ((await deps.prisma.prospect.findMany({
          where: { status: "ENRICH_FAILED", nextEnrichAt: { lte: new Date(now.getTime() - ENRICH_RECENT_MS) }, enrichAttempts: { lt: PROSPECTION_LIMITS.maxEnrichAttempts }, ...(recent.length ? { id: { notIn: recent } } : {}) } as never,
          orderBy: [{ nextEnrichAt: "asc" }],
          take: room - fresh.length,
        })) as ProspectRow[])
      : [];
    for (const p of [...fresh, ...retry]) {
      await queueProspection(deps, { type: "prospection.enrich", prospectId: p.id }, { jobId: `prospection.enrich:${p.id}`, priority: (p.priority ?? 0) >= MANUAL_PRIORITY_MIN ? PRIORITY_MANUAL : PRIORITY_NORMAL });
      state.recent[p.id] = now.toISOString();
      state.count++;
      queued++;
    }
  }
  runs.enrich = state;
  return queued;
}

async function requalifySkipped(deps: ProspectionKevinDeps): Promise<number> {
  try {
    return await prospectionPort(deps).returnSkippedProspects(deps);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[prospection] retour des canaux mis de côté impossible");
    return 0;
  }
}

// ------------------------------------------------------------------------------------------------ étapes d'un canal

async function enrichStep(deps: ProspectionKevinDeps, prospectId: string): Promise<Record<string, unknown>> {
  const result = await prospectionPort(deps).enrichProspect(deps, prospectId);
  const p = await loadRow(deps, prospectId);
  if (!p) return { enriched: result, missing: true };
  if (p.status === "UNREADABLE" || p.status === "DISQUALIFIED") {
    await notifyWatch(deps, p);
    return { enriched: result, status: p.status };
  }
  if (p.status === "ENRICH_FAILED") {
    if ((p.enrichAttempts ?? 0) >= PROSPECTION_LIMITS.maxEnrichAttempts) await notifyWatch(deps, p);
    return { enriched: result, status: p.status };
  }
  // Lu : l'Enrichisseur met le score en file lui-même ; sans file (outils, tests), la note suit tout de suite.
  if (!result.scoreQueued && p.status === "ENRICHING") {
    await queueProspection(deps, { type: "prospection.score", prospectId }, { jobId: `prospection.score:${prospectId}`, ...(await manualPriority(deps, p)) });
    return { enriched: result, next: "score" };
  }
  return { enriched: result, status: p.status };
}

async function manualPriority(deps: ProspectionKevinDeps, p: ProspectRow): Promise<{ priority: number }> {
  const watched = (await readSetting(deps, `${PROSPECTION_WATCH_PREFIX}${p.id}`)) != null;
  return { priority: watched || (p.priority ?? 0) >= MANUAL_PRIORITY_MIN ? PRIORITY_MANUAL : PRIORITY_NORMAL };
}

async function scoreStep(deps: ProspectionKevinDeps, prospectId: string): Promise<Record<string, unknown>> {
  // Le score met lui-même le dossier en file (les A et les meilleurs B, dans le plafond de la semaine).
  const result = await prospectionPort(deps).scoreAndStore(deps, prospectId);
  const p = await loadRow(deps, prospectId);
  if (!p) return { scored: result, missing: true };
  await notifyWatch(deps, p);
  return { scored: result };
}

/** Canal ajouté à la main par le client : Kevin dit ce qu'il en pense, une seule fois. */
async function notifyWatch(deps: ProspectionKevinDeps, p: ProspectRow): Promise<void> {
  const key = `${PROSPECTION_WATCH_PREFIX}${p.id}`;
  const w = (await readSetting(deps, key)) as Watch | undefined | null;
  if (!w) return;
  const name = handle(p);
  let text: string;
  if (p.status === "UNREADABLE") text = pick(V.readyUnreadable({ name }), "prospection.ready.unreadable", w.chatId);
  else if (p.status === "ENRICH_FAILED") text = pick(V.readyFailed({ name }), "prospection.ready.failed", w.chatId);
  else if (p.status === "DISQUALIFIED") text = pick(V.readyOut({ name, reason: (p.tierReason ?? "il ne colle pas à nos critères").replace(/[.\s]+$/, "") }), "prospection.ready.out", w.chatId);
  else if (p.score !== null && p.tier) text = pick(V.ready({ name, tier: p.tier, score: p.score, reason: (p.tierReason ?? "fiche complète sur le site").replace(/[.\s]+$/, "") }), "prospection.ready", w.chatId);
  else return;
  await deps.prisma.setting.deleteMany({ where: { key } });
  await sendProspectionKevin(deps, w.chatId, text);
}

// ------------------------------------------------------------------------------------------------ Top, rappels, rapport

async function scheduledTop(deps: ProspectionKevinDeps): Promise<Record<string, unknown>> {
  const now = nowOf(deps);
  const day = parisDay(now);
  // Lundi : le rapport de la semaine part AVANT le Top du jour.
  if (parisWeekday(now) === 1) await ensureWeeklyReport(deps);
  const key = sentKey("daily-top", day);
  if (!(await claim(deps, key))) return { skipped: "déjà envoyé" };
  const count = await numberSetting(deps, PROSPECTION_SETTINGS.dailyTopCount.key, PROSPECTION_SETTINGS.dailyTopCount.value);
  let r: { sent: number; qaBlocked: boolean };
  try {
    r = await prospectionPort(deps).sendDailyTop(deps, { count, now, scope: "morning" });
  } catch (err) {
    await release(deps, key);
    throw err;
  }
  // Sans offre : l'adéquation est « Europe, thème » seulement, Kevin le dit sous la liste.
  if (r.sent > 0 && (await activeOffers(deps)).length === 0) await sendProspectionKevin(deps, null, pick(V.noOffer, "prospection.noOffer", null));
  await agentEvent(deps, "prospection.daily_top.sent", { day, sent: r.sent, qaBlocked: r.qaBlocked });
  return { sent: r.sent, qaBlocked: r.qaBlocked };
}

/** Liste demandée (« encore 10 ») : sans doublon du matin ; la phrase « plus rien » est dite par le Pipeline. */
async function requestedTop(deps: ProspectionKevinDeps, req: { chatId?: string | null; count?: number }): Promise<Record<string, unknown>> {
  const now = nowOf(deps);
  const count = req.count ?? (await numberSetting(deps, PROSPECTION_SETTINGS.dailyTopCount.key, PROSPECTION_SETTINGS.dailyTopCount.value));
  const r = await prospectionPort(deps).sendDailyTop(deps, { count, now, scope: "on_demand" });
  return { sent: r.sent, qaBlocked: r.qaBlocked, requested: true };
}

async function remindersStep(deps: ProspectionKevinDeps): Promise<Record<string, unknown>> {
  const now = nowOf(deps);
  const key = sentKey("reminders", parisDay(now));
  if (!(await claim(deps, key))) return { skipped: "déjà envoyé" };
  try {
    return { reminders: await prospectionPort(deps).runReminders(deps, now) };
  } catch (err) {
    await release(deps, key);
    throw err;
  }
}

/** Rapport de la semaine (lundi, une seule fois) : appelé par sa tâche et par le Top du lundi (qui passe après). */
export async function ensureWeeklyReport(deps: ProspectionKevinDeps): Promise<string> {
  const now = nowOf(deps);
  const weekday = parisWeekday(now);
  if (weekday !== 1) return "pas lundi";
  const key = sentKey("weekly-report", mondayOf(parisDay(now), weekday));
  if (!(await claim(deps, key))) return "déjà envoyé";
  try {
    await prospectionPort(deps).sendWeeklyReport(deps, now);
  } catch (err) {
    await release(deps, key);
    throw err;
  }
  return "envoyé";
}

// ------------------------------------------------------------------------------------------------ recherches demandées

/** Retient une recherche demandée par le client (Kevin préviendra aux premiers canaux bons à contacter). */
export async function rememberProspectionRequest(deps: ProspectionKevinDeps, requestId: string, w: Omit<ProspectionRequestWatch, "at" | "notifiedAt">): Promise<void> {
  await writeSetting(deps, `${PROSPECTION_REQUEST_PREFIX}${requestId}`, { ...w, at: nowOf(deps).toISOString(), notifiedAt: null });
}

/** Retient un canal ajouté à la main (Kevin préviendra quand il est lu). */
export async function rememberProspectWatch(deps: ProspectionKevinDeps, prospectId: string, w: Omit<Watch, "at">): Promise<void> {
  await writeSetting(deps, `${PROSPECTION_WATCH_PREFIX}${prospectId}`, { ...w, at: nowOf(deps).toISOString() });
}

export function requestWhat(vertical: "CASINO" | "SPORTS", countries: readonly string[]): string {
  return `${VERTICAL_WORDS[vertical]}${countries.length ? ` en ${countriesText(countries)}` : ""}`;
}

async function checkRequestWatches(deps: ProspectionKevinDeps, now: Date): Promise<number> {
  const rows = (await deps.prisma.setting.findMany({ where: { key: { startsWith: PROSPECTION_REQUEST_PREFIX } }, take: 50 })) as Array<{ key: string; value: unknown }>;
  let notified = 0;
  for (const row of rows) {
    const w = row.value as ProspectionRequestWatch | null;
    if (!w || typeof w !== "object" || w.notifiedAt) continue;
    const at = new Date(w.at);
    const found = ((await deps.prisma.prospect.findMany({ where: { status: "QUALIFIED", discoveredAt: { gte: at } } as never, take: 500 })) as ProspectRow[]).filter((p) => {
      if (p.region !== "EU") return false;
      if (p.vertical !== w.vertical && p.vertical !== "BOTH") return false;
      const first = stringArray(p.countries)[0]?.toUpperCase() ?? "";
      return !w.countries.length || w.countries.includes(first);
    });
    let text: string | null = null;
    if (found.length) text = pick(V.searchFirst({ name: "", count: found.length, what: w.what }), "prospection.searchFirst", w.chatId);
    else if (now.getTime() - at.getTime() >= REQUEST_GIVE_UP_MS) text = pick(V.searchNothing({ name: "", count: 0, what: w.what }), "prospection.searchNothing", w.chatId);
    if (!text) continue;
    await writeSetting(deps, row.key, { ...w, notifiedAt: now.toISOString() });
    await sendProspectionKevin(deps, w.chatId, text);
    notified++;
  }
  return notified;
}

/** Lots de découverte d'une demande du client, déjà préparés par le Sourceur : mis en file tout de suite. */
export async function queueDiscoveryLots(deps: ProspectionKevinDeps, lots: readonly DiscoveryLot[], requestId: string): Promise<number> {
  for (const [i, lot] of lots.entries()) await queueProspection(deps, { type: "prospection.discover", lot }, { jobId: `prospection.discover:${requestId}:${i}` });
  return lots.length;
}
