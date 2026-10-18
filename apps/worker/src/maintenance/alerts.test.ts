import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Événements `dm.custom_emoji_fallback` simulés (phase 12) ; `type` : `post.custom_emoji_fallback` pour un message
 * programmé publié par un bot (groupes), sinon message privé.
 */
const fallbackEvents = vi.hoisted(() => ({
  rows: [] as Array<{
    botId: string | null;
    occurredAt: Date;
    payload: { resent: boolean };
    type?: string;
  }>,
}));
/** Session du compte Telegram connecté simulée et messages programmés qui en dépendent (phase 12). */
const tgAccount = vi.hoisted(() => ({
  row: null as { status: string } | null,
  pending: 0,
}));
const db = vi.hoisted(() => {
  const alerts: Array<{
    id: string;
    kind: string;
    severity: string;
    message: string;
    createdAt: Date;
    notifiedAt: Date | null;
    resolvedAt: Date | null;
  }> = [];
  /** Réglages simulés par clé (`backup.last`, `alerts.thresholds`). */
  const settings: Record<string, unknown> = {};
  return {
    alerts,
    settings,
    prisma: {
      bot: {
        findMany: vi.fn(
          async (): Promise<
            Array<{
              username: string;
              isActive: boolean;
              lastWebhookAt: Date | null;
              lastError: string | null;
            }>
          > => [
            {
              username: "casino",
              isActive: true,
              lastWebhookAt: new Date(),
              lastError: "500 boom",
            },
          ],
        ),
      },
      syncState: { findMany: vi.fn(async () => []) },
      setting: {
        findUnique: vi.fn(
          async ({ where }: { where: { key: string } }): Promise<{ value: unknown } | null> =>
            where.key in settings ? { value: settings[where.key] } : null,
        ),
      },
      outboundMessage: { count: vi.fn(async () => 0) },
      // Messages partis avec les emojis normaux (phase 12, `dm.` / `post.custom_emoji_fallback`) : filtrés par type et date.
      event: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: { type: string | { in: string[] }; occurredAt: { gte: Date; lte: Date } };
          }) => {
            const types = typeof where.type === "string" ? [where.type] : where.type.in;
            return fallbackEvents.rows
              .map((e) => ({ ...e, type: e.type ?? "dm.custom_emoji_fallback" }))
              .filter(
                (e) =>
                  types.includes(e.type) &&
                  e.occurredAt >= where.occurredAt.gte &&
                  e.occurredAt <= where.occurredAt.lte,
              );
          },
        ),
      },
      player: { count: vi.fn(async () => 0) },
      // Commissions de la fenêtre (phase 10) : primes par joueur et part du revenu des offres.
      playerEvent: { aggregate: vi.fn(async () => ({ _sum: { amount: 15 } })) },
      affiliateDailyStat: { aggregate: vi.fn(async () => ({ _sum: { revshareRevenue: 2.5 } })) },
      click: {
        count: vi.fn(async () => 0),
        groupBy: vi.fn(
          async (): Promise<Array<{ trackingLinkId: string; _count: { _all: number } }>> => [],
        ),
      },
      trackingLink: {
        findMany: vi.fn(
          async (): Promise<
            Array<{ id: string; slug: string; label: string; affiliateCampaignId?: string | null }>
          > => [],
        ),
      },
      adCost: {
        findMany: vi.fn(
          async (): Promise<
            Array<{ spend: number; campaignId: string | null; adSet: null; ad: null }>
          > => [],
        ),
      },
      campaign: {
        findMany: vi.fn(
          async (): Promise<
            Array<{
              id: string;
              name: string;
              channelIds?: unknown;
              affiliateCampaignIds?: unknown;
              inviteLinks: Array<{ id: string }>;
              trackingLinks: Array<{ id: string }>;
              adSets: Array<{
                ads: Array<{ inviteLinkId: string | null; trackingLinkId: string | null }>;
              }>;
            }>
          > => [],
        ),
      },
      channel: { findMany: vi.fn(async (): Promise<Array<{ id: string; title: string }>> => []) },
      membership: {
        groupBy: vi.fn(
          async (): Promise<Array<{ channelId: string; _count: { _all: number } }>> => [],
        ),
      },
      post: {
        findMany: vi.fn(
          async (): Promise<
            Array<{ code: string; lastError: string | null; channel: { title: string } }>
          > => [],
        ),
        count: vi.fn(async () => tgAccount.pending),
      },
      telegramUserSession: { findUnique: vi.fn(async () => tgAccount.row) },
      alert: {
        findFirst: vi.fn(
          async ({ where }: { where: { kind: string; resolvedAt: null } }) =>
            alerts.find((a) => a.kind === where.kind && a.resolvedAt === null) ?? null,
        ),
        findMany: vi.fn(
          async (args: {
            where: {
              resolvedAt?: null;
              notifiedAt?: null;
              kind?: string;
              createdAt?: { gte: Date };
            };
          }) =>
            alerts.filter(
              (a) =>
                (args.where.kind === undefined
                  ? a.resolvedAt === null
                  : a.kind === args.where.kind && a.createdAt >= args.where.createdAt!.gte) &&
                (args.where.notifiedAt === undefined || a.notifiedAt === null),
            ),
        ),
        create: vi.fn(
          async ({
            data,
          }: {
            data: {
              kind: string;
              severity: string;
              message: string;
              notifiedAt?: Date;
              resolvedAt?: Date;
              createdAt?: Date;
            };
          }) => {
            const a = {
              id: `a${alerts.length + 1}`,
              ...data,
              createdAt: data.createdAt ?? new Date(),
              notifiedAt: data.notifiedAt ?? null,
              resolvedAt: data.resolvedAt ?? null,
            };
            alerts.push(a);
            return a;
          },
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: { in: string[] } };
            data: { resolvedAt: Date };
          }) => {
            for (const a of alerts) if (where.id.in.includes(a.id)) a.resolvedAt = data.resolvedAt;
            return { count: where.id.in.length };
          },
        ),
        update: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: {
              notifiedAt?: Date;
              resolvedAt?: Date | null;
              severity?: string;
              message?: string;
            };
          }) => {
            const a = alerts.find((x) => x.id === where.id)!;
            if (data.notifiedAt) a.notifiedAt = data.notifiedAt;
            // Alerte rouverte : `resolvedAt: null` explicite.
            if ("resolvedAt" in data) a.resolvedAt = data.resolvedAt ?? null;
            if (data.severity) a.severity = data.severity;
            if (data.message) a.message = data.message;
            return a;
          },
        ),
      },
    },
  };
});
vi.mock("@linkaffipro/db", () => ({
  prisma: db.prisma,
  toJsonValue: (v: unknown) => v,
  ourPlayers: async () => ({ OR: [{ clickId: { not: null } }] }),
}));
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
/** Demandes dont l'accueil est parti sans tous les liens des canaux à rejoindre (`listGateLinksMissing`). */
const gateRows = vi.hoisted(() => ({
  rows: [] as Array<{
    channelTitle: string;
    status: string;
    missing: Array<{ title: string; suggestedBot: string | null }>;
  }>,
}));
vi.mock("@linkaffipro/telegram", () => ({
  notifyAdmin: notify,
  listGateLinksMissing: async () => gateRows.rows,
}));

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
    db.prisma.bot.findMany.mockResolvedValueOnce([
      { username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null },
    ]);
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
    db.prisma.bot.findMany.mockResolvedValue([
      { username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null },
    ]);
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
    db.settings["backup.last"] = {
      at: "2026-10-09T04:00:00Z",
      file: "linkaffipro-2026-10-06T04-00-00.sql.gz",
      ok: false,
      error: "disque plein",
    };
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(1);
    expect(db.alerts[0]?.message).toContain("disque plein");
    db.settings["backup.last"] = {
      at: "2026-10-10T04:00:00Z",
      file: "linkaffipro-2026-10-10T04-00-00.sql.gz",
      ok: true,
    };
    const r2 = await runAlerts(new Date("2026-10-10T12:00:00Z"));
    expect(r2.resolved).toBe(1);
  });

  it("au redémarrage : rien sans ancien battement ni sous 3 minutes, sinon une alerte résolue et une notification", async () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const redisWith = (at: Date | null) =>
      ({
        get: async () =>
          at
            ? JSON.stringify({
                at: at.toISOString(),
                version: "x",
                startedAt: at.toISOString(),
                pid: 1,
              })
            : null,
      }) as never;
    expect(await reportWorkerRestart(redisWith(null), now)).toBeNull();
    expect(await reportWorkerRestart(redisWith(new Date(now.getTime() - 60_000)), now)).toBeNull();

    const r = await reportWorkerRestart(redisWith(new Date(now.getTime() - 10 * 60_000)), now);
    expect(r).toMatchObject({ downMinutes: 10, created: true, resolved: false });
    expect(db.alerts[0]).toMatchObject({ kind: "worker_down" });
    expect(db.alerts[0]?.resolvedAt).not.toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);

    // Deuxième redémarrage dans la journée : dédoublonné, pas de nouvelle alerte.
    const r2 = await reportWorkerRestart(
      redisWith(new Date(now.getTime() - 10 * 60_000)),
      new Date(now.getTime() + 3600_000),
    );
    expect(r2).toMatchObject({ created: false, resolved: false });
    expect(db.alerts).toHaveLength(1);
  });

  it("au redémarrage : résout l'alerte ouverte créée par le site pendant l'absence", async () => {
    const now = new Date("2026-10-09T12:00:00Z");
    await db.prisma.alert.create({
      data: { kind: "worker_down", severity: "CRITICAL", message: "absent" },
    });
    const redis = {
      get: async () =>
        JSON.stringify({
          at: new Date(now.getTime() - 5 * 60_000).toISOString(),
          version: "x",
          startedAt: "x",
          pid: 1,
        }),
    } as never;
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
    db.prisma.bot.findMany.mockResolvedValue([
      { username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null },
    ]);
    db.prisma.player.count.mockReset();
    db.prisma.player.count.mockResolvedValue(0);
  });

  it("crée post_failed depuis les messages en échec puis la résout", async () => {
    db.prisma.post.findMany.mockResolvedValueOnce([
      { code: "m1", lastError: "chat not found", channel: { title: "Casino FR" } },
    ]);
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(1);
    expect(db.alerts[0]).toMatchObject({ kind: "post_failed" });
    expect(db.alerts[0]?.message).toContain("Casino FR / m1");
    const r2 = await runAlerts(new Date("2026-10-09T12:05:00Z"));
    expect(r2.resolved).toBe(1);
  });

  it("chute des inscriptions : lit Player.registeredAt sur 24 h et 7 jours, seuil depuis Setting, nos joueurs seulement", async () => {
    // Nos inscriptions : 11 sur les dernières 24 h (fenêtre gte/lte), 140 sur les 7 jours précédents (fenêtre gte/lt).
    // Sans le filtre « nos joueurs » (phase 8), le total Link Affi global (500 puis 700) masquerait la chute : le test échoue.
    // Les requêtes de la santé du sub-ID (sans fenêtre d'inscription combinée) renvoient 0.
    type R = { gte?: Date; lt?: Date; lte?: Date };
    type W = {
      registeredAt?: R;
      subIdSource?: string;
      AND?: Array<{ registeredAt?: R; OR?: unknown[] }>;
    };
    const counts = ({ where }: { where: W }) => {
      if (where.subIdSource || !where.AND) return 0;
      const r = where.AND.find((x) => x.registeredAt)?.registeredAt;
      const ours = where.AND.some((x) => JSON.stringify(x).includes('"clickId"'));
      if (!ours) return r?.lt ? 700 : r?.lte ? 500 : 0;
      return r?.lt ? 140 : r?.lte ? 11 : 0;
    };
    db.prisma.player.count.mockImplementation((async (args: Parameters<typeof counts>[0]) =>
      counts(args)) as unknown as () => Promise<number>);
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(0); // 11 ≥ 50 % de 20 : pas de chute
    db.settings["alerts.thresholds"] = { registrationsDropPct: 30 };
    const r2 = await runAlerts(new Date("2026-10-09T12:05:00Z"));
    expect(r2.created).toBe(1); // seuil 30 % : limite 14, 11 est en dessous
    expect(db.alerts[0]).toMatchObject({ kind: "registrations_drop" });
  });

  it("santé du sub-ID : date d'inscription Link Affi, pas la date d'import (joueur importé aujourd'hui, inscrit il y a 60 jours)", async () => {
    // 10 joueurs « time_match » importés cette semaine (createdAt récent) mais inscrits il y a 60 jours (registeredAt ancien).
    type W = { subIdSource?: string; createdAt?: unknown; registeredAt?: { gte?: Date } };
    db.prisma.player.count.mockImplementation((async ({ where }: { where: W }) =>
      where.subIdSource === "time_match" && where.createdAt
        ? 10
        : 0) as unknown as () => Promise<number>);
    await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(db.alerts.map((a) => a.kind)).not.toContain("subid_health");
    const calls = db.prisma.player.count.mock.calls as unknown as Array<[{ where: W }]>;
    const health = calls.map(([a]) => a.where).filter((w) => w.subIdSource);
    expect(health.length).toBeGreaterThan(0);
    for (const w of health) {
      expect(w.createdAt).toBeUndefined();
      expect(w.registeredAt?.gte).toBeInstanceOf(Date);
    }
  });

  it("dépense sans conversion : les inscriptions venues de l'offre Link Affi de la campagne comptent (même règle que la campagne)", async () => {
    db.prisma.adCost.findMany.mockResolvedValueOnce([
      { spend: 60, campaignId: "c1", adSet: null, ad: null },
    ]);
    db.prisma.campaign.findMany.mockResolvedValueOnce([
      {
        id: "c1",
        name: "Pub offre",
        channelIds: [],
        affiliateCampaignIds: ["aff1"],
        inviteLinks: [],
        trackingLinks: [],
        adSets: [],
      },
    ]);
    // 3 inscriptions sur l'offre « aff1 » (joueurs sans clic), aucune ailleurs.
    db.prisma.player.count.mockImplementation((async ({ where }: { where: unknown }) =>
      JSON.stringify(where).includes('"aff1"') ? 3 : 0) as unknown as () => Promise<number>);
    await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(db.alerts.map((a) => a.kind)).not.toContain("spend_no_conversion");
  });

  it("dépense sans conversion : coûts rattachés à la pub, zéro inscription", async () => {
    db.prisma.adCost.findMany.mockResolvedValueOnce([
      { spend: 60, campaignId: "c1", adSet: null, ad: null },
      { spend: 10, campaignId: "c2", adSet: null, ad: null },
    ]);
    db.prisma.campaign.findMany.mockResolvedValueOnce([
      { id: "c1", name: "Pub A", inviteLinks: [], trackingLinks: [{ id: "t1" }], adSets: [] },
    ]);
    const r = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r.created).toBe(1);
    expect(db.alerts[0]).toMatchObject({ kind: "spend_no_conversion" });
    // Gains de la fenêtre : commissions 15 (primes par joueur ; pas d'offre, donc pas de part du revenu) − dépense 60.
    expect(db.alerts[0]?.message).toContain("Pub A (60,00 € dépensés, gains −45,00 €)");
  });

  it("liens des canaux à rejoindre impossibles à créer : une alerte, une seule notification, résolue ensuite", async () => {
    gateRows.rows = [
      {
        channelTitle: "Zone Interdite",
        status: "PENDING_GATE",
        missing: [{ title: "LA ZONE ROULETTE", suggestedBot: "womendatingoobot" }],
      },
    ];
    try {
      const r1 = await runAlerts(new Date("2026-10-11T10:00:00Z"));
      expect(r1.created).toBe(1);
      expect(db.alerts[0]).toMatchObject({ kind: "gate_links_missing", severity: "CRITICAL" });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(String((notify.mock.calls[0] as unknown[])[0])).toContain(
        "Liens de canaux à rejoindre impossibles à créer",
      );
      // Toujours là 5 minutes plus tard : ni nouvelle alerte, ni nouvelle notification.
      const r2 = await runAlerts(new Date("2026-10-11T10:05:00Z"));
      expect(r2.created).toBe(0);
      expect(notify).toHaveBeenCalledTimes(1);
      gateRows.rows = [];
      const r3 = await runAlerts(new Date("2026-10-11T10:10:00Z"));
      expect(r3.resolved).toBe(1);
    } finally {
      gateRows.rows = [];
    }
  });

  it("liens des canaux à rejoindre : condition qui disparaît puis revient dans les 24 h → alerte rouverte, une seule notification", async () => {
    // Canal à 10 minutes de délai : chaque demande attend ses liens 10 minutes puis est acceptée ; la suivante arrive
    // plus tard. Avant la correction : une alerte et une notification Telegram par demande, jour et nuit.
    const row = {
      channelTitle: "Zone Interdite",
      status: "SCHEDULED",
      missing: [{ title: "LA ZONE ROULETTE", suggestedBot: "womendatingoobot" }],
    };
    const gateAlerts = () => db.alerts.filter((a) => a.kind === "gate_links_missing");
    try {
      gateRows.rows = [row];
      expect((await runAlerts(new Date("2026-10-11T10:00:00Z"))).created).toBe(1);
      gateRows.rows = [];
      expect((await runAlerts(new Date("2026-10-11T10:15:00Z"))).resolved).toBe(1);
      expect(gateAlerts()[0]?.resolvedAt).not.toBeNull();

      // La demande suivante : même alerte rouverte, sans nouvelle notification.
      gateRows.rows = [{ ...row, status: "PENDING_GATE" }];
      const r3 = await runAlerts(new Date("2026-10-11T11:00:00Z"));
      expect(r3.created).toBe(0);
      expect(gateAlerts()).toHaveLength(1);
      expect(gateAlerts()[0]).toMatchObject({ resolvedAt: null, severity: "CRITICAL" });
      gateRows.rows = [];
      await runAlerts(new Date("2026-10-11T11:15:00Z"));
      gateRows.rows = [row];
      await runAlerts(new Date("2026-10-11T23:00:00Z"));
      expect(gateAlerts()).toHaveLength(1);
      expect(notify).toHaveBeenCalledTimes(1);

      // Plus de 24 h après la première alerte : nouvelle alerte, nouvelle notification (une par jour au plus).
      gateRows.rows = [];
      await runAlerts(new Date("2026-10-12T09:00:00Z"));
      gateRows.rows = [row];
      const r4 = await runAlerts(new Date("2026-10-12T10:30:00Z"));
      expect(r4.created).toBe(1);
      expect(gateAlerts()).toHaveLength(2);
      expect(notify).toHaveBeenCalledTimes(2);
    } finally {
      gateRows.rows = [];
    }
  });

  it("canal qui fuit et lien désactivé cliqué", async () => {
    db.prisma.channel.findMany.mockResolvedValueOnce([{ id: "ch1", title: "VIP" }]);
    db.prisma.membership.groupBy
      .mockResolvedValueOnce([{ channelId: "ch1", _count: { _all: 50 } }])
      .mockResolvedValueOnce([{ channelId: "ch1", _count: { _all: 9 } }]);
    db.prisma.click.groupBy.mockResolvedValueOnce([{ trackingLinkId: "t9", _count: { _all: 2 } }]);
    db.prisma.trackingLink.findMany.mockResolvedValueOnce([
      { id: "t9", slug: "zz", label: "Ancien bonus" },
    ]);
    const r = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r.created).toBe(2);
    expect(db.alerts.map((a) => a.kind).sort()).toEqual(["channel_leak", "offer_link_inactive"]);
  });
});

describe("alertes sur les chiffres désactivées dans Réglages → Alertes", () => {
  type CountArgs = { where: { AND?: unknown } };
  /** Requêtes des inscriptions « nos joueurs » (chute des inscriptions et dépense sans inscription). */
  const ourPlayerCounts = () =>
    (db.prisma.player.count.mock.calls as unknown as Array<[CountArgs]>).filter(
      ([a]) => a.where.AND,
    );

  beforeEach(() => {
    db.alerts.length = 0;
    failures.counts = {};
    for (const k of Object.keys(db.settings)) delete db.settings[k];
    notify.mockClear();
    db.prisma.bot.findMany.mockResolvedValue([
      { username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null },
    ]);
    db.prisma.player.count.mockReset();
    db.prisma.player.count.mockResolvedValue(0);
    db.prisma.channel.findMany.mockClear();
    db.prisma.membership.groupBy.mockClear();
    db.prisma.adCost.findMany.mockClear();
    db.prisma.campaign.findMany.mockClear();
  });

  // Valeurs simulées non consommées (règle coupée) : retirées pour ne pas fausser les tests suivants.
  afterEach(() => {
    db.prisma.channel.findMany.mockReset();
    db.prisma.channel.findMany.mockResolvedValue([]);
    db.prisma.membership.groupBy.mockReset();
    db.prisma.membership.groupBy.mockResolvedValue([]);
    db.prisma.adCost.findMany.mockReset();
    db.prisma.adCost.findMany.mockResolvedValue([]);
    db.prisma.campaign.findMany.mockReset();
    db.prisma.campaign.findMany.mockResolvedValue([]);
  });

  /** Un canal qui perd 9 membres sur 50 en 24 h et une pub à 60 € sans inscrit (lus seulement si la règle tourne). */
  function lossConditions() {
    db.prisma.channel.findMany.mockResolvedValueOnce([{ id: "ch1", title: "VIP" }]);
    db.prisma.membership.groupBy
      .mockResolvedValueOnce([{ channelId: "ch1", _count: { _all: 50 } }])
      .mockResolvedValueOnce([{ channelId: "ch1", _count: { _all: 9 } }]);
    db.prisma.adCost.findMany.mockResolvedValueOnce([
      { spend: 60, campaignId: "c1", adSet: null, ad: null },
    ]);
    db.prisma.campaign.findMany.mockResolvedValueOnce([
      { id: "c1", name: "Pub A", inviteLinks: [], trackingLinks: [{ id: "t1" }], adSets: [] },
    ]);
  }

  it("désactivées : aucune requête, aucune alerte ; l'alerte ouverte se ferme sans notification ; réactivées : de nouveau évaluées", async () => {
    // Alerte « canal qui perd ses membres » ouverte et déjà envoyée avant que l'équipe ne la coupe.
    await db.prisma.alert.create({
      data: {
        kind: "channel_leak",
        severity: "WARNING",
        message: "VIP : 9 départs",
        createdAt: new Date("2026-10-09T11:00:00Z"),
        notifiedAt: new Date("2026-10-09T11:00:00Z"),
      },
    });
    db.settings["alerts.thresholds"] = {
      registrationsDropPct: 50,
      spendNoConversionEur: 50,
      channelLeakPct: 10,
      enabled: { registrations_drop: false, spend_no_conversion: false, channel_leak: false },
    };
    lossConditions();
    const now = new Date("2026-10-09T12:00:00Z");
    const r1 = await runAlerts(now);
    expect(r1.created).toBe(0);
    expect(r1.resolved).toBe(1);
    expect(db.alerts).toHaveLength(1);
    expect(db.alerts[0]).toMatchObject({ kind: "channel_leak", resolvedAt: now });
    expect(notify).not.toHaveBeenCalled();
    // Aucune lecture inutile pour une alerte coupée.
    expect(db.prisma.channel.findMany).not.toHaveBeenCalled();
    expect(db.prisma.membership.groupBy).not.toHaveBeenCalled();
    expect(db.prisma.adCost.findMany).not.toHaveBeenCalled();
    expect(db.prisma.campaign.findMany).not.toHaveBeenCalled();
    expect(ourPlayerCounts()).toHaveLength(0);

    // Réactivées (réglage sans « enabled » : activées par défaut) : les pertes sont de nouveau signalées.
    db.settings["alerts.thresholds"] = { channelLeakPct: 10 };
    const r2 = await runAlerts(new Date("2026-10-09T12:05:00Z"));
    expect(r2.created).toBe(2);
    expect(
      db.alerts
        .filter((a) => !a.resolvedAt)
        .map((a) => a.kind)
        .sort(),
    ).toEqual(["channel_leak", "spend_no_conversion"]);
    expect(ourPlayerCounts().length).toBeGreaterThan(0);
  });

  it("une seule coupée : les deux autres tournent normalement", async () => {
    db.settings["alerts.thresholds"] = { enabled: { channel_leak: false } };
    lossConditions();
    const r = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r.created).toBe(1);
    expect(db.alerts.map((a) => a.kind)).toEqual(["spend_no_conversion"]);
    expect(db.prisma.channel.findMany).not.toHaveBeenCalled();
    expect(db.prisma.adCost.findMany).toHaveBeenCalledTimes(1);
    // Chute des inscriptions évaluée (requêtes « nos joueurs » sur 24 h et 7 jours).
    expect(ourPlayerCounts().length).toBeGreaterThanOrEqual(2);
  });
});

describe("emojis animés refusés par Telegram (phase 12)", () => {
  beforeEach(() => {
    db.alerts.length = 0;
    failures.counts = {};
    notify.mockClear();
    fallbackEvents.rows = [];
    db.prisma.bot.findMany.mockResolvedValue([
      { username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null },
    ]);
  });

  const emojiAlerts = () => db.alerts.filter((a) => a.kind === "custom_emoji_refused");
  const at = (iso: string) => new Date(iso);

  it("une alerte et une seule notification par 24 h, même si les refus continuent ou reviennent", async () => {
    fallbackEvents.rows = [
      { botId: "b1", occurredAt: at("2026-10-11T09:58:00Z"), payload: { resent: true } },
      { botId: "b1", occurredAt: at("2026-10-11T09:59:00Z"), payload: { resent: true } },
    ];
    const r1 = await runAlerts(at("2026-10-11T10:00:00Z"));
    expect(r1.created).toBe(1);
    expect(emojiAlerts()).toHaveLength(1);
    expect(emojiAlerts()[0]).toMatchObject({ severity: "WARNING" });
    expect(emojiAlerts()[0]?.message).toContain(
      "2 messages privés de la dernière heure sont partis avec les emojis normaux",
    );
    expect(notify).toHaveBeenCalledTimes(1);

    // Nouveaux refus 5 minutes plus tard : rien de plus.
    fallbackEvents.rows.push({
      botId: "b1",
      occurredAt: at("2026-10-11T10:03:00Z"),
      payload: { resent: true },
    });
    expect((await runAlerts(at("2026-10-11T10:05:00Z"))).created).toBe(0);
    // Plus aucun refus depuis une heure : résolue.
    expect((await runAlerts(at("2026-10-11T11:10:00Z"))).resolved).toBe(1);
    // Ils reviennent l'après-midi : la même alerte est rouverte, sans nouvelle notification.
    fallbackEvents.rows.push({
      botId: "b1",
      occurredAt: at("2026-10-11T15:00:00Z"),
      payload: { resent: false },
    });
    expect((await runAlerts(at("2026-10-11T15:02:00Z"))).created).toBe(0);
    expect(emojiAlerts()).toHaveLength(1);
    expect(emojiAlerts()[0]?.resolvedAt).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);

    // Plus de 24 h après la première : nouvelle alerte, nouvelle notification.
    await runAlerts(at("2026-10-12T09:00:00Z"));
    fallbackEvents.rows.push({
      botId: "b1",
      occurredAt: at("2026-10-12T10:30:00Z"),
      payload: { resent: true },
    });
    expect((await runAlerts(at("2026-10-12T10:35:00Z"))).created).toBe(1);
    expect(emojiAlerts()).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("aucun refus : aucune alerte", async () => {
    await runAlerts(at("2026-10-11T10:00:00Z"));
    expect(emojiAlerts()).toHaveLength(0);
  });

  it("messages programmés d'un groupe partis avec les emojis normaux : comptés dans la même alerte", async () => {
    fallbackEvents.rows = [
      {
        botId: "b1",
        occurredAt: at("2026-10-11T09:58:00Z"),
        payload: { resent: true },
        type: "post.custom_emoji_fallback",
      },
      { botId: "b1", occurredAt: at("2026-10-11T09:59:00Z"), payload: { resent: true } },
    ];
    expect((await runAlerts(at("2026-10-11T10:00:00Z"))).created).toBe(1);
    expect(emojiAlerts()[0]?.message).toContain(
      "2 messages de la dernière heure (1 message privé, 1 message programmé) sont partis avec les emojis normaux",
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("compte Telegram connecté à reconnecter (phase 12)", () => {
  beforeEach(() => {
    db.alerts.length = 0;
    failures.counts = {};
    notify.mockClear();
    fallbackEvents.rows = [];
    tgAccount.row = null;
    tgAccount.pending = 0;
    db.prisma.bot.findMany.mockResolvedValue([
      { username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null },
    ]);
  });
  const accountAlerts = () => db.alerts.filter((a) => a.kind === "telegram_account_reconnect");
  const at = (iso: string) => new Date(iso);

  it("session en erreur : une alerte critique si des messages avec emojis animés attendent, une notification par jour", async () => {
    tgAccount.row = { status: "ERROR" };
    tgAccount.pending = 2;
    expect((await runAlerts(at("2026-10-11T10:00:00Z"))).created).toBe(1);
    expect(accountAlerts()[0]).toMatchObject({ severity: "CRITICAL" });
    expect(accountAlerts()[0]?.message).toContain(
      "2 messages programmés avec emojis animés ne partiront pas",
    );
    expect(notify).toHaveBeenCalledTimes(1);
    // Toujours en erreur une heure plus tard : rien de plus.
    expect((await runAlerts(at("2026-10-11T11:00:00Z"))).created).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
    // Compte reconnecté : alerte résolue.
    tgAccount.row = { status: "ACTIVE" };
    expect((await runAlerts(at("2026-10-11T12:00:00Z"))).resolved).toBe(1);
    expect(accountAlerts()[0]?.resolvedAt).not.toBeNull();
  });

  it("session active ou absente : aucune alerte", async () => {
    tgAccount.row = { status: "ACTIVE" };
    await runAlerts(at("2026-10-11T10:00:00Z"));
    tgAccount.row = null;
    await runAlerts(at("2026-10-11T10:05:00Z"));
    expect(accountAlerts()).toHaveLength(0);
  });
});
