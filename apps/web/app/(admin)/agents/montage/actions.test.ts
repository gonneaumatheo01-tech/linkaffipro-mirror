import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de la fiche d'un montage (phase 28) : Valider / Modifier / Refuser un short et Annuler le montage passent par
// les cœurs uniques (que Kevin appelle aussi), écrivent le journal des actions et reviennent sur la fiche (au short).
// Réservées aux administrateurs. Base et moteur de l'équipe simulés.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  clip: { id: "c1", index: 4, status: "PREVIEW_SENT", montageJobId: "j1", montageJob: { status: "PREVIEW", shortCount: 5 } } as Record<string, unknown> | null,
  job: { id: "j1", status: "PREVIEW", shorts: [{ status: "APPROVED" }, { status: "PREVIEW_SENT" }] } as Record<string, unknown> | null,
  audit: vi.fn(async (_a: unknown) => {}),
  engine: {} as Record<string, ReturnType<typeof vi.fn>>,
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn((p: string) => m.revalidated.push(p)) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({ deps: true }) }));
vi.mock("@/lib/agents/montage-engine", () => ({ loadMontageEngine: vi.fn(async () => m.engine) }));
vi.mock("@linkaffipro/db", () => ({
  audit: m.audit,
  prisma: {
    shortClip: { findUnique: vi.fn(async () => m.clip) },
    montageJob: { findUnique: vi.fn(async () => m.job) },
  },
}));

import { approveShortAction, cancelMontageAction, modifyShortAction, rejectShortAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return decodeURIComponent(String((err as Error).message).replace(/\+/g, " "));
  }
  throw new Error("aucune redirection");
}

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.clip = { id: "c1", index: 4, status: "PREVIEW_SENT", montageJobId: "j1", montageJob: { status: "PREVIEW", shortCount: 5 } };
  m.job = { id: "j1", status: "PREVIEW", shorts: [{ status: "APPROVED" }, { status: "PREVIEW_SENT" }] };
  m.audit.mockClear();
  m.revalidated = [];
  m.engine = {
    decideShort: vi.fn(async () => ({ ok: true })),
    redoClip: vi.fn(async () => ({ ok: true })),
    cancelJob: vi.fn(async () => ({ ok: true })),
  };
});

describe("boutons d'un short", () => {
  it("Valider : même effet que ✅ chez Kevin, journal, retour au short", async () => {
    const url = await redirectOf(approveShortAction(fd({ jobId: "j1", clipId: "c1" })));
    expect(m.engine.decideShort).toHaveBeenCalledWith({ deps: true }, "c1", "ok", { userId: "u1", via: "SITE" }, null);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", action: "agents.montage_short_approved", entityId: "c1", metadata: expect.objectContaining({ via: "WEB", ok: true }) }));
    expect(url).toContain("/agents/montage/j1?ok=Le short 4 est validé");
    expect(url).toMatch(/#short-c1$/);
    expect(m.revalidated).toEqual(["/agents/montage", "/agents/montage/j1"]);
  });

  it("Refuser : archivé, avec la raison", async () => {
    const url = await redirectOf(rejectShortAction(fd({ jobId: "j1", clipId: "c1", reason: "trop court" })));
    expect(m.engine.decideShort).toHaveBeenCalledWith({ deps: true }, "c1", "no", expect.anything(), "trop court");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.montage_short_rejected" }));
    expect(url).toContain("archivé, pas supprimé");
  });

  it("Modifier : la modification part à la chaîne ; texte manquant : erreur sur la fiche", async () => {
    const url = await redirectOf(modifyShortAction(fd({ jobId: "j1", clipId: "c1", change: "raccourcis de 2 secondes" })));
    expect(m.engine.redoClip).toHaveBeenCalledWith({ deps: true }, "c1", "raccourcis de 2 secondes", expect.anything());
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.montage_short_modified" }));
    expect(url).toContain("ok=Le short 4 est en cours de modification");
    m.audit.mockClear();
    const err = await redirectOf(modifyShortAction(fd({ jobId: "j1", clipId: "c1", change: "" })));
    expect(err).toContain("/agents/montage/j1?error=Dites ce qu'il faut changer");
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("responsable : refusé, sans appel ni journal", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    for (const a of [approveShortAction, rejectShortAction]) {
      const url = await redirectOf(a(fd({ jobId: "j1", clipId: "c1" })));
      expect(url).toContain("error=Valider, modifier ou refuser un short est réservé aux administrateurs.");
    }
    expect(await redirectOf(cancelMontageAction(fd({ jobId: "j1" })))).toContain("error=Annuler un montage est réservé aux administrateurs.");
    for (const f of Object.values(m.engine)) expect(f).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe("Annuler le montage", () => {
  it("administrateur : `cancelJob`, journal, retour sur la fiche", async () => {
    const url = await redirectOf(cancelMontageAction(fd({ jobId: "j1" })));
    expect(m.engine.cancelJob).toHaveBeenCalledWith({ deps: true }, "j1", { userId: "u1", via: "SITE" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.montage_cancelled", entityType: "MontageJob", entityId: "j1" }));
    expect(url).toContain("/agents/montage/j1?ok=Montage annulé");
    expect(url).toContain("Le short déjà validé reste dans la médiathèque.");
  });

  it("montage disparu : retour à la liste ; déjà fini : erreur sur la fiche", async () => {
    m.job = null;
    expect(await redirectOf(cancelMontageAction(fd({ jobId: "j1" })))).toContain("/agents/montage?error=Ce montage n'existe plus.");
    m.job = { id: "j1", status: "DONE", shorts: [] };
    expect(await redirectOf(cancelMontageAction(fd({ jobId: "j1" })))).toContain("/agents/montage/j1?error=Ce montage est déjà fini");
    expect(m.engine.cancelJob).not.toHaveBeenCalled();
  });
});
