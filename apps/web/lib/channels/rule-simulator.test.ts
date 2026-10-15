import { describe, expect, it } from "vitest";
import type { EntryRule } from "./entry-rule";
import { simulate, simulationChoices, type SimRule } from "./rule-simulator";

const titles = {
  zone: "Zone Interdite 🔞",
  tir: "Tir Cadré",
  roulette: "Zone Roulette",
};
const ctx = {
  titles,
  linkNames: { l1: "Post Tir Cadré" },
  channelId: "zone",
  channelTitle: titles.zone,
};

const entry = (over: Partial<EntryRule> = {}): EntryRule => ({
  mode: "DELAY",
  delaySeconds: 300,
  gateMode: "NONE",
  gateChannelIds: [],
  reminderAfterMinutes: [],
  maxReminders: 0,
  expireAfterHours: null,
  expireAction: "KEEP",
  sendAcceptedMessage: true,
  sendWelcome: true,
  isActive: true,
  ...over,
});

const base = {
  isActive: true,
  inviteLinkId: null,
  sourceChannelId: null,
  sourceKind: null,
  sortOrder: 0,
  label: null,
} as const;

/** Zone Interdite exige Zone Roulette et Tir Cadré, puis 5 minutes ; venue de Tir Cadré : 1 jour. */
const zoneRules: SimRule[] = [
  {
    ...base,
    id: "default",
    scope: "DEFAULT",
    isDefault: true,
    rule: entry({ gateMode: "REQUIRED", gateChannelIds: ["roulette", "tir"], delaySeconds: 300 }),
  },
  {
    ...base,
    id: "tir",
    scope: "SOURCE_CHANNEL",
    sourceChannelId: "tir",
    isDefault: false,
    label: "Venu de « Tir Cadré »",
    rule: entry({ delaySeconds: 86400 }),
  },
];

const none = { inviteLinkId: null, sourceChannelId: null, adPlatform: null } as const;

describe("simulateur : même logique que le bot", () => {
  it("exemple du client : venue du bouton de Tir Cadré → 1 jour, sans canal à rejoindre, court message", () => {
    const r = simulate(zoneRules, { ...none, type: "GATE", sourceChannelId: "tir" }, ctx);
    expect(r.ruleKind).toBe("exception");
    expect(r.ruleText).toBe("L'exception pour les personnes venues de « Tir Cadré ».");
    expect(r.gateIds).toEqual([]);
    expect(r.gatesText).toBe("Aucun canal à rejoindre.");
    expect(r.whenText).toBe("Elle est acceptée 1 jour après sa demande.");
    expect(r.messageText).toBe(
      "Le bot lui envoie seulement un court message : sa demande pour « Zone Interdite 🔞 » est bien reçue, accès dans 1 jour.",
    );
  });

  it("exemple du client : n'importe quel autre lien → canaux obligatoires, acceptée 5 minutes après les avoir tous rejoints", () => {
    for (const p of [
      { ...none, type: "AD" as const, adPlatform: "TIKTOK" as const },
      { ...none, type: "UNKNOWN" as const },
    ]) {
      const r = simulate(zoneRules, p, ctx);
      expect(r.ruleKind).toBe("default");
      expect(r.gateIds).toEqual(["roulette", "tir"]);
      expect(r.gatesText).toBe("Elle doit d'abord rejoindre « Zone Roulette » et « Tir Cadré ».");
      // Phase 14 : le bot voit tout seul les canaux rejoints ; « ✅ J'ai rejoint » n'est plus le seul déclencheur.
      expect(r.whenText).toBe(
        "Elle est acceptée 5 minutes après avoir rejoint tous les canaux (vu par le bot, ou à « ✅ J'ai rejoint »).",
      );
      expect(r.messageText).toBe(
        "Le bot lui envoie son message d'accueil, avec un bouton par canal et « ✅ J'ai rejoint ».",
      );
    }
  });

  it("canaux « Proposés » : accueil avec un bouton par canal, sans « ✅ J'ai rejoint », délai depuis la demande", () => {
    const soft: SimRule[] = [
      {
        ...zoneRules[0]!,
        rule: entry({ gateMode: "SOFT", gateChannelIds: ["roulette", "tir"], delaySeconds: 300 }),
      },
    ];
    for (const p of [
      { ...none, type: "AD" as const, adPlatform: "TIKTOK" as const },
      { ...none, type: "UNKNOWN" as const },
    ]) {
      const r = simulate(soft, p, ctx);
      expect(r.gatesText).toBe(
        "Le bot lui propose aussi de rejoindre « Zone Roulette » et « Tir Cadré ».",
      );
      expect(r.whenText).toBe("Elle est acceptée 5 minutes après sa demande.");
      expect(r.messageText).toBe(
        "Le bot lui envoie son message d'accueil, avec un bouton par canal.",
      );
      expect(JSON.stringify(r)).not.toMatch(/J'ai rejoint/);
    }
    // Tout de suite : même chose, acceptée sans attendre.
    const now = simulate(
      [
        {
          ...soft[0]!,
          rule: entry({ gateMode: "SOFT", gateChannelIds: ["roulette"], delaySeconds: 0 }),
        },
      ],
      { ...none, type: "UNKNOWN" },
      ctx,
    );
    expect([now.whenText, now.messageText]).toEqual([
      "Elle est acceptée tout de suite.",
      "Le bot lui envoie son message d'accueil, avec un bouton par canal.",
    ]);
  });

  it("canaux obligatoires tout de suite : acceptée dès qu'elle a rejoint tous les canaux", () => {
    const r = simulate(
      [
        {
          ...zoneRules[0]!,
          rule: entry({
            gateMode: "REQUIRED",
            gateChannelIds: ["roulette", "tir"],
            delaySeconds: 0,
          }),
        },
      ],
      { ...none, type: "UNKNOWN" },
      ctx,
    );
    expect(r.whenText).toBe(
      "Elle est acceptée dès qu'elle a rejoint tous les canaux (vu par le bot, ou à « ✅ J'ai rejoint »).",
    );
    expect(r.messageText).toBe(
      "Le bot lui envoie son message d'accueil, avec un bouton par canal et « ✅ J'ai rejoint ».",
    );
  });

  it("venue du bouton d'un autre canal, règle par défaut : aucun canal imposé (pas de chaîne), le délai s'applique", () => {
    const r = simulate(zoneRules, { ...none, type: "GATE", sourceChannelId: "roulette" }, ctx);
    expect(r.ruleKind).toBe("default");
    expect(r.gateIds).toEqual([]);
    expect(r.whenText).toBe("Elle est acceptée 5 minutes après sa demande.");
    expect(r.notes[0]).toBe(
      "Les canaux à rejoindre de la règle par défaut ne lui sont pas demandés : elle vient déjà d'un de nos canaux.",
    );
    expect(r.messageText).toMatch(/^Le bot lui envoie seulement un court message/);
  });

  it("exigences croisées : le canal d'où elle vient compte comme déjà rejoint", () => {
    const rules: SimRule[] = [
      {
        ...base,
        id: "share",
        scope: "SOURCE_KIND",
        sourceKind: "SHARE",
        isDefault: false,
        rule: entry({ gateMode: "REQUIRED", gateChannelIds: ["tir", "roulette"], delaySeconds: 0 }),
      },
    ];
    const r = simulate(
      rules,
      { ...none, type: "SHARE", inviteLinkId: "l1", sourceChannelId: "tir" },
      ctx,
    );
    expect(r.gateIds).toEqual(["roulette"]);
    expect(r.notes[0]).toBe("« Tir Cadré » compte comme déjà rejoint : elle en vient.");
    expect(r.whenText).toBe(
      "Elle est acceptée dès qu'elle a rejoint ce canal (vu par le bot, ou à « ✅ J'ai rejoint »).",
    );
  });

  it("canal sans règle : à valider à la main, sauf venue du bouton « canal à rejoindre » (entrée tout de suite)", () => {
    const manual = simulate([], { ...none, type: "UNKNOWN" }, ctx);
    expect(manual.ruleKind).toBe("none");
    expect(manual.whenText).toBe("Sa demande attend votre validation (onglet Demandes).");
    expect(manual.messageText).toBe("Le bot ne lui écrit pas.");
    const gate = simulate([], { ...none, type: "GATE", sourceChannelId: "tir" }, ctx);
    expect(gate.whenText).toBe("Elle entre tout de suite, sans attendre.");
  });

  it("message coupé, validation à la main, règle désactivée ignorée", () => {
    const rules: SimRule[] = [
      { ...base, id: "d", scope: "DEFAULT", isDefault: true, rule: entry({ mode: "MANUAL" }) },
      {
        ...base,
        id: "meta",
        scope: "SOURCE_KIND",
        sourceKind: "AD_META",
        isDefault: false,
        rule: entry({ sendWelcome: false, delaySeconds: 0, mode: "IMMEDIATE" }),
      },
      {
        ...base,
        id: "off",
        scope: "SOURCE_KIND",
        sourceKind: "AD_TIKTOK",
        isDefault: false,
        isActive: false,
        rule: entry({ delaySeconds: 60 }),
      },
    ];
    const meta = simulate(rules, { ...none, type: "AD", adPlatform: "META" }, ctx);
    expect([meta.whenText, meta.messageText]).toEqual([
      "Elle est acceptée tout de suite.",
      "Le bot ne lui écrit pas.",
    ]);
    const tiktok = simulate(rules, { ...none, type: "AD", adPlatform: "TIKTOK" }, ctx);
    expect(tiktok.ruleKind).toBe("default");
    expect(tiktok.whenText).toBe("Sa demande attend votre validation (onglet Demandes).");
    expect(tiktok.notes).toEqual([]);
    const gate = simulate(rules, { ...none, type: "GATE", sourceChannelId: "tir" }, ctx);
    expect(gate.notes).toContain(
      "Si ce bot lui a déjà envoyé un message d'accueil il y a moins de 10 minutes, il ne lui réécrit pas.",
    );
  });

  it("choix proposés : nos canaux (ceux qui envoient ici d'abord), liens de partage, pubs, autre lien", () => {
    const groups = simulationChoices({
      channelId: "zone",
      channels: [
        { id: "zone", title: titles.zone, isActive: true },
        { id: "roulette", title: titles.roulette, isActive: true },
        { id: "tir", title: titles.tir, isActive: true },
        { id: "off", title: "Ancien", isActive: false },
      ],
      senders: ["tir"],
      shareLinks: [{ id: "l1", name: "Post Tir Cadré", sourceChannelId: "tir" }],
    });
    expect(groups.map((g) => g.choices.map((c) => c.label))).toEqual([
      [
        "du bouton « canal à rejoindre » de « Tir Cadré »",
        "du bouton « canal à rejoindre » de « Zone Roulette »",
      ],
      ["du lien de partage « Post Tir Cadré »", "d'un autre lien de partage"],
      ["d'une pub TikTok", "d'une pub Meta", "d'une autre pub"],
      ["d'un autre lien (lien public, lien créé dans Telegram)"],
    ]);
    expect(groups[1]!.choices[0]!.provenance).toEqual({
      type: "SHARE",
      inviteLinkId: "l1",
      sourceChannelId: "tir",
      adPlatform: null,
    });
  });

  it("lien d'entrée de pub avec sa propre règle (Campagnes → Tous les liens) : la règle du lien, comme le bot", () => {
    // Relecture du 11 octobre : seuls les liens de partage étaient proposés ; une pub TikTok qui a sa propre règle
    // (exception « lien précis », la plus prioritaire) affichait la règle par défaut.
    const rules: SimRule[] = [
      ...zoneRules,
      {
        ...base,
        id: "tiktok-kind",
        scope: "SOURCE_KIND",
        sourceKind: "AD_TIKTOK",
        isDefault: false,
        rule: entry({ delaySeconds: 3600 }),
      },
      {
        ...base,
        id: "ad-link",
        scope: "INVITE_LINK",
        inviteLinkId: "ad1",
        isDefault: false,
        label: "Venu du lien « Pub TikTok 1 »",
        rule: entry({ mode: "IMMEDIATE", delaySeconds: 0, sendWelcome: false }),
      },
    ];
    const groups = simulationChoices({
      channelId: "zone",
      channels: [
        { id: "zone", title: titles.zone, isActive: true },
        { id: "tir", title: titles.tir, isActive: true },
      ],
      senders: [],
      shareLinks: [{ id: "l1", name: "Post Tir Cadré", sourceChannelId: "tir" }],
      preciseLinks: [
        {
          id: "ad1",
          name: "Pub TikTok 1",
          kind: "AD_ENTRY",
          isActive: true,
          sourceChannelId: null,
          adPlatform: "TIKTOK",
        },
        {
          id: "old",
          name: "Ancienne pub Meta",
          kind: "AD_ENTRY",
          isActive: false,
          sourceChannelId: null,
          adPlatform: "META",
        },
        // Déjà proposé dans « Un lien de partage » : pas deux fois.
        {
          id: "l1",
          name: "Post Tir Cadré",
          kind: "SHARE",
          isActive: true,
          sourceChannelId: "tir",
          adPlatform: null,
        },
      ],
    });
    const precise = groups.find((g) => g.label === "Un lien précis");
    expect(precise?.choices.map((c) => [c.key, c.label])).toEqual([
      ["link:old", "du lien « Ancienne pub Meta » (désactivé)"],
      ["link:ad1", "du lien « Pub TikTok 1 »"],
    ]);
    expect(
      groups.flatMap((g) => g.choices).filter((c) => c.provenance.inviteLinkId === "l1"),
    ).toHaveLength(1);
    const ad1 = precise!.choices.find((c) => c.key === "link:ad1")!;
    expect(ad1.provenance).toEqual({
      type: "AD",
      inviteLinkId: "ad1",
      sourceChannelId: null,
      adPlatform: "TIKTOK",
    });
    // Noms des liens de l'onglet : liens de partage et liens visés par une exception.
    const linkCtx = { ...ctx, linkNames: { ...ctx.linkNames, ad1: "Pub TikTok 1" } };
    const r = simulate(rules, ad1.provenance, linkCtx);
    expect(r.ruleKind).toBe("exception");
    expect(r.ruleText).toBe("L'exception pour les personnes venues du lien « Pub TikTok 1 ».");
    expect([r.whenText, r.messageText]).toEqual([
      "Elle est acceptée tout de suite.",
      "Le bot ne lui écrit pas.",
    ]);
    // Une autre pub TikTok : l'exception par type.
    const other = groups.flatMap((g) => g.choices).find((c) => c.key === "ad:TIKTOK")!;
    expect(simulate(rules, other.provenance, ctx).whenText).toBe(
      "Elle est acceptée 1 heure après sa demande.",
    );
  });
});

describe("simulateur : affiliés Link Affi (phase 13)", () => {
  const affLinks = [
    {
      id: "la1",
      campaignKey: "k1",
      campaignName: "Casino VIP",
      affiliateId: "aff-paul",
      affiliateName: "Paul",
      isActive: true,
    },
    {
      id: "la2",
      campaignKey: "k2",
      campaignName: "Été",
      affiliateId: "aff-sarah",
      affiliateName: "Sarah",
      isActive: false,
    },
  ];
  const affCtx = {
    ...ctx,
    affiliateNames: { "aff-paul": "Paul", "aff-sarah": "Sarah" },
    affiliateLinks: { la1: { campaignName: "Casino VIP", affiliateName: "Paul" } },
  };
  const choices = () =>
    simulationChoices({
      channelId: "zone",
      channels: [],
      senders: [],
      shareLinks: [],
      affiliateLinks: affLinks,
      // Un lien d'affilié visé par une exception n'est pas proposé une deuxième fois dans « Un lien précis ».
      preciseLinks: [
        {
          id: "la1",
          kind: "LINKAFFI",
          sourceChannelId: null,
          adPlatform: null,
          name: "Casino VIP",
          isActive: true,
        },
      ],
    });

  it("chaque campagne du canal et « un autre affilié », avec la provenance lue comme le bot", () => {
    const group = choices().find((g) => g.label === "Un affilié Link Affi")!;
    expect(group.choices.map((c) => c.label)).toEqual([
      "de la campagne « Casino VIP » de l'affilié « Paul »",
      "de la campagne « Été » de l'affilié « Sarah » (désactivée)",
      "d'un autre affilié Link Affi",
    ]);
    expect(group.choices[0]!.provenance).toMatchObject({
      type: "LINKAFFI",
      inviteLinkId: "la1",
      linkaffi: { campaignKey: "k1", affiliateId: "aff-paul", affiliateName: "Paul" },
    });
    expect(choices().some((g) => g.label === "Un lien précis")).toBe(false);
  });

  it("aucun affilié : pas de groupe ; affiliés connus sans campagne ici : « un autre affilié » seul", () => {
    const base = { channelId: "zone", channels: [], senders: [], shareLinks: [] };
    expect(simulationChoices(base).some((g) => g.label === "Un affilié Link Affi")).toBe(false);
    const only = simulationChoices({ ...base, withAffiliates: true }).find(
      (g) => g.label === "Un affilié Link Affi",
    )!;
    expect(only.choices.map((c) => c.key)).toEqual(["linkaffi:other"]);
  });

  it("règle retenue : campagne précise, puis affilié précis, puis n'importe quel affilié, puis défaut", () => {
    const rules: SimRule[] = [
      {
        ...base,
        id: "default",
        scope: "DEFAULT",
        isDefault: true,
        rule: entry({ delaySeconds: 300 }),
      },
      {
        ...base,
        id: "any",
        scope: "SOURCE_KIND",
        sourceKind: "LINKAFFI_ANY",
        // Placée après l'affilié précis (l'écran range une nouvelle exception précise avant la générale).
        sortOrder: 20,
        isDefault: false,
        rule: entry({ delaySeconds: 3600 }),
      },
      {
        ...base,
        id: "paul",
        scope: "SOURCE_KIND",
        sourceKind: "LINKAFFI_AFFILIATE",
        linkaffiAffiliateId: "aff-paul",
        sortOrder: 10,
        isDefault: false,
        rule: entry({ delaySeconds: 0 }),
      },
    ];
    const group = choices().find((g) => g.label === "Un affilié Link Affi")!;
    const paul = simulate(rules, group.choices[0]!.provenance, affCtx);
    expect(paul.ruleText).toBe("L'exception pour les personnes venues de l'affilié « Paul ».");
    expect(paul.whenText).toBe("Elle est acceptée tout de suite.");
    const sarah = simulate(rules, group.choices[1]!.provenance, affCtx);
    expect(sarah.ruleText).toBe(
      "L'exception pour les personnes venues de n'importe quel affilié Link Affi.",
    );
    const campaign = simulate(
      [
        ...rules,
        {
          ...base,
          id: "camp",
          scope: "INVITE_LINK",
          inviteLinkId: "la1",
          isDefault: false,
          rule: entry({ mode: "MANUAL" }),
        },
      ],
      group.choices[0]!.provenance,
      affCtx,
    );
    expect(campaign.ruleText).toBe(
      "L'exception pour les personnes venues de la campagne « Casino VIP » de l'affilié « Paul ».",
    );
    expect(simulate([rules[0]!], group.choices[2]!.provenance, affCtx).ruleKind).toBe("default");
  });
});
