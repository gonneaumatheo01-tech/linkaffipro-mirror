/**
 * Filet de la validation automatique (phase 14) : nos données d'abord, `getChatMember` seulement si besoin, limite
 * d'appels par bot et par passage, 429 respecté, une même demande revue par Telegram de moins en moins souvent.
 */
import { describe, expect, it } from "vitest";
import {
  apiCheckIntervalMs,
  sweepPendingGates,
  type GateSweepDeps,
  type PendingGateRow,
} from "./auto-gate";
import type { ChannelInfo } from "./deps";
import type { GateLinkApi } from "./gate-links";
import { IMPLICIT_RULE, type RuleData } from "./rules";

const channel = (id: string, chatId: bigint): ChannelInfo => ({
  id,
  title: id,
  username: null,
  language: "fr",
  telegramChatId: chatId,
  primaryBotId: "b1",
  isActive: true,
});
const CHANNELS = [channel("zone", -1n), channel("roul", -2n), channel("tir", -3n)];
const RULE: RuleData = {
  ...IMPLICIT_RULE,
  id: "r",
  mode: "DELAY",
  delaySeconds: 300,
  gateMode: "REQUIRED",
  gateChannelIds: ["roul", "tir"],
};
const NOW = new Date("2026-10-15T10:00:00Z");

function row(n: number, ageMs = 60_000, over: Partial<PendingGateRow> = {}): PendingGateRow {
  return {
    id: `ms${n}`,
    code: `CODE${n}000`,
    memberId: `m${n}`,
    channelId: "zone",
    status: "PENDING_GATE",
    requestedAt: new Date(NOW.getTime() - ageMs),
    approveAt: null,
    userChatId: null,
    inviteLinkId: null,
    approvalRuleId: "r",
    source: { botId: "b1" },
    remindersSent: 0,
    telegramUserId: BigInt(n),
    ...over,
  };
}

function makeDeps(opts: {
  rows: PendingGateRow[];
  /** Canaux où le membre a une demande à nous (nos données). */
  requested?: Record<string, string[]>;
  /** Statut Telegram (canal:utilisateur) : « member »… (défaut « left »). */
  telegram?: Record<string, string>;
  rule?: RuleData;
  /** Erreur Telegram forcée pour getChatMember. */
  fail?: { error_code: number; description: string; parameters?: { retry_after?: number } };
}) {
  const rows = opts.rows;
  const calls: string[] = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const api: GateLinkApi = {
    createChatInviteLink: async () => ({ invite_link: "x" }),
    async getChatMember(chatId, userId) {
      calls.push(`${chatId}:${userId}`);
      if (opts.fail) throw Object.assign(new Error("refus"), opts.fail);
      const c = CHANNELS.find((x) => Number(x.telegramChatId) === Number(chatId));
      return { status: opts.telegram?.[`${c?.id}:${userId}`] ?? "left" };
    },
  };
  // Seulement ce que le filet utilise (le reste du flux d'adhésion n'est pas appelé).
  const partial: Partial<GateSweepDeps> = {
    listPendingGates: async () => rows.filter((r) => r.status === "PENDING_GATE"),
    getRuleForMembership: async () => opts.rule ?? RULE,
    getChannels: async (ids) =>
      ids.map((id) => CHANNELS.find((c) => c.id === id)).filter((c): c is ChannelInfo => !!c),
    requestedChannelIds: async (memberId, ids) =>
      ids.filter((id) => opts.requested?.[memberId]?.includes(id)),
    adminBots: async () => [{ botId: "b1", username: "bot1", canInvite: true }],
    apiFor: async () => api,
    findGateLink: async () => null,
    saveGateLink: async () => undefined,
    updateMembership: async () => undefined,
    updateMembershipIfStatus: async (id, expected, data) => {
      const m = rows.find((r) => r.id === id);
      if (!m || m.status !== expected) return false;
      Object.assign(m, data);
      return true;
    },
    actingBotIdFor: async () => ({ botId: "b1" }),
    botState: async () => null,
    canWriteTo: async () => false,
    getMember: async (memberId) => ({ memberId, languageCode: "fr", firstName: "Léa" }),
    getBotIdentity: async () => null,
    getSequenceText: async () => null,
    enqueueDm: async () => undefined,
    recordEvent: async (e) => {
      events.push({ type: e.type, payload: (e.payload ?? {}) as Record<string, unknown> });
    },
    warn: () => undefined,
  };
  const deps = partial as GateSweepDeps;
  return { deps, calls, events, rows };
}

describe("filet du worker : demandes en attente des canaux", () => {
  it("nos données d'abord : canaux rejoints par des demandes à nous → acceptation programmée sans appel à Telegram", async () => {
    const { deps, calls, events, rows } = makeDeps({
      rows: [row(1)],
      requested: { m1: ["roul", "tir"] },
    });
    const r = await sweepPendingGates(deps, { now: NOW, maxAgeMs: 7 * 86_400_000 });
    expect(r).toMatchObject({ checked: 1, satisfied: ["ms1"], apiCalls: 0, deferred: 0 });
    expect(calls).toEqual([]);
    expect(rows[0]!.status).toBe("SCHEDULED");
    expect(rows[0]!.approveAt).toEqual(new Date(NOW.getTime() + 300_000));
    expect(events.find((e) => e.type === "membership.gate_satisfied")?.payload).toMatchObject({
      membershipId: "ms1",
      auto: true,
      trigger: "sweep",
    });
  });

  it("puis getChatMember seulement pour les canaux que nos données ne couvrent pas", async () => {
    const { deps, calls, rows } = makeDeps({
      rows: [row(1)],
      requested: { m1: ["roul"] },
      telegram: { "tir:1": "member" },
    });
    const r = await sweepPendingGates(deps, { now: NOW });
    expect(calls).toEqual(["-3:1"]);
    expect(r.satisfied).toEqual(["ms1"]);
    expect(rows[0]!.status).toBe("SCHEDULED");
  });

  it("toujours pas rejoint : la demande reste en attente, rien n'est écrit", async () => {
    const { deps, rows, events } = makeDeps({ rows: [row(1)] });
    const r = await sweepPendingGates(deps, { now: NOW });
    expect(r).toMatchObject({ checked: 1, satisfied: [], apiCalls: 2 });
    expect(rows[0]!.status).toBe("PENDING_GATE");
    expect(events).toEqual([]);
  });

  it("limite d'appels par bot et par passage : le reste est revu au passage suivant", async () => {
    const telegram = { "roul:1": "member", "roul:2": "member", "roul:3": "member" };
    const { deps, calls } = makeDeps({
      rows: [row(1), row(2), row(3)],
      requested: { m1: ["tir"], m2: ["tir"], m3: ["tir"] },
      telegram,
    });
    const first = await sweepPendingGates(deps, { now: NOW, budgetPerBot: 2 });
    expect(calls).toHaveLength(2);
    expect(first).toMatchObject({ satisfied: ["ms1", "ms2"], deferred: 1 });
    const second = await sweepPendingGates(deps, { now: NOW, budgetPerBot: 2 });
    expect(second).toMatchObject({ checked: 1, satisfied: ["ms3"], deferred: 0 });
    expect(calls).toHaveLength(3);
  });

  it("429 de Telegram : ce bot s'arrête pour ce passage, la demande est reportée (jamais « impossible à vérifier »)", async () => {
    const { deps, calls, rows } = makeDeps({
      rows: [row(1), row(2)],
      fail: { error_code: 429, description: "Too Many Requests: retry after 5" },
    });
    const r = await sweepPendingGates(deps, { now: NOW });
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ deferred: 2, satisfied: [], errors: 0 });
    expect(rows.map((x) => x.status)).toEqual(["PENDING_GATE", "PENDING_GATE"]);
  });

  it("pic de demandes (40 de moins d'1 heure, 30 appels par passage) : chacune vérifiée par Telegram en 3 passages", async () => {
    const memory = new Map<string, number>();
    const rows = Array.from({ length: 40 }, (_, i) => row(i + 1, (i + 1) * 60_000));
    const { deps, calls } = makeDeps({ rows });
    const checkedUsers = new Set<string>();
    for (let pass = 0; pass < 3; pass++) {
      const before = calls.length;
      await sweepPendingGates(deps, {
        now: new Date(NOW.getTime() + pass * 2 * 60_000),
        budgetPerBot: 30,
        lastApiCheck: memory,
      });
      expect(calls.length - before).toBeLessThanOrEqual(30);
      for (const c of calls.slice(before)) checkedUsers.add(c.split(":")[1]!);
    }
    expect(checkedUsers.size).toBe(40);
  });

  it("jamais vérifiées d'abord, puis les moins récemment vérifiées ; nos données relues pour toutes à chaque passage", async () => {
    const memory = new Map<string, number>();
    // ms1 vérifiée il y a 2 minutes, ms2 il y a 6 minutes, ms3 jamais ; une seule vérification par passage.
    memory.set("ms1", NOW.getTime() - 2 * 60_000);
    memory.set("ms2", NOW.getTime() - 6 * 60_000);
    const rows = [
      row(1, 10 * 60_000),
      row(2, 20 * 60_000),
      row(3, 30 * 60_000),
      row(4, 40 * 60_000),
    ];
    const { deps, calls } = makeDeps({
      rows,
      // ms4 : canaux rejoints par des demandes à nous, validée sans appel même quand la limite est atteinte.
      requested: { m4: ["roul", "tir"] },
      rule: { ...RULE, gateChannelIds: ["roul"] },
    });
    const r = await sweepPendingGates(deps, { now: NOW, budgetPerBot: 1, lastApiCheck: memory });
    expect(calls).toEqual(["-2:3"]);
    expect(r.satisfied).toEqual(["ms4"]);
    const second = await sweepPendingGates(deps, {
      now: new Date(NOW.getTime() + 2 * 60_000),
      budgetPerBot: 1,
      lastApiCheck: memory,
    });
    expect(calls).toEqual(["-2:3", "-2:2"]);
    expect(second.deferred).toBe(2);
  });

  it("429 avec retry_after 600 : plus aucun appel de ce bot avant 10 minutes, d'un passage à l'autre", async () => {
    const pauses = new Map<string, number>();
    const { deps, calls } = makeDeps({
      rows: [row(1), row(2)],
      fail: {
        error_code: 429,
        description: "Too Many Requests: retry after 600",
        parameters: { retry_after: 600 },
      },
    });
    for (let pass = 0; pass < 5; pass++) {
      const r = await sweepPendingGates(deps, {
        now: new Date(NOW.getTime() + pass * 2 * 60_000),
        botPauses: pauses,
      });
      expect(r.deferred).toBe(2);
    }
    expect(calls).toHaveLength(1);
    await sweepPendingGates(deps, {
      now: new Date(NOW.getTime() + 10 * 60_000),
      botPauses: pauses,
    });
    expect(calls).toHaveLength(2);
  });

  it("une demande de plus d'une heure n'est revue par Telegram que toutes les 10 minutes (nos données à chaque passage)", async () => {
    const memory = new Map<string, number>();
    const { deps, calls } = makeDeps({ rows: [row(1, 2 * 3600_000)] });
    await sweepPendingGates(deps, { now: NOW, lastApiCheck: memory });
    expect(calls).toHaveLength(2);
    await sweepPendingGates(deps, {
      now: new Date(NOW.getTime() + 2 * 60_000),
      lastApiCheck: memory,
    });
    expect(calls).toHaveLength(2);
    await sweepPendingGates(deps, {
      now: new Date(NOW.getTime() + 10 * 60_000),
      lastApiCheck: memory,
    });
    expect(calls).toHaveLength(4);
  });

  it("règle sans canaux à rejoindre (changée depuis) : laissée telle quelle, comptée à part", async () => {
    const { deps, rows } = makeDeps({
      rows: [row(1)],
      rule: { ...RULE, gateMode: "NONE", gateChannelIds: [] },
    });
    const r = await sweepPendingGates(deps, { now: NOW });
    expect(r).toMatchObject({ checked: 1, withoutGates: 1, satisfied: [] });
    expect(rows[0]!.status).toBe("PENDING_GATE");
  });

  it("canaux « Proposés » depuis la demande (règle changée) : validée aussi quand les canaux sont rejoints", async () => {
    const { deps, rows } = makeDeps({
      rows: [row(1)],
      rule: { ...RULE, gateMode: "SOFT" },
      requested: { m1: ["roul", "tir"] },
    });
    await sweepPendingGates(deps, { now: NOW });
    expect(rows[0]!.status).toBe("SCHEDULED");
  });

  it("demande déjà validée entre-temps (autre bot, « ✅ J'ai rejoint ») : aucun doublon d'événement", async () => {
    const { deps, events } = makeDeps({ rows: [row(1)], requested: { m1: ["roul", "tir"] } });
    deps.updateMembershipIfStatus = async () => false;
    const r = await sweepPendingGates(deps, { now: NOW });
    expect(r.satisfied).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe("intervalle des vérifications par Telegram", () => {
  it("à chaque passage la première heure, puis 10 minutes jusqu'à 24 h, puis 1 heure", () => {
    expect(apiCheckIntervalMs(30 * 60_000)).toBe(0);
    expect(apiCheckIntervalMs(2 * 3600_000)).toBe(10 * 60_000);
    expect(apiCheckIntervalMs(3 * 86_400_000)).toBe(3600_000);
  });
});
