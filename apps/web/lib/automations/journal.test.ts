import { describe, expect, it } from "vitest";
import { linearToGraph, templateGraph } from "@linkaffipro/core";
import {
  linearNodeId,
  logEntryLabel,
  nodeStatsRows,
  ruleNodeStats,
  runLogWithNodes,
  runNodeId,
  runWhereText,
} from "./journal";

const at = "2026-10-10T10:00:00.000Z";
const message = { text: "Bonjour" };

describe("journal par bloc", () => {
  it("relance à liste : chaque entrée rattachée au bloc de son rang", () => {
    const run = {
      status: "PENDING",
      step: 1,
      log: [{ step: 0, type: "wait", at, ok: true, detail: "24 h" }],
    };
    expect(linearNodeId(0)).toBe("n1");
    expect(runLogWithNodes(run, true)[0]?.nodeId).toBe("n1");
    expect(runNodeId(run, true)).toBe("n2");
    expect(
      runNodeId(
        {
          status: "DONE",
          step: 2,
          log: [
            { step: 0, type: "wait", at, ok: true },
            { step: 1, type: "send_message", at, ok: true },
          ],
        },
        true,
      ),
    ).toBe("n2");
    expect(runNodeId({ status: "FAILED", step: 0, log: [] }, true)).toBeNull();
  });

  it("parcours à branches : passages, oui / non, attentes et dernière erreur par bloc", () => {
    const runs = [
      {
        status: "FAILED",
        step: 3,
        nodeId: "message",
        log: [
          { step: 0, nodeId: "wait", type: "wait", at, ok: true },
          { step: 1, nodeId: "check", type: "condition", at, ok: true, branch: "no" },
          {
            step: 2,
            nodeId: "message",
            type: "send_message",
            at,
            ok: false,
            detail: "Aucun bot actif",
          },
        ],
      },
      {
        status: "DONE",
        step: 3,
        nodeId: "stop",
        log: [
          { step: 0, nodeId: "wait", type: "wait", at, ok: true },
          { step: 1, nodeId: "check", type: "condition", at, ok: true, branch: "yes" },
          { step: 2, nodeId: "stop", type: "stop", at, ok: true },
        ],
      },
      {
        status: "PENDING",
        step: 1,
        nodeId: "check",
        log: [{ step: 0, nodeId: "wait", type: "wait", at, ok: true }],
      },
    ];
    const stats = ruleNodeStats(runs, false);
    expect(stats.wait).toMatchObject({ reached: 3, failed: 0 });
    expect(stats.check).toMatchObject({ reached: 2, yes: 1, no: 1, waiting: 1 });
    expect(stats.message).toMatchObject({ reached: 1, failed: 1, lastError: "Aucun bot actif" });

    const graph = templateGraph("offer_no_signup", { message });
    const rows = nodeStatsRows(graph, stats, ["trigger", "wait", "check", "stop", "message"]);
    expect(rows.map((r) => [r.id, r.label])).toEqual([
      ["wait", "Attendre 1 jour"],
      ["check", "Inscrit chez un programme ?"],
      ["stop", "Arrêter"],
      ["message", "Message : Bonjour"],
    ]);
    expect(rows.find((r) => r.id === "stop")).toMatchObject({ reached: 1, failed: 0 });
  });

  it("relance à liste : statistiques rattachées à la branche unique", () => {
    const stats = ruleNodeStats(
      [
        { status: "PENDING", step: 1, log: [{ step: 0, type: "wait", at, ok: true }] },
        {
          status: "DONE",
          step: 2,
          log: [
            { step: 0, type: "wait", at, ok: true },
            { step: 1, type: "send_message", at, ok: true },
          ],
        },
      ],
      true,
    );
    expect(stats.n1).toMatchObject({ reached: 2 });
    expect(stats.n2).toMatchObject({ reached: 1, waiting: 1 });
  });

  it("libellés en français", () => {
    expect(logEntryLabel({ step: 0, type: "condition", at, ok: true, branch: "yes" })).toBe(
      "Condition : oui",
    );
    expect(logEntryLabel({ step: 0, type: "send_sequence", at, ok: true })).toBe(
      "Envoyer un message du bot",
    );
    expect(logEntryLabel({ step: 0, type: "wait", at, ok: true })).toBe("Attendre");
    expect(logEntryLabel({ step: 0, type: "???", at, ok: true })).toBe("Étape");
    const graph = linearToGraph([
      { type: "wait", hours: 24 },
      { type: "send_message", ...message },
    ]);
    expect(runWhereText({ status: "PENDING", step: 1, log: [] }, graph, true)).toBe(
      "En attente avant le message « Bonjour »",
    );
    expect(runWhereText({ status: "CANCELLED", step: 1, log: [] }, graph, true)).toBe("Annulée");
  });

  it("où en est une exécution : mots d'exemple, un seul niveau de guillemets", () => {
    const graph = templateGraph("signup_no_deposit", {
      message: { text: "Bonjour {prenom}, il ne vous reste qu'une étape sur {canal} !" },
    });
    const where = (status: string, nodeId: string) =>
      runWhereText({ status, step: 2, nodeId, log: [] }, graph, false);
    expect(where("DONE", "message")).toBe(
      "Terminée après le message « Bonjour Léa, il ne vous reste qu'une étape… »",
    );
    expect(where("DONE", "stop")).toBe("Terminée après l'arrêt");
    expect(where("PENDING", "check")).toBe("En attente avant la question « A déjà déposé ? »");
    expect(where("FAILED", "gone")).toBe("Arrêtée sur une erreur");
    const tagged = linearToGraph([{ type: "tag", tag: "vip" }]);
    expect(
      runWhereText(
        { status: "FAILED", step: 0, log: [{ step: 0, type: "tag", at, ok: false }] },
        tagged,
        true,
      ),
    ).toBe("Arrêtée sur l'étiquette « vip »");
    for (const s of [where("DONE", "message"), where("PENDING", "check")])
      expect(s.match(/«/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
