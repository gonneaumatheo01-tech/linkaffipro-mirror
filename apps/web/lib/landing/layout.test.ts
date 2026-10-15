import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, webkit, type Browser, type BrowserType } from "playwright";
import { LANDING_TEXT_LIMITS, renderLandingDocument } from "@linkaffipro/core";

/**
 * Mise en page réelle de la page d'atterrissage (phase 15) dans les moteurs de Safari (WebKit) et de Chrome
 * (Chromium) : « un seul écran mobile, sans défilement », bouton toujours visible, même avec les textes les plus longs
 * permis, la photo et le bandeau cookies, dans un petit téléphone dans une appli (iPhone SE dans TikTok : 375 × 548).
 * Passé (sans échec) si les navigateurs de Playwright ne sont pas installés (`pnpm --filter web exec playwright
 * install chromium webkit`). Délais propres aux crochets (lancement et fermeture des navigateurs) : sous la charge de
 * `pnpm test` (tous les paquets en parallèle), la fermeture dépassait le délai par défaut de 10 s.
 */

const ENGINES: Array<[string, BrowserType]> = [
  ["webkit", webkit],
  ["chromium", chromium],
];
const available = ENGINES.filter(([, e]) => {
  try {
    return existsSync(e.executablePath());
  } catch {
    return false;
  }
});

const VIEWPORTS = [
  { width: 375, height: 548 }, // iPhone SE, navigateur intégré (barres de l'appli)
  { width: 360, height: 640 }, // petit Android
  { width: 390, height: 664 }, // iPhone 14 dans TikTok
  { width: 320, height: 480 },
];

function words(n: number): string {
  let s = "";
  while (s.length < n) s += "Bonus exclusif ";
  return s.slice(0, n);
}

const LONGEST = {
  channelTitle: words(LANDING_TEXT_LIMITS.channelTitle),
  headline: words(LANDING_TEXT_LIMITS.headline),
  subtext: words(LANDING_TEXT_LIMITS.subtext),
  buttonText: words(LANDING_TEXT_LIMITS.buttonText),
  footnote: words(LANDING_TEXT_LIMITS.footnote),
};
const UNBREAKABLE = {
  channelTitle: "W".repeat(LANDING_TEXT_LIMITS.channelTitle),
  headline: "W".repeat(LANDING_TEXT_LIMITS.headline),
  subtext: "W".repeat(LANDING_TEXT_LIMITS.subtext),
  buttonText: "W".repeat(LANDING_TEXT_LIMITS.buttonText),
  footnote: "W".repeat(LANDING_TEXT_LIMITS.footnote),
};

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

type Measure = {
  scrollH: number;
  innerH: number;
  btnTop: number;
  btnBottom: number;
  bannerBottom: number | null;
  titleTop: number;
};

const MEASURE = `(function(){
  function r(s){var e=document.querySelector(s);return e?e.getBoundingClientRect():null}
  var b=r("#b"),k=r("#k"),n=r(".n");
  return {scrollH:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight),innerH:innerHeight,
    btnTop:Math.round(b.top),btnBottom:Math.round(b.bottom),bannerBottom:k?Math.round(k.bottom):null,titleTop:Math.round(n.top)};
})()`;

describe.skipIf(available.length === 0)(
  "page d'atterrissage : un seul écran (vrais moteurs)",
  () => {
    const browsers = new Map<string, Browser>();
    beforeAll(async () => {
      for (const [name, engine] of available) browsers.set(name, await engine.launch());
    }, 60_000);
    afterAll(async () => {
      // Chaque navigateur fermé même si un autre échoue (aucun processus laissé derrière).
      await Promise.allSettled([...browsers.values()].map((b) => b.close()));
    }, 60_000);

    it("textes les plus longs, photo et bandeau cookies : rien ne défile, bouton et bandeau entiers à l'écran", async () => {
      const failures: string[] = [];
      for (const [name, browser] of browsers) {
        for (const [variant, texts] of Object.entries({ LONGEST, UNBREAKABLE })) {
          const doc = renderLandingDocument({
            pageId: "p1",
            lang: "fr",
            inviteLink: "https://t.me/+AbCdEf",
            sourceKey: "",
            tiktokPixelId: "CD2UC93C77U35BVUO310",
            metaPixelId: "1070571443971391",
            cookieBanner: true,
            photoUrl: "/j/_p/c1.jpg?v=1",
            ...texts,
          });
          for (const viewport of VIEWPORTS) {
            const ctx = await browser.newContext({ viewport });
            try {
              const page = await ctx.newPage();
              await page.route("https://go.goolink.eu/**", (route) => {
                const req = route.request();
                if (req.url().includes("/j/_p/"))
                  return route.fulfill({ status: 200, contentType: "image/gif", body: GIF });
                if (req.method() === "POST") return route.fulfill({ status: 204 });
                return route.fulfill({ status: 200, contentType: "text/html", body: doc.html });
              });
              // Aucun appel réel aux partenaires : les pixels ne sont de toute façon chargés qu'après « Accepter ».
              await page.route(
                /^https:\/\/(analytics\.tiktok\.com|connect\.facebook\.net)\//,
                (r) => r.fulfill({ status: 200, body: "" }),
              );
              await page.goto("https://go.goolink.eu/j/test");
              const m = (await page.evaluate(MEASURE)) as Measure;
              const where = `${name} ${variant} ${viewport.width}×${viewport.height}`;
              if (m.scrollH > m.innerH)
                failures.push(`${where} : défile (${m.scrollH} > ${m.innerH})`);
              if (m.btnTop < 0 || m.btnBottom > m.innerH)
                failures.push(`${where} : bouton hors de l'écran (${m.btnTop}–${m.btnBottom})`);
              if (m.bannerBottom === null || m.bannerBottom > m.innerH)
                failures.push(`${where} : bandeau hors de l'écran (${m.bannerBottom})`);
              if (m.titleTop < 0) failures.push(`${where} : titre du canal coupé en haut`);
            } finally {
              await ctx.close();
            }
          }
        }
      }
      expect(failures).toEqual([]);
    }, 120_000);
  },
);
