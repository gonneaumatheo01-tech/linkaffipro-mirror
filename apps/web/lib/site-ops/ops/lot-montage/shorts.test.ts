/**
 * Phase 28 — cœurs de la page Agents → Montage (règle de la phase 34) : mêmes refus pour le site et Kevin, responsable
 * refusé, essai à blanc sans écriture ni moteur, journal avec `via`, moteur absent = « pas encore disponible », et
 * opérations de Kevin (`LOT_MONTAGE_IMPL`) : short par son numéro dans le montage le plus récent. Base et moteur simulés.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpActor } from "@linkaffipro/agents";

type Row = Record<string, unknown>;

const m = vi.hoisted(() => ({
  clips: new Map<string, Row>(),
  jobs: new Map<string, Row>(),
  writes: [] as string[],
  audits: [] as Record<string, unknown>[],
  engine: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

const clipRow = (id: string) => {
  const c = m.clips.get(id);
  if (!c) return null;
  const job = m.jobs.get(c.montageJobId as string)!;
  return { ...c, montageJob: { status: job.status, shortCount: 0 } };
};

vi.mock("@linkaffipro/db", () => {
  const write = (name: string) => async () => {
    m.writes.push(name);
    return {};
  };
  return {
    audit: vi.fn(async (a: Record<string, unknown>) => {
      m.audits.push(a);
    }),
    prisma: {
      shortClip: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => clipRow(where.id)),
        findFirst: vi.fn(async ({ where }: { where: { montageJobId: string; index: number } }) => {
          for (const c of m.clips.values()) if (c.montageJobId === where.montageJobId && c.index === where.index) return { id: c.id };
          return null;
        }),
        update: write("shortClip.update"),
      },
      montageJob: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const j = m.jobs.get(where.id);
          if (!j) return null;
          return { ...j, shorts: [...m.clips.values()].filter((c) => c.montageJobId === j.id).map((c) => ({ status: c.status })) };
        }),
        findFirst: vi.fn(async ({ where }: { where?: { status?: { notIn: string[] } } }) => {
          const all = [...m.jobs.values()].sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
          const pick = where?.status ? all.find((j) => !where.status!.notIn.includes(j.status as string)) : all[0];
          return pick ? { id: pick.id } : null;
        }),
        update: write("montageJob.update"),
      },
    },
  };
});
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({ deps: true }) }));
vi.mock("@/lib/agents/montage-engine", () => ({ loadMontageEngine: vi.fn(async () => m.engine) }));

import { LOT_MONTAGE_IMPL } from "../lot-montage";
import { ADMIN_ONLY_CANCEL, ADMIN_ONLY_SHORT, NOT_YET, runApproveShort, runCancelMontage, runModifyShort, runRejectShort } from "./shorts";

const ADMIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "WEB" };
const MANAGER: SiteOpActor = { userId: "u2", role: "MANAGER", via: "WEB" };
const KEVIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "TELEGRAM", telegramUserId: "42" };

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  m.jobs = new Map([
    ["j1", { id: "j1", status: "PREVIEW", createdAt: 1 }],
    ["j2", { id: "j2", status: "DONE", createdAt: 0 }],
  ]);
  m.clips = new Map([
    ["c1", { id: "c1", index: 1, status: "PREVIEW_SENT", montageJobId: "j1" }],
    ["c2", { id: "c2", index: 2, status: "APPROVED", montageJobId: "j1" }],
    ["c3", { id: "c3", index: 3, status: "CUTTING", montageJobId: "j1" }],
    ["c9", { id: "c9", index: 1, status: "PREVIEW_SENT", montageJobId: "j2" }],
  ]);
  m.writes = [];
  m.audits = [];
  m.engine = {
    decideShort: vi.fn(async () => ({ ok: true })),
    redoClip: vi.fn(async () => ({ ok: true })),
    cancelJob: vi.fn(async () => ({ ok: true })),
  };
});

describe("Valider / Refuser un short", () => {
  it("valider : `decideShort` « ok » (même effet que ✅), journal avec `via`", async () => {
    const r = await runApproveShort(fd({ clipId: "c1" }), ADMIN);
    expect(r).toEqual({ ok: true, message: "Le short 1 est validé : il est prêt dans la médiathèque. Rien n'est publié sans vous." });
    expect(m.engine.decideShort).toHaveBeenCalledWith({ deps: true }, "c1", "ok", { userId: "u1", via: "SITE" }, null);
    expect(m.audits).toEqual([
      expect.objectContaining({
        userId: "u1",
        action: "agents.montage_short_approved",
        entityType: "ShortClip",
        entityId: "c1",
        metadata: { montageJobId: "j1", index: 1, previousStatus: "PREVIEW_SENT", ok: true, via: "WEB" },
      }),
    ]);
  });

  it("refuser : `decideShort` « no » avec la raison, archivé (aucune suppression)", async () => {
    m.clips.get("c2")!.status = "QC_FAILED";
    const r = await runRejectShort(fd({ clipId: "c2", reason: "  trop  sombre " }), KEVIN);
    expect(r.ok && r.message).toContain("archivé, pas supprimé");
    expect(m.engine.decideShort).toHaveBeenCalledWith({ deps: true }, "c2", "no", { userId: "u1", via: "TELEGRAM" }, "trop sombre");
    expect(m.audits[0]).toMatchObject({ action: "agents.montage_short_rejected", metadata: { reason: "trop sombre", via: "TELEGRAM" } });
  });

  it("mêmes refus : responsable, identifiant douteux, short disparu, pas prêt, déjà décidé, montage arrêté", async () => {
    expect(await runApproveShort(fd({ clipId: "c1" }), MANAGER)).toEqual({ ok: false, error: ADMIN_ONLY_SHORT, code: "forbidden" });
    expect(await runApproveShort(fd({ clipId: "../x" }), ADMIN)).toMatchObject({ ok: false, error: "Short inconnu.", field: "clipId" });
    expect(await runApproveShort(fd({ clipId: "zz" }), ADMIN)).toMatchObject({ ok: false, code: "not_found" });
    expect(await runApproveShort(fd({ clipId: "c3" }), ADMIN)).toMatchObject({ ok: false, error: "Le short 3 n'est pas encore prêt : attendez son aperçu.", code: "conflict" });
    expect(await runApproveShort(fd({ clipId: "c2" }), ADMIN)).toMatchObject({ ok: false, error: "Le short 2 est déjà validé : pour changer d'avis, demandez une modification.", code: "conflict" });
    m.clips.get("c2")!.status = "QC_FAILED";
    expect(await runApproveShort(fd({ clipId: "c2" }), ADMIN)).toMatchObject({ ok: false, code: "conflict" });
    m.jobs.get("j1")!.status = "CANCELLED";
    expect(await runRejectShort(fd({ clipId: "c1" }), ADMIN)).toMatchObject({ ok: false, error: "Ce montage est arrêté : plus rien à décider." });
    expect(m.engine.decideShort).not.toHaveBeenCalled();
    expect(m.audits).toEqual([]);
  });

  it("moteur pas encore livré : « pas encore disponible », rien d'écrit ; refus du moteur rendu tel quel", async () => {
    m.engine = {};
    expect(await runApproveShort(fd({ clipId: "c1" }), ADMIN)).toEqual({ ok: false, error: NOT_YET, code: "unavailable" });
    m.engine = { decideShort: vi.fn(async () => ({ ok: false, message: "Ce short a déjà été publié." })) };
    expect(await runApproveShort(fd({ clipId: "c1" }), ADMIN)).toEqual({ ok: false, error: "Ce short a déjà été publié.", code: "conflict" });
    expect(m.audits[0]).toMatchObject({ metadata: expect.objectContaining({ ok: false }) });
    m.engine = { decideShort: vi.fn(async () => Promise.reject(new Error("base injoignable"))) };
    expect(await runApproveShort(fd({ clipId: "c1" }), ADMIN)).toMatchObject({ error: "Décision impossible pour l'instant : base injoignable." });
  });
});

describe("Modifier un short", () => {
  it("`redoClip` avec la modification écrite, journal", async () => {
    const r = await runModifyShort(fd({ clipId: "c2", change: "raccourcis de 2 secondes" }), ADMIN);
    expect(r.ok).toBe(true);
    expect(m.engine.redoClip).toHaveBeenCalledWith({ deps: true }, "c2", "raccourcis de 2 secondes", { userId: "u1", via: "SITE" });
    expect(m.audits[0]).toMatchObject({ action: "agents.montage_short_modified", entityId: "c2", metadata: { change: "raccourcis de 2 secondes", via: "WEB" } });
  });

  it("modification vide ou trop longue, short en fabrication, responsable", async () => {
    expect(await runModifyShort(fd({ clipId: "c1", change: " " }), ADMIN)).toMatchObject({ ok: false, field: "change" });
    expect(await runModifyShort(fd({ clipId: "c1", change: "x".repeat(501) }), ADMIN)).toMatchObject({ ok: false, field: "change" });
    expect(await runModifyShort(fd({ clipId: "c3", change: "plus court" }), ADMIN)).toMatchObject({ error: "Le short 3 est déjà en cours de fabrication." });
    expect(await runModifyShort(fd({ clipId: "c1", change: "plus court" }), MANAGER)).toMatchObject({ code: "forbidden" });
    expect(m.engine.redoClip).not.toHaveBeenCalled();
  });
});

describe("Annuler un montage", () => {
  it("`cancelJob`, les shorts validés restent ; journal", async () => {
    const r = await runCancelMontage(fd({ jobId: "j1" }), ADMIN);
    expect(r).toEqual({ ok: true, message: "Montage annulé : les shorts pas encore faits sont abandonnés. Le short déjà validé reste dans la médiathèque." });
    expect(m.engine.cancelJob).toHaveBeenCalledWith({ deps: true }, "j1", { userId: "u1", via: "SITE" });
    expect(m.audits[0]).toMatchObject({ action: "agents.montage_cancelled", entityType: "MontageJob", entityId: "j1", metadata: { previousStatus: "PREVIEW", approved: 1, ok: true, via: "WEB" } });
  });

  it("responsable refusé, montage fini, montage inconnu", async () => {
    expect(await runCancelMontage(fd({ jobId: "j1" }), MANAGER)).toEqual({ ok: false, error: ADMIN_ONLY_CANCEL, code: "forbidden" });
    expect(await runCancelMontage(fd({ jobId: "j2" }), ADMIN)).toMatchObject({ code: "conflict" });
    expect(await runCancelMontage(fd({ jobId: "nope" }), ADMIN)).toMatchObject({ code: "not_found" });
    expect(await runCancelMontage(fd({}), ADMIN)).toMatchObject({ field: "jobId" });
    expect(m.engine.cancelJob).not.toHaveBeenCalled();
  });
});

describe("essai à blanc : tout est vérifié, rien n'est écrit ni appelé", () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["valider", () => runApproveShort(fd({ clipId: "c1" }), ADMIN, { dryRun: true })],
    ["refuser", () => runRejectShort(fd({ clipId: "c1" }), ADMIN, { dryRun: true })],
    ["modifier", () => runModifyShort(fd({ clipId: "c1", change: "plus court" }), ADMIN, { dryRun: true })],
    ["annuler", () => runCancelMontage(fd({ jobId: "j1" }), ADMIN, { dryRun: true })],
  ];
  it.each(cases)("%s", async (_n, run) => {
    const r = (await run()) as { ok: boolean; preview?: { summary: string } };
    expect(r.ok).toBe(true);
    expect(r.preview?.summary).toBeTruthy();
    expect(m.writes).toEqual([]);
    expect(m.audits).toEqual([]);
    for (const f of Object.values(m.engine)) expect(f).not.toHaveBeenCalled();
  });

  it("un essai à blanc refuse comme le vrai (responsable, short pas prêt)", async () => {
    expect(await runApproveShort(fd({ clipId: "c1" }), MANAGER, { dryRun: true })).toMatchObject({ code: "forbidden" });
    expect(await runApproveShort(fd({ clipId: "c3" }), ADMIN, { dryRun: true })).toMatchObject({ code: "conflict" });
  });
});

describe("opérations de Kevin (LOT_MONTAGE_IMPL)", () => {
  const impl = (k: string) => LOT_MONTAGE_IMPL.find((i) => i.key === k)!;

  it("quatre opérations, clés uniques", () => {
    expect(LOT_MONTAGE_IMPL.map((i) => i.key)).toEqual(["agents.short_valider", "agents.short_modifier", "agents.short_refuser", "agents.montage_annuler"]);
  });

  it("« valide le short 1 » : le short 1 du montage en cours (pas celui d'un montage fini)", async () => {
    const r = await impl("agents.short_valider").run({ short: 1 }, KEVIN, {});
    expect(r.ok).toBe(true);
    expect(m.engine.decideShort).toHaveBeenCalledWith({ deps: true }, "c1", "ok", { userId: "u1", via: "TELEGRAM" }, null);
  });

  it("« le 2, raccourcis de 2 secondes » ; montage donné par son identifiant", async () => {
    await impl("agents.short_modifier").run({ short: "2", modification: "raccourcis de 2 secondes" }, KEVIN, {});
    expect(m.engine.redoClip).toHaveBeenCalledWith({ deps: true }, "c2", "raccourcis de 2 secondes", { userId: "u1", via: "TELEGRAM" });
    await impl("agents.short_refuser").run({ short: 1, montage: "j2", raison: "flou" }, KEVIN, {});
    expect(m.engine.decideShort).toHaveBeenCalledWith({ deps: true }, "c9", "no", expect.anything(), "flou");
  });

  it("short absent ou numéro manquant : refus clair", async () => {
    expect(await impl("agents.short_valider").run({ short: 8 }, KEVIN, {})).toMatchObject({ ok: false, error: "Pas de short 8 dans ce montage.", code: "not_found" });
    expect(await impl("agents.short_valider").run({}, KEVIN, {})).toMatchObject({ ok: false, field: "short" });
  });

  it("« annule le montage en cours » : le plus récent en cours ; essai à blanc sans appel", async () => {
    const dry = await impl("agents.montage_annuler").run({}, KEVIN, { dryRun: true });
    expect(dry).toMatchObject({ ok: true, preview: { summary: expect.stringContaining("Annuler ce montage") } });
    expect(m.engine.cancelJob).not.toHaveBeenCalled();
    await impl("agents.montage_annuler").run({ montage: "dernier" }, KEVIN, {});
    expect(m.engine.cancelJob).toHaveBeenCalledWith({ deps: true }, "j1", expect.anything());
  });

  it("aucun montage : Kevin le dit", async () => {
    m.jobs.clear();
    m.clips.clear();
    expect(await impl("agents.montage_annuler").run({}, KEVIN, {})).toMatchObject({ ok: false, code: "not_found" });
  });

  it("un responsable ne décide pas par Kevin non plus", async () => {
    expect(await impl("agents.short_valider").run({ short: 1 }, { ...MANAGER, via: "TELEGRAM" }, {})).toMatchObject({ code: "forbidden" });
  });
});
