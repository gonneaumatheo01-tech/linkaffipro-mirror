import { describe, expect, it } from "vitest";
import { watchAdded, watchOpen, watchPoll } from "./watch";

describe("surveillance de la fenêtre « Ajouter un canal existant »", () => {
  it("un nouveau canal arrivé pendant la surveillance : un bandeau « détecté »", () => {
    const s0 = watchOpen("ancien");
    const { state, changed } = watchPoll(s0, { id: "nouveau", title: "VIP" });
    expect(changed).toBe(true);
    expect(state.detected).toEqual([{ id: "nouveau", title: "VIP" }]);
    // Le même canal au tour suivant : rien de plus.
    const again = watchPoll(state, { id: "nouveau", title: "VIP" });
    expect(again.changed).toBe(false);
    expect(again.state.detected).toHaveLength(1);
  });

  it("canal ajouté par la méthode 2 puis vu par la surveillance : un seul bandeau (celui de la méthode 2)", () => {
    const added = watchAdded(watchOpen("ancien"), "c_new");
    const { state } = watchPoll(added, { id: "c_new", title: "Mon canal" });
    expect(state.detected).toEqual([]);
  });

  it("surveillance plus rapide que la réponse de la méthode 2 : le bandeau « détecté » est retiré à l'arrivée de la réponse", () => {
    const polled = watchPoll(watchOpen("ancien"), { id: "c_new", title: "Mon canal" }).state;
    expect(polled.detected).toHaveLength(1);
    expect(watchAdded(polled, "c_new").detected).toEqual([]);
  });

  it("canal déjà connu ajouté par la méthode 2 : le dernier canal reste la référence (pas de faux « détecté »)", () => {
    const s = watchAdded(watchOpen("dernier"), "vieux_canal");
    expect(watchPoll(s, { id: "dernier", title: "Dernier" }).state.detected).toEqual([]);
  });

  it("réouverture : tout repart de zéro, calé sur le dernier canal connu", () => {
    expect(watchOpen("x")).toEqual({ seen: "x", acknowledged: [], detected: [] });
    expect(watchOpen(null).seen).toBeNull();
  });
});
