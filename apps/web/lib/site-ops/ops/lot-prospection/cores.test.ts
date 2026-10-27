/**
 * Phase 31 — cœurs de la page Agents → Prospection (règle de la phase 34) : mêmes refus pour le site et Kevin,
 * « ne plus montrer », réglages, pauses et validation des repères réservés aux administrateurs, essai à blanc sans
 * écriture, journal avec `via`, canal hors Europe introuvable, lien d'invitation privé refusé, et opérations de Kevin
 * (`LOT_PROSPECTION_IMPL`) : canal par son @nom, statut en mots. Base simulée ; aucun envoi possible.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpActor } from "@linkaffipro/agents";

type Row = Record<string, unknown>;

const m = vi.hoisted(() => ({
  prospects: new Map<string, Row>(),
  offers: new Map<string, Row>(),
  settings: new Map<string, unknown>(),
  writes: [] as Array<{ op: string; args: unknown }>,
  audits: [] as Record<string, unknown>[],
  transitions: [] as Array<{ id: string; to: string; opts: Record<string, unknown> }>,
  added: [] as string[],
}));

const visible = (p: Row, where: unknown) => {
  const s = JSON.stringify(where);
  return p.region !== "NON_EU" || !s.includes('"not":"NON_EU"');
};
const idOf = (where: unknown): string | null => {
  const s = JSON.stringify(where);
  const hit = s.match(/"id":"([^"]+)"/);
  return hit ? hit[1]! : null;
};

vi.mock("@linkaffipro/db", () => {
  const write = (op: string) => async (args: unknown) => {
    m.writes.push({ op, args });
    return { id: "new-offer-id-0001" };
  };
  return {
    audit: vi.fn(async (a: Record<string, unknown>) => {
      m.audits.push(a);
    }),
    prisma: {
      prospect: {
        findFirst: vi.fn(async ({ where }: { where: unknown }) => {
          const s = JSON.stringify(where);
          const id = idOf(where);
          const user = s.match(/"username":"([^"]+)"/)?.[1];
          for (const p of m.prospects.values()) if ((id && p.id === id) || (user && p.username === user)) return visible(p, where) || !s.includes("NON_EU") ? p : null;
          return null;
        }),
        findMany: vi.fn(async ({ where }: { where: unknown }) => {
          const ids = JSON.stringify(where).match(/"in":\[([^\]]*)\]/)?.[1]?.replace(/"/g, "").split(",") ?? [];
          return [...m.prospects.values()].filter((p) => ids.includes(p.id as string) && visible(p, where));
        }),
        count: vi.fn(async ({ where }: { where: unknown }) => [...m.prospects.values()].filter((p) => p.id === idOf(where) && visible(p, where)).length),
      },
      affiliateOffer: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => m.offers.get(where.id) ?? null),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => [...m.offers.values()]),
        create: write("affiliateOffer.create"),
        update: write("affiliateOffer.update"),
      },
      setting: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (m.settings.has(where.key) ? { value: m.settings.get(where.key) } : null)),
        findMany: vi.fn(async () => [...m.settings.entries()].map(([key, value]) => ({ key, value }))),
        upsert: vi.fn((args: { where: { key: string }; update: { value: unknown } }) => {
          m.writes.push({ op: "setting.upsert", args });
          m.settings.set(args.where.key, args.update.value);
          return Promise.resolve({});
        }),
      },
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
    },
  };
});

vi.mock("@linkaffipro/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linkaffipro/agents")>()),
  transitionProspect: vi.fn(async (_d: unknown, id: string, to: string, opts: Record<string, unknown>) => {
    m.transitions.push({ id, to, opts });
    return { ok: true, from: "QUALIFIED", to };
  }),
  snoozeProspect: vi.fn(async () => ({ ok: true, until: new Date("2026-11-03T00:00:00Z") })),
  addProspectNote: vi.fn(async () => ({ ok: true, id: "note1" })),
  addManualProspect: vi.fn(async (_d: unknown, input: { url: string }) => {
    m.added.push(input.url);
    return { ok: true, prospectId: "newprospect0001", created: true, unreadable: false };
  }),
}));

vi.mock("@/lib/agents/prospection/deps", () => ({ buildProspectionDeps: () => ({}) }));
vi.mock("@/lib/agents/prospection/queries", async (importOriginal) => {
  const { readProspectionSettings } = await import("@/lib/agents/prospection/settings");
  const { DEFAULT_COUNTRIES_SCOPE } = await import("@linkaffipro/agents");
  return {
    ...(await importOriginal<typeof import("@/lib/agents/prospection/queries")>()),
    loadScope: vi.fn(async () => [...DEFAULT_COUNTRIES_SCOPE]),
    loadProspectionSettings: vi.fn(async () => readProspectionSettings(Object.fromEntries(m.settings))),
    loadDictionaries: vi.fn(async () => ({
      view: { brands: [{ name: "Winamax", country: "FR", type: "both", status: "local", offshoreNonEu: false, added: false }], queryParams: [], pathMarkers: [], shorteners: ["bit.ly"], promoCodeLabels: {}, contactLabels: {} },
      proposals: [],
    })),
  };
});

import { LOT_PROSPECTION_IMPL } from "../lot-prospection";
import {
  BLACKLIST_ADMIN_ONLY,
  manualUrl,
  runAddManualProspect,
  runBulkProspectStatus,
  runDecideDict,
  runProposeDict,
  runProspectStatus,
  runSaveOffer,
  runSaveSettings,
  runSourcePause,
  statusFromWords,
} from "./cores";

const ADMIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "WEB" };
const MANAGER: SiteOpActor = { userId: "u2", role: "MANAGER", via: "WEB" };
const KEVIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "TELEGRAM", telegramUserId: "42" };

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const impl = (key: string) => LOT_PROSPECTION_IMPL.find((i) => i.key === key)!;

beforeEach(() => {
  m.prospects = new Map([
    ["prospect00001", { id: "prospect00001", title: "Paris Foot", username: "parisfoot", channelUrl: "https://t.me/parisfoot", status: "QUALIFIED", region: "EU" }],
    ["prospect00002", { id: "prospect00002", title: "Pronos MX", username: "pronosmx", channelUrl: "https://t.me/pronosmx", status: "QUALIFIED", region: "NON_EU" }],
    ["prospect00003", { id: "prospect00003", title: "Casino Live", username: "casinolive", channelUrl: "https://t.me/casinolive", status: "BLACKLISTED", region: "EU" }],
  ]);
  m.offers = new Map();
  m.settings = new Map();
  m.writes = [];
  m.audits = [];
  m.transitions = [];
  m.added = [];
});

describe("statut d'un canal", () => {
  it("essai à blanc : aperçu, rien d'écrit", async () => {
    const r = await runProspectStatus(fd({ prospectId: "prospect00001", status: "CONTACTED" }), ADMIN, { dryRun: true });
    expect(r).toMatchObject({ ok: true, preview: { summary: expect.stringContaining("@parisfoot") } });
    expect(m.transitions).toEqual([]);
    expect(m.audits).toEqual([]);
  });

  it("transition du client, journal avec via", async () => {
    const r = await runProspectStatus(fd({ prospectId: "prospect00001", status: "SIGNED", dealType: "CPA", cpa: "100" }), ADMIN);
    expect(r.ok).toBe(true);
    expect(m.transitions[0]).toMatchObject({ id: "prospect00001", to: "SIGNED", opts: { by: "client", dealType: "CPA", dealTerms: { cpa: 100, currency: "EUR" } } });
    expect(m.audits[0]).toMatchObject({ action: "agents.prospect_status_changed", entityId: "prospect00001", metadata: expect.objectContaining({ via: "WEB" }) });
  });

  it("« ne plus montrer » : administrateurs seulement", async () => {
    expect(await runProspectStatus(fd({ prospectId: "prospect00001", status: "BLACKLISTED" }), MANAGER)).toMatchObject({ ok: false, code: "forbidden", error: BLACKLIST_ADMIN_ONLY });
  });

  it("transition interdite (statut terminal) refusée", async () => {
    expect(await runProspectStatus(fd({ prospectId: "prospect00003", status: "CONTACTED" }), ADMIN)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("canal hors Europe : introuvable", async () => {
    expect(await runProspectStatus(fd({ prospectId: "prospect00002", status: "CONTACTED" }), ADMIN)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("plusieurs à la fois : seuls ceux qui le permettent", async () => {
    const r = await runBulkProspectStatus(fd({ status: "CONTACTED", ids: ["prospect00001", "prospect00002", "prospect00003"] }), MANAGER);
    expect(r.ok).toBe(true);
    expect(m.transitions.map((t) => t.id)).toEqual(["prospect00001"]);
  });

  it("Kevin : canal par @nom, statut en mots", async () => {
    expect(statusFromWords("a répondu")).toBe("RESPONDED");
    expect(statusFromWords("pas intéressé")).toBe("SKIPPED");
    const r = await impl("agents.prospection_statut").run({ canal: "t.me/parisfoot", statut: "contacté" }, KEVIN, {});
    expect(r.ok).toBe(true);
    expect(m.audits[0]).toMatchObject({ metadata: expect.objectContaining({ via: "TELEGRAM" }) });
  });
});

describe("ajout à la main", () => {
  it("lien public seulement ; jamais un lien d'invitation privé", () => {
    expect(manualUrl("https://t.me/s/NomCanal")).toEqual({ ok: true, url: "https://t.me/nomcanal", username: "nomcanal" });
    expect(manualUrl("@nomcanal")).toMatchObject({ ok: true });
    expect(manualUrl("https://t.me/+AbCdEf")).toMatchObject({ ok: false });
    expect(manualUrl("https://t.me/joinchat/xyz")).toMatchObject({ ok: false });
  });

  it("déjà connu : refusé ; nouveau : ajouté et journalisé", async () => {
    expect(await runAddManualProspect(fd({ url: "@parisfoot" }), MANAGER)).toMatchObject({ ok: false, code: "conflict" });
    const r = await runAddManualProspect(fd({ url: "t.me/nouveaucanal" }), MANAGER);
    expect(r).toMatchObject({ ok: true, data: { prospectId: "newprospect0001" } });
    expect(m.added).toEqual(["https://t.me/nouveaucanal"]);
  });
});

describe("offres, repères, sources, réglages", () => {
  it("offre : essai à blanc puis création", async () => {
    const input = { brand: "Celsius", vertical: "CASINO", countries: "FR BE", cpa: "120" };
    expect(await runSaveOffer(fd(input), MANAGER, { dryRun: true })).toMatchObject({ ok: true, preview: expect.anything() });
    expect(m.writes).toEqual([]);
    expect((await runSaveOffer(fd(input), MANAGER)).ok).toBe(true);
    expect(m.writes[0]!.op).toBe("affiliateOffer.create");
  });

  it("proposition puis validation (administrateurs) vers les ajouts", async () => {
    expect(await runProposeDict(fd({ kind: "brand", value: "Winamax" }), MANAGER)).toMatchObject({ ok: false, code: "conflict" });
    const r = await runProposeDict(fd({ kind: "brand", value: "Celsius", country: "FR" }), MANAGER);
    expect(r.ok).toBe(true);
    const id = (r as unknown as { data: { proposalId: string } }).data.proposalId;
    expect(await runDecideDict(fd({ proposalId: id, decision: "APPROVED" }), MANAGER)).toMatchObject({ ok: false, code: "forbidden" });
    expect((await runDecideDict(fd({ proposalId: id, decision: "APPROVED" }), ADMIN)).ok).toBe(true);
    expect(m.settings.get("prospection.dict_additions")).toMatchObject({ brands: [{ name: "Celsius", country: "FR" }] });
  });

  it("pause d'une source : administrateurs", async () => {
    expect(await runSourcePause(fd({ source: "directories", action: "pause", days: "7" }), MANAGER)).toMatchObject({ ok: false, code: "forbidden" });
    expect((await runSourcePause(fd({ source: "directories", action: "pause", days: "7" }), ADMIN)).ok).toBe(true);
    expect(m.settings.get("prospection.source_pauses")).toHaveProperty("directories");
  });

  it("réglages : administrateurs, essai à blanc avec les changements", async () => {
    expect(await runSaveSettings(fd({ dailyTopCount: "15" }), MANAGER)).toMatchObject({ ok: false, code: "forbidden" });
    const r = await runSaveSettings(fd({ dailyTopCount: "15" }), ADMIN, { dryRun: true });
    expect(r).toMatchObject({ ok: true, preview: { summary: expect.stringContaining("10 → 15") } });
    expect(m.writes).toEqual([]);
  });
});
