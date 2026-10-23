import { beforeEach, describe, expect, it, vi } from "vitest";

// Écritures de la fiche Rencontres (phase 20) : persona obligatoire pour un plan activé, réglages vidéo fusionnés
// dans les réglages de l'équipe sans effacer les autres clés, plafonds inchangés pour un responsable.
const m = vi.hoisted(() => ({
  channel: { id: "c1", vertical: "DATING", isTest: false },
  config: { settings: { similarityThreshold: 0.8 } } as { settings: unknown } | null,
  planUpsert: vi.fn(async (_a: unknown) => ({})),
  configUpsert: vi.fn(async (_a: unknown) => ({})),
  audit: vi.fn(async (_a: unknown) => {}),
}));

vi.mock("@linkaffipro/db", () => ({
  audit: m.audit,
  prisma: {
    channel: { findUnique: vi.fn(async () => m.channel) },
    persona: { findUnique: vi.fn(async () => ({ id: "p1" })) },
    campaign: { findUnique: vi.fn(async () => null) },
    channelAgentPlan: { upsert: m.planUpsert },
    agentTeamConfig: { findUnique: vi.fn(async () => m.config), upsert: m.configUpsert },
  },
}));

import { saveChannelPlan, saveDatingMediaSettings, saveTeamSettings } from "./save";

const plan = {
  channelId: "c1",
  enabled: true,
  postsPerDay: 4,
  windowStart: "09:00",
  windowEnd: "22:00",
  minSpacingMinutes: 90,
  mix: { video: 1, photo: 2, text: 1 },
  personaId: null as string | null,
  campaignId: null,
  themes: [],
};

beforeEach(() => {
  m.config = { settings: { similarityThreshold: 0.8 } };
  for (const f of [m.planUpsert, m.configUpsert, m.audit]) f.mockClear();
});

describe("plan d'un canal Rencontres", () => {
  it("activé sans persona : refusé ; désactivé sans persona ou activé avec : enregistré", async () => {
    expect(await saveChannelPlan("dating", plan, "u1")).toEqual({
      ok: false,
      error: expect.stringContaining("persona du canal"),
    });
    expect(m.planUpsert).not.toHaveBeenCalled();
    expect(await saveChannelPlan("dating", { ...plan, enabled: false }, "u1")).toEqual({ ok: true });
    expect(await saveChannelPlan("dating", { ...plan, personaId: "p1" }, "u1")).toEqual({ ok: true });
  });

  it("autre équipe : persona facultative", async () => {
    m.channel = { id: "c1", vertical: "CASINO", isTest: false };
    expect(await saveChannelPlan("casino", plan, "u1")).toEqual({ ok: true });
    m.channel = { id: "c1", vertical: "DATING", isTest: false };
  });
});

describe("réglages vidéo et plafonds", () => {
  it("fournisseur et résolution fusionnés, journalisés ; rien si rien ne change", async () => {
    await saveDatingMediaSettings({ videoProvider: "magichour", videoResolution: "720p" }, "u1");
    const arg = m.configUpsert.mock.calls[0]![0] as { update: { settings: unknown } };
    expect(arg.update.settings).toEqual({ similarityThreshold: 0.8, videoProvider: "magichour", videoResolution: "720p" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.video_settings_saved" }));
    m.configUpsert.mockClear();
    m.config = { settings: { videoProvider: "fal", videoResolution: "580p" } };
    await saveDatingMediaSettings({ videoProvider: "fal", videoResolution: "580p" }, "u1");
    expect(m.configUpsert).not.toHaveBeenCalled();
  });

  it("plafonds `null` (responsable) : la colonne des plafonds n'est pas écrite", async () => {
    const base = { styleGuidelines: "", forbiddenWords: [], maxTextLength: 900, quietHours: [] };
    await saveTeamSettings("dating", { ...base, budgets: null }, "u2");
    const arg = m.configUpsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(arg.update).not.toHaveProperty("monthlyBudgetCents");
    await saveTeamSettings("dating", { ...base, budgets: { video: 5000 } }, "u1");
    const arg2 = m.configUpsert.mock.calls[1]![0] as { update: Record<string, unknown> };
    expect(arg2.update.monthlyBudgetCents).toEqual({ video: 5000 });
  });
});
