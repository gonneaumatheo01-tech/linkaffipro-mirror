import { describe, expect, it, vi } from "vitest";
import { linearToGraph, type AutomationGraph, type GraphCondition } from "@linkaffipro/core";
import { executePlan, type ActionExecutor } from "./engine";
import { executeGraph } from "./graph-engine";

const P = { x: 0, y: 0 };
const now = new Date("2026-10-09T10:00:00Z");

function exec(): ActionExecutor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sendMessage: vi.fn(async (a) => (calls.push(`msg:${a.text}`), "envoyé")),
    sendSequence: vi.fn(async (a) => (calls.push(`seq:${a.trigger}`), "séquence")),
    tag: vi.fn(async (a) => (calls.push(`tag:${a.tag}`), "étiqueté")),
    suggestChannel: vi.fn(async (a) => (calls.push(`chan:${a.channelId}`), "proposé")),
    notifyTeam: vi.fn(async () => (calls.push("notify"), "prévenu")),
  };
}

const answer =
  (yes: boolean) =>
  (_c: GraphCondition): boolean =>
    yes;

/** Départ → message « Bonjour » → attendre 24 h → « a déjà déposé ? » oui → message « Merci », non → message « Pensez-y ». */
function graph(): AutomationGraph {
  return {
    version: 1,
    nodes: [
      { id: "t", type: "trigger", position: P },
      {
        id: "hello",
        type: "action",
        position: P,
        action: { type: "send_message", text: "Bonjour" },
      },
      { id: "w", type: "wait", position: P, hours: 24 },
      { id: "c", type: "condition", position: P, condition: { kind: "deposited" } },
      { id: "yes", type: "action", position: P, action: { type: "send_message", text: "Merci" } },
      { id: "no", type: "action", position: P, action: { type: "send_message", text: "Pensez-y" } },
    ],
    edges: [
      { id: "e1", source: "t", sourceHandle: "next", target: "hello" },
      { id: "e2", source: "hello", sourceHandle: "next", target: "w" },
      { id: "e3", source: "w", sourceHandle: "next", target: "c" },
      { id: "e4", source: "c", sourceHandle: "yes", target: "yes" },
      { id: "e5", source: "c", sourceHandle: "no", target: "no" },
    ],
  };
}

/** Départ → condition (sans attente) → branches données. */
function conditionFirst(
  edges: AutomationGraph["edges"],
  extra: AutomationGraph["nodes"] = [],
): AutomationGraph {
  return {
    version: 1,
    nodes: [
      { id: "t", type: "trigger", position: P },
      { id: "c", type: "condition", position: P, condition: { kind: "registered" } },
      { id: "m", type: "action", position: P, action: { type: "send_message", text: "Relance" } },
      ...extra,
    ],
    edges: [{ id: "e0", source: "t", sourceHandle: "next", target: "c" }, ...edges],
  };
}

describe("exécution d'un graphe", () => {
  it("s'arrête sur l'attente avec le bloc suivant, puis reprend à ce bloc", async () => {
    const e = exec();
    const evaluate = vi.fn(answer(false));
    const r1 = await executeGraph(graph(), null, e, evaluate, now);
    expect(r1).toMatchObject({ nodeId: "c", done: false, error: null });
    expect(r1.resumeAt?.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(e.calls).toEqual(["msg:Bonjour"]);
    expect(evaluate).not.toHaveBeenCalled();
    expect(r1.log).toEqual([
      {
        step: 0,
        nodeId: "hello",
        type: "send_message",
        at: now.toISOString(),
        ok: true,
        detail: "envoyé",
      },
      { step: 1, nodeId: "w", type: "wait", at: now.toISOString(), ok: true, detail: "1 jour" },
    ]);

    const later = new Date("2026-10-10T10:00:00Z");
    const r2 = await executeGraph(graph(), r1.nodeId, e, evaluate, later, {
      stepOffset: r1.log.length,
    });
    expect(r2).toMatchObject({ nodeId: "no", done: true, resumeAt: null, error: null });
    expect(e.calls).toEqual(["msg:Bonjour", "msg:Pensez-y"]);
    expect(evaluate).toHaveBeenCalledWith({ kind: "deposited" });
    expect(r2.log).toEqual([
      {
        step: 2,
        nodeId: "c",
        type: "condition",
        at: later.toISOString(),
        ok: true,
        detail: "non : A déjà déposé ?",
        branch: "no",
      },
      {
        step: 3,
        nodeId: "no",
        type: "send_message",
        at: later.toISOString(),
        ok: true,
        detail: "envoyé",
      },
    ]);
  });

  it("suit la sortie « oui » quand la condition est remplie", async () => {
    const e = exec();
    const r = await executeGraph(graph(), "c", e, answer(true), now);
    expect(r).toMatchObject({ nodeId: "yes", done: true });
    expect(e.calls).toEqual(["msg:Merci"]);
    expect(r.log.map((l) => [l.nodeId, l.branch])).toEqual([
      ["c", "yes"],
      ["yes", undefined],
    ]);
  });

  it("une condition dont la sortie prise n'a pas de lien termine l'exécution", async () => {
    const g = conditionFirst([{ id: "e1", source: "c", sourceHandle: "no", target: "m" }]);
    const e = exec();
    const r = await executeGraph(g, null, e, answer(true), now);
    expect(r).toMatchObject({ nodeId: "c", done: true, error: null });
    expect(e.calls).toEqual([]);
    expect(r.log).toHaveLength(1);
  });

  it("« arrêter » termine l'exécution", async () => {
    const g = conditionFirst(
      [
        { id: "e1", source: "c", sourceHandle: "yes", target: "s" },
        { id: "e2", source: "c", sourceHandle: "no", target: "m" },
      ],
      [{ id: "s", type: "stop", position: P }],
    );
    const e = exec();
    const r = await executeGraph(g, null, e, answer(true), now);
    expect(r).toMatchObject({ nodeId: "s", done: true, error: null });
    expect(e.calls).toEqual([]);
    expect(r.log.map((l) => `${l.nodeId}:${l.type}`)).toEqual(["c:condition", "s:stop"]);
  });

  it("une erreur sur une action arrête l'exécution sur ce bloc", async () => {
    const e = exec();
    e.sendMessage = vi.fn(async () => {
      throw new Error("bot bloqué");
    });
    const r = await executeGraph(graph(), null, e, answer(false), now);
    expect(r).toMatchObject({ nodeId: "hello", done: false, resumeAt: null, error: "bot bloqué" });
    expect(r.log).toEqual([
      {
        step: 0,
        nodeId: "hello",
        type: "send_message",
        at: now.toISOString(),
        ok: false,
        detail: "bot bloqué",
      },
    ]);
  });

  it("une erreur d'évaluation arrête l'exécution sur la condition", async () => {
    const r = await executeGraph(
      graph(),
      "c",
      exec(),
      () => Promise.reject(new Error("Membre introuvable ou anonymisé.")),
      now,
    );
    expect(r).toMatchObject({
      nodeId: "c",
      done: false,
      error: "Membre introuvable ou anonymisé.",
    });
    expect(r.log[0]).toMatchObject({ nodeId: "c", type: "condition", ok: false });
  });

  it("refuse un graphe invalide ou un bloc disparu", async () => {
    const bad = await executeGraph(
      { nodes: [{ id: "t", type: "trigger" }] },
      null,
      exec(),
      answer(true),
      now,
    );
    expect(bad.error).toMatch(/^Relance à corriger/);
    expect(bad.done).toBe(false);
    const gone = await executeGraph(graph(), "supprime", exec(), answer(true), now);
    expect(gone).toMatchObject({
      nodeId: "supprime",
      done: false,
      error: expect.stringMatching(/Bloc introuvable/),
    });
  });

  it("mode test : attentes passées, étiquettes ignorées, tout le parcours en une fois", async () => {
    const g = graph();
    g.nodes[1] = {
      id: "hello",
      type: "action",
      position: P,
      action: { type: "tag", tag: "relance" },
    };
    const e = exec();
    const r = await executeGraph(g, null, e, answer(false), now, {
      skipTags: true,
      skipWaits: true,
    });
    expect(r).toMatchObject({ nodeId: "no", done: true, resumeAt: null });
    expect(e.calls).toEqual(["msg:Pensez-y"]);
    expect(r.log.map((l) => l.detail)).toEqual([
      "ignoré (test)",
      "1 jour (passée : test)",
      "non : A déjà déposé ?",
      "envoyé",
    ]);
  });

  it("une attente sans suite termine tout de suite", async () => {
    const g = linearToGraph([
      { type: "send_message", text: "a" },
      { type: "wait", hours: 3 },
    ]);
    const r = await executeGraph(g, null, exec(), answer(true), now);
    expect(r).toMatchObject({ nodeId: "n2", done: true, resumeAt: null });
    expect(r.log[1]?.detail).toBe("3 h (rien ensuite : terminé)");
  });

  it("une règle linéaire convertie en branche unique fait la même chose que executePlan", async () => {
    const actions = [
      { type: "send_message", text: "Bienvenue" },
      { type: "wait", hours: 24 },
      { type: "tag", tag: "relance" },
      { type: "send_sequence", trigger: "APPROVED" },
      { type: "suggest_channel", channelId: "c2" },
      { type: "notify_team", text: "fait" },
    ] as const;
    const linear = exec();
    const p1 = await executePlan(actions, 0, linear, now);
    const p2 = await executePlan(actions, p1.nextStep, linear, now);

    const branching = exec();
    const g = linearToGraph([...actions]);
    const g1 = await executeGraph(g, null, branching, answer(true), now);
    const g2 = await executeGraph(g, g1.nodeId, branching, answer(true), now, {
      stepOffset: g1.log.length,
    });

    expect(branching.calls).toEqual(linear.calls);
    expect(g1.resumeAt).toEqual(p1.resumeAt);
    expect([g1.done, g2.done]).toEqual([p1.done, p2.done]);
    expect([...g1.log, ...g2.log].map((l) => [l.step, l.type, l.ok])).toEqual(
      [...p1.log, ...p2.log].map((l) => [l.step, l.type, l.ok]),
    );
  });
});
