/**
 * Phase 35, chantier D — gestes sur un site de bookmaker, partagés par Kevin (catalogue et capacités) et le site
 * (page Agents → Bookmakers) : tester (connexion + une lecture), ouvrir le navigateur visible sur le Mac (contrôle
 * anti-robot, code de connexion), ré-apprendre, tester tous les sites. Chaque geste est journalisé (`AuditLog`).
 * Aucune mise, jamais : ces gestes ne font que déposer des travaux de LECTURE (`enqueueReadJob`, chantier A).
 */
import { agentAudit } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import type { AgentsDeps } from "../types";
import { BOOKMAKERS_VARIANTS as V } from "../boss/bookmakers-texts";
import { pick } from "../boss/voice";
import type { ReadTarget, SiteStatus } from "./contract";
import { readBookmakerCredentialsFor, registerTestAllSites } from "./credentials";
import { enqueueReadJob, learnSite, macAlive } from "./ops";
import { getSite, listSites, startLearning, type SiteRow } from "./sites";

export type GestureResult = { ok: boolean; message: string; jobId?: string | null };

/** Cible d'un travail (pur) : `mac` si le site est lu par le Mac, sinon le serveur (qui bascule seul au besoin). */
export function targetOf(site: Pick<SiteRow, "readTarget">): ReadTarget {
  return site.readTarget === "mac" ? "mac" : "server";
}

function actorMeta(actor: ActorRef | null) {
  return { via: actor?.via ?? "SYSTEM" };
}

/** Message de Kevin à la fin d'un apprentissage lancé par un geste (prêt, ou échec avec la raison). */
export function learnNotifier(deps: AgentsDeps, site: Pick<SiteRow, "key" | "label">) {
  return async (r: { ok: boolean; status: SiteStatus; message: string }) => {
    const text = r.ok
      ? pick(V.learnDone({ site: site.label }), `bookmakers.learnDone.${site.key}`)
      : pick(V.learnFailed({ site: site.label, reason: (r.message || "raison inconnue").slice(0, 120) }), `bookmakers.learnFailed.${site.key}`);
    await deps.admin?.send(text).catch(() => null);
  };
}

/** « teste Sportaza » : connexion avec les identifiants (propres ou communs) et une lecture des matchs. */
export async function testSite(deps: AgentsDeps, siteKey: string, actor: ActorRef | null): Promise<GestureResult> {
  const site = await getSite(deps, siteKey);
  if (!site) return { ok: false, message: `Bookmaker inconnu : ${siteKey}.` };
  if (!site.baseUrl) return { ok: false, message: pick(V.siteNoUrl({ site: site.label }), "bookmakers.siteNoUrl") };
  if (!(await readBookmakerCredentialsFor(deps, site.key))) return { ok: false, message: pick(V.noCredentials, "bookmakers.noCredentials") };
  const target = targetOf(site);
  const job = await enqueueReadJob(deps, { siteKey: site.key, kind: "test", target, params: { notify: "kevin", reason: "test demandé" } });
  await agentAudit(deps, { userId: actor?.userId ?? null, action: "bookmakers.site_tested", entityType: "BookmakerSite", entityId: site.key, metadata: { ...actorMeta(actor), jobId: job.id, target } });
  return { ok: true, message: pick(V.testStarted({ site: site.label, mac: target === "mac" }), "bookmakers.testStarted"), jobId: job.id };
}

/** « ouvre le navigateur sur le Mac » : navigateur visible, l'humain passe le contrôle ou tape le code. */
export async function openVisibleBrowser(deps: AgentsDeps, siteKey: string, actor: ActorRef | null): Promise<GestureResult> {
  const site = await getSite(deps, siteKey);
  if (!site) return { ok: false, message: `Bookmaker inconnu : ${siteKey}.` };
  if (!site.baseUrl) return { ok: false, message: pick(V.siteNoUrl({ site: site.label }), "bookmakers.siteNoUrl") };
  const alive = await macAlive(deps);
  const job = await enqueueReadJob(deps, { siteKey: site.key, kind: "visible", target: "mac", params: { url: site.baseUrl, reason: "demande de l'admin" } });
  await agentAudit(deps, { userId: actor?.userId ?? null, action: "bookmakers.browser_opened", entityType: "BookmakerSite", entityId: site.key, metadata: { ...actorMeta(actor), jobId: job.id, macAlive: alive } });
  if (!alive) return { ok: false, message: pick(V.browserNoMac, "bookmakers.browserNoMac"), jobId: job.id };
  return { ok: true, message: pick(V.browserStarted({ site: site.label }), "bookmakers.browserStarted"), jobId: job.id };
}

/** « apprends le site Celsius » / « Ré-apprendre » : lancé sans attendre, Kevin prévient à la fin. */
export async function relearnSite(deps: AgentsDeps, siteKey: string, actor: ActorRef | null, opts: { notify?: boolean } = {}): Promise<GestureResult> {
  const site = await getSite(deps, siteKey);
  if (!site) return { ok: false, message: `Bookmaker inconnu : ${siteKey}.` };
  if (!site.baseUrl) return { ok: false, message: pick(V.siteNoUrl({ site: site.label }), "bookmakers.siteNoUrl") };
  if (!(await readBookmakerCredentialsFor(deps, site.key))) return { ok: false, message: pick(V.noCredentials, "bookmakers.noCredentials") };
  const started = startLearning(deps, site, learnSite, "manual", opts.notify === false ? undefined : learnNotifier(deps, site));
  await agentAudit(deps, { userId: actor?.userId ?? null, action: "bookmakers.relearn_requested", entityType: "BookmakerSite", entityId: site.key, metadata: { ...actorMeta(actor), started } });
  return started
    ? { ok: true, message: pick(V.learnStarted({ site: site.label }), "bookmakers.learnStarted") }
    : { ok: true, message: pick(V.learnAlready({ site: site.label }), "bookmakers.learnAlready") };
}

/** « teste les bookmakers » : un test par site actif qui a une adresse et des identifiants. */
export async function testAllSites(deps: AgentsDeps, actor: ActorRef | null): Promise<{ queued: string[]; skipped: string[] }> {
  const queued: string[] = [];
  const skipped: string[] = [];
  for (const s of await listSites(deps, { activeOnly: true })) {
    const r = s.baseUrl ? await testSite(deps, s.key, actor) : { ok: false, message: "" };
    (r.ok ? queued : skipped).push(s.key);
  }
  return { queued, skipped };
}

registerTestAllSites(testAllSites);
