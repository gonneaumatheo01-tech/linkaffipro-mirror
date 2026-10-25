/**
 * Phase 34, chantier A — inventaire réel : lit `apps/web/{app,lib,components}/**` sur le disque et confronte à
 * `SITE_PARITY`, `SITE_OPS`, au registre des capacités et au catalogue de Kevin. Utilisé par `pnpm kevin:parity` et
 * par le test réel de `site-parity.test.ts`. Jamais importé par le code de production (lecture du disque).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { BOSS_CATALOG } from "../boss/catalog";
import { capability } from "../orders/registry";
import { SITE_OPS } from "./ops";
import { SITE_PARITY } from "./parity";
import { checkParity, scanServerActions, type ParityReport, type ServerActionEntry, type ServerActionFile } from "./parity-scan";

const ROOTS = ["app", "lib", "components"];

function walk(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".next")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
}

/** Fichiers TypeScript du site (chemins relatifs à `apps/web`, séparateur « / »). */
export function readWebFiles(webRoot: string): ServerActionFile[] {
  const paths: string[] = [];
  for (const r of ROOTS) walk(join(webRoot, r), paths);
  return paths.sort().map((p) => ({ path: relative(webRoot, p).split(sep).join("/"), content: readFileSync(p, "utf8") }));
}

export function realParity(webRoot: string, opts: { impls?: readonly string[] | null } = {}): { actions: ServerActionEntry[]; report: ParityReport } {
  const actions = scanServerActions(readWebFiles(webRoot));
  const report = checkParity({
    actions,
    parity: SITE_PARITY,
    ops: SITE_OPS,
    impls: opts.impls ?? null,
    capabilityExists: (team, key) => capability(team, key) !== null,
    catalogKeys: new Set(BOSS_CATALOG.map((a) => a.key)),
  });
  return { actions, report };
}
