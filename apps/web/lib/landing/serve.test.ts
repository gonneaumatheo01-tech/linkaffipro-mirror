import { describe, expect, it } from "vitest";
import { LandingCache, type LandingPageRecord } from "./cache";
import { serveLandingPage, serveLandingPhoto } from "./serve";

const PAGE: LandingPageRecord = {
  id: "p1",
  slug: "promo",
  version: 3,
  channelId: "ch1",
  channelTitle: "Casino VIP",
  language: "fr",
  headline: "Les meilleurs bonus",
  subtext: null,
  buttonText: null,
  footnote: null,
  showPhoto: true,
  cookieBanner: false,
  tiktokPixelId: null,
  metaPixelId: null,
  isActive: true,
  sources: [
    { key: "", isActive: true, inviteLink: "https://t.me/+Default0" },
    { key: "tk01", isActive: true, inviteLink: "https://t.me/+Tk01xxx" },
  ],
};

function cache(pages: LandingPageRecord[] = [PAGE]) {
  return new LandingCache({
    store: {
      loadActive: async () => pages,
      loadBySlug: async (slug) => pages.find((p) => p.slug === slug) ?? null,
      pageExists: async () => true,
      loadPhotos: async () => [{ channelId: "ch1", bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]) }],
    },
  });
}

describe("réponse de la page publique", () => {
  it("200 avec le HTML de la source, en-têtes de cache, CSP et robots ; aucune redirection", async () => {
    const c = cache();
    const res = await serveLandingPage("promo", "tk01", null, "GET", c);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain('href="https://t.me/+Tk01xxx"');
    expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(html)));
  });

  it("HEAD : mêmes en-têtes, sans corps ; If-None-Match : 304", async () => {
    const c = cache();
    const get = await serveLandingPage("promo", null, null, "GET", c);
    const head = await serveLandingPage("promo", null, null, "HEAD", c);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(get.headers.get("etag"));
    expect(head.headers.get("content-length")).toBe(get.headers.get("content-length"));
    const again = await serveLandingPage("promo", null, get.headers.get("etag"), "GET", c);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("source inconnue : exactement les octets de la page par défaut", async () => {
    const c = cache();
    const a = await (await serveLandingPage("promo", null, null, "GET", c)).text();
    const b = await (await serveLandingPage("promo", "inconnue", null, "GET", c)).text();
    expect(b).toBe(a);
  });

  it("page inconnue : 404 jamais gardé en cache ; page sans lien : 503", async () => {
    const c = cache([
      PAGE,
      {
        ...PAGE,
        id: "p2",
        slug: "sans-lien",
        sources: [{ key: "", isActive: true, inviteLink: null }],
      },
    ]);
    const missing = await serveLandingPage("inconnue", null, null, "GET", c);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(missing.headers.get("location")).toBeNull();
    const down = await serveLandingPage("sans-lien", null, null, "GET", c);
    expect(down.status).toBe(503);
    expect(down.headers.get("retry-after")).toBe("30");
  });

  it("photo du canal : gardée un an avec la bonne version, 304, 404 pour un autre canal", async () => {
    const c = cache();
    const html = await (await serveLandingPage("promo", null, null, "GET", c)).text();
    const v = /_p\/ch1\.jpg\?v=([\w-]+)"/.exec(html)?.[1];
    expect(v).toBeTruthy();
    const res = await serveLandingPhoto("ch1.jpg", v!, null, "GET", c);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1]));
    const old = await serveLandingPhoto("ch1.jpg", "ancienne", null, "GET", c);
    expect(old.headers.get("cache-control")).toBe("public, max-age=300");
    const cached = await serveLandingPhoto("ch1.jpg", v!, res.headers.get("etag"), "GET", c);
    expect(cached.status).toBe(304);
    expect((await serveLandingPhoto("ch2.jpg", null, null, "GET", c)).status).toBe(404);
    expect((await serveLandingPhoto("../x.jpg", null, null, "GET", c)).status).toBe(404);
  });
});
