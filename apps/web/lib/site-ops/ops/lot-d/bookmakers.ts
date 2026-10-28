/**
 * Phase 34, lot D — cœurs de la page Agents → Bookmakers (phase 35), administrateurs seulement : « Tester »,
 * « Ré-apprendre », « Ouvrir le navigateur sur le Mac », « Changer l'adresse ». Ils ne déposent que des LECTURES pour
 * le service d'arrière-plan (ou le Mac) : jamais de mise. Le journal est écrit par les fonctions des agents (`via`).
 * Mêmes vérifications préalables que la page (adresse renseignée, identifiants présents), que Kevin passe aussi.
 */
import { openVisibleBrowser, relearnSite, setSiteUrl, testSite } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { canManageBookmakers, safeSiteKey } from "@/lib/agents/bookmakers";
import { engineActor, errorText, fail, forbidden, formOf, ok, preview, str, type Fail, type SiteOpActor, type SiteOpResult, type SiteOpRunOptions } from "./kit";

type Site = { key: string; label: string; baseUrl: string | null };

const db = () =>
  prisma as unknown as {
    bookmakerSite: { findUnique(a: unknown): Promise<Site | null>; update(a: unknown): Promise<unknown> };
    setting: { findMany(a: unknown): Promise<Array<{ key: string }>> };
  };

const NO_CREDENTIALS =
  "Il manque les identifiants des comptes bookmakers : écrivez « identifiants bookmakers » à Kevin, il vous les demande en privé.";
const NO_URL = "Il manque l'adresse du site : renseignez-la d'abord (Changer l'adresse).";
const NO_MAC = "Le Mac ne lit pas en ce moment : allumez-le et ouvrez la session, puis recommencez.";

async function guard(fd: FormData, actor: SiteOpActor, what: string): Promise<{ ok: true; site: Site } | { ok: false; result: Fail }> {
  if (!canManageBookmakers(actor.role)) return { ok: false, result: forbidden(`${what} est réservé aux administrateurs.`) };
  const key = safeSiteKey(fd.get("siteKey"));
  const site = key ? await db().bookmakerSite.findUnique({ where: { key }, select: { key: true, label: true, baseUrl: true } }) : null;
  if (!site) return { ok: false, result: fail("Bookmaker inconnu : rechargez la page.", "not_found", "siteKey") };
  return { ok: true, site };
}

async function hasCredentials(key: string): Promise<boolean> {
  const rows = await db().setting.findMany({
    where: {
      key: {
        in: [`agents.secret.providers.bookmakers.${key}.login`, "agents.secret.providers.bookmakers.default.credentials"],
      },
    },
    select: { key: true },
  });
  return rows.length > 0;
}

type Run = (fd: FormData, actor: SiteOpActor, opts?: SiteOpRunOptions) => Promise<SiteOpResult>;

export const runTestSite: Run = async (fd, actor, opts = {}) => {
  const g = await guard(fd, actor, "Tester un bookmaker");
  if (!g.ok) return g.result;
  const { site } = g;
  if (!site.baseUrl) return fail(NO_URL, "invalid", "url");
  if (!(await hasCredentials(site.key))) return fail(NO_CREDENTIALS, "unavailable");
  if (opts.dryRun) return preview(`Test de ${site.label} : connexion et une lecture des matchs, aucune mise.`);
  try {
    const r = await testSite(buildAgentsDeps(), site.key, engineActor(actor));
    if (!r.ok) return fail(`Test impossible pour ${site.label} pour l'instant.`, "unavailable");
  } catch (err) {
    return fail(`Test impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  return ok(
    `Test de ${site.label} lancé (connexion et une lecture des matchs, aucune mise) : Kevin vous donne le résultat sur Telegram dans quelques minutes.`,
  );
};

export const runRelearnSite: Run = async (fd, actor, opts = {}) => {
  const g = await guard(fd, actor, "Ré-apprendre un bookmaker");
  if (!g.ok) return g.result;
  const { site } = g;
  if (!site.baseUrl) return fail(NO_URL, "invalid", "url");
  if (!(await hasCredentials(site.key))) return fail(NO_CREDENTIALS, "unavailable");
  if (opts.dryRun) return preview(`Apprentissage de ${site.label} : quelques minutes, aucune mise.`);
  try {
    const r = await relearnSite(buildAgentsDeps(), site.key, engineActor(actor));
    if (!r.ok) return fail(`Apprentissage impossible pour ${site.label} pour l'instant.`, "unavailable");
  } catch (err) {
    return fail(`Apprentissage impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  return ok(`Apprentissage de ${site.label} demandé : quelques minutes. Kevin vous prévient sur Telegram quand c'est prêt.`);
};

export const runOpenBrowser: Run = async (fd, actor, opts = {}) => {
  const g = await guard(fd, actor, "Ouvrir le navigateur sur le Mac");
  if (!g.ok) return g.result;
  const { site } = g;
  if (!site.baseUrl) return fail(NO_URL, "invalid", "url");
  if (opts.dryRun) return preview(`Le navigateur s'ouvrira sur le Mac, sur ${site.label}.`);
  try {
    const r = await openVisibleBrowser(buildAgentsDeps(), site.key, engineActor(actor));
    if (!r.ok) return fail(NO_MAC, "unavailable");
  } catch (err) {
    return fail(`Navigateur impossible à ouvrir pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  return ok(
    `Le navigateur s'ouvre sur le Mac, sur ${site.label} : passez le contrôle ou tapez le code, puis laissez la fenêtre. La lecture reprend toute seule.`,
  );
};

export const runSetSiteUrl: Run = async (fd, actor, opts = {}) => {
  const g = await guard(fd, actor, "Changer l'adresse d'un bookmaker");
  if (!g.ok) return g.result;
  const { site } = g;
  const url = str(fd.get("url")).trim();
  if (!url) return fail("Indiquez l'adresse du site.", "invalid", "url");
  if (opts.dryRun) return preview(`Nouvelle adresse de ${site.label} : ${url}.`);
  try {
    const r = await setSiteUrl(buildAgentsDeps(), site.key, url, engineActor(actor));
    if (!r.ok) return fail(r.message);
    return ok(
      r.site?.baseUrl === site.baseUrl
        ? `${site.label} a déjà cette adresse.`
        : `Nouvelle adresse de ${site.label} enregistrée : cliquez sur « Ré-apprendre » pour qu'il la lise.`,
    );
  } catch (err) {
    return fail(`Adresse impossible à enregistrer : ${errorText(err)}.`, "unavailable");
  }
};

export const runSetSiteTarget: Run = async (fd, actor, opts = {}) => {
  const g = await guard(fd, actor, "Changer la cible de lecture d'un bookmaker");
  if (!g.ok) return g.result;
  const { site } = g;
  const target = str(fd.get("target")).trim();
  if (!["auto", "server", "mac", "human"].includes(target)) return fail("Cible invalide : « auto », « server », « mac » ou « human ».", "invalid", "target");
  if (target === "human") {
    if (opts.dryRun) return preview(`${site.label} : l'équipe enverra la capture et la cote de chaque pari, le site ne sera plus lu.`);
    await db().bookmakerSite.update({ where: { key: site.key }, data: { readTarget: target } });
    return ok(`${site.label} n'est plus lu : pour chaque pari, je demanderai la capture et la cote à l'équipe.`);
  }
  if (opts.dryRun) return preview(`${site.label} lira depuis : ${target === "server" ? "le serveur" : target === "mac" ? "le Mac" : "le serveur puis le Mac"}.`);
  await db().bookmakerSite.update({ where: { key: site.key }, data: { readTarget: target } });
  return ok(`${site.label} lit maintenant depuis ${target === "server" ? "le serveur" : target === "mac" ? "le Mac" : "le serveur (Mac en secours)"}.`);
};

export const runToggleSiteActive: Run = async (fd, actor, opts = {}) => {
  const g = await guard(fd, actor, "Activer ou mettre en pause un bookmaker");
  if (!g.ok) return g.result;
  const { site } = g;
  const active = str(fd.get("active")).trim();
  if (!["true", "false"].includes(active)) return fail("Valeur invalide : « true » ou « false ».", "invalid", "active");
  const isActive = active === "true";
  if (opts.dryRun) return preview(`${site.label} sera ${isActive ? "activé" : "mis en pause"}.`);
  await db().bookmakerSite.update({ where: { key: site.key }, data: { isActive } });
  return ok(`${site.label} est ${isActive ? "activé : la lecture reprend" : "en pause : la lecture s'arrête"}.`);
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

type In = Record<string, unknown>;

/** Bookmaker par nom affiché ou clé (« Sportaza ») ; `url` pour « Changer l'adresse ». */
export async function kevinSiteForm(input: In): Promise<{ ok: true; fd: FormData } | { ok: false; result: Fail }> {
  const { resolveBookmakerSite } = await import("./resolve");
  const r = await resolveBookmakerSite(input.bookmaker ?? input.siteKey);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ siteKey: r.id, url: input.url ?? input.adresse }) };
}

/** Bookmaker + cible de lecture (« server », « mac », « auto »). */
export async function kevinSiteTargetForm(input: In): Promise<{ ok: true; fd: FormData } | { ok: false; result: Fail }> {
  const { resolveBookmakerSite } = await import("./resolve");
  const r = await resolveBookmakerSite(input.bookmaker ?? input.siteKey);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ siteKey: r.id, target: input.target ?? input.cible }) };
}

/** Bookmaker + activation (true / false). */
export async function kevinSiteActiveForm(input: In): Promise<{ ok: true; fd: FormData } | { ok: false; result: Fail }> {
  const { resolveBookmakerSite } = await import("./resolve");
  const r = await resolveBookmakerSite(input.bookmaker ?? input.siteKey);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ siteKey: r.id, active: String(input.activer ?? input.active ?? true) }) };
}
