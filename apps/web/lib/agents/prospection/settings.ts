/**
 * Phase 31 — réglages de l'équipe Prospection (administrateurs) : lecture des `Setting` (valeur par défaut du contrat
 * quand rien n'est enregistré), lecture du formulaire avec bornes, et différences « avant → après » pour le journal et
 * l'aperçu de Kevin. Les valeurs sont enregistrées telles quelles (`Setting.value` = nombre, booléen, liste ou objet),
 * forme lue par l'équipe (`prospection/score/settings.ts`). Règles pures.
 */
import { DEFAULT_COUNTRIES_SCOPE, PROSPECTION_SETTINGS, type ScoreWeights } from "@linkaffipro/agents";
import { weightsOf } from "./display";

export type NumberField = {
  name: string;
  key: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  /** Unité affichée et facteur d'enregistrement (budget : euros saisis, centimes enregistrés). */
  unit?: string;
  factor?: number;
  group: "liste" | "lecture" | "niveaux" | "rappels" | "plafonds";
};

const S = PROSPECTION_SETTINGS;

export const NUMBER_FIELDS: readonly NumberField[] = [
  { name: "dailyTopCount", key: S.dailyTopCount.key, label: "Canaux dans la liste du matin", hint: "Combien de canaux Kevin vous envoie chaque matin.", min: 1, max: 30, group: "liste" },
  { name: "dailyTopHour", key: S.dailyTopHour.key, label: "Heure de la liste du matin", hint: "Heure de Paris (0 à 23).", min: 0, max: 23, unit: "h", group: "liste" },
  { name: "minPosts30d", key: S.minPosts30d.key, label: "Posts sur 30 jours au moins", hint: "En dessous, le canal est jugé trop peu actif.", min: 0, max: 300, group: "lecture" },
  { name: "minMedianViews", key: S.minMedianViews.key, label: "Vues par post au moins", hint: "En dessous, l'audience est jugée trop faible.", min: 0, max: 100_000, group: "lecture" },
  { name: "graphMaxDepth", key: S.graphMaxDepth.key, label: "Profondeur de recherche de canal en canal", hint: "Combien de fois l'équipe suit un canal cité par un canal cité.", min: 0, max: 5, group: "lecture" },
  { name: "qualifiedThreshold", key: S.qualifiedThreshold.key, label: "Note minimale pour être gardé", hint: "En dessous, le canal est écarté (niveau D).", min: 0, max: 100, group: "niveaux" },
  { name: "tierBThreshold", key: S.tierBThreshold.key, label: "Note du niveau B", hint: "À partir de cette note, le canal est de niveau B.", min: 0, max: 100, group: "niveaux" },
  { name: "tierAThreshold", key: S.tierAThreshold.key, label: "Note du niveau A", hint: "À partir de cette note, le canal est de niveau A.", min: 0, max: 100, group: "niveaux" },
  { name: "reminderDays", key: S.reminderDays.key, label: "Relance après un contact sans réponse", hint: "En jours.", min: 1, max: 60, unit: "j", group: "rappels" },
  { name: "negotiationReminderDays", key: S.negotiationReminderDays.key, label: "Rappel d'une discussion qui dure", hint: "En jours.", min: 1, max: 90, unit: "j", group: "rappels" },
  { name: "remindersDailyCap", key: S.remindersDailyCap.key, label: "Rappels par jour au plus", hint: "Kevin ne vous envoie pas plus de rappels que cela.", min: 0, max: 30, group: "rappels" },
  { name: "discoveryDailyCap", key: S.discoveryDailyCap.key, label: "Nouveaux canaux trouvés par jour au plus", hint: "Toutes sources confondues.", min: 0, max: 2000, group: "plafonds" },
  { name: "enrichDailyCap", key: S.enrichDailyCap.key, label: "Canaux lus par jour au plus", hint: "Chaque canal est lu doucement (une page toutes les 3 secondes).", min: 0, max: 1000, group: "plafonds" },
  { name: "dossierWeeklyCap", key: S.dossierWeeklyCap.key, label: "Dossiers détaillés par semaine au plus", hint: "Pour les meilleurs canaux.", min: 0, max: 200, group: "plafonds" },
  { name: "monthlyBudget", key: S.monthlyBudgetCents.key, label: "Dépense mensuelle de l'IA au plus", hint: "En euros, recherches sur internet comprises.", min: 0, max: 500, unit: "€", factor: 100, group: "plafonds" },
];

export const BOOL_FIELDS = [
  { name: "enabled", key: S.enabled.key, label: "Prospection activée", hint: "Coupée : plus aucune recherche ni lecture, plus de liste le matin." },
  { name: "remindersWeekend", key: S.remindersWeekend.key, label: "Rappels le week-end", hint: "Par défaut, Kevin ne vous relance pas le samedi ni le dimanche." },
  { name: "pitchDrafts", key: S.pitchDrafts.key, label: "Proposer deux idées de premier message dans les dossiers", hint: "Jamais envoyées : c'est vous qui contactez." },
] as const;

export const WEIGHT_FIELDS: ReadonlyArray<{ name: keyof ScoreWeights; label: string }> = [
  { name: "audience", label: "Audience" },
  { name: "engagement", label: "Réactions des lecteurs" },
  { name: "fit", label: "Adéquation avec vos offres" },
  { name: "openness", label: "Ouverture aux partenariats" },
  { name: "competition", label: "Concurrence" },
  { name: "reach", label: "Facilité à joindre" },
];

export const VERTICAL_CHOICES = [
  { value: "SPORTS", label: "Paris sportifs" },
  { value: "CASINO", label: "Casino" },
] as const;

export type ProspectionSettings = {
  numbers: Record<string, number>;
  bools: Record<string, boolean>;
  weights: ScoreWeights;
  verticals: string[];
  countriesScope: string[];
};

type Raw = Record<string, unknown>;

const unwrap = (v: unknown): unknown =>
  v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && "value" in (v as Raw) ? (v as Raw).value : v;

const DEFAULTS_BY_KEY: Record<string, unknown> = Object.fromEntries(Object.values(S).map((x) => [x.key, x.value]));

/** Réglages lus (lignes `Setting` déjà chargées, clé → valeur). */
export function readProspectionSettings(rows: Record<string, unknown>): ProspectionSettings {
  const get = (key: string) => {
    const v = unwrap(rows[key]);
    return v === undefined || v === null ? DEFAULTS_BY_KEY[key] : v;
  };
  const numbers: Record<string, number> = {};
  for (const f of NUMBER_FIELDS) {
    const v = get(f.key);
    const n = typeof v === "number" ? v : Number(v);
    numbers[f.name] = Number.isFinite(n) ? n / (f.factor ?? 1) : Number(DEFAULTS_BY_KEY[f.key]) / (f.factor ?? 1);
  }
  const bools: Record<string, boolean> = {};
  for (const f of BOOL_FIELDS) {
    const v = get(f.key);
    bools[f.name] = typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : Boolean(DEFAULTS_BY_KEY[f.key]);
  }
  const list = (v: unknown, fallback: readonly string[]) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.toUpperCase()) : [...fallback];
  return {
    numbers,
    bools,
    weights: weightsOf(get(S.weights.key)),
    verticals: list(get(S.verticals.key), S.verticals.value),
    countriesScope: list(get(S.countriesScope.key), DEFAULT_COUNTRIES_SCOPE),
  };
}

export const SETTINGS_KEYS: string[] = [
  ...NUMBER_FIELDS.map((f) => f.key),
  ...BOOL_FIELDS.map((f) => f.key),
  S.weights.key,
  S.verticals.key,
  S.countriesScope.key,
];

export type SettingsParse = { ok: true; values: Record<string, unknown> } | { ok: false; error: string; field: string };

const formNum = (fd: FormData, name: string): number | null => {
  const raw = fd.get(name);
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Formulaire → valeurs à enregistrer (clé `Setting` → valeur). Un champ absent garde sa valeur actuelle (Kevin ne
 * change souvent qu'un réglage) ; les cases à cocher ne comptent que si `withBools` est présent (formulaire complet du
 * site), ou si Kevin donne la valeur explicitement (`<nom>` = on / off).
 */
export function parseSettingsForm(fd: FormData, current: ProspectionSettings): SettingsParse {
  const values: Record<string, unknown> = {};
  const numbers = { ...current.numbers };
  for (const f of NUMBER_FIELDS) {
    const n = formNum(fd, f.name);
    if (n === null) continue;
    if (Number.isNaN(n) || n < f.min || n > f.max || (f.factor ? false : !Number.isInteger(n)))
      return { ok: false, error: `« ${f.label} » : entre ${f.min} et ${f.max}${f.unit ? ` ${f.unit}` : ""}.`, field: f.name };
    numbers[f.name] = n;
    values[f.key] = f.factor ? Math.round(n * f.factor) : n;
  }
  if (!(numbers.qualifiedThreshold! < numbers.tierBThreshold! && numbers.tierBThreshold! < numbers.tierAThreshold!))
    return { ok: false, error: "Les notes doivent monter : note minimale < niveau B < niveau A.", field: "tierBThreshold" };

  const full = fd.get("withBools") === "on" || fd.get("withBools") === "1";
  for (const f of BOOL_FIELDS) {
    const raw = fd.get(f.name);
    if (full) values[f.key] = raw === "on";
    else if (raw === "on" || raw === "off") values[f.key] = raw === "on";
  }

  const weightsGiven = WEIGHT_FIELDS.some((w) => formNum(fd, `weight_${w.name}`) !== null);
  if (weightsGiven) {
    const w = { ...current.weights };
    for (const f of WEIGHT_FIELDS) {
      const n = formNum(fd, `weight_${f.name}`);
      if (n === null) continue;
      if (Number.isNaN(n) || n < 0 || n > 100 || !Number.isInteger(n)) return { ok: false, error: `Poids « ${f.label} » : un nombre entier de 0 à 100.`, field: `weight_${f.name}` };
      w[f.name] = n;
    }
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    if (sum !== 100) return { ok: false, error: `Les poids doivent faire 100 au total (ils font ${sum}).`, field: "weight_audience" };
    values[S.weights.key] = w;
  }

  const verticals = fd.getAll("verticals").map(String).filter((v) => v === "SPORTS" || v === "CASINO");
  if (full || verticals.length) {
    if (!verticals.length) return { ok: false, error: "Choisissez au moins un marché : paris sportifs ou casino.", field: "verticals" };
    values[S.verticals.key] = [...new Set(verticals)];
  }

  const countries = fd
    .getAll("countries")
    .flatMap((v) => String(v).split(/[\s,;]+/))
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (full || countries.length) {
    const bad = countries.find((c) => !/^[A-Z]{2}$/.test(c));
    if (bad) return { ok: false, error: `« ${bad} » n'est pas un code de pays (deux lettres, comme FR).`, field: "countries" };
    if (!countries.length) return { ok: false, error: "Gardez au moins un pays.", field: "countries" };
    values[S.countriesScope.key] = [...new Set(countries)];
  }
  return { ok: true, values };
}

/** Lignes « réglage : avant → après » des valeurs qui changent. */
export function settingsChanges(current: ProspectionSettings, values: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const f of NUMBER_FIELDS) {
    if (!(f.key in values)) continue;
    const after = Number(values[f.key]) / (f.factor ?? 1);
    if (after !== current.numbers[f.name]) out.push(`${f.label} : ${current.numbers[f.name]} → ${after}${f.unit ? ` ${f.unit}` : ""}`);
  }
  for (const f of BOOL_FIELDS) {
    if (!(f.key in values)) continue;
    if (values[f.key] !== current.bools[f.name]) out.push(`${f.label} : ${values[f.key] ? "oui" : "non"}`);
  }
  if (S.weights.key in values && JSON.stringify(values[S.weights.key]) !== JSON.stringify(current.weights)) {
    const w = values[S.weights.key] as ScoreWeights;
    out.push(`Poids de la note : ${WEIGHT_FIELDS.map((f) => `${f.label.toLowerCase()} ${w[f.name]}`).join(", ")}`);
  }
  if (S.verticals.key in values && JSON.stringify(values[S.verticals.key]) !== JSON.stringify(current.verticals))
    out.push(`Marchés : ${(values[S.verticals.key] as string[]).map((v) => (v === "SPORTS" ? "paris sportifs" : "casino")).join(", ")}`);
  if (S.countriesScope.key in values) {
    const after = values[S.countriesScope.key] as string[];
    const added = after.filter((c) => !current.countriesScope.includes(c));
    const removed = current.countriesScope.filter((c) => !after.includes(c));
    if (added.length) out.push(`Pays ajoutés : ${added.join(", ")}`);
    if (removed.length) out.push(`Pays retirés : ${removed.join(", ")}`);
  }
  return out;
}
