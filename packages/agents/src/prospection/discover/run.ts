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
  const lots: DiscoveryLot[] = [];
  for (const vertical of await verticals(deps)) {
    for (const source of ["directories", "web_search", "social"] as const) lots.push({ source, languages, vertical });
    lots.push({ source: "analysts", languages: [], vertical });
  }
  return lots;
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
