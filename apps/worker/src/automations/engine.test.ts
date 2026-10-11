import { describe, expect, it, vi } from "vitest";
import { daysSince, executePlan, selectRules, type ActionExecutor } from "./engine";

const rules = [
  { id: "r1", name: "A", trigger: "JOINED", conditions: { channelIds: ["c1"] }, actions: [], isActive: true, oncePerMember: true },
  { id: "r2", name: "B", trigger: "JOINED", conditions: {}, actions: [], isActive: false, oncePerMember: true },
  { id: "r3", name: "C", trigger: "DEPOSITED", conditions: {}, actions: [], isActive: true, oncePerMember: true },
  { id: "r4", name: "D", trigger: "JOINED", conditions: { spendLevels: ["ROI"] }, actions: [], isActive: true, oncePerMember: true },
];

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

describe("sélection des règles", () => {
  it("garde les règles actives du déclencheur dont les conditions correspondent", () => {
    expect(selectRules(rules, "JOINED", { channelId: "c1" }).map((r) => r.id)).toEqual(["r1"]);
    expect(selectRules(rules, "JOINED", { channelId: "c2" })).toEqual([]);
    expect(selectRules(rules, "DEPOSITED", {}).map((r) => r.id)).toEqual(["r3"]);
  });
  it("ignore une règle aux conditions invalides", () => {
    expect(selectRules(rules, "JOINED", { channelId: "c1", spendLevel: "VIP" }).map((r) => r.id)).toEqual(["r1"]);
  });
  it("clic sur le bouton Offre d'une relance : jamais cette même relance, les autres seulement « une fois par membre »", () => {
    const clicked = [
      { id: "own", name: "Offre", trigger: "OFFER_CLICKED", conditions: {}, actions: [], isActive: true, oncePerMember: false },
      { id: "free", name: "Libre", trigger: "OFFER_CLICKED", conditions: {}, actions: [], isActive: true, oncePerMember: false },
      { id: "once", name: "Une fois", trigger: "OFFER_CLICKED", conditions: {}, actions: [], isActive: true, oncePerMember: true },
    ];
    // Clic sur un message de canal ou un message à un groupe : toutes les règles, comme avant.
    expect(selectRules(clicked, "OFFER_CLICKED", {}).map((r) => r.id)).toEqual(["own", "free", "once"]);
    expect(selectRules(clicked, "OFFER_CLICKED", {}, { fromRuleId: null }).map((r) => r.id)).toEqual(["own", "free", "once"]);
    // Clic sur le bouton de la relance « own » : ni elle-même (envoi en boucle), ni une relance libre (ping-pong entre deux relances).
    expect(selectRules(clicked, "OFFER_CLICKED", {}, { fromRuleId: "own" }).map((r) => r.id)).toEqual(["once"]);
    expect(selectRules(clicked, "OFFER_CLICKED", {}, { fromRuleId: "once" }).map((r) => r.id)).toEqual([]);
  });
});

describe("exécution d'un plan", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const actions = [
    { type: "send_message", text: "Bienvenue" },
    { type: "wait", hours: 24 },
    { type: "tag", tag: "relance" },
    { type: "notify_team", text: "fait" },
  ];

  it("s'arrête sur « attendre » puis reprend à l'étape suivante", async () => {
    const e = exec();
    const r1 = await executePlan(actions, 0, e, now);
    expect(r1.done).toBe(false);
    expect(r1.nextStep).toBe(2);
    expect(r1.resumeAt?.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(e.calls).toEqual(["msg:Bienvenue"]);
    const r2 = await executePlan(actions, r1.nextStep, e, now);
    expect(r2.done).toBe(true);
    expect(e.calls).toEqual(["msg:Bienvenue", "tag:relance", "notify"]);
    expect(r2.log.map((l) => l.ok)).toEqual([true, true]);
  });

  it("journalise une erreur et s'arrête", async () => {
    const e = exec();
    e.sendMessage = vi.fn(async () => { throw new Error("bot bloqué"); });
    const r = await executePlan(actions, 0, e, now);
    expect(r.error).toBe("bot bloqué");
    expect(r.done).toBe(false);
    expect(r.log[0]).toMatchObject({ ok: false, detail: "bot bloqué" });
  });

  it("ignore les étiquettes en mode test", async () => {
    const e = exec();
    const r = await executePlan([{ type: "tag", tag: "x" }], 0, e, now, { skipTags: true });
    expect(r.done).toBe(true);
    expect(e.calls).toEqual([]);
  });

  it("calcule les jours écoulés", () => {
    expect(daysSince(new Date("2026-10-01T09:00:00Z"), now)).toBe(8);
    expect(daysSince(null, now)).toBeNull();
  });
});
