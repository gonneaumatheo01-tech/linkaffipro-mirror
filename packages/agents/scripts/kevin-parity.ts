/**
 * `pnpm kevin:parity` (phase 34) : liste toutes les actions serveur du site et dit, pour chacune, comment Kevin la
 * fait (opération, capacité, catalogue) ou pourquoi elle est exclue (avec le remplacement). Code de sortie 1 s'il en
 * manque une ou si une correspondance est fausse. `--write` : génère `docs/KEVIN-PARITE.md`.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { realParity } from "../src/site/parity-real";
import { parityMarkdown, parityOk, parityTable } from "../src/site/parity-scan";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const { report } = realParity(join(repo, "apps", "web"));
console.log(parityTable(report));
if (process.argv.includes("--write")) {
  const date = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
  writeFileSync(join(repo, "docs", "KEVIN-PARITE.md"), `${parityMarkdown(report, { date })}\n`);
  console.log("docs/KEVIN-PARITE.md écrit.");
}
process.exit(parityOk(report) ? 0 : 1);
