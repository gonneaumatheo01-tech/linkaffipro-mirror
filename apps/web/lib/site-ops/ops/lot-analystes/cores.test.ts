/**
 * Phase 29 — cœurs de la page Agents → Analyses (règle de la phase 34) : mêmes refus pour le site et Kevin, responsable
 * refusé sur les sources (accepté sur les recommandations), essai à blanc sans écriture, journal avec `via`, mot
 * SUPPRIMER exigé sur le site, et opérations de Kevin (`LOT_ANALYSTES_IMPL`) : source par son nom ou son adresse,
 * recommandation par son numéro. Base simulée.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpActor } from "@linkaffipro/agents";

type Row = Record<string, unknown>;

const m = vi.hoisted(() => ({
  sources: new Map<string, Row>(),
  recs: new Map<string, Row>(),
  entries: 0,
  writes: [] as Array<{ op: string; args: unknown }>,
  audits: [] as Record<string, unknown>[],
}));

vi.mock("@linkaffipro/db", () => {
  const write = (op: string) => async (args: unknown) => {
    m.writes.push({ op, args });
    return {};
  };
  return {
    audit: vi.fn(async (a: Record<string, unknown>) => {
      m.audits.push(a);
    }),
    prisma: {
      trendSource: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => m.sources.get(where.id) ?? null),
        findMany: vi.fn(async ({ where }: { where: { OR: Array<{ name?: { contains: string }; url?: { contains: string } }> } }) => {
          const name = where.OR[0]!.name!.contains.toLowerCase();
          const url = where.OR[1]!.url!.contains.toLowerCase();
          return [...m.sources.values()]
            .filter((s) => String(s.name).toLowerCase().includes(name) || String(s.url).toLowerCase().includes(url))
            .map((s) => ({ id: s.id, name: s.name }));
        }),
        update: write("trendSource.update"),
        delete: write("trendSource.delete"),
      },
      trendEntry: { count: vi.fn(async () => m.entries) },
      recommendation: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => m.recs.get(where.id) ?? null),
        findMany: vi.fn(async () =>
          [...m.recs.values()]
            .filter((r) => r.source === "market_analysis" && r.status === "PROPOSED")
            .sort((a, b) => (b.createdAt as number) - (a.createdAt as number))
            .map((r) => ({ id: r.id })),
        ),
        update: write("recommendation.update"),
      },
    },
  };
});

// Phase 30 : garde du QA Global simulée (approuvée par défaut ; un test la refuse).
const qa = vi.hoisted(() => ({ notApproved: null as string | null }));
vi.mock("@linkaffipro/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linkaffipro/agents")>()),
  recommendationNotApproved: vi.fn(async () => qa.notApproved),
}));

import { LOT_ANALYSTES_IMPL } from "../lot-analystes";
import { DELETE_WORD_ERROR, runActivateSource, runDeactivateSource, runDecideMarketRecommendation, runDeleteSource } from "./cores";

const ADMIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "WEB" };
const MANAGER: SiteOpActor = { userId: "u2", role: "MANAGER", via: "WEB" };
const KEVIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "TELEGRAM", telegramUserId: "42" };

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const impl = (key: string) => LOT_ANALYSTES_IMPL.find((i) => i.key === key)!;

beforeEach(() => {
  m.sources = new Map([
    ["s1", { id: "s1", name: "BlackHatWorld", url: "https://www.blackhatworld.com/forums/gambling", isActive: false, origin: "discovered", errorCount: 0, lastError: null, lastScrapedAt: null }],
    ["s2", { id: "s2", name: "Reddit r/gambling", url: "https://www.reddit.com/r/gambling", isActive: true, origin: "seed", errorCount: 0, lastError: null, lastScrapedAt: new Date() }],
    ["s3", { id: "s3", name: "Reddit r/sportsbetting", url: "https://www.reddit.com/r/sportsbetting", isActive: true, origin: "seed", errorCount: 3, lastError: "403 refusé", lastScrapedAt: new Date() }],
  ]);
  m.recs = new Map([
    ["r1", { id: "r1", source: "market_analysis", status: "PROPOSED", field: "angle", targetId: "CASINO", createdAt: 1 }],
    ["r2", { id: "r2", source: "market_analysis", status: "PROPOSED", field: "format", targetId: "DATING", createdAt: 2 }],
    ["r3", { id: "r3", source: "market_analysis", status: "DONE", field: "format", targetId: "DATING", createdAt: 3 }],
    ["a1", { id: "a1", source: "algo", status: "PROPOSED", field: "mix", targetId: "c1", createdAt: 4 }],
  ]);
  m.entries = 12;
  m.writes = [];
  m.audits = [];
});

describe("sources de la veille", () => {
  it("Activer une source trouvée par la veille : remise à zéro, lue au prochain passage, journal", async () => {
    const r = await runActivateSource(fd({ sourceId: "s1" }), ADMIN);
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("BlackHatWorld") });
    expect(m.writes).toEqual([{ op: "trendSource.update", args: { where: { id: "s1" }, data: expect.objectContaining({ isActive: true, errorCount: 0, lastError: null }) } }]);
    expect(m.audits).toEqual([expect.objectContaining({ userId: "u1", action: "agents.analysts_source_activated", entityType: "TrendSource", entityId: "s1", metadata: expect.objectContaining({ via: "WEB", origin: "discovered" }) })]);
  });

  it("Activer une source en erreur la relance ; déjà active sans erreur : conflit", async () => {
    expect(await runActivateSource(fd({ sourceId: "s3" }), ADMIN)).toMatchObject({ ok: true });
    m.writes = [];
    expect(await runActivateSource(fd({ sourceId: "s2" }), ADMIN)).toMatchObject({ ok: false, code: "conflict", error: "La source « Reddit r/gambling » est déjà active." });
    expect(m.writes).toEqual([]);
  });

  it("Désactiver : plus lue, entrées gardées ; déjà inactive : conflit", async () => {
    expect(await runDeactivateSource(fd({ sourceId: "s2" }), ADMIN)).toMatchObject({ ok: true, message: expect.stringContaining("ses entrées restent") });
    expect(m.writes[0]).toEqual({ op: "trendSource.update", args: { where: { id: "s2" }, data: { isActive: false, nextScrapeAt: null } } });
    expect(m.audits[0]).toMatchObject({ action: "agents.analysts_source_deactivated" });
    expect(await runDeactivateSource(fd({ sourceId: "s1" }), ADMIN)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("Supprimer sur le site : le mot SUPPRIMER est exigé ; avec lui, suppression et journal", async () => {
    expect(await runDeleteSource(fd({ sourceId: "s2", confirm: "oui" }), ADMIN)).toEqual({ ok: false, code: "invalid", field: "confirm", error: DELETE_WORD_ERROR });
    expect(m.writes).toEqual([]);
    const r = await runDeleteSource(fd({ sourceId: "s2", confirm: "SUPPRIMER" }), ADMIN);
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("12 entrées de veille effacées") });
    expect(m.writes).toEqual([{ op: "trendSource.delete", args: { where: { id: "s2" } } }]);
    expect(m.audits[0]).toMatchObject({ action: "agents.analysts_source_deleted", metadata: expect.objectContaining({ entries: 12, via: "WEB" }) });
  });

  it("responsable refusé partout, sans lecture ni écriture ni journal", async () => {
    for (const run of [runActivateSource, runDeactivateSource, runDeleteSource]) {
      const r = await run(fd({ sourceId: "s2", confirm: "SUPPRIMER" }), MANAGER);
      expect(r).toMatchObject({ ok: false, code: "forbidden", error: "Activer, désactiver ou supprimer une source de la veille est réservé aux administrateurs." });
    }
    expect(m.writes).toEqual([]);
    expect(m.audits).toEqual([]);
  });

  it("source inconnue ou identifiant douteux : mêmes erreurs", async () => {
    expect(await runActivateSource(fd({ sourceId: "zz" }), ADMIN)).toMatchObject({ ok: false, code: "not_found", error: "Cette source n'existe plus." });
    expect(await runActivateSource(fd({ sourceId: "../x" }), ADMIN)).toMatchObject({ ok: false, code: "invalid", field: "sourceId" });
  });

  it("essai à blanc : aperçu, rien n'est écrit (même la suppression, sans le mot)", async () => {
    const a = await runActivateSource(fd({ sourceId: "s1" }), KEVIN, { dryRun: true });
    expect(a).toMatchObject({ ok: true, preview: { summary: expect.stringContaining("trouvée par la veille") } });
    const d = await runDeleteSource(fd({ sourceId: "s2" }), KEVIN, { dryRun: true });
    expect(d).toMatchObject({ ok: true, preview: { impact: expect.stringContaining("12 entrées de veille effacées") } });
    expect(await runDeactivateSource(fd({ sourceId: "s2" }), ADMIN, { dryRun: true })).toMatchObject({ ok: true, preview: expect.anything() });
    expect(m.writes).toEqual([]);
    expect(m.audits).toEqual([]);
  });
});

describe("recommandations du marché", () => {
  it("Accepter : état « Acceptée » (APPLIED, par un humain), date, auteur, commentaire ; journal ; aucune action externe", async () => {
    const r = await runDecideMarketRecommendation(fd({ id: "r1", status: "APPLIED", comment: " on teste lundi " }), MANAGER);
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("rien n'est changé chez Meta ni TikTok") });
    expect(m.writes).toEqual([
      { op: "recommendation.update", args: { where: { id: "r1" }, data: { status: "APPLIED", appliedAt: expect.any(Date), appliedBy: "HUMAN", appliedById: "u2", comment: "on teste lundi" } } },
    ]);
    expect(m.audits[0]).toMatchObject({ userId: "u2", action: "agents.analysts_recommendation_accepted", entityId: "r1", metadata: expect.objectContaining({ via: "WEB" }) });
  });

  it("Refuser ; déjà décidée : conflit ; autre équipe : introuvable ; état inconnu : refusé", async () => {
    expect(await runDecideMarketRecommendation(fd({ id: "r2", status: "REJECTED" }), ADMIN)).toMatchObject({ ok: true, message: "Recommandation refusée." });
    expect(m.writes[0]).toMatchObject({ args: { data: { status: "REJECTED", rejectedAt: expect.any(Date), comment: null } } });
    expect(await runDecideMarketRecommendation(fd({ id: "r3", status: "APPLIED" }), ADMIN)).toMatchObject({ ok: false, code: "conflict" });
    expect(await runDecideMarketRecommendation(fd({ id: "a1", status: "APPLIED" }), ADMIN)).toMatchObject({ ok: false, code: "not_found" });
    expect(await runDecideMarketRecommendation(fd({ id: "r1", status: "DONE" }), ADMIN)).toMatchObject({ ok: false, error: "Recommandation inconnue." });
    expect(m.writes).toHaveLength(1);
  });

  it("phase 30 : pas encore approuvée par le QA Global → jamais acceptée (refuser reste possible)", async () => {
    qa.notApproved = "Cette proposition est encore en vérification : je te la montre dès qu'elle est validée.";
    try {
      expect(await runDecideMarketRecommendation(fd({ id: "r1", status: "APPLIED" }), ADMIN)).toMatchObject({ ok: false, code: "conflict", error: expect.stringContaining("en vérification") });
      expect(m.writes).toEqual([]);
      expect(await runDecideMarketRecommendation(fd({ id: "r1", status: "REJECTED" }), ADMIN)).toMatchObject({ ok: true });
    } finally {
      qa.notApproved = null;
    }
  });

  it("essai à blanc : rien n'est écrit", async () => {
    expect(await runDecideMarketRecommendation(fd({ id: "r1", status: "APPLIED" }), KEVIN, { dryRun: true })).toMatchObject({ ok: true, preview: expect.anything() });
    expect(m.writes).toEqual([]);
    expect(m.audits).toEqual([]);
  });
});

describe("opérations de Kevin (mêmes cœurs)", () => {
  it("les quatre opérations sont enregistrées", () => {
    expect(LOT_ANALYSTES_IMPL.map((i) => i.key)).toEqual([
      "agents.analyses_source_activer",
      "agents.analyses_source_desactiver",
      "agents.analyses_source_supprimer",
      "agents.analyses_recommandation",
    ]);
  });

  it("source par son nom exact ou son adresse ; nom ambigu : question ; suppression sans le mot du site", async () => {
    expect(await impl("agents.analyses_source_activer").run({ source: "blackhatworld" }, KEVIN, {})).toMatchObject({ ok: true });
    expect(m.audits[0]).toMatchObject({ entityId: "s1", metadata: expect.objectContaining({ via: "TELEGRAM" }) });
    expect(await impl("agents.analyses_source_desactiver").run({ source: "reddit.com/r/gambling" }, KEVIN, {})).toMatchObject({ ok: true });
    const amb = await impl("agents.analyses_source_desactiver").run({ source: "Reddit" }, KEVIN, {});
    expect(amb).toMatchObject({ ok: false, code: "invalid", field: "source", error: expect.stringContaining("Plusieurs sources") });
    expect(await impl("agents.analyses_source_supprimer").run({ source: "Reddit r/sportsbetting" }, KEVIN, {})).toMatchObject({ ok: true });
    expect(await impl("agents.analyses_source_activer").run({ source: "inconnu" }, KEVIN, {})).toMatchObject({ ok: false, code: "not_found" });
  });

  it("responsable par Kevin : même refus que sur le site", async () => {
    const r = await impl("agents.analyses_source_supprimer").run({ source: "BlackHatWorld" }, { ...KEVIN, role: "MANAGER" }, {});
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(m.writes).toEqual([]);
  });

  it("recommandation par numéro (la plus récente = 1) et décision en mots", async () => {
    expect(await impl("agents.analyses_recommandation").run({ numero: "1", decision: "accepter" }, KEVIN, {})).toMatchObject({ ok: true });
    expect(m.writes[0]).toMatchObject({ args: { where: { id: "r2" }, data: { status: "APPLIED" } } });
    expect(await impl("agents.analyses_recommandation").run({ numero: "9", decision: "refuser" }, KEVIN, {})).toMatchObject({ ok: false, code: "not_found" });
    expect(await impl("agents.analyses_recommandation").run({ numero: "1", decision: "peut-être" }, KEVIN, {})).toMatchObject({ ok: false, field: "decision" });
  });
});
