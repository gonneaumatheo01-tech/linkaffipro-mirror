/**
 * Phase 34, chantier A — inventaire « tout par Kevin » (pur, testable sans disque) : toutes les actions serveur du site
 * (fichiers dont la première instruction est `"use server"`, fonctions exportées `export async function x` ou
 * `export const x = async`), leur nature et leur rôle devinés, les pages qui les utilisent, puis la correspondance de
 * `SITE_PARITY` : chaque action est couverte (opération, capacité, entrée du catalogue) ou exclue avec une raison ET un
 * remplacement ; sinon elle est MANQUANTE (le garde-fou fait échouer la CI). Utilisé par `scripts/kevin-parity.ts` et
 * `site-parity.test.ts`.
 */
import type { SiteOpKind, SiteOpMeta, SiteParityEntry } from "./contract";

export type ServerActionFile = { path: string; content: string };

export type ServerActionEntry = {
  /** « <chemin relatif à apps/web>#<fonction> ». */
  key: string;
  file: string;
  name: string;
  nature: SiteOpKind;
  role: "ADMIN" | "MANAGER" | "?";
  /** Pages du site (adresses) qui utilisent l'action, déduites des imports. */
  pages: string[];
};

/** Retire les commentaires d'en-tête et les lignes vides : la première instruction est-elle `"use server"` ? */
export function isUseServerFile(content: string): boolean {
  let s = content.replace(/^\uFEFF/, "");
  for (;;) {
    const t = s.trimStart();
    if (t.startsWith("//")) s = t.slice(t.indexOf("\n") === -1 ? t.length : t.indexOf("\n") + 1);
    else if (t.startsWith("/*")) {
      const end = t.indexOf("*/");
      s = end === -1 ? "" : t.slice(end + 2);
    } else {
      s = t;
      break;
    }
  }
  return /^(["'])use server\1\s*;?/.test(s);
}

/** Fonctions exportées d'un fichier d'actions (ordre du fichier) avec leur corps approximatif. */
export function exportedFunctions(content: string): { name: string; body: string }[] {
  const re = /export\s+(?:async\s+function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*async\b)/g;
  const hits: { name: string; at: number }[] = [];
  for (const m of content.matchAll(re)) hits.push({ name: (m[1] ?? m[2])!, at: m.index! });
  return hits.map((h, i) => ({ name: h.name, body: content.slice(h.at, hits[i + 1]?.at ?? content.length) }));
}

const words = (name: string) =>
  name
    .replace(/Action$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();

/** Nature devinée par les mots du nom (pur). */
export function guessNature(name: string): SiteOpKind {
  const w = words(name);
  if (/\b(delete|remove|purge|anonymi[sz]e|revoke|disconnect|erase|wipe|destroy|unlink|drop)\b/.test(w)) return "delete";
  if (/\b(token|secret|password|credential|credentials|key|keys|api)\b/.test(w)) return "secret";
  if (/\b(send|broadcast|publish|notify|blast)\b/.test(w)) return "send";
  if (/\b(connect|oauth|authorize|login|sign)\b/.test(w)) return "connect";
  if (/\b(create|add|new|import|generate|duplicate|copy|invite|upload|register)\b/.test(w)) return "create";
  if (/\b(get|list|load|fetch|search|preview|read|count|export|find|check|test|simulate|lookup)\b/.test(w)) return "read";
  return "setting";
}

/** Rôle deviné par le corps (pur) : `requireAdmin` → ADMIN ; `requireUser` / `apiUser` → MANAGER ; sinon « ? ». */
export function guessRole(body: string): ServerActionEntry["role"] {
  if (/\brequireAdmin(?:Page)?\s*\(/.test(body) || /role\s*!==?\s*["']ADMIN["']/.test(body)) return "ADMIN";
  if (/\b(requireUser|apiUser|requireManager)\s*\(/.test(body)) return "MANAGER";
  return "?";
}

const stripExt = (p: string) => p.replace(/\.(tsx?|jsx?|mjs)$/, "").replace(/\/index$/, "");

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function joinPath(base: string, rel: string): string {
  const parts = base ? base.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** Fichiers (relatifs à apps/web, sans extension) importés par un fichier. */
export function importsOf(file: ServerActionFile): Set<string> {
  const out = new Set<string>();
  for (const m of file.content.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
    const spec = m[1]!;
    if (spec.startsWith("@/")) out.add(stripExt(spec.slice(2)));
    else if (spec.startsWith(".")) out.add(stripExt(joinPath(dirOf(file.path), spec)));
  }
  return out;
}

/** Adresse d'une page à partir d'un fichier de `app/` (groupes `(x)` retirés), ou null hors `app/`. */
export function routeOf(path: string): string | null {
  if (!path.startsWith("app/")) return null;
  const segs = dirOf(path)
    .split("/")
    .slice(1)
    .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("_"));
  return `/${segs.join("/")}`;
}

/** Pages qui utilisent un fichier (imports directs, ou par un composant / module intermédiaire). */
export function pagesOf(target: string, files: readonly ServerActionFile[], importIndex?: Map<string, Set<string>>): string[] {
  const index = importIndex ?? new Map(files.map((f) => [f.path, importsOf(f)]));
  const t = stripExt(target);
  const direct = files.filter((f) => f.path !== target && index.get(f.path)?.has(t));
  const pages = new Set<string>();
  for (const f of direct) {
    const r = routeOf(f.path);
    if (r) pages.add(r);
    else {
      const ft = stripExt(f.path);
      for (const g of files) if (g.path !== f.path && index.get(g.path)?.has(ft)) {
        const rr = routeOf(g.path);
        if (rr) pages.add(rr);
      }
    }
  }
  if (!pages.size) {
    const own = routeOf(target);
    if (own) pages.add(own);
  }
  return [...pages].sort();
}

/** Toutes les actions serveur d'un ensemble de fichiers (relatifs à apps/web). */
export function scanServerActions(files: readonly ServerActionFile[]): ServerActionEntry[] {
  const index = new Map(files.map((f) => [f.path, importsOf(f)]));
  const out: ServerActionEntry[] = [];
  for (const f of files) {
    if (!isUseServerFile(f.content)) continue;
    const pages = pagesOf(f.path, files, index);
    for (const fn of exportedFunctions(f.content))
      out.push({ key: `${f.path}#${fn.name}`, file: f.path, name: fn.name, nature: guessNature(fn.name), role: guessRole(fn.body), pages });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export type ParityCovered = { action: ServerActionEntry; by: string; op?: SiteOpMeta };
export type ParityExcluded = { action: ServerActionEntry; reason: string; replacement: string };
export type ParityReport = {
  covered: ParityCovered[];
  excluded: ParityExcluded[];
  missing: ServerActionEntry[];
  /** Correspondances fausses : opération ou capacité inconnue, exclusion sans raison ou sans remplacement, action disparue. */
  errors: string[];
};

export type ParityCheckInput = {
  actions: readonly ServerActionEntry[];
  parity: Record<string, SiteParityEntry>;
  ops: readonly SiteOpMeta[];
  /** Clés des cœurs côté site (`SITE_OP_IMPLS`) ; null = non vérifié ici (le test du site le fait). */
  impls?: readonly string[] | null;
  /** « <équipe>.<clé> » existe-t-il dans le registre des capacités ? */
  capabilityExists(team: string, key: string): boolean;
  catalogKeys: ReadonlySet<string>;
};

/** Correspondance de chaque action serveur (pur). */
export function checkParity(input: ParityCheckInput): ParityReport {
  const ops = new Map(input.ops.map((o) => [o.key, o]));
  const impls = input.impls ? new Set(input.impls) : null;
  const report: ParityReport = { covered: [], excluded: [], missing: [], errors: [] };
  const known = new Set(input.actions.map((a) => a.key));
  for (const action of input.actions) {
    const e = input.parity[action.key];
    if (!e) {
      report.missing.push(action);
      continue;
    }
    if ("op" in e) {
      const op = ops.get(e.op);
      if (!op) report.errors.push(`${action.key} : opération « ${e.op} » absente de SITE_OPS`);
      else if (impls && !impls.has(e.op)) report.errors.push(`${action.key} : opération « ${e.op} » sans cœur dans SITE_OP_IMPLS`);
      else report.covered.push({ action, by: `opération ${e.op}`, op });
    } else if ("capability" in e) {
      const i = e.capability.indexOf(".");
      const team = i === -1 ? "" : e.capability.slice(0, i);
      const key = i === -1 ? e.capability : e.capability.slice(i + 1);
      if (!team || !input.capabilityExists(team, key)) report.errors.push(`${action.key} : capacité « ${e.capability} » absente du registre`);
      else report.covered.push({ action, by: `capacité ${e.capability}` });
    } else if ("catalog" in e) {
      if (!input.catalogKeys.has(e.catalog)) report.errors.push(`${action.key} : entrée « ${e.catalog} » absente du catalogue de Kevin`);
      else report.covered.push({ action, by: `catalogue ${e.catalog}` });
    } else if ("excluded" in e) {
      const reason = e.excluded?.reason?.trim() ?? "";
      const replacement = e.excluded?.replacement?.trim() ?? "";
      if (!reason || !replacement) report.errors.push(`${action.key} : exclusion sans ${!reason ? "raison" : "remplacement"}`);
      else report.excluded.push({ action, reason, replacement });
    } else report.errors.push(`${action.key} : correspondance illisible`);
  }
  for (const k of Object.keys(input.parity)) if (!known.has(k)) report.errors.push(`${k} : correspondance d'une action qui n'existe plus`);
  return report;
}

/** Le garde-fou passe-t-il (zéro manquant, zéro correspondance fausse) ? */
export function parityOk(r: ParityReport): boolean {
  return r.missing.length === 0 && r.errors.length === 0;
}

const NATURE_LABELS: Record<SiteOpKind, string> = {
  read: "lecture",
  setting: "réglage",
  create: "création",
  send: "envoi",
  delete: "suppression",
  secret: "secret",
  connect: "connexion",
};

/** Tableau texte en français (sortie de `pnpm kevin:parity`). */
export function parityTable(r: ParityReport): string {
  const rows: string[] = [];
  const line = (state: string, a: ServerActionEntry, how: string) => rows.push(`${state.padEnd(9)} ${a.key}  (${NATURE_LABELS[a.nature]}, ${a.role})  ${how}`);
  for (const c of r.covered) line("couvert", c.action, c.by);
  for (const x of r.excluded) line("exclu", x.action, `${x.reason} → ${x.replacement}`);
  for (const m of r.missing) line("MANQUANT", m, m.pages.join(", ") || "-");
  const total = r.covered.length + r.excluded.length + r.missing.length;
  rows.push("");
  rows.push(`${total} actions serveur : ${r.covered.length} couvertes, ${r.excluded.length} exclues, ${r.missing.length} manquantes.`);
  for (const e of r.errors) rows.push(`ERREUR ${e}`);
  return rows.join("\n");
}

/** `docs/KEVIN-PARITE.md` : par page, ce qu'on y fait et la phrase à dire à Kevin ; exclusions avec remplacement. */
export function parityMarkdown(r: ParityReport, opts: { date?: string } = {}): string {
  const byPage = new Map<string, { covered: ParityCovered[]; excluded: ParityExcluded[]; missing: ServerActionEntry[] }>();
  const bucket = (pages: string[]) =>
    (pages.length ? pages : ["(sans page)"]).map((p) => {
      if (!byPage.has(p)) byPage.set(p, { covered: [], excluded: [], missing: [] });
      return byPage.get(p)!;
    });
  for (const c of r.covered) for (const b of bucket(c.action.pages)) b.covered.push(c);
  for (const x of r.excluded) for (const b of bucket(x.action.pages)) b.excluded.push(x);
  for (const m of r.missing) for (const b of bucket(m.pages)) b.missing.push(m);
  const total = r.covered.length + r.excluded.length + r.missing.length;
  const out: string[] = [
    "# Tout par Kevin : correspondance du site",
    "",
    "Généré par `pnpm kevin:parity -- --write` (ne pas modifier à la main). Chaque action du site se fait aussi en parlant à Kevin sur Telegram, sauf les exclusions listées avec leur remplacement.",
    "",
    `${opts.date ? `État du ${opts.date} : ` : ""}${total} actions du site, ${r.covered.length} faisables par Kevin, ${r.excluded.length} exclues (avec remplacement), ${r.missing.length} manquantes.`,
    "",
  ];
  for (const page of [...byPage.keys()].sort()) {
    const b = byPage.get(page)!;
    out.push(`## ${page}`, "");
    if (b.covered.length) {
      out.push("| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |", "|---|---|---|");
      for (const c of b.covered) {
        const what = c.op?.description ?? c.by;
        const say = c.op?.examples[0] ? `« ${c.op.examples[0]} »` : c.by;
        out.push(`| ${what.replace(/\|/g, "\\|")} | ${say.replace(/\|/g, "\\|")} | \`${c.action.name}\` |`);
      }
      out.push("");
    }
    if (b.excluded.length) {
      out.push("Exclusions (impossible dans Telegram) :", "");
      const strip = (t: string) => t.trim().replace(/[.\s]+$/u, "");
      for (const x of b.excluded) out.push(`- \`${x.action.name}\` : ${strip(x.reason)}. Kevin propose : ${strip(x.replacement)}.`);
      out.push("");
    }
    if (b.missing.length) {
      out.push("Manquant (à couvrir) :", "");
      for (const m of b.missing) out.push(`- \`${m.name}\` (${NATURE_LABELS[m.nature]})`);
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
