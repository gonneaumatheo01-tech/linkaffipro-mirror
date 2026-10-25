/**
 * Phase 34 : correspondance croisée Kevin ↔ site. Toute opération connue de Kevin (`SITE_OPS`, métadonnées dans
 * `packages/agents/src/site/ops`) a son cœur côté site (`SITE_OP_IMPLS`), et inversement ; aucun cœur en double.
 */
import { describe, expect, it } from "vitest";
import { SITE_OPS } from "@linkaffipro/agents";
import { SITE_OP_IMPLS } from "./ops";
import { indexSiteOpImpls, siteOpImpl } from "./registry";

describe("registre des opérations du site", () => {
  it("aucun cœur en double", () => {
    expect(() => indexSiteOpImpls(SITE_OP_IMPLS)).not.toThrow();
    expect(() => indexSiteOpImpls([{ key: "a.b", run: async () => ({ ok: true, message: "" }) }, { key: "a.b", run: async () => ({ ok: true, message: "" }) }])).toThrow(/double/);
  });

  // Comme le test réel de `site-parity.test.ts` : obligatoire dès que les lots B à E sont remplis.
  it.skipIf(process.env.KEVIN_PARITY_PENDING === "1")("chaque opération de Kevin a un cœur, chaque cœur une opération", () => {
    const meta = new Set(SITE_OPS.map((o) => o.key));
    const impls = new Set(SITE_OP_IMPLS.map((i) => i.key));
    expect([...meta].filter((k) => !impls.has(k)), "opérations sans cœur").toEqual([]);
    expect([...impls].filter((k) => !meta.has(k)), "cœurs sans opération").toEqual([]);
    for (const k of meta) expect(siteOpImpl(k), k).not.toBeNull();
  });
});
