import { describe, expect, it } from "vitest";
import { templateGraph } from "@linkaffipro/core";
import { graphToDraft, moveNodes, removeNode } from "./flow";
import {
  draftFromView,
  fillHeight,
  measuredSizes,
  miniMapClass,
  nodeAriaLabel,
  readOnlyCanvasHeight,
  syncViewNodes,
  usedExits,
  viewEdges,
  type ViewEdge,
  type ViewNode,
} from "./flow-view";

const draft = () =>
  graphToDraft(templateGraph("offer_no_signup", { message: { text: "Bonjour" } }));

describe("canevas ↔ brouillon", () => {
  it("aller-retour sans perte", () => {
    const d = draft();
    const nodes = syncViewNodes<ViewNode>([], d);
    const edges = viewEdges<ViewEdge>([], d, new Set());
    expect(draftFromView(nodes, edges)).toEqual(d);
  });

  it("garde la taille mesurée et la sélection des blocs existants, retire les blocs supprimés", () => {
    const d = draft();
    const first = syncViewNodes<ViewNode>([], d).map((n) =>
      n.id === "check" ? { ...n, selected: true, measured: { width: 240, height: 96 } } : n,
    );
    const moved = moveNodes(removeNode(d, "stop"), { check: { x: 10, y: 20 } });
    const next = syncViewNodes(first, moved);
    const check = next.find((n) => n.id === "check")!;
    expect(check).toMatchObject({
      selected: true,
      measured: { width: 240, height: 96 },
      position: { x: 10, y: 20 },
    });
    expect(next.some((n) => n.id === "stop")).toBe(false);
    expect(next.find((n) => n.id === "trigger")!.deletable).toBe(false);
    expect(check.deletable).toBe(true);
  });

  it("liens : « Oui » / « Non », erreur surlignée, nom lisible, sélection gardée", () => {
    const d = draft();
    const prev = viewEdges<ViewEdge>([], d, new Set()).map((e) =>
      e.id === "e-no" ? { ...e, selected: true } : e,
    );
    const edges = viewEdges(prev, d, new Set(["e-yes"]));
    const yes = edges.find((e) => e.id === "e-yes")!;
    const no = edges.find((e) => e.id === "e-no")!;
    expect(yes).toMatchObject({ label: "Oui", className: "is-yes is-invalid", targetHandle: "in" });
    expect(no).toMatchObject({ label: "Non", selected: true });
    expect(no.ariaLabel).toBe(
      "Lien « Non » de la question « Inscrit chez un programme ? » vers le message « Bonjour »",
    );
    expect(edges.find((e) => e.id === "e-wait")!.ariaLabel).toBe(
      "Lien du départ vers l'attente de 1 jour",
    );
    expect(edges.find((e) => e.id === "e-wait")!.label).toBeUndefined();
  });

  it("une sortie inconnue venue du canevas devient « ensuite »", () => {
    const d = draftFromView(
      [{ id: "a", type: "trigger", position: { x: 0, y: 0 }, data: { payload: {} } }],
      [{ id: "e", source: "a", target: "b", sourceHandle: null }],
    );
    expect(d.edges[0]!.sourceHandle).toBe("next");
  });

  it("noms pour lecteurs d'écran, sorties occupées, mini-carte", () => {
    const d = draft();
    const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
    expect(nodeAriaLabel(byId.trigger!, {}, "A cliqué sur une offre")).toBe(
      "Départ : A cliqué sur une offre",
    );
    expect(nodeAriaLabel(byId.check!)).toBe("Condition : Inscrit chez un programme ?");
    expect(nodeAriaLabel(byId.wait!)).toBe("Attendre 1 jour");
    expect(nodeAriaLabel(byId.stop!)).toBe("Arrêter : fin de la relance");
    expect([...usedExits(d)].sort()).toEqual([
      "check:no",
      "check:yes",
      "trigger:next",
      "wait:next",
    ]);
    expect(miniMapClass("condition", false)).toBe("is-condition");
    expect(miniMapClass("condition", true)).toBe("is-invalid");
  });
});

describe("parcours en lecture seule (fiche d'une relance)", () => {
  it("hauteur qui suit la profondeur du parcours, bornée", () => {
    const d = draft(); // départ, attente, condition, puis arrêt et message : 4 étapes (0 à 480 px)
    expect(readOnlyCanvasHeight(d)).toBe(480 + 170 + 64);
    expect(readOnlyCanvasHeight({ nodes: [], edges: [] })).toBe(280);
    expect(readOnlyCanvasHeight({ nodes: d.nodes.slice(0, 1), edges: [] })).toBe(280);
    const deep = moveNodes(d, { message: { x: 0, y: 2000 } });
    expect(readOnlyCanvasHeight(deep)).toBe(820);
  });

  it("tailles mesurées par le canevas", () => {
    const nodes = syncViewNodes<ViewNode>([], draft()).map((n) =>
      n.id === "check" ? { ...n, measured: { width: 240, height: 96 } } : n,
    );
    expect(measuredSizes(nodes).check).toEqual({ width: 240, height: 96 });
    expect(measuredSizes(nodes).wait).toBeUndefined();
  });
});

describe("hauteur du canevas de l'éditeur", () => {
  it("remplit l'écran sous l'en-tête, avec un minimum et un maximum", () => {
    expect(fillHeight(900, 322)).toBe(554); // 1440 × 900 : le bas du canevas reste à l'écran
    expect(fillHeight(700, 322)).toBe(480);
    expect(fillHeight(2000, 100)).toBe(960);
    expect(fillHeight(900, 322, { bottom: 0, min: 300 })).toBe(578);
  });
});
