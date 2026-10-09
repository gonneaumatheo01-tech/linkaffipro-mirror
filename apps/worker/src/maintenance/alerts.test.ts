import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const alerts: Array<{ id: string; kind: string; severity: string; message: string; createdAt: Date; notifiedAt: Date | null; resolvedAt: Date | null }> = [];
  /** Réglages simulés par clé (`backup.last`, `alerts.thresholds`). */
  const settings: Record<string, unknown> = {};
  return {
    alerts,
    settings,
    prisma: {
      bot: { findMany: vi.fn(async (): Promise<Array<{ username: string; isActive: boolean; lastWebhookAt: Date | null; lastError: string | null }>> => [{ username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: "500 boom" }]) },
      syncState: { findMany: vi.fn(async () => []) },
      setting: { findUnique: vi.fn(async ({ where }: { where: { key: string } }): Promise<{ value: unknown } | null> => (where.key in settings ? { value: settings[where.key] } : null)) },
      outboundMessage: { count: vi.fn(async () => 0) },
      player: { count: vi.fn(async () => 0) },
      click: { count: vi.fn(async () => 0), groupBy: vi.fn(async (): Promise<Array<{ trackingLinkId: string; _count: { _all: number } }>> => []) },
      trackingLink: { findMany: vi.fn(async (): Promise<Array<{ id: string; slug: string; label: string; affiliateCampaignId?: string | null }>> => []) },
      adCost: { findMany: vi.fn(async (): Promise<Array<{ spend: number; campaignId: string | null; adSet: null; ad: null }>> => []) },
      campaign: { findMany: vi.fn(async (): Promise<Array<{ id: string; name: string; inviteLinks: Array<{ id: string }>; trackingLinks: Array<{ id: string }>; adSets: Array<{ ads: Array<{ inviteLinkId: string | null; trackingLinkId: string | null }> }> }>> => []) },
      channel: { findMany: vi.fn(async (): Promise<Array<{ id: string; title: string }>> => []) },
      membership: { groupBy: vi.fn(async (): Promise<Array<{ channelId: string; _count: { _all: number } }>> => []) },
      post: { findMany: vi.fn(async (): Promise<Array<{ code: string; lastError: string | null; channel: { title: string } }>> => []) },
      alert: {
        findFirst: vi.fn(async ({ where }: { where: { kind: string; resolvedAt: null } }) => alerts.find((a) => a.kind === where.kind && a.resolvedAt === null) ?? null),
        findMany: vi.fn(async (args: { where: { resolvedAt?: null; notifiedAt?: null; kind?: string; createdAt?: { gte: Date } } }) =>
          alerts.filter(
            (a) =>
              (args.where.kind === undefined ? a.resolvedAt === null : a.kind === args.where.kind && a.createdAt >= args.where.createdAt!.gte) &&
              (args.where.notifiedAt === undefined || a.notifiedAt === null),
          ),
        ),
        create: vi.fn(async ({ data }: { data: { kind: string; severity: string; message: string; notifiedAt?: Date; resolvedAt?: Date } }) => {
          const a = { id: `a${alerts.length + 1}`, ...data, createdAt: new Date(), notifiedAt: data.notifiedAt ?? null, resolvedAt: data.resolvedAt ?? null };
          alerts.push(a);
          return a;
        }),
        updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { resolvedAt: Date } }) => {
          for (const a of alerts) if (where.id.in.includes(a.id)) a.resolvedAt = data.resolvedAt;
          return { count: where.id.in.length };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { notifiedAt?: Date; resolvedAt?: Date } }) => {
          const a = alerts.find((x) => x.id === where.id)!;
          if (data.notifiedAt) a.notifiedAt = data.notifiedAt;
          if (data.resolvedAt) a.resolvedAt = data.resolvedAt;
          return a;
        }),
      },
    },
  };
});
vi.mock("@linkaffipro/db", () => ({ prisma: db.prisma, toJsonValue: (v: unknown) => v }));
const failures = vi.hoisted(() => ({ counts: {} as Record<string, number> }));
vi.mock("@linkaffipro/queue", () => ({
  getQueue: () => ({ getWaitingCount: async () => 0 }),
  getRedis: () => ({}),
  QUEUE_NAMES: ["stats", "telegram-send"],
  HEARTBEAT_LAST_KEY: "worker:heartbeat:last",
  countRecentFailures: async () => failures.counts,
  parseHeartbeat: (raw: string | null) => (raw ? (JSON.parse(raw) as { at: string }) : null),
}));
const notify = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@linkaffipro/telegram", () => ({ notifyAdmin: notify }));

import { reportWorkerRestart, runAlerts } from "./alerts";

describe("passage d'alertes", () => {
  beforeEach(() => {
    db.alerts.length = 0;
    failures.counts = {};
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

describe("erreurs répétées et absence du worker", () => {
  beforeEach(() => {
    db.alerts.length = 0;
    failures.counts = {};
    for (const k of Object.keys(db.settings)) delete db.settings[k];
    notify.mockClear();
    db.prisma.bot.findMany.mockResolvedValue([{ username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null }]);
  });

  it("crée job_failures à partir de 10 échecs puis la résout quand la fenêtre se vide", async () => {
    failures.counts = { stats: 12 };
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(1);
    expect(db.alerts[0]?.kind).toBe("job_failures");
    failures.counts = { stats: 0 };
    const r2 = await runAlerts(new Date("2026-10-09T12:20:00Z"));
    expect(r2.resolved).toBe(1);
  });

  it("crée backup_failed depuis Setting backup.last puis la résout après un succès", async () => {
    db.settings["backup.last"] = { at: "2026-10-09T04:00:00Z", file: "linkaffipro-2026-10-06T04-00-00.sql.gz", ok: false, error: "disque plein" };
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(1);
    expect(db.alerts[0]?.message).toContain("disque plein");
    db.settings["backup.last"] = { at: "2026-10-10T04:00:00Z", file: "linkaffipro-2026-10-10T04-00-00.sql.gz", ok: true };
    const r2 = await runAlerts(new Date("2026-10-10T12:00:00Z"));
    expect(r2.resolved).toBe(1);
  });

  it("au redémarrage : rien sans ancien battement ni sous 3 minutes, sinon une alerte résolue et une notification", async () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const redisWith = (at: Date | null) => ({ get: async () => (at ? JSON.stringify({ at: at.toISOString(), version: "x", startedAt: at.toISOString(), pid: 1 }) : null) }) as never;
    expect(await reportWorkerRestart(redisWith(null), now)).toBeNull();
    expect(await reportWorkerRestart(redisWith(new Date(now.getTime() - 60_000)), now)).toBeNull();

    const r = await reportWorkerRestart(redisWith(new Date(now.getTime() - 10 * 60_000)), now);
    expect(r).toMatchObject({ downMinutes: 10, created: true, resolved: false });
    expect(db.alerts[0]).toMatchObject({ kind: "worker_down" });
    expect(db.alerts[0]?.resolvedAt).not.toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);

    // Deuxième redémarrage dans la journée : dédoublonné, pas de nouvelle alerte.
    const r2 = await reportWorkerRestart(redisWith(new Date(now.getTime() - 10 * 60_000)), new Date(now.getTime() + 3600_000));
    expect(r2).toMatchObject({ created: false, resolved: false });
    expect(db.alerts).toHaveLength(1);
  });

  it("au redémarrage : résout l'alerte ouverte créée par le site pendant l'absence", async () => {
    const now = new Date("2026-10-09T12:00:00Z");
    await db.prisma.alert.create({ data: { kind: "worker_down", severity: "CRITICAL", message: "absent" } });
    const redis = { get: async () => JSON.stringify({ at: new Date(now.getTime() - 5 * 60_000).toISOString(), version: "x", startedAt: "x", pid: 1 }) } as never;
    const r = await reportWorkerRestart(redis, now);
    expect(r).toMatchObject({ resolved: true, created: false, downMinutes: 5 });
    expect(db.alerts[0]?.resolvedAt).toEqual(now);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("règles métier (phase 6) dans le passage d'alertes", () => {
  beforeEach(() => {
    db.alerts.length = 0;
    failures.counts = {};
    for (const k of Object.keys(db.settings)) delete db.settings[k];
    notify.mockClear();
    db.prisma.bot.findMany.mockResolvedValue([{ username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null }]);
    db.prisma.player.count.mockReset();
    db.prisma.player.count.mockResolvedValue(0);
  });

  it("crée post_failed depuis les messages en échec puis la résout", async () => {
    db.prisma.post.findMany.mockResolvedValueOnce([{ code: "m1", lastError: "chat not found", channel: { title: "Casino FR" } }]);
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(1);
    expect(db.alerts[0]).toMatchObject({ kind: "post_failed" });
    expect(db.alerts[0]?.message).toContain("Casino FR / m1");
    const r2 = await runAlerts(new Date("2026-10-09T12:05:00Z"));
    expect(r2.resolved).toBe(1);
  });

  it("chute des inscriptions : lit Player.registeredAt sur 24 h et 7 jours, seuil depuis Setting", async () => {
    // Inscriptions : 11 sur les dernières 24 h (fenêtre gte/lte), 140 sur les 7 jours précédents (fenêtre gte/lt) ; 0 ailleurs (santé du sub-ID).
    const counts = ({ where }: { where: { registeredAt?: { gte?: Date; lt?: Date; lte?: Date } } }) => (where.registeredAt?.lt ? 140 : where.registeredAt?.lte ? 11 : 0);
    db.prisma.player.count.mockImplementation((async (args: Parameters<typeof counts>[0]) => counts(args)) as unknown as () => Promise<number>);
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(0); // 11 ≥ 50 % de 20 : pas de chute
    db.settings["alerts.thresholds"] = { registrationsDropPct: 30 };
    const r2 = await runAlerts(new Date("2026-10-09T12:05:00Z"));
    expect(r2.created).toBe(1); // seuil 30 % : limite 14, 11 est en dessous
    expect(db.alerts[0]).toMatchObject({ kind: "registrations_drop" });
  });

  it("dépense sans conversion : coûts rattachés à la pub, zéro inscription", async () => {
    db.prisma.adCost.findMany.mockResolvedValueOnce([{ spend: 60, campaignId: "c1", adSet: null, ad: null }, { spend: 10, campaignId: "c2", adSet: null, ad: null }]);
    db.prisma.campaign.findMany.mockResolvedValueOnce([{ id: "c1", name: "Pub A", inviteLinks: [], trackingLinks: [{ id: "t1" }], adSets: [] }]);
    const r = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r.created).toBe(1);
    expect(db.alerts[0]).toMatchObject({ kind: "spend_no_conversion" });
    expect(db.alerts[0]?.message).toContain("Pub A (60.00 €)");
  });

  it("canal qui fuit et lien désactivé cliqué", async () => {
    db.prisma.channel.findMany.mockResolvedValueOnce([{ id: "ch1", title: "VIP" }]);
    db.prisma.membership.groupBy.mockResolvedValueOnce([{ channelId: "ch1", _count: { _all: 50 } }]).mockResolvedValueOnce([{ channelId: "ch1", _count: { _all: 9 } }]);
    db.prisma.click.groupBy.mockResolvedValueOnce([{ trackingLinkId: "t9", _count: { _all: 2 } }]);
    db.prisma.trackingLink.findMany.mockResolvedValueOnce([{ id: "t9", slug: "zz", label: "Ancien bonus" }]);
    const r = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r.created).toBe(2);
    expect(db.alerts.map((a) => a.kind).sort()).toEqual(["channel_leak", "offer_link_inactive"]);
  });
});
