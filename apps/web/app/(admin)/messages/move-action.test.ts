/**
 * Déplacement d'un message dans le calendrier (glisser-déposer ou « Déplacer ») : mêmes contrôles d'accès que la
 * modification (utilisateur connecté, ADMIN ou MANAGER), jamais un message parti, jamais dans le passé, écriture
 * conditionnelle (un message que le worker vient de prendre n'est pas modifié), test A/B déplacé d'un bloc, journal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const session = vi.hoisted(() => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: "MANAGER" })),
}));
vi.mock("@/lib/session", () => session);

const db = vi.hoisted(() => {
  const post = {
    findUnique: vi.fn(),
    findMany: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
    updateMany: vi.fn(async (..._args: unknown[]) => ({ count: 1 })),
  };
  return {
    prisma: {
      post,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ post })),
    },
    audit: vi.fn(async (..._args: unknown[]) => undefined),
  };
});
vi.mock("@linkaffipro/db", () => db);

import { movePostAction } from "./move-action";

/** Dans 3 jours, 19:30 à Paris. */
function futureLocal(hour = "19:30"): string {
  const d = new Date(Date.now() + 3 * 86_400_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
  return `${day}T${hour}`;
}

const base = {
  id: "p1",
  status: "SCHEDULED",
  isTemplate: false,
  scheduledAt: new Date(Date.now() + 86_400_000),
  abGroupId: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.prisma.post.findUnique.mockResolvedValue({ ...base });
  db.prisma.post.updateMany.mockResolvedValue({ count: 1 });
  db.prisma.post.findMany.mockResolvedValue([]);
  session.requireUser.mockResolvedValue({ id: "u1", role: "MANAGER" });
});

describe("movePostAction", () => {
  it("déplace un message programmé (MANAGER compris, comme la modification) et l'inscrit au journal", async () => {
    const to = futureLocal();
    const r = await movePostAction({ postId: "p1", scheduledAt: to });
    expect(r).toMatchObject({ ok: true, postId: "p1", to, moved: 1 });
    expect(r.ok && r.message).toMatch(/^Message déplacé au .+ à 19:30\.$/);
    const call = db.prisma.post.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // Écriture conditionnelle : même statut et même date qu'à la lecture.
    expect(call.where).toEqual({
      id: "p1",
      status: "SCHEDULED",
      scheduledAt: base.scheduledAt,
      isTemplate: false,
    });
    expect(call.data).toMatchObject({ updatedById: "u1" });
    expect((call.data.scheduledAt as Date).getTime()).toBeGreaterThan(Date.now());
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "post.moved", entityId: "p1", userId: "u1" }),
    );
  });

  it("renvoie l'ancienne date pour « Annuler »", async () => {
    const r = await movePostAction({ postId: "p1", scheduledAt: futureLocal() });
    expect(r.ok && r.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("déplace aussi un brouillon", async () => {
    db.prisma.post.findUnique.mockResolvedValue({ ...base, status: "DRAFT", scheduledAt: null });
    const r = await movePostAction({ postId: "p1", scheduledAt: futureLocal() });
    expect(r.ok).toBe(true);
  });

  it("refuse un message déjà parti, sans rien écrire", async () => {
    for (const status of ["SENT", "SENDING", "DELETED"]) {
      db.prisma.post.findUnique.mockResolvedValue({ ...base, status });
      const r = await movePostAction({ postId: "p1", scheduledAt: futureLocal() });
      expect(r.ok).toBe(false);
    }
    expect(db.prisma.post.updateMany).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("refuse une date passée", async () => {
    const r = await movePostAction({ postId: "p1", scheduledAt: "2020-01-01T10:00" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/passé/) });
    expect(db.prisma.post.updateMany).not.toHaveBeenCalled();
  });

  it("refuse un modèle et un message inconnu", async () => {
    db.prisma.post.findUnique.mockResolvedValue({ ...base, status: "DRAFT", isTemplate: true });
    expect((await movePostAction({ postId: "p1", scheduledAt: futureLocal() })).ok).toBe(false);
    db.prisma.post.findUnique.mockResolvedValue(null);
    expect((await movePostAction({ postId: "p1", scheduledAt: futureLocal() })).ok).toBe(false);
    expect(db.prisma.post.updateMany).not.toHaveBeenCalled();
  });

  it("exige un utilisateur connecté (la session redirige vers la connexion)", async () => {
    session.requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT /login"));
    await expect(movePostAction({ postId: "p1", scheduledAt: futureLocal() })).rejects.toThrow(
      /login/,
    );
    expect(db.prisma.post.findUnique).not.toHaveBeenCalled();
  });

  it("message pris par le worker entre-temps : rien n'est modifié, l'utilisateur est prévenu", async () => {
    db.prisma.post.updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await movePostAction({ postId: "p1", scheduledAt: futureLocal() });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/vient de changer/) });
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("test A/B : la version B suit du même écart", async () => {
    const aAt = base.scheduledAt;
    const bAt = new Date(aAt.getTime() + 30 * 60_000);
    db.prisma.post.findUnique.mockResolvedValue({ ...base, abGroupId: "g1" });
    db.prisma.post.findMany.mockResolvedValue([
      { id: "p2", status: "SCHEDULED", scheduledAt: bAt },
    ]);
    const r = await movePostAction({ postId: "p1", scheduledAt: futureLocal() });
    expect(r).toMatchObject({ ok: true, moved: 2 });
    const [first, second] = db.prisma.post.updateMany.mock.calls.map(
      (c) => c[0] as { where: { id: string }; data: { scheduledAt: Date } },
    );
    expect(first!.where.id).toBe("p1");
    expect(second!.where.id).toBe("p2");
    expect(second!.data.scheduledAt.getTime() - first!.data.scheduledAt.getTime()).toBe(
      30 * 60_000,
    );
  });

  it("demande invalide", async () => {
    expect((await movePostAction({ postId: "", scheduledAt: "" })).ok).toBe(false);
  });
});
