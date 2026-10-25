/**
 * Phase 35, chantier D — sites des bookmakers lus directement (`BookmakerSite`).
 * - `ensureDefaultSites` : crée les 3 sites du client (`DEFAULT_BOOKMAKER_SITES`), idempotent, ne touche jamais une
 *   adresse changée depuis (par Kevin ou le site) ;
 * - `addSite` : « ajoute le bookmaker X, c'est x.com » : clé dérivée du nom, adresse validée (https seulement, jamais
 *   d'identifiant dans l'adresse), puis apprentissage lancé (`startLearning`, sans attendre) ;
 * - `setSiteUrl` : nouvelle adresse d'un site (« Bet Portal c'est betportal.xx »), journalisée.
 * Les identifiants du compte ne passent jamais ici (voir `credentials.ts`).
 */
import { agentAudit, nowOf } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import type { AgentsDeps } from "../types";
import { DEFAULT_BOOKMAKER_SITES, type SiteStatus } from "./contract";

export type SiteRow = {
  key: string;
  label: string;
  baseUrl: string | null;
  sportsPath?: string | null;
  providerHint?: string | null;
  readTarget: string;
  isActive: boolean;
  status: string;
  statusReason?: string | null;
  lastReadAt?: Date | null;
  lastOkAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

const SITE_STATUSES: readonly SiteStatus[] = ["NEW", "LEARNING", "READY", "DEGRADED", "BLOCKED"];

export function isSiteStatus(v: unknown): v is SiteStatus {
  return typeof v === "string" && (SITE_STATUSES as readonly string[]).includes(v);
}

/** Clé d'un site depuis son nom (pur) : minuscules, sans accents ni espaces (« Bet Portal » → « betportal »). */
export function siteKeyFromLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 40);
}

/** Nom affiché propre (pur) : espaces réduits, 60 caractères au plus. */
export function cleanSiteLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, 60);
}

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Adresse d'un site (pur) : « x.com », « https://x.com/fr/sports ». Un domaine sans protocole reçoit `https://` ;
 * `http://`, une adresse IP, `localhost`, un port, un identifiant ou un mot de passe dans l'adresse sont refusés.
 */
export function normalizeSiteUrl(raw: string): UrlCheck {
  const v = (raw ?? "").trim();
  if (!v) return { ok: false, reason: "adresse vide" };
  if (v.length > 300) return { ok: false, reason: "adresse trop longue" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^https:\/\//i.test(v)) return { ok: false, reason: "seules les adresses https:// sont acceptées" };
  let u: URL;
  try {
    u = new URL(/^https:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    return { ok: false, reason: "adresse illisible" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "seules les adresses https:// sont acceptées" };
  if (u.username || u.password) return { ok: false, reason: "pas d'identifiant ni de mot de passe dans l'adresse" };
  if (u.port) return { ok: false, reason: "pas de port dans l'adresse" };
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return { ok: false, reason: "il faut le nom du site, pas une adresse de machine" };
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || !/\.[a-z]{2,}$/.test(host)) return { ok: false, reason: "nom de domaine invalide" };
  u.hash = "";
  u.search = "";
  return { ok: true, url: u.toString() };
}

export async function listSites(deps: Pick<AgentsDeps, "prisma">, opts: { activeOnly?: boolean } = {}): Promise<SiteRow[]> {
  return (await deps.prisma.bookmakerSite.findMany({ where: opts.activeOnly ? { isActive: true } : {}, orderBy: { createdAt: "asc" } })) as SiteRow[];
}

export async function getSite(deps: Pick<AgentsDeps, "prisma">, key: string): Promise<SiteRow | null> {
  return (await deps.prisma.bookmakerSite.findUnique({ where: { key } })) as SiteRow | null;
}

/**
 * Site désigné par un nom tel que dit (« Sportaza », « celsius », « bet portal », « betportal.com ») ; null si aucun
 * ou plusieurs (pur sur la liste fournie).
 */
export function matchSite(sites: readonly SiteRow[], raw: string | null | undefined): SiteRow | null {
  if (!raw) return sites.length === 1 ? sites[0]! : null;
  const host = /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.exec(raw.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, ""))?.[0];
  const k = siteKeyFromLabel(host ? host.split(".")[0]! : raw);
  if (!k) return null;
  const exact = sites.filter((s) => s.key === k || siteKeyFromLabel(s.label) === k);
  if (exact.length === 1) return exact[0]!;
  const loose = sites.filter((s) => s.key.startsWith(k) || k.startsWith(s.key));
  return loose.length === 1 ? loose[0]! : null;
}

export async function findSite(deps: Pick<AgentsDeps, "prisma">, raw: string | null | undefined): Promise<SiteRow | null> {
  return matchSite(await listSites(deps), raw);
}

/** Crée les sites du client absents ; un site existant n'est jamais modifié (adresse changée gardée). */
export async function ensureDefaultSites(deps: Pick<AgentsDeps, "prisma">): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const s of DEFAULT_BOOKMAKER_SITES) {
    if (await deps.prisma.bookmakerSite.findUnique({ where: { key: s.key } })) continue;
    try {
      await deps.prisma.bookmakerSite.create({
        data: { key: s.key, label: s.label, baseUrl: s.baseUrl, readTarget: "auto", isActive: true, status: "NEW" },
      });
      created.push(s.key);
    } catch (err) {
      // Course entre deux processus (site et worker) : l'autre l'a créé, rien à faire.
      if (!(await deps.prisma.bookmakerSite.findUnique({ where: { key: s.key } }))) throw err;
    }
  }
  return { created };
}

export type SiteResult = { ok: boolean; message: string; site?: SiteRow; learning?: boolean };

/** Nouvelle adresse d'un site (journalisée). L'état repasse à NEW : la méthode apprise visait l'ancienne adresse. */
export async function setSiteUrl(deps: AgentsDeps, key: string, url: string, actor: ActorRef | null = null): Promise<SiteResult> {
  const site = await getSite(deps, key);
  if (!site) return { ok: false, message: `Je ne connais pas le bookmaker « ${key} ».` };
  const u = normalizeSiteUrl(url);
  if (!u.ok) return { ok: false, message: `Adresse refusée : ${u.reason}.`, site };
  if (site.baseUrl === u.url) return { ok: true, message: `${site.label} a déjà cette adresse.`, site };
  const updated = (await deps.prisma.bookmakerSite.update({
    where: { key },
    data: { baseUrl: u.url, status: "NEW", statusReason: "nouvelle adresse : à réapprendre" },
  })) as SiteRow;
  await agentAudit(deps, {
    userId: actor?.userId ?? null,
    action: "bookmakers.url_changed",
    entityType: "BookmakerSite",
    entityId: key,
    metadata: { from: site.baseUrl, to: u.url, via: actor?.via ?? "SYSTEM" },
  });
  return { ok: true, message: `Adresse de ${site.label} : ${u.url}.`, site: updated };
}

// ---------------------------------------------------------------------------------------------- apprentissage

/** Apprentissages en cours dans ce processus (pas deux à la fois pour un même site). */
const learning = new Set<string>();
/** Un site en LEARNING depuis moins de 15 minutes est considéré en cours d'apprentissage (autre processus). */
export const LEARNING_STALE_MS = 15 * 60_000;

export type Learner = (deps: AgentsDeps, siteKey: string, opts: { reason: "first" | "repair" | "manual" }) => Promise<{ ok: boolean; status: SiteStatus; message: string }>;

export function isLearning(site: Pick<SiteRow, "key" | "status" | "updatedAt">, now: Date): boolean {
  if (learning.has(site.key)) return true;
  return site.status === "LEARNING" && !!site.updatedAt && now.getTime() - site.updatedAt.getTime() < LEARNING_STALE_MS;
}

/**
 * Lance l'apprentissage d'un site sans l'attendre (2 à 4 minutes de lecture guidée) ; `onDone` reçoit le résultat
 * (Kevin prévient). Rend `false` si un apprentissage est déjà en cours.
 */
export function startLearning(
  deps: AgentsDeps,
  site: Pick<SiteRow, "key" | "status" | "updatedAt">,
  learner: Learner,
  reason: "first" | "repair" | "manual",
  onDone?: (r: { ok: boolean; status: SiteStatus; message: string }) => Promise<void> | void,
): boolean {
  if (isLearning(site, nowOf(deps))) return false;
  learning.add(site.key);
  void (async () => {
    try {
      const r = await learner(deps, site.key, { reason });
      await onDone?.(r);
    } catch (err) {
      deps.logger?.warn({ site: site.key, err: (err as Error).message }, "[bookmakers] apprentissage en échec");
      await onDone?.({ ok: false, status: "BLOCKED", message: (err as Error).message.slice(0, 200) });
    } finally {
      learning.delete(site.key);
    }
  })();
  return true;
}

/** Tests : oublie les apprentissages en cours. */
export function resetLearning(): void {
  learning.clear();
}

/**
 * « ajoute le bookmaker X, c'est x.com » : crée le site (identifiants communs utilisés par défaut), puis lance
 * l'apprentissage si `learner` est fourni. Un site déjà connu garde sa clé ; une adresse différente le met à jour.
 */
export async function addSite(
  deps: AgentsDeps,
  input: { label: string; url: string },
  opts: { actor?: ActorRef | null; learner?: Learner | null; onLearned?: (r: { ok: boolean; status: SiteStatus; message: string }) => Promise<void> | void } = {},
): Promise<SiteResult> {
  const label = cleanSiteLabel(input.label);
  const key = siteKeyFromLabel(label);
  if (!key || key.length < 2) return { ok: false, message: "Il me faut le nom du bookmaker." };
  const u = normalizeSiteUrl(input.url);
  if (!u.ok) return { ok: false, message: `Adresse refusée : ${u.reason}.` };
  const existing = await getSite(deps, key);
  let site: SiteRow;
  if (existing) {
    if (existing.baseUrl !== u.url) {
      const r = await setSiteUrl(deps, key, u.url, opts.actor ?? null);
      if (!r.ok || !r.site) return r;
      site = r.site;
    } else site = existing;
    if (!existing.isActive) site = (await deps.prisma.bookmakerSite.update({ where: { key }, data: { isActive: true } })) as SiteRow;
  } else {
    site = (await deps.prisma.bookmakerSite.create({
      data: { key, label, baseUrl: u.url, readTarget: "auto", isActive: true, status: "NEW" },
    })) as SiteRow;
    await agentAudit(deps, {
      userId: opts.actor?.userId ?? null,
      action: "bookmakers.site_added",
      entityType: "BookmakerSite",
      entityId: key,
      metadata: { label, url: u.url, via: opts.actor?.via ?? "SYSTEM" },
    });
  }
  const started = opts.learner ? startLearning(deps, site, opts.learner, "first", opts.onLearned) : false;
  return { ok: true, message: existing ? `${site.label} était déjà connu.` : `${site.label} ajouté.`, site, learning: started };
}
