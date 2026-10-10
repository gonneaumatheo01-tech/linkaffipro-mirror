import { beforeEach, describe, expect, it, vi } from "vitest";

type Cat = {
  id: string;
  name: string;
  slug: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
};
const db = vi.hoisted(() => ({
  cats: [] as Cat[],
  audits: [] as Array<Record<string, unknown>>,
  role: "MANAGER" as "ADMIN" | "MANAGER",
}));

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: db.role })),
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    messageCategory: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { OR: Array<{ slug?: string; name?: { equals: string } }> };
        }) => {
          const slug = where.OR[0]!.slug;
          const name = where.OR[1]!.name!.equals.toLowerCase();
          return db.cats.find((c) => c.slug === slug || c.name.toLowerCase() === name) ?? null;
        },
      ),
      count: vi.fn(async () => db.cats.length),
      aggregate: vi.fn(async () => ({
        _max: { sortOrder: db.cats.length ? Math.max(...db.cats.map((c) => c.sortOrder)) : null },
      })),
      create: vi.fn(async ({ data }: { data: Omit<Cat, "id" | "isActive"> }) => {
        const c = { id: `c${db.cats.length + 1}`, isActive: true, ...data };
        db.cats.push(c);
        return { id: c.id, name: c.name, color: c.color };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Cat> }) => {
        const c = db.cats.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return { id: c.id, name: c.name, color: c.color };
      }),
    },
  },
  audit: vi.fn(async (a: Record<string, unknown>) => {
    db.audits.push(a);
  }),
}));

import { createCategoryInlineAction } from "./inline-actions";

beforeEach(() => {
  db.cats = [];
  db.audits = [];
  db.role = "MANAGER";
});

describe("« + Nouvelle catégorie » depuis le formulaire de message", () => {
  it("place la nouvelle catégorie après la plus grande position existante (pas de collision)", async () => {
    // Deux catégories dont l'une a été déplacée en position 7 : le compte (2) entrerait en collision.
    db.cats = [
      { id: "a", name: "Rappel", slug: "rappel", color: "#000000", sortOrder: 7, isActive: true },
      { id: "b", name: "Info", slug: "info", color: "#000000", sortOrder: 2, isActive: true },
    ];
    const r = await createCategoryInlineAction({ name: "Bonus du week-end", color: "#ff0088" });
    expect(r).toMatchObject({ ok: true, name: "Bonus du week-end", color: "#ff0088" });
    expect(db.cats.at(-1)).toMatchObject({
      slug: "bonus-du-week-end",
      sortOrder: 8,
      color: "#ff0088",
    });
    expect(db.audits[0]).toMatchObject({
      action: "category.created",
      entityType: "MessageCategory",
    });
  });
  it("première catégorie : position 0, couleur automatique si aucune n'est choisie", async () => {
    const r = await createCategoryInlineAction({ name: "Teasing" });
    expect(r.ok).toBe(true);
    expect(db.cats[0]!.sortOrder).toBe(0);
    expect(db.cats[0]!.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it("réutilise une catégorie active du même nom (ADMIN ou MANAGER), sans en créer une autre", async () => {
    db.cats = [
      { id: "a", name: "Bonus", slug: "bonus", color: "#123456", sortOrder: 0, isActive: true },
    ];
    const r = await createCategoryInlineAction({ name: "bonus" });
    expect(r).toEqual({ ok: true, id: "a", name: "Bonus", color: "#123456" });
    expect(db.cats).toHaveLength(1);
    // Trace de réutilisation (la catégorie appartient au client : `pnpm db:phase8` n'y touche jamais).
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({
      action: "category.updated",
      entityId: "a",
      metadata: { reused: true },
    });
  });
  it("ADMIN : réactive une catégorie désactivée du même nom (journalisé)", async () => {
    db.role = "ADMIN";
    db.cats = [
      { id: "a", name: "Bonus", slug: "bonus", color: "#123456", sortOrder: 0, isActive: false },
    ];
    const r = await createCategoryInlineAction({ name: "bonus" });
    expect(r).toEqual({ ok: true, id: "a", name: "Bonus", color: "#123456" });
    expect(db.cats).toHaveLength(1);
    expect(db.cats[0]!.isActive).toBe(true);
    expect(db.audits[0]).toMatchObject({ action: "category.updated", entityId: "a" });
  });
  it("MANAGER : ne réactive pas une catégorie désactivée par un administrateur (réglage réservé à l'ADMIN)", async () => {
    db.cats = [
      { id: "a", name: "Bonus", slug: "bonus", color: "#123456", sortOrder: 0, isActive: false },
    ];
    const r = await createCategoryInlineAction({ name: "BONUS" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Réglages → Catégories");
    expect(db.cats).toHaveLength(1);
    expect(db.cats[0]!.isActive).toBe(false);
    expect(db.audits).toEqual([]);
  });
  it("refuse un nom vide ou une couleur invalide", async () => {
    expect((await createCategoryInlineAction({ name: "  " })).ok).toBe(false);
    expect((await createCategoryInlineAction({ name: "Ok", color: "rouge" })).ok).toBe(false);
  });
});
