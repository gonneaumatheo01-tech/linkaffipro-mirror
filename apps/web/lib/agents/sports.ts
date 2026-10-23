/**
 * Équipe Paris sportifs (phase 23) à l'écran : réglages de l'équipe (heures de passage, écart de cote toléré, délai
 * avant le coup d'envoi, plafond d'appels de cotes), formulaire d'une catégorie de paris, raisonnement d'un pari mis
 * en phrases, bilan, bookmakers et leurs identifiants. Fonctions pures (testées dans sports.test.ts).
 *
 * Données :
 * - `AgentTeamConfig.settings.sports` = `{ runHours: number[], maxOddsDriftPct, minMinutesBeforeKickoff,
 *   maxApiCallsPerMonth }` (les autres clés de `settings` sont gardées telles quelles) ;
 * - `BetCategory` (une ligne par catégorie : marchés, ligues, bookmakers, canaux en listes) ;
 * - `BettingPick.reasoning` : chiffres du moteur (noms de champs lus avec tolérance, voir `reasoningSentences`).
 * - identifiants d'un bookmaker : deux clés chiffrées `providers.bookmakers.<nom>.login` et `.password`, adresse de
 *   secours des captures : `providers.screenshotProxy` (jamais relues par le site, seulement résumées).
 */
import { splitList } from "./forms";

export type FormResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ——— Réglages de l'équipe ———

export type SportsSettings = {
  /** Heures de passage du Chef Paris (heure de Paris), triées. */
  runHours: number[];
  /** Écart de cote toléré entre la sélection et l'envoi, en %. */
  maxOddsDriftPct: number;
  /** Jamais de publication à moins de N minutes du coup d'envoi. */
  minMinutesBeforeKickoff: number;
  /** Plafond mensuel d'appels au fournisseur de cotes. */
  maxApiCallsPerMonth: number;
};

export const SPORTS_DEFAULTS: SportsSettings = {
  runHours: [10, 15, 18],
  maxOddsDriftPct: 5,
  minMinutesBeforeKickoff: 30,
  maxApiCallsPerMonth: 2000,
};

/** Mots interdits proposés au départ (liste réglable dans « Réglages de l'équipe »). */
export const SPORTS_DEFAULT_FORBIDDEN_WORDS = ["sûr", "garanti", "100 %", "ne peut pas perdre"] as const;

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function numIn(v: unknown, min: number, max: number, fallback: number, integer = false): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return fallback;
  if (integer && !Number.isInteger(v)) return fallback;
  return v;
}

function cleanHours(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const hours = [...new Set(v.filter((h): h is number => Number.isInteger(h) && h >= 0 && h <= 23))].sort(
    (a, b) => a - b,
  );
  return hours.length ? hours : null;
}

/** Réglages lus dans `AgentTeamConfig.settings` ; valeur absente ou hors bornes → valeur de départ. */
export function parseSportsSettings(settings: unknown): SportsSettings {
  const s = record(record(settings).sports);
  return {
    runHours: cleanHours(s.runHours) ?? [...SPORTS_DEFAULTS.runHours],
    maxOddsDriftPct: numIn(s.maxOddsDriftPct, 0, 50, SPORTS_DEFAULTS.maxOddsDriftPct),
    minMinutesBeforeKickoff: numIn(s.minMinutesBeforeKickoff, 0, 1440, SPORTS_DEFAULTS.minMinutesBeforeKickoff, true),
    maxApiCallsPerMonth: numIn(s.maxApiCallsPerMonth, 0, 1_000_000, SPORTS_DEFAULTS.maxApiCallsPerMonth, true),
  };
}

/** Range les réglages dans `settings.sports` sans toucher aux autres clés (ni aux clés inconnues de `sports`). */
export function mergeSportsSettings(raw: unknown, next: SportsSettings): Record<string, unknown> {
  const base = record(raw);
  return { ...base, sports: { ...record(base.sports), ...next } };
}

/** « 10 h, 15 h et 18 h ». */
export function runHoursText(hours: readonly number[]): string {
  const parts = hours.map((h) => `${h} h`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Nombre saisi (virgule ou point) ; vide → `undefined`, illisible → `NaN`. */
function num(raw: string): number | undefined {
  const t = raw.trim().replace(",", ".").replace(/\s*%$/, "");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function numberField(
  fd: FormData,
  key: string,
  label: string,
  { min, max, integer = false }: { min: number; max: number; integer?: boolean },
): FormResult<number> {
  const n = num(str(fd, key));
  if (n === undefined || Number.isNaN(n)) return { ok: false, error: `${label} : saisissez un nombre.` };
  if (integer && !Number.isInteger(n)) return { ok: false, error: `${label} : saisissez un nombre entier.` };
  if (n < min) return { ok: false, error: `${label} : au moins ${String(min).replace(".", ",")}.` };
  if (n > max) return { ok: false, error: `${label} : au plus ${String(max).replace(".", ",")}.` };
  return { ok: true, data: n };
}

/** Heures de passage saisies « 10, 15, 18 » (ou « 10 h 15 h ») : 1 à 8 heures entières de 0 à 23. */
export function parseRunHours(raw: string): FormResult<number[]> {
  const parts = raw
    .replace(/h/gi, " ")
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (!parts.length) return { ok: false, error: "Heures de passage : saisissez au moins une heure (par exemple 10, 15, 18)." };
  const hours: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 23)
      return { ok: false, error: `Heures de passage : « ${p} » n'est pas une heure entre 0 et 23.` };
    if (!hours.includes(n)) hours.push(n);
  }
  if (hours.length > 8) return { ok: false, error: "Heures de passage : 8 passages par jour au plus." };
  return { ok: true, data: hours.sort((a, b) => a - b) };
}

/** Formulaire « Passages et cotes » (ADMIN). */
export function parseSportsSettingsForm(fd: FormData): FormResult<SportsSettings> {
  const hours = parseRunHours(str(fd, "sportsRunHours"));
  if (!hours.ok) return hours;
  const drift = numberField(fd, "sportsMaxOddsDriftPct", "Écart de cote toléré", { min: 0, max: 50 });
  if (!drift.ok) return drift;
  const delay = numberField(fd, "sportsMinMinutesBeforeKickoff", "Délai avant le match", {
    min: 0,
    max: 1440,
    integer: true,
  });
  if (!delay.ok) return delay;
  const calls = numberField(fd, "sportsMaxApiCallsPerMonth", "Plafond d'appels de cotes", {
    min: 0,
    max: 1_000_000,
    integer: true,
  });
  if (!calls.ok) return calls;
  return {
    ok: true,
    data: {
      runHours: hours.data,
      maxOddsDriftPct: drift.data,
      minMinutesBeforeKickoff: delay.data,
      maxApiCallsPerMonth: calls.data,
    },
  };
}

export function sameSportsSettings(a: SportsSettings, b: SportsSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ——— Bookmakers ———

/** Bookmakers partenaires connus (clé du moteur → nom affiché). D'autres clés peuvent venir des catégories. */
export const KNOWN_BOOKMAKERS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "sportaza", label: "Sportaza" },
  { key: "5gringos", label: "5Gringos" },
];

const BOOKMAKER_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function isBookmakerKey(v: unknown): v is string {
  return typeof v === "string" && BOOKMAKER_RE.test(v);
}

export function bookmakerLabel(key: string): string {
  const known = KNOWN_BOOKMAKERS.find((b) => b.key === key);
  if (known) return known.label;
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : key;
}

/** Clés chiffrées des identifiants d'un bookmaker (un seul endroit : à changer ici si le moteur les range autrement). */
export function bookmakerSecretKeys(bookmaker: string): { login: string; password: string } {
  return { login: `providers.bookmakers.${bookmaker}.login`, password: `providers.bookmakers.${bookmaker}.password` };
}

export const SCREENSHOT_PROXY_KEY = "providers.screenshotProxy";

/** Bookmakers à montrer : les connus d'abord, puis ceux cités par les catégories, sans doublon. */
export function bookmakersToShow(categoryBookmakers: ReadonlyArray<readonly string[]>): string[] {
  const out: string[] = KNOWN_BOOKMAKERS.map((b) => b.key);
  for (const list of categoryBookmakers) for (const b of list) if (isBookmakerKey(b) && !out.includes(b)) out.push(b);
  return out;
}

export type CredentialState = "complete" | "partial" | "missing";

export function credentialState(login: { set: boolean } | null, password: { set: boolean } | null): CredentialState {
  const l = Boolean(login?.set);
  const p = Boolean(password?.set);
  return l && p ? "complete" : l || p ? "partial" : "missing";
}

export const CREDENTIAL_STATE: Record<CredentialState, { label: string; tone: "success" | "warning" | "muted" }> = {
  complete: { label: "Identifiants enregistrés", tone: "success" },
  partial: { label: "Identifiants incomplets", tone: "warning" },
  missing: { label: "Aucun identifiant", tone: "muted" },
};

/** Identifiant et mot de passe saisis sur le site (secours du bot Telegram). */
export function parseBookmakerCredentialsForm(
  fd: FormData,
): FormResult<{ bookmaker: string; login: string; password: string }> {
  const bookmaker = str(fd, "bookmaker");
  if (!isBookmakerKey(bookmaker)) return { ok: false, error: "Bookmaker inconnu : rechargez la page." };
  const login = str(fd, "login");
  const v = fd.get("password");
  const password = typeof v === "string" ? v : "";
  if (!login) return { ok: false, error: "Saisissez l'identifiant du compte." };
  if (!password.trim()) return { ok: false, error: "Saisissez le mot de passe du compte." };
  if (login.length > 200 || password.length > 200) return { ok: false, error: "Identifiant ou mot de passe trop long." };
  return { ok: true, data: { bookmaker, login, password } };
}

/** Adresse de secours des captures : `http(s)://` ou `socks5://`, avec identifiants éventuels. */
export function parseProxyValue(raw: string): FormResult<string> {
  const t = raw.trim();
  if (!t) return { ok: false, error: "Collez l'adresse internet de secours." };
  if (t.length > 500) return { ok: false, error: "Adresse trop longue." };
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, error: "Adresse illisible : elle commence par http://, https:// ou socks5://." };
  }
  if (!["http:", "https:", "socks5:", "socks5h:"].includes(u.protocol) || !u.hostname)
    return { ok: false, error: "Adresse illisible : elle commence par http://, https:// ou socks5://." };
  return { ok: true, data: t };
}

// ——— Catégories de paris ———

export const SPORTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "SOCCER", label: "Football" },
  { value: "BASKETBALL", label: "Basket" },
  { value: "TENNIS", label: "Tennis" },
  { value: "HOCKEY", label: "Hockey" },
  { value: "FOOTBALL", label: "Football américain" },
];

export function sportLabel(v: string): string {
  return SPORTS.find((s) => s.value === v)?.label ?? v;
}

/** Ligues courantes (identifiants du fournisseur de cotes, à confirmer avec lui). */
export const LEAGUE_LABELS: Record<string, string> = {
  EPL: "Premier League (Angleterre)",
  LA_LIGA: "Liga (Espagne)",
  BUNDESLIGA: "Bundesliga (Allemagne)",
  IT_SERIE_A: "Serie A (Italie)",
  FR_LIGUE_1: "Ligue 1 (France)",
  UEFA_CHAMPIONS_LEAGUE: "Ligue des champions",
  UEFA_EUROPA_LEAGUE: "Ligue Europa",
  MLS: "MLS (États-Unis)",
};

export function leagueLabel(v: string): string {
  return LEAGUE_LABELS[v] ?? v;
}

export type BetCategoryInput = {
  id: string | null;
  key: string;
  name: string;
  sport: string;
  marketTypes: string[];
  leagues: string[];
  bookmakers: string[];
  minOdds: number;
  maxOdds: number;
  picksPerDay: number;
  channelIds: string[];
  campaignId: string | null;
  minMinutesBeforeKickoff: number;
  maxOddsDriftPct: number;
  active: boolean;
  sortOrder: number;
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MARKET_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const LEAGUE_RE = /^[A-Za-z0-9_.-]{1,60}$/;
const CATEGORY_KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Clé ASCII d'une nouvelle catégorie tirée de son nom (« Tirs cadrés » → `tirs-cadres`). */
export function categoryKeyFromName(name: string): string | null {
  const key = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return key && CATEGORY_KEY_RE.test(key) ? key : null;
}

/** Clé libre : `base`, sinon `base-2`, `base-3`… */
export function uniqueKey(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const k = `${base.slice(0, 36)}-${i}`;
    if (!taken.includes(k)) return k;
  }
  return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
}

/**
 * Formulaire d'une catégorie (création ou modification). `allowed` : canaux et campagnes qu'on peut choisir (une
 * valeur hors liste est refusée, pas ignorée en silence). La clé est fixée par la page (`key`) ou tirée du nom.
 */
export function parseBetCategoryForm(
  fd: FormData,
  allowed: { channelIds: readonly string[]; campaignIds: readonly string[]; takenKeys: readonly string[] },
): FormResult<BetCategoryInput> {
  const idRaw = str(fd, "id");
  const id = idRaw ? idRaw : null;
  if (id && !ID_RE.test(id)) return { ok: false, error: "Catégorie inconnue : rechargez la page." };
  const name = str(fd, "name");
  if (!name) return { ok: false, error: "Donnez un nom à la catégorie." };
  if (name.length > 80) return { ok: false, error: "Nom de la catégorie : 80 caractères au plus." };

  let key = str(fd, "key");
  if (id) {
    if (!CATEGORY_KEY_RE.test(key)) return { ok: false, error: "Catégorie inconnue : rechargez la page." };
  } else {
    const base = categoryKeyFromName(name);
    if (!base) return { ok: false, error: "Nom de la catégorie : utilisez au moins une lettre ou un chiffre." };
    key = uniqueKey(base, allowed.takenKeys);
  }

  const sport = str(fd, "sport") || "SOCCER";
  if (!/^[A-Z_]{2,30}$/.test(sport)) return { ok: false, error: "Sport inconnu." };

  const marketTypes = splitList(str(fd, "marketTypes"));
  if (!marketTypes.length) return { ok: false, error: "Marchés : saisissez au moins un identifiant de marché." };
  if (marketTypes.length > 30) return { ok: false, error: "Marchés : 30 au plus." };
  const badMarket = marketTypes.find((m) => !MARKET_RE.test(m));
  if (badMarket) return { ok: false, error: `Marchés : « ${badMarket} » n'est pas un identifiant (lettres, chiffres, tirets).` };

  const leagues = splitList(str(fd, "leagues"));
  if (!leagues.length) return { ok: false, error: "Ligues : saisissez au moins une ligue." };
  if (leagues.length > 40) return { ok: false, error: "Ligues : 40 au plus." };
  const badLeague = leagues.find((l) => !LEAGUE_RE.test(l));
  if (badLeague) return { ok: false, error: `Ligues : « ${badLeague} » n'est pas un identifiant (lettres, chiffres, tirets).` };

  const bookmakers: string[] = [];
  for (const v of fd.getAll("bookmakers")) if (typeof v === "string" && v.trim()) bookmakers.push(v.trim().toLowerCase());
  for (const v of splitList(str(fd, "otherBookmakers"))) bookmakers.push(v.toLowerCase());
  const uniqBookmakers = [...new Set(bookmakers)];
  const badBk = uniqBookmakers.find((b) => !isBookmakerKey(b));
  if (badBk) return { ok: false, error: `Bookmakers : « ${badBk} » n'est pas un nom valable (lettres minuscules, chiffres, tirets).` };
  if (!uniqBookmakers.length) return { ok: false, error: "Bookmakers : cochez au moins un bookmaker." };

  const minOdds = numberField(fd, "minOdds", "Cote minimale", { min: 1.01, max: 100 });
  if (!minOdds.ok) return minOdds;
  const maxOdds = numberField(fd, "maxOdds", "Cote maximale", { min: 1.01, max: 100 });
  if (!maxOdds.ok) return maxOdds;
  if (minOdds.data >= maxOdds.data) return { ok: false, error: "La cote minimale doit être plus petite que la cote maximale." };

  const picks = numberField(fd, "picksPerDay", "Paris par jour", { min: 1, max: 20, integer: true });
  if (!picks.ok) return picks;

  const channelIds: string[] = [];
  for (const v of fd.getAll("channelIds")) {
    if (typeof v !== "string" || !v) continue;
    if (!allowed.channelIds.includes(v)) return { ok: false, error: "Un des canaux choisis n'existe plus : rechargez la page." };
    if (!channelIds.includes(v)) channelIds.push(v);
  }

  const campaignRaw = str(fd, "campaignId");
  const campaignId = campaignRaw || null;
  if (campaignId && !allowed.campaignIds.includes(campaignId))
    return { ok: false, error: "La campagne choisie n'existe plus : rechargez la page." };

  const delay = numberField(fd, "minMinutesBeforeKickoff", "Délai avant le match", { min: 0, max: 1440, integer: true });
  if (!delay.ok) return delay;
  const drift = numberField(fd, "maxOddsDriftPct", "Écart de cote toléré", { min: 0, max: 50 });
  if (!drift.ok) return drift;

  const sortRaw = str(fd, "sortOrder");
  const sortOrder = sortRaw ? Number(sortRaw) : 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) return { ok: false, error: "Ordre : un nombre entier de 0 à 999." };

  const active = ["on", "1", "true"].includes(str(fd, "active"));

  return {
    ok: true,
    data: {
      id,
      key,
      name,
      sport,
      marketTypes,
      leagues,
      bookmakers: uniqBookmakers,
      minOdds: minOdds.data,
      maxOdds: maxOdds.data,
      picksPerDay: picks.data,
      channelIds,
      campaignId,
      minMinutesBeforeKickoff: delay.data,
      maxOddsDriftPct: drift.data,
      active,
      sortOrder,
    },
  };
}

/** Liste de chaînes lue dans une colonne JSON (tolérante). */
export function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/** Ce qui a changé entre deux versions d'une catégorie (pour le journal des actions), sans les identifiants internes. */
export function categoryChanges(
  before: Partial<BetCategoryInput> | null,
  after: BetCategoryInput,
): string[] {
  if (!before) return ["création"];
  const keys: Array<keyof BetCategoryInput> = [
    "name",
    "sport",
    "marketTypes",
    "leagues",
    "bookmakers",
    "minOdds",
    "maxOdds",
    "picksPerDay",
    "channelIds",
    "campaignId",
    "minMinutesBeforeKickoff",
    "maxOddsDriftPct",
    "active",
    "sortOrder",
  ];
  return keys.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

// ——— Paris et raisonnement ———

/** Cote décimale à la française (« 2,10 »). */
export function fmtOdds(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Ratio signé en pourcentage (« +4,2 % », « −1,5 % »). */
export function fmtSignedPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  const v = ratio * 100;
  const abs = Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: digits });
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${abs} %`;
}

function pct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;
}

function n(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function first(o: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = n(o[k]);
    if (v !== null) return v;
  }
  return null;
}

/** Un ratio peut arriver en 0,52 ou en 52 : ramené en ratio. */
function asRatio(v: number | null): number | null {
  if (v === null) return null;
  return Math.abs(v) > 1.5 ? v / 100 : v;
}

function num1(v: number): string {
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

/**
 * Raisonnement d'un pari en phrases (chiffres de `BettingPick.reasoning`). Champs lus avec tolérance (le moteur peut
 * nommer `valueEdge` ou `edge`, etc.) ; un texte déjà rédigé (`summary`, `lines`) passe tel quel. Rien n'est inventé :
 * une phrase n'apparaît que si son chiffre est présent.
 */
export function reasoningSentences(
  reasoning: unknown,
  pick: { odds: number; consensusOdds: number | null; bookmaker: string; interestScore: number | null },
): string[] {
  const r = record(reasoning);
  const out: string[] = [];
  for (const k of ["lines", "sentences"]) {
    const v = r[k];
    if (Array.isArray(v)) for (const s of v) if (typeof s === "string" && s.trim()) out.push(s.trim());
  }
  const summary = typeof r.summary === "string" ? r.summary.trim() : typeof r.text === "string" ? r.text.trim() : "";
  if (summary) out.push(summary);

  const consensus = pick.consensusOdds ?? first(r, "consensusOdds", "referenceOdds", "medianOdds");
  const books = first(r, "bookmakerCount", "booksCount", "sampleSize", "bookmakersCount");
  if (consensus !== null)
    out.push(
      `Cote ${bookmakerLabel(pick.bookmaker)} ${fmtOdds(pick.odds)}, contre ${fmtOdds(consensus)} pour la cote de référence${
        books !== null ? ` (milieu de ${num1(books)} bookmakers)` : ""
      }.`,
    );
  const prob = asRatio(first(r, "consensusProb", "consensusProbability", "fairProbability", "fairProb", "probability"));
  if (prob !== null)
    out.push(`Chance estimée d'après les autres bookmakers, marge retirée : ${pct(prob)} (la cote ${fmtOdds(pick.odds)} en suppose ${pct(1 / pick.odds)}).`);
  const edge = asRatio(first(r, "valueEdge", "edge", "value"));
  if (edge !== null) out.push(`Écart de valeur : ${fmtSignedPct(edge)}.`);

  const avg = record(r.averages ?? r.teamAverages ?? r.recent);
  const home = first(avg, "home", "homeAvg");
  const away = first(avg, "away", "awayAvg");
  const games = first(avg, "matches", "games", "sample", "n") ?? first(r, "recentMatches", "sampleMatches");
  const stat = typeof avg.stat === "string" ? avg.stat : typeof avg.label === "string" ? avg.label : null;
  if (home !== null || away !== null) {
    const parts = [home !== null ? `domicile ${num1(home)}` : null, away !== null ? `extérieur ${num1(away)}` : null].filter(Boolean);
    out.push(
      `Moyennes récentes${stat ? ` (${stat})` : ""} : ${parts.join(", ")}${games !== null ? `, sur ${num1(games)} matchs` : ""}.`,
    );
  }
  const adj = asRatio(first(r, "adjustment", "averageAdjustment", "statsAdjustment"));
  if (adj !== null && adj !== 0) out.push(`Correction par les moyennes : ${fmtSignedPct(adj)}.`);
  const score = pick.interestScore ?? first(r, "score", "interestScore");
  if (score !== null) out.push(`Score d'intérêt : ${score.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}.`);
  return [...new Set(out)];
}

/** Cote bougée entre la sélection et l'envoi (ratio signé), `null` si l'envoi n'a pas eu lieu. */
export function oddsDrift(odds: number, oddsAtSend: number | null): number | null {
  if (oddsAtSend === null || !Number.isFinite(oddsAtSend) || odds <= 0) return null;
  return oddsAtSend / odds - 1;
}

/** Score final lisible tiré de `BettingPick.result` (« 2-1 »), `null` sinon. */
export function resultScore(result: unknown): string | null {
  const r = record(result);
  const score = record(r.score);
  const h = first(r, "homeScore", "home") ?? first(score, "home");
  const a = first(r, "awayScore", "away") ?? first(score, "away");
  if (h !== null && a !== null) return `${h}-${a}`;
  return typeof r.score === "string" ? r.score : null;
}

// ——— Bilan ———

export const SUMMARY_BY = [
  { value: "category", label: "Par catégorie" },
  { value: "league", label: "Par ligue" },
  { value: "bookmaker", label: "Par bookmaker" },
  { value: "week", label: "Par semaine" },
] as const;

export type SummaryBy = (typeof SUMMARY_BY)[number]["value"];

export function parseSummaryBy(v: unknown): SummaryBy {
  return SUMMARY_BY.some((b) => b.value === v) ? (v as SummaryBy) : "category";
}

export type SummaryRowLike = {
  published: number;
  won: number;
  lost: number;
  void: number;
  hitRate: number | null;
  avgOdds: number | null;
  roi: number | null;
};

/** Ligne « Total » du bilan (taux et cote moyenne pondérés par le nombre de paris réglés ; rendement recalculé). */
export function summaryTotal(rows: readonly SummaryRowLike[]): SummaryRowLike {
  let published = 0;
  let won = 0;
  let lost = 0;
  let voids = 0;
  let oddsSum = 0;
  let oddsN = 0;
  let stakes = 0;
  let returns = 0;
  for (const r of rows) {
    published += r.published;
    won += r.won;
    lost += r.lost;
    voids += r.void;
    if (r.avgOdds !== null) {
      oddsSum += r.avgOdds * r.published;
      oddsN += r.published;
    }
    const settled = r.won + r.lost;
    if (r.roi !== null && settled > 0) {
      stakes += settled;
      returns += settled * (1 + r.roi);
    }
  }
  const settled = won + lost;
  return {
    published,
    won,
    lost,
    void: voids,
    hitRate: settled > 0 ? won / settled : null,
    avgOdds: oddsN > 0 ? oddsSum / oddsN : null,
    roi: stakes > 0 ? returns / stakes - 1 : null,
  };
}

/** Libellé d'une ligne du bilan selon le regroupement (le moteur donne déjà `label`, sinon on le rend lisible). */
export function summaryRowLabel(by: SummaryBy, row: { key: string; label: string }): string {
  if (row.label && row.label !== row.key) return row.label;
  if (by === "league") return leagueLabel(row.key);
  if (by === "bookmaker") return bookmakerLabel(row.key);
  return row.label || row.key;
}

// ——— Pari de test ———

export function parseTestBetForm(fd: FormData, categoryIds: readonly string[]): FormResult<{ categoryId: string | null }> {
  const v = str(fd, "categoryId");
  if (!v) return { ok: true, data: { categoryId: null } };
  if (!categoryIds.includes(v)) return { ok: false, error: "Catégorie inconnue : rechargez la page." };
  return { ok: true, data: { categoryId: v } };
}

/** Motifs de refus les plus fréquents, en clair (le moteur écrit déjà en français : affiché tel quel sinon). */
export function skipReasonText(reason: string | null): string | null {
  if (!reason) return null;
  const map: Record<string, string> = {
    odds_moved: "la cote a bougé au-delà de l'écart toléré",
    market_missing: "le marché a disparu chez le bookmaker",
    too_close_to_kickoff: "trop près du coup d'envoi",
    duplicate: "même pari déjà publié dans les 48 h",
    out_of_range: "cote hors de la fourchette de la catégorie",
    capture_failed: "capture impossible",
  };
  return map[reason] ?? reason;
}
