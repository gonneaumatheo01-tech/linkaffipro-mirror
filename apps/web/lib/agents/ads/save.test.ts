import { beforeEach, describe, expect, it, vi } from "vitest";

// Écriture des réglages des alertes de l'Agent Ads : `Setting` `agents.ads.alerts` et `AuditLog` avant / après.
const m = vi.hoisted(() => ({
  row: null as { value: unknown } | null,
  upsert: vi.fn(async (..._a: unknown[]) => ({})),
  audit: vi.fn(async (..._a: unknown[]) => {}),
}));
vi.mock("@linkaffipro/db", () => ({
  audit: m.audit,
  prisma: { setting: { findUnique: vi.fn(async () => m.row), upsert: m.upsert } },
}));

import { saveAdsAlertSettings } from "./save";

beforeEach(() => {
  m.row = null;
  m.upsert.mockClear();
  m.audit.mockClear();
});

describe("saveAdsAlertSettings", () => {
  it("écrit le réglage et journalise avant / après", async () => {
    m.row = { value: { spikePct: 70 } };
    const after = { spikePct: 80, dropPct: 40, minDailySpend: 12.5, minRegistrations: 3 };
    await saveAdsAlertSettings(after, "u1");
    expect(m.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "agents.ads.alerts" }, update: { value: after } }),
    );
    expect(m.audit).toHaveBeenCalledWith({
      userId: "u1",
      action: "agents.ads_alerts_saved",
      entityType: "Setting",
      entityId: "agents.ads.alerts",
      metadata: { before: { spikePct: 70, dropPct: 50, minDailySpend: 10, minRegistrations: 5 }, after },
    });
  });
});
