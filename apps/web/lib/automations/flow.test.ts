import { describe, expect, it } from "vitest";
import { linearToGraph, parseGraph, templateGraph, validateGraph } from "@linkaffipro/core";
import {
  PALETTE,
  addNode,
  canConnect,
  canInsertAfter,
  connectExit,
  defaultInsertExit,
  disconnectExit,
  draftNodeLabel,
  draftToRaw,
  exitsOf,
  graphToDraft,
  insertAfter,
  isSimpleChain,
  layoutDraft,
  moveNodes,
  newNodeData,
  outlineDraft,
  overlappingNodes,
  paletteNodeType,
  placeClear,
  rawToDraft,
  removeEdge,
  removeNode,
  ruleToDraft,
  updateNodeData,
  validateEditor,
  draftNodePhrase,
  type Draft,
} from "./flow";

const ID_FORMAT = /^n-[a-z0-9]{8}$/;

const message = { text: "Bonjour {prenom}" };
const rule = { name: "Ma relance", trigger: "JOINED", conditions: {} };

/** Départ → message. */
function simple(): Draft {
  return graphToDraft(linearToGraph([{ type: "send_message", ...message }]));
}

describe("éditeur : conversions", () => {
  it("parcours enregistré → brouillon → JSON : relu à l'identique par le core", () => {
    for (const g of [
      templateGraph("offer_no_signup", { message }),
      templateGraph("welcome", { message, hours: 3 }),
      linearToGraph([
        { type: "wait", hours: 24 },
        { type: "send_message", ...message },
        { type: "tag", tag: "relancé" },
      ]),
    ]) {
      expect(parseGraph(draftToRaw(graphToDraft(g)))).toEqual(parseGraph(g));
    }
  });

  it("bibliothèque : chaque bloc neuf a un type et des données (incomplètes sauf attendre et arrêter)", () => {
    expect(PALETTE.map((p) => p.key)).toEqual([
      "condition",
      "send_message",
      "wait",
      "tag",
      "suggest_channel",
      "notify_team",
      "send_sequence",
      "stop",
    ]);
    expect(paletteNodeType("tag")).toBe("action");
    expect(paletteNodeType("wait")).toBe("wait");
    expect(newNodeData("wait")).toEqual({ hours: 24 });
    expect(newNodeData("send_message")).toEqual({ action: { type: "send_message", text: "" } });
  });
});

describe("éditeur : ouverture d'une relance enregistrée", () => {
  it("relance à liste : branche unique ; parcours : tel quel", () => {
    const linear = ruleToDraft({
      graph: null,
      actions: [
        { type: "wait", hours: 24 },
        { type: "send_message", text: "Salut" },
      ],
    });
    expect(linear.readError).toBeNull();
    expect(linear.draft.nodes.map((n) => n.type)).toEqual(["trigger", "wait", "action"]);
    const g = templateGraph("vip", { message });
    expect(ruleToDraft({ graph: g, actions: [] }).draft).toEqual(graphToDraft(parseGraph(g)));
  });

  it("données illisibles : reprises au mieux, avec la raison", () => {
    const broken = ruleToDraft({
      graph: {
        nodes: [
          { id: "a", type: "action", data: { action: { type: "tag", tag: "" } } },
          { id: "a", type: "stop" },
          { id: "x", type: "??" },
          null,
        ],
        edges: [{ id: "e", source: "a", target: "zz" }],
      },
      actions: [],
    });
    expect(broken.readError).toMatch(/Relance à corriger/);
    expect(broken.draft.nodes.map((n) => [n.id, n.type])).toEqual([
      ["trigger", "trigger"],
      ["a", "action"],
    ]);
    expect(broken.draft.edges).toEqual([]);
    const badList = ruleToDraft({
      graph: null,
      actions: [{ type: "send_message" }, { type: "wait", hours: "x" }],
    });
    expect(badList.readError).toMatch(/texte/);
    expect(badList.draft.nodes.map((n) => n.type)).toEqual(["trigger", "action", "wait"]);
    expect(badList.draft.edges).toHaveLength(2);
    expect(rawToDraft("n'importe quoi").nodes.map((n) => n.type)).toEqual(["trigger"]);
  });
});

describe("éditeur : opérations", () => {
  it("ajoute un bloc non relié : il est signalé jusqu'à ce qu'on le relie", () => {
    const { draft, id } = addNode(simple(), "tag", { x: 300, y: 300 });
    expect(id).toMatch(ID_FORMAT);
    const v = validateEditor(draft, rule);
    expect(v.ok).toBe(false);
    expect(v.byNode[id]?.map((i) => i.code)).toEqual(
      expect.arrayContaining(["unreachable", "incomplete"]),
    );
  });

  it("insère après un bloc : le nouveau bloc s'intercale et la suite descend d'un cran", () => {
    const d = simple(); // trigger → n1
    const r = insertAfter(d, "trigger", "next", "wait")!;
    expect(r.id).toMatch(ID_FORMAT);
    expect(exitsOf(r.draft, "trigger")).toEqual([{ handle: "next", target: r.id }]);
    expect(exitsOf(r.draft, r.id)).toEqual([{ handle: "next", target: "n1" }]);
    expect(r.draft.nodes.find((n) => n.id === r.id)!.position).toEqual({ x: 0, y: 160 });
    const n1 = r.draft.nodes.find((n) => n.id === "n1")!;
    expect(n1.position.y).toBe(320);
    const v = validateEditor(r.draft, rule);
    expect(v.ok).toBe(true);
    expect(isSimpleChain(v.graph)).toBe(true);
  });

  it("insère une condition : l'ancienne suite passe par « oui », « non » reste libre", () => {
    const r = insertAfter(simple(), "trigger", "next", "condition")!;
    expect(exitsOf(r.draft, r.id)).toEqual([
      { handle: "yes", target: "n1" },
      { handle: "no", target: null },
    ]);
    const filled = updateNodeData(r.draft, r.id, { condition: { kind: "deposited" } });
    const v = validateEditor(filled, rule);
    expect(v.ok).toBe(true);
    expect(isSimpleChain(v.graph)).toBe(false);
  });

  it("« Ajouter » au clavier : première sortie libre, sinon la suite (le bloc s'intercale)", () => {
    const d = graphToDraft(templateGraph("offer_no_signup", { message }));
    expect(defaultInsertExit(d, "message")).toBe("next");
    expect(defaultInsertExit(d, "check")).toBe("yes");
    expect(defaultInsertExit(disconnectExit(d, "check", "no"), "check")).toBe("no");
    expect(defaultInsertExit(d, "stop")).toBeNull();
    expect(defaultInsertExit(d, null)).toBeNull();
  });

  it("« Arrêter » seulement sur une sortie libre", () => {
    const d = simple();
    expect(canInsertAfter(d, "trigger", "next", "stop")).toBe(false);
    expect(insertAfter(d, "trigger", "next", "stop")).toBeNull();
    const r = insertAfter(d, "n1", "next", "stop")!;
    expect(exitsOf(r.draft, r.id)).toEqual([]);
    expect(validateEditor(r.draft, rule).ok).toBe(true);
  });

  it("relie et délie une sortie (une seule suite par sortie)", () => {
    const g = templateGraph("offer_no_signup", { message }); // trigger → wait → check (oui → stop, non → message)
    let d = graphToDraft(g);
    d = connectExit(d, "check", "yes", "message");
    expect(exitsOf(d, "check")).toEqual([
      { handle: "yes", target: "message" },
      { handle: "no", target: "message" },
    ]);
    expect(d.edges.filter((e) => e.source === "check")).toHaveLength(2);
    d = disconnectExit(d, "check", "no");
    expect(exitsOf(d, "check")).toEqual([
      { handle: "yes", target: "message" },
      { handle: "no", target: null },
    ]);
    const stopEdge = graphToDraft(g).edges.find((e) => e.target === "stop")!;
    expect(removeEdge(graphToDraft(g), stopEdge.id).edges).toHaveLength(g.edges.length - 1);
  });

  it("refuse les liens impossibles : boucle, vers le départ, vers lui-même, depuis « arrêter », sortie inconnue", () => {
    const d = graphToDraft(templateGraph("offer_no_signup", { message }));
    expect(canConnect(d, "message", "next", "wait")).toBe(false); // boucle
    expect(canConnect(d, "message", "next", "trigger")).toBe(false);
    expect(canConnect(d, "message", "next", "message")).toBe(false);
    expect(canConnect(d, "stop", "next", "message")).toBe(false);
    expect(canConnect(d, "wait", "yes", "message")).toBe(false);
    expect(canConnect(d, "trigger", "next", "message")).toBe(true);
    expect(connectExit(d, "message", "next", "wait")).toBe(d);
  });

  it("supprime un bloc : une action est recousue, une condition emporte ses sorties, le départ reste", () => {
    const chain = graphToDraft(
      linearToGraph([
        { type: "wait", hours: 2 },
        { type: "send_message", ...message },
      ]),
    );
    const without = removeNode(chain, "n1");
    expect(exitsOf(without, "trigger")).toEqual([{ handle: "next", target: "n2" }]);
    expect(validateEditor(without, rule).ok).toBe(true);

    const branched = graphToDraft(templateGraph("offer_no_signup", { message }));
    const noCheck = removeNode(branched, "check");
    expect(noCheck.edges.some((e) => e.source === "check" || e.target === "check")).toBe(false);
    expect(validateEditor(noCheck, rule).byNode.stop?.[0]?.code).toBe("unreachable");

    expect(removeNode(branched, "trigger")).toBe(branched);
  });

  it("range les blocs : une ligne par étape, « oui » à gauche, « non » à droite", () => {
    const d = layoutDraft(graphToDraft(templateGraph("signup_no_deposit", { message })));
    const pos = Object.fromEntries(d.nodes.map((n) => [n.id, n.position]));
    expect(pos.trigger).toEqual({ x: 0, y: 0 });
    expect(pos.wait!.y).toBe(160);
    expect(pos.check!.y).toBe(320);
    expect(pos.stop!.y).toBe(480);
    expect(pos.message!.y).toBe(480);
    expect(pos.stop!.x).toBeLessThan(pos.message!.x);
    expect(pos.wait!.x).toBe(0);
    // Un bloc non relié va en bas.
    const added = addNode(d, "tag", { x: 999, y: -50 });
    const loose = layoutDraft(added.draft);
    expect(loose.nodes.find((n) => n.id === added.id)!.position.y).toBeGreaterThan(480);
  });
});

describe("éditeur : un bloc ajouté ne se pose jamais sur un autre", () => {
  /** Départ → attendre → condition ; « oui » libre, « non » → le message resté sous la condition. */
  function conditionWithMessageOnNo(): { d: Draft; cond: string } {
    let d = simple(); // trigger → n1 (message)
    const wait = insertAfter(d, "trigger", "next", "wait")!;
    const cond = insertAfter(wait.draft, wait.id, "next", "condition")!;
    d = updateNodeData(cond.draft, cond.id, { condition: { kind: "deposited" } });
    d = connectExit(d, cond.id, "no", "n1");
    d = disconnectExit(d, cond.id, "yes");
    return { d, cond: cond.id };
  }

  it("« Arrêter » sur la sortie « oui » libre : poussé à gauche du message de la sortie « non »", () => {
    const { d, cond } = conditionWithMessageOnNo();
    const msg = d.nodes.find((n) => n.id === "n1")!;
    const condNode = d.nodes.find((n) => n.id === cond)!;
    expect(msg.position.x).toBe(condNode.position.x); // le message est resté sous la condition
    expect(overlappingNodes(d)).toEqual([]);
    const r = insertAfter(d, cond, "yes", "stop")!;
    expect(overlappingNodes(r.draft)).toEqual([]);
    const stop = r.draft.nodes.find((n) => n.id === r.id)!;
    expect(stop.position.y).toBe(msg.position.y);
    expect(stop.position.x).toBeLessThan(msg.position.x);
    expect(exitsOf(r.draft, cond)).toEqual([
      { handle: "yes", target: r.id },
      { handle: "no", target: "n1" },
    ]);
  });

  it("sortie « non » libre, « oui » occupée sous la condition : poussé à droite", () => {
    const start = conditionWithMessageOnNo();
    const cond = start.cond;
    const d = connectExit(disconnectExit(start.d, cond, "no"), cond, "yes", "n1");
    const r = insertAfter(d, cond, "no", "tag")!;
    expect(overlappingNodes(r.draft)).toEqual([]);
    const tag = r.draft.nodes.find((n) => n.id === r.id)!;
    expect(tag.position.x).toBeGreaterThan(r.draft.nodes.find((n) => n.id === "n1")!.position.x);
  });

  it("tient compte des tailles mesurées et ne bouge pas un bloc déjà libre", () => {
    const d: Draft = {
      nodes: [
        { id: "a", type: "trigger", position: { x: 0, y: 0 }, data: {} },
        { id: "b", type: "stop", position: { x: 100, y: 20 }, data: {} },
      ],
      edges: [],
    };
    const right = placeClear(d, "b", 1, { a: { width: 400, height: 90 } });
    expect(right.nodes.find((n) => n.id === "b")!.position).toEqual({ x: 424, y: 20 });
    const left = placeClear(d, "b", -1);
    expect(left.nodes.find((n) => n.id === "b")!.position.x).toBe(-264);
    const free = moveNodes(d, { b: { x: 0, y: 400 } });
    expect(placeClear(free, "b", 1)).toBe(free);
    // Un bloc très haut ne pousse pas de côté le bloc de l'étape suivante (160 px plus bas).
    const chain = moveNodes(d, { b: { x: 0, y: 160 } });
    expect(placeClear(chain, "b", 1, { a: { width: 240, height: 220 } })).toBe(chain);
  });

  it("bloc posé depuis la bibliothèque sur un autre : poussé à droite", () => {
    const { draft, id } = addNode(simple(), "tag", { x: 10, y: 150 });
    expect(overlappingNodes(draft)).toEqual([]);
    expect(draft.nodes.find((n) => n.id === id)!.position.y).toBe(150);
  });
});

describe("éditeur : identifiants jamais réattribués", () => {
  it("un bloc supprimé ne prête jamais son identifiant au bloc ajouté ensuite", () => {
    // Départ → attendre → relance J+1 → attendre → relance J+3 (n1 … n4) ; un membre attend au bloc n4.
    let d = graphToDraft(
      linearToGraph([
        { type: "wait", hours: 24 },
        { type: "send_message", text: "Relance J+1" },
        { type: "wait", hours: 48 },
        { type: "send_message", text: "Relance J+3" },
      ]),
    );
    const seen = new Set([...d.nodes.map((n) => n.id), ...d.edges.map((e) => e.id)]);
    d = removeNode(d, "n4");
    for (let i = 0; i < 30; i++) {
      const r = insertAfter(d, "trigger", "next", "send_message")!;
      expect(seen.has(r.id)).toBe(false);
      for (const e of r.draft.edges.filter((x) => !d.edges.some((y) => y.id === x.id)))
        expect(seen.has(e.id)).toBe(false);
      for (const x of [...r.draft.nodes.map((n) => n.id), ...r.draft.edges.map((e) => e.id)])
        seen.add(x);
      d = removeNode(r.draft, r.id);
    }
    // Le parcours enregistré n'a plus de bloc « n4 » : le moteur arrête l'exécution en attente (« Bloc introuvable »).
    expect(insertAfter(d, "trigger", "next", "tag")!.draft.nodes.some((n) => n.id === "n4")).toBe(
      false,
    );
  });

  it("les identifiants neufs passent la validation du core", () => {
    const r = insertAfter(simple(), "n1", "next", "wait")!;
    const v = validateGraph(draftToRaw(r.draft));
    expect(v.ok).toBe(true);
  });
});

describe("éditeur : liste accessible et libellés", () => {
  it("liste le parcours de haut en bas, branches indentées, blocs non reliés à la fin", () => {
    const { draft: d, id: loose } = addNode(
      graphToDraft(templateGraph("offer_no_signup", { message })),
      "tag",
      { x: 0, y: 0 },
    );
    const items = outlineDraft(d);
    expect(items.map((i) => [i.id, i.depth, i.via, i.detached])).toEqual([
      ["trigger", 0, null, false],
      ["wait", 0, null, false],
      ["check", 0, null, false],
      ["stop", 1, "yes", false],
      ["message", 1, "no", false],
      [loose, 0, null, true],
    ]);
    expect(items[2]!.label).toBe("Inscrit chez un programme ?");
    expect(items[5]!.label).toBe("Étiqueter le membre (à compléter)");
  });

  it("deux branches qui se rejoignent : le bloc commun n'est détaillé qu'une fois", () => {
    const d = connectExit(
      graphToDraft(templateGraph("offer_no_signup", { message })),
      "check",
      "yes",
      "message",
    );
    const withoutStop = removeNode(d, "stop");
    const items = outlineDraft(withoutStop);
    expect(items.filter((i) => i.id === "message").map((i) => i.repeat)).toEqual([false, true]);
    expect(items.find((i) => i.id === "message" && i.repeat)!.phrase).toBe(
      "le message « Bonjour Léa »",
    );
  });

  it("libellés et phrases : mots d'exemple à la place des variables, un seul niveau de guillemets", () => {
    const d = simple();
    const msg = d.nodes.find((n) => n.id === "n1")!;
    expect(draftNodeLabel(msg)).toBe("Message : Bonjour Léa");
    expect(draftNodePhrase(msg)).toBe("le message « Bonjour Léa »");
    expect(draftNodePhrase(d.nodes.find((n) => n.id === "trigger")!)).toBe("le départ");
    const incomplete = addNode(d, "condition", { x: 0, y: 900 });
    expect(draftNodePhrase(incomplete.draft.nodes.find((n) => n.id === incomplete.id)!)).toBe(
      "le bloc « Condition à compléter »",
    );
    expect(
      draftNodePhrase({ id: "w", type: "wait", position: { x: 0, y: 0 }, data: { hours: 6 } }),
    ).toBe("l'attente de 6 h");
  });

  it("libellés d'un bloc incomplet", () => {
    expect(
      draftNodeLabel({
        id: "x",
        type: "condition",
        position: { x: 0, y: 0 },
        data: { condition: { kind: "" } },
      }),
    ).toBe("Condition à compléter");
    expect(
      draftNodeLabel({ id: "x", type: "wait", position: { x: 0, y: 0 }, data: { hours: null } }),
    ).toBe("Attendre (durée à choisir)");
    expect(
      draftNodeLabel({ id: "x", type: "wait", position: { x: 0, y: 0 }, data: { hours: 48 } }),
    ).toBe("Attendre 2 jours");
  });
});

describe("éditeur : validation en direct", () => {
  it("un parcours de carte est valide", () => {
    const v = validateEditor(
      graphToDraft(templateGraph("first_deposit_thanks", { message })),
      rule,
    );
    expect(v.ok).toBe(true);
    expect(v.graph).not.toBeNull();
    expect(validateGraph(v.graph).ok).toBe(true);
  });

  it("signale le texte mal formé, le nom manquant et les jours d'inactivité du départ", () => {
    const d = updateNodeData(simple(), "n1", { action: { type: "send_message", text: "<b>gras" } });
    const v = validateEditor(d, { name: "x", trigger: "INACTIVE", conditions: {} });
    expect(v.ok).toBe(false);
    expect(v.byNode.n1?.[0]?.message).toMatch(/Mise en forme/);
    expect(v.byNode["*"]?.[0]?.message).toMatch(/nom/);
    expect(v.byNode.trigger?.[0]?.message).toMatch(/jours sans activité/);
    const fixed = validateEditor(d, {
      name: "Relance",
      trigger: "INACTIVE",
      conditions: { inactiveDays: 7 },
    });
    expect(fixed.byNode.trigger).toBeUndefined();
  });

  it("bouton incomplet : signalé sur le bloc, avec la ligne fautive, et l'enregistrement est bloqué", () => {
    const withButtons = (buttons: unknown) =>
      validateEditor(
        updateNodeData(simple(), "n1", {
          action: { type: "send_message", text: "Salut", buttons },
        }),
        rule,
      );
    const noUrl = withButtons([[{ text: "Voir l'offre", url: "exemple.fr" }]]);
    expect(noUrl.ok).toBe(false);
    expect(noUrl.byNode.n1?.map((i) => i.message)).toEqual([
      "Bouton « Voir l'offre » : écrivez son adresse complète (elle commence par https://).",
    ]);
    const noLabel = withButtons([[{ text: " ", url: "https://x.y" }]]);
    expect(noLabel.ok).toBe(false);
    expect(noLabel.byNode.n1?.[0]?.message).toBe("Bouton 1 : écrivez son libellé.");
    expect(withButtons([[{ text: "Voir", url: "https://x.y" }]]).ok).toBe(true);
  });

  it("bouton « Offre (campagne) » : valable avec sa campagne, signalé sans campagne", () => {
    const withButtons = (buttons: unknown) =>
      validateEditor(
        updateNodeData(simple(), "n1", {
          action: { type: "send_message", text: "Salut", buttons },
        }),
        rule,
      );
    const offer = {
      text: "Voir l'offre",
      type: "OFFER",
      campaignId: "c1",
      affiliateCampaignId: "a1",
    };
    const ok = withButtons([[offer], [{ text: "Aide", url: "https://x.y" }]]);
    expect(ok.ok).toBe(true);
    expect(ok.graph?.nodes.find((n) => n.id === "n1")).toMatchObject({
      action: { buttons: [[offer], [{ text: "Aide", url: "https://x.y" }]] },
    });
    const noCampaign = withButtons([[{ ...offer, campaignId: "" }]]);
    expect(noCampaign.ok).toBe(false);
    expect(noCampaign.byNode.n1?.map((i) => i.message)).toEqual([
      "Bouton « Voir l'offre » : choisissez la campagne de l'offre.",
    ]);
  });

  it("filtres du départ illisibles : signalés sur le départ", () => {
    const v = validateEditor(simple(), { ...rule, conditions: { spendLevels: ["???"] } });
    expect(v.byNode.trigger?.[0]?.message).toMatch(/Niveau de dépense inconnu/);
  });

  it("liens en erreur : repérés pour être surlignés", () => {
    const d = simple();
    d.edges.push({ id: "bad", source: "n1", sourceHandle: "next", target: "nope" });
    expect(validateEditor(d, rule).edgeIds.has("bad")).toBe(true);
  });

  it("une attente sans suite est un simple avertissement", () => {
    const r = insertAfter(simple(), "n1", "next", "wait")!;
    const v = validateEditor(r.draft, rule);
    expect(v.ok).toBe(true);
    expect(v.warnings.map((w) => w.code)).toEqual(["wait_without_exit"]);
  });
});
