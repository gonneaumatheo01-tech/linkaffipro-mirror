import { describe, expect, it } from "vitest";
import { initialEntryState, type EntryRule } from "./entry-rule";
import {
  conditionText,
  defaultGateSkipNote,
  dropOrder,
  duplicateMessage,
  exceptionGateChannelIds,
  exceptionMessageNote,
  exceptionRuleLabel,
  exceptionSentence,
  findDuplicate,
  gateSenderExceptions,
  groupByLevel,
  isValidLevelOrder,
  moveWithinLevel,
  newExceptionState,
  placementOrder,
  provenanceHelp,
  provenanceKey,
  provenanceMenu,
  shadowNote,
  sortOrderUpdates,
  suggestedProvenance,
  targetOfKey,
  whenShort,
  type ExceptionItem,
  type ExceptionTarget,
} from "./exceptions";

const names = {
  titles: { tir: "Tir Cadré", zone: "Zone Interdite 🔞", roulette: "Zone Roulette", vip: "VIP" },
  linkNames: { l1: "Post Tir Cadré", ad1: "Pub TikTok 1" },
};

const rule = (over: Partial<EntryRule> = {}): EntryRule => ({
  mode: "DELAY",
  delaySeconds: 86400,
  gateMode: "NONE",
  gateChannelIds: [],
  reminderAfterMinutes: [60, 1440],
  maxReminders: 2,
  expireAfterHours: null,
  expireAction: "KEEP",
  sendAcceptedMessage: true,
  sendWelcome: true,
  isActive: true,
  ...over,
});

function item(id: string, target: Partial<ExceptionTarget>, over: Partial<ExceptionItem> = {}) {
  return {
    id,
    scope: "SOURCE_KIND",
    sourceChannelId: null,
    sourceKind: null,
    inviteLinkId: null,
    isDefault: false,
    isActive: true,
    sortOrder: 10,
    label: null,
    rule: rule(),
    updatedAt: "2026-10-11T10:00:00.000Z",
    ...target,
    ...over,
  } as ExceptionItem;
}

describe("menu « Si la personne vient… » ↔ portée et cible", () => {
  it("chaque clé donne une portée et une cible, et revient à l'identique", () => {
    expect(targetOfKey("channel:tir")).toEqual({
      scope: "SOURCE_CHANNEL",
      sourceChannelId: "tir",
      sourceKind: null,
      inviteLinkId: null,
      linkaffiAffiliateId: null,
    });
    expect(targetOfKey("kind:GATE")?.sourceKind).toBe("GATE");
    expect(targetOfKey("link:l1")).toMatchObject({ scope: "INVITE_LINK", inviteLinkId: "l1" });
    for (const key of ["channel:tir", "kind:AD_TIKTOK", "kind:SHARE", "link:l1"])
      expect(provenanceKey(targetOfKey(key)!)).toBe(key);
  });

  it("refuse une clé illisible ou un type inconnu", () => {
    expect(targetOfKey("kind:NOPE")).toBeNull();
    expect(targetOfKey("channel:")).toBeNull();
    expect(targetOfKey("default")).toBeNull();
    expect(targetOfKey("channel:a b")).toBeNull();
    expect(targetOfKey(`link:${"x".repeat(65)}`)).toBeNull();
  });

  it("propose nos canaux (ceux qui envoient leurs membres ici d'abord), les types, puis les liens de partage", () => {
    const menu = provenanceMenu({
      channelId: "zone",
      channels: [
        { id: "zone", title: "Zone Interdite 🔞", isActive: true },
        { id: "vip", title: "VIP", isActive: true },
        { id: "tir", title: "Tir Cadré", isActive: true },
        { id: "old", title: "Ancien", isActive: false },
      ],
      links: [
        { id: "l1", name: "Post Tir Cadré", kind: "SHARE", isActive: true },
        { id: "l2", name: "Désactivé", kind: "SHARE", isActive: false },
        { id: "ad1", name: "Pub TikTok 1", kind: "AD_ENTRY", isActive: true },
      ],
      senders: ["tir"],
      used: ["kind:AD_META"],
    });
    expect(menu.map((g) => g.label)).toEqual([
      "Un de nos canaux",
      "Un type de provenance",
      "Un lien de partage précis",
    ]);
    expect(menu[0]!.options.map((o) => o.label)).toEqual(["de « Tir Cadré »", "de « VIP »"]);
    expect(menu[1]!.options.map((o) => o.label)).toEqual([
      "du bouton « canal à rejoindre » d'un de nos canaux",
      "de n'importe lequel de nos canaux",
      "d'une pub TikTok",
      "d'une pub Meta",
      "de n'importe quelle pub",
      "d'un lien de partage",
    ]);
    expect(menu[1]!.options.find((o) => o.key === "kind:AD_META")?.used).toBe(true);
    expect(menu[2]!.options).toEqual([{ key: "link:l1", label: "du lien « Post Tir Cadré »" }]);
  });

  it("sans affilié Link Affi connu : ni groupe d'affiliés, ni type « affilié » parmi les types", () => {
    const menu = provenanceMenu({
      channelId: "zone",
      channels: [],
      links: [],
      senders: [],
      used: [],
    });
    expect(menu.map((g) => g.label)).toEqual(["Un type de provenance"]);
    expect(menu[0]!.options.some((o) => o.key.includes("LINKAFFI"))).toBe(false);
  });

  it("garde l'option en cours même si son lien n'est pas un lien de partage actif", () => {
    const menu = provenanceMenu({
      channelId: "zone",
      channels: [],
      links: [{ id: "ad1", name: "Pub TikTok 1", kind: "AD_ENTRY", isActive: true }],
      senders: [],
      current: "link:ad1",
      used: [],
    });
    expect(menu.at(-1)!.options).toEqual([{ key: "link:ad1", label: "du lien « Pub TikTok 1 »" }]);
  });

  it("aide sous le menu : par où passe la personne visée", () => {
    expect(provenanceHelp(targetOfKey("channel:tir"))).toBe(
      "Par le bouton « canal à rejoindre » de ce canal, ou par un lien de partage posté dedans.",
    );
    expect(provenanceHelp(targetOfKey("kind:GATE"))).toBe(
      "Par le bouton « canal à rejoindre » de n'importe lequel de nos canaux.",
    );
    expect(provenanceHelp(targetOfKey("kind:AD_META"))).toMatch(/^Par le lien d'entrée d'une pub/);
    expect(provenanceHelp(targetOfKey("kind:SHARE"))).toBe(
      "Par n'importe quel lien de partage de ce canal.",
    );
    expect(provenanceHelp(targetOfKey("link:l1"))).toBe("Par ce lien précis seulement.");
    expect(provenanceHelp(null)).toBe("Choisissez d'où vient la personne.");
  });

  it("suggère d'abord un canal qui envoie ses membres ici, puis le bouton « canal à rejoindre »", () => {
    const menu = provenanceMenu({
      channelId: "zone",
      channels: [
        { id: "tir", title: "Tir Cadré", isActive: true },
        { id: "vip", title: "VIP", isActive: true },
      ],
      links: [],
      senders: ["tir"],
      used: ["channel:tir"],
    });
    expect(suggestedProvenance(menu, ["tir"])).toBe("kind:GATE");
    expect(suggestedProvenance(menu, [])).toBe("channel:vip");
  });
});

describe("textes d'une exception", () => {
  it("libellé enregistré « Venu … » (le journal et les demandes l'affichent)", () => {
    expect(exceptionRuleLabel(targetOfKey("channel:tir")!, names)).toBe("Venu de « Tir Cadré »");
    expect(exceptionRuleLabel(targetOfKey("kind:GATE")!, names)).toBe(
      "Venu du bouton « canal à rejoindre » d'un de nos canaux",
    );
    expect(exceptionRuleLabel(targetOfKey("link:l1")!, names)).toBe(
      "Venu du lien « Post Tir Cadré »",
    );
    expect(exceptionRuleLabel(targetOfKey("channel:gone")!, names)).toBe(
      "Venu d'un canal supprimé",
    );
  });

  it("exemple du client : venue de Tir Cadré → acceptée 1 jour après sa demande", () => {
    const tir = item("e1", { scope: "SOURCE_CHANNEL", sourceChannelId: "tir" });
    expect(whenShort(tir)).toBe("après 1 jour");
    expect(exceptionSentence(tir, names)).toBe(
      "Une personne venue de « Tir Cadré » sera acceptée 1 jour après sa demande.",
    );
    expect(exceptionMessageNote(tir)).toBe(
      "Venue par le bouton « canal à rejoindre », elle reçoit seulement un court message : sa demande est bien reçue.",
    );
  });

  it("tout de suite, à la main, canaux obligatoires puis délai, canaux proposés", () => {
    const tiktok = { scope: "SOURCE_KIND" as const, sourceKind: "AD_TIKTOK" as const };
    expect(whenShort(item("a", tiktok, { rule: rule({ mode: "IMMEDIATE" }) }))).toBe(
      "tout de suite",
    );
    expect(exceptionSentence(item("a", tiktok, { rule: rule({ mode: "IMMEDIATE" }) }), names)).toBe(
      "Une personne venue d'une pub TikTok sera acceptée tout de suite.",
    );
    const manual = item("b", tiktok, { rule: rule({ mode: "MANUAL" }) });
    expect(whenShort(manual)).toBe("à valider à la main");
    expect(exceptionSentence(manual, names)).toBe(
      "Une personne venue d'une pub TikTok attend votre validation (onglet Demandes).",
    );
    const gated = item("c", tiktok, {
      rule: rule({ gateMode: "REQUIRED", gateChannelIds: ["roulette"], delaySeconds: 300 }),
    });
    expect(whenShort(gated)).toBe("5 minutes après avoir rejoint 1 canal");
    expect(exceptionSentence(gated, names)).toBe(
      "Une personne venue d'une pub TikTok sera acceptée 5 minutes après avoir rejoint « Zone Roulette » (à partir du moment où elle les a tous rejoints).",
    );
    expect(exceptionMessageNote(gated)).toBeNull();
    const soft = item("d", tiktok, {
      rule: rule({ gateMode: "SOFT", gateChannelIds: ["vip", "roulette"], delaySeconds: 0 }),
    });
    expect(whenShort(soft)).toBe("tout de suite, 2 canaux proposés");
    expect(exceptionSentence(soft, names)).toBe(
      "Une personne venue d'une pub TikTok sera acceptée tout de suite ; le bot lui propose aussi de rejoindre « VIP » et « Zone Roulette ».",
    );
  });

  it("le canal d'où vient la personne n'apparaît jamais dans ses canaux à rejoindre", () => {
    const tir = item(
      "e1",
      { scope: "SOURCE_CHANNEL", sourceChannelId: "tir" },
      {
        rule: rule({ gateMode: "REQUIRED", gateChannelIds: ["tir", "roulette"], delaySeconds: 0 }),
      },
    );
    expect(exceptionSentence(tir, names)).toBe(
      "Une personne venue de « Tir Cadré » sera acceptée dès qu'elle aura rejoint « Zone Roulette ».",
    );
    expect(
      exceptionGateChannelIds(
        targetOfKey("channel:tir")!,
        ["tir", "zone", "roulette", "roulette"],
        "zone",
      ),
    ).toEqual(["roulette"]);
    expect(exceptionGateChannelIds(targetOfKey("kind:GATE")!, ["tir", "zone"], "zone")).toEqual([
      "tir",
    ]);
  });

  it("message coupé, court message pour le bouton « canal à rejoindre »", () => {
    expect(
      exceptionMessageNote(
        item("x", { sourceKind: "AD_META" }, { rule: rule({ sendWelcome: false }) }),
      ),
    ).toBe("Le bot ne lui écrit pas à son arrivée.");
    expect(exceptionMessageNote(item("x", { sourceKind: "GATE" }))).toBe(
      "Le bot lui envoie seulement un court message : sa demande est bien reçue.",
    );
    expect(exceptionMessageNote(item("x", { sourceKind: "AD_ANY" }))).toBeNull();
  });
});

describe("garde-fous", () => {
  const items = [
    item("tir", { scope: "SOURCE_CHANNEL", sourceChannelId: "tir" }),
    item("any", { sourceKind: "AD_ANY" }, { sortOrder: 10 }),
    item("tiktok", { sourceKind: "AD_TIKTOK" }, { sortOrder: 20 }),
  ];

  it("pas deux exceptions pour la même provenance (sauf celle qu'on modifie)", () => {
    const t = targetOfKey("channel:tir")!;
    expect(findDuplicate(items, t)?.id).toBe("tir");
    expect(findDuplicate(items, t, "tir")).toBeNull();
    expect(findDuplicate(items, targetOfKey("kind:AD_META")!)).toBeNull();
    expect(duplicateMessage(t, names)).toBe(
      "Une exception existe déjà pour les personnes venues de « Tir Cadré » : modifiez-la plutôt.",
    );
  });

  it("« jamais utilisée » : « n'importe quelle pub » placée avant « pub TikTok »", () => {
    expect(shadowNote(items, items[2]!, names)).toBe(
      "Jamais utilisée : l'exception « Venu de n'importe quelle pub », placée avant, s'applique déjà à ces personnes. Montez celle-ci au-dessus, ou désactivez l'autre.",
    );
    expect(shadowNote(items, items[1]!, names)).toBeNull();
    // Désactivée, l'exception qui passe avant ne masque plus rien.
    const off = items.map((i) => (i.id === "any" ? { ...i, isActive: false } : i));
    expect(shadowNote(off, off[2]!, names)).toBeNull();
  });

  it("une nouvelle « pub TikTok » se place avant « n'importe quelle pub » ; numéros 10, 20, 30", () => {
    const kinds = [items[1]!];
    const created = item("new", { sourceKind: "AD_TIKTOK" }, { sortOrder: 0 });
    expect(placementOrder(kinds, created)).toEqual(["new", "any"]);
    expect(placementOrder(kinds, item("n2", { sourceKind: "SHARE" }, { sortOrder: 0 }))).toEqual([
      "any",
      "n2",
    ]);
    expect(sortOrderUpdates(["new", "any"])).toEqual([
      { id: "new", sortOrder: 10 },
      { id: "any", sortOrder: 20 },
    ]);
    expect(sortOrderUpdates(["new", "any"], { new: 0, any: 20 })).toEqual([
      { id: "new", sortOrder: 10 },
    ]);
  });
});

describe("ordre : dans un même groupe seulement", () => {
  const items = [
    item("link", { scope: "INVITE_LINK", inviteLinkId: "l1" }),
    item("tir", { scope: "SOURCE_CHANNEL", sourceChannelId: "tir" }),
    item("a", { sourceKind: "AD_ANY" }, { sortOrder: 10 }),
    item("b", { sourceKind: "SHARE" }, { sortOrder: 20 }),
    item("c", { sourceKind: "GATE" }, { sortOrder: 30 }),
  ];

  it("groupes dans l'ordre du bot : lien précis, canal, type de provenance", () => {
    expect(groupByLevel(items).map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ["Venues d'un lien précis", ["link"]],
      ["Venues d'un de nos canaux", ["tir"]],
      ["Selon le type de provenance", ["a", "b", "c"]],
    ]);
  });

  it("monter / descendre sans sortir du groupe", () => {
    expect(moveWithinLevel(items, "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveWithinLevel(items, "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveWithinLevel(items, "a", "up")).toBeNull();
    expect(moveWithinLevel(items, "c", "down")).toBeNull();
    expect(moveWithinLevel(items, "tir", "up")).toBeNull();
    expect(moveWithinLevel(items, "inconnue", "up")).toBeNull();
  });

  it("glisser-déposer : position d'arrivée, ordre complet du groupe exigé", () => {
    expect(dropOrder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(dropOrder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(dropOrder(["a", "b", "c"], "a", "a")).toBeNull();
    expect(isValidLevelOrder(items, "SOURCE_KIND", ["c", "a", "b"])).toBe(true);
    expect(isValidLevelOrder(items, "SOURCE_KIND", ["c", "a"])).toBe(false);
    expect(isValidLevelOrder(items, "SOURCE_KIND", ["c", "a", "tir"])).toBe(false);
    expect(isValidLevelOrder(items, "SOURCE_KIND", ["a", "a", "b"])).toBe(false);
  });
});

describe("nouvelle exception", () => {
  const gateDefault = {
    ...initialEntryState(
      rule({ gateMode: "REQUIRED", gateChannelIds: ["roulette", "tir"], delaySeconds: 300 }),
    ),
    reminders: "30",
    expireAfterHours: 48,
  };

  it("copie la règle par défaut, réglages avancés compris", () => {
    const s = newExceptionState(gateDefault, targetOfKey("kind:AD_TIKTOK"));
    expect(s.choice).toBe("gate");
    expect(s.gateIds).toEqual(["roulette", "tir"]);
    expect(s.gateDelayPreset).toBe("5m");
    expect(s.reminders).toBe("30");
    expect(s.expireAfterHours).toBe(48);
  });

  it("nouvelle exception : les anciens rappels par défaut deviennent 4 minutes puis 1 heure (phase 14)", () => {
    const legacy = { ...gateDefault, reminders: "60, 1440" };
    expect(newExceptionState(legacy, targetOfKey("kind:AD_TIKTOK")).reminders).toBe("4, 60");
    expect(newExceptionState(legacy, targetOfKey("kind:GATE")).reminders).toBe("4, 60");
    expect(newExceptionState(legacy, null).reminders).toBe("4, 60");
    // Rappels choisis par l'équipe : copiés tels quels.
    expect(newExceptionState(gateDefault, targetOfKey("kind:AD_TIKTOK")).reminders).toBe("30");
  });

  it("venue d'un de nos canaux : aucun canal à rejoindre d'office, « puis accepter » devient le délai", () => {
    for (const key of ["kind:GATE", "channel:tir", "kind:ANY_CHANNEL"]) {
      const s = newExceptionState(gateDefault, targetOfKey(key));
      expect(s.choice, key).toBe("delay");
      expect(s.gateIds).toEqual([]);
      expect(s.delayPreset).toBe("5m");
      expect(s.reminders).toBe("30");
    }
    const immediate = newExceptionState(
      { ...gateDefault, gateDelayPreset: "immediate" },
      targetOfKey("kind:GATE"),
    );
    expect(immediate.choice).toBe("now");
    const custom = newExceptionState(
      {
        ...gateDefault,
        gateDelayPreset: "custom",
        gateCustomAmount: 10,
        gateCustomUnit: "minutes",
      },
      targetOfKey("kind:GATE"),
    );
    expect([custom.choice, custom.delayPreset]).toEqual(["delay", "10m"]);
  });

  it("note de la règle par défaut : la personne venue d'un autre de nos canaux n'a pas ces canaux à rejoindre", () => {
    expect(defaultGateSkipNote({ manual: false, delaySeconds: 86400 })).toBe(
      "Une personne envoyée ici par le bouton « canal à rejoindre » d'un autre de nos canaux n'a pas à rejoindre ces canaux : elle est acceptée 1 jour après sa demande. Une exception peut en décider autrement.",
    );
    expect(defaultGateSkipNote({ manual: false, delaySeconds: 0 })).toContain(
      "elle est acceptée tout de suite",
    );
    expect(defaultGateSkipNote({ manual: true, delaySeconds: 0 })).toContain(
      "sa demande attend votre validation",
    );
  });

  it("note de la règle par défaut : les exceptions actives pour les personnes envoyées par un autre canal", () => {
    // Relecture du 11 octobre, « Zone Interdite » après la reprise : exception « venu du bouton « canal à rejoindre »
    // → tout de suite, sans message » et exception « venu de Tir Cadré → 1 jour ». La note disait « 5 minutes après
    // sa demande » alors que ces personnes suivent l'une ou l'autre exception (même moteur que le bot).
    const gateKind = item(
      "d7",
      { sourceKind: "GATE" },
      { rule: rule({ mode: "IMMEDIATE", delaySeconds: 0 }) },
    );
    const tir = item("tir", { scope: "SOURCE_CHANNEL", sourceChannelId: "tir" });
    const both = gateSenderExceptions([gateKind, tir], ["roulette", "tir"], names);
    expect(both).toEqual({
      labels: ["Venu de « Tir Cadré »", "Venu du bouton « canal à rejoindre » d'un de nos canaux"],
      defaultToo: false,
    });
    expect(defaultGateSkipNote({ manual: false, delaySeconds: 300 }, both)).toBe(
      "Une personne envoyée ici par le bouton « canal à rejoindre » d'un autre de nos canaux ne suit pas cette règle : selon le canal d'où elle vient, l'exception « Venu de « Tir Cadré » » ou « Venu du bouton « canal à rejoindre » d'un de nos canaux », plus bas, s'applique à elle.",
    );
    // Une seule exception, qui vaut pour tous les canaux qui envoient ici.
    const only = gateSenderExceptions([tir], ["tir"], names);
    expect(defaultGateSkipNote({ manual: false, delaySeconds: 300 }, only)).toBe(
      "Une personne envoyée ici par le bouton « canal à rejoindre » d'un autre de nos canaux ne suit pas cette règle : l'exception « Venu de « Tir Cadré » », plus bas, s'applique à elle.",
    );
    // Une partie seulement : la règle par défaut vaut pour les autres.
    const some = gateSenderExceptions([tir], ["roulette", "tir"], names);
    expect(some).toEqual({ labels: ["Venu de « Tir Cadré »"], defaultToo: true });
    expect(defaultGateSkipNote({ manual: false, delaySeconds: 300 }, some)).toBe(
      "Une personne envoyée ici par le bouton « canal à rejoindre » d'un autre de nos canaux n'a pas à rejoindre ces canaux : elle est acceptée 5 minutes après sa demande, sauf si l'exception « Venu de « Tir Cadré » », plus bas, s'applique à elle.",
    );
    expect(
      defaultGateSkipNote(
        { manual: false, delaySeconds: 300 },
        { labels: ["Venu de « Tir Cadré »", "Venu de « VIP »"], defaultToo: true },
      ),
    ).toContain(
      "sauf si l'une des exceptions « Venu de « Tir Cadré » » ou « Venu de « VIP » », plus bas, s'applique à elle.",
    );
    // Aucun canal n'envoie encore ici : le bouton de n'importe quel canal (une exception par canal ne suffit pas).
    expect(gateSenderExceptions([tir], [], names)).toEqual({ labels: [], defaultToo: true });
    expect(gateSenderExceptions([gateKind], [], names).defaultToo).toBe(false);
    // Exception désactivée ou d'une autre provenance : la règle par défaut, note d'avant.
    const off = gateSenderExceptions(
      [{ ...gateKind, isActive: false }, item("ad", { sourceKind: "AD_ANY" })],
      ["tir"],
      names,
    );
    expect(off).toEqual({ labels: [], defaultToo: true });
    expect(defaultGateSkipNote({ manual: false, delaySeconds: 86400 }, off)).toBe(
      defaultGateSkipNote({ manual: false, delaySeconds: 86400 }),
    );
  });
});

describe("affiliés Link Affi (phase 13) : n'importe quel affilié, un affilié précis, une campagne précise", () => {
  const affNames = {
    ...names,
    affiliateNames: { "aff-paul": "Paul", "aff/étrange id": "Zoé" },
    affiliateLinks: { la1: { campaignName: "Casino VIP", affiliateName: "Paul" } },
  };

  it("clés : « affiliate:<id> » encodée, n'importe quel affilié, campagne = lien précis ; aller-retour à l'identique", () => {
    expect(targetOfKey("affiliate:aff-paul")).toEqual({
      scope: "SOURCE_KIND",
      sourceKind: "LINKAFFI_AFFILIATE",
      linkaffiAffiliateId: "aff-paul",
      sourceChannelId: null,
      inviteLinkId: null,
    });
    const odd = "affiliate:" + encodeURIComponent("aff/étrange id");
    expect(targetOfKey(odd)?.linkaffiAffiliateId).toBe("aff/étrange id");
    for (const key of ["affiliate:aff-paul", odd, "kind:LINKAFFI_ANY", "link:la1"])
      expect(provenanceKey(targetOfKey(key)!)).toBe(key);
    // Un affilié précis sans affilié ne vise personne.
    expect(targetOfKey("kind:LINKAFFI_AFFILIATE")).toBeNull();
    expect(targetOfKey("affiliate:%E0%A4%A")).toBeNull();
    expect(targetOfKey(`affiliate:${"x".repeat(129)}`)).toBeNull();
    expect(
      provenanceKey({ ...targetOfKey("affiliate:aff-paul")!, linkaffiAffiliateId: null }),
    ).toBeNull();
  });

  it("phrases : condition, libellé enregistré, résumé", () => {
    expect(conditionText(targetOfKey("kind:LINKAFFI_ANY")!, affNames)).toBe(
      "de n'importe quel affilié Link Affi",
    );
    expect(conditionText(targetOfKey("affiliate:aff-paul")!, affNames)).toBe(
      "de l'affilié « Paul »".replace(" «", " «"),
    );
    expect(exceptionRuleLabel(targetOfKey("link:la1")!, affNames)).toBe(
      "Venu de la campagne « Casino VIP » de l'affilié « Paul »",
    );
    // Affilié inconnu (aucun nom) : phrase lisible.
    expect(conditionText(targetOfKey("affiliate:aff-x")!, names)).toBe(
      "d'un affilié Link Affi précis",
    );
    expect(
      exceptionSentence(
        { ...targetOfKey("affiliate:aff-paul")!, rule: rule({ mode: "MANUAL" }) },
        affNames,
      ),
    ).toBe("Une personne venue de l'affilié « Paul » attend votre validation (onglet Demandes).");
  });

  it("aide sous le menu", () => {
    expect(provenanceHelp(targetOfKey("kind:LINKAFFI_ANY"))).toMatch(/n'importe quel affilié/);
    expect(provenanceHelp(targetOfKey("affiliate:aff-paul"))).toMatch(/cet affilié/);
    expect(provenanceHelp(targetOfKey("link:la1"), affNames)).toBe(
      "Par le lien Link Affi de cette campagne d'affilié seulement.",
    );
    expect(provenanceHelp(targetOfKey("link:l1"), affNames)).toBe("Par ce lien précis seulement.");
  });

  it("menu : groupe « Un affilié Link Affi » (n'importe lequel, puis chacun) et « Une campagne d'affilié précise »", () => {
    const menu = provenanceMenu({
      channelId: "zone",
      channels: [],
      links: [{ id: "l1", name: "Post Tir Cadré", kind: "SHARE", isActive: true }],
      senders: [],
      affiliates: [
        { id: "aff-sarah", name: "Sarah" },
        { id: "aff-paul", name: "Paul" },
      ],
      affiliateLinks: [
        { id: "la1", campaignName: "Casino VIP", affiliateName: "Paul", isActive: true },
        { id: "la2", campaignName: "Ancienne", affiliateName: "Paul", isActive: false },
      ],
      used: ["affiliate:aff-paul"],
    });
    expect(menu.map((g) => g.label)).toEqual([
      "Un type de provenance",
      "Un lien de partage précis",
      "Un affilié Link Affi",
      "Une campagne d'affilié précise",
    ]);
    expect(menu[2]!.options).toEqual([
      { key: "kind:LINKAFFI_ANY", label: "de n'importe quel affilié Link Affi" },
      { key: "affiliate:aff-paul", label: "de l'affilié « Paul »", used: true },
      { key: "affiliate:aff-sarah", label: "de l'affilié « Sarah »" },
    ]);
    expect(menu[3]!.options).toEqual([
      { key: "link:la1", label: "de la campagne « Casino VIP » de l'affilié « Paul »" },
    ]);
  });

  it("menu : la campagne ou l'affilié en cours restent proposés (lien désactivé, affilié disparu)", () => {
    const base = {
      channelId: "zone",
      channels: [],
      links: [],
      senders: [],
      used: [],
      affiliateLinks: [
        { id: "la2", campaignName: "Ancienne", affiliateName: "Paul", isActive: false },
      ],
    };
    const campaign = provenanceMenu({ ...base, current: "link:la2" });
    expect(
      campaign.find((g) => g.label === "Une campagne d'affilié précise")!.options[0]!.key,
    ).toBe("link:la2");
    const gone = provenanceMenu({ ...base, affiliateLinks: [], current: "affiliate:aff-x" });
    expect(gone.find((g) => g.label === "Un affilié Link Affi")!.options.map((o) => o.key)).toEqual(
      ["kind:LINKAFFI_ANY", "affiliate:aff-x"],
    );
  });

  it("pas deux exceptions pour le même affilié ; « n'importe quel affilié » placé avant masque l'affilié précis", () => {
    const paul = item("p", targetOfKey("affiliate:aff-paul")!, { sortOrder: 20 });
    const any = item("a", targetOfKey("kind:LINKAFFI_ANY")!, { sortOrder: 10 });
    expect(findDuplicate([paul], targetOfKey("affiliate:aff-paul")!)).toBe(paul);
    expect(findDuplicate([paul], targetOfKey("affiliate:aff-sarah")!)).toBeNull();
    expect(shadowNote([any, paul], paul, affNames)).toMatch(/^Jamais utilisée/);
    // Une nouvelle exception d'affilié précis se place avant « n'importe quel affilié ».
    expect(placementOrder([any], paul)).toEqual(["p", "a"]);
  });
});
