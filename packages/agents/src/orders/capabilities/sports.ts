/**
 * Capacités du Chef Paris sportifs (phase 33) : programmer des paris sur des canaux (ou le canal Test « comme si »)
 * pendant N jours avec un thème du fournisseur de cotes, un pari de test, changer une catégorie, bilan, question.
 * Reprend les fonctions existantes (`createTestBetMission`, `setBetCategoryActive`, `betSummaryFacts`,
 * `betsTodayFacts`) ; la production passe par la chaîne habituelle (Cotes → Capture → Rédaction → Contrôle →
 * Publication) à partir des missions créées par le Grand Chef (`orders/day-missions.ts`).
 */
import { agentAudit, nowOf, readSetting } from "../../admin/journal";
import { betSummaryFacts, betsTodayFacts } from "../../boss/facts";
import { matchNames } from "../../boss/resolve";
import { setBetCategoryActive } from "../../control/bet-category";
import { oddsCallsThisMonth } from "../../providers/odds-quota";
import { hasOddsKey, resolveOddsProvider } from "../../providers/odds-registry";
import { addDaysToDay, parisDay, parisDayStart } from "../../rules/time";
import { createTestBetMission } from "../../sports/contracts";
import { toCategory, type BetCategoryInfo } from "../../sports/data";
import { SPORTS_PASSAGES_SETTING } from "../../sports/passage-state";
import { loadSportsSettings } from "../../sports/settings";
import { marketsAvailable, resolveTheme, themeOfMarkets, type SportsTheme } from "../../sports/themes";
import type { AgentsDeps } from "../../types";
import type { Alternative, CapabilityCheck, OrderRow, OrderStep } from "../contract";
import {
  F,
  alt,
  channelsLabel,
  clampPerDay,
  defineCapability,
  done,
  failed,
  frRange,
  missionsReport,
  modeOf,
  ok,
  orderActor,
  orderModeOf,
  readAlgoBounds,
  readOnly,
  refuse,
  resolvePeriod,
  resolveScope,
  settingTouches,
  touchesOf,
} from "./kit";

const T = "sports" as const;
const AGENTS = ["cotes", "capture", "redaction", "controle", "publication"];

type CatRow = Record<string, unknown> & { id: string; key: string; name: string; active: boolean; createdByOrderId?: string | null; sortOrder?: number };

async function allCategories(deps: AgentsDeps): Promise<CatRow[]> {
  return (await deps.prisma.betCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })) as CatRow[];
}

/** Catégories du client (jamais celles créées pour un ordre). */
async function clientCategories(deps: AgentsDeps): Promise<CatRow[]> {
  return (await allCategories(deps)).filter((c) => !c.createdByOrderId);
}

function findCategory(raw: string, cats: readonly CatRow[]): CatRow[] {
  return matchNames(raw, cats.map((c) => ({ ...c, extra: [c.key.replace(/[-_]/g, " ")] })));
}

/** Catégorie active la plus proche d'un thème (marchés communs), sinon la première active, sinon la première. */
export function closestCategory(cats: readonly BetCategoryInfo[], theme: SportsTheme | null): BetCategoryInfo | null {
  const sameTheme = theme ? cats.filter((c) => themeOfMarkets(c.marketTypes)?.key === theme.key) : [];
  return sameTheme.find((c) => c.active) ?? cats.find((c) => c.active) ?? sameTheme[0] ?? cats[0] ?? null;
}

async function teamSimulation(deps: AgentsDeps): Promise<boolean> {
  const row = (await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: T } })) as { simulation?: boolean } | null;
  return row?.simulation !== false;
}

// ------------------------------------------------------------------------------------------------ programmer_paris

type ProgramP = {
  canaux?: string[];
  test?: boolean;
  jours?: number;
  debut?: string;
  paris_par_jour?: number;
  theme?: string;
  categorie?: string;
  bookmaker?: string;
  cote_min?: number;
  cote_max?: number;
  mode?: "simulation" | "vrai";
};

type ThemeChoice = { category: CatRow | null; theme: SportsTheme | null };

/** Thème et catégorie de l'ordre : catégorie nommée, thème du dictionnaire, ou la première catégorie active. */
async function themeChoice(deps: AgentsDeps, p: ProgramP): Promise<{ ok: true; value: ThemeChoice } | { ok: false; check: CapabilityCheck }> {
  const cats = await clientCategories(deps);
  const replay = (params: Partial<ProgramP>) => ({ ...p, ...params });
  if (p.categorie) {
    const found = findCategory(p.categorie, cats);
    if (!found.length) {
      const asTheme = resolveTheme(p.categorie);
      if (asTheme) return { ok: true, value: { category: null, theme: asTheme } };
      return {
        ok: false,
        check: refuse(
          `Je ne trouve pas la catégorie de paris « ${p.categorie.slice(0, 60)} ».`,
          cats.slice(0, 4).map((c) => alt(`catégorie ${c.name}`, T, "programmer_paris", replay({ categorie: c.name }))),
        ),
      };
    }
    const c = found[0]!;
    return { ok: true, value: { category: c, theme: p.theme ? resolveTheme(p.theme) : themeOfMarkets(toCategory(c).marketTypes) } };
  }
  if (p.theme) return { ok: true, value: { category: null, theme: resolveTheme(p.theme) } };
  const active = cats.find((c) => c.active) ?? null;
  if (!active)
    return {
      ok: false,
      check: refuse(
        "Quel thème de paris ? Aucune catégorie n'est active.",
        ["corners", "cartons", "tirs cadrés", "buts"].map((t) => alt(`thème ${t}`, T, "programmer_paris", replay({ theme: t }))),
      ),
    };
  return { ok: true, value: { category: active, theme: themeOfMarkets(toCategory(active).marketTypes) } };
}

async function bookmakerCovered(deps: AgentsDeps, bookmaker: string): Promise<{ ok: boolean; covered: string[] }> {
  const s = await loadSportsSettings(deps.prisma);
  const live = !!(deps as { providers?: { odds?: unknown } }).providers?.odds || (await hasOddsKey(deps.prisma));
  const r = await resolveOddsProvider(deps, { source: live ? "live" : "fake", maxCalls: s.maxApiCallsPerMonth });
  if (!r) return { ok: true, covered: [] };
  try {
    const covered = (await r.provider.listBookmakers()).map((b) => b.toLowerCase());
    return { ok: covered.includes(bookmaker.toLowerCase().replace(/\s+/g, "")), covered };
  } catch {
    return { ok: true, covered: [] };
  }
}

/** Appels aux cotes estimés pour un ordre : par jour et par canal, la liste des matchs, les marchés et une relecture par pari (pur). */
export function estimatedOddsCalls(o: { days: number; channels: number; perDay: number }): number {
  return Math.max(1, o.days) * Math.max(1, o.channels) * (2 + Math.max(1, o.perDay));
}

/**
 * Appels aux cotes de l'ordre comparés à ce qui reste du forfait du mois (`maxApiCallsPerMonth`) : au-delà, le récapitulatif
 * le dit (les appels au-delà du plafond sont refusés, l'ordre s'arrêterait avant la fin). Sans clé de cotes : rien.
 */
async function oddsCallsNote(deps: AgentsDeps, o: { days: number; channels: number; perDay: number }): Promise<string | null> {
  const live = !!(deps as { providers?: { odds?: unknown } }).providers?.odds || (await hasOddsKey(deps.prisma).catch(() => false));
  if (!live) return null;
  const s = await loadSportsSettings(deps.prisma);
  const used = await oddsCallsThisMonth(deps.prisma, nowOf(deps)).catch(() => 0);
  const left = Math.max(0, s.maxApiCallsPerMonth - used);
  const need = estimatedOddsCalls(o);
  if (need <= left) return null;
  return `l'ordre demande environ ${need} appels aux cotes et il en reste ${left} ce mois-ci sur ${s.maxApiCallsPerMonth} : il s'arrêtera avant la fin si le plafond n'est pas relevé`;
}

export const programmerParis = defineCapability<ProgramP>({
  teamKey: T,
  key: "programmer_paris",
  description:
    "Programmer des paris sur un ou des canaux paris (ou le canal Test) pendant N jours : paris par jour, thème (corners, cartons, tirs cadrés, hors-jeux…) ou catégorie, bookmaker, fourchette de cotes",
  agents: AGENTS,
  spec: {
    canaux: F.canaux,
    test: F.test,
    jours: F.jours,
    debut: F.debut,
    paris_par_jour: { kind: "int", description: "Paris par jour (ramené au maximum réglé)", min: 1, max: 500, optional: true },
    theme: { kind: "string", description: "Thème des paris tel que dit (corners, cartons, hors-jeux, buteurs…)", optional: true, maxLength: 60 },
    categorie: { kind: "string", description: "Catégorie de paris existante (si nommée)", optional: true, maxLength: 60 },
    bookmaker: { kind: "string", description: "Bookmaker visé (facultatif)", optional: true, maxLength: 40 },
    cote_min: { kind: "number", description: "Cote minimale", min: 1.01, max: 100, optional: true },
    cote_max: { kind: "number", description: "Cote maximale", min: 1.01, max: 100, optional: true },
    mode: F.mode,
  },
  refine: (p) => (p.cote_min !== undefined && p.cote_max !== undefined && p.cote_min >= p.cote_max ? "cote minimale au-dessus de la cote maximale" : null),
  limits: { maxDays: 30, channels: "team", modes: ["simulation", "real"] },
  async check(deps, p) {
    const scope = await resolveScope(deps, p, T, { teamKey: T, key: "programmer_paris", params: p });
    if (!scope.ok) return refuse(scope.reason, scope.alternatives);
    const choice = await themeChoice(deps, p);
    if (!choice.ok) return choice.check;
    const period = resolvePeriod(p, { now: nowOf(deps), period: null });
    if (p.bookmaker) {
      const cov = await bookmakerCovered(deps, p.bookmaker);
      if (!cov.ok)
        return refuse(`Le fournisseur de cotes ne couvre pas ${p.bookmaker} : je ne devine jamais une cote.`, [
          alt("sans bookmaker imposé", T, "programmer_paris", { ...p, bookmaker: undefined }),
          ...cov.covered.slice(0, 3).map((b) => alt(`chez ${b}`, T, "programmer_paris", { ...p, bookmaker: b })),
        ]);
    }
    const themeText = choice.value.theme ?? (p.theme ? p.theme : null);
    if (!themeText) return ok();
    const av = await marketsAvailable(deps, themeText, { start: period.start, days: period.days }, p.bookmaker ? { bookmakers: [p.bookmaker] } : {});
    if (av.ok) return ok();
    const alternatives: Alternative[] = av.available.slice(0, 4).map((t) => alt(`thème ${t.label}`, T, "programmer_paris", { ...p, theme: t.label, categorie: undefined }));
    if (!alternatives.length) alternatives.push(alt("un pari de test avec les cotes d'essai", T, "pari_unique", {}));
    return refuse(av.reason, alternatives);
  },
  async plan(deps, p, ctx) {
    const scope = await resolveScope(deps, p, T, { teamKey: T, key: "programmer_paris", params: p });
    if (!scope.ok) return [];
    const choice = await themeChoice(deps, p);
    const value: ThemeChoice = choice.ok ? choice.value : { category: null, theme: null };
    const period = resolvePeriod(p, ctx);
    const bounds = await readAlgoBounds(deps);
    const clamped = [...period.clamped];
    const cats = (await clientCategories(deps)).map((c) => toCategory(c));
    // Catégorie du client qui sert de base (marchés, ligues, bookmaker, fourchette). L'ordre travaille TOUJOURS avec une
    // catégorie à lui (copie, jamais active hors de l'ordre) : ses paris ne comptent jamais dans le quota du jour de
    // la catégorie du client, qui garde ses paris pour ses autres canaux (relecture du 25 octobre).
    const custom = !!(p.bookmaker || p.cote_min || p.cote_max);
    const existing =
      value.category && !custom
        ? toCategory(value.category)
        : !custom && value.theme
          ? (cats.find((c) => c.active && themeOfMarkets(c.marketTypes)?.key === value.theme!.key && c.marketTypes.length === value.theme!.marketTypes.length) ?? null)
          : null;
    const base = existing ?? closestCategory(cats, value.theme);
    const perDayRaw = p.paris_par_jour ?? base?.picksPerDay ?? 2;
    const per = clampPerDay(perDayRaw, bounds.maxPostsPerDay, "paris", "réglé pour un canal");
    if (per.note) clamped.push(per.note);
    let minOdds = p.cote_min ?? base?.minOdds ?? 1.5;
    let maxOdds = p.cote_max ?? base?.maxOdds ?? 3.5;
    if (minOdds >= maxOdds) {
      clamped.push(`fourchette de cotes ${minOdds}-${maxOdds} → ${base?.minOdds ?? 1.5}-${base?.maxOdds ?? 3.5}`);
      minOdds = base?.minOdds ?? 1.5;
      maxOdds = base?.maxOdds ?? 3.5;
    }
    // Mode qui s'appliquera : « pour de faux » sur un vrai canal = dérogation de test (publication sur le canal Test).
    const mode = orderModeOf(p, ctx);
    const simulated = mode !== "real";
    const real = scope.channels.filter((c) => !c.isTest);
    if (modeOf(p, ctx) === "real" && !simulated && real.length && (await teamSimulation(deps)))
      clamped.push("l'équipe Paris sportifs est en simulation : les paris iront sur le canal Test tant qu'elle n'est pas passée en vrai");
    if (simulated && real.length) clamped.push(`pour de faux : les paris partent sur le canal Test, ${channelsLabel(real)} garde ses paris habituels`);
    // En vrai : les paris de l'ordre REMPLACENT ceux des catégories du client sur ce canal pendant la période.
    if (!simulated && real.length) {
      const replaced = (await clientCategories(deps)).filter((c) => c.active && Array.isArray(c.channelIds) && real.some((r) => (c.channelIds as unknown[]).includes(r.id)));
      if (replaced.length) clamped.push(`pendant l'ordre, les paris habituels de ${channelsLabel(real)} (${replaced.map((c) => c.name).slice(0, 3).join(", ")}) sont remplacés par ceux de l'ordre`);
    }
    const oddsNote = await oddsCallsNote(deps, { days: period.days, channels: Math.max(1, scope.channels.length), perDay: per.value });
    if (oddsNote) clamped.push(oddsNote);
    const themeLabel = value.theme?.label ?? existing?.name ?? "paris";
    const newCategory = {
      themeKey: value.theme?.key ?? (existing ? existing.key.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() : "paris"),
      label: value.theme?.label ?? themeLabel,
      marketTypes: value.theme?.marketTypes ?? base?.marketTypes ?? [],
      leagues: base?.leagues ?? [],
      bookmakers: p.bookmaker ? [p.bookmaker.toLowerCase().replace(/\s+/g, "")] : (base?.bookmakers ?? []),
      minOdds,
      maxOdds,
      campaignId: base?.campaignId ?? null,
      minMinutesBeforeKickoff: base?.minMinutesBeforeKickoff ?? 30,
      maxOddsDriftPct: base?.maxOddsDriftPct ?? 5,
    };
    const ids = scope.channels.map((c) => c.id);
    const step: OrderStep = {
      stepKey: `programmer_paris:${ids.join(",")}:${value.theme?.key ?? existing?.id ?? "paris"}`,
      capability: "programmer_paris",
      teamKey: T,
      summary: `${per.value} pari${per.value > 1 ? "s" : ""} par jour (${themeLabel}) sur ${channelsLabel(scope.channels)}, ${frRange(period.start, period.toDay)}${simulated ? ", pour de faux" : ", en vrai"}`,
      overrides: scope.channels.map((c) => ({
        channelId: c.id,
        teamKey: T,
        fromDay: period.start,
        toDay: period.toDay,
        picksPerDay: per.value,
        betCategoryId: null,
        themes: value.theme ? [value.theme.key] : null,
        isTest: c.isTest || simulated,
      })),
      touches: touchesOf(scope.channels),
      clamped,
      costCents: 0,
      params: { channelIds: ids, categoryId: null, baseCategoryId: existing?.id ?? null, newCategory, perDay: per.value, fromDay: period.start, toDay: period.toDay, mode, themeLabel },
    };
    return [step];
  },
  async run(deps, order, step) {
    let categoryId = typeof step.params.categoryId === "string" ? step.params.categoryId : null;
    const spec = step.params.newCategory as null | {
      themeKey: string;
      label: string;
      marketTypes: string[];
      leagues: string[];
      bookmakers: string[];
      minOdds: number;
      maxOdds: number;
      campaignId: string | null;
      minMinutesBeforeKickoff: number;
      maxOddsDriftPct: number;
    };
    if (!categoryId && spec) {
      const key = `ordre-${order.number}-${spec.themeKey}`.slice(0, 60);
      const toDay = String(step.params.toDay ?? parisDay(nowOf(deps)));
      const expiresAt = parisDayStart(addDaysToDay(toDay, 1));
      const found = (await deps.prisma.betCategory.findUnique({ where: { key } })) as { id: string } | null;
      if (found) {
        categoryId = found.id;
        await deps.prisma.betCategory.update({ where: { id: found.id }, data: { expiresAt, active: false } });
      } else {
        // Jamais activée : elle ne sert que par la dérogation de l'ordre (le passage habituel ne la voit pas).
        const row = (await deps.prisma.betCategory.create({
          data: {
            key,
            name: `${spec.label.charAt(0).toUpperCase()}${spec.label.slice(1)} (ordre n°${order.number})`,
            sport: "SOCCER",
            marketTypes: spec.marketTypes,
            leagues: spec.leagues,
            bookmakers: spec.bookmakers,
            minOdds: spec.minOdds,
            maxOdds: spec.maxOdds,
            picksPerDay: Number(step.params.perDay ?? 2),
            channelIds: [],
            campaignId: spec.campaignId,
            minMinutesBeforeKickoff: spec.minMinutesBeforeKickoff,
            maxOddsDriftPct: spec.maxOddsDriftPct,
            active: false,
            createdByOrderId: order.id,
            expiresAt,
            sortOrder: 1000,
            updatedById: order.createdById,
          },
        })) as { id: string };
        categoryId = row.id;
        await agentAudit(deps, {
          userId: order.createdById,
          action: "agents.bet_category_created_for_order",
          entityType: "BetCategory",
          entityId: row.id,
          metadata: { orderId: order.id, theme: spec.themeKey, expiresAt: expiresAt.toISOString() },
        });
      }
    }
    if (!categoryId) return failed("Aucune catégorie de paris pour cet ordre.");
    await deps.prisma.channelPlanOverride.updateMany({ where: { orderId: order.id, closedAt: null, betCategoryId: null, teamKey: T }, data: { betCategoryId: categoryId } });
    return done(`Paris programmés : ${step.summary}.`);
  },
  async report(deps, order) {
    return { ...(await missionsReport(deps, order)), ...(await orderPicksFacts(deps, order)) };
  },
});

/** Paris des missions d'un ordre : publiés, gagnés, perdus, annulés, en attente, écartés, cote moyenne, marchés. */
export async function orderPicksFacts(deps: AgentsDeps, order: Pick<OrderRow, "id">): Promise<Record<string, unknown>> {
  const missions = (await deps.prisma.agentMission.findMany({ where: { orderId: order.id }, select: { id: true } })) as Array<{ id: string }>;
  const picks = missions.length
    ? ((await deps.prisma.bettingPick.findMany({ where: { missionId: { in: missions.map((m) => m.id) } } })) as Array<{
        status: string;
        odds: number;
        oddsAtSend: number | null;
        marketLabel: string;
        homeTeam: string;
        awayTeam: string;
        selectionLabel: string;
      }>)
    : [];
  const by = (s: string) => picks.filter((x) => x.status === s).length;
  const published = picks.filter((x) => ["PUBLISHED", "WON", "LOST", "VOID"].includes(x.status));
  const avg = published.length ? Math.round((published.reduce((s, x) => s + (x.oddsAtSend ?? x.odds), 0) / published.length) * 100) / 100 : null;
  return {
    paris: picks.length,
    parisPublies: published.length,
    parisGagnes: by("WON"),
    parisPerdus: by("LOST"),
    parisAnnules: by("VOID"),
    parisEnAttente: by("PROPOSED"),
    parisEcartes: by("SKIPPED"),
    coteMoyenne: avg,
    marches: [...new Set(published.map((x) => x.marketLabel))].slice(0, 6),
    detail: published.slice(0, 8).map((x) => ({ match: `${x.homeTeam} - ${x.awayTeam}`, pari: x.selectionLabel, cote: x.oddsAtSend ?? x.odds, etat: x.status })),
  };
}

// ------------------------------------------------------------------------------------------------ pari_unique

type OneP = { categorie?: string; theme?: string };

async function oneCategory(deps: AgentsDeps, p: OneP): Promise<CatRow | null> {
  const cats = await clientCategories(deps);
  if (p.categorie) return findCategory(p.categorie, cats)[0] ?? null;
  if (p.theme) {
    const t = resolveTheme(p.theme);
    if (!t) return null;
    return cats.find((c) => themeOfMarkets(toCategory(c).marketTypes)?.key === t.key) ?? null;
  }
  return cats.find((c) => c.active) ?? cats[0] ?? null;
}

/** Mission déjà créée par cette étape (reprise sans double). */
async function stepMission(deps: AgentsDeps, orderId: string, stepKey: string): Promise<string | null> {
  const rows = (await deps.prisma.agentMission.findMany({ where: { orderId }, select: { id: true, payload: true } })) as Array<{ id: string; payload: unknown }>;
  return rows.find((r) => (r.payload as { orderStepKey?: unknown } | null)?.orderStepKey === stepKey)?.id ?? null;
}

/** Rattache une mission créée par une fonction existante à l'ordre (identifiant et étape dans la charge utile). */
export async function attachMission(deps: AgentsDeps, missionId: string, order: Pick<OrderRow, "id">, stepKey: string): Promise<void> {
  const row = (await deps.prisma.agentMission.findUnique({ where: { id: missionId }, select: { payload: true } })) as { payload: unknown } | null;
  const payload = { ...((row?.payload as Record<string, unknown> | null) ?? {}), orderId: order.id, orderStepKey: stepKey };
  await deps.prisma.agentMission.update({ where: { id: missionId }, data: { orderId: order.id, payload: JSON.parse(JSON.stringify(payload)) } });
}

export { stepMission };

export const pariUnique = defineCapability<OneP>({
  teamKey: T,
  key: "pari_unique",
  description: "Produire un seul pari de test tout de suite sur le canal Test (cotes d'essai, aucune vraie mise)",
  agents: AGENTS,
  spec: {
    categorie: { kind: "string", description: "Catégorie de paris (facultatif)", optional: true, maxLength: 60 },
    theme: { kind: "string", description: "Thème (corners, cartons…) si pas de catégorie", optional: true, maxLength: 60 },
  },
  limits: { maxDays: 1, maxPerDay: 1, channels: "test", modes: ["simulation"] },
  async check(deps, p) {
    const test = await deps.prisma.channel.findFirst({ where: { isTest: true, isActive: true }, select: { id: true } });
    if (!test) return refuse("Il n'y a pas de canal Test : coche « canal de test » sur un canal (page Canaux).", []);
    if (await oneCategory(deps, p)) return ok();
    const cats = await clientCategories(deps);
    const label = p.categorie ?? p.theme ?? "";
    return refuse(`Aucune catégorie de paris ne correspond à « ${label.slice(0, 60)} ».`, [
      ...(p.theme ? [alt(`programmer des paris ${p.theme} sur le canal Test pendant 1 jour`, T, "programmer_paris", { test: true, jours: 1, theme: p.theme, paris_par_jour: 1 })] : []),
      ...cats.slice(0, 3).map((c) => alt(`un pari de test ${c.name}`, T, "pari_unique", { categorie: c.name })),
    ]);
  },
  async plan(deps, p) {
    const c = await oneCategory(deps, p);
    return [{ stepKey: "pari_unique", capability: "pari_unique", teamKey: T, summary: `un pari de test${c ? ` (${c.name})` : ""} sur le canal Test, pour de faux`, touches: { channelIds: [], testOnly: true }, params: { categoryId: c?.id ?? null } }];
  },
  async run(deps, order, step) {
    const already = await stepMission(deps, order.id, step.stepKey);
    if (already) return done("Pari de test déjà lancé.", { missionIds: [already] });
    const r = await createTestBetMission(deps, { categoryId: typeof step.params.categoryId === "string" ? step.params.categoryId : null, byUserId: order.createdById });
    if (!r.ok) return failed(r.reason);
    await attachMission(deps, r.missionId, order, step.stepKey);
    return done("Pari de test lancé sur le canal Test.", { missionIds: [r.missionId] });
  },
  async report(deps, order) {
    return { ...(await missionsReport(deps, order)), ...(await orderPicksFacts(deps, order)) };
  },
});

// ------------------------------------------------------------------------------------------------ changer_categorie

type ChangeP = { categorie: string; actif?: boolean; paris_par_jour?: number; cote_min?: number; cote_max?: number; ligues?: string[]; canaux?: string[] };

export const changerCategorie = defineCapability<ChangeP>({
  teamKey: T,
  key: "changer_categorie",
  description: "Changer une catégorie de paris : activer, désactiver, paris par jour, fourchette de cotes, ligues, canaux de destination",
  agents: ["cotes"],
  spec: {
    categorie: { kind: "string", description: "Catégorie de paris visée", maxLength: 60 },
    actif: { kind: "bool", description: "true = activer, false = désactiver", optional: true },
    paris_par_jour: { kind: "int", description: "Paris par jour", min: 0, max: 500, optional: true },
    cote_min: { kind: "number", description: "Cote minimale", min: 1.01, max: 100, optional: true },
    cote_max: { kind: "number", description: "Cote maximale", min: 1.01, max: 100, optional: true },
    ligues: { kind: "list", description: "Ligues (identifiants du fournisseur : EPL, LA_LIGA, FR_LIGUE_1…)", optional: true, maxItems: 20 },
    canaux: { kind: "list", description: "Canaux paris de destination", optional: true },
  },
  refine: (p) => (p.cote_min !== undefined && p.cote_max !== undefined && p.cote_min >= p.cote_max ? "cote minimale au-dessus de la cote maximale" : null),
  limits: { channels: "team", modes: ["simulation", "real"] },
  async check(deps, p) {
    const cats = await clientCategories(deps);
    const found = findCategory(p.categorie, cats);
    if (!found.length)
      return refuse(
        `Je ne trouve pas la catégorie de paris « ${p.categorie.slice(0, 60)} ».`,
        cats.slice(0, 4).map((c) => alt(`catégorie ${c.name}`, T, "changer_categorie", { ...p, categorie: c.name })),
      );
    if (p.canaux?.length) {
      const scope = await resolveScope(deps, { canaux: p.canaux }, T, { teamKey: T, key: "changer_categorie", params: p });
      if (!scope.ok) return refuse(scope.reason, scope.alternatives.filter((a) => !a.capability?.params.test));
    }
    return ok();
  },
  async plan(deps, p) {
    const cats = await clientCategories(deps);
    const c = findCategory(p.categorie, cats)[0];
    if (!c) return [];
    const bounds = await readAlgoBounds(deps);
    const clamped: string[] = [];
    const changes: Record<string, unknown> = {};
    if (p.actif !== undefined) changes.active = p.actif;
    if (p.paris_par_jour !== undefined) {
      const v = Math.min(p.paris_par_jour, bounds.maxPostsPerDay);
      if (v !== p.paris_par_jour) clamped.push(`${p.paris_par_jour} paris par jour → ${v}, le maximum réglé`);
      changes.picksPerDay = v;
    }
    const cur = toCategory(c);
    const min = p.cote_min ?? cur.minOdds;
    const max = p.cote_max ?? cur.maxOdds;
    if (p.cote_min !== undefined || p.cote_max !== undefined) {
      if (min < max) Object.assign(changes, { minOdds: min, maxOdds: max });
      else clamped.push(`fourchette ${min}-${max} impossible : inchangée`);
    }
    if (p.ligues?.length) changes.leagues = p.ligues.map((l) => l.toUpperCase().replace(/\s+/g, "_"));
    if (p.canaux?.length) {
      const scope = await resolveScope(deps, { canaux: p.canaux }, T, { teamKey: T, key: "changer_categorie", params: p });
      if (scope.ok) changes.channelIds = scope.channels.filter((x) => !x.isTest).map((x) => x.id);
    }
    const parts = Object.keys(changes).map((k) => ({ active: changes.active ? "activée" : "désactivée", picksPerDay: `${String(changes.picksPerDay)} paris par jour`, minOdds: `cotes ${min} à ${max}`, maxOdds: "", leagues: "ligues changées", channelIds: "canaux changés" })[k]).filter(Boolean);
    // Réglage durable de la catégorie : il touche ses canaux de destination (avant et après), sinon toute l'équipe.
    const dest = new Set<string>([...(Array.isArray(c.channelIds) ? (c.channelIds as string[]) : []), ...((changes.channelIds as string[] | undefined) ?? [])]);
    return [{ stepKey: `changer_categorie:${c.id}`, capability: "changer_categorie", teamKey: T, summary: `catégorie ${c.name} : ${parts.join(", ") || "rien à changer"}`, clamped, touches: settingTouches([...dest], true), params: { categoryId: c.id, changes } }];
  },
  async run(deps, order, step) {
    const id = String(step.params.categoryId ?? "");
    const changes = { ...((step.params.changes as Record<string, unknown>) ?? {}) };
    const row = (await deps.prisma.betCategory.findUnique({ where: { id } })) as CatRow | null;
    if (!row) return failed("Catégorie de paris introuvable.");
    if (row.createdByOrderId) return failed("Cette catégorie appartient à un ordre : elle ne se règle pas à part.");
    const messages: string[] = [];
    if (typeof changes.active === "boolean") {
      messages.push((await setBetCategoryActive(deps, id, changes.active, orderActor(order))).message);
      delete changes.active;
    }
    const keys = Object.keys(changes);
    if (keys.length) {
      await deps.prisma.betCategory.update({ where: { id }, data: { ...(JSON.parse(JSON.stringify(changes)) as object), updatedById: order.createdById } });
      await agentAudit(deps, {
        userId: order.createdById,
        action: "agents.bet_category_saved",
        entityType: "BetCategory",
        entityId: id,
        metadata: { key: row.key, name: row.name, changed: keys, via: "TELEGRAM", orderId: order.id, before: Object.fromEntries(keys.map((k) => [k, row[k] ?? null])), after: changes },
      });
      messages.push(`Catégorie « ${row.name} » mise à jour.`);
    }
    return done(messages.join(" ") || "Rien à changer.");
  },
  async report(deps, order) {
    return { ordre: order.number };
  },
});

// ------------------------------------------------------------------------------------------------ bilan, question

type BilanP = { periode?: "7j" | "28j" };

export const bilan = defineCapability<BilanP>({
  teamKey: T,
  key: "bilan",
  description: "Bilan des paris sur 7 ou 28 jours (publiés, gagnés, perdus, réussite) par catégorie",
  agents: ["cotes"],
  spec: { periode: { kind: "enum", description: "7j ou 28j", values: ["7j", "28j"], optional: true } },
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan(_deps, p) {
    return [{ stepKey: "bilan", capability: "bilan", teamKey: T, summary: `bilan des paris (${p.periode ?? "7j"})`, touches: readOnly(), params: { periode: p.periode ?? "7j" } }];
  },
  async run(deps, _order, step) {
    return done((await betSummaryFacts(deps, step.params.periode === "28j" ? "28j" : "7j")).lines.join("\n"));
  },
  async report(deps, order) {
    const p = (order.interpretation as { steps?: Array<{ params?: { periode?: string } }> } | null)?.steps?.[0]?.params?.periode;
    return (await betSummaryFacts(deps, p === "28j" ? "28j" : "7j")).facts;
  },
});

type QuestionP = { sujet?: string };

/** Faits de l'équipe Paris : paris du jour, écartés (motifs), passages, missions en échec, appels de cotes. */
export async function sportsFacts(deps: AgentsDeps): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const now = nowOf(deps);
  const since = parisDayStart(parisDay(now));
  const yesterday = parisDayStart(addDaysToDay(parisDay(now), -1));
  const [today, skipped, failedMissions, calls, passages] = await Promise.all([
    betsTodayFacts(deps),
    deps.prisma.bettingPick.findMany({ where: { status: "SKIPPED", updatedAt: { gte: yesterday } }, select: { skipReason: true }, take: 20 }) as Promise<Array<{ skipReason: string | null }>>,
    deps.prisma.agentMission.findMany({ where: { teamKey: T, status: { in: ["FAILED", "BLOCKED_BUDGET"] }, updatedAt: { gte: yesterday } }, select: { lastError: true }, take: 20 }) as Promise<Array<{ lastError: string | null }>>,
    oddsCallsThisMonth(deps.prisma, now),
    readSetting(deps, SPORTS_PASSAGES_SETTING),
  ]);
  // Hier (question la plus fréquente : « pourquoi pas de pari hier ? ») : paris retenus et publiés, jour de Paris.
  const yesterdayPicks = (await deps.prisma.bettingPick.findMany({ where: { createdAt: { gte: yesterday, lt: since } }, select: { status: true } })) as Array<{ status: string }>;
  const yesterdayPublished = yesterdayPicks.filter((p) => ["PUBLISHED", "WON", "LOST", "VOID"].includes(p.status)).length;
  const noPick = (await deps.prisma.agentMission.findMany({ where: { teamKey: T, kind: "BET", updatedAt: { gte: yesterday } }, select: { payload: true }, take: 50 })) as Array<{ payload: unknown }>;
  const noPickReasons = noPick.map((m) => (m.payload as { noPickReason?: string } | null)?.noPickReason).filter((x): x is string => !!x);
  const facts = {
    ...today.facts,
    depuisHier: { ecartes: skipped.length, motifsEcartes: [...new Set(skipped.map((s) => s.skipReason).filter(Boolean))].slice(0, 5), sansPari: [...new Set(noPickReasons)].slice(0, 5) },
    hier: { parisRetenus: yesterdayPicks.length, parisPublies: yesterdayPublished },
    missionsEnEchec: failedMissions.length,
    erreurs: [...new Set(failedMissions.map((m) => m.lastError).filter(Boolean))].slice(0, 5),
    appelsCotesCeMois: calls,
    passagesFaitsAujourdhui: (passages as { day?: string; done?: number[] } | undefined)?.day === parisDay(now) ? ((passages as { done?: number[] }).done ?? []) : [],
    depuis: since.toISOString(),
  };
  const lines = [
    ...today.lines,
    yesterdayPicks.length
      ? `Hier : ${yesterdayPicks.length} pari${yesterdayPicks.length > 1 ? "s" : ""} retenu${yesterdayPicks.length > 1 ? "s" : ""}, ${yesterdayPublished} publié${yesterdayPublished > 1 ? "s" : ""}.`
      : "Hier : 0 pari retenu.",
    skipped.length ? `Écartés depuis hier : ${skipped.length} (${facts.depuisHier.motifsEcartes.join(" ; ")})` : "Aucun pari écarté depuis hier.",
    noPickReasons.length ? `Passages sans pari : ${facts.depuisHier.sansPari.join(" ; ")}` : null,
    failedMissions.length ? `Paris ratés en route depuis hier : ${failedMissions.length} (${facts.erreurs.join(" ; ")})` : null,
  ].filter((l): l is string => !!l);
  return { facts, lines };
}

export const questionSports = defineCapability<QuestionP>({
  teamKey: T,
  key: "question",
  description: "Répondre à une question sur l'équipe Paris sportifs (paris du jour, cotes, résultats, pourquoi pas de pari)",
  agents: AGENTS,
  spec: { sujet: { kind: "string", description: "La question telle que posée", optional: true, maxLength: 200 } },
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan(_deps, p) {
    return [{ stepKey: "question", capability: "question", teamKey: T, summary: "question à l'équipe Paris sportifs", touches: readOnly(), params: { sujet: p.sujet ?? null } }];
  },
  async run(deps) {
    return done((await sportsFacts(deps)).lines.join("\n"));
  },
  async report(deps) {
    return (await sportsFacts(deps)).facts;
  },
});

export const SPORTS_CAPABILITIES = [programmerParis, pariUnique, changerCategorie, bilan, questionSports];
