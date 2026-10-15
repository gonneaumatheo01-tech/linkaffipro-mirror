import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LANDING_SCRIPT, LANDING_STYLE } from "@linkaffipro/core";
import { cspHash, etagMatches, etagOf, landingCsp, pageHeaders } from "./headers";

describe("en-têtes des pages d'atterrissage", () => {
  it("CSP sans pixel : seuls le CSS et le script de la page, envois et images vers le site", () => {
    const csp = landingCsp({ pixels: false, script: true });
    const sha = (s: string) => createHash("sha256").update(s).digest("base64");
    expect(csp).toContain(`script-src 'sha256-${sha(LANDING_SCRIPT)}'`);
    expect(csp).toContain(`style-src 'sha256-${sha(LANDING_STYLE)}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https:/);
  });

  it("CSP avec pixel : le script de la page peut charger celui du pixel, envois du pixel en https", () => {
    const csp = landingCsp({ pixels: true, script: true });
    expect(csp).toMatch(/script-src 'sha256-[^']+' 'strict-dynamic' https:/);
    expect(csp).toContain("connect-src 'self' https:");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(landingCsp({ pixels: false, script: false })).toContain("script-src 'none'");
  });

  it("ETag stable pour un même corps, cache court et revalidé, jamais indexée", () => {
    expect(etagOf("abc")).toBe(etagOf(Buffer.from("abc")));
    expect(etagOf("abc")).not.toBe(etagOf("abd"));
    expect(cspHash("x")).toMatch(/^'sha256-[A-Za-z0-9+/=]+'$/);
    const h = pageHeaders({ etag: '"lj-1"', csp: "default-src 'none'", length: 10 });
    expect(h).toMatchObject({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      ETag: '"lj-1"',
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Length": "10",
    });
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("vary");
  });

  it("If-None-Match : liste, étoile, préfixe faible", () => {
    expect(etagMatches('"lj-1"', '"lj-1"')).toBe(true);
    expect(etagMatches('W/"lj-1", "lj-2"', '"lj-2"')).toBe(true);
    expect(etagMatches("*", '"lj-1"')).toBe(true);
    expect(etagMatches('"lj-0"', '"lj-1"')).toBe(false);
    expect(etagMatches(null, '"lj-1"')).toBe(false);
  });
});
