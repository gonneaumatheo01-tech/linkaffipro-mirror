import { describe, expect, it } from "vitest";
import { templateGraph } from "@linkaffipro/core";
import { graphToDraft, moveNodes, removeNode } from "./flow";
import {
  draftFromView,
  fillHeight,
  measuredSizes,
  MINIMAP_LARGE,
  MINIMAP_SMALL,
  miniMapClass,
  minimapBox,
  minimapNeeded,
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

describe("mini-carte : seulement pour un parcours qui ne tient pas à l'écran", () => {
  const block = (x: number, y: number) => ({ x, y, width: 240, height: 90 });
  const canvas = { width: 540, height: 560 };

  it("parcours de 3 blocs qui tient à l'échelle 1 (marges comprises) : pas de mini-carte", () => {
    expect(minimapNeeded([block(0, 0), block(0, 160), block(0, 320)], canvas)).toBe(false);
  });

  it("parcours trop haut ou trop large pour l'écran : mini-carte", () => {
    const tall = Array.from({ length: 6 }, (_, i) => block(0, i * 160));
    expect(minimapNeeded(tall, canvas)).toBe(true);
    expect(minimapNeeded([block(-220, 0), block(220, 0)], canvas)).toBe(true);
  });

  it("rien de mesuré (premier affichage) ou canevas sans taille : pas de mini-carte", () => {
    expect(minimapNeeded([], canvas)).toBe(false);
    expect(minimapNeeded([block(0, 0)], { width: 0, height: 0 })).toBe(false);
  });

  it("couleurs du thème par type de bloc ; rouge seulement pour un bloc à corriger", () => {
    expect(
      ["trigger", "condition", "action", "wait", "stop"].map((t) =>
        miniMapClass(t as never, false),
      ),
    ).toEqual(["is-trigger", "is-condition", "is-action", "is-wait", "is-stop"]);
    expect(miniMapClass("action", true)).toBe("is-invalid");
  });

  it("taille de la mini-carte : forme du parcours (en hauteur pour un parcours vertical), bornée", () => {
    // 11 blocs l'un sous l'autre (cas relevé à la relecture : rectangles de 10 × 3 px dans un cadre de 120 × 80).
    const column = Array.from({ length: 11 }, (_, i) => block(0, i * 200));
    expect(minimapBox(column, MINIMAP_LARGE)).toEqual({ width: 96, height: 168 });
    expect(minimapBox(column, MINIMAP_SMALL)).toEqual({ width: 96, height: 144 });
    // Parcours large (branches côte à côte) : cadre en largeur, jamais plus bas que 72 px.
    const row = Array.from({ length: 6 }, (_, i) => block(i * 300, 0));
    expect(minimapBox(row, MINIMAP_LARGE)).toEqual({ width: 140, height: 72 });
    // Presque carré : la largeur maximale, la hauteur suit.
    expect(minimapBox([block(0, 0), block(400, 400)], MINIMAP_LARGE)).toEqual({
      width: 140,
      height: 107,
    });
    expect(minimapBox([], MINIMAP_LARGE)).toBeNull();
    // Le cadre reste dans les bornes, quelle que soit la forme.
    for (const box of [minimapBox(column, MINIMAP_SMALL), minimapBox(row, MINIMAP_SMALL)]) {
      expect(box!.width).toBeLessThanOrEqual(MINIMAP_SMALL.width);
      expect(box!.height).toBeLessThanOrEqual(MINIMAP_SMALL.height);
    }
  });
});
