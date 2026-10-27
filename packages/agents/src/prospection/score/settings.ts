/**
 * Phase 31, chantier C — réglages et petites règles communes de l'Évaluateur et du Pipeline (lecture des `Setting`,
 * périmètre des pays, lecture prudente des colonnes JSON d'un prospect). Aucun texte envoyé ici.
 */
import { PROSPECTION_SETTINGS, type ProspectionDeps, type ProspectRegion, type ScoreWeights } from "../contract";

export const prospectionNow = (deps: Pick<ProspectionDeps, "now" | "clock">): Date =>
  deps.now ? deps.now() : deps.clock ? new Date(deps.clock()) : new Date();

/** Valeur brute d'un `Setting` (forme `{ value }` acceptée), `undefined` si absent ou base illisible. */
export async function rawProspectionSetting(deps: Pick<ProspectionDeps, "prisma">, key: string): Promise<unknown> {
  try {
    const row = await deps.prisma.setting.findUnique({ where: { key } });
    const v = row?.value as unknown;
    if (v && typeof v === "object" && !Array.isArray(v) && "value" in (v as Record<string, unknown>) && Object.keys(v as object).length === 1)
      return (v as Record<string, unknown>).value;
    return v ?? undefined;
  } catch {
    return undefined;
  }
}

export async function numberSetting(deps: Pick<ProspectionDeps, "prisma">, key: string, fallback: number): Promise<number> {
  const v = await rawProspectionSetting(deps, key);
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export async function boolSetting(deps: Pick<ProspectionDeps, "prisma">, key: string, fallback: boolean): Promise<boolean> {
  const v = await rawProspectionSetting(deps, key);
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1) return true;
  if (v === "false" || v === 0) return false;
  return fallback;
}

export type ScoreSettings = { weights: ScoreWeights; qualified: number; tierA: number; tierB: number };

export const DEFAULT_SCORE_SETTINGS: ScoreSettings = {
  weights: { ...PROSPECTION_SETTINGS.weights.value },
  qualified: PROSPECTION_SETTINGS.qualifiedThreshold.value,
  tierA: PROSPECTION_SETTINGS.tierAThreshold.value,
  tierB: PROSPECTION_SETTINGS.tierBThreshold.value,
};

/** Poids lus en base, chaque poids absent ou invalide remplacé par sa valeur par défaut. */
export function weightsOf(v: unknown): ScoreWeights {
  const def = PROSPECTION_SETTINGS.weights.value;
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const one = (k: keyof ScoreWeights) => {
    const n = typeof o[k] === "number" ? (o[k] as number) : typeof o[k] === "string" ? Number(o[k]) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : def[k];
  };
  return { audience: one("audience"), engagement: one("engagement"), fit: one("fit"), openness: one("openness"), competition: one("competition"), reach: one("reach") };
}

export async function loadScoreSettings(deps: Pick<ProspectionDeps, "prisma">): Promise<ScoreSettings> {
  const [w, q, a, b] = await Promise.all([
    rawProspectionSetting(deps, PROSPECTION_SETTINGS.weights.key),
    numberSetting(deps, PROSPECTION_SETTINGS.qualifiedThreshold.key, DEFAULT_SCORE_SETTINGS.qualified),
    numberSetting(deps, PROSPECTION_SETTINGS.tierAThreshold.key, DEFAULT_SCORE_SETTINGS.tierA),
    numberSetting(deps, PROSPECTION_SETTINGS.tierBThreshold.key, DEFAULT_SCORE_SETTINGS.tierB),
  ]);
  return { weights: weightsOf(w), qualified: q, tierA: a, tierB: b };
}

/** Périmètre des pays (`prospection.countries_scope`), en majuscules. */
export async function loadCountriesScope(deps: Pick<ProspectionDeps, "prisma">): Promise<string[]> {
  const v = await rawProspectionSetting(deps, PROSPECTION_SETTINGS.countriesScope.key);
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().toUpperCase()) : [];
  return list.length ? list : [...PROSPECTION_SETTINGS.countriesScope.value];
}

/** Lecture prudente des colonnes JSON. */
export function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
export function objectOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Un prospect est-il visible dans les listes et les comptages ? EU (ou région inconnue : plafonnée par le score) oui ;
 * NON_EU jamais, sauf si le client a élargi le périmètre et que le premier pays y est.
 */
export function regionVisible(p: { region: ProspectRegion | string; countries?: unknown }, scope: readonly string[], opts: { allowUnknown?: boolean } = {}): boolean {
  if (p.region === "EU") return true;
  if (p.region === "UNKNOWN") return opts.allowUnknown !== false;
  const first = stringArray(p.countries)[0]?.toUpperCase();
  return !!first && scope.includes(first);
}

export const DAY_MS = 24 * 3600_000;
