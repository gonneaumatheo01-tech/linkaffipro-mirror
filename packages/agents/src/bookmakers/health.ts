/**
 * Phase 35, chantier D — santé des bookmakers lus directement (règle 6 : se réparer avant de déranger).
 * Toutes les 30 minutes (tâche `bookmakers-health` de la file `agents-bookmakers`), pour chaque site actif déjà
 * appris : une lecture légère (liste des matchs du jour, `readEvents` du chantier C), puis
 * - taux de réussite sur 24 h (`Setting` `bookmakers.health.<site>`, les contrôles des dernières 24 h) ;
 * - `DEGRADED` sous 90 % (avec au moins `MIN_CHECKS_FOR_RATE` contrôles : un seul échec ne suffit pas) ;
 * - `BLOCKED` après 3 échecs de suite, ou tout de suite devant un obstacle humain (contrôle anti-robot, code de
 *   connexion, mot de passe refusé) ;
 * - ré-apprentissage automatique (`learnSite`, chantier B) au 2e échec de suite ou quand le site a changé, au plus
 *   une fois par 24 h (dernier ré-apprentissage de ce module ou recette « repair » récente) ;
 * - chaque changement d'état → `AuditLog` `bookmakers.status_changed` et message de Kevin avec le geste à faire,
 *   alertes `bookmaker_blocked` / `bookmaker_degraded` (une par site, résolues quand le site va mieux).
 * Aucune lecture la nuit (1 h - 7 h, Paris) sauf ordre (`force`). Aucun secret, aucun texte de page dans le journal.
 * Crochet du lecteur (`deps.bookmakers.onBookmakerEvent`, chantier C) : `bookmakerKevinHook` (messages de Kevin).
 */
import { ALERT_SETTINGS_KEY, parseAlertSwitches } from "@linkaffipro/core";
import { agentAudit, nowOf, readSetting, writeSetting } from "../admin/journal";
import { parisDay, parisDayStart, addDaysToDay } from "../rules/time";
import type { AgentsDeps } from "../types";
import { BOOKMAKERS_VARIANTS as V } from "../boss/bookmakers-texts";
import { pick } from "../boss/voice";
import { BOOKMAKER_LIMITS, type SiteStatus } from "./contract";
import { isNightInParis, type BookmakerHookEvent, type BookmakerReadDeps } from "./read/deps";
import { learnSite, readEvents } from "./ops";
import { listSites, type SiteRow } from "./sites";

export const HEALTH_SETTING_PREFIX = "bookmakers.health.";
export const BOOKMAKERS_HEALTH_EVERY_MS = 30 * 60_000;
export const BOOKMAKER_BLOCKED_ALERT = "bookmaker_blocked";
export const BOOKMAKER_DEGRADED_ALERT = "bookmaker_degraded";
/** Le taux de 24 h ne compte qu'à partir de 5 contrôles (un échec isolé ne rend pas un site « fragile »). */
export const MIN_CHECKS_FOR_RATE = 5;
/** Ré-apprentissage automatique au 2e échec de suite (règle 6). */
export const RELEARN_AFTER_FAILURES = 2;
/** Un même message de Kevin sur un même site n'est pas renvoyé avant 6 heures. */
export const KEVIN_REPEAT_MS = 6 * 3600_000;
/** Contrôles gardés : 24 h (au plus 100). */
const MAX_CHECKS = 100;
const DAY_MS = 24 * 3600_000;

/** Causes qui demandent un humain tout de suite (règle 6 : captcha, code, mot de passe). */
export const HUMAN_CAUSES: ReadonlySet<string> = new Set(["captcha", "two_factor", "password_refused"]);

export type HealthCheck = { at: string; ok: boolean; cause: string | null };
export type SiteHealth = {
  checks: HealthCheck[];
  consecutiveFailures: number;
  lastRelearnAt: string | null;
  lastCause: string | null;
  /** Dernier message de Kevin sur ce site (anti-répétition). */
  lastMessage: { key: string; at: string } | null;
};

/** Geste attendu de l'humain (affiché par le site, dit par Kevin). */
export type HealthGesture = "open_browser" | "enter_code" | "password" | "new_url" | "keep_mac_on" | "none";

export function emptyHealth(): SiteHealth {
  return { checks: [], consecutiveFailures: 0, lastRelearnAt: null, lastCause: null, lastMessage: null };
}

/** Lecture tolérante du réglage (pur). */
export function parseSiteHealth(v: unknown): SiteHealth {
  if (!v || typeof v !== "object" || Array.isArray(v)) return emptyHealth();
  const o = v as Record<string, unknown>;
  const checks = Array.isArray(o.checks)
    ? (o.checks as unknown[])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as { at?: unknown }).at === "string")
        .map((c) => ({ at: String(c.at), ok: c.ok === true, cause: typeof c.cause === "string" ? c.cause : null }))
    : [];
  const lm = o.lastMessage as { key?: unknown; at?: unknown } | null | undefined;
  return {
    checks,
    consecutiveFailures: typeof o.consecutiveFailures === "number" && o.consecutiveFailures >= 0 ? Math.floor(o.consecutiveFailures) : 0,
    lastRelearnAt: typeof o.lastRelearnAt === "string" ? o.lastRelearnAt : null,
    lastCause: typeof o.lastCause === "string" ? o.lastCause : null,
    lastMessage: lm && typeof lm.key === "string" && typeof lm.at === "string" ? { key: lm.key, at: lm.at } : null,
  };
}

/** Taux de réussite des contrôles des dernières 24 h (pur) ; `ratio` null sans contrôle. */
export function healthRate(checks: readonly HealthCheck[], now: Date): { total: number; ok: number; ratio: number | null } {
  const since = now.getTime() - DAY_MS;
  const recent = checks.filter((c) => new Date(c.at).getTime() >= since);
  const ok = recent.filter((c) => c.ok).length;
  return { total: recent.length, ok, ratio: recent.length ? ok / recent.length : null };
}

/** Ajoute un contrôle et garde les 24 dernières heures (pur). */
export function withCheck(h: SiteHealth, check: HealthCheck, now: Date): SiteHealth {
  const since = now.getTime() - DAY_MS;
  const checks = [...h.checks, check].filter((c) => new Date(c.at).getTime() >= since).slice(-MAX_CHECKS);
  return {
    ...h,
    checks,
    consecutiveFailures: check.ok ? 0 : h.consecutiveFailures + 1,
    lastCause: check.ok ? null : check.cause,
  };
}

/** Nouvel état d'un site après un contrôle (pur). */
export function decideStatus(input: { current: string; ok: boolean; cause: string | null; consecutiveFailures: number; rate: { total: number; ratio: number | null } }): SiteStatus {
  const lowRate = input.rate.total >= MIN_CHECKS_FOR_RATE && input.rate.ratio !== null && input.rate.ratio < BOOKMAKER_LIMITS.degradedBelowRatio;
  if (input.ok) return lowRate ? "DEGRADED" : "READY";
  if (input.cause && HUMAN_CAUSES.has(input.cause)) return "BLOCKED";
  if (input.consecutiveFailures >= BOOKMAKER_LIMITS.blockedAfterFailures) return "BLOCKED";
  if (input.current === "BLOCKED") return "BLOCKED";
  if (lowRate) return "DEGRADED";
  return input.current === "DEGRADED" ? "DEGRADED" : "READY";
}

/** Un ré-apprentissage automatique est-il permis maintenant (pur) ? Au plus un par 24 h. */
export function relearnAllowed(lastRelearnAt: Date | null, now: Date): boolean {
  return !lastRelearnAt || now.getTime() - lastRelearnAt.getTime() >= BOOKMAKER_LIMITS.relearnMinIntervalMs;
}

/** Cause lisible d'un échec de lecture (pur) : diagnostic du lecteur, code, puis mots du message. */
export function failureCause(err: unknown): string {
  const e = (err ?? {}) as { diagnosis?: unknown; code?: unknown; obstacle?: unknown; message?: unknown };
  for (const v of [e.diagnosis, e.obstacle]) if (typeof v === "string" && v && v !== "ok") return v;
  const code = typeof e.code === "string" ? e.code : "";
  const msg = `${code} ${typeof e.message === "string" ? e.message : String(err ?? "")}`.toLowerCase();
  if (/captcha|robot|cloudflare|challenge/.test(msg)) return "captcha";
  if (/two.?factor|2fa|code de (connexion|vérification)|otp/.test(msg)) return "two_factor";
  if (/password|mot de passe|identifiants? (refusés?|invalides?)/.test(msg)) return "password_refused";
  if (/geo|géo|pays|country|region|région/.test(msg)) return "geo_blocked";
  if (/maintenance/.test(msg)) return "maintenance";
  if (/logged.?out|déconnect|session expir/.test(msg)) return "logged_out";
  if (/enotfound|dns|not.?found|404|introuvable|moved/.test(msg)) return "moved";
  if (/site.?changed|structure|recette|méthode de lecture/.test(msg)) return "site_changed";
  if (/no_transport|aucun moyen/.test(msg)) return "no_transport";
  if (/night|nuit/.test(msg)) return "night";
  return code || "unknown";
}

/** Geste attendu pour une cause (pur). */
export function gestureFor(cause: string | null): HealthGesture {
  switch (cause) {
    case "captcha":
    case "logged_out":
      return "open_browser";
    case "two_factor":
      return "enter_code";
    case "password_refused":
      return "password";
    case "moved":
      return "new_url";
    case "geo_blocked":
    case "no_transport":
      return "keep_mac_on";
    default:
      return cause ? "open_browser" : "none";
  }
}

/** Texte de Kevin pour un passage d'état (pur, hors rotation). Clé = anti-répétition. */
export function statusMessage(site: { label: string }, to: SiteStatus, h: { cause: string | null; consecutiveFailures: number; ratio: number | null }): { key: string; variants: readonly string[] } | null {
  const s = { site: site.label };
  if (to === "READY") return { key: "recovered", variants: V.recovered(s) };
  if (to === "DEGRADED") return { key: "degraded", variants: V.degraded({ ...s, pct: Math.round((h.ratio ?? 0) * 100) }) };
  if (to !== "BLOCKED") return null;
  switch (h.cause) {
    case "captcha":
      return { key: "blocked:captcha", variants: V.blockedCaptcha(s) };
    case "two_factor":
      return { key: "blocked:two_factor", variants: V.blockedTwoFactor(s) };
    case "password_refused":
      return { key: "blocked:password", variants: V.blockedPassword(s) };
    case "moved":
      return { key: "blocked:moved", variants: V.blockedMoved(s) };
    case "geo_blocked":
    case "no_transport":
      return { key: "blocked:geo", variants: V.blockedGeo(s) };
    case "logged_out":
      return { key: "blocked:logged_out", variants: V.blockedLoggedOut(s) };
    default:
      return { key: "blocked:failures", variants: V.blockedFailures({ ...s, n: Math.max(h.consecutiveFailures, BOOKMAKER_LIMITS.blockedAfterFailures) }) };
  }
}

// ------------------------------------------------------------------------------------------------ base

export async function readSiteHealth(deps: Pick<AgentsDeps, "prisma">, siteKey: string): Promise<SiteHealth> {
  return parseSiteHealth(await readSetting(deps, `${HEALTH_SETTING_PREFIX}${siteKey}`));
}

async function writeSiteHealth(deps: Pick<AgentsDeps, "prisma">, siteKey: string, h: SiteHealth): Promise<void> {
  await writeSetting(deps, `${HEALTH_SETTING_PREFIX}${siteKey}`, h);
}

/** Dernier ré-apprentissage connu : celui de ce module, ou une méthode « repair » enregistrée par l'apprentissage. */
async function lastRelearn(deps: Pick<AgentsDeps, "prisma">, siteKey: string, h: SiteHealth): Promise<Date | null> {
  const recipe = (await deps.prisma.bookmakerRecipe.findFirst({ where: { siteKey, createdBy: "repair" }, orderBy: { createdAt: "desc" } })) as { createdAt: Date } | null;
  const mine = h.lastRelearnAt ? new Date(h.lastRelearnAt) : null;
  const dates = [mine, recipe?.createdAt ?? null].filter((d): d is Date => !!d && Number.isFinite(d.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

/** Message de Kevin (anti-répétition par site et par sujet). Rend vrai si un message est parti. */
async function tellKevin(deps: AgentsDeps, siteKey: string, h: SiteHealth, msg: { key: string; variants: readonly string[] }, now: Date, opts: { mediaAssetId?: string | null } = {}): Promise<{ sent: boolean; health: SiteHealth }> {
  if (h.lastMessage && h.lastMessage.key === msg.key && now.getTime() - new Date(h.lastMessage.at).getTime() < KEVIN_REPEAT_MS) return { sent: false, health: h };
  if (!deps.admin) return { sent: false, health: h };
  try {
    const r = await deps.admin.send(pick(msg.variants, `bookmakers.${msg.key}.${siteKey}`), opts.mediaAssetId ? { mediaAssetId: opts.mediaAssetId } : undefined);
    if (!r) return { sent: false, health: h };
  } catch (err) {
    deps.logger?.warn({ site: siteKey, err: (err as Error).message }, "[bookmakers] message de Kevin impossible");
    return { sent: false, health: h };
  }
  return { sent: true, health: { ...h, lastMessage: { key: msg.key, at: now.toISOString() } } };
}

export type StatusChange = { siteKey: string; from: string; to: SiteStatus; cause: string | null; told: boolean };

/**
 * Applique un état (si différent) : base, `AuditLog`, message de Kevin. Rend le changement, ou null si rien ne
 * change. Partagé par la santé et par le crochet du lecteur (obstacle humain vu pendant une lecture).
 */
export async function applySiteStatus(
  deps: AgentsDeps,
  site: Pick<SiteRow, "key" | "label" | "status">,
  to: SiteStatus,
  h: SiteHealth,
  now: Date,
  extra: { reason?: string | null; ratio?: number | null } = {},
): Promise<{ change: StatusChange | null; health: SiteHealth }> {
  if (site.status === to) return { change: null, health: h };
  const cause = to === "READY" ? null : h.lastCause;
  const reason = to === "READY" ? null : (extra.reason ?? statusReasonOf(to, cause, h.consecutiveFailures));
  await deps.prisma.bookmakerSite.update({ where: { key: site.key }, data: { status: to, statusReason: reason } });
  await agentAudit(deps, {
    action: "bookmakers.status_changed",
    entityType: "BookmakerSite",
    entityId: site.key,
    metadata: { from: site.status, to, cause, reason, gesture: gestureFor(cause), consecutiveFailures: h.consecutiveFailures },
  });
  let told = false;
  let health = h;
  // NEW / LEARNING → READY : c'est l'apprentissage qui l'annonce, pas la santé.
  const quiet = to === "READY" && site.status !== "DEGRADED" && site.status !== "BLOCKED";
  const msg = quiet ? null : statusMessage(site, to, { cause, consecutiveFailures: h.consecutiveFailures, ratio: extra.ratio ?? null });
  if (msg) {
    const r = await tellKevin(deps, site.key, h, msg, now);
    told = r.sent;
    health = r.health;
  }
  return { change: { siteKey: site.key, from: site.status, to, cause, told }, health };
}

/** Raison affichée par le site (français courant, sans jargon). */
export function statusReasonOf(to: SiteStatus, cause: string | null, failures: number): string | null {
  if (to === "READY") return null;
  const label: Record<string, string> = {
    captcha: "le site demande un contrôle anti-robot",
    two_factor: "le site demande un code de connexion",
    password_refused: "le site refuse le mot de passe",
    moved: "le site ne répond plus à son adresse",
    geo_blocked: "le site refuse le serveur : lecture par le Mac",
    no_transport: "aucun lecteur disponible (serveur refusé, Mac éteint)",
    logged_out: "le site déconnecte le compte",
    maintenance: "le site est en maintenance",
    site_changed: "le site a changé",
    empty: "page vide",
  };
  const base = (cause && label[cause]) || (failures ? `${failures} échec${failures > 1 ? "s" : ""} de suite` : "lectures irrégulières");
  return to === "DEGRADED" ? `lectures irrégulières (${base})` : base;
}

// ------------------------------------------------------------------------------------------------ alertes

type AlertRow = { id: string; kind: string; payload: unknown; resolvedAt: Date | null; createdAt: Date };
const alertKey = (a: AlertRow) => String((a.payload as { key?: unknown } | null)?.key ?? "");

/** Une alerte par site et par état (bloqué / fragile), résolue quand le site va mieux ; coupable dans Réglages → Alertes. */
export async function syncBookmakerAlerts(deps: AgentsDeps, sites: readonly SiteRow[], now: Date, told: ReadonlySet<string> = new Set()): Promise<{ created: number; resolved: number }> {
  const switches = parseAlertSwitches((await deps.prisma.setting.findUnique({ where: { key: ALERT_SETTINGS_KEY } }))?.value);
  let created = 0;
  let resolved = 0;
  for (const [kind, status] of [
    [BOOKMAKER_BLOCKED_ALERT, "BLOCKED"],
    [BOOKMAKER_DEGRADED_ALERT, "DEGRADED"],
  ] as const) {
    const on = (switches as Record<string, boolean>)[kind] !== false;
    const wanted = on ? sites.filter((s) => s.isActive && s.status === status) : [];
    const open = (await deps.prisma.alert.findMany({ where: { kind, resolvedAt: null } })) as AlertRow[];
    for (const s of wanted) {
      if (open.some((a) => alertKey(a) === s.key)) continue;
      const reason = s.statusReason ?? (status === "BLOCKED" ? "lecture impossible" : "lectures irrégulières");
      await deps.prisma.alert.create({
        data: {
          kind,
          severity: status === "BLOCKED" ? "CRITICAL" : "WARNING",
          message:
            status === "BLOCKED"
              ? `${s.label} ne se lit plus : ${reason}. Kevin a dit quoi faire ; la page Agents → Bookmakers montre le détail.`
              : `${s.label} se lit mal en ce moment : ${reason}. Rien à faire pour l'instant, la réparation est automatique.`,
          payload: { key: s.key, siteKey: s.key, status, reason },
          createdAt: now,
          // Kevin l'a déjà dit : pas de deuxième message pour la même chose.
          ...(told.has(s.key) ? { notifiedAt: now } : {}),
        } as never,
      });
      created++;
    }
    const keep = new Set(wanted.map((s) => s.key));
    const gone = open.filter((a) => !keep.has(alertKey(a)));
    if (gone.length) {
      await deps.prisma.alert.updateMany({ where: { id: { in: gone.map((a) => a.id) } }, data: { resolvedAt: now } });
      resolved += gone.length;
    }
  }
  return { created, resolved };
}

// ------------------------------------------------------------------------------------------------ passage

export type SiteHealthResult =
  | { siteKey: string; skipped: string }
  | { siteKey: string; ok: boolean; cause: string | null; status: SiteStatus; ratio: number | null; relearned: boolean; change: StatusChange | null };

export type HealthRunResult = { skipped?: "night"; sites: SiteHealthResult[]; alerts?: { created: number; resolved: number } };

/** Sites contrôlés : actifs, avec une adresse, déjà appris (prêts, fragiles ou bloqués). */
export const CHECKED_STATUSES: readonly string[] = ["READY", "DEGRADED", "BLOCKED"];

/** Fenêtre de la lecture légère : maintenant → fin du jour de Paris (au moins 2 heures). */
export function lightReadWindow(now: Date): { from: Date; to: Date } {
  const end = parisDayStart(addDaysToDay(parisDay(now), 1));
  return { from: now, to: new Date(Math.max(end.getTime(), now.getTime() + 2 * 3600_000)) };
}

async function checkSite(deps: BookmakerReadDeps, site: SiteRow, now: Date, told: Set<string>): Promise<SiteHealthResult> {
  let h = await readSiteHealth(deps, site.key);
  let ok = false;
  let cause: string | null = null;
  try {
    const w = lightReadWindow(now);
    // Lecture réelle (pas le cache) : c'est la santé du site qu'on mesure.
    await readEvents(deps, site.key, { from: w.from, to: w.to, fresh: true });
    ok = true;
  } catch (err) {
    cause = failureCause(err);
    if (cause === "night") return { siteKey: site.key, skipped: "night" };
  }
  h = withCheck(h, { at: now.toISOString(), ok, cause }, now);
  let relearned = false;
  if (!ok && !(cause && HUMAN_CAUSES.has(cause)) && (h.consecutiveFailures >= RELEARN_AFTER_FAILURES || cause === "site_changed") && relearnAllowed(await lastRelearn(deps, site.key, h), now)) {
    h = { ...h, lastRelearnAt: now.toISOString() };
    await writeSiteHealth(deps, site.key, h);
    try {
      const r = await learnSite(deps, site.key, { reason: "repair" });
      relearned = true;
      if (r.ok) {
        // Réparé : le contrôle compte comme réussi (la nouvelle méthode a été vérifiée sur le site).
        h = { ...h, checks: [...h.checks.slice(0, -1), { at: now.toISOString(), ok: true, cause: null }], consecutiveFailures: 0, lastCause: null };
        ok = true;
        cause = null;
      }
    } catch (err) {
      deps.logger?.warn({ site: site.key, err: (err as Error).message }, "[bookmakers] ré-apprentissage automatique en échec");
    }
  }
  const current = ((await deps.prisma.bookmakerSite.findUnique({ where: { key: site.key } })) as SiteRow | null) ?? site;
  const rate = healthRate(h.checks, now);
  const to = decideStatus({ current: current.status, ok, cause, consecutiveFailures: h.consecutiveFailures, rate });
  await deps.prisma.bookmakerSite.update({ where: { key: site.key }, data: { lastReadAt: now, ...(ok ? { lastOkAt: now } : {}) } });
  const applied = await applySiteStatus(deps, current, to, h, now, { ratio: rate.ratio });
  h = applied.health;
  if (applied.change?.told) told.add(site.key);
  await writeSiteHealth(deps, site.key, h);
  return { siteKey: site.key, ok, cause, status: to, ratio: rate.ratio, relearned, change: applied.change };
}

/**
 * Passage de santé (toutes les 30 minutes). `force` : même la nuit (ordre explicite). Un site en erreur n'arrête
 * jamais le contrôle des autres.
 */
export async function bookmakersHealth(deps: BookmakerReadDeps, now: Date = nowOf(deps), opts: { force?: boolean } = {}): Promise<HealthRunResult> {
  if (!opts.force && isNightInParis(now)) return { skipped: "night", sites: [] };
  const sites = await listSites(deps, { activeOnly: true });
  const results: SiteHealthResult[] = [];
  const told = new Set<string>();
  const readDeps: BookmakerReadDeps = opts.force ? { ...deps, bookmakers: { ...deps.bookmakers, force: true } } : deps;
  for (const site of sites) {
    if (!site.baseUrl) {
      results.push({ siteKey: site.key, skipped: "sans adresse" });
      continue;
    }
    if (!CHECKED_STATUSES.includes(site.status)) {
      results.push({ siteKey: site.key, skipped: site.status === "LEARNING" ? "apprentissage en cours" : "pas encore appris" });
      continue;
    }
    try {
      results.push(await checkSite(readDeps, site, now, told));
    } catch (err) {
      deps.logger?.warn({ site: site.key, err: (err as Error).message }, "[bookmakers] contrôle de santé impossible");
      results.push({ siteKey: site.key, skipped: `erreur : ${(err as Error).message.slice(0, 120)}` });
    }
  }
  const after = await listSites(deps, { activeOnly: false });
  const alerts = await syncBookmakerAlerts(deps, after, now, told);
  return { sites: results, alerts };
}

// ------------------------------------------------------------------------------------------------ crochet

async function pickLabel(deps: AgentsDeps, pickId: string | null): Promise<{ match: string; bet: string } | null> {
  if (!pickId) return null;
  const p = (await deps.prisma.bettingPick.findUnique({ where: { id: pickId } })) as { homeTeam: string; awayTeam: string; selectionLabel: string; marketLabel: string } | null;
  return p ? { match: `${p.homeTeam} - ${p.awayTeam}`, bet: p.selectionLabel || p.marketLabel } : null;
}

/**
 * Crochet du lecteur (`deps.bookmakers.onBookmakerEvent`) : messages de Kevin. Double lecture impossible → « le pari
 * attend : je t'envoie la capture » ; obstacle humain → site bloqué avec le geste ; bascule sur le Mac → une fois ;
 * ré-apprentissage → prêt, ou échec avec la raison. Les échecs de lecture simples restent à la santé (aucun message).
 */
export function bookmakerKevinHook(deps: AgentsDeps): (e: BookmakerHookEvent) => Promise<void> {
  return async (e) => {
    const now = nowOf(deps);
    const site = (await deps.prisma.bookmakerSite.findUnique({ where: { key: e.siteKey } })) as SiteRow | null;
    if (!site) return;
    let h = await readSiteHealth(deps, site.key);
    if (e.type === "double_read_failed") {
      const what = (await pickLabel(deps, e.pickId)) ?? { match: "un match", bet: "le pari retenu" };
      // Un message par pari : la clé porte le pari (ou la mission).
      const key = `double:${e.pickId ?? e.missionId ?? now.toISOString()}`;
      const r = await tellKevin(deps, site.key, h, { key, variants: V.doubleReadFailed({ site: site.label, ...what }) }, now, { mediaAssetId: e.captureAssetId });
      h = r.health;
    } else if (e.type === "needs_human") {
      h = { ...h, lastCause: e.diagnosis };
      const to: SiteStatus = HUMAN_CAUSES.has(e.diagnosis) ? "BLOCKED" : (site.status as SiteStatus);
      if (to === "BLOCKED") {
        const applied = await applySiteStatus(deps, site, "BLOCKED", h, now);
        h = applied.health;
        if (!applied.change) {
          // Déjà bloqué : le geste est redit au plus toutes les 6 heures.
          const msg = statusMessage(site, "BLOCKED", { cause: e.diagnosis, consecutiveFailures: h.consecutiveFailures, ratio: null });
          if (msg) h = (await tellKevin(deps, site.key, h, msg, now)).health;
        }
        await syncBookmakerAlerts(deps, await listSites(deps), now, new Set(applied.change?.told ? [site.key] : []));
      }
    } else if (e.type === "switched_to_mac") {
      h = (await tellKevin(deps, site.key, h, { key: "switched_to_mac", variants: V.blockedGeo({ site: site.label }) }, now)).health;
    } else if (e.type === "relearn") {
      h = { ...h, lastRelearnAt: now.toISOString() };
      const msg = e.ok ? { key: "learn:ok", variants: V.learnDone({ site: site.label }) } : { key: "learn:failed", variants: V.learnFailed({ site: site.label, reason: e.message.slice(0, 120) || "raison inconnue" }) };
      h = (await tellKevin(deps, site.key, h, msg, now)).health;
    } else {
      return;
    }
    await writeSiteHealth(deps, site.key, h);
  };
}
