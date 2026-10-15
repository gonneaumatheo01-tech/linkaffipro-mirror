import { describe, expect, it } from "vitest";
import {
  effectiveGateChannelIds,
  exceptionCondition,
  isDuplicateWelcome,
  noRuleOutcome,
  orderRules,
  pickRuleForProvenance,
  placeNewRule,
  provenanceFromJson,
  provenanceLabel,
  provenanceOfLink,
  ruleMatches,
  shadowingRule,
  SOURCE_KINDS,
  sourceKindMatches,
  UNKNOWN_PROVENANCE,
  welcomeKindFor,
  type ScopedRule,
} from "./provenance";

const TIR = "ch-tir";
const ZONE = "ch-zone";
const ROULETTE = "ch-roulette";

function rule(p: Partial<ScopedRule> & Pick<ScopedRule, "id" | "scope">): ScopedRule {
  return {
    isActive: true,
    inviteLinkId: null,
    sourceChannelId: null,
    sourceKind: null,
    sortOrder: 0,
    isDefault: p.scope === "DEFAULT",
    ...p,
  };
}

const gateFromTir = provenanceOfLink({
  id: "l-gate-tir",
  kind: "GATE",
  sourceChannelId: TIR,
  adPlatform: null,
});
const gateFromRoulette = provenanceOfLink({
  id: "l-gate-rou",
  kind: "GATE",
  sourceChannelId: ROULETTE,
  adPlatform: null,
});
const tiktok = provenanceOfLink({
  id: "l-ad-tt",
  kind: "AD_ENTRY",
  sourceChannelId: null,
  adPlatform: "TIKTOK",
});
const meta = provenanceOfLink({
  id: "l-ad-meta",
  kind: "AD_ENTRY",
  sourceChannelId: null,
  adPlatform: "META",
});
const otherAd = provenanceOfLink({
  id: "l-ad-x",
  kind: "AD_ENTRY",
  sourceChannelId: null,
  adPlatform: null,
});
const shareInTir = provenanceOfLink({
  id: "l-share",
  kind: "SHARE",
  sourceChannelId: TIR,
  adPlatform: null,
});
const shareAlone = provenanceOfLink({
  id: "l-share2",
  kind: "SHARE",
  sourceChannelId: null,
  adPlatform: null,
});
const manual = provenanceOfLink({
  id: "l-man",
  kind: "MANUAL",
  sourceChannelId: null,
  adPlatform: null,
});

describe("provenance d'un lien", () => {
  it("lit le type, le canal d'origine et la plateforme de pub", () => {
    expect(gateFromTir).toEqual({
      type: "GATE",
      inviteLinkId: "l-gate-tir",
      sourceChannelId: TIR,
      adPlatform: null,
    });
    expect(tiktok).toMatchObject({ type: "AD", adPlatform: "TIKTOK", sourceChannelId: null });
    expect(otherAd.adPlatform).toBe("OTHER");
    expect(shareInTir).toMatchObject({ type: "SHARE", sourceChannelId: TIR });
    expect(manual.type).toBe("MANUAL");
  });
  it("un lien inconnu (créé hors de la plateforme, fin masquée par Telegram) donne une provenance inconnue", () => {
    expect(provenanceOfLink(null)).toEqual(UNKNOWN_PROVENANCE);
    expect(provenanceOfLink(undefined).type).toBe("UNKNOWN");
  });
  it("relit prudemment une provenance enregistrée", () => {
    expect(provenanceFromJson({ ...gateFromTir, label: "x" })).toEqual(gateFromTir);
    expect(provenanceFromJson({ type: "AD", adPlatform: "nope" })?.adPlatform).toBe("OTHER");
    expect(provenanceFromJson({ type: "???" })).toBeNull();
    expect(provenanceFromJson(null)).toBeNull();
  });
});

describe("choix de la règle selon la provenance", () => {
  // Exemple du client : Zone Interdite, 5 minutes par défaut, 1 jour pour les personnes venues de Tir Cadré.
  const zoneDefault = rule({ id: "zone-default", scope: "DEFAULT" });
  const fromTir = rule({ id: "zone-from-tir", scope: "SOURCE_CHANNEL", sourceChannelId: TIR });

  it("exemple du client : venu de Tir Cadré → exception ; tout autre lien → règle par défaut", () => {
    const rules = [zoneDefault, fromTir];
    expect(pickRuleForProvenance(rules, gateFromTir)?.id).toBe("zone-from-tir");
    expect(pickRuleForProvenance(rules, shareInTir)?.id).toBe("zone-from-tir");
    for (const p of [
      gateFromRoulette,
      tiktok,
      meta,
      otherAd,
      shareAlone,
      manual,
      UNKNOWN_PROVENANCE,
    ])
      expect(pickRuleForProvenance(rules, p)?.id).toBe("zone-default");
  });

  it("ordre : lien précis → canal d'origine → type de provenance → défaut", () => {
    const rules = [
      zoneDefault,
      rule({ id: "kind-gate", scope: "SOURCE_KIND", sourceKind: "GATE" }),
      fromTir,
      rule({ id: "link", scope: "INVITE_LINK", inviteLinkId: "l-gate-tir" }),
    ];
    expect(pickRuleForProvenance(rules, gateFromTir)?.id).toBe("link");
    expect(
      pickRuleForProvenance(
        rules.filter((r) => r.id !== "link"),
        gateFromTir,
      )?.id,
    ).toBe("zone-from-tir");
    expect(pickRuleForProvenance(rules, gateFromRoulette)?.id).toBe("kind-gate");
    expect(pickRuleForProvenance(rules, tiktok)?.id).toBe("zone-default");
  });

  it("types de provenance : bouton obligatoire, n'importe quel canal, pubs, liens de partage", () => {
    const k = (id: string, sourceKind: ScopedRule["sourceKind"]) =>
      rule({ id, scope: "SOURCE_KIND", sourceKind });
    const m = (r: ScopedRule, p: Parameters<typeof ruleMatches>[1]) => ruleMatches(r, p);
    expect(m(k("g", "GATE"), gateFromTir)).toBe(true);
    expect(m(k("g", "GATE"), shareInTir)).toBe(false);
    expect(m(k("a", "ANY_CHANNEL"), gateFromTir)).toBe(true);
    expect(m(k("a", "ANY_CHANNEL"), shareInTir)).toBe(true);
    expect(m(k("a", "ANY_CHANNEL"), shareAlone)).toBe(false);
    expect(m(k("t", "AD_TIKTOK"), tiktok)).toBe(true);
    expect(m(k("t", "AD_TIKTOK"), meta)).toBe(false);
    expect(m(k("me", "AD_META"), meta)).toBe(true);
    for (const p of [tiktok, meta, otherAd]) expect(m(k("any", "AD_ANY"), p)).toBe(true);
    expect(m(k("any", "AD_ANY"), gateFromTir)).toBe(false);
    expect(m(k("s", "SHARE"), shareAlone)).toBe(true);
    expect(m(k("s", "SHARE"), shareInTir)).toBe(true);
    expect(m(k("s", "SHARE"), manual)).toBe(false);
  });

  it("à niveau égal, l'ordre de l'équipe départage", () => {
    const anyCh = rule({
      id: "any",
      scope: "SOURCE_KIND",
      sourceKind: "ANY_CHANNEL",
      sortOrder: 10,
    });
    const gate = rule({ id: "gate", scope: "SOURCE_KIND", sourceKind: "GATE", sortOrder: 20 });
    expect(pickRuleForProvenance([gate, anyCh], gateFromTir)?.id).toBe("any");
    expect(pickRuleForProvenance([{ ...gate, sortOrder: 5 }, anyCh], gateFromTir)?.id).toBe("gate");
    expect(orderRules([gate, zoneDefault, anyCh]).map((r) => r.id)).toEqual([
      "any",
      "gate",
      "zone-default",
    ]);
  });

  it("une règle inactive, ou une ancienne règle non par défaut, ne s'applique jamais ; sans règle : null", () => {
    expect(
      pickRuleForProvenance([{ ...fromTir, isActive: false }, zoneDefault], gateFromTir)?.id,
    ).toBe("zone-default");
    expect(pickRuleForProvenance([{ ...zoneDefault, isDefault: false }], tiktok)).toBeNull();
    expect(pickRuleForProvenance([], tiktok)).toBeNull();
    expect(pickRuleForProvenance([{ ...zoneDefault, isActive: false }], tiktok)).toBeNull();
  });

  it("une exception de canal ne vaut que pour les liens qui viennent d'un canal (pas pour une pub)", () => {
    expect(ruleMatches(fromTir, { ...tiktok, sourceChannelId: TIR })).toBe(false);
  });
});

describe("exceptions masquées et place d'une nouvelle exception", () => {
  const anyAd = rule({ id: "any-ad", scope: "SOURCE_KIND", sourceKind: "AD_ANY", sortOrder: 10 });
  const tt = rule({ id: "tt", scope: "SOURCE_KIND", sourceKind: "AD_TIKTOK", sortOrder: 20 });

  it("« n'importe quelle pub » placée avant « pub TikTok » la rend inutile", () => {
    expect(shadowingRule([anyAd, tt], tt)?.id).toBe("any-ad");
    expect(shadowingRule([{ ...anyAd, sortOrder: 30 }, tt], tt)).toBeNull();
    expect(shadowingRule([{ ...anyAd, isActive: false }, tt], tt)).toBeNull();
    const dup = rule({ id: "tir2", scope: "SOURCE_CHANNEL", sourceChannelId: TIR, sortOrder: 5 });
    const tir = rule({ id: "tir1", scope: "SOURCE_CHANNEL", sourceChannelId: TIR, sortOrder: 1 });
    expect(shadowingRule([dup, tir], dup)?.id).toBe("tir1");
  });

  it("une nouvelle exception précise se place avant l'exception générale qui la couvrirait", () => {
    const placed = placeNewRule([anyAd], { ...tt, sortOrder: 0 });
    expect(placed.map((r) => r.id)).toEqual(["tt", "any-ad"]);
    const meta = rule({ id: "meta", scope: "SOURCE_KIND", sourceKind: "AD_META" });
    expect(placeNewRule([tt], meta).map((r) => r.id)).toEqual(["tt", "meta"]);
  });
});

describe("canaux à rejoindre effectifs (exigences croisées sans boucle)", () => {
  // Zone Interdite exige Zone Roulette et Tir Cadré ; Tir Cadré exige Zone Interdite.
  const zoneRule = { scope: "DEFAULT" as const, gateChannelIds: [ROULETTE, TIR] };

  it("le canal d'où vient la personne compte comme déjà rejoint", () => {
    const shareFromTir = { ...shareInTir };
    expect(
      effectiveGateChannelIds(
        { scope: "SOURCE_KIND", gateChannelIds: [ROULETTE, TIR] },
        shareFromTir,
        ZONE,
      ),
    ).toEqual({
      gateChannelIds: [ROULETTE],
      noGates: false,
    });
    expect(
      effectiveGateChannelIds(
        { scope: "SOURCE_CHANNEL", gateChannelIds: [ZONE, TIR, ROULETTE, ROULETTE] },
        gateFromTir,
        ZONE,
      ),
    ).toEqual({
      gateChannelIds: [ROULETTE],
      noGates: false,
    });
  });

  it("venu d'un canal obligatoire et tombé sur la règle par défaut : aucun canal imposé (pas de chaîne)", () => {
    expect(
      effectiveGateChannelIds({ scope: "DEFAULT", gateChannelIds: [ZONE] }, gateFromRoulette, TIR),
    ).toEqual({
      gateChannelIds: [],
      noGates: true,
    });
  });

  it("toute autre provenance garde les canaux de la règle par défaut", () => {
    expect(effectiveGateChannelIds(zoneRule, tiktok, ZONE)).toEqual({
      gateChannelIds: [ROULETTE, TIR],
      noGates: false,
    });
    expect(effectiveGateChannelIds(zoneRule, UNKNOWN_PROVENANCE, ZONE).gateChannelIds).toEqual([
      ROULETTE,
      TIR,
    ]);
  });

  it("canal sans règle : validation à la main, sauf une personne venue d'un canal obligatoire (entrée directe)", () => {
    expect(noRuleOutcome(gateFromTir)).toBe("IMMEDIATE");
    for (const p of [tiktok, shareInTir, manual, UNKNOWN_PROVENANCE])
      expect(noRuleOutcome(p)).toBe("MANUAL");
  });
});

describe("messages d'accueil", () => {
  it("accueil complet dès qu'il y a des canaux à rejoindre ; court message pour une personne venue d'un canal obligatoire", () => {
    expect(welcomeKindFor({ provenance: gateFromTir, hasGates: false, sendWelcome: true })).toBe(
      "short",
    );
    expect(welcomeKindFor({ provenance: gateFromTir, hasGates: true, sendWelcome: false })).toBe(
      "full",
    );
    expect(welcomeKindFor({ provenance: tiktok, hasGates: false, sendWelcome: true })).toBe("full");
    expect(welcomeKindFor({ provenance: tiktok, hasGates: false, sendWelcome: false })).toBe(
      "none",
    );
    expect(welcomeKindFor({ provenance: gateFromTir, hasGates: false, sendWelcome: false })).toBe(
      "none",
    );
  });

  it("anti-doublon : pas deux accueils du même bot en 10 minutes, sauf avec des canaux à rejoindre", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    const before = (min: number) => new Date(now.getTime() - min * 60_000);
    expect(
      isDuplicateWelcome({ kind: "short", hasGates: false, lastWelcomeAt: before(3), now }),
    ).toBe(true);
    expect(
      isDuplicateWelcome({ kind: "full", hasGates: false, lastWelcomeAt: before(9.9), now }),
    ).toBe(true);
    expect(
      isDuplicateWelcome({ kind: "full", hasGates: false, lastWelcomeAt: before(10), now }),
    ).toBe(false);
    expect(
      isDuplicateWelcome({ kind: "full", hasGates: true, lastWelcomeAt: before(1), now }),
    ).toBe(false);
    expect(isDuplicateWelcome({ kind: "short", hasGates: false, lastWelcomeAt: null, now })).toBe(
      false,
    );
  });
});

describe("textes en français", () => {
  const titles = { [TIR]: "Tir Cadré", [ZONE]: "Zone Interdite" };
  it("provenance d'une demande", () => {
    expect(provenanceLabel(gateFromTir, titles)).toBe("Venu de « Tir Cadré » (canal obligatoire)");
    expect(provenanceLabel(gateFromRoulette, titles)).toBe(
      "Venu d'un de nos canaux (canal obligatoire)",
    );
    expect(provenanceLabel(shareInTir, titles, "Post Tir Cadré")).toBe(
      "Venu du lien de partage « Post Tir Cadré »",
    );
    expect(provenanceLabel(tiktok, titles)).toBe("Venu d'une pub TikTok");
    expect(provenanceLabel(otherAd, titles, "Pub été")).toBe("Venu d'une pub (« Pub été »)");
    expect(provenanceLabel(UNKNOWN_PROVENANCE)).toBe("Venu d'un autre lien");
  });
  it("condition d'une exception", () => {
    expect(
      exceptionCondition(rule({ id: "x", scope: "SOURCE_CHANNEL", sourceChannelId: TIR }), titles),
    ).toBe("de « Tir Cadré »");
    expect(
      exceptionCondition(
        rule({ id: "x", scope: "SOURCE_CHANNEL", sourceChannelId: "gone" }),
        titles,
      ),
    ).toBe("d'un canal supprimé");
    expect(exceptionCondition(rule({ id: "x", scope: "SOURCE_KIND", sourceKind: "AD_META" }))).toBe(
      "d'une pub Meta",
    );
    expect(
      exceptionCondition(
        rule({ id: "x", scope: "INVITE_LINK", inviteLinkId: "l1" }),
        {},
        { l1: "Post" },
      ),
    ).toBe("du lien « Post »");
    expect(exceptionCondition(rule({ id: "x", scope: "INVITE_LINK", inviteLinkId: "gone" }))).toBe(
      "d'un lien supprimé",
    );
  });
});

describe("campagnes Telegram des affiliés Link Affi (phase 13)", () => {
  const link = {
    id: "l-aff",
    kind: "LINKAFFI" as const,
    sourceChannelId: null,
    adPlatform: null,
    linkaffiCampaignKey: "aB3dE5",
    linkaffiCampaignName: "Paul · Zone Interdite",
    linkaffiAffiliateId: "aff-paul",
    linkaffiAffiliateName: "Paul",
  };
  const fromPaul = provenanceOfLink(link);
  const fromMarie = provenanceOfLink({
    ...link,
    id: "l-aff2",
    linkaffiAffiliateId: "aff-marie",
    linkaffiAffiliateName: "Marie",
  });
  const kind = (
    id: string,
    sourceKind: ScopedRule["sourceKind"],
    extra: Partial<ScopedRule> = {},
  ) => rule({ id, scope: "SOURCE_KIND", sourceKind, ...extra });

  it("lit la campagne et l'affilié du lien, et les relit depuis la demande enregistrée", () => {
    expect(fromPaul).toMatchObject({
      type: "LINKAFFI",
      inviteLinkId: "l-aff",
      linkaffi: { campaignKey: "aB3dE5", affiliateId: "aff-paul", affiliateName: "Paul" },
    });
    expect(provenanceFromJson(JSON.parse(JSON.stringify(fromPaul)))).toEqual(fromPaul);
  });

  it("campagne précise (lien), affilié précis, n'importe quel affilié", () => {
    const rules = [
      rule({ id: "default", scope: "DEFAULT" }),
      kind("any", "LINKAFFI_ANY", { sortOrder: 20 }),
      kind("paul", "LINKAFFI_AFFILIATE", { linkaffiAffiliateId: "aff-paul", sortOrder: 10 }),
      rule({ id: "campaign", scope: "INVITE_LINK", inviteLinkId: "l-aff" }),
    ];
    expect(pickRuleForProvenance(rules, fromPaul)?.id).toBe("campaign");
    expect(
      pickRuleForProvenance(
        rules.filter((r) => r.id !== "campaign"),
        fromPaul,
      )?.id,
    ).toBe("paul");
    expect(pickRuleForProvenance(rules, fromMarie)?.id).toBe("any");
    expect(pickRuleForProvenance(rules, tiktok)?.id).toBe("default");
    expect(
      ruleMatches(kind("x", "LINKAFFI_AFFILIATE", { linkaffiAffiliateId: null }), fromPaul),
    ).toBe(false);
  });

  it("« n'importe quel affilié » placé avant masque un affilié précis", () => {
    const anyAff = kind("any", "LINKAFFI_ANY", { sortOrder: 1 });
    const paul = kind("paul", "LINKAFFI_AFFILIATE", {
      linkaffiAffiliateId: "aff-paul",
      sortOrder: 2,
    });
    expect(shadowingRule([anyAff, paul], paul)?.id).toBe("any");
    expect(placeNewRule([anyAff], paul).map((r) => r.id)).toEqual(["paul", "any"]);
    const marie = kind("marie", "LINKAFFI_AFFILIATE", {
      linkaffiAffiliateId: "aff-marie",
      sortOrder: 0,
    });
    expect(shadowingRule([marie, paul], paul)).toBeNull();
  });

  it("canal sans règle : validation à la main ; accueil complet ; textes en français", () => {
    expect(noRuleOutcome(fromPaul)).toBe("MANUAL");
    expect(welcomeKindFor({ provenance: fromPaul, hasGates: false, sendWelcome: true })).toBe(
      "full",
    );
    expect(provenanceLabel(fromPaul)).toBe(
      "Venu de l'affilié « Paul » (campagne « Paul · Zone Interdite »)",
    );
    expect(exceptionCondition(kind("x", "LINKAFFI_ANY"))).toBe(
      "de n'importe quel affilié Link Affi",
    );
    expect(
      exceptionCondition(
        kind("x", "LINKAFFI_AFFILIATE", { linkaffiAffiliateId: "aff-paul" }),
        {},
        {},
        { "aff-paul": "Paul" },
      ),
    ).toBe("de l'affilié « Paul »");
  });
});

describe("pages d'atterrissage (phase 15)", () => {
  const landingLink = {
    id: "l-land-tk01",
    kind: "LANDING" as const,
    sourceChannelId: null,
    adPlatform: null,
    landingPageId: "page-promo",
    landingSource: "tk01",
  };
  const fromPromo = provenanceOfLink(landingLink);
  const fromPromoDefault = provenanceOfLink({
    ...landingLink,
    id: "l-land-def",
    landingSource: "",
  });
  const fromOtherPage = provenanceOfLink({
    ...landingLink,
    id: "l-land-x",
    landingPageId: "page-autre",
    landingSource: "exo1",
  });
  // Page supprimée : le lien révoqué garde sa source, plus sa page (clé étrangère SetNull).
  const fromDeletedPage = provenanceOfLink({
    ...landingLink,
    id: "l-land-del",
    landingPageId: null,
  });
  const kind = (
    id: string,
    sourceKind: ScopedRule["sourceKind"],
    extra: Partial<ScopedRule> = {},
  ) => rule({ id, scope: "SOURCE_KIND", sourceKind, ...extra });

  it('lit la page et la source du lien (source par défaut "" gardée), et les relit depuis la demande enregistrée', () => {
    expect(fromPromo).toEqual({
      type: "LANDING",
      inviteLinkId: "l-land-tk01",
      sourceChannelId: null,
      adPlatform: null,
      landing: { pageId: "page-promo", sourceKey: "tk01" },
    });
    expect(fromPromoDefault.landing).toEqual({ pageId: "page-promo", sourceKey: "" });
    expect(fromDeletedPage.landing).toEqual({ pageId: null, sourceKey: "tk01" });
    for (const p of [fromPromo, fromPromoDefault, fromDeletedPage])
      expect(provenanceFromJson(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(provenanceFromJson({ type: "LANDING", inviteLinkId: "l1" })).toEqual({
      type: "LANDING",
      inviteLinkId: "l1",
      sourceChannelId: null,
      adPlatform: null,
      landing: { pageId: null, sourceKey: null },
    });
    expect(
      provenanceFromJson({ type: "LANDING", landing: { pageId: 3, sourceKey: ["x"] } })?.landing,
    ).toEqual({ pageId: null, sourceKey: null });
    // Les autres provenances n'ont pas de page.
    expect(provenanceFromJson({ ...tiktok, landing: { pageId: "p" } })).not.toHaveProperty(
      "landing",
    );
    expect(
      provenanceOfLink({ ...landingLink, landingPageId: undefined, landingSource: undefined })
        .landing,
    ).toEqual({
      pageId: null,
      sourceKey: null,
    });
  });

  it("type de provenance : « toutes les pages » et « la page <nom> » (jamais pour une pub ou un autre lien)", () => {
    expect(sourceKindMatches("LANDING_ANY", fromPromo)).toBe(true);
    expect(sourceKindMatches("LANDING_ANY", fromDeletedPage)).toBe(true);
    for (const p of [tiktok, meta, gateFromTir, shareInTir, manual, UNKNOWN_PROVENANCE])
      expect(sourceKindMatches("LANDING_ANY", p)).toBe(false);
    expect(sourceKindMatches("LANDING_PAGE", fromPromo, { landingPageId: "page-promo" })).toBe(
      true,
    );
    expect(sourceKindMatches("LANDING_PAGE", fromOtherPage, { landingPageId: "page-promo" })).toBe(
      false,
    );
    // Sans la page visée par la règle, « la page <nom> » ne vise personne.
    expect(sourceKindMatches("LANDING_PAGE", fromPromo)).toBe(false);
    expect(sourceKindMatches("LANDING_PAGE", fromDeletedPage, { landingPageId: null })).toBe(false);
    // Une page d'atterrissage n'est pas une pub, même si la pub envoie vers la page.
    for (const k of [
      "AD_ANY",
      "AD_TIKTOK",
      "AD_META",
      "GATE",
      "ANY_CHANNEL",
      "SHARE",
      "LINKAFFI_ANY",
    ] as const)
      expect(sourceKindMatches(k, fromPromo), k).toBe(false);
  });

  it("résolution : lien précis → la page précise → toutes les pages → défaut", () => {
    const rules = [
      rule({ id: "default", scope: "DEFAULT" }),
      kind("any", "LANDING_ANY", { sortOrder: 20 }),
      kind("promo", "LANDING_PAGE", { landingPageId: "page-promo", sortOrder: 10 }),
      rule({ id: "link", scope: "INVITE_LINK", inviteLinkId: "l-land-tk01" }),
    ];
    expect(pickRuleForProvenance(rules, fromPromo)?.id).toBe("link");
    const noLink = rules.filter((r) => r.id !== "link");
    expect(pickRuleForProvenance(noLink, fromPromo)?.id).toBe("promo");
    expect(pickRuleForProvenance(noLink, fromPromoDefault)?.id).toBe("promo");
    expect(pickRuleForProvenance(noLink, fromOtherPage)?.id).toBe("any");
    expect(pickRuleForProvenance(noLink, fromDeletedPage)?.id).toBe("any");
    expect(pickRuleForProvenance(noLink, tiktok)?.id).toBe("default");
    expect(pickRuleForProvenance(noLink, gateFromTir)?.id).toBe("default");
    expect(ruleMatches(kind("x", "LANDING_PAGE", { landingPageId: null }), fromPromo)).toBe(false);
    expect(
      ruleMatches(
        kind("x", "LANDING_PAGE", { landingPageId: "page-promo", isActive: false }),
        fromPromo,
      ),
    ).toBe(false);
    // Une exception « pub » n'attrape pas les personnes venues d'une page.
    expect(pickRuleForProvenance([rules[0]!, kind("ads", "AD_ANY")], fromPromo)?.id).toBe(
      "default",
    );
  });

  it("« toutes les pages » placé avant masque une page précise ; une page précise se place avant", () => {
    const anyPage = kind("any", "LANDING_ANY", { sortOrder: 1 });
    const promo = kind("promo", "LANDING_PAGE", { landingPageId: "page-promo", sortOrder: 2 });
    const autre = kind("autre", "LANDING_PAGE", { landingPageId: "page-autre", sortOrder: 0 });
    expect(shadowingRule([anyPage, promo], promo)?.id).toBe("any");
    expect(shadowingRule([{ ...anyPage, sortOrder: 9 }, promo], promo)).toBeNull();
    expect(shadowingRule([autre, promo], promo)).toBeNull();
    expect(shadowingRule([{ ...promo, id: "promo-0", sortOrder: 0 }, promo], promo)?.id).toBe(
      "promo-0",
    );
    expect(shadowingRule([promo, anyPage], anyPage)).toBeNull();
    expect(placeNewRule([anyPage], promo).map((r) => r.id)).toEqual(["promo", "any"]);
    expect(placeNewRule([autre], promo).map((r) => r.id)).toEqual(["autre", "promo"]);
  });

  it("comme une pub : validation à la main sans règle, accueil normal, canaux à rejoindre de la règle", () => {
    expect(noRuleOutcome(fromPromo)).toBe("MANUAL");
    expect(welcomeKindFor({ provenance: fromPromo, hasGates: false, sendWelcome: true })).toBe(
      "full",
    );
    expect(welcomeKindFor({ provenance: fromPromo, hasGates: false, sendWelcome: false })).toBe(
      "none",
    );
    expect(welcomeKindFor({ provenance: fromPromo, hasGates: true, sendWelcome: false })).toBe(
      "full",
    );
    expect(
      effectiveGateChannelIds(
        { scope: "DEFAULT", gateChannelIds: [ROULETTE, TIR] },
        fromPromo,
        ZONE,
      ),
    ).toEqual({ gateChannelIds: [ROULETTE, TIR], noGates: false });
  });

  it("textes en français", () => {
    const pages = { "page-promo": "Promo octobre" };
    expect(provenanceLabel(fromPromo, {}, null, pages)).toBe(
      "Venu de la page « Promo octobre » (source « tk01 »)",
    );
    expect(provenanceLabel(fromPromoDefault, {}, null, pages)).toBe(
      "Venu de la page « Promo octobre »",
    );
    expect(provenanceLabel(fromDeletedPage, {}, "promo-tk01", pages)).toBe(
      "Venu d'une page d'atterrissage (« promo-tk01 »)",
    );
    expect(provenanceLabel(fromDeletedPage)).toBe("Venu d'une page d'atterrissage");
    expect(exceptionCondition(kind("x", "LANDING_ANY"))).toBe(
      "de n'importe quelle page d'atterrissage",
    );
    expect(
      exceptionCondition(
        kind("x", "LANDING_PAGE", { landingPageId: "page-promo" }),
        {},
        {},
        {},
        pages,
      ),
    ).toBe("de la page « Promo octobre »");
    expect(
      exceptionCondition(kind("x", "LANDING_PAGE", { landingPageId: "gone" }), {}, {}, {}, pages),
    ).toBe("d'une page supprimée");
  });

  it("les deux types de provenance sont proposés, la page précise avant toutes les pages", () => {
    expect(SOURCE_KINDS).toContain("LANDING_ANY");
    expect(SOURCE_KINDS.indexOf("LANDING_PAGE")).toBeLessThan(SOURCE_KINDS.indexOf("LANDING_ANY"));
  });
});
