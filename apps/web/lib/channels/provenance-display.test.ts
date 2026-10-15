import { describe, expect, it } from "vitest";
import {
  acceptanceText,
  appliedRuleText,
  appliedRuleView,
  membershipProvenance,
  parisDateTime,
  provenanceLine,
  ruleTiming,
  landingPageIdsOf,
  sourceChannelIdsOf,
  type DisplayMembership,
} from "./provenance-display";

const now = new Date("2026-10-11T08:14:00Z"); // 10 h 14 à Paris (heure d'été)
const titles = { tir: "Tir Cadré", zone: "Zone Interdite 🔞" };

/** Demande enregistrée par le bot de la phase 11 : provenance, règle appliquée et délai. */
function phase11(over: Partial<DisplayMembership> = {}, source: Record<string, unknown> = {}) {
  return {
    channelId: "zone",
    status: "SCHEDULED",
    approveAt: new Date("2026-10-12T08:14:00Z"),
    approvedAt: null,
    source: {
      inviteLink: { id: "l-gate", name: "Bouton Tir Cadré", kind: "GATE" },
      provenance: {
        type: "GATE",
        inviteLinkId: "l-gate",
        sourceChannelId: "tir",
        adPlatform: null,
        label: "Venu de « Tir Cadré » (canal obligatoire)",
      },
      appliedRule: { id: "r-exc", scope: "SOURCE_CHANNEL", label: "Venu de « Tir Cadré »" },
      rule: {
        id: "r-exc",
        name: "Venu de « Tir Cadré »",
        mode: "DELAY",
        delaySeconds: 86400,
        gateMode: "NONE",
      },
      gates: [],
      ...source,
    },
    ...over,
  } satisfies DisplayMembership;
}

describe("provenance d'une demande", () => {
  it("exemple du client : venue de « Tir Cadré » → 1 jour, acceptation prévue le lendemain à la même heure", () => {
    expect(provenanceLine(phase11(), titles, now)).toBe(
      "Venu de « Tir Cadré » (canal obligatoire) · règle : 1 jour · acceptation prévue le 12 oct. à 10 h 14",
    );
  });

  it("le texte suit le titre actuel du canal d'origine ; canal supprimé : le texte enregistré", () => {
    expect(membershipProvenance(phase11(), { tir: "Tir Cadré ⚽" }).label).toBe(
      "Venu de « Tir Cadré ⚽ » (canal obligatoire)",
    );
    expect(membershipProvenance(phase11(), {}).label).toBe(
      "Venu de « Tir Cadré » (canal obligatoire)",
    );
  });

  it("ancienne demande sans provenance enregistrée : déduite de son lien (même règle que le bot)", () => {
    const share = membershipProvenance(
      {
        source: {},
        inviteLink: {
          id: "s1",
          kind: "SHARE",
          sourceChannelId: "tir",
          adPlatform: null,
          name: "Post Tir Cadré",
        },
      },
      titles,
    );
    expect(share.provenance).toMatchObject({ type: "SHARE", sourceChannelId: "tir" });
    expect(share.label).toBe("Venu du lien de partage « Post Tir Cadré »");
    expect(
      membershipProvenance({
        source: { inviteLink: { name: "Pub 1" } },
        inviteLink: {
          id: "a1",
          kind: "AD_ENTRY",
          sourceChannelId: null,
          adPlatform: "TIKTOK",
          name: "Pub 1",
        },
      }).label,
    ).toBe("Venu d'une pub TikTok (« Pub 1 »)");
    expect(
      membershipProvenance(
        {
          source: { joinedDirectly: true },
          inviteLink: {
            id: "g1",
            kind: "GATE",
            sourceChannelId: "tir",
            adPlatform: null,
            name: "x",
          },
        },
        titles,
      ).label,
    ).toBe("Venu de « Tir Cadré » (canal obligatoire)");
    // Lien que la plateforme n'a pas créé, ou aucun lien.
    expect(
      membershipProvenance({ source: { telegramInviteLink: "https://t.me/+abc" } }).label,
    ).toBe("Venu d'un autre lien");
    expect(membershipProvenance({ source: null }).provenance.type).toBe("UNKNOWN");
  });

  it("canaux d'origine à relire, sans doublon", () => {
    expect(
      sourceChannelIdsOf([
        phase11(),
        phase11(),
        {
          source: {},
          inviteLink: {
            id: "s",
            kind: "SHARE",
            sourceChannelId: "zone",
            adPlatform: null,
            name: "x",
          },
        },
        { source: {} },
      ]),
    ).toEqual(["tir", "zone"]);
  });
});

describe("règle appliquée", () => {
  it("délai en mots", () => {
    expect(ruleTiming({ mode: "MANUAL", delaySeconds: 600, gateMode: "NONE", gateCount: 0 })).toBe(
      "à valider à la main",
    );
    expect(
      ruleTiming({ mode: "IMMEDIATE", delaySeconds: 600, gateMode: "NONE", gateCount: 0 }),
    ).toBe("tout de suite");
    expect(ruleTiming({ mode: "DELAY", delaySeconds: 300, gateMode: "NONE", gateCount: 0 })).toBe(
      "5 minutes",
    );
    expect(
      ruleTiming({ mode: "DELAY", delaySeconds: 300, gateMode: "REQUIRED", gateCount: 2 }),
    ).toBe("5 minutes après les canaux à rejoindre");
    expect(ruleTiming({ mode: "DELAY", delaySeconds: 0, gateMode: "REQUIRED", gateCount: 1 })).toBe(
      "dès les canaux rejoints",
    );
    // Canaux seulement proposés : le délai part de la demande.
    expect(ruleTiming({ mode: "DELAY", delaySeconds: 600, gateMode: "SOFT", gateCount: 1 })).toBe(
      "10 minutes",
    );
  });

  it("règle par défaut avec canaux à rejoindre ; non imposés pour une personne venue d'un canal obligatoire", () => {
    const base = {
      appliedRule: { id: "r-def", scope: "DEFAULT", label: null },
      rule: { id: "r-def", mode: "DELAY", delaySeconds: 300, gateMode: "REQUIRED" },
      gates: [{ channelId: "roulette" }],
      gateLinksMissing: [{ channelId: "tir" }],
    };
    expect(appliedRuleText(appliedRuleView({ source: base }))).toBe(
      "règle par défaut : 5 minutes après les canaux à rejoindre",
    );
    expect(
      appliedRuleText(
        appliedRuleView({
          source: {
            ...base,
            gates: [],
            gateLinksMissing: [],
            appliedRule: { ...base.appliedRule, noGates: true },
          },
        }),
      ),
    ).toBe("règle par défaut : 5 minutes");
  });

  it("aucune règle : validation à la main, ou entrée tout de suite (venu d'un canal obligatoire)", () => {
    expect(
      appliedRuleText(appliedRuleView({ source: { appliedRule: null, noRule: "MANUAL" } })),
    ).toBe("aucune règle : à valider à la main");
    expect(
      appliedRuleText(appliedRuleView({ source: { appliedRule: null, noRule: "IMMEDIATE" } })),
    ).toBe("aucune règle : entrée tout de suite");
    // Entrée directe (sans demande) : pas de règle à afficher.
    expect(appliedRuleView({ source: { joinedDirectly: true, appliedRule: null } })).toBeNull();
  });

  it("ancienne demande : règle relue en base (délai enregistré s'il existe)", () => {
    const row = {
      scope: "DEFAULT" as const,
      isDefault: true,
      label: null,
      mode: "DELAY" as const,
      delaySeconds: 600,
      gateMode: "REQUIRED" as const,
      gateChannelIds: ["zone", "bonus"],
    };
    expect(
      appliedRuleText(appliedRuleView({ channelId: "zone", source: {}, approvalRule: row })),
    ).toBe("règle par défaut : 10 minutes après les canaux à rejoindre");
    expect(
      appliedRuleText(
        appliedRuleView({
          source: { rule: { mode: "DELAY", delaySeconds: 3600, gateMode: "NONE" } },
          approvalRule: {
            ...row,
            scope: "INVITE_LINK",
            isDefault: false,
            label: "Venu du lien « A »",
          },
        }),
      ),
    ).toBe("règle : 1 heure");
    expect(appliedRuleView({ source: {} })).toBeNull();
  });
});

describe("date d'acceptation (heure de Paris)", () => {
  it("le 12 oct. à 10 h 14 ; l'heure sans zéro devant ; l'année si ce n'est pas celle en cours", () => {
    expect(parisDateTime(new Date("2026-10-12T08:14:00Z"), now)).toBe("le 12 oct. à 10 h 14");
    expect(parisDateTime(new Date("2026-12-01T08:05:00Z"), now)).toBe("le 1 déc. à 9 h 05");
    expect(parisDateTime(new Date("2027-01-02T23:30:00Z"), now)).toBe("le 3 janv. 2027 à 0 h 30");
  });

  it("prévue pour une demande programmée, faite pour un membre accepté, rien sinon", () => {
    const at = new Date("2026-10-12T08:14:00Z");
    expect(acceptanceText({ status: "SCHEDULED", approveAt: at }, now)).toBe(
      "acceptation prévue le 12 oct. à 10 h 14",
    );
    expect(acceptanceText({ status: "LEFT", approvedAt: at }, now)).toBe(
      "acceptée le 12 oct. à 10 h 14",
    );
    expect(acceptanceText({ status: "PENDING_GATE", approveAt: null }, now)).toBeNull();
    expect(acceptanceText({ status: "REQUESTED" }, now)).toBeNull();
  });

  it("« Tout accepter » : acceptation en cours, jamais l'heure de secours", () => {
    const fallbackAt = "2026-10-12T08:24:00.000Z";
    const queued = {
      status: "SCHEDULED",
      approveAt: new Date(fallbackAt),
      source: { approveAll: { at: "2026-10-12T08:14:00.000Z", byUserId: "u1", fallbackAt } },
    };
    expect(acceptanceText(queued, now)).toBe("acceptation en cours");
    // Heure repoussée ensuite par une nouvelle règle : de nouveau une heure prévue.
    expect(acceptanceText({ ...queued, approveAt: new Date("2026-10-13T08:14:00Z") }, now)).toBe(
      "acceptation prévue le 13 oct. à 10 h 14",
    );
  });

  it("ligne sans la date quand l'écran la montre déjà", () => {
    expect(provenanceLine(phase11(), titles, now, { withAcceptance: false })).toBe(
      "Venu de « Tir Cadré » (canal obligatoire) · règle : 1 jour",
    );
  });
});

describe("provenance d'une page d'atterrissage (phase 15)", () => {
  const landing = (label: string | null, pageId: string | null = "lp1") =>
    phase11(
      {},
      {
        inviteLink: { id: "l-land", name: "Promo VIP-tk01", kind: "LANDING" },
        provenance: {
          type: "LANDING",
          inviteLinkId: "l-land",
          sourceChannelId: null,
          adPlatform: null,
          landing: { pageId, sourceKey: "tk01" },
          ...(label ? { label } : {}),
        },
        appliedRule: { id: "r-lp", scope: "SOURCE_KIND", label: "Venu de la page « Promo VIP »" },
        rule: { id: "r-lp", mode: "DELAY", delaySeconds: 0, gateMode: "NONE" },
      },
    );

  it("nom actuel de la page et sa source ; règle de la page", () => {
    expect(
      provenanceLine(landing("Venu de la page « Ancien nom » (source « tk01 »)"), titles, now, {
        withAcceptance: false,
      }),
    ).toBe("Venu de la page « Ancien nom » (source « tk01 ») · règle : tout de suite");
    expect(
      membershipProvenance(landing("Venu de la page « Ancien nom » (source « tk01 »)"), titles, {
        lp1: "Promo VIP",
      }).label,
    ).toBe("Venu de la page « Promo VIP » (source « tk01 »)");
  });

  it("page renommée : pages à relire (`landingPageIdsOf`) et ligne complète avec le nom actuel", () => {
    const m = landing("Venu de la page « Ancien nom » (source « tk01 »)");
    expect(landingPageIdsOf([m, landing(null), { source: null }])).toEqual(["lp1"]);
    expect(
      provenanceLine(m, titles, now, {
        withAcceptance: false,
        landingPageNames: { lp1: "Promo VIP" },
      }),
    ).toBe("Venu de la page « Promo VIP » (source « tk01 ») · règle : tout de suite");
  });

  it("page supprimée ou nom inconnu : le texte enregistré par le bot ; sans texte, une phrase générique", () => {
    expect(
      membershipProvenance(
        landing("Venu de la page « Promo VIP » (source « tk01 »)", null),
        titles,
        {},
      ).label,
    ).toBe("Venu de la page « Promo VIP » (source « tk01 »)");
    expect(membershipProvenance(landing(null), titles).label).toBe(
      "Venu d'une page d'atterrissage (« Promo VIP-tk01 »)",
    );
  });
});
