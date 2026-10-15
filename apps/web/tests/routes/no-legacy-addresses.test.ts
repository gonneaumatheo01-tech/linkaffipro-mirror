/**
 * Aucune ancienne adresse dans le code du site (phase 9) : les pages déplacées (Envois, Automatisations, Bots,
 * Journal, Liens, ancien tableau de bord, onglets des statistiques) ne sont plus citées dans un lien, une redirection, un `revalidatePath`
 * ou un `fetch`. Elles ne vivent que dans `lib/legacy-routes.ts`, qui les redirige (308).
 * Contrôle statique des sources (comme tests/a11y) : il tourne à chaque `pnpm test`.
 * Hors périmètre : `scripts/` (outillage de captures, qui doit connaître les anciennes adresses).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyRedirect } from "@/lib/legacy-routes";

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
/** Ancien tableau de bord : `/?tab=…` (désormais une page par rubrique : `/stats/ads`…). */
const OLD_DASHBOARD_TAB = /["'`]\/\?(?:[^"'`]*&)?tab=/;
/** Anciens onglets des statistiques : `/stats?tab=…` (désormais `/stats/ads`, `/stats/funnel`…). */
const OLD_STATS_TAB = /["'`]\/stats\/?\?(?:[^"'`]*&)?tab=/;

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

  it("aucun onglet des statistiques en paramètre « tab » (une page par rubrique)", () => {
    expect(offenders(OLD_STATS_TAB)).toEqual([]);
  });

  it("rubrique « Pages » (phase 15) : une adresse neuve, jamais redirigée, ni la rubrique ni les pages publiques", () => {
    for (const path of [
      "/pages",
      "/pages/new",
      "/pages/p1",
      "/pages/p1/export",
      "/j/promo",
      "/j/_e",
    ])
      expect(legacyRedirect(path), path).toBeNull();
    // Le menu et les liens de la rubrique pointent vers /pages (aucune autre adresse inventée pour elle).
    const nav = files.find((f) => f.rel === "components/admin/nav-logic.ts")!;
    expect(nav.src).toContain('href: "/pages"');
    expect(offenders(/["'`]\/landing(?:-pages)?(?:[/?"'`])/)).toEqual([]);
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
    expect(OLD_STATS_TAB.test("`/stats?tab=ads`")).toBe(true);
    expect(OLD_STATS_TAB.test('href="/stats?range=30d&tab=funnel"')).toBe(true);
    expect(OLD_STATS_TAB.test('redirect("/stats/?tab=cohorts")')).toBe(true);
    expect(OLD_STATS_TAB.test('href="/stats/ads?range=30d"')).toBe(false);
    expect(OLD_STATS_TAB.test('href="/stats?range=30d&compare=1"')).toBe(false);
    expect(OLD_STATS_TAB.test('href="/campaigns/x?tab=ads"')).toBe(false);
  });
});
