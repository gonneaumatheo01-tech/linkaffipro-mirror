/**
 * Phase 31, chantier A (Sourceur) : aiguillage des lots de découverte et planification de la nuit.
 *
 * - `runDiscovery(deps, lot)` : une source × des langues × une verticale → candidats → `upsertCandidates`. Source en
 *   pause (ou prospection coupée) → résultat `paused: true` sans aucune requête réseau, journalisé.
 * - `planDiscoveryLots(deps, now)` : lots de la nuit, 4 langues par nuit (les 26 couvertes en 7 jours), les deux
 *   verticales, sources annuaires / web / réseaux / Analystes ; rotation dans `Setting prospection.rotation`
 *   (même nuit replanifiée = mêmes langues).
 * - `requestDiscovery(deps, { countries, vertical, requestId })` : lot dédié demandé par le client (« cherche des canaux
 *   casino en Pologne ») sur les sources A à C, dans les langues du pays, enfilé dans `agents-prospection`.
 * Le graphe passe par `expandGraph` (après chaque lecture) et le manuel par `addManualProspect`.
 */
import { readSetting, writeSetting } from "../../admin/journal";
import { parisDay } from "../../rules/time";
import { QUERY_LANGUAGES, countryLanguages } from "../dict";
import { PROSPECTION_SETTINGS, type DiscoveryLot, type DiscoverySource, type ProspectDiscoveryResult, type ProspectionDeps } from "../contract";
import { upsertCandidates } from "./dedupe";
import { prospectionClockOf, sourcePause, type PoliteProspectDeps } from "./polite";
import { findAnalystsCandidates } from "./sources/analysts";
import type { SourceFindResult } from "./sources/common";
import { findDirectoryCandidates } from "./sources/directories";
import { findSocialCandidates } from "./sources/social";
import { findWebSearchCandidates } from "./sources/web-search";

/** Langues par nuit : 26 langues ÷ 7 nuits → 4. */
export const LANGUAGES_PER_NIGHT = 4;

/** Type de source inscrit au journal (`ProspectSourceRun.sourceType`). */
export const RUN_SOURCE_TYPE: Record<DiscoverySource, string> = {
  directories: "DIRECTORY",
  web_search: "WEB_SEARCH",
  social: "SOCIAL",
  graph: "GRAPH",
  analysts: "ANALYSTS",
  manual: "MANUAL",
};

/** Clé de pause d'une source entière (les annuaires ont une pause par domaine, gérée par la source). */
export const SOURCE_PAUSE_KEYS: Partial<Record<DiscoverySource, string>> = { web_search: "web_search", social: "social", analysts: "analysts" };

export type RotationState = { index: number; lastRunDay?: string; lastStart?: number };

async function isEnabled(deps: ProspectionDeps): Promise<boolean> {
  const v = await readSetting(deps, PROSPECTION_SETTINGS.enabled.key);
  return v === undefined || v === null ? PROSPECTION_SETTINGS.enabled.value : v !== false;
}

async function verticals(deps: ProspectionDeps): Promise<Array<"SPORTS" | "CASINO">> {
  const v = await readSetting(deps, PROSPECTION_SETTINGS.verticals.key);
  const list = Array.isArray(v) ? v : PROSPECTION_SETTINGS.verticals.value;
  const out = list.filter((x): x is "SPORTS" | "CASINO" => x === "SPORTS" || x === "CASINO");
  return out.length ? out : ["SPORTS", "CASINO"];
}

export async function runDiscovery(deps: ProspectionDeps & PoliteProspectDeps, lot: DiscoveryLot): Promise<ProspectDiscoveryResult> {
  const run = { sourceType: RUN_SOURCE_TYPE[lot.source] ?? lot.source, sourceDetail: lot.requestId ? `demande ${lot.requestId}` : null, languages: lot.languages, vertical: lot.vertical };
  const stop = (reason: string, pausedUntil: Date) => upsertCandidates(deps, [], run, { pausedUntil, errors: [reason] });

  if (!(await isEnabled(deps))) return stop("Prospection en pause (réglage) : rien n'est lu.", new Date(prospectionClockOf(deps)));
  const pauseKey = SOURCE_PAUSE_KEYS[lot.source];
  if (pauseKey) {
    const p = await sourcePause(deps, pauseKey);
    if (p) return stop(`Source en pause jusqu'au ${p.until} (${p.reason}).`, new Date(p.until));
  }

  let found: SourceFindResult;
  switch (lot.source) {
    case "directories":
      found = await findDirectoryCandidates(deps, lot);
      break;
    case "web_search":
      found = await findWebSearchCandidates(deps, lot);
      break;
    case "social":
      found = await findSocialCandidates(deps, lot);
      break;
    case "analysts":
      found = await findAnalystsCandidates(deps, lot);
      break;
    default:
      return upsertCandidates(deps, [], run, { errors: [`La source ${lot.source} ne passe pas par un lot (graphe : après chaque lecture ; manuel : addManualProspect).`] });
  }
  return upsertCandidates(deps, found.candidates, { ...run, sourceDetail: run.sourceDetail ?? found.detail }, { errors: found.errors, pausedUntil: found.paused ? found.pausedUntil : null });
}

/** Langues de la nuit (rotation sur la liste des 26). Pur. */
export function nightLanguages(start: number, count = LANGUAGES_PER_NIGHT): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(QUERY_LANGUAGES[(start + i) % QUERY_LANGUAGES.length]!);
  return out;
}

export async function planDiscoveryLots(deps: ProspectionDeps, now: Date): Promise<DiscoveryLot[]> {
  if (!(await isEnabled(deps))) return [];
  const raw = await readSetting(deps, PROSPECTION_SETTINGS.rotation.key);
  const rot: RotationState = raw && typeof raw === "object" ? (raw as RotationState) : { index: 0 };
  const day = parisDay(now);
  const n = QUERY_LANGUAGES.length;
  const start = rot.lastRunDay === day && typeof rot.lastStart === "number" ? rot.lastStart : (((Number(rot.index) || 0) % n) + n) % n;
  if (rot.lastRunDay !== day) await writeSetting(deps, PROSPECTION_SETTINGS.rotation.key, { index: (start + LANGUAGES_PER_NIGHT) % n, lastRunDay: day, lastStart: start });
  const languages = nightLanguages(start);
  // Phase 32 : répartition de la recherche acceptée par le client (calibrage) → nombre de lots par source.
  const counts = lotsPerSource(await readSetting(deps, DISCOVERY_SHARES_SETTING));
  const lots: DiscoveryLot[] = [];
  for (const vertical of await verticals(deps)) {
    for (const source of ["directories", "web_search", "social"] as const)
      for (let i = 0; i < counts[source]; i++) lots.push({ source, languages: i === 0 ? languages : nightLanguages(start + LANGUAGES_PER_NIGHT * i), vertical });
    for (let i = 0; i < counts.analysts; i++) lots.push({ source: "analysts", languages: [], vertical });
  }
  return lots;
}

/** Réglage écrit par le calibrage de la phase 32 (`learn/calibrate.ts`, `DISCOVERY_SHARES_KEY`), parts par source. */
export const DISCOVERY_SHARES_SETTING = "prospection.discovery_shares";
type LotSource = "directories" | "web_search" | "social" | "analysts";
const LOT_SOURCES: readonly LotSource[] = ["directories", "web_search", "social", "analysts"];
const SHARE_SOURCES = ["directories", "web_search", "social", "graph", "analysts"] as const;

/**
 * Lots de nuit par source (pur) : sans réglage, 1 lot chacune (comme en phase 31). Avec une répartition acceptée par le
 * client (parts normalisées sur les 5 sources, graphe compris), 0 lot sous 10 %, 2 lots à partir de 30 %, sinon 1.
 * Au moins un lot reste toujours planifié.
 */
export function lotsPerSource(raw: unknown): Record<LotSource, number> {
  const one: Record<LotSource, number> = { directories: 1, web_search: 1, social: 1, analysts: 1 };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return one;
  const o = raw as Record<string, unknown>;
  const vals = SHARE_SOURCES.map((k) => (typeof o[k] === "number" && Number.isFinite(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : 0.2));
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum <= 0) return one;
  const out = { ...one };
  for (const k of LOT_SOURCES) {
    const share = vals[SHARE_SOURCES.indexOf(k)]! / sum;
    out[k] = share < 0.1 ? 0 : share >= 0.3 ? 2 : 1;
  }
  if (LOT_SOURCES.every((k) => out[k] === 0)) out.web_search = 1;
  return out;
}

export type DiscoveryRequest = { countries: string[]; vertical: "SPORTS" | "CASINO"; requestId: string };

/** Lot dédié à une demande du client (sources A à C, langues du pays), enfilé s'il y a une file. */
export async function requestDiscovery(deps: ProspectionDeps, req: DiscoveryRequest): Promise<{ lots: DiscoveryLot[]; languages: string[]; enqueued: number }> {
  const countries = [...new Set(req.countries.map((c) => c.toUpperCase()))];
  const covered = new Set<string>(QUERY_LANGUAGES);
  let languages = [...new Set(countries.flatMap(countryLanguages))].filter((l) => covered.has(l));
  if (!languages.length) languages = ["en"];
  const lots: DiscoveryLot[] = (["directories", "web_search", "social"] as const).map((source) => ({ source, languages, vertical: req.vertical, countries, requestId: req.requestId }));
  let enqueued = 0;
  const enqueue = deps.prospection?.enqueue;
  if (enqueue)
    for (const lot of lots) {
      await enqueue({ type: "prospection.discover", lot }, { jobId: `prospection.discover:${req.requestId}:${lot.source}` });
      enqueued++;
    }
  return { lots, languages, enqueued };
}
