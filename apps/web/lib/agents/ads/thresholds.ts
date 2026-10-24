/**
 * Seuils de l'Agent Ads par univers (`Setting` `agents.ads.thresholds`, type `AdsThresholds` du contrat) : lecture
 * tolérante, valeurs de départ, lecture du formulaire. Fonctions pures, testées (ads.test.ts).
 *
 * Coût par inscription visé et retour sur dépense pub minimal laissés vides = « automatique » : le moteur prend la
 * valeur du milieu de vos pubs comparables (médiane). Jours d'observation et dépense minimale ont toujours une
 * valeur : en dessous, une pub est seulement « à surveiller ».
 */
import type { AdsThresholds } from "@linkaffipro/agents";

export const ADS_THRESHOLDS_KEY = "agents.ads.thresholds";

export const ADS_UNIVERSES = ["CASINO", "SPORTS", "DATING"] as const satisfies readonly (keyof AdsThresholds)[];
export type AdsUniverse = (typeof ADS_UNIVERSES)[number];

export type UniverseThresholds = AdsThresholds[AdsUniverse];

/** Valeurs de départ (au moins 3 jours et 20 € de dépense par pub avant de conclure). */
export const DEFAULT_UNIVERSE_THRESHOLDS: UniverseThresholds = {
  targetCostPerRegistration: null,
  minRoas: null,
  observationDays: 3,
  minSpend: 20,
};

export const THRESHOLD_BOUNDS = {
  targetCostPerRegistration: { min: 0.5, max: 10_000 },
  minRoas: { min: 0.1, max: 50 },
  observationDays: { min: 1, max: 60 },
  minSpend: { min: 0, max: 100_000 },
} as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function numOr<T extends number | null>(v: unknown, fallback: T, min: number, max: number): number | T {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

export function parseUniverseThresholds(v: unknown): UniverseThresholds {
  const o = isObj(v) ? v : {};
  const b = THRESHOLD_BOUNDS;
  const d = DEFAULT_UNIVERSE_THRESHOLDS;
  return {
    targetCostPerRegistration: numOr(o.targetCostPerRegistration, null, b.targetCostPerRegistration.min, b.targetCostPerRegistration.max),
    minRoas: numOr(o.minRoas, null, b.minRoas.min, b.minRoas.max),
    observationDays: Math.round(numOr(o.observationDays, d.observationDays, b.observationDays.min, b.observationDays.max)),
    minSpend: numOr(o.minSpend, d.minSpend, b.minSpend.min, b.minSpend.max),
  };
}

/** Seuils enregistrés (valeurs de départ pour ce qui manque ou sort des bornes). */
export function parseAdsThresholds(v: unknown): AdsThresholds {
  const o = isObj(v) ? v : {};
  return {
    CASINO: parseUniverseThresholds(o.CASINO),
    SPORTS: parseUniverseThresholds(o.SPORTS),
    DATING: parseUniverseThresholds(o.DATING),
  };
}

/** « 12,5 » ou « 12.5 » → 12,5 ; vide → null ; texte illisible → NaN. */
function readNumber(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s|€|×|x/gi, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

const UNIVERSE_WORDS: Record<AdsUniverse, string> = { CASINO: "Casino", SPORTS: "Paris sportifs", DATING: "Rencontres" };

/** Champs du formulaire : `<UNIVERS>.<clé>` (ex. `CASINO.minSpend`). */
export function thresholdField(u: AdsUniverse, key: keyof UniverseThresholds): string {
  return `${u}.${key}`;
}

export function parseAdsThresholdsForm(
  fd: FormData,
): { ok: true; data: AdsThresholds } | { ok: false; error: string } {
  const out = {} as AdsThresholds;
  const b = THRESHOLD_BOUNDS;
  for (const u of ADS_UNIVERSES) {
    const name = UNIVERSE_WORDS[u];
    const cpr = readNumber(fd.get(thresholdField(u, "targetCostPerRegistration")));
    const roas = readNumber(fd.get(thresholdField(u, "minRoas")));
    const days = readNumber(fd.get(thresholdField(u, "observationDays")));
    const spend = readNumber(fd.get(thresholdField(u, "minSpend")));
    if (cpr !== null && !(cpr >= b.targetCostPerRegistration.min && cpr <= b.targetCostPerRegistration.max))
      return { ok: false, error: `${name} : coût par inscription visé entre 0,50 € et 10 000 €, ou vide (automatique).` };
    if (roas !== null && !(roas >= b.minRoas.min && roas <= b.minRoas.max))
      return { ok: false, error: `${name} : retour sur dépense pub minimal entre 0,1 et 50, ou vide (automatique).` };
    if (days === null || !(days >= b.observationDays.min && days <= b.observationDays.max) || !Number.isInteger(days))
      return { ok: false, error: `${name} : jours d'observation, un nombre entier entre 1 et 60.` };
    if (spend === null || !(spend >= b.minSpend.min && spend <= b.minSpend.max))
      return { ok: false, error: `${name} : dépense minimale entre 0 € et 100 000 €.` };
    out[u] = { targetCostPerRegistration: cpr, minRoas: roas, observationDays: days, minSpend: spend };
  }
  return { ok: true, data: out };
}

/** Valeur d'un champ (« 12,5 » ; vide pour « automatique »). */
export function fieldValue(v: number | null): string {
  return v === null ? "" : String(v).replace(".", ",");
}

export { UNIVERSE_WORDS as ADS_UNIVERSE_WORDS };
