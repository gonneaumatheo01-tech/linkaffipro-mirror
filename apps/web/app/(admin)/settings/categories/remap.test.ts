import { describe, expect, it } from "vitest";
import {
  categoryUsageLabel,
  countCategoryReferences,
  deleteConfirmMessage,
  remapBroadcastSegment,
  remapCategoryIds,
  remapRuleConditions,
} from "./remap";

describe("suppression ou fusion d'une catégorie : références JSON", () => {
  it("remplace l'identifiant par la catégorie de remplacement, sans doublon", () => {
    expect(remapCategoryIds(["a", "b"], "a", "c")).toEqual({
      changed: true,
      ids: ["c", "b"],
      emptied: false,
    });
    expect(remapCategoryIds(["a", "c"], "a", "c")).toEqual({
      changed: true,
      ids: ["c"],
      emptied: false,
    });
  });
  it("retire l'identifiant sans remplacement, et signale une liste vidée", () => {
    expect(remapCategoryIds(["a", "b"], "a", null)).toEqual({
      changed: true,
      ids: ["b"],
      emptied: false,
    });
    expect(remapCategoryIds(["a"], "a", null)).toEqual({ changed: true, ids: [], emptied: true });
  });
  it("ne touche à rien si la catégorie n'est pas citée (ou si ce n'est pas une liste)", () => {
    expect(remapCategoryIds(["b"], "a", "c")).toEqual({
      changed: false,
      ids: ["b"],
      emptied: false,
    });
    expect(remapCategoryIds(undefined, "a", "c")).toEqual({
      changed: false,
      ids: [],
      emptied: false,
    });
    expect(remapCategoryIds("a", "a", "c")).toEqual({ changed: false, ids: [], emptied: false });
  });
  it("automatisation : liste vidée → la règle est désactivée (sinon elle viserait toutes les catégories)", () => {
    expect(remapRuleConditions({ categoryIds: ["a"], channelIds: ["x"] }, "a", null)).toEqual({
      changed: true,
      conditions: { channelIds: ["x"] },
      deactivate: true,
    });
    expect(remapRuleConditions({ categoryIds: ["a", "b"] }, "a", "c")).toEqual({
      changed: true,
      conditions: { categoryIds: ["c", "b"] },
      deactivate: false,
    });
    expect(remapRuleConditions({ channelIds: ["x"] }, "a", "c")).toEqual({
      changed: false,
      conditions: { channelIds: ["x"] },
      deactivate: false,
    });
    expect(remapRuleConditions(null, "a", "c")).toEqual({
      changed: false,
      conditions: {},
      deactivate: false,
    });
  });
  it("envoi groupé : liste vidée → l'envoi repasse en brouillon (sinon il viserait tout le monde)", () => {
    expect(
      remapBroadcastSegment({ clickedCategoryIds: ["a"], languages: ["fr"] }, "a", null),
    ).toEqual({ changed: true, segment: { languages: ["fr"] }, backToDraft: true });
    expect(remapBroadcastSegment({ clickedCategoryIds: ["a"] }, "a", "c")).toEqual({
      changed: true,
      segment: { clickedCategoryIds: ["c"] },
      backToDraft: false,
    });
    expect(remapBroadcastSegment({}, "a", "c")).toEqual({
      changed: false,
      segment: {},
      backToDraft: false,
    });
  });
});

describe("Réglages → Catégories : références des automatisations et des envois", () => {
  it("compte, par catégorie, les automatisations et les envois qui la citent (et ceux qui ne visent qu'elle)", () => {
    const refs = countCategoryReferences(
      [
        { conditions: { categoryIds: ["a"] } },
        { conditions: { categoryIds: ["a", "b", "a"] } },
        { conditions: { channelIds: ["x"] } },
        { conditions: null },
      ],
      [{ segment: { clickedCategoryIds: ["b"] } }, { segment: { clickedCategoryIds: "a" } }],
    );
    expect(refs.get("a")).toEqual({ rules: 2, broadcasts: 0, rulesOnly: 1, broadcastsOnly: 0 });
    expect(refs.get("b")).toEqual({ rules: 1, broadcasts: 1, rulesOnly: 0, broadcastsOnly: 1 });
    expect(refs.get("x")).toBeUndefined();
  });
  it("confirmation : sans aucune référence, simple suppression", () => {
    expect(deleteConfirmMessage("Bonus", 0, undefined)).toBe(
      "La catégorie « Bonus » sera supprimée définitivement. Continuer ?",
    );
  });
  it("confirmation : catégorie sans message mais citée par une relance automatique qui ne vise qu'elle", () => {
    const msg = deleteConfirmMessage("Bonus", 0, {
      rules: 1,
      broadcasts: 2,
      rulesOnly: 1,
      broadcastsOnly: 1,
    });
    expect(msg).toContain("1 relance automatique");
    expect(msg).toContain("2 messages à un groupe pas encore partis");
    expect(msg).toContain("catégorie choisie");
    expect(msg).toContain("désactivée");
    expect(msg).toContain("brouillon");
    // Aucun compte de messages de canal (posts = 0) : seuls les messages à un groupe sont cités.
    expect(msg).not.toMatch(/\d+ messages?\b(?! à un groupe)/);
    // Vocabulaire du client (docs/REFONTE-UX.md) : plus d'« automatisation » ni d'« envoi » en surface.
    expect(msg).not.toMatch(/automatisation|envoi/i);
  });
  it("confirmation : messages seulement, pas d'avertissement de désactivation", () => {
    const msg = deleteConfirmMessage("Bonus", 3, undefined);
    expect(msg).toContain("3 messages");
    expect(msg).not.toContain("désactivée");
  });
  it("ligne « Utilisée par » de la liste, en mots simples", () => {
    expect(categoryUsageLabel(0, undefined)).toBe("Pas encore utilisée");
    expect(categoryUsageLabel(1, undefined)).toBe("1 message");
    expect(
      categoryUsageLabel(3, { rules: 2, broadcasts: 1, rulesOnly: 0, broadcastsOnly: 0 }),
    ).toBe("3 messages · 2 relances automatiques · 1 message à un groupe pas encore parti");
    expect(
      categoryUsageLabel(0, { rules: 0, broadcasts: 0, rulesOnly: 0, broadcastsOnly: 0 }),
    ).toBe("Pas encore utilisée");
  });
});
