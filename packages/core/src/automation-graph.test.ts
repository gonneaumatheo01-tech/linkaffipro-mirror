import { describe, expect, it } from "vitest";
import { parseActions, type AutomationAction } from "./automation";
import {
  AUTOMATION_TEMPLATE_DEFS,
  AUTOMATION_TEMPLATE_KEYS,
  describeAction,
  describeCondition,
  describeNode,
  evaluateCondition,
  formatWaitHours,
  graphContextFromData,
  graphForRule,
  graphHandlesFor,
  graphNextNodeId,
  graphToLinear,
  GRAPH_ACTION_HELP,
  GRAPH_CONDITION_HELP,
  GRAPH_CONDITION_KINDS,
  GRAPH_CONDITION_LABELS,
  isAutomationTemplateKey,
  issuesByNode,
  linearToGraph,
  nodeRunStats,
  parseGraph,
  parseGraphAction,
  parseGraphCondition,
  parseRunLog,
  summarizeGraph,
  templateGraph,
  uniqueGraphId,
  validateGraph,
  type AutomationGraph,
  type GraphMemberContext,
} from "./automation-graph";

const P = { x: 0, y: 0 };

/** Départ → attendre 24 h → « a déjà déposé ? » : oui → arrêt, non → message. */
function branching(): AutomationGraph {
  return {
    version: 1,
    nodes: [
      { id: "t", type: "trigger", position: P },
      { id: "w", type: "wait", position: P, hours: 24 },
      { id: "c", type: "condition", position: P, condition: { kind: "deposited" } },
      { id: "s", type: "stop", position: P },
      { id: "m", type: "action", position: P, action: { type: "send_message", text: "Pensez-y" } },
    ],
    edges: [
      { id: "e1", source: "t", sourceHandle: "next", target: "w" },
      { id: "e2", source: "w", sourceHandle: "next", target: "c" },
      { id: "e3", source: "c", sourceHandle: "yes", target: "s" },
      { id: "e4", source: "c", sourceHandle: "no", target: "m" },
    ],
  };
}

function codes(raw: unknown) {
  return validateGraph(raw).issues.map((i) => `${i.code}${i.nodeId ? `@${i.nodeId}` : ""}`);
}

const ctx = (over: Partial<GraphMemberContext> = {}): GraphMemberContext => ({
  registered: false,
  deposited: false,
  depositCount: 0,
  spendLevel: "AUCUN",
  languageCode: "fr-FR",
  tags: [],
  channelIds: [],
  campaignIds: [],
  inactiveDays: 0,
  offerClicksSinceStart: 0,
  ...over,
});

describe("validation du graphe", () => {
  it("accepte un graphe à branches et le normalise", () => {
    const v = validateGraph(branching());
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.graph?.nodes).toHaveLength(5);
    expect(parseGraph(branching())).toEqual(v.graph);
  });

  it("lit les données dans `data` (format de l'éditeur), poignée vide = « next », position par défaut", () => {
    const g = parseGraph({
      nodes: [
        { id: "t", type: "trigger" },
        {
          id: "m",
          type: "action",
          position: { x: 10, y: "x" },
          data: { action: { type: "tag", tag: " vip " } },
        },
      ],
      edges: [{ id: "e", source: "t", sourceHandle: null, target: "m" }],
    });
    expect(g.nodes[0]!.position).toEqual({ x: 0, y: 0 });
    expect(g.nodes[1]).toEqual({
      id: "m",
      type: "action",
      position: { x: 10, y: 0 },
      action: { type: "tag", tag: "vip" },
    });
    expect(g.edges[0]!.sourceHandle).toBe("next");
    expect(g.version).toBe(1);
  });

  it("refuse ce qui n'est pas un graphe", () => {
    expect(codes(null)).toEqual(["invalid_graph"]);
    expect(codes({ nodes: "x" })).toEqual(["invalid_graph"]);
    expect(codes({ version: 2, nodes: [] })).toContain("invalid_graph");
    expect(() => parseGraph([])).toThrow(/Relance à corriger/);
  });

  it("signale les blocs incomplets, avec le bloc concerné", () => {
    const g = branching();
    g.nodes[4] = {
      id: "m",
      type: "action",
      position: P,
      action: { type: "send_message", text: "  " },
    };
    g.nodes[1] = { id: "w", type: "wait", position: P, hours: 0.5 };
    (g.nodes as unknown[])[2] = {
      id: "c",
      type: "condition",
      position: P,
      condition: { kind: "has_tag", tag: "" },
    };
    const v = validateGraph(g);
    expect(v.ok).toBe(false);
    expect(v.graph).toBeNull();
    const by = issuesByNode(v.issues);
    expect(by.m?.[0]).toMatchObject({
      code: "empty_text",
      message: "Écrivez le texte du message.",
    });
    expect(by.w?.[0]).toMatchObject({
      code: "invalid_wait",
      message: "L'attente doit durer entre 1 heure et 90 jours.",
    });
    expect(by.c?.[0]).toMatchObject({ code: "incomplete" });
  });

  it("signale départ manquant ou multiple, bloc inaccessible, condition sans sortie, boucle", () => {
    expect(codes({ nodes: [{ id: "m", type: "stop" }], edges: [] })).toEqual(["no_trigger"]);
    const g = branching();
    g.nodes.push({ id: "t2", type: "trigger", position: P });
    g.nodes.push({ id: "orphan", type: "action", position: P, action: { type: "tag", tag: "x" } });
    expect(codes(g)).toEqual(["multiple_triggers@t2", "unreachable@orphan"]);

    const lonely = branching();
    lonely.edges = lonely.edges.filter((e) => e.source !== "c");
    expect(codes(lonely)).toEqual([
      "unreachable@s",
      "unreachable@m",
      "no_action",
      "condition_without_exit@c",
    ]);

    const loop = branching();
    loop.edges[2] = { id: "e3", source: "c", sourceHandle: "yes", target: "w" };
    expect(codes(loop)).toContain("cycle@c");
    expect(codes(loop)).toContain("unreachable@s");
    const self = branching();
    self.edges.push({ id: "e5", source: "m", sourceHandle: "next", target: "m" });
    expect(codes(self)).toEqual(["cycle@m"]);
  });

  it("signale les liens invalides", () => {
    const g = branching();
    g.edges.push({ id: "e1", source: "m", sourceHandle: "next", target: "s" });
    g.edges.push({ id: "x1", source: "c", sourceHandle: "next", target: "m" });
    g.edges.push({ id: "x2", source: "s", sourceHandle: "next", target: "m" });
    g.edges.push({ id: "x3", source: "m", sourceHandle: "next", target: "t" });
    g.edges.push({ id: "x4", source: "c", sourceHandle: "no", target: "s" });
    g.edges.push({ id: "x5", source: "m", sourceHandle: "next", target: "ghost" });
    expect(validateGraph(g).issues.map((i) => `${i.code}:${i.edgeId}`)).toEqual([
      "duplicate_id:e1",
      "invalid_handle:x1",
      "invalid_handle:x2",
      "invalid_edge:x3",
      "duplicate_exit:x4",
      "edge_unknown_node:x5",
    ]);
  });

  it("exige une suite au départ et au moins une action ; avertit d'une attente sans suite", () => {
    expect(codes({ nodes: [{ id: "t", type: "trigger" }] })).toEqual(["trigger_without_exit@t"]);
    const noAction = {
      nodes: [
        { id: "t", type: "trigger" },
        { id: "w", type: "wait", hours: 2 },
      ],
      edges: [{ id: "e", source: "t", target: "w" }],
    };
    const v = validateGraph(noAction);
    expect(v.issues.map((i) => `${i.code}:${i.severity}`)).toEqual([
      "no_action:error",
      "wait_without_exit:warning",
    ]);
    const warnOnly = linearToGraph([
      { type: "send_message", text: "a" },
      { type: "wait", hours: 3 },
    ]);
    const w = validateGraph(warnOnly);
    expect(w.ok).toBe(true);
    expect(w.issues).toEqual([
      expect.objectContaining({ code: "wait_without_exit", severity: "warning", nodeId: "n2" }),
    ]);
  });

  it("limite à 40 blocs", () => {
    const actions: AutomationAction[] = Array.from({ length: 40 }, (_, i) => ({
      type: "tag",
      tag: `t${i}`,
    }));
    expect(codes(linearToGraph(actions))).toEqual(["too_many_nodes"]);
    expect(validateGraph(linearToGraph(actions.slice(0, 39))).ok).toBe(true);
  });

  it("résume les erreurs dans le message de parseGraph", () => {
    expect(() => parseGraph({ nodes: [{ id: "t", type: "trigger" }] })).toThrow(
      "Relance à corriger : Reliez le départ à une première étape.",
    );
    const many = { nodes: [1, 2, 3, 4, 5].map((i) => ({ id: `w${i}`, type: "wait" })) };
    expect(() => parseGraph(many)).toThrow(/ \(et 3 autres\)\.$/);
  });
});

describe("contenu des blocs", () => {
  it("valide chaque condition et nettoie ses paramètres", () => {
    expect(parseGraphCondition({ kind: "registered" })).toEqual({ kind: "registered" });
    expect(parseGraphCondition({ kind: "deposit_count_gte", n: "3" })).toEqual({
      kind: "deposit_count_gte",
      n: 3,
    });
    expect(
      parseGraphCondition({ kind: "spend_level_in", levels: ["VIP", "VIP", "REGULIER"] }),
    ).toEqual({
      kind: "spend_level_in",
      levels: ["VIP", "REGULIER"],
    });
    expect(parseGraphCondition({ kind: "language_in", languages: [" FR ", "pt-BR"] })).toEqual({
      kind: "language_in",
      languages: ["fr", "pt-br"],
    });
    expect(parseGraphCondition({ kind: "has_tag", tag: " vip " })).toEqual({
      kind: "has_tag",
      tag: "vip",
    });
    expect(parseGraphCondition({ kind: "in_channel", channelId: "c1" })).toEqual({
      kind: "in_channel",
      channelId: "c1",
    });
    expect(parseGraphCondition({ kind: "inactive_days_gte", n: 7 })).toEqual({
      kind: "inactive_days_gte",
      n: 7,
    });
    expect(parseGraphCondition({ kind: "campaign_in", campaignIds: ["k1", ""] })).toEqual({
      kind: "campaign_in",
      campaignIds: ["k1"],
    });
    expect(() => parseGraphCondition({})).toThrow("Choisissez la condition à vérifier.");
    expect(() => parseGraphCondition({ kind: "danse" })).toThrow("Condition inconnue.");
    expect(() => parseGraphCondition({ kind: "deposit_count_gte", n: 0 })).toThrow(
      /nombre de dépôts/,
    );
    expect(() => parseGraphCondition({ kind: "inactive_days_gte", n: 1.5 })).toThrow(
      /nombre de jours/,
    );
    expect(() => parseGraphCondition({ kind: "spend_level_in", levels: ["ROI"] })).toThrow(
      /Niveau de dépense inconnu/,
    );
    expect(() => parseGraphCondition({ kind: "spend_level_in", levels: [] })).toThrow(
      /au moins un niveau/,
    );
    expect(() => parseGraphCondition({ kind: "language_in", languages: ["français"] })).toThrow(
      /Langue inconnue/,
    );
    expect(() => parseGraphCondition({ kind: "in_channel" })).toThrow(/canal/);
    expect(() => parseGraphCondition({ kind: "campaign_in", campaignIds: [] })).toThrow(/campagne/);
  });

  it("valide les actions comme parseActions, sans l'attente", () => {
    expect(
      parseGraphAction({
        type: "send_message",
        text: " Salut ",
        buttons: [[{ text: "Voir", url: "https://x.y" }]],
      }),
    ).toEqual(
      parseActions([
        {
          type: "send_message",
          text: " Salut ",
          buttons: [[{ text: "Voir", url: "https://x.y" }]],
        },
      ])[0],
    );
    expect(() => parseGraphAction(undefined)).toThrow("Choisissez l'action à faire.");
    expect(() => parseGraphAction({ type: "wait", hours: 2 })).toThrow(/bloc « Attendre »/);
    expect(() => parseGraphAction({ type: "danse" })).toThrow("Action inconnue.");
    expect(() => parseGraphAction({ type: "notify_team", text: "" })).toThrow(/notification/);
    expect(() => parseGraphAction({ type: "tag", tag: "" })).toThrow(/étiquette/);
    expect(() => parseGraphAction({ type: "suggest_channel", channelId: "" })).toThrow(
      /canal à proposer/,
    );
    expect(() => parseGraphAction({ type: "send_sequence", trigger: "X" })).toThrow(
      /message du bot/,
    );
    // Erreur venue de parseActions : sans le préfixe « Action 1 : ».
    expect(() =>
      parseGraphAction({
        type: "send_message",
        text: "x",
        buttons: [[{ text: "a", url: "ftp://z" }]],
      }),
    ).toThrow(/^Chaque bouton a un libellé et une URL http\(s\)\.$/);
  });

  it("sorties possibles par type de bloc", () => {
    expect(graphHandlesFor("condition")).toEqual(["yes", "no"]);
    expect(graphHandlesFor("stop")).toEqual([]);
    expect(graphHandlesFor("action")).toEqual(["next"]);
    expect(graphNextNodeId(branching(), "c", "no")).toBe("m");
    expect(graphNextNodeId(branching(), "m", "next")).toBeNull();
  });
});

describe("convertisseurs", () => {
  const actions = parseActions([
    {
      type: "send_message",
      text: "Bienvenue {prenom}",
      buttons: [[{ text: "Voir", url: "https://x.y" }]],
    },
    { type: "wait", hours: 24 },
    { type: "tag", tag: "relance" },
    { type: "send_sequence", trigger: "APPROVED" },
    { type: "suggest_channel", channelId: "c2" },
    { type: "notify_team", text: "fait" },
  ]);

  it("une règle linéaire s'ouvre comme une branche unique, en colonne", () => {
    const g = linearToGraph(actions);
    expect(g.nodes.map((n) => `${n.id}:${n.type}`)).toEqual([
      "trigger:trigger",
      "n1:action",
      "n2:wait",
      "n3:action",
      "n4:action",
      "n5:action",
      "n6:action",
    ]);
    expect(g.nodes.map((n) => n.position)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: 0, y: i * 160 })),
    );
    expect(g.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      "trigger>n1",
      "n1>n2",
      "n2>n3",
      "n3>n4",
      "n4>n5",
      "n5>n6",
    ]);
    expect(validateGraph(g).ok).toBe(true);
  });

  it("aller-retour : linéaire → graphe → linéaire à l'identique", () => {
    expect(graphToLinear(linearToGraph(actions))).toEqual(actions);
    expect(graphToLinear(parseGraph(JSON.parse(JSON.stringify(linearToGraph(actions)))))).toEqual(
      actions,
    );
    expect(graphToLinear(linearToGraph([]))).toEqual([]);
  });

  it("une chaîne terminée par « arrêter » reste linéaire ; une condition, un bloc isolé ou une fusion non", () => {
    const g = linearToGraph([{ type: "tag", tag: "a" }]);
    g.nodes.push({ id: "s", type: "stop", position: P });
    g.edges.push({ id: "es", source: "n1", sourceHandle: "next", target: "s" });
    expect(graphToLinear(g)).toEqual([{ type: "tag", tag: "a" }]);
    expect(graphToLinear(branching())).toBeNull();
    const orphan = linearToGraph([{ type: "tag", tag: "a" }]);
    orphan.nodes.push({ id: "x", type: "stop", position: P });
    expect(graphToLinear(orphan)).toBeNull();
    const nine = linearToGraph(
      Array.from({ length: 9 }, () => ({ type: "tag", tag: "a" }) as AutomationAction),
    );
    expect(graphToLinear(nine)).toBeNull();
  });

  it("graphForRule : le graphe s'il existe, sinon la liste d'actions", () => {
    expect(graphForRule({ graph: null, actions: [{ type: "tag", tag: "a" }] }).nodes).toHaveLength(
      2,
    );
    expect(graphForRule({ graph: branching(), actions: [] }).nodes).toHaveLength(5);
    expect(() => graphForRule({ graph: { nodes: [] }, actions: [] })).toThrow(/Relance à corriger/);
  });

  it("identifiant libre", () => {
    expect(uniqueGraphId(linearToGraph(actions))).toBe("n7");
    expect(uniqueGraphId(linearToGraph(actions), "e")).toBe("e7");
  });

  it("ne réattribue jamais un identifiant supprimé (trou dans la numérotation)", () => {
    const g = linearToGraph(actions);
    const withoutN2 = { nodes: g.nodes.filter((n) => n.id !== "n2"), edges: g.edges };
    expect(uniqueGraphId(withoutN2)).toBe("n7");
  });
});

describe("libellés", () => {
  it("chaque condition a un libellé et une aide", () => {
    for (const k of GRAPH_CONDITION_KINDS) {
      expect(GRAPH_CONDITION_LABELS[k]).toBeTruthy();
      expect(GRAPH_CONDITION_HELP[k]).toMatch(/\.$/);
    }
  });

  it("questions et actions en français, noms des canaux et campagnes", () => {
    const names = { channels: { c1: "VIP Casino" }, campaigns: { k1: "TikTok octobre" } };
    expect(describeCondition({ kind: "deposited" })).toBe("A déjà déposé ?");
    expect(describeCondition({ kind: "deposit_count_gte", n: 1 })).toBe("Au moins 1 dépôt ?");
    expect(describeCondition({ kind: "deposit_count_gte", n: 3 })).toBe("Au moins 3 dépôts ?");
    expect(describeCondition({ kind: "spend_level_in", levels: ["VIP", "REGULIER"] })).toBe(
      "Niveau de dépense VIP ou Régulier ?",
    );
    expect(describeCondition({ kind: "language_in", languages: ["fr", "en"] })).toBe(
      "Langue FR, EN ?",
    );
    expect(describeCondition({ kind: "in_channel", channelId: "c1" }, names)).toBe(
      "Dans le canal « VIP Casino » ?",
    );
    expect(describeCondition({ kind: "inactive_days_gte", n: 7 })).toBe(
      "Rien fait depuis 7 jours ?",
    );
    expect(describeCondition({ kind: "campaign_in", campaignIds: ["k1"] }, names)).toBe(
      "Venu de la campagne « TikTok octobre » ?",
    );
    expect(describeCondition({ kind: "campaign_in", campaignIds: ["k1", "k2"] }, names)).toBe(
      "Venu des campagnes « TikTok octobre », « k2 » ?",
    );
    expect(
      describeAction({
        type: "send_message",
        text: "<b>Salut</b> {prenom}, voici le bonus du jour qui t'attend",
      }),
    ).toBe("Envoyer le message « Salut {prenom}, voici le bonus du jour… »");
    expect(describeAction({ type: "send_sequence", trigger: "APPROVED" })).toBe(
      "Envoyer le message du bot « Accepté »",
    );
    expect(describeAction({ type: "suggest_channel", channelId: "c1" }, names)).toBe(
      "Proposer le canal « VIP Casino »",
    );
    expect(describeNode({ id: "w", type: "wait", position: P, hours: 48 })).toBe(
      "Attendre 2 jours",
    );
    expect(describeNode({ id: "t", type: "trigger", position: P })).toBe("Départ");
  });

  it("durées", () => {
    expect(formatWaitHours(2)).toBe("2 h");
    expect(formatWaitHours(1.5)).toBe("1,5 h");
    expect(formatWaitHours(24)).toBe("1 jour");
    expect(formatWaitHours(72)).toBe("3 jours");
    expect(formatWaitHours(30)).toBe("1 j 6 h");
  });

  it("résumé court du parcours", () => {
    expect(summarizeGraph(branching())).toBe(
      "Attendre 1 jour → si a déjà déposé : arrêt ; sinon : message",
    );
    expect(
      summarizeGraph(
        linearToGraph([
          { type: "send_message", text: "a" },
          { type: "tag", tag: "vip" },
        ]),
      ),
    ).toBe("Message → étiquette « vip »");
    expect(summarizeGraph(linearToGraph([]))).toBe("Ne fait rien");
    const partial = branching();
    partial.edges = partial.edges.filter((e) => e.id !== "e3");
    expect(summarizeGraph(partial)).toBe(
      "Attendre 1 jour → si a déjà déposé : fin ; sinon : message",
    );
    expect(summarizeGraph({ version: 1, nodes: [], edges: [] })).toBe("Parcours vide");
  });
});

describe("évaluation des conditions", () => {
  it("chaque condition", () => {
    expect(evaluateCondition({ kind: "registered" }, ctx({ registered: true }))).toBe(true);
    expect(evaluateCondition({ kind: "registered" }, ctx())).toBe(false);
    expect(evaluateCondition({ kind: "deposited" }, ctx({ deposited: true }))).toBe(true);
    expect(evaluateCondition({ kind: "deposit_count_gte", n: 2 }, ctx({ depositCount: 2 }))).toBe(
      true,
    );
    expect(evaluateCondition({ kind: "deposit_count_gte", n: 2 }, ctx({ depositCount: 1 }))).toBe(
      false,
    );
    expect(
      evaluateCondition({ kind: "spend_level_in", levels: ["VIP"] }, ctx({ spendLevel: "VIP" })),
    ).toBe(true);
    expect(
      evaluateCondition({ kind: "spend_level_in", levels: ["VIP"] }, ctx({ spendLevel: null })),
    ).toBe(false);
    expect(evaluateCondition({ kind: "language_in", languages: ["fr"] }, ctx())).toBe(true);
    expect(
      evaluateCondition(
        { kind: "language_in", languages: ["pt-br"] },
        ctx({ languageCode: "pt-BR" }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition({ kind: "language_in", languages: ["en"] }, ctx({ languageCode: null })),
    ).toBe(false);
    expect(evaluateCondition({ kind: "has_tag", tag: "vip" }, ctx({ tags: ["vip"] }))).toBe(true);
    expect(evaluateCondition({ kind: "has_tag", tag: "vip" }, ctx({ tags: ["VIP"] }))).toBe(false);
    expect(
      evaluateCondition({ kind: "in_channel", channelId: "c1" }, ctx({ channelIds: ["c1"] })),
    ).toBe(true);
    expect(
      evaluateCondition({ kind: "clicked_offer_since_start" }, ctx({ offerClicksSinceStart: 1 })),
    ).toBe(true);
    expect(evaluateCondition({ kind: "clicked_offer_since_start" }, ctx())).toBe(false);
    expect(evaluateCondition({ kind: "inactive_days_gte", n: 7 }, ctx({ inactiveDays: 7 }))).toBe(
      true,
    );
    expect(
      evaluateCondition({ kind: "inactive_days_gte", n: 7 }, ctx({ inactiveDays: null })),
    ).toBe(false);
    expect(
      evaluateCondition(
        { kind: "campaign_in", campaignIds: ["k1", "k2"] },
        ctx({ campaignIds: ["k2"] }),
      ),
    ).toBe(true);
    expect(evaluateCondition({ kind: "campaign_in", campaignIds: ["k1"] }, ctx())).toBe(false);
  });

  it("contexte construit depuis la base : inscription, dépôts, canaux acceptés, étiquettes", () => {
    const c = graphContextFromData({
      players: [
        { registeredAt: null, ftdAt: new Date(), depositCount: 0, depositTotal: 20 },
        { registeredAt: new Date(), depositCount: 2, depositTotal: 30 },
      ],
      languageCode: "fr",
      tags: ["vip", 3, "x"],
      memberships: [
        { channelId: "c1", status: "APPROVED" },
        { channelId: "c2", status: "LEFT" },
        { channelId: "c1", status: "APPROVED" },
        { channelId: "c3", status: "REQUESTED" },
        // Ancienne adhésion acceptée, mais la plus récente est un départ : plus dans le canal.
        { channelId: "c2", status: "APPROVED" },
      ],
      campaignIds: ["k1", "k1"],
      inactiveDays: 3,
      offerClicksSinceStart: 0,
    });
    expect(c).toEqual({
      registered: true,
      deposited: true,
      depositCount: 2,
      spendLevel: "DEPOSANT",
      languageCode: "fr",
      tags: ["vip", "x"],
      channelIds: ["c1"],
      campaignIds: ["k1"],
      inactiveDays: 3,
      offerClicksSinceStart: 0,
    });
    const none = graphContextFromData({
      players: [],
      languageCode: null,
      tags: null,
      memberships: [],
      campaignIds: [],
      inactiveDays: null,
      offerClicksSinceStart: 0,
    });
    expect(none).toMatchObject({
      registered: false,
      deposited: false,
      depositCount: 0,
      spendLevel: "AUCUN",
      tags: [],
    });
    // Premier dépôt connu sans compteur : compte pour un dépôt (et donc inscrit).
    const ftdOnly = graphContextFromData({
      players: [{ registeredAt: null, ftdAt: new Date(), depositCount: 0, depositTotal: 0 }],
      languageCode: null,
      tags: [],
      memberships: [],
      campaignIds: [],
      inactiveDays: 0,
      offerClicksSinceStart: 0,
    });
    expect(ftdOnly).toMatchObject({ registered: true, deposited: true, depositCount: 1 });
    // Montant déposé connu sans compteur ni date de premier dépôt : même règle que le niveau
    // de dépense et le filtre « Ont déposé » (compteur > 0 ou montant > 0).
    const amountOnly = graphContextFromData({
      players: [{ registeredAt: null, ftdAt: null, depositCount: 0, depositTotal: 50 }],
      languageCode: null,
      tags: [],
      memberships: [],
      campaignIds: [],
      inactiveDays: 0,
      offerClicksSinceStart: 0,
    });
    expect(amountOnly).toMatchObject({
      registered: true,
      deposited: true,
      depositCount: 1,
      spendLevel: "DEPOSANT",
    });
    expect(evaluateCondition({ kind: "deposited" }, amountOnly)).toBe(true);
    expect(evaluateCondition({ kind: "deposit_count_gte", n: 2 }, amountOnly)).toBe(false);
    // Montant nul ou négatif (remboursement) sans compteur : pas de dépôt.
    const zero = graphContextFromData({
      players: [{ registeredAt: new Date(), ftdAt: null, depositCount: 0, depositTotal: 0 }],
      languageCode: null,
      tags: [],
      memberships: [],
      campaignIds: [],
      inactiveDays: 0,
      offerClicksSinceStart: 0,
    });
    expect(zero).toMatchObject({ registered: true, deposited: false, depositCount: 0 });
  });
});

describe("journal", () => {
  it("lit un journal brut et agrège par bloc", () => {
    expect(parseRunLog(null)).toEqual([]);
    expect(
      parseRunLog([{ step: 0, type: "tag", ok: true, at: "x" }, { nope: 1 }, null]),
    ).toHaveLength(1);
    const stats = nodeRunStats([
      {
        status: "DONE",
        nodeId: "m",
        log: [
          { step: 0, nodeId: "w", type: "wait", ok: true, at: "" },
          { step: 1, nodeId: "c", type: "condition", ok: true, at: "", branch: "no" },
          { step: 2, nodeId: "m", type: "send_message", ok: false, at: "", detail: "bot bloqué" },
        ],
      },
      {
        status: "PENDING",
        nodeId: "c",
        log: [{ step: 0, nodeId: "w", type: "wait", ok: true, at: "" }],
      },
      {
        status: "DONE",
        nodeId: "s",
        log: [{ step: 1, nodeId: "c", type: "condition", ok: true, at: "", branch: "yes" }],
      },
      { status: "DONE", nodeId: null, log: [{ step: 0, type: "tag", ok: true, at: "" }] },
    ]);
    expect(stats).toEqual({
      w: { reached: 2, failed: 0, yes: 0, no: 0, waiting: 0, lastError: null },
      c: { reached: 2, failed: 0, yes: 1, no: 1, waiting: 1, lastError: null },
      m: { reached: 1, failed: 1, yes: 0, no: 0, waiting: 0, lastError: "bot bloqué" },
    });
  });
});

describe("relances prêtes à l'emploi", () => {
  it("chaque carte produit un parcours valide", () => {
    for (const key of AUTOMATION_TEMPLATE_KEYS) {
      expect(isAutomationTemplateKey(key)).toBe(true);
      expect(AUTOMATION_TEMPLATE_DEFS[key].trigger).toBeTruthy();
      const v = validateGraph(templateGraph(key, { message: { text: "Bonjour {prenom}" } }));
      expect(v.issues).toEqual([]);
    }
    expect(isAutomationTemplateKey("autre")).toBe(false);
  });

  it("relance après un clic sans inscription : attendre 24 h puis « inscrit ? » non → message", () => {
    const g = templateGraph("offer_no_signup", { message: { text: "Toujours partant ?" } });
    expect(summarizeGraph(g)).toBe(
      "Attendre 1 jour → si inscrit chez un programme : arrêt ; sinon : message",
    );
    expect(graphToLinear(g)).toBeNull();
    expect(
      summarizeGraph(templateGraph("signup_no_deposit", { message: { text: "x" }, hours: 72 })),
    ).toBe("Attendre 3 jours → si a déjà déposé : arrêt ; sinon : message");
    expect(
      summarizeGraph(templateGraph("first_deposit_thanks", { message: { text: "Merci" } })),
    ).toBe("Si au moins 2 dépôts : arrêt ; sinon : message");
    expect(graphToLinear(templateGraph("welcome", { message: { text: "Bienvenue" } }))).toEqual([
      { type: "send_message", text: "Bienvenue" },
    ]);
    expect(
      graphToLinear(templateGraph("welcome", { message: { text: "Bienvenue" }, hours: 2 })),
    ).toEqual([
      { type: "wait", hours: 2 },
      { type: "send_message", text: "Bienvenue" },
    ]);
  });
});

describe("aide des blocs « action »", () => {
  it("mêmes mots que les pastilles d'insertion de l'éditeur (Prénom, Nom du canal, Nom du bot), sans accolades", () => {
    for (const help of Object.values(GRAPH_ACTION_HELP)) expect(help).not.toMatch(/[{}]/);
    expect(GRAPH_ACTION_HELP.send_message).toBe(
      "Le bot écrit au membre en privé. Prénom, nom du canal et nom du bot sont remplacés pour chaque membre. Un bouton Offre donne à chaque membre son identifiant de suivi.",
    );
  });
});
