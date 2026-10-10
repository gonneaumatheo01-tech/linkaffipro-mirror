/**
 * Aucune ancienne adresse dans le code du site (phase 9) : les pages déplacées (Envois, Automatisations, Bots,
 * Journal, Liens, ancien tableau de bord) ne sont plus citées dans un lien, une redirection, un `revalidatePath`
 * ou un `fetch`. Elles ne vivent que dans `lib/legacy-routes.ts`, qui les redirige (308).
 * Contrôle statique des sources (comme tests/a11y) : il tourne à chaque `pnpm test`.
 * Hors périmètre : `scripts/` (outillage de captures, qui doit connaître les anciennes adresses).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");
const ROOTS = ["app", "components", "lib"].map((d) => join(WEB, d));
const ALLOWED = new Set(["lib/legacy-routes.ts", "lib/legacy-routes.test.ts"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...ROOTS.flatMap(sourceFiles), join(WEB, "proxy.ts")]
  .map((f) => ({ rel: relative(WEB, f).split("\\").join("/"), src: readFileSync(f, "utf8") }))
  .filter((f) => !ALLOWED.has(f.rel));

/** Une adresse commence juste après un guillemet, une apostrophe ou un accent grave (ou après l'hôte). */
const OLD_SECTION = /(?:["'`]|localhost)\/(broadcasts|automations|bots|journal|links)(?![\w-])/;
/** Ancien tableau de bord : `/?tab=…` (désormais `/stats?tab=…`). */
const OLD_DASHBOARD_TAB = /["'`]\/\?(?:[^"'`]*&)?tab=/;

function offenders(re: RegExp): string[] {
  const out: string[] = [];
  for (const f of files) {
    f.src.split("\n").forEach((line, i) => {
      if (re.test(line)) out.push(`${f.rel}:${i + 1} : ${line.trim().slice(0, 100)}`);
    });
  }
  return out;
}

describe("anciennes adresses absentes du code", () => {
  it("trouve des sources à contrôler", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("aucune page déplacée citée à son ancienne adresse", () => {
    expect(offenders(OLD_SECTION)).toEqual([]);
  });

  it("aucun onglet de l'ancien tableau de bord sur « / »", () => {
    expect(offenders(OLD_DASHBOARD_TAB)).toEqual([]);
  });

  it("le contrôle reconnaît bien une ancienne adresse", () => {
    expect(OLD_SECTION.test('href="/broadcasts/new"')).toBe(true);
    expect(OLD_SECTION.test("redirect(`/links?${q}`)")).toBe(true);
    expect(OLD_SECTION.test('new Request("http://localhost/journal/export")')).toBe(true);
    expect(OLD_SECTION.test('href="/members/broadcasts"')).toBe(false);
    expect(OLD_SECTION.test('import { x } from "@/lib/broadcasts/queries"')).toBe(false);
    expect(OLD_SECTION.test('href="/links-old"')).toBe(false);
    expect(OLD_DASHBOARD_TAB.test("`/?tab=ads&ok=1`")).toBe(true);
    expect(OLD_DASHBOARD_TAB.test('"/?range=7d&tab=funnel"')).toBe(true);
    expect(OLD_DASHBOARD_TAB.test("`/stats?tab=ads`")).toBe(false);
    expect(OLD_DASHBOARD_TAB.test('redirect("/?forbidden=1")')).toBe(false);
  });
});
