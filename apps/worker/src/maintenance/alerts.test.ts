import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const alerts: Array<{ id: string; kind: string; severity: string; message: string; createdAt: Date; notifiedAt: Date | null; resolvedAt: Date | null }> = [];
  return {
    alerts,
    prisma: {
      bot: { findMany: vi.fn(async (): Promise<Array<{ username: string; isActive: boolean; lastWebhookAt: Date | null; lastError: string | null }>> => [{ username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: "500 boom" }]) },
      syncState: { findMany: vi.fn(async () => []) },
      outboundMessage: { count: vi.fn(async () => 0) },
      player: { count: vi.fn(async () => 0) },
      click: { count: vi.fn(async () => 0) },
      trackingLink: { findMany: vi.fn(async () => []) },
      alert: {
        findMany: vi.fn(async (args: { where: { resolvedAt?: null; notifiedAt?: null } }) =>
          alerts.filter((a) => a.resolvedAt === null && (args.where.notifiedAt === undefined || a.notifiedAt === null)),
        ),
        create: vi.fn(async ({ data }: { data: { kind: string; severity: string; message: string } }) => {
          const a = { id: `a${alerts.length + 1}`, ...data, createdAt: new Date(), notifiedAt: null, resolvedAt: null };
          alerts.push(a);
          return a;
        }),
        updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { resolvedAt: Date } }) => {
          for (const a of alerts) if (where.id.in.includes(a.id)) a.resolvedAt = data.resolvedAt;
          return { count: where.id.in.length };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { notifiedAt: Date } }) => {
          const a = alerts.find((x) => x.id === where.id)!;
          a.notifiedAt = data.notifiedAt;
          return a;
        }),
      },
    },
  };
});
vi.mock("@linkaffipro/db", () => ({ prisma: db.prisma, toJsonValue: (v: unknown) => v }));
vi.mock("@linkaffipro/queue", () => ({ getQueue: () => ({ getWaitingCount: async () => 0 }) }));
const notify = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@linkaffipro/telegram", () => ({ notifyAdmin: notify }));

import { runAlerts } from "./alerts";

describe("passage d'alertes", () => {
  beforeEach(() => {
    db.alerts.length = 0;
    notify.mockClear();
  });

  it("crée, notifie une seule fois, puis résout quand la condition disparaît", async () => {
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(1);
    expect(r1.notified).toBe(1);
    expect(db.alerts[0]?.kind).toBe("bot_webhook");

    // Deuxième passage : même condition → pas de doublon, pas de nouvelle notification.
    const r2 = await runAlerts(new Date("2026-10-09T12:05:00Z"));
    expect(r2.created).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);

    // La condition disparaît → résolution automatique.
    db.prisma.bot.findMany.mockResolvedValueOnce([{ username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null }]);
    const r3 = await runAlerts(new Date("2026-10-09T12:10:00Z"));
    expect(r3.resolved).toBe(1);
    expect(db.alerts[0]?.resolvedAt).not.toBeNull();
  });
});
