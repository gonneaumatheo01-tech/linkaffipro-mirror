import { describe, expect, it } from "vitest";
import {
  affiliateIdOf,
  findOfferByKey,
  markOurOffers,
  offerAffiliateLabel,
  parseLinkAffiReference,
  parseWizardPayload,
  planAds,
  searchOffers,
  stepIndex,
  visibleOffers,
  WIZARD_STEPS,
} from "./wizard";

describe("assistant Nouvelle campagne : lecture de la charge", () => {
  const base = {
    name: "TT-casinoX-FR-canalA-2026-10",
    vertical: "CASINO",
    affiliateCampaignIds: ["aff1"],
    channelIds: ["ch1"],
    entryChannelId: "ch1",
    adPlatform: "TIKTOK",
    adCount: 3,
  };
  it("accepte une campagne complète", () => {
    const r = parseWizardPayload({
      ...base,
      budgetDaily: "50,5",
      startAt: "2026-10-01",
      endAt: "2026-10-31",
      notes: " ok ",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.budgetDaily).toBe(50.5);
      expect(r.data.vertical).toBe("CASINO");
      expect(r.data.adCount).toBe(3);
      expect(r.data.notes).toBe("ok");
      expect(r.data.connectionId).toBeNull();
    }
  });
  it("refuse un nom vide et renvoie à l'étape 1, sur le champ du nom", () => {
    const r = parseWizardPayload({ ...base, name: "  " });
    expect(r).toMatchObject({ ok: false, error: { step: "general", field: "name" } });
  });
  it("refuse une date de fin avant le début (champ « Fin »)", () => {
    const r = parseWizardPayload({ ...base, startAt: "2026-10-10", endAt: "2026-10-01" });
    expect(r).toMatchObject({ ok: false, error: { step: "general", field: "endAt" } });
    expect(parseWizardPayload({ ...base, budgetDaily: "-3" })).toMatchObject({
      ok: false,
      error: { step: "general", field: "budgetDaily" },
    });
  });
  it("exige une plateforme et un canal dès qu'il y a des pubs", () => {
    expect(parseWizardPayload({ ...base, adPlatform: "" })).toMatchObject({
      ok: false,
      error: { step: "ads", field: "adPlatform" },
    });
    expect(parseWizardPayload({ ...base, channelIds: [] })).toMatchObject({
      ok: false,
      error: { step: "channels", field: "channelIds" },
    });
  });
  it("accepte une campagne sans pub ni canal (modifiable ensuite)", () => {
    const r = parseWizardPayload({ name: "Test", adCount: 0, adPlatform: "" });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.data).toMatchObject({
        adCount: 0,
        adPlatform: null,
        channelIds: [],
        affiliateCampaignIds: [],
      });
  });
  it("canal d'entrée des pubs : choisi explicitement parmi les canaux cochés (pas le premier coché)", () => {
    const r = parseWizardPayload({ ...base, channelIds: ["ch1", "ch2"], entryChannelId: "ch2" });
    expect(r.ok && r.data.entryChannelId).toBe("ch2");
    expect(
      parseWizardPayload({ ...base, channelIds: ["ch1", "ch2"], entryChannelId: "ch9" }),
    ).toMatchObject({ ok: false, error: { step: "ads", field: "entryChannelId" } });
    expect(
      parseWizardPayload({ ...base, channelIds: ["ch1", "ch2"], entryChannelId: "" }),
    ).toMatchObject({ ok: false, error: { step: "ads" } });
    // Un seul canal coché : c'est lui, même sans choix explicite.
    const one = parseWizardPayload({ ...base, entryChannelId: undefined });
    expect(one.ok && one.data.entryChannelId).toBe("ch1");
  });
  it("sans pub : aucun canal d'entrée exigé, plateforme facultative", () => {
    const r = parseWizardPayload({ ...base, adPlatform: "", adCount: 0, entryChannelId: "" });
    expect(r.ok && r.data).toMatchObject({ adCount: 0, adPlatform: null, entryChannelId: null });
  });
  it("garde le jeton d'idempotence (UUID) et ignore un jeton mal formé", () => {
    const id = "6f1c1f9e-2a7b-4c1d-9a51-0f0d2a4b8c3e";
    const r = parseWizardPayload({ ...base, requestId: id });
    expect(r.ok && r.data.requestId).toBe(id);
    const bad = parseWizardPayload({ ...base, requestId: "../../x" });
    expect(bad.ok && bad.data.requestId).toBeNull();
  });
  it("campagne pub importée choisie : seulement avec un compte connecté", () => {
    const r = parseWizardPayload({ ...base, connectionId: "conn1", importedCampaignId: "shell1" });
    expect(r.ok && r.data.importedCampaignId).toBe("shell1");
    const sans = parseWizardPayload({ ...base, connectionId: "", importedCampaignId: "shell1" });
    expect(sans.ok && sans.data.importedCampaignId).toBeNull();
  });
  it("limite le nombre de pubs à 20 et ignore un univers inconnu", () => {
    expect(parseWizardPayload({ ...base, adCount: 21 })).toMatchObject({
      ok: false,
      error: { step: "ads", field: "adCount" },
    });
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
    expect(parseLinkAffiReference("https://linkaffi.me/go/47eb8mwc?sub_id={subid}")).toBe(
      "47eb8mwc",
    );
    expect(parseLinkAffiReference("https://mon-domaine.com/go/abcd1234/")).toBe("abcd1234");
  });
  it("accepte la clé seule et refuse le reste", () => {
    expect(parseLinkAffiReference("  47eb8mwc ")).toBe("47eb8mwc");
    expect(parseLinkAffiReference("https://linkaffi.me/s/court")).toBeNull();
    expect(parseLinkAffiReference("")).toBeNull();
    expect(parseLinkAffiReference("ab")).toBeNull();
  });
  const offers = [
    {
      id: "a",
      name: "Casino X FR",
      programName: "Casino X",
      campaignKey: "47eb8mwc",
      externalId: "ext-1",
      trackingUrlTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}",
    },
    {
      id: "b",
      name: "Paris Y",
      programName: "Bookmaker Y",
      campaignKey: null,
      externalId: "zz99zz99",
      trackingUrlTemplate: "https://linkaffi.me/go/zz99zz99?sub_id={subid}",
    },
  ];
  it("retrouve l'offre par clé, identifiant externe ou URL", () => {
    expect(findOfferByKey("47EB8MWC", offers)?.id).toBe("a");
    expect(findOfferByKey("zz99zz99", offers)?.id).toBe("b");
    expect(findOfferByKey("inconnue1", offers)).toBeNull();
  });
  it("refuse une clé tronquée : la clé doit être entière dans l'URL d'offre", () => {
    const urlOnly = [
      {
        id: "c",
        name: "Offre C",
        programName: "Casino C",
        campaignKey: null,
        externalId: "uuid-c",
        trackingUrlTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}",
      },
    ];
    expect(findOfferByKey("47eb", urlOnly)).toBeNull();
    expect(findOfferByKey("47eb8", urlOnly)).toBeNull();
    expect(findOfferByKey("47eb8mwc", urlOnly)?.id).toBe("c");
    const bare = [{ ...urlOnly[0]!, trackingUrlTemplate: "https://linkaffi.me/go/47eb8mwc" }];
    expect(findOfferByKey("47eb8mwc", bare)?.id).toBe("c");
    expect(findOfferByKey("47eb8", bare)).toBeNull();
  });
  it("cherche par nom, clé ou casino, sans accents", () => {
    expect(searchOffers("casino x", offers).map((o) => o.id)).toEqual(["a"]);
    expect(searchOffers("ZZ99", offers).map((o) => o.id)).toEqual(["b"]);
    expect(searchOffers("", offers)).toHaveLength(2);
  });
});

describe("offres à nous et offres des autres affiliés", () => {
  it("lit l'affilié dans les données brutes Link Affi", () => {
    expect(affiliateIdOf({ affiliate_id: "aff-uuid-1", name: "x" })).toBe("aff-uuid-1");
    expect(affiliateIdOf({ name: "x" })).toBeNull();
    expect(affiliateIdOf(null)).toBeNull();
    expect(affiliateIdOf("texte")).toBeNull();
  });
  const rows = [
    { id: "o1", affiliateId: "nous" },
    { id: "o2", affiliateId: "nous" },
    { id: "o3", affiliateId: "autre" },
    { id: "o4", affiliateId: null },
  ];
  it("une offre est à nous si elle porte nos clics, ou si elle a le même affilié qu'une telle offre", () => {
    const marked = markOurOffers(rows, new Set(["o1"]), new Set(["nous"]));
    expect(marked.filter((o) => o.ours).map((o) => o.id)).toEqual(["o1", "o2"]);
  });
  it("par défaut seulement les nôtres ; toutes si on coche « afficher les autres affiliés » ou si rien n'est encore connu", () => {
    const marked = markOurOffers(rows, new Set(["o1"]), new Set(["nous"]));
    expect(visibleOffers(marked, false).map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(visibleOffers(marked, true)).toHaveLength(4);
    const unknown = markOurOffers(rows, new Set(), new Set());
    expect(visibleOffers(unknown, false)).toHaveLength(4);
  });
  it("affiche l'affilié en clair", () => {
    expect(offerAffiliateLabel({ ours: true, affiliateId: "x" })).toBe("à vous");
    expect(offerAffiliateLabel({ ours: false, affiliateId: "1a2b3c4d-5e6f" })).toBe(
      "autre affilié (1a2b3c4d)",
    );
    expect(offerAffiliateLabel({ ours: false, affiliateId: null })).toBe("affilié inconnu");
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
