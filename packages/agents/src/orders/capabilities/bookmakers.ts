/**
 * Capacités « bookmakers lus directement » (phase 35, chantier D), équipe Paris sportifs, agent « Cotes & sélection ».
 * Lectures : `voir_matchs`, `etat_bookmakers`, `cote_de` (double lecture). Gestes : `tester_site` (connexion + une
 * lecture), `apprendre_site`, `ajouter_bookmaker`, `ouvrir_navigateur` (réglages durables : réservés à l'admin et
 * confirmés). Rien ici ne mise ni ne publie : le compte ne sert qu'à voir.
 */
import type { ActorRef } from "../../admin/team";
import { openVisibleBrowser, relearnSite, testAllSites, testSite } from "../../bookmakers/actions";
import { addSite, findSite, listSites, setSiteUrl } from "../../bookmakers/sites";
import { bookmakersStatusView, oddsOfView, siteMatchesView, type View } from "../../bookmakers/views";
import { isDaySlot, resolveDay } from "../view/common";
import type { AgentsDeps } from "../../types";
import type { OrderRow, OrderStep } from "../contract";
import { defineCapability, done, failed, nowFor, ok, readOnly, refuse, settingTouches, type CapSpec } from "./kit";

const T = "sports" as const;
const AGENTS = ["cotes"];

const actorOf = (order: Pick<OrderRow, "createdById">): ActorRef => ({ userId: order.createdById, via: "TELEGRAM" });

const site = { kind: "string", description: "Bookmaker tel que dit (Celsius, Sportaza, Bet Portal…)", optional: true, maxLength: 60 } as const;

/** Faits d'une vue pour les rapports (lignes = message de Kevin). */
function viewFacts(v: View) {
  return { ...v.facts, lignes: v.lines };
}

async function siteKnown(deps: AgentsDeps, raw: string | undefined) {
  if (!raw) return ok();
  const s = await findSite(deps, raw);
  if (s) return ok();
  const list = (await listSites(deps, { activeOnly: true })).map((x) => x.label);
  return refuse(`je ne lis pas « ${raw} » moi-même (bookmakers lus : ${list.join(", ") || "aucun"})`, []);
}

function readStep(key: string, summary: string, params: Record<string, unknown>): OrderStep {
  return { stepKey: key, capability: key, teamKey: T, summary, touches: readOnly(), params };
}

// ---------------------------------------------------------------------------------------------- voir_matchs

type MatchesP = { bookmaker?: string; jour?: string; moment?: string; ligue?: string; equipe?: string; marche?: string };
const matchesSpec: CapSpec = {
  bookmaker: site,
  jour: { kind: "string", description: "aujourdhui, demain, apres_demain ou AAAA-MM-JJ", optional: true, maxLength: 12 },
  moment: { kind: "enum", description: "matin, midi, apres-midi, soir, nuit", values: ["matin", "midi", "apres-midi", "soir", "nuit"], optional: true },
  ligue: { kind: "string", description: "Ligue (Ligue 1…)", optional: true, maxLength: 60 },
  equipe: { kind: "string", description: "Équipe (PSG…)", optional: true, maxLength: 60 },
  marche: { kind: "string", description: "Marché (corners, cartons…)", optional: true, maxLength: 60 },
};

async function matchesView(deps: AgentsDeps, p: MatchesP): Promise<View> {
  return siteMatchesView(deps, {
    site: p.bookmaker ?? null,
    day: resolveDay(nowFor(deps), p.jour ?? null),
    slot: isDaySlot(p.moment) ? p.moment : null,
    league: p.ligue ?? null,
    team: p.equipe ?? null,
    market: p.marche ?? null,
  });
}

export const voirMatchs = defineCapability<MatchesP>({
  teamKey: T,
  key: "voir_matchs",
  description: "Matchs lus sur le site d'un de nos bookmakers (par ligue, heure, nombre de marchés, cotes principales ; filtre ligue, équipe ou marché)",
  agents: AGENTS,
  spec: matchesSpec,
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    return siteKnown(deps, p.bookmaker);
  },
  async plan(_deps, p) {
    return [readStep("voir_matchs", `matchs chez ${p.bookmaker ?? "nos bookmakers"}`, { ...p })];
  },
  async run(deps, _order, step) {
    return done((await matchesView(deps, step.params as MatchesP)).lines.join("\n"));
  },
  async report(deps, order) {
    const p = ((order.interpretation as { steps?: Array<{ params?: MatchesP }> } | null)?.steps?.[0]?.params ?? {}) as MatchesP;
    return viewFacts(await matchesView(deps, p));
  },
});

// ---------------------------------------------------------------------------------------------- état

export const etatBookmakers = defineCapability<{ mac?: boolean }>({
  teamKey: T,
  key: "etat_bookmakers",
  description: "État de nos bookmakers lus directement (se lisent bien ou non, dernier succès, réussite sur 24 h) et du Mac qui lit",
  agents: AGENTS,
  spec: { mac: { kind: "bool", description: "true = seulement le Mac", optional: true } },
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan(_deps, p) {
    return [readStep("etat_bookmakers", "état des bookmakers", { mac: p.mac === true })];
  },
  async run(deps, _order, step) {
    return done((await bookmakersStatusView(deps, { macOnly: step.params.mac === true })).lines.join("\n"));
  },
  async report(deps) {
    return viewFacts(await bookmakersStatusView(deps));
  },
});

// ---------------------------------------------------------------------------------------------- cote_de

type OddsP = { bookmaker?: string; match: string; marche?: string; selection?: string };

export const coteDe = defineCapability<OddsP>({
  teamKey: T,
  key: "cote_de",
  description: "Cote d'un pari précis chez un de nos bookmakers, lue deux fois sur son site (identiques), avec l'heure de lecture",
  agents: AGENTS,
  spec: {
    bookmaker: site,
    match: { kind: "string", description: "Match ou équipe", maxLength: 80 },
    marche: { kind: "string", description: "Marché (résultat, corners…)", optional: true, maxLength: 60 },
    selection: { kind: "string", description: "Pari tel que dit (« PSG gagne »)", optional: true, maxLength: 80 },
  },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    return siteKnown(deps, p.bookmaker);
  },
  async plan(_deps, p) {
    return [readStep("cote_de", `cote de ${p.selection ?? p.match}`, { ...p })];
  },
  async run(deps, _order, step) {
    const p = step.params as OddsP;
    return done((await oddsOfView(deps, { site: p.bookmaker ?? null, match: p.match, market: p.marche ?? null, selection: p.selection ?? null })).lines.join("\n"));
  },
  async report() {
    // Une cote se relit au moment où on la demande (jamais un chiffre gardé dans un rapport).
    return {};
  },
});

// ---------------------------------------------------------------------------------------------- tester_site

type TestP = { bookmaker?: string; tous?: boolean };

export const testerSite = defineCapability<TestP>({
  teamKey: T,
  key: "tester_site",
  description: "Tester un de nos bookmakers (ou tous) : connexion au compte et une lecture des matchs, aucune mise",
  agents: AGENTS,
  spec: { bookmaker: site, tous: { kind: "bool", description: "true = tous les bookmakers", optional: true } },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    return p.tous ? ok() : siteKnown(deps, p.bookmaker);
  },
  async plan(_deps, p) {
    return [readStep("tester_site", p.tous ? "test de tous les bookmakers" : `test de ${p.bookmaker ?? "notre bookmaker"}`, { ...p })];
  },
  async run(deps, order, step) {
    const p = step.params as TestP;
    if (p.tous) {
      const r = await testAllSites(deps, actorOf(order));
      return r.queued.length ? done(`Test lancé sur ${r.queued.length} site${r.queued.length > 1 ? "s" : ""}.`) : failed("Aucun bookmaker à tester.");
    }
    const s = await findSite(deps, p.bookmaker ?? null);
    if (!s) return failed("Bookmaker introuvable.");
    const r = await testSite(deps, s.key, actorOf(order));
    return r.ok ? done(r.message) : failed(r.message);
  },
  async report(deps) {
    return viewFacts(await bookmakersStatusView(deps));
  },
});

// ---------------------------------------------------------------------------------------------- apprendre_site

type LearnP = { bookmaker: string; adresse?: string };

export const apprendreSite = defineCapability<LearnP>({
  teamKey: T,
  key: "apprendre_site",
  description: "Apprendre (ou réapprendre) à lire le site d'un de nos bookmakers, avec sa nouvelle adresse si elle est donnée",
  agents: AGENTS,
  spec: { bookmaker: { ...site, optional: false }, adresse: { kind: "string", description: "Nouvelle adresse du site", optional: true, maxLength: 200 } },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    return siteKnown(deps, p.bookmaker);
  },
  async plan(_deps, p) {
    return [{ stepKey: "apprendre_site", capability: "apprendre_site", teamKey: T, summary: `apprendre à lire ${p.bookmaker}${p.adresse ? ` (${p.adresse})` : ""}`, touches: settingTouches([]), params: { ...p } }];
  },
  async run(deps, order, step) {
    const p = step.params as LearnP;
    const s = await findSite(deps, p.bookmaker);
    if (!s) return failed("Bookmaker introuvable.");
    if (p.adresse) {
      const u = await setSiteUrl(deps, s.key, p.adresse, actorOf(order));
      if (!u.ok) return failed(u.message);
    }
    const r = await relearnSite(deps, s.key, actorOf(order));
    return r.ok ? done(r.message) : failed(r.message);
  },
  async report(deps) {
    return viewFacts(await bookmakersStatusView(deps));
  },
});

// ---------------------------------------------------------------------------------------------- ajouter_bookmaker

type AddP = { nom: string; adresse: string };

export const ajouterBookmaker = defineCapability<AddP>({
  teamKey: T,
  key: "ajouter_bookmaker",
  description: "Ajouter un bookmaker à lire (nom et adresse), avec les identifiants communs, puis l'apprendre",
  agents: AGENTS,
  spec: { nom: { kind: "string", description: "Nom du bookmaker", maxLength: 60 }, adresse: { kind: "string", description: "Adresse du site", maxLength: 200 } },
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan(_deps, p) {
    return [{ stepKey: "ajouter_bookmaker", capability: "ajouter_bookmaker", teamKey: T, summary: `ajouter le bookmaker ${p.nom} (${p.adresse})`, touches: settingTouches([]), params: { ...p } }];
  },
  async run(deps, order, step) {
    const p = step.params as AddP;
    const r = await addSite(deps, { label: p.nom, url: p.adresse }, { actor: actorOf(order) });
    if (!r.ok || !r.site) return failed(r.message);
    const l = await relearnSite(deps, r.site.key, actorOf(order));
    return done(`${r.message} ${l.message}`.trim());
  },
  async report(deps) {
    return viewFacts(await bookmakersStatusView(deps));
  },
});

// ---------------------------------------------------------------------------------------------- ouvrir_navigateur

export const ouvrirNavigateur = defineCapability<{ bookmaker?: string }>({
  teamKey: T,
  key: "ouvrir_navigateur",
  description: "Ouvrir le navigateur visible sur le Mac, sur le site d'un bookmaker (contrôle anti-robot, code de connexion)",
  agents: AGENTS,
  spec: { bookmaker: site },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    return siteKnown(deps, p.bookmaker);
  },
  async plan(_deps, p) {
    return [{ stepKey: "ouvrir_navigateur", capability: "ouvrir_navigateur", teamKey: T, summary: `ouvrir le navigateur sur le Mac (${p.bookmaker ?? "site bloqué"})`, touches: settingTouches([]), params: { ...p } }];
  },
  async run(deps, order, step) {
    const s = await findSite(deps, (step.params.bookmaker as string | undefined) ?? null);
    if (!s) return failed("Bookmaker introuvable.");
    const r = await openVisibleBrowser(deps, s.key, actorOf(order));
    return r.ok ? done(r.message) : failed(r.message, true);
  },
  async report(deps) {
    return viewFacts(await bookmakersStatusView(deps, { macOnly: true }));
  },
});

export const BOOKMAKER_CAPABILITIES = [voirMatchs, etatBookmakers, coteDe, testerSite, apprendreSite, ajouterBookmaker, ouvrirNavigateur];
