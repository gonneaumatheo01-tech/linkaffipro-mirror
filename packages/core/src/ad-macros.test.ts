import { describe, expect, it } from "vitest";
import { buildAdUrl } from "./ad-macros";
import { fillUrlTemplate, isSubId, newSubId } from "./sub-id";

describe("macros publicitaires", () => {
  it("TikTok : ttclid et macros de campagne non encodées", () => {
    const url = buildAdUrl("TIKTOK", "https://go.goolink.eu/abc12345");
    expect(url.startsWith("https://go.goolink.eu/abc12345?")).toBe(true);
    expect(url).toContain("ttclid=__CLICKID__");
    expect(url).toContain("utm_source=tiktok");
    expect(url).toContain("utm_campaign=__CAMPAIGN_NAME__");
    expect(url).toContain("tt_adgroup_id=__AID__");
    expect(url).not.toContain("%5F%5F");
  });
  it("Meta : paramètres dynamiques {{...}} et pas de fbclid (ajouté par Meta)", () => {
    const url = buildAdUrl("META", "https://go.goolink.eu/abc12345");
    expect(url).toContain("utm_source=meta");
    expect(url).toContain("utm_campaign={{campaign.name}}");
    expect(url).toContain("fb_ad_id={{ad.id}}");
    expect(url).not.toContain("fbclid");
  });
  it("ajoute les paramètres supplémentaires encodés et gère un ? existant", () => {
    const url = buildAdUrl("OTHER", "https://go.goolink.eu/x?y=1", { utm_campaign: "été 2026" });
    expect(url).toBe("https://go.goolink.eu/x?y=1&utm_source=other&utm_medium=paid&utm_campaign=%C3%A9t%C3%A9%202026");
  });
});

describe("sub-ID", () => {
  it("fait 12 caractères base62 sans point", () => {
    for (let i = 0; i < 100; i++) {
      const s = newSubId();
      expect(s).toMatch(/^[0-9A-Za-z]{12}$/);
      expect(isSubId(s)).toBe(true);
    }
    expect(isSubId("abc.def")).toBe(false);
    expect(isSubId("abcdefghij")).toBe(false);
  });
  it("remplit le modèle d'URL Link Affi", () => {
    expect(fillUrlTemplate("https://linkaffi.me/go/47eb8mwc?sub_id={subid}", { subid: "AbC123xyz789" })).toBe("https://linkaffi.me/go/47eb8mwc?sub_id=AbC123xyz789");
    expect(fillUrlTemplate("https://x/{click_id}/{member_id}/{post_id}", { click_id: "c 1" })).toBe("https://x/c%201//");
  });
});
