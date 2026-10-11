/**
 * Phase 12, bibliothèque des emojis animés sur base réelle (Telegram simulé, aucun appel réseau) : un pack ajouté par
 * son lien (getStickerSet par un de nos bots, refus expliqués en français, jamais de doublon, un emoji retiré revient),
 * les aperçus demandés au service d'arrière-plan, l'import des packs du compte connecté (tâche, journal, état
 * « en cours »), retirer / remettre (administrateurs seulement), l'utilisation notée par markCustomEmojisUsed (récents de
 * l'équipe), la liste du sélecteur et la route d'aperçu (animation décompressée, image telle quelle).
 */
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { capturedJobs, createTestBot, resetDb, type TelegramCall } from "./helpers";

const session = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    name: string;
    role: "ADMIN" | "MANAGER";
    telegramUserId: bigint | null;
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => {
    if (!session.user)
      throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/login", digest: "NEXT_REDIRECT" });
    return session.user;
  },
}));
// Routes API : la vraie fonction `apiUser` relit le compte en base ; seule la session est simulée.
vi.mock("@/auth", () => ({
  auth: async () => (session.user ? { user: { id: session.user.id, sessionVersion: 0 } } : null),
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
}));

const actions = await import("@/app/(admin)/messages/emojis/actions");
const { markCustomEmojisUsed } = await import("@/lib/custom-emoji/usage");
const { listPickerEmojis, loadLibrary, accountImportState } =
  await import("@/lib/custom-emoji/queries");
const listRoute = await import("@/app/api/custom-emoji/route");
const previewRoute = await import("@/app/api/custom-emoji/[id]/route");

const EMAIL = { admin: "ce-admin@test.local", manager: "ce-manager@test.local" };
const users = { admin: "", manager: "" };
const PACK_IDS = ["5000000000000000001", "5000000000000000002", "5000000000000000003"];

function sticker(id: string, emoji: string, kind: "tgs" | "webm" | "webp", setName: string) {
  return {
    file_id: `file-${id}`,
    file_unique_id: `u-${id}`,
    type: "custom_emoji",
    width: 100,
    height: 100,
    is_animated: kind === "tgs",
    is_video: kind === "webm",
    emoji,
    set_name: setName,
    custom_emoji_id: id,
  };
}

/** Telegram simulé : packs connus, pack d'autocollants, pack inconnu, panne d'un bot. */
class FakeStickerSets {
  down = new Set<number>();
  packs: Record<string, unknown> = {
    LapCasinoAnime: {
      name: "LapCasinoAnime",
      title: "Casino animé",
      sticker_type: "custom_emoji",
      stickers: [
        sticker(PACK_IDS[0]!, "🎰", "tgs", "LapCasinoAnime"),
        sticker(PACK_IDS[1]!, "💰", "tgs", "LapCasinoAnime"),
        sticker(PACK_IDS[2]!, "🔥", "tgs", "LapCasinoAnime"),
      ],
    },
    LapAutocollants: {
      name: "LapAutocollants",
      title: "Autocollants",
      sticker_type: "regular",
      stickers: [sticker("6000000000000000001", "😀", "webp", "LapAutocollants")],
    },
  };
  install(api: Api, selfId: number): TelegramCall[] {
    const calls: TelegramCall[] = [];
    api.config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      calls.push({ method, payload: p });
      if (this.down.has(selfId))
        return { ok: false, error_code: 502, description: "Bad Gateway" } as never;
      if (method === "getStickerSet") {
        const set = this.packs[String(p.name)];
        if (!set)
          return {
            ok: false,
            error_code: 400,
            description: "Bad Request: STICKERSET_INVALID",
          } as never;
        return { ok: true, result: set } as never;
      }
      return { ok: true, result: true } as never;
    });
    return calls;
  }
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

async function cleanExtras() {
  await prisma.customEmoji.deleteMany();
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "custom_emoji." } } });
  await prisma.auditLog.deleteMany({ where: { user: { email: { in: Object.values(EMAIL) } } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAIL) } } });
  await prisma.telegramUserSession.deleteMany({ where: { id: "main" } });
}

const asAdmin = () =>
  (session.user = {
    id: users.admin,
    email: EMAIL.admin,
    name: "Alice Admin",
    role: "ADMIN",
    telegramUserId: null,
  });
const asManager = () =>
  (session.user = {
    id: users.manager,
    email: EMAIL.manager,
    name: "Marc Manager",
    role: "MANAGER",
    telegramUserId: null,
  });

const tg = new FakeStickerSets();
const calls: Record<string, TelegramCall[]> = {};

beforeAll(async () => {
  await resetDb();
  await cleanExtras();
  users.admin = (
    await prisma.user.create({
      data: { email: EMAIL.admin, name: "Alice Admin", passwordHash: "x", role: "ADMIN" },
    })
  ).id;
  users.manager = (
    await prisma.user.create({
      data: { email: EMAIL.manager, name: "Marc Manager", passwordHash: "x", role: "MANAGER" },
    })
  ).id;
  const first = await createTestBot(951, "CASINO");
  const second = await createTestBot(952, "SPORTS");
  calls.first = tg.install(getOrCreateBot(first, prismaTelegramDeps).api, 951);
  calls.second = tg.install(getOrCreateBot(second, prismaTelegramDeps).api, 952);
});

afterAll(async () => {
  await cleanExtras();
});

beforeEach(() => {
  (globalThis.__jobs ??= []).length = 0;
  calls.first!.length = 0;
  calls.second!.length = 0;
  tg.down.clear();
  asManager();
});

describe("ajouter un pack par son lien (responsable)", () => {
  it("tous les emojis du pack, avec le pack, le format et l'emoji normal ; aperçus demandés ; journal", async () => {
    const res = await actions.importPackAction(
      null,
      fd({ link: "https://t.me/addemoji/LapCasinoAnime" }),
    );
    expect(res).toEqual({ ok: "Casino animé : 3 emojis animés ajoutés ✅." });
    expect(calls.first!.map((c) => c.method)).toEqual(["getStickerSet"]);
    expect(calls.first![0]!.payload.name).toBe("LapCasinoAnime");
    const rows = await prisma.customEmoji.findMany({ orderBy: { customEmojiId: "asc" } });
    expect(
      rows.map((r) => [r.customEmojiId, r.fallback, r.setName, r.setTitle, r.format, r.source]),
    ).toEqual([
      [PACK_IDS[0], "🎰", "LapCasinoAnime", "Casino animé", "tgs", "PACK"],
      [PACK_IDS[1], "💰", "LapCasinoAnime", "Casino animé", "tgs", "PACK"],
      [PACK_IDS[2], "🔥", "LapCasinoAnime", "Casino animé", "tgs", "PACK"],
    ]);
    expect(rows.every((r) => r.addedById === users.manager && r.hiddenAt === null)).toBe(true);
    const jobs = capturedJobs("custom-emoji");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toEqual({ type: "fetch-previews", customEmojiIds: PACK_IDS });
    const event = await prisma.event.findFirst({ where: { type: "custom_emoji.added" } });
    expect(event?.payload).toMatchObject({ count: 3, source: "PACK", ids: PACK_IDS });
    const log = await prisma.auditLog.findFirst({
      where: { action: "custom_emoji.pack_imported" },
    });
    expect(log).toMatchObject({ userId: users.manager, entityType: "CustomEmoji" });
    expect(log?.metadata).toMatchObject({ setName: "LapCasinoAnime", added: 3, already: 0 });
  });

  it("le même pack une seconde fois : aucun doublon ; un emoji retiré revient ; aperçus manquants seulement", async () => {
    await prisma.customEmoji.update({
      where: { customEmojiId: PACK_IDS[1] },
      data: { hiddenAt: new Date() },
    });
    await prisma.customEmoji.update({
      where: { customEmojiId: PACK_IDS[0] },
      data: { previewBytes: Buffer.from([1]), previewMime: "image/webp", previewAt: new Date() },
    });
    const res = await actions.importPackAction(null, fd({ link: "t.me/addemoji/LapCasinoAnime" }));
    expect(res).toEqual({
      ok: "Casino animé : 1 emoji animé ajouté ✅ (2 déjà dans la bibliothèque).",
    });
    expect(await prisma.customEmoji.count()).toBe(3);
    expect(
      (await prisma.customEmoji.findUnique({ where: { customEmojiId: PACK_IDS[1] } }))?.hiddenAt,
    ).toBeNull();
    expect(capturedJobs("custom-emoji")[0]!.data).toEqual({
      type: "fetch-previews",
      customEmojiIds: [PACK_IDS[1], PACK_IDS[2]],
    });
  });

  it("un bot en panne : le suivant lit le pack", async () => {
    tg.down.add(951);
    const res = await actions.importPackAction(null, fd({ link: "LapCasinoAnime" }));
    expect(res?.ok).toMatch(/Rien de nouveau/);
    expect(calls.second!.map((c) => c.method)).toEqual(["getStickerSet"]);
  });

  it("refus expliqués : pack d'autocollants, lien d'autocollants, pack inconnu, lien invalide, vide, Telegram en panne", async () => {
    expect(
      await actions.importPackAction(null, fd({ link: "https://t.me/addemoji/LapAutocollants" })),
    ).toEqual({ error: "Ce lien est un pack d'autocollants, pas d'emojis animés." });
    calls.first!.length = 0;
    expect(
      await actions.importPackAction(null, fd({ link: "https://t.me/addstickers/LapCasinoAnime" })),
    ).toEqual({ error: "Ce lien est un pack d'autocollants, pas d'emojis animés." });
    expect(calls.first).toHaveLength(0);
    expect(
      await actions.importPackAction(null, fd({ link: "https://t.me/addemoji/PackDisparu" })),
    ).toEqual({ error: "Telegram ne trouve pas ce pack : vérifiez le lien." });
    expect(
      (await actions.importPackAction(null, fd({ link: "https://exemple.fr/x y" })))?.error,
    ).toMatch(/pas celui d'un pack d'emojis animés/);
    expect((await actions.importPackAction(null, fd({ link: "  " })))?.error).toMatch(
      /Collez le lien/,
    );
    tg.down.add(951);
    tg.down.add(952);
    expect(await actions.importPackAction(null, fd({ link: "LapCasinoAnime" }))).toEqual({
      error: "Telegram ne répond pas pour l'instant : réessayez dans une minute.",
    });
    expect(await prisma.customEmoji.count()).toBe(3);
    expect(await prisma.customEmoji.count({ where: { setName: "LapAutocollants" } })).toBe(0);
  });
});

describe("importer les packs du compte Telegram connecté", () => {
  it("sans compte connecté : refusé, rien n'est demandé", async () => {
    const res = await actions.requestAccountImportAction(null, fd({}));
    expect(res?.error).toMatch(/Aucun compte Telegram connecté/);
    expect(capturedJobs("custom-emoji")).toHaveLength(0);
    expect((await accountImportState()).session).toBe("none");
  });

  it("compte connecté : tâche du service d'arrière-plan, journal, état « en cours » puis dernier import", async () => {
    await prisma.telegramUserSession.create({
      data: { id: "main", phone: "+33600000000", sessionEncrypted: "x", status: "ACTIVE" },
    });
    const res = await actions.requestAccountImportAction(null, fd({}));
    expect(res?.ok).toMatch(/Import demandé/);
    const jobs = capturedJobs("custom-emoji");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toEqual({ type: "import-account", requestedById: users.manager });
    expect(String(jobs[0]!.opts.jobId)).toMatch(/^custom-emoji:import-account:\d+$/);
    expect(
      await prisma.auditLog.count({
        where: { action: "custom_emoji.account_import_requested", userId: users.manager },
      }),
    ).toBe(1);
    let state = await accountImportState();
    expect(state).toMatchObject({ session: "active", running: true, lastImport: null });
    expect(state.lastRequest?.byName).toBe("Marc Manager");

    // Le worker a importé : événement « custom_emoji.added » (source ACCOUNT).
    await prisma.customEmoji.create({
      data: { customEmojiId: "7000000000000000001", fallback: "⚽", source: "ACCOUNT" },
    });
    await prisma.event.create({
      data: {
        type: "custom_emoji.added",
        occurredAt: new Date(Date.now() + 1000),
        payload: { count: 1, source: "ACCOUNT", ids: ["7000000000000000001"] },
      },
    });
    state = await accountImportState(new Date(Date.now() + 2000));
    expect(state).toMatchObject({ running: false, accountEmojis: 1 });
    expect(state.lastImport?.count).toBe(1);
  });

  it("compte à reconnecter : refusé avec la marche à suivre", async () => {
    await prisma.telegramUserSession.update({ where: { id: "main" }, data: { status: "ERROR" } });
    expect((await actions.requestAccountImportAction(null, fd({})))?.error).toMatch(
      /à reconnecter/,
    );
    expect((await accountImportState()).session).toBe("error");
  });
});

describe("retirer et remettre un emoji (administrateurs seulement)", () => {
  it("un responsable ne peut pas retirer un emoji", async () => {
    const res = await actions.hideEmojiAction(PACK_IDS[2]!);
    expect(res?.error).toMatch(/Seul un administrateur/);
    expect(
      (await prisma.customEmoji.findUnique({ where: { customEmojiId: PACK_IDS[2] } }))?.hiddenAt,
    ).toBeNull();
  });

  it("un administrateur le retire (plus proposé dans l'éditeur) puis le remet ; journal", async () => {
    asAdmin();
    expect((await actions.hideEmojiAction(PACK_IDS[2]!))?.ok).toMatch(/retiré de la bibliothèque/);
    expect((await listPickerEmojis()).map((e) => e.id)).not.toContain(PACK_IDS[2]);
    const hidden = await loadLibrary({ hidden: true });
    expect(hidden.emojis.map((e) => e.id)).toEqual([PACK_IDS[2]]);
    expect(hidden.hiddenCount).toBe(1);
    expect((await actions.restoreEmojiAction(PACK_IDS[2]!))?.ok).toMatch(/remis/);
    expect((await listPickerEmojis()).map((e) => e.id)).toContain(PACK_IDS[2]);
    const logs = await prisma.auditLog.findMany({
      where: { action: { in: ["custom_emoji.hidden", "custom_emoji.restored"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(logs.map((l) => [l.action, l.userId])).toEqual([
      ["custom_emoji.hidden", users.admin],
      ["custom_emoji.restored", users.admin],
    ]);
    expect(await actions.hideEmojiAction("pas-un-id")).toEqual({
      error: "Emoji animé introuvable.",
    });
  });
});

describe("utilisation dans les textes enregistrés (récents de l'équipe)", () => {
  it("une fois par emoji et par enregistrement, emojis inconnus ignorés, ne lève jamais", async () => {
    const tag = (id: string, fb: string) => `<tg-emoji emoji-id="${id}">${fb}</tg-emoji>`;
    const n = await markCustomEmojisUsed(
      `Promo ${tag(PACK_IDS[0]!, "🎰")} ${tag(PACK_IDS[0]!, "🎰")} ${tag("9999999999", "❓")}`,
      [`Version B ${tag(PACK_IDS[0]!, "🎰")} ${tag(PACK_IDS[2]!, "🔥")}`, null],
      undefined,
    );
    expect(n).toBe(2);
    const rows = await prisma.customEmoji.findMany({
      where: { customEmojiId: { in: PACK_IDS } },
      orderBy: { customEmojiId: "asc" },
    });
    expect(rows.map((r) => r.useCount)).toEqual([1, 0, 1]);
    expect(rows[0]!.lastUsedAt).toBeInstanceOf(Date);
    expect(rows[1]!.lastUsedAt).toBeNull();
    expect(await markCustomEmojisUsed("aucun emoji animé", null)).toBe(0);
    const picker = await listPickerEmojis();
    expect(picker.find((e) => e.id === PACK_IDS[0])).toMatchObject({ useCount: 1 });
  });
});

describe("routes du navigateur", () => {
  it("liste du sélecteur : connectés seulement, emojis visibles", async () => {
    session.user = null;
    expect((await listRoute.GET()).status).toBe(401);
    asManager();
    const body = (await (await listRoute.GET()).json()) as { items: Array<{ id: string }> };
    expect(body.items.map((i) => i.id)).toEqual(
      expect.arrayContaining([...PACK_IDS, "7000000000000000001"]),
    );
  });

  it("aperçu : animation décompressée en JSON, image telle quelle, rien sinon", async () => {
    const lottie = { v: "5.5.2", fr: 60, ip: 0, op: 60, w: 512, h: 512, layers: [] };
    await prisma.customEmoji.update({
      where: { customEmojiId: PACK_IDS[1] },
      data: {
        previewBytes: gzipSync(Buffer.from(JSON.stringify(lottie))),
        previewMime: "application/x-tgsticker",
        previewAt: new Date(),
      },
    });
    const get = (id: string) =>
      previewRoute.GET(new Request(`http://localhost/api/custom-emoji/${id}`), {
        params: Promise.resolve({ id }),
      } as never);
    const anim = await get(PACK_IDS[1]!);
    expect(anim.status).toBe(200);
    expect(await anim.json()).toEqual(lottie);
    const img = await get(PACK_IDS[0]!);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect((await get(PACK_IDS[2]!)).status).toBe(204);
    expect((await get("123")).status).toBe(204);
    expect((await get("abc")).status).toBe(404);
    session.user = null;
    expect((await get(PACK_IDS[1]!)).status).toBe(401);
  });
});
