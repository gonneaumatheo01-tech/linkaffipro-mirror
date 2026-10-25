/**
 * Phase 33, chantier C — Paris sportifs vus par Kevin. Les matchs ne sont choisis qu'au passage de l'équipe
 * (`runSportsPassage`) : `viewSportsChannel` donne donc le plan du jour (catégories actives pour le canal, paris par
 * jour, passages, prochain passage) et les paris déjà choisis ou publiés ce jour-là ; `previewSportsPicks` joue la
 * sélection de l'agent Cotes et sélection À BLANC (mêmes lectures, même classement pur `rankCandidates`) sans créer
 * ni pari ni mission. Seule dépense : les appels de cotes (comptés dans le forfait du mois, la réponse le dit).
 */
import { nowOf } from "../../admin/journal";
import { rankCandidates, type Candidate } from "../../agents/cotes/select";
import { marketsForEvents } from "../../providers/odds-batch";
import { OddsQuotaError, oddsCallsThisMonth } from "../../providers/odds-quota";
import { hasOddsKey, resolveOddsProvider, type OddsResolveDeps } from "../../providers/odds-registry";
import { addDaysToDay, parisDay, parisDayStart } from "../../rules/time";
import { activeCategories, recentPickKeys, settledSamples, toCategory, type BetCategoryInfo } from "../../sports/data";
import { bookmakerLabel, frOdds, leagueLabel } from "../../sports/labels";
import { parseSportsSettings, withTeamBounds } from "../../sports/settings";
import type { AgentsDeps } from "../../types";
import { dayLabel, hourLabel, overridesOf, readTeamState, type ViewResult } from "./common";
import { planLines, viewPlan } from "./plan";

/** Statuts des paris en français. */
export const PICK_STATE: Record<string, string> = {
  PROPOSED: "choisi, pas encore publié",
  PUBLISHED: "publié",
  WON: "gagné",
  LOST: "perdu",
  VOID: "annulé",
  SKIPPED: "écarté",
};

type PickRow = {
  id: string;
  categoryId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  marketLabel: string;
  selectionLabel: string;
  odds: number;
  bookmaker: string;
  status: string;
  skipReason: string | null;
  postId: string | null;
  createdAt: Date;
};

/** Catégories qui travaillent ce canal ce jour-là : celle d'un ordre en cours, sinon les catégories actives qui le visent. */
export async function categoriesForChannel(deps: AgentsDeps, channelId: string, day: string): Promise<{ categories: BetCategoryInfo[]; isTest: boolean; fromOrder: boolean }> {
  const channel = (await deps.prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, isTest: true } })) as { id: string; isTest: boolean } | null;
  const ov = (await overridesOf(deps, channelId, day)).find((o) => o.teamKey === "sports");
  if (ov?.betCategoryId) {
    const r = await deps.prisma.betCategory.findUnique({ where: { id: ov.betCategoryId } });
    if (r) {
      const c = toCategory(r as unknown as Record<string, unknown>);
      return { categories: [ov.picksPerDay ? { ...c, picksPerDay: ov.picksPerDay } : c], isTest: channel?.isTest === true, fromOrder: true };
    }
  }
  const all = await activeCategories(deps.prisma);
  const mine = all.filter((c) => c.channelIds.includes(channelId));
  // Canal Test traité comme un canal paris sans catégorie précise : celles qui sont actives.
  if (!mine.length && (channel?.isTest || ov)) return { categories: all, isTest: channel?.isTest === true, fromOrder: !!ov };
  return { categories: mine, isTest: channel?.isTest === true, fromOrder: false };
}

/** Plan du jour d'un canal paris + paris déjà choisis ou publiés ce jour-là (lecture seule, gratuit). */
export async function viewSportsChannel(deps: AgentsDeps, channelId: string, day?: string | null): Promise<ViewResult> {
  const now = nowOf(deps);
  const d = day ?? parisDay(now);
  const plan = await viewPlan(deps, { channelId, day: d });
  const { categories } = await categoriesForChannel(deps, channelId, d);
  const picks = categories.length
    ? ((await deps.prisma.bettingPick.findMany({
        where: { categoryId: { in: categories.map((c) => c.id) }, createdAt: { gte: parisDayStart(d), lt: parisDayStart(addDaysToDay(d, 1)) }, status: { not: "SKIPPED" } },
        orderBy: { kickoffAt: "asc" },
        take: 20,
      })) as PickRow[])
    : [];
  const teams = plan.facts.equipes as Array<{ equipe: string; pourDeFaux: boolean; pause: boolean; niveau: number }>;
  const lines = planLines(plan.entries, [], now, { channelId }).filter((l) => !l.startsWith("Équipe "));
  const facts = {
    ...plan.facts,
    paris: picks.map((p) => ({ match: `${p.homeTeam} - ${p.awayTeam}`, ligue: leagueLabel(p.league), coupDEnvoi: p.kickoffAt.toISOString(), pari: `${p.marketLabel} : ${p.selectionLabel}`, cote: p.odds, bookmaker: p.bookmaker, etat: PICK_STATE[p.status] ?? p.status })),
  };
  if (picks.length) {
    lines.push(`Déjà ${picks.length} ${picks.length > 1 ? "paris choisis" : "pari choisi"} ${dayLabel(d, now)} :`);
    for (const p of picks.slice(0, 5)) lines.push(`${p.homeTeam} - ${p.awayTeam} (${hourLabel(p.kickoffAt)}) · ${p.selectionLabel} à ${frOdds(p.odds)} · ${PICK_STATE[p.status] ?? p.status}`);
  } else if (categories.length) lines.push(`Aucun pari choisi ${dayLabel(d, now)} pour l'instant.`);
  const t = teams.find((x) => x.equipe === "Paris sportifs");
  if (t) lines.push(t.pause ? "L'équipe est en pause." : t.pourDeFaux ? "C'est pour de faux : les paris partent sur le canal Test." : "C'est pour de vrai.");
  if (categories.length) lines.push("Tu veux que je regarde les matchs candidats, sans rien publier ?");
  return { facts, lines };
}

export type PreviewCandidate = {
  categorie: string;
  match: string;
  ligue: string;
  coupDEnvoi: string;
  pari: string;
  cote: number;
  bookmaker: string;
  score: number;
};

/**
 * La sélection jouée À BLANC : ce que Cotes et sélection retiendrait maintenant pour ce canal (3 à 5 candidats), sans
 * créer de pari, de mission ni de passage « avant match ». Les appels de cotes sont comptés (forfait du mois).
 */
export async function previewSportsPicks(deps: OddsResolveDeps, channelId: string, day?: string | null): Promise<ViewResult & { candidates: PreviewCandidate[]; calls: number }> {
  const now = nowOf(deps);
  const d = day ?? parisDay(now);
  const { categories } = await categoriesForChannel(deps, channelId, d);
  if (!categories.length) return { facts: { candidats: [], appels: 0 }, lines: ["Aucune catégorie de paris ne vise ce canal : je n'ai rien à regarder."], candidates: [], calls: 0 };
  const team = await readTeamState(deps, "sports");
  const s = parseSportsSettings(team.settings.settings);
  const forced = !!deps.providers?.odds;
  const keyed = forced || (await hasOddsKey(deps.prisma));
  if (!keyed && !team.simulation) return { facts: { candidats: [], appels: 0, cle: false }, lines: ["Je n'ai pas de clé de cotes : je ne peux pas regarder les matchs.", "Envoie-la-moi quand tu l'as, je la range tout de suite."], candidates: [], calls: 0 };
  const resolved = await resolveOddsProvider(deps, { source: keyed ? null : "fake", maxCalls: s.maxApiCallsPerMonth });
  if (!resolved) return { facts: { candidats: [], appels: 0, cle: false }, lines: ["Je n'ai pas de clé de cotes : je ne peux pas regarder les matchs."], candidates: [], calls: 0 };
  const before = await oddsCallsThisMonth(deps.prisma, now);
  const all: PreviewCandidate[] = [];
  let considered = 0;
  let quota: string | null = null;
  try {
    const [recent, samples] = await Promise.all([recentPickKeys(deps.prisma, now), settledSamples(deps.prisma, now)]);
    for (const raw of categories.slice(0, 3)) {
      const c = withTeamBounds(raw, s);
      const from = new Date(Math.max(now.getTime() + c.minMinutesBeforeKickoff * 60_000, parisDayStart(d).getTime()));
      const to = new Date(from.getTime() + s.lookaheadHours * 3_600_000);
      const events = (await resolved.provider.listEvents({ sport: c.sport, leagues: c.leagues, from, to })).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, 40);
      if (!events.length) continue;
      const markets = await marketsForEvents(resolved.provider, events.map((e) => e.eventId), c.marketTypes);
      const ranked = rankCandidates({ events, markets, criteria: c, minMinutesBeforeKickoff: c.minMinutesBeforeKickoff, minInterestScore: s.minInterestScore, minBookmakers: s.minBookmakers, recent, samples, now, source: resolved.source });
      considered += ranked.considered;
      all.push(...ranked.candidates.slice(0, 5).map((x: Candidate) => toPreview(c.name, x)));
    }
  } catch (err) {
    if (err instanceof OddsQuotaError) quota = err.message;
    else throw err;
  }
  const after = await oddsCallsThisMonth(deps.prisma, now);
  const calls = Math.max(0, after - before);
  const candidates = all.sort((a, b) => b.score - a.score).slice(0, 5);
  const facts = { categories: categories.map((c) => c.name), candidats: candidates, selectionsRegardees: considered, appels: calls, appelsDuMois: after, appelsMax: s.maxApiCallsPerMonth, source: resolved.source };
  const lines: string[] = [];
  if (quota) lines.push("Plafond d'appels aux cotes atteint ce mois-ci : je ne peux plus regarder les matchs.");
  else if (!candidates.length) lines.push(`Rien ne passe les critères pour l'instant (${considered} sélections regardées), donc rien ne serait publié.`);
  else {
    lines.push(`Si je choisissais maintenant, sans rien publier :`);
    for (const c of candidates) lines.push(`${c.match} (${hourLabel(new Date(c.coupDEnvoi))}) · ${c.pari} à ${frOdds(c.cote)} chez ${bookmakerLabel(c.bookmaker)}`);
  }
  lines.push(resolved.source === "fake" ? "Cotes d'essai : rien de payé." : `Ça a compté ${calls} ${calls > 1 ? "appels" : "appel"} de cotes sur le forfait du mois (${after} sur ${s.maxApiCallsPerMonth}).`);
  return { facts, lines, candidates, calls, costCents: 0 };
}

function toPreview(category: string, c: Candidate): PreviewCandidate {
  return {
    categorie: category,
    match: `${c.event.homeTeam} - ${c.event.awayTeam}`,
    ligue: leagueLabel(c.event.leagueId),
    coupDEnvoi: c.event.startsAt.toISOString(),
    pari: c.selection.selectionLabel,
    cote: c.odds,
    bookmaker: c.bookmaker,
    score: Math.round(c.score * 10_000) / 10_000,
  };
}
