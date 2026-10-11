import { describe, expect, it } from "vitest";
import {
  graphToLinear,
  linearToGraph,
  parseActions,
  templateGraph,
  validateGraph,
  type AutomationAction,
} from "@linkaffipro/core";
import {
  CARD_DEFS,
  CARD_KEYS,
  CardInputError,
  buildCardRule,
  cardSettingsFromForm,
  cardTitle,
  channelsText,
  defaultCardSettings,
  delayChoices,
  delaySummary,
  groupRulesByCard,
  readCardSettings,
  recognizeCard,
  type CardKey,
  type CardRule,
} from "./cards";

const message = { text: "Bonjour {prenom}", buttons: undefined, mediaAssetId: null, botId: null };

function fd(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

const EMOJI_TAG = '<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>';
const LONG_WITH_EMOJIS = "a".repeat(3000) + EMOJI_TAG.repeat(30);
function coreAcceptsVisibleLength(): boolean {
  try {
    parseActions([{ type: "send_message", text: LONG_WITH_EMOJIS }]);
    return true;
  } catch {
    return false;
  }
}

let n = 0;
function rule(partial: Partial<CardRule>): CardRule {
  n++;
  return {
    id: `r${n}`,
    trigger: "JOINED",
    conditions: {},
    actions: [],
    graph: null,
    templateKey: null,
    isActive: false,
    updatedAt: new Date(Date.UTC(2026, 9, 1, n)),
    ...partial,
  };
}

describe("cartes : construction", () => {
  it("chaque carte, avec ses réglages par défaut, donne une relance valide et relue à l'identique", () => {
    for (const key of CARD_KEYS) {
      const s = defaultCardSettings(key);
      const built = buildCardRule(key, s);
      expect(built.templateKey).toBe(key);
      expect(built.name).toBe(CARD_DEFS[key].ruleName);
      if (built.graph) expect(validateGraph(built.graph).ok).toBe(true);
      const back = readCardSettings(key, { ...built, templateKey: key });
      expect(back).toEqual({ ...s, message: { ...s.message } });
      expect(recognizeCard({ ...built, templateKey: key })).toBe(key);
    }
  });

  it("les cartes avec condition sont des parcours à branches, les autres des listes d'actions", () => {
    expect(
      buildCardRule("offer_no_signup", defaultCardSettings("offer_no_signup")).graph,
    ).not.toBeNull();
    expect(
      buildCardRule("signup_no_deposit", defaultCardSettings("signup_no_deposit")).graph,
    ).not.toBeNull();
    expect(
      buildCardRule("first_deposit_thanks", defaultCardSettings("first_deposit_thanks")).graph,
    ).not.toBeNull();
    for (const key of ["welcome", "inactive_7d", "vip"] as const) {
      const b = buildCardRule(key, defaultCardSettings(key));
      expect(b.graph).toBeNull();
      expect(b.actions.at(-1)?.type).toBe("send_message");
    }
  });

  it("le parcours d'une carte avec condition est celui du moteur (templateGraph), délai réglé compris", () => {
    const s = { ...defaultCardSettings("offer_no_signup"), hours: 12, message };
    const b = buildCardRule("offer_no_signup", s);
    expect(b.graph).toEqual(templateGraph("offer_no_signup", { message, hours: 12 }));
    expect(b.actions).toEqual([]);
    expect(b.trigger).toBe("OFFER_CLICKED");
  });

  it("filtres : canaux, jours sans activité, seuil", () => {
    expect(
      buildCardRule("welcome", { ...defaultCardSettings("welcome"), channelIds: ["c1", "c2"] })
        .conditions,
    ).toEqual({ channelIds: ["c1", "c2"] });
    expect(
      buildCardRule("inactive_7d", { ...defaultCardSettings("inactive_7d"), inactiveDays: 14 })
        .conditions,
    ).toEqual({ inactiveDays: 14 });
    expect(
      buildCardRule("vip", { ...defaultCardSettings("vip"), level: "REGULIER" }).conditions,
    ).toEqual({
      spendLevels: ["REGULIER"],
    });
  });

  it("bienvenue avec délai : attendre puis message ; sans délai : message seul", () => {
    expect(
      buildCardRule("welcome", { ...defaultCardSettings("welcome"), hours: 3 }).actions.map(
        (a) => a.type,
      ),
    ).toEqual(["wait", "send_message"]);
    expect(
      buildCardRule("welcome", defaultCardSettings("welcome")).actions.map((a) => a.type),
    ).toEqual(["send_message"]);
  });

  it("une règle déjà en parcours à branches le reste (les membres en attente reprennent au même bloc)", () => {
    const existingGraph = templateGraph("welcome", { message, hours: 3 });
    const b = buildCardRule(
      "welcome",
      { ...defaultCardSettings("welcome"), hours: 24 },
      { graph: existingGraph },
    );
    expect(b.graph).not.toBeNull();
    expect(b.graph!.nodes.map((x) => x.id)).toEqual(["trigger", "wait", "message"]);
    expect(graphToLinear(b.graph!)?.map((a) => a.type)).toEqual(["wait", "send_message"]);
    expect(b.actions.map((a) => a.type)).toEqual(["wait", "send_message"]);
  });
});

describe("cartes : reconnaissance des règles existantes", () => {
  it("reconnaît une règle à liste qui a exactement la forme d'une carte sans condition", () => {
    const relance: AutomationAction[] = [
      { type: "wait", hours: 24 },
      { type: "send_message", text: "Bonjour {prenom} !" },
    ];
    expect(recognizeCard({ trigger: "JOINED", conditions: {}, actions: relance })).toBe("welcome");
    expect(
      readCardSettings("welcome", { trigger: "JOINED", conditions: {}, actions: relance })?.hours,
    ).toBe(24);
    expect(
      recognizeCard({
        trigger: "INACTIVE",
        conditions: { inactiveDays: 10, channelIds: ["c1"] },
        actions: [{ type: "send_message", text: "Ça fait longtemps" }],
      }),
    ).toBe("inactive_7d");
    expect(
      recognizeCard({
        trigger: "SPEND_LEVEL_REACHED",
        conditions: { spendLevels: ["VIP"] },
        actions: [{ type: "send_message", text: "Bravo" }],
      }),
    ).toBe("vip");
  });

  it("garde en « sur mesure » ce qui ne tient pas dans une carte", () => {
    // Plusieurs actions (modèle « merci après dépôt » de la démo).
    expect(
      recognizeCard({
        trigger: "DEPOSITED",
        conditions: {},
        actions: [
          { type: "send_message", text: "Merci" },
          { type: "tag", tag: "Déposant" },
        ],
      }),
    ).toBeNull();
    // Un message seul après un dépôt n'est pas « merci au premier dépôt » (il partirait aux membres déjà déposants).
    expect(
      recognizeCard({
        trigger: "DEPOSITED",
        conditions: {},
        actions: [{ type: "send_message", text: "Merci" }],
      }),
    ).toBeNull();
    // Filtre que la carte ne sait pas montrer.
    expect(
      recognizeCard({
        trigger: "JOINED",
        conditions: { languages: ["fr"] },
        actions: [{ type: "send_message", text: "Salut" }],
      }),
    ).toBeNull();
    // Action JSON invalide.
    expect(
      recognizeCard({ trigger: "JOINED", conditions: {}, actions: [{ type: "??" }] }),
    ).toBeNull();
    // Parcours à branches sans carte d'origine.
    expect(
      recognizeCard({
        trigger: "JOINED",
        conditions: {},
        actions: [],
        graph: linearToGraph([{ type: "send_message", text: "Salut" }]),
      }),
    ).toBeNull();
  });

  it("une carte d'origine dont la forme a changé passe en « sur mesure »", () => {
    const graph = templateGraph("offer_no_signup", { message });
    graph.nodes.push({ id: "extra", type: "stop", position: { x: 0, y: 0 } });
    graph.edges.push({ id: "e-x", source: "message", sourceHandle: "next", target: "extra" });
    expect(validateGraph(graph).ok).toBe(true);
    expect(
      recognizeCard({
        trigger: "OFFER_CLICKED",
        conditions: {},
        actions: [],
        graph,
        templateKey: "offer_no_signup",
      }),
    ).toBeNull();
    // Mauvais déclencheur.
    expect(
      recognizeCard({
        trigger: "JOINED",
        conditions: {},
        actions: [],
        graph: templateGraph("offer_no_signup", { message }),
        templateKey: "offer_no_signup",
      }),
    ).toBeNull();
    // Merci au premier dépôt : le seuil de la condition doit rester « au moins 2 dépôts ».
    const thanks = templateGraph("first_deposit_thanks", { message });
    const check = thanks.nodes.find((x) => x.id === "check");
    if (check?.type === "condition") check.condition = { kind: "deposit_count_gte", n: 3 };
    expect(
      readCardSettings("first_deposit_thanks", {
        trigger: "DEPOSITED",
        conditions: {},
        actions: [],
        graph: thanks,
      }),
    ).toBeNull();
  });

  it("range les règles : principale (créée par la carte, sinon active, sinon récente), autres, sur mesure", () => {
    const welcomeOld = rule({ actions: [{ type: "send_message", text: "A" }] });
    const welcomeActive = rule({ actions: [{ type: "send_message", text: "B" }], isActive: true });
    const welcomeCard = rule({
      ...buildCardRule("welcome", defaultCardSettings("welcome")),
      templateKey: "welcome",
    });
    const custom = rule({
      trigger: "DEPOSITED",
      actions: [
        { type: "send_message", text: "Merci" },
        { type: "notify_team", text: "Dépôt" },
      ],
    });
    const { cards, custom: rest } = groupRulesByCard([
      welcomeOld,
      welcomeActive,
      custom,
      welcomeCard,
    ]);
    expect(cards.map((c) => c.key)).toEqual([...CARD_KEYS]);
    const welcome = cards.find((c) => c.key === "welcome")!;
    expect(welcome.rule?.id).toBe(welcomeCard.id);
    expect(welcome.others.map((r) => r.id)).toEqual([welcomeActive.id, welcomeOld.id]);
    expect(rest.map((r) => r.id)).toEqual([custom.id]);
    const vip = cards.find((c) => c.key === "vip")!;
    expect(vip.rule).toBeNull();
    expect(vip.settings).toEqual(defaultCardSettings("vip"));

    const noCard = groupRulesByCard([welcomeOld, welcomeActive]);
    expect(noCard.cards.find((c) => c.key === "welcome")!.rule?.id).toBe(welcomeActive.id);
  });
});

describe("cartes : formulaire", () => {
  it("lit délai, message, boutons, canaux et avancé", () => {
    const s = cardSettingsFromForm(
      "offer_no_signup",
      fd([
        ["delay", "12"],
        ["text", "  Bonjour <b>{prenom}</b>  "],
        ["buttons", "Voir l'offre | https://go.goolink.eu/x\n"],
        ["channelIds", "c1"],
        ["channelIds", "c2"],
        ["channelIds", "c1"],
        ["botId", "b1"],
        ["mediaAssetId", ""],
      ]),
    );
    expect(s).toEqual({
      hours: 12,
      inactiveDays: null,
      level: null,
      channelIds: ["c1", "c2"],
      message: {
        text: "Bonjour <b>{prenom}</b>",
        buttons: [[{ text: "Voir l'offre", url: "https://go.goolink.eu/x" }]],
        botId: "b1",
        mediaAssetId: null,
      },
    });
  });

  it("boutons saisis champ par champ (buttonsJson) : prioritaires sur l'ancien champ texte", () => {
    const s = cardSettingsFromForm(
      "welcome",
      fd([
        ["text", "Salut"],
        ["delay", "now"],
        [
          "buttonsJson",
          JSON.stringify([
            { text: "Voir l'offre", url: "https://go.goolink.eu/x" },
            { text: "", url: "" },
          ]),
        ],
        ["buttons", "ignoré"],
      ]),
    );
    expect(s.message.buttons).toEqual([[{ text: "Voir l'offre", url: "https://go.goolink.eu/x" }]]);
    expect(() =>
      cardSettingsFromForm(
        "welcome",
        fd([
          ["text", "Salut"],
          ["buttonsJson", JSON.stringify([{ text: "Voir", url: "exemple.fr" }])],
        ]),
      ),
    ).toThrow(/adresse complète/);
    expect(() =>
      cardSettingsFromForm(
        "welcome",
        fd([
          ["text", "Salut"],
          ["buttonsJson", "{"],
        ]),
      ),
    ).toThrow(/illisibles/);
  });

  it("bouton « Offre (campagne) » (buttonsJson) : campagne et offre gardées dans la relance", () => {
    const offer = {
      text: "Voir l'offre",
      type: "OFFER",
      campaignId: "c1",
      affiliateCampaignId: "a1",
    };
    const s = cardSettingsFromForm(
      "offer_no_signup",
      fd([
        ["delay", "24"],
        ["text", "Salut {prenom}"],
        [
          "buttonsJson",
          JSON.stringify([
            {
              kind: "offer",
              text: "Voir l'offre",
              url: "",
              campaignId: "c1",
              affiliateCampaignId: "a1",
            },
            { text: "Aide", url: "https://x.y" },
          ]),
        ],
      ]),
    );
    expect(s.message.buttons).toEqual([[offer], [{ text: "Aide", url: "https://x.y" }]]);
    // La règle construite garde le bouton tel quel (le worker en fait le lien de la relance à l'envoi).
    const built = buildCardRule("offer_no_signup", s, null);
    const message = (
      built.graph!.nodes.find((n) => n.id === "message") as {
        action: { buttons?: unknown };
      }
    ).action;
    expect(message.buttons).toEqual([[offer], [{ text: "Aide", url: "https://x.y" }]]);
    expect(
      readCardSettings("offer_no_signup", { ...built, templateKey: "offer_no_signup" })?.message
        .buttons,
    ).toEqual([[offer], [{ text: "Aide", url: "https://x.y" }]]);
    expect(() =>
      cardSettingsFromForm(
        "welcome",
        fd([
          ["text", "Salut"],
          ["buttonsJson", JSON.stringify([{ kind: "offer", text: "Voir", url: "" }])],
        ]),
      ),
    ).toThrow(/choisissez la campagne de l'offre/);
  });

  it("« tout de suite » pour la bienvenue ; jours sans activité ; seuil", () => {
    expect(
      cardSettingsFromForm(
        "welcome",
        fd([
          ["delay", "now"],
          ["text", "Salut"],
        ]),
      ).hours,
    ).toBeNull();
    expect(
      cardSettingsFromForm(
        "inactive_7d",
        fd([
          ["inactiveDays", "14"],
          ["text", "Salut"],
        ]),
      ).inactiveDays,
    ).toBe(14);
    expect(
      cardSettingsFromForm(
        "vip",
        fd([
          ["level", "REGULIER"],
          ["text", "Salut"],
        ]),
      ).level,
    ).toBe("REGULIER");
  });

  it("longueur visible : un emoji animé compte comme son emoji (comme le compteur de l'éditeur)", () => {
    // 3 000 caractères + 30 emojis animés = 3 060 caractères visibles (4 620 en HTML brut).
    expect(LONG_WITH_EMOJIS.length).toBeGreaterThan(4096);
    const cases: Array<[CardKey, [string, string]]> = [
      ["offer_no_signup", ["delay", "24"]],
      ["welcome", ["delay", "now"]],
      ["inactive_7d", ["inactiveDays", "7"]],
    ];
    for (const [key, entry] of cases) {
      const s = cardSettingsFromForm(key, fd([entry, ["text", LONG_WITH_EMOJIS]]));
      expect(s.message.text).toBe(LONG_WITH_EMOJIS);
    }
    // Au-delà de 4 096 caractères visibles (👍 en vaut 2, comme dans le compteur) : toujours refusé, même message.
    expect(() =>
      cardSettingsFromForm(
        "welcome",
        fd([
          ["delay", "now"],
          ["text", "a".repeat(4095) + EMOJI_TAG],
        ]),
      ),
    ).toThrow(/Message trop long \(4 096 caractères au plus\)/);
    expect(() =>
      cardSettingsFromForm(
        "welcome",
        fd([
          ["delay", "now"],
          ["text", "a".repeat(4094) + EMOJI_TAG],
        ]),
      ),
    ).not.toThrow();
  });

  it("ne construit jamais un parcours que le worker refuserait (refus en français à la place)", () => {
    const s = cardSettingsFromForm(
      "offer_no_signup",
      fd([
        ["delay", "24"],
        ["text", LONG_WITH_EMOJIS],
      ]),
    );
    let built: ReturnType<typeof buildCardRule> | null = null;
    try {
      built = buildCardRule("offer_no_signup", s, null);
    } catch (err) {
      expect(err).toBeInstanceOf(CardInputError);
      expect((err as Error).message).toMatch(/^Relance à corriger : /);
    }
    if (built) expect(validateGraph(built.graph).ok).toBe(true);
  });

  // Actif dès que `parseActions` (core) mesure la longueur visible ; avant, le core refuse ce texte partout.
  it.runIf(coreAcceptsVisibleLength())(
    "3 000 caractères + 30 emojis animés : relance enregistrable, en liste comme en parcours",
    () => {
      const cases: Array<[CardKey, [string, string]]> = [
        ["offer_no_signup", ["delay", "24"]],
        ["welcome", ["delay", "now"]],
      ];
      for (const [key, entry] of cases) {
        const s = cardSettingsFromForm(key, fd([entry, ["text", LONG_WITH_EMOJIS]]));
        const built = buildCardRule(key, s, null);
        const sent = built.graph
          ? (built.graph.nodes.find((n) => n.id === "message") as { action: { text?: string } })
              .action.text
          : (built.actions.find((a) => a.type === "send_message") as { text: string }).text;
        expect(sent).toBe(LONG_WITH_EMOJIS);
      }
    },
  );

  it("refuse en français : message vide, mise en forme cassée, bouton sans adresse, délai hors bornes", () => {
    const bad =
      (key: Parameters<typeof cardSettingsFromForm>[0], entries: Array<[string, string]>) => () =>
        cardSettingsFromForm(key, fd(entries));
    expect(bad("welcome", [["text", "  "]])).toThrow(CardInputError);
    expect(bad("welcome", [["text", "  "]])).toThrow(/Écrivez le message/);
    expect(bad("welcome", [["text", "<b>gras"]])).toThrow(/Mise en forme/);
    expect(
      bad("welcome", [
        ["text", "Salut"],
        ["buttons", "Voir"],
      ]),
    ).toThrow(/adresse/);
    expect(
      bad("offer_no_signup", [
        ["text", "Salut"],
        ["delay", "now"],
      ]),
    ).toThrow(/après combien/);
    expect(
      bad("offer_no_signup", [
        ["text", "Salut"],
        ["delay", "0.5"],
      ]),
    ).toThrow(/1 heure et 90 jours/);
    expect(
      bad("inactive_7d", [
        ["text", "Salut"],
        ["inactiveDays", "0"],
      ]),
    ).toThrow(/jours/);
    expect(
      bad("vip", [
        ["text", "Salut"],
        ["level", "AUCUN"],
      ]),
    ).toThrow(/seuil/);
  });
});

describe("cartes : textes", () => {
  it("titres écrits en français, avec le délai réglé", () => {
    expect(cardTitle("welcome")).toBe("Bienvenue quand quelqu'un rejoint un canal");
    expect(cardTitle("offer_no_signup")).toBe(
      "A cliqué une offre sans s'inscrire sous 1 jour → relance",
    );
    expect(cardTitle("offer_no_signup", { hours: 12, inactiveDays: null })).toBe(
      "A cliqué une offre sans s'inscrire sous 12 h → relance",
    );
    expect(cardTitle("signup_no_deposit")).toBe("Inscrit sans dépôt sous 2 jours → relance");
    expect(cardTitle("inactive_7d")).toBe("Rien fait depuis 7 jours → relance");
    expect(cardTitle("first_deposit_thanks")).toBe("Premier dépôt → merci");
    expect(cardTitle("vip")).toBe("Dépôts au-delà d'un seuil → message VIP");
  });

  it("choix du délai : valeurs proposées, plus la valeur actuelle hors liste", () => {
    expect(delayChoices("welcome", null).map((c) => c.label)).toEqual([
      "Tout de suite",
      "1 h",
      "3 h",
      "1 jour",
    ]);
    expect(delayChoices("offer_no_signup", 36).map((c) => c.value)).toEqual([
      "6",
      "12",
      "24",
      "36",
      "48",
    ]);
    expect(delayChoices("inactive_7d", 7).map((c) => c.label)).toEqual([
      "3 jours",
      "7 jours",
      "14 jours",
      "30 jours",
    ]);
    expect(delayChoices("vip", "VIP").map((c) => c.label)).toEqual([
      "Membre régulier",
      "Niveau VIP",
    ]);
  });

  it("résumés : délai, canaux", () => {
    expect(delaySummary("offer_no_signup", defaultCardSettings("offer_no_signup"))).toBe(
      "Relancer après : 1 jour",
    );
    expect(delaySummary("welcome", defaultCardSettings("welcome"))).toBe(
      "Quand l'envoyer : tout de suite",
    );
    expect(delaySummary("vip", defaultCardSettings("vip"))).toBe("Seuil : niveau VIP");
    expect(
      delaySummary("first_deposit_thanks", defaultCardSettings("first_deposit_thanks")),
    ).toBeNull();
    expect(channelsText([], {})).toBe("Tous les canaux");
    expect(channelsText(["a"], { a: "Casino VIP" })).toBe("Casino VIP");
    expect(channelsText(["a", "b"], { a: "A", b: "B" })).toBe("A et B");
    expect(channelsText(["a", "b", "c"], {})).toBe("3 canaux");
  });
});
