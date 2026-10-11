import { describe, expect, it } from "vitest";
import { NAV, navTourId } from "../nav-logic";
import {
  TOUR_STEPS,
  applyCommand,
  isLastStep,
  keyCommand,
  pickAnchor,
  placeBubble,
  spotlightRect,
  SPOT_RING,
  stepLabel,
  tourSelector,
} from "./tour-logic";

describe("étapes de la visite guidée", () => {
  it("5 à 7 étapes : Accueil, Campagnes, Canaux, Messages, Membres, Statistiques, puis le « ? »", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(5);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(7);
    expect(TOUR_STEPS.map((s) => s.key)).toEqual([
      "home",
      "campaigns",
      "channels",
      "messages",
      "members",
      "stats",
      "help",
    ]);
  });

  it("chaque étape du menu vise un repère posé par le menu (nav-<clé>)", () => {
    const navIds = new Set([...NAV.map(navTourId), "nav-more"]);
    for (const step of TOUR_STEPS.filter((s) => s.key !== "help"))
      for (const a of step.anchors) expect(navIds.has(a), `${step.key} → ${a}`).toBe(true);
    expect(TOUR_STEPS.at(-1)!.anchors).toEqual(["help"]);
  });

  it("rubriques rangées sous « Plus » sur téléphone : repli sur nav-more avec une phrase", () => {
    for (const key of ["channels", "stats"]) {
      const step = TOUR_STEPS.find((s) => s.key === key)!;
      expect(step.anchors.at(-1)).toBe("nav-more");
      expect(step.fallbackNote).toMatch(/« Plus »/);
    }
  });

  it("textes courts, en français simple (une ou deux phrases)", () => {
    for (const s of TOUR_STEPS) {
      expect(s.body.length).toBeLessThanOrEqual(170);
      expect(s.body).not.toMatch(/\b(sub-ID|FTD|NGR|ROAS|webhook|postback|cohorte|entonnoir)\b/i);
    }
  });

  it("sélecteur et repère visible", () => {
    expect(tourSelector("nav-home")).toBe('[data-tour="nav-home"]');
    const visible = new Set(["nav-more"]);
    expect(pickAnchor(["nav-channels", "nav-more"], (a) => visible.has(a))).toEqual({
      anchor: "nav-more",
      fallback: true,
    });
    expect(pickAnchor(["nav-home"], () => true)).toEqual({ anchor: "nav-home", fallback: false });
    expect(pickAnchor(["x"], () => false)).toBeNull();
  });
});

describe("navigation dans la visite", () => {
  const n = TOUR_STEPS.length;

  it("libellé d'avancement et dernière étape", () => {
    expect(stepLabel(0, 7)).toBe("Étape 1 sur 7");
    expect(isLastStep(6, 7)).toBe(true);
    expect(isLastStep(5, 7)).toBe(false);
  });

  it("Suivant, Précédent, Passer, Terminer", () => {
    expect(applyCommand(0, n, "next")).toBe(1);
    expect(applyCommand(0, n, "prev")).toBe(0);
    expect(applyCommand(3, n, "prev")).toBe(2);
    expect(applyCommand(n - 1, n, "next")).toBeNull();
    expect(applyCommand(2, n, "skip")).toBeNull();
    expect(applyCommand(n - 1, n, "finish")).toBeNull();
  });

  it("clavier : Échap passe la visite, flèches pour avancer et reculer", () => {
    expect(keyCommand("Escape", 2, n)).toBe("skip");
    expect(keyCommand("ArrowRight", 0, n)).toBe("next");
    expect(keyCommand("ArrowRight", n - 1, n)).toBeNull();
    expect(keyCommand("ArrowLeft", 0, n)).toBeNull();
    expect(keyCommand("ArrowLeft", 1, n)).toBe("prev");
    expect(keyCommand("Enter", 1, n)).toBeNull();
  });
});

describe("placement de la bulle", () => {
  const bubble = { width: 320, height: 180 };
  const desktop = { width: 1440, height: 900 };
  const phone = { width: 390, height: 844 };

  it("sans repère : au centre", () => {
    expect(placeBubble(null, bubble, desktop)).toEqual({
      top: 360,
      left: 560,
      placement: "center",
    });
  });

  it("ordinateur : à droite de l'entrée du menu, centrée verticalement", () => {
    const entry = { top: 100, left: 12, width: 216, height: 36 };
    expect(placeBubble(entry, bubble, desktop)).toEqual({ top: 28, left: 240, placement: "right" });
  });

  it("ordinateur : le bouton « ? » en haut à droite → bulle en dessous, alignée à droite, dans l'écran", () => {
    const help = { top: 12, left: 1380, width: 32, height: 32 };
    const p = placeBubble(help, bubble, desktop);
    expect(p.placement).toBe("bottom");
    expect(p.top).toBe(56);
    expect(p.left + bubble.width).toBeLessThanOrEqual(desktop.width - 12);
  });

  it("ordinateur : un repère dans la moitié droite prend la bulle en dessous, même s'il reste de la place à droite", () => {
    const help = { top: 12, left: 1061, width: 32, height: 32 };
    const p = placeBubble(help, bubble, desktop);
    expect(p).toEqual({ top: 56, left: 773, placement: "bottom" });
  });

  it("téléphone : au-dessus de la barre du bas, pleine largeur", () => {
    const tab = { top: 788, left: 156, width: 78, height: 56 };
    const wide = { width: phone.width - 24, height: 200 };
    expect(placeBubble(tab, wide, phone)).toEqual({ top: 576, left: 12, placement: "top" });
  });

  it("téléphone : sous le bouton « ? » de l'en-tête", () => {
    const help = { top: 8, left: 290, width: 40, height: 40 };
    const wide = { width: phone.width - 24, height: 200 };
    expect(placeBubble(help, wide, phone)).toEqual({ top: 60, left: 12, placement: "bottom" });
  });

  it("toujours dans l'écran, même avec un repère au bord", () => {
    const corner = { top: 880, left: 1430, width: 10, height: 10 };
    const p = placeBubble(corner, bubble, desktop);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.left + bubble.width).toBeLessThanOrEqual(desktop.width - 12);
    expect(p.top + bubble.height).toBeLessThanOrEqual(desktop.height - 12);
  });

  it("zone mise en lumière : repère agrandi, gardée dans l'écran", () => {
    expect(spotlightRect({ top: 100, left: 12, width: 216, height: 36 }, desktop)).toEqual({
      top: 94,
      left: 6,
      width: 228,
      height: 48,
    });
  });

  it("téléphone : le cadre (tracé autour de la zone) reste entier dans l'écran et ne déborde pas sur l'onglet voisin", () => {
    // Barre du bas : 5 onglets de 78 px collés les uns aux autres, jusqu'au bas de l'écran.
    const outer = (r: { top: number; left: number; width: number; height: number }) => ({
      left: r.left - SPOT_RING,
      top: r.top - SPOT_RING,
      right: r.left + r.width + SPOT_RING,
      bottom: r.top + r.height + SPOT_RING,
    });
    const first = outer(spotlightRect({ top: 788, left: 0, width: 78, height: 56 }, phone));
    expect(first.left).toBeGreaterThanOrEqual(2);
    expect(first.bottom).toBeLessThanOrEqual(phone.height - 2);
    expect(first.right).toBeLessThanOrEqual(78);
    const last = outer(spotlightRect({ top: 788, left: 312, width: 78, height: 56 }, phone));
    expect(last.left).toBeGreaterThanOrEqual(312);
    expect(last.right).toBeLessThanOrEqual(phone.width - 2);
    expect(last.bottom).toBeLessThanOrEqual(phone.height - 2);
    // Repère au milieu de la barre : le cadre suit exactement ses bords, sans mordre sur les voisins.
    const middle = outer(spotlightRect({ top: 788, left: 156, width: 78, height: 56 }, phone));
    expect([middle.left, middle.right]).toEqual([156, 234]);
  });
});
