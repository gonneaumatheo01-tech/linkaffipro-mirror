import { describe, expect, it } from "vitest";
import { findOfferByKey, parseLinkAffiReference, parseWizardPayload, planAds, searchOffers, stepIndex, WIZARD_STEPS } from "./wizard";

describe("assistant Nouvelle campagne : lecture de la charge", () => {
  const base = { name: "TT-casinoX-FR-canalA-2026-10", vertical: "CASINO", affiliateCampaignIds: ["aff1"], channelIds: ["ch1"], adPlatform: "TIKTOK", adCount: 3 };
  it("accepte une campagne complète", () => {
    const r = parseWizardPayload({ ...base, budgetDaily: "50,5", startAt: "2026-10-01", endAt: "2026-10-31", notes: " ok " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.budgetDaily).toBe(50.5);
      expect(r.data.vertical).toBe("CASINO");
      expect(r.data.adCount).toBe(3);
      expect(r.data.notes).toBe("ok");
      expect(r.data.connectionId).toBeNull();
    }
  });
  it("refuse un nom vide et renvoie à l'étape 1", () => {
    const r = parseWizardPayload({ ...base, name: "  " });
    expect(r).toMatchObject({ ok: false, error: { step: "general" } });
  });
  it("refuse une date de fin avant le début", () => {
    const r = parseWizardPayload({ ...base, startAt: "2026-10-10", endAt: "2026-10-01" });
    expect(r).toMatchObject({ ok: false, error: { step: "general" } });
  });
  it("exige une plateforme et un canal dès qu'il y a des pubs", () => {
    expect(parseWizardPayload({ ...base, adPlatform: "" })).toMatchObject({ ok: false, error: { step: "ads" } });
    expect(parseWizardPayload({ ...base, channelIds: [] })).toMatchObject({ ok: false, error: { step: "channels" } });
  });
  it("accepte une campagne sans pub ni canal (modifiable ensuite)", () => {
    const r = parseWizardPayload({ name: "Test", adCount: 0, adPlatform: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ adCount: 0, adPlatform: null, channelIds: [], affiliateCampaignIds: [] });
  });
  it("limite le nombre de pubs à 20 et ignore un univers inconnu", () => {
    expect(parseWizardPayload({ ...base, adCount: 21 })).toMatchObject({ ok: false, error: { step: "ads" } });
    const r = parseWizardPayload({ ...base, vertical: "AUTRE" });
    if (r.ok) expect(r.data.vertical).toBeNull();
  });
  it("dédoublonne les listes", () => {
    const r = parseWizardPayload({ ...base, channelIds: ["ch1", "ch1", " ", "ch2"] });
    if (r.ok) expect(r.data.channelIds).toEqual(["ch1", "ch2"]);
  });
});

describe("résolution d'un lien linkaffi.me/go/<clé>", () => {
  it("lit la clé dans un lien complet, avec ou sans paramètres", () => {
    expect(parseLinkAffiReference("https://linkaffi.me/go/47eb8mwc")).toBe("47eb8mwc");
    expect(parseLinkAffiReference("https://linkaffi.me/go/47eb8mwc?sub_id={subid}")).toBe("47eb8mwc");
    expect(parseLinkAffiReference("https://mon-domaine.com/go/abcd1234/")).toBe("abcd1234");
  });
  it("accepte la clé seule et refuse le reste", () => {
    expect(parseLinkAffiReference("  47eb8mwc ")).toBe("47eb8mwc");
    expect(parseLinkAffiReference("https://linkaffi.me/s/court")).toBeNull();
    expect(parseLinkAffiReference("")).toBeNull();
    expect(parseLinkAffiReference("ab")).toBeNull();
  });
  const offers = [
    { id: "a", name: "Casino X FR", programName: "Casino X", campaignKey: "47eb8mwc", externalId: "ext-1", trackingUrlTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}" },
    { id: "b", name: "Paris Y", programName: "Bookmaker Y", campaignKey: null, externalId: "zz99zz99", trackingUrlTemplate: "https://linkaffi.me/go/zz99zz99?sub_id={subid}" },
  ];
  it("retrouve l'offre par clé, identifiant externe ou URL", () => {
    expect(findOfferByKey("47EB8MWC", offers)?.id).toBe("a");
    expect(findOfferByKey("zz99zz99", offers)?.id).toBe("b");
    expect(findOfferByKey("inconnue1", offers)).toBeNull();
  });
  it("cherche par nom, clé ou casino, sans accents", () => {
    expect(searchOffers("casino x", offers).map((o) => o.id)).toEqual(["a"]);
    expect(searchOffers("ZZ99", offers).map((o) => o.id)).toEqual(["b"]);
    expect(searchOffers("", offers)).toHaveLength(2);
  });
});

describe("découpage des pubs", () => {
  it("crée une pub et un lien nommés par numéro", () => {
    const plan = planAds("TT-casinoX-FR-canalA-2026-10", 2);
    expect(plan).toEqual([
      { adName: "Pub 1", linkName: "TT-casinoX-FR-canalA-2026-10 — Pub 1" },
      { adName: "Pub 2", linkName: "TT-casinoX-FR-canalA-2026-10 — Pub 2" },
    ]);
    expect(planAds("x", 0)).toEqual([]);
    expect(planAds("x", 99)).toHaveLength(20);
  });
  it("connaît ses 4 étapes", () => {
    expect(WIZARD_STEPS).toHaveLength(4);
    expect(stepIndex("channels")).toBe(2);
    expect(stepIndex("inconnue")).toBe(0);
  });
});
