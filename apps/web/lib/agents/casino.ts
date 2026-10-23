/**
 * Équipe Casino (phase 22) à l'écran : libellés français des thèmes, réglages de l'équipe (thèmes, seuil de manque,
 * rotation), thèmes d'un canal avec leur poids, dépôt de médias depuis la fiche, médias « à classer », demandes de
 * vidéos, « Produire un post de test ». Fonctions pures (testées dans casino.test.ts).
 *
 * Données (contrat `packages/agents/src/casino/contracts.ts`, sans migration) :
 * - `AgentTeamConfig.settings.casino` = `{ themes: string[], themeLabels?: Record<clé, libellé>, lowStock, rotationDays }`
 *   (`themeLabels` : libellés renommés par l'équipe, lus par le site seulement ; les autres clés sont gardées) ;
 * - un média casino : thème principal `MediaAsset.theme`, tous ses thèmes dans `MediaAsset.tags` (`theme:<clé>`),
 *   « à classer » = `theme = null` + tag `a-classer` ;
 * - `ChannelAgentPlan.themes` d'un canal casino = `[{ theme, weight }]`.
 */
import { z } from "zod";

/** Thèmes de départ (mêmes clés que `CASINO_DEFAULT_THEMES` du moteur). */
export const CASINO_START_THEMES = [
  "machines-a-sous",
  "roulette",
  "blackjack",
  "bonus",
  "jackpot",
  "live",
  "tournoi",
  "cashback",
  "ambiance",
] as const;

/** Libellés français des thèmes de départ. */
export const CASINO_THEME_LABELS: Record<string, string> = {
  "machines-a-sous": "Machines à sous",
  roulette: "Roulette",
  blackjack: "Blackjack",
  bonus: "Bonus",
  jackpot: "Jackpot",
  live: "Casino en direct",
  tournoi: "Tournois",
  cashback: "Cashback",
  ambiance: "Ambiance",
};

/** Mélange par défaut d'un canal Casino : 2 vidéos, 1 image, 1 texte (l'image s'appelle `photo` dans les données). */
export const CASINO_DEFAULT_MIX = { video: 2, photo: 1, text: 1 } as const;

export const CASINO_DEFAULT_LOW_STOCK = 3;
export const CASINO_DEFAULT_ROTATION_DAYS = 30;

/** Tag d'un média sans thème (« à classer »). */
export const TO_CLASSIFY_TAG = "a-classer";
export const THEME_TAG_PREFIX = "theme:";

export type CasinoTheme = { key: string; label: string };

export type CasinoSettings = {
  themes: CasinoTheme[];
  lowStock: number;
  rotationDays: number;
};

export type FormResult<T> = { ok: true; data: T } | { ok: false; error: string };

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Libellé affiché d'un thème : celui donné par l'équipe, sinon le libellé de départ, sinon la clé lisible. */
export function themeLabel(key: string, labels: Record<string, string> = {}): string {
  const own = labels[key];
  if (own) return own;
  if (CASINO_THEME_LABELS[key]) return CASINO_THEME_LABELS[key]!;
  const words = key.replace(/-/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** Mot-clé à mettre en légende pour un thème (« #casino #machines-a-sous »). */
export function themeHashtags(key: string): string {
  return `#casino #${key}`;
}

/**
 * Clé ASCII d'un nouveau thème tirée de son libellé (« Machines à sous » → `machines-a-sous`), `null` si rien ne
 * reste (que des signes).
 */
export function themeKeyFromLabel(label: string): string | null {
  const key = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return key && KEY_RE.test(key) ? key : null;
}

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** Réglages de l'équipe lus dans `AgentTeamConfig.settings` ; liste absente ou vide → thèmes de départ. */
export function parseCasinoSettings(settings: unknown): CasinoSettings {
  const c = record(record(settings).casino);
  const labels = record(c.themeLabels);
  const labelOf: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels))
    if (typeof v === "string" && v.trim()) labelOf[k] = v.trim();
  const raw = Array.isArray(c.themes) ? c.themes : [];
  const keys: string[] = [];
  for (const t of raw) {
    // Une liste d'objets `{ key, label }` est aussi lue (tolérance), mais le site écrit des clés.
    const key =
      typeof t === "string"
        ? t
        : typeof record(t).key === "string"
          ? (record(t).key as string)
          : "";
    if (KEY_RE.test(key) && !keys.includes(key)) keys.push(key);
    const l = record(t).label;
    if (typeof l === "string" && l.trim() && !labelOf[key]) labelOf[key] = l.trim();
  }
  const list = keys.length ? keys : [...CASINO_START_THEMES];
  return {
    themes: list.map((key) => ({ key, label: themeLabel(key, labelOf) })),
    lowStock: intIn(c.lowStock, 1, 50, CASINO_DEFAULT_LOW_STOCK),
    rotationDays: intIn(c.rotationDays, 1, 365, CASINO_DEFAULT_ROTATION_DAYS),
  };
}

/**
 * Nouveaux réglages fusionnés dans `AgentTeamConfig.settings` : les autres clés (du moteur, de l'équipe Algorithme)
 * et les autres clés de `casino` sont gardées. Les libellés égaux au libellé de départ ne sont pas écrits.
 */
export function mergeCasinoSettings(
  settings: unknown,
  next: CasinoSettings,
): Record<string, unknown> {
  const base = record(settings);
  const casino = record(base.casino);
  const themeLabels: Record<string, string> = {};
  for (const t of next.themes) if (t.label !== themeLabel(t.key)) themeLabels[t.key] = t.label;
  return {
    ...base,
    casino: {
      ...casino,
      themes: next.themes.map((t) => t.key),
      themeLabels,
      lowStock: next.lowStock,
      rotationDays: next.rotationDays,
    },
  };
}

/** Champs « Seuil de manque » et « Rotation » (ADMIN). */
export function parseCasinoTeamForm(
  fd: FormData,
): FormResult<{ lowStock: number; rotationDays: number }> {
  const low = Number(str(fd, "casinoLowStock"));
  if (!Number.isInteger(low) || low < 1 || low > 50)
    return { ok: false, error: "Seuil de manque : un nombre entier de 1 à 50 (3 conseillé)." };
  const rot = Number(str(fd, "casinoRotationDays"));
  if (!Number.isInteger(rot) || rot < 1 || rot > 365)
    return { ok: false, error: "Rotation : un nombre de jours de 1 à 365 (30 conseillé)." };
  return { ok: true, data: { lowStock: low, rotationDays: rot } };
}

function cleanLabel(raw: string): FormResult<string> {
  const label = raw.replace(/\s+/g, " ").trim();
  if (!label) return { ok: false, error: "Donnez un nom au thème (par exemple « Poker »)." };
  if (label.length > 40) return { ok: false, error: "Nom du thème : 40 caractères au plus." };
  return { ok: true, data: label };
}

/** Ajout d'un thème : libellé → clé ASCII, jamais deux fois la même clé ; 30 thèmes au plus. */
export function addTheme(current: CasinoTheme[], rawLabel: string): FormResult<CasinoTheme[]> {
  const label = cleanLabel(rawLabel);
  if (!label.ok) return label;
  const key = themeKeyFromLabel(label.data);
  if (!key) return { ok: false, error: "Nom du thème : utilisez des lettres ou des chiffres." };
  if (current.some((t) => t.key === key || t.label.toLowerCase() === label.data.toLowerCase()))
    return { ok: false, error: `Le thème « ${label.data} » existe déjà.` };
  if (current.length >= 30)
    return { ok: false, error: "30 thèmes au plus : retirez d'abord un thème inutilisé." };
  return { ok: true, data: [...current, { key, label: label.data }] };
}

/** Renommage du libellé seulement : la clé (mot-clé des légendes) ne change jamais. */
export function renameTheme(
  current: CasinoTheme[],
  key: string,
  rawLabel: string,
): FormResult<CasinoTheme[]> {
  if (!current.some((t) => t.key === key))
    return { ok: false, error: "Thème inconnu : rechargez la page." };
  const label = cleanLabel(rawLabel);
  if (!label.ok) return label;
  if (current.some((t) => t.key !== key && t.label.toLowerCase() === label.data.toLowerCase()))
    return { ok: false, error: `Le thème « ${label.data} » existe déjà.` };
  return { ok: true, data: current.map((t) => (t.key === key ? { ...t, label: label.data } : t)) };
}

/**
 * Retrait d'un thème : refusé s'il a encore des médias ou s'il est dans le plan d'un canal (message clair) ; le
 * dernier thème ne se retire pas.
 */
export function removeTheme(
  current: CasinoTheme[],
  key: string,
  usage: { media: number; channels: string[] },
): FormResult<CasinoTheme[]> {
  const theme = current.find((t) => t.key === key);
  if (!theme) return { ok: false, error: "Thème inconnu : rechargez la page." };
  if (usage.media > 0)
    return {
      ok: false,
      error: `« ${theme.label} » a encore ${usage.media} média${usage.media > 1 ? "s" : ""} : il ne peut pas être retiré.`,
    };
  if (usage.channels.length > 0)
    return {
      ok: false,
      error: `« ${theme.label} » est dans le plan de ${usage.channels.join(", ")} : retirez-le d'abord du plan.`,
    };
  if (current.length <= 1) return { ok: false, error: "Gardez au moins un thème." };
  return { ok: true, data: current.filter((t) => t.key !== key) };
}

/** Clé de thème reçue d'un formulaire (ASCII, connue de l'équipe). */
export function parseThemeKey(v: unknown, themes: CasinoTheme[]): string | null {
  return typeof v === "string" && themes.some((t) => t.key === v) ? v : null;
}

// ------------------------------------------------------------------
// Thèmes d'un canal (plan) et thèmes d'un média
// ------------------------------------------------------------------

export type WeightedTheme = { theme: string; weight: number };

/** `ChannelAgentPlan.themes` lu : objets `{ theme, weight }` ; une clé seule vaut poids 1. */
export function parsePlanThemes(v: unknown): WeightedTheme[] {
  if (!Array.isArray(v)) return [];
  const out: WeightedTheme[] = [];
  for (const x of v) {
    const o = record(x);
    const theme = typeof x === "string" ? x : typeof o.theme === "string" ? o.theme : "";
    if (!theme || out.some((t) => t.theme === theme)) continue;
    const w = typeof o.weight === "number" && Number.isFinite(o.weight) ? Math.round(o.weight) : 1;
    out.push({ theme, weight: Math.min(10, Math.max(1, w)) });
  }
  return out;
}

/** Cases « thème » et poids du plan d'un canal Casino (`ptheme_<clé>`, `pweight_<clé>`, poids de 1 à 10). */
export function parseCasinoPlanThemesForm(
  fd: FormData,
  themes: CasinoTheme[],
): FormResult<WeightedTheme[]> {
  const out: WeightedTheme[] = [];
  for (const t of themes) {
    if (fd.get(`ptheme_${t.key}`) !== "on") continue;
    const raw = str(fd, `pweight_${t.key}`);
    const w = raw === "" ? 1 : Number(raw);
    if (!Number.isInteger(w) || w < 1 || w > 10)
      return { ok: false, error: `Poids du thème « ${t.label} » : un nombre entier de 1 à 10.` };
    out.push({ theme: t.key, weight: w });
  }
  return { ok: true, data: out };
}

/** Résumé des thèmes d'un canal : « Roulette ×2, Bonus ». */
export function planThemesText(themes: WeightedTheme[], labels: CasinoTheme[]): string {
  if (themes.length === 0) return "aucun thème choisi";
  const label = (k: string) => labels.find((t) => t.key === k)?.label ?? themeLabel(k);
  return themes.map((t) => `${label(t.theme)}${t.weight > 1 ? ` ×${t.weight}` : ""}`).join(", ");
}

/** Mélange d'un canal en clair : « 2 vidéos, 1 image, 1 texte ». */
export function casinoMixText(mix: { video: number; photo: number; text: number }): string {
  const part = (n: number, one: string, many: string) =>
    n > 0 ? `${n} ${n > 1 ? many : one}` : null;
  return (
    [
      part(mix.video, "vidéo", "vidéos"),
      part(mix.photo, "image", "images"),
      part(mix.text, "texte", "textes"),
    ]
      .filter(Boolean)
      .join(", ") || "rien"
  );
}

/** Thèmes d'un média : le thème principal puis les tags `theme:<clé>`. */
export function mediaThemes(asset: { theme: string | null; tags: unknown }): string[] {
  const out: string[] = [];
  if (asset.theme) out.push(asset.theme);
  if (Array.isArray(asset.tags))
    for (const t of asset.tags)
      if (typeof t === "string" && t.startsWith(THEME_TAG_PREFIX)) {
        const k = t.slice(THEME_TAG_PREFIX.length);
        if (k && !out.includes(k)) out.push(k);
      }
  return out;
}

/** Classement d'un média depuis la fiche (`assetId`, cases `theme`) : thèmes connus seulement, un au moins. */
export function parseClassifyForm(
  fd: FormData,
  themes: CasinoTheme[],
): FormResult<{ assetId: string; themes: string[] }> {
  const assetId = str(fd, "assetId");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(assetId))
    return { ok: false, error: "Média inconnu : rechargez la page." };
  const picked = fd
    .getAll("theme")
    .filter((v): v is string => typeof v === "string")
    .filter((v, i, a) => a.indexOf(v) === i);
  if (picked.length === 0)
    return { ok: false, error: "Cochez au moins un thème pour ranger ce média." };
  const unknown = picked.filter((k) => !themes.some((t) => t.key === k));
  if (unknown.length) return { ok: false, error: "Thème inconnu : rechargez la page." };
  return { ok: true, data: { assetId, themes: picked } };
}

// ------------------------------------------------------------------
// Stock
// ------------------------------------------------------------------

export type StockState = "ok" | "low" | "empty";

export const STOCK_STATE: Record<
  StockState,
  { label: string; tone: "success" | "warning" | "danger" }
> = {
  ok: { label: "Assez", tone: "success" },
  low: { label: "Bientôt à court", tone: "warning" },
  empty: { label: "Plus rien", tone: "danger" },
};

export type StockRow = {
  channelId: string;
  channelTitle: string;
  theme: string;
  unused: number;
  state: StockState;
};

/** Lignes du stock regroupées par canal (ordre d'arrivée gardé), les thèmes qui manquent d'abord. */
export function groupStock(
  rows: StockRow[],
): Array<{ channelId: string; channelTitle: string; rows: StockRow[] }> {
  const order: StockState[] = ["empty", "low", "ok"];
  const groups = new Map<string, { channelId: string; channelTitle: string; rows: StockRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.channelId) ?? {
      channelId: r.channelId,
      channelTitle: r.channelTitle,
      rows: [],
    };
    g.rows.push(r);
    groups.set(r.channelId, g);
  }
  for (const g of groups.values())
    g.rows.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.unused - b.unused);
  return [...groups.values()];
}

// ------------------------------------------------------------------
// Demandes de vidéos (HumanRequest MEDIA de l'équipe)
// ------------------------------------------------------------------

export type MediaRequestView = {
  id: string;
  themes: string[];
  channelIds: string[];
  count: number | null;
  received: number;
  status: string;
  question: string;
  createdAt: Date;
  askedAt: Date | null;
  answeredAt: Date | null;
};

/** Ce qu'attend une demande : mots-clés (sans `casino`), canaux, nombre souhaité et reçu. */
export function parseMediaRequest(r: {
  id: string;
  key: string;
  expected: unknown;
  status: string;
  question: string;
  createdAt: Date;
  askedAt: Date | null;
  answeredAt: Date | null;
}): MediaRequestView {
  const e = record(r.expected);
  const tags = Array.isArray(e.tags)
    ? e.tags.filter((t): t is string => typeof t === "string")
    : [];
  let themes = tags.map((t) => t.replace(/^#/, "")).filter((t) => t && t !== "casino");
  if (themes.length === 0 && typeof e.theme === "string") themes = [e.theme];
  if (themes.length === 0 && Array.isArray(e.themes))
    themes = e.themes.filter((t): t is string => typeof t === "string");
  const channelIds = [
    ...(typeof e.channelId === "string" ? [e.channelId] : []),
    ...(Array.isArray(e.channelIds)
      ? e.channelIds.filter((c): c is string => typeof c === "string")
      : []),
  ];
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  return {
    id: r.id,
    themes,
    channelIds,
    count: n(e.count),
    received: n(e.received) ?? 0,
    status: r.status,
    question: r.question,
    createdAt: r.createdAt,
    askedAt: r.askedAt,
    answeredAt: r.answeredAt,
  };
}

// ------------------------------------------------------------------
// Post de test et dépôt
// ------------------------------------------------------------------

export const CASINO_TEST_FORMATS = [
  { value: "video", label: "Vidéo" },
  { value: "photo", label: "Image" },
  { value: "text", label: "Texte" },
] as const;
export type CasinoTestFormat = (typeof CASINO_TEST_FORMATS)[number]["value"];

export function parseCasinoTestPostForm(fd: FormData): FormResult<CasinoTestFormat> {
  const f = z.enum(["video", "photo", "text"]).safeParse(str(fd, "format"));
  return f.success
    ? { ok: true, data: f.data }
    : { ok: false, error: "Choisissez le type de post : vidéo, image ou texte." };
}

const MB = 1024 * 1024;

export const CASINO_UPLOAD = {
  video: {
    mimes: ["video/mp4", "video/quicktime", "video/webm"],
    maxBytes: 50 * MB,
    types: "MP4, MOV ou WebM",
  },
  image: {
    mimes: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 10 * MB,
    types: "JPEG, PNG ou WebP",
  },
} as const;

export const CASINO_UPLOAD_ACCEPT = [
  ...CASINO_UPLOAD.video.mimes,
  ...CASINO_UPLOAD.image.mimes,
].join(",");

/** Un fichier déposé pour l'équipe Casino est-il acceptable ? Message clair sinon. */
export function casinoUploadProblem(mime: string, size: number): string | null {
  const rule = mime.startsWith("video/")
    ? CASINO_UPLOAD.video
    : mime.startsWith("image/")
      ? CASINO_UPLOAD.image
      : null;
  if (!rule || !(rule.mimes as readonly string[]).includes(mime))
    return `Choisissez une vidéo ${CASINO_UPLOAD.video.types} ou une image ${CASINO_UPLOAD.image.types}.`;
  if (size <= 0) return "Fichier vide.";
  if (size > rule.maxBytes) {
    const mb = String(Math.round((size / MB) * 10) / 10).replace(".", ",");
    return rule === CASINO_UPLOAD.video
      ? `Vidéo trop lourde (${mb} Mo, 50 Mo au plus) : raccourcissez-la ou exportez-la en 720p.`
      : `Image trop lourde (${mb} Mo, 10 Mo au plus) : réduisez-la avant de l'envoyer.`;
  }
  return null;
}

/** Classement d'un média déposé depuis la fiche : thème principal = le premier coché, tous les thèmes en tags. */
export function casinoClassification(
  mime: string,
  themes: string[],
): {
  teamKey: "casino";
  origin: "HUMAN";
  kind: "SOURCE" | "PHOTO";
  theme: string;
  tags: string[];
} {
  return {
    teamKey: "casino",
    origin: "HUMAN",
    kind: mime.startsWith("image/") ? "PHOTO" : "SOURCE",
    theme: themes[0]!,
    tags: ["casino", ...themes.map((t) => `${THEME_TAG_PREFIX}${t}`)],
  };
}

/**
 * Le même fichier existe déjà (même empreinte) : peut-on le ranger pour l'équipe Casino ? Refusé s'il appartient à
 * une autre équipe ou s'il a été produit par l'IA (jamais de média inventé sur un canal Casino).
 */
export function casinoExistingProblem(existing: {
  teamKey: string | null;
  origin: string | null;
}): string | null {
  if (existing.origin === "AI")
    return "Ce fichier a été produit par l'IA : il ne peut pas servir à l'équipe Casino.";
  if (existing.teamKey && existing.teamKey !== "casino")
    return "Ce fichier est déjà rangé pour une autre équipe.";
  return null;
}
