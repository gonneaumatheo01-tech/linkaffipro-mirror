import { describe, expect, it } from "vitest";
import { linearToGraph, templateGraph } from "@linkaffipro/core";
import { pendingStepRemap, readEditorRule, storageFor, templateKeyAfterEdit } from "./rule-input";

const message = { text: "Bonjour {prenom}" };

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

const valid = {
  name: "Relance sur mesure",
  trigger: "OFFER_CLICKED",
  conditions: JSON.stringify({ channelIds: ["c1"] }),
  graph: JSON.stringify(templateGraph("offer_no_signup", { message })),
  oncePerMember: "on",
};

describe("lecture serveur d'une relance de l'éditeur", () => {
  it("lit nom, déclencheur, filtres, parcours et carte d'origine", () => {
    const r = readEditorRule(fd({ ...valid, templateKey: "offer_no_signup" }));
    expect(r.name).toBe("Relance sur mesure");
    expect(r.trigger).toBe("OFFER_CLICKED");
    expect(r.conditions).toEqual({ channelIds: ["c1"] });
    expect(r.oncePerMember).toBe(true);
    expect(r.graph.nodes).toHaveLength(5);
    expect(r.templateKey).toBe("offer_no_signup");
    expect(readEditorRule(fd({ ...valid, oncePerMember: "", templateKey: "???" }))).toMatchObject({
      oncePerMember: false,
      templateKey: null,
    });
  });

  it("refuse un parcours invalide avec la raison en français", () => {
    const broken = templateGraph("offer_no_signup", { message });
    broken.edges = broken.edges.filter((e) => e.id !== "e-check");
    expect(() => readEditorRule(fd({ ...valid, graph: JSON.stringify(broken) }))).toThrow(
      /Relance à corriger : .*n'est relié à rien/,
    );
    const empty = { version: 1, nodes: [{ id: "trigger", type: "trigger" }], edges: [] };
    expect(() => readEditorRule(fd({ ...valid, graph: JSON.stringify(empty) }))).toThrow(
      /Reliez le départ/,
    );
    expect(() => readEditorRule(fd({ ...valid, graph: "{oops" }))).toThrow(/illisible/);
    expect(() => readEditorRule(fd({ ...valid, graph: "" }))).toThrow(/vide/);
  });

  it("refuse nom, déclencheur, filtres et textes invalides", () => {
    expect(() => readEditorRule(fd({ ...valid, name: "x" }))).toThrow(/nom/);
    expect(() => readEditorRule(fd({ ...valid, trigger: "NOPE" }))).toThrow(/ce qui lance/);
    expect(() => readEditorRule(fd({ ...valid, trigger: "INACTIVE", conditions: "{}" }))).toThrow(
      /jours/,
    );
    expect(() =>
      readEditorRule(fd({ ...valid, conditions: JSON.stringify({ spendLevels: ["???"] }) })),
    ).toThrow(/Niveau de dépense inconnu/);
    const badHtml = templateGraph("offer_no_signup", { message: { text: "<b>oups" } });
    expect(() => readEditorRule(fd({ ...valid, graph: JSON.stringify(badHtml) }))).toThrow(
      /Texte à corriger/,
    );
  });
});

describe("forme enregistrée", () => {
  const chain = linearToGraph([
    { type: "wait", hours: 24 },
    { type: "send_message", ...message },
  ]);
  const branched = templateGraph("signup_no_deposit", { message });

  it("une relance à liste qui reste une chaîne reste une liste (attentes en cours préservées)", () => {
    expect(storageFor(chain, { graph: null })).toEqual({
      graph: null,
      actions: [
        { type: "wait", hours: 24 },
        { type: "send_message", text: "Bonjour {prenom}" },
      ],
    });
  });

  it("nouvelle relance ou relance déjà à branches : le parcours est gardé, avec la liste équivalente si c'est une chaîne", () => {
    const fresh = storageFor(chain, null);
    expect(fresh.graph).toBe(chain);
    expect(fresh.actions.map((a) => a.type)).toEqual(["wait", "send_message"]);
    expect(storageFor(chain, { graph: chain }).graph).toBe(chain);
    expect(storageFor(branched, { graph: null })).toEqual({ graph: branched, actions: [] });
  });

  it("carte d'origine gardée seulement si la relance en a encore la forme", () => {
    const saved = { trigger: "REGISTERED", conditions: {}, actions: [], graph: branched };
    expect(templateKeyAfterEdit("signup_no_deposit", saved)).toBe("signup_no_deposit");
    expect(templateKeyAfterEdit("signup_no_deposit", { ...saved, trigger: "JOINED" })).toBeNull();
    expect(templateKeyAfterEdit(null, saved)).toBeNull();
    expect(templateKeyAfterEdit("welcome", { ...saved, trigger: "JOINED", graph: chain })).toBe(
      "welcome",
    );
  });
});

describe("membres en attente d'une relance à liste qui perd son attente", () => {
  const wait = { type: "wait" as const, hours: 24 };
  const msg = { type: "send_message" as const, text: "Bienvenue" };

  it("« 1 jour » → « tout de suite » : ceux qui attendaient le message le reçoivent à l'heure prévue", () => {
    expect(pendingStepRemap([wait, msg], [{ ...msg, text: "Bienvenue !" }])).toEqual({
      from: 1,
      to: 0,
    });
    expect(
      pendingStepRemap(
        [msg, wait, { type: "tag", tag: "relancé" }],
        [msg, { type: "tag", tag: "x" }],
      ),
    ).toEqual({ from: 2, to: 1 });
  });

  it("rien à décaler : attente gardée, autre suite, attente finale, liste illisible", () => {
    expect(pendingStepRemap([wait, msg], [{ ...wait, hours: 3 }, msg])).toBeNull();
    expect(pendingStepRemap([wait, msg], [{ type: "tag", tag: "x" }])).toBeNull();
    expect(pendingStepRemap([msg, wait], [msg])).toBeNull();
    expect(pendingStepRemap([wait, msg, wait, msg], [msg, msg])).toBeNull();
    expect(pendingStepRemap("??", [msg])).toBeNull();
    expect(pendingStepRemap(undefined, [msg])).toBeNull();
  });
});
