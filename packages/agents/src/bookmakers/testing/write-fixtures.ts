/**
 * Phase 35 (chantier B) — écrit les fichiers des sites locaux INVENTÉS dans `packages/agents/fixtures/bookmakers/` :
 * pages, réponses JSON, messages WebSocket et recettes correctes (`recipe.json`, réponses « Opus » simulées).
 * Les enregistrements (`recording.json`) sont produits à part par `record-fixtures.ts` (Chromium, sites locaux).
 *   node --import tsx packages/agents/src/bookmakers/testing/write-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FIXTURES_DIR } from "./local-sites";
import { FIXTURE_RECIPES } from "./recipes";
import { renderSiteFixtures } from "./render";
import { FIXTURE_SITE_KEYS } from "./world";

for (const site of FIXTURE_SITE_KEYS) {
  const files = renderSiteFixtures(site);
  files["recipe.json"] = JSON.stringify(FIXTURE_RECIPES[site].base, null, 2) + "\n";
  files["changed/recipe.json"] = JSON.stringify(FIXTURE_RECIPES[site].changed, null, 2) + "\n";
  for (const [name, content] of Object.entries(files)) {
    const path = `${FIXTURES_DIR}${site}/${name}`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  console.log(`${site} : ${Object.keys(files).length} fichiers`);
}
