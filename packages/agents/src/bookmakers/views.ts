/**
 * Phase 35, chantier D — ce que Kevin répond sur les bookmakers lus directement (lecture seule) :
 * - `siteMatchesView` : « quels matchs sont sur Sportaza ce soir ? », « demain chez Celsius en Ligue 1 », « il y a des
 *   corners sur le PSG ? » → par ligue, heure, nombre de marchés, cotes principales (cache seulement : aucune lecture
 *   de plus pour elles) ; marché demandé → lecture des marchés de 5 matchs au plus ;
 * - `bookmakersStatusView` : « les bookmakers ça va ? », « le Mac lit ? » ;
 * - `oddsOfView` : « la cote de PSG gagne chez Sportaza ? » → double lecture (`readOddsTwice`), avec l'heure.
 * Chaque vue rend `{ facts, lines }` (chiffres des données seulement) ; jamais la façon de lire ni le moteur du site.
 */
import { nowOf } from "../admin/journal";
import { dayLabel, hourLabel, slotRange, type DaySlot } from "../orders/view/common";
import { parisDay } from "../rules/time";
import { resolveTheme, themeByKey } from "../sports/themes";
import type { AgentsDeps } from "../types";
import { BOOKMAKERS_VARIANTS as V } from "../boss/bookmakers-texts";
import { pick } from "../boss/voice";
import { BOOKMAKER_LIMITS, type SiteEvent, type SiteOdds } from "./contract";
import { hasDefaultCredentials } from "./credentials";
import { healthRate, readSiteHealth, statusReasonOf } from "./health";
import { macHeartbeatFresh, readEvents, readMacHeartbeat, readMarkets, readOddsTwice } from "./ops";
import { listSites, matchSite, type SiteRow } from "./sites";

export type View = { facts: Record<string, unknown>; lines: string[] };

/** Texte normalisé pour comparer des noms (pur). */
export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Cote au format français (pur) : 1.85 → « 1,85 ». */
export function frOdds(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** « il y a 12 min », « il y a 3 h », « il y a 2 j », « jamais » (pur). */
export function agoLabel(at: Date | null | undefined, now: Date): string {
  if (!at) return "jamais";
  const min = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

/** Résolution d'un site tel que dit ; rend la vue d'erreur (inconnu, ambigu, aucun) sinon. */
export async function resolveSiteView(
  deps: Pick<AgentsDeps, "prisma">,
  raw: string | null | undefined,
): Promise<{ site: SiteRow } | { view: View }> {
  const sites = await listSites(deps, { activeOnly: true });
  if (!sites.length)
    return { view: { facts: { sites: [] }, lines: [pick(V.noSites, "bookmakers.noSites")] } };
  const site = matchSite(sites, raw);
  if (site) return { site };
  // Sans nom : le seul bookmaker qui se lit, s'il n'y en a qu'un (« il y a des corners sur le PSG ? »).
  const readable = sites.filter((s) => s.status === "READY" || s.status === "DEGRADED");
  if (!raw && readable.length === 1) return { site: readable[0]! };
  const list = sites.map((s) => s.label).join(", ");
  if (!raw)
    return {
      view: {
        facts: { sites: sites.map((s) => s.label) },
        lines: [pick(V.siteAmbiguous({ list }), "bookmakers.siteAmbiguous")],
      },
    };
  return {
    view: {
      facts: { inconnu: raw, sites: sites.map((s) => s.label) },
      lines: [pick(V.siteUnknown({ name: raw, list }), "bookmakers.siteUnknown")],
    },
  };
}

/** Le site se lit-il (prêt ou fragile) ? Sinon, la phrase qui dit pourquoi. */
function notReadable(site: SiteRow): View | null {
  if (site.status === "READY" || site.status === "DEGRADED") return null;
  if (!site.baseUrl)
    return {
      facts: { site: site.label, etat: "sans adresse" },
      lines: [pick(V.siteNoUrl({ site: site.label }), "bookmakers.siteNoUrl")],
    };
  if (site.status === "LEARNING")
    return {
      facts: { site: site.label, etat: "apprentissage" },
      lines: [pick(V.learnAlready({ site: site.label }), "bookmakers.learnAlready")],
    };
  if (site.status === "BLOCKED")
    return {
      facts: { site: site.label, etat: "bloqué", raison: site.statusReason },
      lines: [
        pick(
          V.siteBlockedNow({ site: site.label, reason: site.statusReason ?? "lecture impossible" }),
          "bookmakers.siteBlockedNow",
        ),
      ],
    };
  return {
    facts: { site: site.label, etat: "pas encore appris" },
    lines: [pick(V.matchesNotReady({ site: site.label }), "bookmakers.matchesNotReady")],
  };
}

function whenLabel(day: string, slot: DaySlot | null, now: Date): string {
  const d = dayLabel(day, now);
  if (!slot) return d;
  if (d === "aujourd'hui")
    return slot === "soir"
      ? "ce soir"
      : slot === "matin"
        ? "ce matin"
        : slot === "nuit"
          ? "cette nuit"
          : slot === "midi"
            ? "ce midi"
            : "cet après-midi";
  return `${d} ${slot === "apres-midi" ? "après-midi" : slot}`;
}

export type MatchesQuery = {
  site?: string | null;
  day?: string | null;
  slot?: DaySlot | null;
  league?: string | null;
  team?: string | null;
  market?: string | null;
};

const RESULT_KEY = "resultat";

/** Cotes principales d'un match, depuis le cache seulement (20 minutes), dans l'ordre 1 / N / 2 si possible. */
async function cachedMainOdds(
  deps: Pick<AgentsDeps, "prisma">,
  siteKey: string,
  siteEventId: string,
  now: Date,
): Promise<number[]> {
  const rows = (await deps.prisma.bookmakerOdds.findMany({
    where: {
      siteKey,
      siteEventId,
      marketKey: RESULT_KEY,
      readAt: { gte: new Date(now.getTime() - BOOKMAKER_LIMITS.eventsTtlMs) },
    },
    orderBy: { readAt: "desc" },
    take: 12,
  })) as Array<{ selectionKey: string | null; selectionSite: string; odds: number }>;
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = r.selectionKey ?? r.selectionSite;
    if (!seen.has(k)) seen.set(k, r.odds);
  }
  const order = ["home", "draw", "away", "1", "x", "2"];
  return [...seen.entries()]
    .sort(
      (a, b) =>
        ((order.indexOf(a[0].toLowerCase()) + 99) % 99) -
        ((order.indexOf(b[0].toLowerCase()) + 99) % 99),
    )
    .slice(0, 3)
    .map(([, o]) => o);
}

function teamMatches(e: SiteEvent, team: string): boolean {
  const t = normName(team);
  if (!t) return true;
  return (
    normName(e.homeTeam).includes(t) ||
    normName(e.awayTeam).includes(t) ||
    t.includes(normName(e.homeTeam)) ||
    t.includes(normName(e.awayTeam))
  );
}

export async function siteMatchesView(deps: AgentsDeps, q: MatchesQuery): Promise<View> {
  const now = nowOf(deps);
  const r = await resolveSiteView(deps, q.site);
  if ("view" in r) return r.view;
  const site = r.site;
  const blocked = notReadable(site);
  if (blocked) return blocked;
  const day = q.day ?? parisDay(now);
  const range = slotRange(day, q.slot ?? null);
  const from = new Date(Math.max(range.from.getTime(), now.getTime()));
  const when = whenLabel(day, q.slot ?? null, now);
  const base = {
    site: site.label,
    jour: day,
    moment: q.slot ?? null,
    ligue: q.league ?? null,
    equipe: q.team ?? null,
  };
  let events: SiteEvent[];
  try {
    events = from < range.to ? await readEvents(deps, site.key, { from, to: range.to }) : [];
  } catch {
    return {
      facts: { ...base, lu: false },
      lines: [pick(V.matchesFailed({ site: site.label }), "bookmakers.matchesFailed")],
    };
  }
  events = events
    .filter((e) => e.startsAt >= from && e.startsAt < range.to)
    .filter((e) => !q.league || normName(e.league).includes(normName(q.league)))
    .filter((e) => !q.team || teamMatches(e, q.team))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (!events.length)
    return {
      facts: { ...base, matchs: [] },
      lines: [
        pick(
          V.matchesNone({ site: site.label, when: q.team ? `${when} avec ${q.team}` : when }),
          "bookmakers.matchesNone",
        ),
      ],
    };

  const theme = q.market ? resolveTheme(q.market) : null;
  if (q.market) {
    if (!theme)
      return {
        facts: { ...base, marche: q.market },
        lines: [pick(V.marketUnknown({ market: q.market }), "bookmakers.marketUnknown")],
      };
    const out: Array<{ e: SiteEvent; odds: SiteOdds[] }> = [];
    for (const e of events.slice(0, 5)) {
      try {
        out.push({ e, odds: await readMarkets(deps, site.key, e.siteEventId, [theme.key]) });
      } catch {
        out.push({ e, odds: [] });
      }
    }
    const withMarket = out.filter((x) => x.odds.length);
    const facts = {
      ...base,
      marche: theme.label,
      matchs: out.map((x) => ({
        match: `${x.e.homeTeam} - ${x.e.awayTeam}`,
        coupDEnvoi: x.e.startsAt.toISOString(),
        cotes: x.odds.length,
      })),
    };
    if (!withMarket.length)
      return {
        facts,
        lines: [
          pick(
            V.marketAbsent({
              site: site.label,
              market: theme.label,
              when: q.team ? `${when} pour ${q.team}` : when,
            }),
            "bookmakers.marketAbsent",
          ),
        ],
      };
    const lines = [
      pick(V.marketHead({ site: site.label, market: theme.label, when }), "bookmakers.marketHead"),
    ];
    for (const x of withMarket.slice(0, 5)) {
      const ex = x.odds
        .slice(0, 2)
        .map(
          (o) =>
            `${o.selectionSite}${o.line !== null ? ` ${String(o.line).replace(".", ",")}` : ""} à ${frOdds(o.odds)}`,
        );
      lines.push(
        `${x.e.homeTeam} - ${x.e.awayTeam} (${hourLabel(x.e.startsAt)}) : ${x.odds.length} cote${x.odds.length > 1 ? "s" : ""}, ${ex.join(", ")}`,
      );
    }
    return { facts, lines };
  }

  const byLeague = new Map<string, SiteEvent[]>();
  for (const e of events) byLeague.set(e.league, [...(byLeague.get(e.league) ?? []), e]);
  const lines = [
    pick(V.matchesHead({ site: site.label, when, n: events.length }), "bookmakers.matchesHead"),
  ];
  const facts: Array<Record<string, unknown>> = [];
  let shownLeagues = 0;
  for (const [league, list] of byLeague) {
    const parts: string[] = [];
    for (const e of list.slice(0, 3)) {
      const main = await cachedMainOdds(deps, site.key, e.siteEventId, now);
      const markets =
        typeof e.marketsCount === "number"
          ? `${e.marketsCount} marché${e.marketsCount > 1 ? "s" : ""}`
          : null;
      const detail = [
        hourLabel(e.startsAt),
        markets,
        main.length ? main.map(frOdds).join(" / ") : null,
      ]
        .filter(Boolean)
        .join(", ");
      parts.push(`${e.homeTeam} - ${e.awayTeam} (${detail})`);
    }
    for (const e of list)
      facts.push({
        ligue: league,
        match: `${e.homeTeam} - ${e.awayTeam}`,
        coupDEnvoi: e.startsAt.toISOString(),
        marches: e.marketsCount ?? null,
      });
    if (shownLeagues < 6)
      lines.push(
        `${league} : ${parts.join(", ")}${list.length > 3 ? ` et ${list.length - 3} autres` : ""}`,
      );
    shownLeagues++;
  }
  if (shownLeagues > 6) lines.push(`Et ${shownLeagues - 6} autres ligues.`);
  return { facts: { ...base, matchs: facts }, lines };
}

// ------------------------------------------------------------------------------------------------ état

const STATUS_WORDS: Record<string, string> = {
  READY: "se lit bien",
  DEGRADED: "se lit mal en ce moment",
  BLOCKED: "ne se lit plus",
  LEARNING: "en cours d'apprentissage",
  NEW: "pas encore appris",
};

export async function bookmakersStatusView(
  deps: AgentsDeps,
  opts: { macOnly?: boolean } = {},
): Promise<View> {
  const now = nowOf(deps);
  const hb = await readMacHeartbeat(deps);
  const mac = macHeartbeatFresh(hb, now);
  const macLine = mac
    ? pick(V.macAlive({ ago: agoLabel(hb ? new Date(hb.at) : null, now) }), "bookmakers.macAlive")
    : pick(V.macDown({ ago: agoLabel(hb ? new Date(hb.at) : null, now) }), "bookmakers.macDown");
  const macFacts = { macEnVie: mac, dernierPassageMac: hb?.at ?? null };
  if (opts.macOnly) return { facts: macFacts, lines: [macLine] };
  const sites = await listSites(deps, { activeOnly: true });
  if (!sites.length)
    return {
      facts: { ...macFacts, sites: [] },
      lines: [pick(V.noSites, "bookmakers.noSites"), macLine],
    };
  const rows: Array<Record<string, unknown>> = [];
  const lines: string[] = [];
  let ok = 0;
  for (const s of sites) {
    const rate = healthRate((await readSiteHealth(deps, s.key)).checks, now);
    if (s.status === "READY") ok++;
    const pct = rate.ratio === null ? null : Math.round(rate.ratio * 100);
    rows.push({
      site: s.label,
      etat: STATUS_WORDS[s.status] ?? s.status.toLowerCase(),
      dernierSucces: s.lastOkAt?.toISOString() ?? null,
      reussite24h: pct,
      parLeMac: s.readTarget === "mac",
    });
    const mark =
      s.status === "READY" ? "✅" : s.status === "BLOCKED" || s.status === "DEGRADED" ? "⚠️" : "⏳";
    const reason =
      s.status === "BLOCKED" || s.status === "DEGRADED"
        ? ` (${s.statusReason ?? statusReasonOf(s.status, null, 0) ?? "lecture irrégulière"})`
        : "";
    const extra =
      s.status === "READY" || s.status === "DEGRADED"
        ? `, dernier succès ${agoLabel(s.lastOkAt ?? null, now)}${pct !== null ? `, ${pct} % sur 24 h` : ""}`
        : "";
    lines.push(
      `${mark} ${s.label} : ${STATUS_WORDS[s.status] ?? "état inconnu"}${reason}${extra}${s.readTarget === "mac" ? ", lu par le Mac" : ""}`,
    );
  }
  const head = pick(V.statusHead({ n: sites.length, ok }), "bookmakers.statusHead");
  const creds = await hasDefaultCredentials(deps);
  const out = [head, ...lines.slice(0, 5), macLine];
  if (!creds) out.push(pick(V.noCredentials, "bookmakers.noCredentials"));
  return { facts: { ...macFacts, sites: rows, identifiantsCommuns: creds }, lines: out };
}

// ------------------------------------------------------------------------------------------------ cote

export type OddsQuery = {
  site?: string | null;
  match: string;
  market?: string | null;
  selection?: string | null;
};

/** Choix de la sélection demandée parmi les cotes lues (pur) : nom d'équipe, « nul », ligne (« plus de 2,5 »). */
export function pickSelection(
  odds: readonly SiteOdds[],
  wanted: string,
  e: Pick<SiteEvent, "homeTeam" | "awayTeam">,
): SiteOdds | null {
  if (!odds.length) return null;
  const w = normName(wanted);
  const line = /(\d+(?:[.,]\d+)?)/.exec(wanted)?.[1];
  const lineNum = line ? Number(line.replace(",", ".")) : null;
  const pool = lineNum !== null ? odds.filter((o) => o.line === lineNum) : odds;
  const over = /\b(plus|over|\+)\b/.test(w);
  const under = /\b(moins|under)\b/.test(w);
  const draw = /\b(nul|draw|x)\b/.test(w);
  const home = normName(e.homeTeam);
  const away = normName(e.awayTeam);
  const score = (o: SiteOdds): number => {
    const s = normName(`${o.selectionSite} ${o.selectionKey ?? ""}`);
    let n = 0;
    if (w && (s.includes(w) || w.includes(s))) n += 3;
    if (draw && /\b(nul|draw|x)\b/.test(s)) n += 4;
    if (over && /\b(plus|over)\b/.test(s)) n += 4;
    if (under && /\b(moins|under)\b/.test(s)) n += 4;
    if (w.includes(home) && (s.includes(home) || /\b(home|1)\b/.test(s))) n += 4;
    if (w.includes(away) && (s.includes(away) || /\b(away|2)\b/.test(s))) n += 4;
    return n;
  };
  const best = [...pool]
    .map((o) => ({ o, n: score(o) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (!best.length) return null;
  if (best.length > 1 && best[0]!.n === best[1]!.n) return null;
  return best[0]!.o;
}

export async function oddsOfView(deps: AgentsDeps, q: OddsQuery): Promise<View> {
  const now = nowOf(deps);
  const r = await resolveSiteView(deps, q.site);
  if ("view" in r) return r.view;
  const site = r.site;
  const blocked = notReadable(site);
  if (blocked) return blocked;
  const wanted = (q.selection ?? q.match).trim();
  let events: SiteEvent[] = [];
  try {
    events = await readEvents(deps, site.key, {
      from: now,
      to: new Date(now.getTime() + 3 * 86_400_000),
    });
  } catch {
    return {
      facts: { site: site.label, lu: false },
      lines: [pick(V.matchesFailed({ site: site.label }), "bookmakers.matchesFailed")],
    };
  }
  const teams = q.match
    .split(/\s+[-–]\s+|\s+contre\s+|\s+vs\.?\s+/i)
    .map((t) => t.trim())
    .filter(Boolean);
  const ev = events
    .filter((e) => teams.every((t) => teamMatches(e, t)))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (!ev)
    return {
      facts: { site: site.label, match: q.match, trouve: false },
      lines: [pick(V.oddsNotFound({ site: site.label, what: q.match }), "bookmakers.oddsNotFound")],
    };
  const theme =
    (q.market ? resolveTheme(q.market) : null) ?? resolveTheme(wanted) ?? themeByKey(RESULT_KEY)!;
  const match = `${ev.homeTeam} - ${ev.awayTeam}`;
  let candidates: SiteOdds[] = [];
  try {
    candidates = await readMarkets(deps, site.key, ev.siteEventId, [theme.key]);
  } catch {
    candidates = [];
  }
  const chosen = pickSelection(candidates, wanted, ev);
  if (!chosen)
    return {
      facts: { site: site.label, match, marche: theme.label, trouve: false },
      lines: [pick(V.oddsNotFound({ site: site.label, what: wanted }), "bookmakers.oddsNotFound")],
    };
  const twice = await readOddsTwice(deps, site.key, {
    siteEventId: ev.siteEventId,
    marketKey: chosen.marketKey ?? theme.key,
    selectionKey: chosen.selectionKey ?? chosen.selectionSite,
    line: chosen.line,
  });
  if (!twice.ok)
    return {
      facts: { site: site.label, match, verifie: false, raison: twice.reason },
      lines: [pick(V.oddsUnsure({ site: site.label, match }), "bookmakers.oddsUnsure")],
    };
  const reads = (await deps.prisma.bookmakerOdds.findMany({
    where: { id: { in: [...twice.readIds] } },
  })) as Array<{ readAt: Date }>;
  const at = reads.length ? new Date(Math.max(...reads.map((x) => x.readAt.getTime()))) : now;
  const bet = `${chosen.selectionSite}${chosen.line !== null ? ` ${String(chosen.line).replace(".", ",")}` : ""}`;
  return {
    facts: {
      site: site.label,
      match,
      marche: chosen.marketSite,
      selection: bet,
      cote: twice.odds,
      luA: at.toISOString(),
      verifie: true,
    },
    lines: [
      pick(
        V.oddsOk({ site: site.label, match, bet, odds: frOdds(twice.odds), time: hourLabel(at) }),
        "bookmakers.oddsOk",
      ),
    ],
  };
}
