import { readFileSync } from "node:fs";
/**
 * Options des scripts `pnpm captures` et `pnpm a11y` (fonctions pures, testées dans options.test.ts).
 * Les deux scripts se connectent au site comme un utilisateur (formulaire /login) avec le compte de vérification
 * créé par `pnpm db:demo` ; par défaut ils visent le serveur de développement local sur le port 3103.
 */

export const DEFAULT_BASE = "http://localhost:3103";
export const DEFAULT_EMAIL = "verification@linkaffipro.internal";
/** Mot de passe du compte de vérification de la base de démonstration LOCALE (voir packages/db/prisma/demo-seed.ts). */
export const DEFAULT_PASSWORD = "demo-local-1234";
export const DEFAULT_WIDTHS = [1440, 390];
export const DEFAULT_OUT = "docs/captures";
export const DEFAULT_A11Y_REPORT = "docs/captures/a11y-report.json";
export const DEFAULT_A11Y_TAGS = ["wcag2a", "wcag2aa"];
export const DEFAULT_TIMEOUT_S = 120;

export const IMPACTS = ["minor", "moderate", "serious", "critical"] as const;
export type Impact = (typeof IMPACTS)[number];

export type Env = Record<string, string | undefined>;

/** Moteurs Playwright : Chromium (Chrome, Edge), Firefox, WebKit (Safari). */
export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type BrowserName = (typeof BROWSERS)[number];

/** Erreur de saisie : le script l'affiche telle quelle et s'arrête (code 2). */
export class OptionError extends Error {}

type Common = {
  base: string;
  email: string;
  password: string;
  /** Valeur brute de --pages (liste ou fichier) ; null = liste par défaut (toutes les pages de l'admin). */
  pages: string | null;
  timeoutMs: number;
  /** Navigateur utilisé (`--browser`, variable CAPTURE_BROWSER) ; Chromium par défaut. */
  browser: BrowserName;
  help: boolean;
};

export type CaptureOptions = Common & {
  /** Dossier des images, relatif à la racine du dépôt (ou absolu). */
  out: string;
  widths: number[];
  /** Garde aussi les captures brutes en PNG (dossier raw/, ignoré par git). */
  keepPng: boolean;
  /** Retire de l'index les adresses qui ne font pas partie de cette passe. */
  prune: boolean;
};

export type A11yOptions = Common & {
  width: number;
  /** Rapport JSON, relatif à la racine du dépôt (ou absolu). */
  report: string;
  tags: string[];
  failOn: Impact;
};

type FlagSpec = Record<string, "string" | "boolean">;

const ALIASES: Record<string, string> = { h: "help" };

/** Lit `--nom valeur`, `--nom=valeur` et `--drapeau` ; refuse les options inconnues. */
function parseFlags(argv: readonly string[], spec: FlagSpec): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue; // ajouté par certaines versions de pnpm devant les arguments
    const m = /^--?([a-zA-Z][\w-]*)(?:=(.*))?$/s.exec(arg);
    if (!m) throw new OptionError(`Argument inattendu : ${arg} (les options commencent par --).`);
    const name = ALIASES[m[1]!] ?? m[1]!;
    const kind = spec[name];
    if (!kind) throw new OptionError(`Option inconnue : --${name} (voir --help).`);
    if (kind === "boolean") {
      out[name] = true;
      continue;
    }
    let value = m[2];
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--"))
        throw new OptionError(`--${name} attend une valeur.`);
      value = next;
      i++;
    }
    out[name] = value;
  }
  return out;
}

function str(v: string | true | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function isLocalHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

function parseBase(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new OptionError(
      `--base : adresse invalide « ${raw} » (exemple : http://localhost:3103).`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new OptionError(`--base : l'adresse doit commencer par http:// ou https://.`);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_S * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 3600)
    throw new OptionError(`--timeout : durée en secondes entre 1 et 3600 (reçu « ${raw} »).`);
  return Math.round(n * 1000);
}

/** Largeurs d'écran en pixels, « 1440,390 ». */
export function parseWidths(raw: string): number[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new OptionError("--widths : au moins une largeur (ex. 1440,390).");
  const out: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 320 || n > 3840)
      throw new OptionError(`--widths : « ${p} » n'est pas une largeur entre 320 et 3840 px.`);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function parseBrowser(raw: string | undefined): BrowserName {
  const b = (raw ?? "chromium").trim().toLowerCase();
  if (!(BROWSERS as readonly string[]).includes(b))
    throw new OptionError(`--browser : une valeur parmi ${BROWSERS.join(", ")} (reçu « ${raw} »).`);
  return b as BrowserName;
}

function common(flags: Record<string, string | true>, env: Env): Common {
  const base = parseBase(str(flags.base) ?? env.CAPTURE_BASE ?? DEFAULT_BASE);
  // --password-file : le mot de passe est lu dans un fichier (droits 600), jamais écrit sur la ligne de commande.
  const passwordFile = str(flags["password-file"]) ?? env.CAPTURE_PASSWORD_FILE;
  const fromFile = passwordFile ? readFileSync(passwordFile, "utf8").trim() : undefined;
  const explicitPassword = str(flags.password) ?? fromFile ?? env.CAPTURE_PASSWORD;
  // Le mot de passe de démonstration n'existe que dans la base locale : on ne l'essaie jamais ailleurs
  // (une tentative ratée en production compterait dans la limite de connexions et le journal).
  if (!explicitPassword && !isLocalHost(new URL(base).hostname))
    throw new OptionError(
      `Site non local (${base}) : donnez le mot de passe du compte avec --password ou CAPTURE_PASSWORD.`,
    );
  return {
    base,
    email: (str(flags.email) ?? env.CAPTURE_EMAIL ?? DEFAULT_EMAIL).trim().toLowerCase(),
    password: explicitPassword ?? env.DEMO_PASSWORD ?? DEFAULT_PASSWORD,
    pages: str(flags.pages) ?? null,
    timeoutMs: parseTimeout(str(flags.timeout)),
    browser: parseBrowser(str(flags.browser) ?? env.CAPTURE_BROWSER),
    help: flags.help === true,
  };
}

const COMMON_SPEC: FlagSpec = {
  base: "string",
  email: "string",
  password: "string",
  "password-file": "string",
  pages: "string",
  timeout: "string",
  browser: "string",
  help: "boolean",
};

export function parseCaptureOptions(argv: readonly string[], env: Env): CaptureOptions {
  const flags = parseFlags(argv, {
    ...COMMON_SPEC,
    out: "string",
    widths: "string",
    "keep-png": "boolean",
    prune: "boolean",
  });
  return {
    ...common(flags, env),
    out: str(flags.out) ?? DEFAULT_OUT,
    widths: parseWidths(str(flags.widths) ?? env.CAPTURE_WIDTHS ?? DEFAULT_WIDTHS.join(",")),
    keepPng: flags["keep-png"] === true,
    prune: flags.prune === true,
  };
}

export function parseA11yOptions(argv: readonly string[], env: Env): A11yOptions {
  const flags = parseFlags(argv, {
    ...COMMON_SPEC,
    width: "string",
    report: "string",
    tags: "string",
    "fail-on": "string",
  });
  const failOn = (str(flags["fail-on"]) ?? "critical").trim() as Impact;
  if (!IMPACTS.includes(failOn))
    throw new OptionError(`--fail-on : une valeur parmi ${IMPACTS.join(", ")}.`);
  const tags = (str(flags.tags) ?? DEFAULT_A11Y_TAGS.join(","))
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length === 0) throw new OptionError("--tags : au moins une famille de règles axe.");
  return {
    ...common(flags, env),
    width: parseWidths(str(flags.width) ?? "1440")[0]!,
    report: str(flags.report) ?? DEFAULT_A11Y_REPORT,
    tags,
    failOn,
  };
}

/**
 * Adresse normalisée : barre initiale, pas de barre finale (sauf la racine), origine retirée si une URL complète est
 * donnée, `:id` accepté pour `[id]` (les crochets sont des jokers dans zsh : `'/campaigns/[id]'` doit être entre
 * guillemets, `/campaigns/:id` non).
 */
export function normalizeRoute(input: string): string {
  let s = input.trim();
  const abs = /^https?:\/\/[^/?#]+(.*)$/i.exec(s);
  if (abs) s = abs[1] ?? "";
  const q = s.search(/[?#]/);
  let path = q === -1 ? s : s.slice(0, q);
  const rest = q === -1 ? "" : s.slice(q);
  path = path
    .split("/")
    .filter(Boolean)
    .map((seg) => (seg.startsWith(":") && seg.length > 1 ? `[${seg.slice(1)}]` : seg))
    .join("/");
  return `/${path}${rest}`;
}

/** Liste de pages : virgules ou une par ligne ; lignes vides et commentaires (#) ignorés ; sans doublon. */
export function parsePagesText(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) continue;
    for (const part of clean.split(",")) {
      const p = part.trim();
      if (!p) continue;
      const r = normalizeRoute(p);
      if (!out.includes(r)) out.push(r);
    }
  }
  return out;
}

/**
 * Valeur de --pages : une liste si elle commence par « / » ou « http », ou contient une virgule ; sinon le chemin d'un
 * fichier texte (une adresse par ligne).
 */
export function resolvePagesValue(
  value: string,
  fs: { exists: (p: string) => boolean; read: (p: string) => string },
): string[] {
  const v = value.trim();
  const isList = v.startsWith("/") || /^https?:\/\//i.test(v) || v.includes(",");
  let pages: string[];
  if (isList) pages = parsePagesText(v);
  else {
    if (!fs.exists(v)) throw new OptionError(`--pages : fichier introuvable « ${v} ».`);
    pages = parsePagesText(fs.read(v));
  }
  if (pages.length === 0) throw new OptionError("--pages : aucune page dans la liste.");
  return pages;
}

export const CAPTURES_HELP = `pnpm captures [options]
  Captures pleine page de chaque écran (webp) dans docs/captures/ et index docs/REFONTE-CAPTURES.md.
  --base <url>        site à capturer (défaut ${DEFAULT_BASE}, variable CAPTURE_BASE)
  --email <e-mail>    compte (défaut ${DEFAULT_EMAIL}, variable CAPTURE_EMAIL)
  --password <mdp>    mot de passe (variables CAPTURE_PASSWORD puis DEMO_PASSWORD ; défaut local : celui de pnpm db:demo)
  --password-file <f> mot de passe lu dans un fichier (variable CAPTURE_PASSWORD_FILE) : rien sur la ligne de commande
  --pages <liste|fichier>  ex. /,/campaigns,/members ou /campaigns/:id ; fichier : une adresse par ligne
                      (défaut : toutes les pages de l'admin + adresses prévues par la refonte + pages publiques)
  --widths <liste>    largeurs en px (défaut 1440,390)
  --out <dossier>     dossier des images, relatif à la racine du dépôt (défaut docs/captures)
  --timeout <s>       délai maximum par page (défaut ${DEFAULT_TIMEOUT_S})
  --browser <nom>     ${BROWSERS.join(" | ")} (défaut chromium, variable CAPTURE_BROWSER) ; installer d'abord le
                      navigateur : pnpm --filter web exec playwright install firefox
  --keep-png          garde aussi les PNG bruts (docs/captures/raw/, ignoré par git)
  --prune             retire de l'index les adresses absentes de cette passe`;

export const A11Y_HELP = `pnpm a11y [options]
  Contrôle axe (règles wcag2a + wcag2aa) de chaque écran à 1440 px ; rapport docs/captures/a11y-report.json.
  Sort en erreur (code 1) s'il reste une violation « critical » (voir --fail-on).
  --base, --email, --password, --pages, --timeout, --browser : comme pnpm captures
  --width <px>        largeur (défaut 1440)
  --tags <liste>      familles de règles axe (défaut ${DEFAULT_A11Y_TAGS.join(",")})
  --fail-on <niveau>  ${IMPACTS.join(" | ")} (défaut critical)
  --report <fichier>  rapport JSON (défaut ${DEFAULT_A11Y_REPORT})`;
