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
