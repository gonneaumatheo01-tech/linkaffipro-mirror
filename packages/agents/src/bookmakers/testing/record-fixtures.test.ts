/**
 * Phase 35 (chantier B) — produit les enregistrements de référence (`fixtures/bookmakers/<site>/recording.json` et
 * `changed/recording.json`) en lançant `recordSite` sur les sites locaux INVENTÉS (Chromium, 127.0.0.1 seulement),
 * puis en remplaçant l'origine locale par l'origine canonique `https://<site>.test`. Sauté sauf demande explicite :
 *   cd packages/agents && WRITE_BOOKMAKER_RECORDINGS=1 npx vitest run src/bookmakers/testing/record-fixtures.test.ts
 * (sous vitest et non tsx : tsx ajoute `__name` dans le code envoyé à la page, ce qui casse `evaluate`).
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rebaseRecording } from "../learn/rebase";
import { chromiumAvailable, launchTestBrowser, recordLocalSite } from "./fixtures";
import { FIXTURES_DIR, startLocalSites } from "./local-sites";
import { FIXTURE_ORIGINS, FIXTURE_SITE_KEYS } from "./world";

describe.skipIf(!process.env.WRITE_BOOKMAKER_RECORDINGS || !chromiumAvailable())(
  "enregistrements de référence",
  () => {
    it("écrit recording.json pour chaque site et sa variante « changed »", async () => {
      const sites = await startLocalSites();
      const browser = await launchTestBrowser();
      try {
        for (const site of FIXTURE_SITE_KEYS) {
          for (const variant of [null, "changed"] as const) {
            sites.setVariant(site, variant);
            const { result, betClicked } = await recordLocalSite(browser, sites, site);
            if ("obstacle" in result)
              throw new Error(`${site} ${variant ?? ""} : ${result.obstacle}`);
            expect(betClicked).toBe(false);
            const rec = rebaseRecording(
              {
                ...result,
                startedAt: "2026-10-25T09:00:00.000Z",
                endedAt: "2026-10-25T09:03:00.000Z",
              },
              FIXTURE_ORIGINS[site],
            );
            rec.responses = rec.responses.map((r) => ({ ...r, at: "2026-10-25T09:01:00.000Z" }));
            writeFileSync(
              `${FIXTURES_DIR}${site}/${variant ? `${variant}/` : ""}recording.json`,
              JSON.stringify(rec, null, 2) + "\n",
            );
            console.log(
              `${site}${variant ? `/${variant}` : ""} : ${rec.responses.length} réponses, ${rec.pages.length} pages (${rec.pages.map((p) => p.step).join(", ")}), ${rec.pageOdds.length} cotes, moteur ${rec.providerHint}`,
            );
          }
          sites.setVariant(site, null);
        }
      } finally {
        await browser.close();
        await sites.stop();
      }
    }, 600_000);
  },
);
