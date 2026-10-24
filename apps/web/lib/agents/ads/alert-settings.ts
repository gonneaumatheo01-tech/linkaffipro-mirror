/**
 * Réglages des alertes de l'Agent Ads (`Setting` `agents.ads.alerts`, lus par le moteur dans
 * `packages/agents/src/agents/ads/alerts.ts` : `parseAdsAlertSettings`) : valeurs de départ, bornes, lecture du
 * formulaire de `/agents/ads` (section Seuils, ADMIN). Mêmes clés, défauts et bornes que le moteur (vérifié par
 * ads.test.ts) : une valeur enregistrée ici est toujours celle que le moteur utilise. Fonctions pures.
 */

export const ADS_ALERTS_KEY = "agents.ads.alerts";

export type AdsAlertSettingsValues = { spikePct: number; dropPct: number; minDailySpend: number; minRegistrations: number };

export const ADS_ALERT_DEFAULTS: AdsAlertSettingsValues = { spikePct: 50, dropPct: 50, minDailySpend: 10, minRegistrations: 5 };

export const ADS_ALERT_BOUNDS: Record<keyof AdsAlertSettingsValues, { min: number; max: number; integer: boolean }> = {
  spikePct: { min: 1, max: 1000, integer: true },
  dropPct: { min: 1, max: 100, integer: true },
  minDailySpend: { min: 0, max: 100_000, integer: false },
  minRegistrations: { min: 1, max: 10_000, integer: true },
};

export const ADS_ALERT_FIELDS: Array<{ key: keyof AdsAlertSettingsValues; label: string; hint: string; unit: string }> = [
  {
    key: "spikePct",
    label: "Hausse de dépense qui déclenche l'alerte",
    hint: "Dépense d'une campagne (aujourd'hui ou hier) au-dessus de sa moyenne des 7 jours de plus de ce pourcentage.",
    unit: "%",
  },
  {
    key: "minDailySpend",
    label: "Dépense moyenne minimale par jour",
    hint: "En dessous (moyenne des 7 jours d'une campagne), pas d'alerte « dépense anormale ».",
    unit: "€",
  },
  {
    key: "dropPct",
    label: "Baisse des inscriptions qui déclenche l'alerte",
    hint: "Inscriptions d'une campagne sur 7 jours comparées aux 7 jours d'avant, alors qu'elle dépense toujours.",
    unit: "%",
  },
  {
    key: "minRegistrations",
    label: "Inscriptions minimales avant de comparer",
    hint: "Moins d'inscriptions les 7 jours d'avant : pas d'alerte « chute des inscriptions ».",
    unit: "inscriptions",
  },
];

/** Champ du formulaire (préfixe pour ne pas croiser les seuils par univers). */
export function alertField(key: keyof AdsAlertSettingsValues): string {
  return `alerts.${key}`;
}

function inBounds(key: keyof AdsAlertSettingsValues, v: unknown): v is number {
  const b = ADS_ALERT_BOUNDS[key];
  return typeof v === "number" && Number.isFinite(v) && v >= b.min && v <= b.max;
}

/** Réglages enregistrés (valeurs de départ pour ce qui manque ou sort des bornes, comme le moteur). */
export function parseAdsAlertSettingsValue(v: unknown): AdsAlertSettingsValues {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out = { ...ADS_ALERT_DEFAULTS };
  for (const key of Object.keys(ADS_ALERT_DEFAULTS) as Array<keyof AdsAlertSettingsValues>)
    if (inBounds(key, o[key])) out[key] = o[key] as number;
  return out;
}

function readNumber(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s|€|%/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

const fr = (n: number) => n.toLocaleString("fr-FR");

export function parseAdsAlertSettingsForm(
  fd: FormData,
): { ok: true; data: AdsAlertSettingsValues } | { ok: false; error: string } {
  const out = { ...ADS_ALERT_DEFAULTS };
  for (const f of ADS_ALERT_FIELDS) {
    const b = ADS_ALERT_BOUNDS[f.key];
    const n = readNumber(fd.get(alertField(f.key)));
    if (n === null || !inBounds(f.key, n) || (b.integer && !Number.isInteger(n)))
      return {
        ok: false,
        error: `${f.label} : ${b.integer ? "un nombre entier" : "un nombre"} entre ${fr(b.min)} et ${fr(b.max)}${f.unit === "€" ? " €" : f.unit === "%" ? " %" : ""}.`,
      };
    out[f.key] = n;
  }
  return { ok: true, data: out };
}
