/**
 * Phase 35, chantier D — gestes sur un site de bookmaker, partagés par Kevin (catalogue et capacités) et le site
 * (page Agents → Bookmakers) : tester (connexion + une lecture), ouvrir le navigateur visible sur le Mac (contrôle
 * anti-robot, code de connexion), ré-apprendre, tester tous les sites. Chaque geste est journalisé (`AuditLog`).
 * Aucune mise, jamais : ces gestes ne font que déposer des travaux de LECTURE (`enqueueReadJob`, chantier A), exécutés
 * par le worker (ou le Mac) sous le verrou du site — jamais dans le processus du site web.
 * Le résultat est suivi (`followReadJob`) et Kevin le dit en une phrase, avec le geste à faire si ça ne passe pas.
 */
import { agentAudit, nowOf } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import type { AgentsDeps } from "../types";
import { BOOKMAKERS_VARIANTS as V } from "../boss/bookmakers-texts";
import { pick } from "../boss/voice";
import type { ReadTarget } from "./contract";
import { readBookmakerCredentialsFor, registerTestAllSites } from "./credentials";
import { HUMAN_CAUSES, failureCause, noteKevinMessage, statusMessage } from "./health";
import type { ReadJobRow } from "./jobs";
import { enqueueReadJob, macAlive, waitReadJob } from "./ops";
import { getSite, isLearning, listSites, type SiteRow } from "./sites";

export type GestureResult = { ok: boolean; message: string; jobId?: string | null };

/** Suivi du résultat d'un geste : `false` = pas de suivi (tests, appel déjà suivi ailleurs). */
export type FollowOptions =
  { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } | false;

/** Un test, un apprentissage ou un navigateur visible : 20 minutes au plus, relu toutes les 10 secondes. */
export const FOLLOW_TIMEOUT_MS = 20 * 60_000;
export const FOLLOW_POLL_MS = 10_000;

/** Cible d'un travail (pur) : `mac` si le site est lu par le Mac, sinon le serveur (qui bascule seul au besoin). */
export function targetOf(site: Pick<SiteRow, "readTarget">): ReadTarget {
  return site.readTarget === "mac" ? "mac" : "server";
}

function actorMeta(actor: ActorRef | null) {
  return { via: actor?.via ?? "SYSTEM" };
}

// ---------------------------------------------------------------------------------------------- résultat

export type JobOutcome = { ok: boolean; cause: string | null; message: string | null };

/** Valeur rendue par un travail (pur) : `result.value` (worker) ou `result` (Mac). */
function valueOf(row: Pick<ReadJobRow, "result">): Record<string, unknown> {
  const r = (row.result ?? {}) as Record<string, unknown>;
  const v = r.value && typeof r.value === "object" ? (r.value as Record<string, unknown>) : r;
  return v ?? {};
}

/** Issue d'un travail terminé (pur) : réussi, ou la cause lisible (contrôle anti-robot, Mac absent…). */
export function jobOutcome(row: Pick<ReadJobRow, "status" | "result">): JobOutcome {
  const v = valueOf(row);
  const message = typeof v.message === "string" ? v.message.slice(0, 200) : null;
  const failed =
    row.status === "FAILED" ||
    row.status === "NEEDS_HUMAN" ||
    v.ok === false ||
    typeof v.obstacle === "string";
  if (!failed) return { ok: true, cause: null, message };
  const obstacle = typeof v.obstacle === "string" ? v.obstacle : null;
  const cause =
    obstacle === "mac_absent" || obstacle === "mac_only"
      ? "mac_absent"
      : failureCause(
          obstacle ? { obstacle, message } : { message: message ?? String(v.status ?? "") },
        );
  return { ok: false, cause, message };
}

/** Raison d'un test raté en français courant (pur, sans jargon). */
export function testFailureReason(cause: string | null): string {
  const label: Record<string, string> = {
    maintenance: "le site est en maintenance",
    server_refused: "le site refuse notre serveur",
    empty: "la page du site est vide",
    site_changed: "le site a changé",
    night: "la lecture attend 7 h",
    no_transport: "aucun lecteur disponible (serveur refusé, Mac éteint)",
    abandoned: "le lecteur s'est arrêté avant la fin",
  };
  return (cause && label[cause]) || "le site n'a pas répondu comme prévu";
}

/** Phrase de Kevin pour un test terminé (pur). */
export function testResultText(site: Pick<SiteRow, "key" | "label">, o: JobOutcome): string {
  if (o.ok) return pick(V.testOk({ site: site.label }), `bookmakers.testOk.${site.key}`);
  if (o.cause === "mac_absent") return pick(V.browserNoMac, "bookmakers.browserNoMac");
  if (
    o.cause &&
    (HUMAN_CAUSES.has(o.cause) || ["moved", "geo_blocked", "logged_out"].includes(o.cause))
  ) {
    const msg = statusMessage(site, "BLOCKED", {
      cause: o.cause,
      consecutiveFailures: 0,
      ratio: null,
    });
    if (msg) return pick(msg.variants, `bookmakers.${msg.key}.${site.key}`);
  }
  return pick(
    V.testFailed({ site: site.label, reason: testFailureReason(o.cause) }),
    `bookmakers.testFailed.${site.key}`,
  );
}

/** Phrase de Kevin pour un apprentissage terminé (pur). `learnSite` rend `{ ok, status, message }`. */
export function learnResultText(
  site: Pick<SiteRow, "key" | "label">,
  row: Pick<ReadJobRow, "status" | "result">,
): { ok: boolean; text: string } {
  const v = valueOf(row);
  const ok = row.status === "DONE" && v.ok === true;
  if (ok)
    return {
      ok,
      text: pick(V.learnDone({ site: site.label }), `bookmakers.learnDone.${site.key}`),
    };
  const o = jobOutcome(row);
  if (o.cause === "mac_absent")
    return { ok, text: pick(V.browserNoMac, "bookmakers.browserNoMac") };
  const reason = (
    typeof v.message === "string" && v.message.trim() ? v.message : testFailureReason(o.cause)
  )
    .slice(0, 120)
    .replace(/\.$/, "");
  return {
    ok,
    text: pick(V.learnFailed({ site: site.label, reason }), `bookmakers.learnFailed.${site.key}`),
  };
}

/**
 * Suit un travail sans l'attendre (le geste répond tout de suite) ; à la fin, `onDone` reçoit la ligne (ou `null` si
 * rien après le délai). Une erreur de suivi ne remonte jamais.
 */
export function followReadJob(
  deps: AgentsDeps,
  jobId: string,
  onDone: (row: ReadJobRow | null) => Promise<void> | void,
  o: Exclude<FollowOptions, false> = {},
): Promise<void> {
  return (async () => {
    try {
      const row = await waitReadJob(deps, jobId, {
        timeoutMs: o.timeoutMs ?? FOLLOW_TIMEOUT_MS,
        pollMs: o.pollMs ?? FOLLOW_POLL_MS,
        ...(o.sleep ? { sleep: o.sleep } : {}),
      });
      await onDone(row);
    } catch (err) {
      deps.logger?.warn(
        { jobId, err: (err as Error).message },
        "[bookmakers] suivi d'un geste impossible",
      );
    }
  })();
}

async function tell(
  deps: AgentsDeps,
  siteKey: string,
  text: string,
  key: string | null,
): Promise<void> {
  if (!deps.admin) return;
  const sent = await deps.admin.send(text).catch(() => null);
  if (sent && key) await noteKevinMessage(deps, siteKey, key, nowOf(deps)).catch(() => undefined);
}

/** Les suivis lancés (tests : `await Promise.all(pendingFollows())`). */
const follows = new Set<Promise<void>>();
export function pendingFollows(): Promise<void>[] {
  return [...follows];
}
function track(p: Promise<void>): void {
  follows.add(p);
  void p.finally(() => follows.delete(p));
}

// ---------------------------------------------------------------------------------------------- gestes

/** « teste Sportaza » : connexion avec les identifiants (propres ou communs) et une lecture des matchs. */
export async function testSite(
  deps: AgentsDeps,
  siteKey: string,
  actor: ActorRef | null,
  opts: { follow?: FollowOptions } = {},
): Promise<GestureResult> {
  const site = await getSite(deps, siteKey);
  if (!site) return { ok: false, message: `Bookmaker inconnu : ${siteKey}.` };
  if (!site.baseUrl)
    return { ok: false, message: pick(V.siteNoUrl({ site: site.label }), "bookmakers.siteNoUrl") };
  if (!(await readBookmakerCredentialsFor(deps, site.key)))
    return { ok: false, message: pick(V.noCredentials, "bookmakers.noCredentials") };
  const target = targetOf(site);
  const job = await enqueueReadJob(deps, {
    siteKey: site.key,
    kind: "test",
    target,
    params: { notify: "kevin", reason: "test demandé" },
  });
  await agentAudit(deps, {
    userId: actor?.userId ?? null,
    action: "bookmakers.site_tested",
    entityType: "BookmakerSite",
    entityId: site.key,
    metadata: { ...actorMeta(actor), jobId: job.id, target },
  });
  if (opts.follow !== false)
    track(
      followReadJob(
        deps,
        job.id,
        async (row) => {
          if (!row)
            return tell(
              deps,
              site.key,
              pick(V.testTimeout({ site: site.label }), `bookmakers.testTimeout.${site.key}`),
              null,
            );
          const o = jobOutcome(row);
          const key = o.ok
            ? null
            : (statusMessage(site, "BLOCKED", {
                cause: o.cause,
                consecutiveFailures: 0,
                ratio: null,
              })?.key ?? null);
          await tell(deps, site.key, testResultText(site, o), key);
        },
        opts.follow,
      ),
    );
  return {
    ok: true,
    message: pick(
      V.testStarted({ site: site.label, mac: target === "mac" }),
      "bookmakers.testStarted",
    ),
    jobId: job.id,
  };
}

/** « ouvre le navigateur sur le Mac » : navigateur visible, l'humain passe le contrôle ou tape le code. */
export async function openVisibleBrowser(
  deps: AgentsDeps,
  siteKey: string,
  actor: ActorRef | null,
  opts: { follow?: FollowOptions } = {},
): Promise<GestureResult> {
  const site = await getSite(deps, siteKey);
  if (!site) return { ok: false, message: `Bookmaker inconnu : ${siteKey}.` };
  if (!site.baseUrl)
    return { ok: false, message: pick(V.siteNoUrl({ site: site.label }), "bookmakers.siteNoUrl") };
  const alive = await macAlive(deps);
  const job = await enqueueReadJob(deps, {
    siteKey: site.key,
    kind: "visible",
    target: "mac",
    params: { url: site.baseUrl, reason: "demande de l'admin" },
  });
  await agentAudit(deps, {
    userId: actor?.userId ?? null,
    action: "bookmakers.browser_opened",
    entityType: "BookmakerSite",
    entityId: site.key,
    metadata: { ...actorMeta(actor), jobId: job.id, macAlive: alive },
  });
  if (!alive)
    return { ok: false, message: pick(V.browserNoMac, "bookmakers.browserNoMac"), jobId: job.id };
  if (opts.follow !== false)
    track(
      followReadJob(
        deps,
        job.id,
        async (row) => {
          // Rien après 20 minutes : la personne n'est pas venue, la santé redira le geste plus tard.
          if (!row) return;
          const o = jobOutcome(row);
          await tell(
            deps,
            site.key,
            o.ok
              ? pick(V.browserDone({ site: site.label }), `bookmakers.browserDone.${site.key}`)
              : testResultText(site, o),
            null,
          );
        },
        opts.follow,
      ),
    );
  return {
    ok: true,
    message: pick(V.browserStarted({ site: site.label }), "bookmakers.browserStarted"),
    jobId: job.id,
  };
}

/** Un apprentissage est-il déjà demandé ou en cours pour ce site (travail en attente / pris, ou état LEARNING) ? */
export async function learningOpen(
  deps: AgentsDeps,
  site: Pick<SiteRow, "key" | "status" | "updatedAt">,
): Promise<boolean> {
  if (isLearning(site, nowOf(deps))) return true;
  return !!(await deps.prisma.bookmakerReadJob.findFirst({
    where: { siteKey: site.key, kind: "learn", status: { in: ["PENDING", "CLAIMED"] } },
  }));
}

/**
 * « apprends le site Celsius » / « Ré-apprendre » : travail `learn` déposé pour le worker (2 à 4 minutes de lecture
 * guidée sous le verrou du site) ; Kevin prévient à la fin (prêt, ou échec avec la raison).
 */
export async function relearnSite(
  deps: AgentsDeps,
  siteKey: string,
  actor: ActorRef | null,
  opts: { notify?: boolean; follow?: FollowOptions } = {},
): Promise<GestureResult> {
  const site = await getSite(deps, siteKey);
  if (!site) return { ok: false, message: `Bookmaker inconnu : ${siteKey}.` };
  if (!site.baseUrl)
    return { ok: false, message: pick(V.siteNoUrl({ site: site.label }), "bookmakers.siteNoUrl") };
  if (!(await readBookmakerCredentialsFor(deps, site.key)))
    return { ok: false, message: pick(V.noCredentials, "bookmakers.noCredentials") };
  if (await learningOpen(deps, site)) {
    await agentAudit(deps, {
      userId: actor?.userId ?? null,
      action: "bookmakers.relearn_requested",
      entityType: "BookmakerSite",
      entityId: site.key,
      metadata: { ...actorMeta(actor), started: false },
    });
    return {
      ok: true,
      message: pick(V.learnAlready({ site: site.label }), "bookmakers.learnAlready"),
    };
  }
  const target = targetOf(site);
  const job = await enqueueReadJob(deps, {
    siteKey: site.key,
    kind: "learn",
    target,
    params: { reason: "manual" },
  });
  await agentAudit(deps, {
    userId: actor?.userId ?? null,
    action: "bookmakers.relearn_requested",
    entityType: "BookmakerSite",
    entityId: site.key,
    metadata: { ...actorMeta(actor), started: true, jobId: job.id, target },
  });
  if (opts.notify !== false && opts.follow !== false)
    track(
      followReadJob(
        deps,
        job.id,
        async (row) => {
          if (!row) return;
          const r = learnResultText(site, row);
          await tell(deps, site.key, r.text, r.ok ? "learn:ok" : "learn:failed");
        },
        opts.follow,
      ),
    );
  return {
    ok: true,
    message: pick(V.learnStarted({ site: site.label }), "bookmakers.learnStarted"),
    jobId: job.id,
  };
}

/** « teste les bookmakers » : un test par site actif qui a une adresse et des identifiants. */
export async function testAllSites(
  deps: AgentsDeps,
  actor: ActorRef | null,
  opts: { follow?: FollowOptions } = {},
): Promise<{ queued: string[]; skipped: string[] }> {
  const queued: string[] = [];
  const skipped: string[] = [];
  for (const s of await listSites(deps, { activeOnly: true })) {
    const r = s.baseUrl ? await testSite(deps, s.key, actor, opts) : { ok: false, message: "" };
    (r.ok ? queued : skipped).push(s.key);
  }
  return { queued, skipped };
}

registerTestAllSites((deps, actor) => testAllSites(deps, actor));
