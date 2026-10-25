/**
 * Phase 35, chantier D — entrées du catalogue de Kevin sur les bookmakers lus directement (Celsius, Sportaza, Bet
 * Portal et ceux ajoutés par une phrase). Toujours par les fonctions de `bookmakers/*` ; jamais de mise.
 * - lectures (permises aux membres présentés) : `voir_matchs`, `etat_bookmakers`, `cote_de` ;
 * - réservées à l'admin : `tester_site` (remplace `test_bookmaker`, gardé comme ancien nom : connexion + une lecture),
 *   `apprendre_site`, `ajouter_bookmaker`, `ouvrir_navigateur`, `identifiants_bookmakers`.
 * Lecteur pour `voir_matchs_bookmaker` (phase 33) : `registerBookmakerMatchLister` pour chaque site du client.
 */
import { esc, nowOf } from "../admin/journal";
import { addSite, findSite, getSite, listSites, setSiteUrl } from "../bookmakers/sites";
import { relearnSite, testAllSites, testSite, openVisibleBrowser } from "../bookmakers/actions";
import { askBookmakerCredentials, readBookmakerCredentialsFor } from "../bookmakers/credentials";
import {
  bookmakersStatusView,
  oddsOfView,
  resolveSiteView,
  siteMatchesView,
  type View,
} from "../bookmakers/views";
import { DEFAULT_BOOKMAKER_SITES } from "../bookmakers/contract";
import { readEvents } from "../bookmakers/ops";
import { registerBookmakerMatchLister } from "../orders/view/matches";
import { isDaySlot, resolveDay } from "../orders/view/common";
import type { BossAction, BossActor, BossDeps, BossReply } from "./contract";
import { defineAction } from "./catalog-kit";
import { registerBookmakerSiteView, viewReply } from "./catalog-view";
import { bool, oneOf, str } from "./params";
import { BOSS_ADMIN_ONLY_KEYS, BOSS_READ_KEYS } from "./team/rights";
import { BOOKMAKERS_VARIANTS as V } from "./bookmakers-texts";
import { pick } from "./voice";

const JOURS = ["aujourdhui", "demain", "apres_demain", "hier"] as const;
const MOMENTS = ["matin", "midi", "apres-midi", "soir", "nuit"] as const;

const siteField = (optional = true) =>
  str("Nom du bookmaker tel que dit (Celsius, Sportaza, Bet Portal…)", { optional, maxLength: 60 });
const detailField = bool("Vrai si l'admin a demandé le détail complet", true);

const actorOf = (a: BossActor) => ({ userId: a.userId, via: "TELEGRAM" as const });
const say = (variants: readonly string[], key: string) => pick(variants, `bookmakers.${key}`);
const text = (s: string): BossReply => ({ reply: esc(s) });

function reply(deps: BossDeps, key: string, v: View, detail = false): BossReply {
  return viewReply(deps, key, v, detail);
}

/** Site désigné (ou seul site) ; sinon la réponse qui dit lequel choisir. */
async function siteOr(
  deps: BossDeps,
  raw: string | undefined,
): Promise<{ key: string; label: string } | BossReply> {
  const r = await resolveSiteView(deps, raw ?? null);
  if ("view" in r) return reply(deps, "site", r.view);
  return r.site;
}
const isReply = (x: unknown): x is BossReply => !!x && typeof x === "object" && !("key" in x);

// ---------------------------------------------------------------------------------------------- voir_matchs

type MatchesP = {
  bookmaker?: string;
  jour?: (typeof JOURS)[number];
  date?: string;
  moment?: (typeof MOMENTS)[number];
  ligue?: string;
  equipe?: string;
  marche?: string;
  detail?: boolean;
};

export const voirMatchs = defineAction<MatchesP>({
  key: "voir_matchs",
  description:
    "Lister les matchs lus sur le site d'un de nos bookmakers (Celsius, Sportaza, Bet Portal) : par ligue, heure, marchés, cotes ; filtre équipe ou marché",
  theme: "paris",
  cls: "immediate",
  spec: {
    bookmaker: siteField(),
    jour: oneOf("Jour : aujourdhui (défaut), demain, apres_demain ou hier", JOURS, true),
    date: str("Date précise AAAA-MM-JJ (facultatif)", { optional: true, maxLength: 10 }),
    moment: oneOf("Moment : matin, midi, apres-midi, soir, nuit", MOMENTS, true),
    ligue: str("Ligue (Ligue 1, Premier League…)", { optional: true, maxLength: 60 }),
    equipe: str("Équipe (PSG, OM…)", { optional: true, maxLength: 60 }),
    marche: str("Marché demandé (corners, cartons, buts…)", { optional: true, maxLength: 60 }),
    detail: detailField,
  },
  async execute(deps, p) {
    const day = resolveDay(
      nowOf(deps),
      p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : (p.jour ?? null),
    );
    const v = await siteMatchesView(deps, {
      site: p.bookmaker ?? null,
      day,
      slot: isDaySlot(p.moment) ? p.moment : null,
      league: p.ligue ?? null,
      team: p.equipe ?? null,
      market: p.marche ?? null,
    });
    return reply(deps, "voir_matchs", v, p.detail);
  },
});

// ---------------------------------------------------------------------------------------------- état

export const etatBookmakers = defineAction<{ mac?: boolean }>({
  key: "etat_bookmakers",
  description:
    "Dire si nos bookmakers se lisent bien (état, dernier succès, réussite sur 24 h) et si le Mac lit",
  theme: "paris",
  cls: "immediate",
  spec: { mac: bool("Vrai si la question porte seulement sur le Mac (« le Mac lit ? »)", true) },
  async execute(deps, p) {
    return reply(
      deps,
      "etat_bookmakers",
      await bookmakersStatusView(deps, { macOnly: p.mac === true }),
      true,
    );
  },
});

// ---------------------------------------------------------------------------------------------- cote_de

type OddsP = { bookmaker?: string; match: string; marche?: string; selection?: string };

export const coteDe = defineAction<OddsP>({
  key: "cote_de",
  description:
    "Donner la cote d'un pari précis chez un de nos bookmakers, lue deux fois sur son site, avec l'heure",
  theme: "paris",
  cls: "immediate",
  spec: {
    bookmaker: siteField(),
    match: str("Match ou équipe (« PSG », « PSG - OM »)", { maxLength: 80 }),
    marche: str("Marché (résultat, corners, buts…)", { optional: true, maxLength: 60 }),
    selection: str("Pari tel que dit (« PSG gagne », « plus de 2,5 buts », « nul »)", {
      optional: true,
      maxLength: 80,
    }),
  },
  async execute(deps, p) {
    return reply(
      deps,
      "cote_de",
      await oddsOfView(deps, {
        site: p.bookmaker ?? null,
        match: p.match,
        market: p.marche ?? null,
        selection: p.selection ?? null,
      }),
    );
  },
});

// ---------------------------------------------------------------------------------------------- tester_site

type TestP = { bookmaker?: string; tous?: boolean };

async function testExecute(deps: BossDeps, p: TestP, actor: BossActor): Promise<BossReply> {
  if (p.tous || (p.bookmaker && /^(tous|toutes|les bookmakers|tout)$/i.test(p.bookmaker.trim()))) {
    const r = await testAllSites(deps, actorOf(actor));
    return text(
      r.queued.length
        ? say(V.testAllStarted({ n: r.queued.length }), "testAllStarted")
        : say(V.testAllNothing, "testAllNothing"),
    );
  }
  const s = await siteOr(deps, p.bookmaker);
  if (isReply(s)) return s;
  return text((await testSite(deps, s.key, actorOf(actor))).message);
}

const testSpec = {
  bookmaker: siteField(),
  tous: bool("Vrai pour tester tous les bookmakers d'un coup", true),
};

export const testerSite = defineAction<TestP>({
  key: "tester_site",
  description:
    "Tester un de nos bookmakers (ou tous) : connexion au compte et une lecture des matchs, aucune mise ; résultat par message",
  theme: "paris",
  cls: "immediate",
  spec: testSpec,
  execute: testExecute,
});

/** Ancien nom (phase 23), gardé : même geste que `tester_site`. */
export const testBookmakerAlias = defineAction<TestP>({
  key: "test_bookmaker",
  description:
    "Ancien nom de tester_site : tester la connexion au compte d'un bookmaker et une lecture, aucune mise",
  theme: "paris",
  cls: "immediate",
  spec: testSpec,
  execute: testExecute,
});

// ---------------------------------------------------------------------------------------------- apprendre_site

type LearnP = { bookmaker: string; adresse?: string };

export const apprendreSite = defineAction<LearnP>({
  key: "apprendre_site",
  description:
    "Apprendre (ou réapprendre) à lire le site d'un de nos bookmakers, avec sa nouvelle adresse si elle est donnée",
  theme: "paris",
  cls: "immediate",
  spec: {
    bookmaker: siteField(false),
    adresse: str("Nouvelle adresse du site si elle est donnée (betportal.com…)", {
      optional: true,
      maxLength: 200,
    }),
  },
  async execute(deps, p, actor) {
    const s = await siteOr(deps, p.bookmaker);
    if (isReply(s)) return s;
    if (p.adresse) {
      const u = await setSiteUrl(deps, s.key, p.adresse, actorOf(actor));
      if (!u.ok)
        return text(
          u.message.startsWith("Adresse refusée")
            ? say(
                V.urlRefused({
                  reason: u.message.replace(/^Adresse refusée : /, "").replace(/\.$/, ""),
                }),
                "urlRefused",
              )
            : u.message,
        );
    }
    const r = await relearnSite(deps, s.key, actorOf(actor));
    if (p.adresse && r.ok) {
      const site = await getSite(deps, s.key);
      return text(
        `${say(V.urlChanged({ site: s.label, url: site?.baseUrl ?? p.adresse }), "urlChanged")} ${r.message}`.trim(),
      );
    }
    return text(r.message);
  },
});

// ---------------------------------------------------------------------------------------------- ajouter_bookmaker

type AddP = { nom: string; adresse: string };

export const ajouterBookmaker = defineAction<AddP>({
  key: "ajouter_bookmaker",
  description:
    "Ajouter un bookmaker à lire (« ajoute le bookmaker X, c'est x.com ») avec les identifiants communs, puis l'apprendre",
  theme: "paris",
  cls: "immediate",
  spec: {
    nom: str("Nom du bookmaker", { maxLength: 60 }),
    adresse: str("Adresse du site (x.com, https://x.com/sports)", { maxLength: 200 }),
  },
  async execute(deps, p, actor) {
    const probe = await addSite(
      deps,
      { label: p.nom, url: p.adresse },
      { actor: actorOf(actor), learner: null },
    );
    if (!probe.ok || !probe.site) {
      const reason = probe.message.replace(/^Adresse refusée : /, "").replace(/\.$/, "");
      return text(
        probe.message.startsWith("Adresse refusée")
          ? say(V.urlRefused({ reason }), "urlRefused")
          : probe.message,
      );
    }
    const site = probe.site;
    if (!(await readBookmakerCredentialsFor(deps, site.key)))
      return text(say(V.siteAddedNoLearn({ site: site.label }), "siteAddedNoLearn"));
    const r = await relearnSite(deps, site.key, actorOf(actor));
    return text(r.ok ? say(V.siteAdded({ site: site.label }), "siteAdded") : r.message);
  },
});

// ---------------------------------------------------------------------------------------------- ouvrir_navigateur

export const ouvrirNavigateur = defineAction<{ bookmaker?: string }>({
  key: "ouvrir_navigateur",
  description:
    "Ouvrir le navigateur visible sur le Mac, sur le site d'un bookmaker, pour passer un contrôle anti-robot ou taper un code",
  theme: "paris",
  cls: "immediate",
  spec: { bookmaker: siteField() },
  async execute(deps, p, actor) {
    let raw = p.bookmaker;
    if (!raw) {
      // Sans nom : le site bloqué, s'il n'y en a qu'un.
      const blocked = (await listSites(deps, { activeOnly: true })).filter(
        (s) => s.status === "BLOCKED",
      );
      if (blocked.length === 1) raw = blocked[0]!.key;
    }
    const s = await siteOr(deps, raw);
    if (isReply(s)) return s;
    return text((await openVisibleBrowser(deps, s.key, actorOf(actor))).message);
  },
});

// ---------------------------------------------------------------------------------------------- identifiants

export const identifiantsBookmakers = defineAction<{ change?: boolean }>({
  key: "identifiants_bookmakers",
  description:
    "Me donner (ou changer) l'e-mail et le mot de passe communs des comptes bookmakers : je les demande en privé",
  theme: "paris",
  cls: "immediate",
  spec: {
    change: bool(
      "Vrai si les identifiants ont changé (« nouveaux identifiants bookmakers ») : je les redemande même s'ils sont déjà là",
      true,
    ),
  },
  async execute(deps, p) {
    const r = await askBookmakerCredentials(deps, { force: p.change === true });
    if (r.reason === "already_saved") return text(say(V.credentialsAlready, "credentialsAlready"));
    if (r.reason === "already_asked") return text(say(V.credentialsPending, "credentialsPending"));
    return text(say(V.credentialsAsked, "credentialsAsked"));
  },
});

export const BOOKMAKER_ACTIONS: BossAction[] = [
  voirMatchs,
  etatBookmakers,
  coteDe,
  testerSite,
  testBookmakerAlias,
  apprendreSite,
  ajouterBookmaker,
  ouvrirNavigateur,
  identifiantsBookmakers,
] as unknown as BossAction[];

export const BOOKMAKER_READ_ACTION_KEYS = ["voir_matchs", "etat_bookmakers", "cote_de"] as const;
/** Gestes sur les sites et les identifiants : l'admin seul (un membre présenté lit seulement). */
export const BOOKMAKER_ADMIN_ACTION_KEYS = [
  "tester_site",
  "test_bookmaker",
  "apprendre_site",
  "ajouter_bookmaker",
  "ouvrir_navigateur",
  "identifiants_bookmakers",
] as const;
for (const k of BOOKMAKER_READ_ACTION_KEYS) BOSS_READ_KEYS.add(k);
for (const k of BOOKMAKER_ADMIN_ACTION_KEYS) BOSS_ADMIN_ONLY_KEYS.add(k);

// ---------------------------------------------------------------------------------------------- voir_matchs_bookmaker

/** Lecteur des matchs d'un site pour `voir_matchs_bookmaker` (phase 33) : les matchs lus sur le site, sans deviner. */
export function siteMatchLister(siteKey: string) {
  return async (deps: Parameters<typeof readEvents>[0], q: { from: Date; to: Date }) =>
    (await readEvents(deps, siteKey, { from: q.from, to: q.to })).map((e) => ({
      eventId: e.siteEventId,
      leagueId: e.league,
      homeTeam: e.homeTeam,
      awayTeam: e.awayTeam,
      startsAt: e.startsAt,
      markets: e.marketsCount ?? 0,
    }));
}
for (const s of DEFAULT_BOOKMAKER_SITES)
  registerBookmakerMatchLister(s.key, siteMatchLister(s.key));

/** Un site lu directement et prêt ? (pour que `voir_matchs_bookmaker` passe par lui avant le fournisseur de cotes) */
export async function readableSiteFor(deps: BossDeps, raw: string): Promise<boolean> {
  const site = await findSite(deps, raw);
  return !!site && site.isActive && (site.status === "READY" || site.status === "DEGRADED");
}

registerBookmakerSiteView(async (deps, q) => {
  // Le foot seulement : les sites sont appris sur leur section football.
  if (q.sport && !/^(foot|football|soccer)$/i.test(q.sport.trim())) return null;
  if (!(await readableSiteFor(deps, q.bookmaker))) return null;
  return siteMatchesView(deps, { site: q.bookmaker, day: q.day, slot: q.slot });
});
