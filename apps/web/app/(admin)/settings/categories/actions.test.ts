import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };
const db = vi.hoisted(() => ({
  cats: [] as Row[],
  posts: [] as Row[],
  rules: [] as Row[],
  broadcasts: [] as Row[],
  audits: [] as Array<Record<string, unknown>>,
  inTx: false,
  writesOutsideTx: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin1", role: "ADMIN" })),
}));
vi.mock("@linkaffipro/db", () => {
  const write = (name: string) => {
    if (!db.inTx) db.writesOutsideTx.push(name);
  };
  const prisma = {
    messageCategory: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          db.cats.find((c) => c.id === where.id) ?? null,
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        write("messageCategory.delete");
        const c = db.cats.find((x) => x.id === where.id)!;
        db.cats = db.cats.filter((x) => x.id !== where.id);
        return c;
      }),
    },
    post: {
      count: vi.fn(
        async ({ where }: { where: { categoryId: string } }) =>
          db.posts.filter((p) => p.categoryId === where.categoryId).length,
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { categoryId: string };
          data: { categoryId: string | null };
        }) => {
          write("post.updateMany");
          const hit = db.posts.filter((p) => p.categoryId === where.categoryId);
          hit.forEach((p) => (p.categoryId = data.categoryId));
          return { count: hit.length };
        },
      ),
    },
    automationRule: {
      findMany: vi.fn(async () => db.rules),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          write("automationRule.update");
          Object.assign(
            db.rules.find((r) => r.id === where.id)!,
            data,
          );
        },
      ),
    },
    broadcast: {
      findMany: vi.fn(async ({ where }: { where: { status: { in: string[] } } }) =>
        db.broadcasts.filter((b) => where.status.in.includes(b.status as string)),
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          write("broadcast.update");
          Object.assign(
            db.broadcasts.find((b) => b.id === where.id)!,
            data,
          );
        },
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      db.inTx = true;
      try {
        return await fn(prisma);
      } finally {
        db.inTx = false;
      }
    }),
  };
  return {
    prisma,
    audit: vi.fn(async (a: Record<string, unknown>) => {
      db.audits.push(a);
    }),
    toJsonValue: (v: unknown) => v,
  };
});

import { deleteCategoryAction } from "./actions";

async function del(id: string, replacementId = ""): Promise<string> {
  const fd = new FormData();
  fd.set("id", id);
  fd.set("replacementId", replacementId);
  try {
    await deleteCategoryAction(fd);
  } catch (e) {
    // URLSearchParams encode les espaces en « + ».
    return decodeURIComponent(((e as { url?: string }).url ?? String(e)).replace(/\+/g, " "));
  }
  return "";
}

beforeEach(() => {
  db.cats = [
    { id: "bonus", name: "Bonus" },
    { id: "promo", name: "Promo" },
  ];
  db.posts = [
    { id: "p1", categoryId: "bonus" },
    { id: "p2", categoryId: "promo" },
  ];
  db.rules = [
    { id: "r1", name: "Relance bonus", isActive: true, conditions: { categoryIds: ["bonus"] } },
    {
      id: "r2",
      name: "Mixte",
      isActive: true,
      conditions: { categoryIds: ["bonus", "promo"], channelIds: ["c1"] },
    },
    { id: "r3", name: "Sans catégorie", isActive: true, conditions: { channelIds: ["c1"] } },
  ];
  db.broadcasts = [
    {
      id: "b1",
      name: "Programmé",
      status: "SCHEDULED",
      segment: { clickedCategoryIds: ["bonus"] },
    },
    {
      id: "b2",
      name: "Brouillon",
      status: "DRAFT",
      segment: { clickedCategoryIds: ["bonus", "promo"] },
    },
    { id: "b3", name: "Déjà envoyé", status: "SENT", segment: { clickedCategoryIds: ["bonus"] } },
  ];
  db.audits = [];
  db.writesOutsideTx = [];
});

describe("Réglages → Catégories : fusionner et supprimer", () => {
  it("fusion : messages, automatisations et envois non partis passent dans la catégorie choisie, en une transaction", async () => {
    const url = await del("bonus", "promo");
    expect(url).toContain("ok=");
    expect(db.writesOutsideTx).toEqual([]);
    expect(db.posts.map((p) => p.categoryId)).toEqual(["promo", "promo"]);
    expect(db.rules.map((r) => r.conditions)).toEqual([
      { categoryIds: ["promo"] },
      { categoryIds: ["promo"], channelIds: ["c1"] },
      { channelIds: ["c1"] },
    ]);
    expect(db.rules.every((r) => r.isActive)).toBe(true);
    expect(db.broadcasts.map((b) => [b.status, b.segment])).toEqual([
      ["SCHEDULED", { clickedCategoryIds: ["promo"] }],
      ["DRAFT", { clickedCategoryIds: ["promo"] }],
      ["SENT", { clickedCategoryIds: ["bonus"] }],
    ]);
    expect(db.cats.map((c) => c.id)).toEqual(["promo"]);
    expect(db.audits.map((a) => a.action)).toEqual(["category.merged", "category.deleted"]);
  });
  it("sans remplacement : la règle qui ne visait que cette catégorie est désactivée, l'envoi programmé repasse en brouillon", async () => {
    const url = await del("bonus");
    expect(url).toContain("désactivée");
    expect(url).toContain("brouillon");
    expect(db.posts[0]!.categoryId).toBeNull();
    expect(db.rules[0]).toMatchObject({ isActive: false, conditions: {} });
    expect(db.rules[1]).toMatchObject({
      isActive: true,
      conditions: { categoryIds: ["promo"], channelIds: ["c1"] },
    });
    expect(db.broadcasts[0]).toMatchObject({ status: "DRAFT", segment: {} });
    expect(db.broadcasts[1]).toMatchObject({
      status: "DRAFT",
      segment: { clickedCategoryIds: ["promo"] },
    });
    expect(db.writesOutsideTx).toEqual([]);
  });
  it("sans remplacement : brouillon et automatisation déjà inactive dont le filtre est retiré sont cités dans le message", async () => {
    db.rules.push({
      id: "r4",
      name: "Règle en pause",
      isActive: false,
      conditions: { categoryIds: ["bonus"] },
    });
    db.broadcasts.push({
      id: "b4",
      name: "Brouillon bonus",
      status: "DRAFT",
      segment: { clickedCategoryIds: ["bonus"] },
    });
    const url = await del("bonus");
    expect(db.rules[3]).toMatchObject({ isActive: false, conditions: {} });
    expect(db.broadcasts[3]).toMatchObject({ status: "DRAFT", segment: {} });
    expect(url).toContain("Filtre de catégorie retiré");
    expect(url).toContain("Règle en pause");
    expect(url).toContain("Brouillon bonus");
    // Les envois et règles qui gardent une autre catégorie ne sont pas cités.
    expect(url).not.toContain("Mixte");
    expect(url).not.toContain("« Brouillon »");
    const merged = db.audits.find((a) => a.action === "category.merged")!;
    expect(merged.metadata).toMatchObject({
      rulesFilterRemoved: ["Règle en pause"],
      broadcastsFilterRemoved: ["Brouillon bonus"],
    });
  });
  it("refuse une catégorie de remplacement identique ou introuvable, sans rien modifier", async () => {
    expect(await del("bonus", "bonus")).toContain("error=");
    expect(await del("bonus", "inconnue")).toContain("error=");
    expect(db.cats).toHaveLength(2);
    expect(db.posts[0]!.categoryId).toBe("bonus");
  });
});
