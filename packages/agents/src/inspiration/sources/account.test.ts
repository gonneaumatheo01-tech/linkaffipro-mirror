import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../../testing/fake-prisma";
import { fakeAccountReader, fakePosts, fakeSleep, FIXTURE_NOW } from "../testing/fixtures";
import { ACCOUNT_READER_UNAVAILABLE, freeReaderAccounts, joinWithInviteOnce, prismaAccountHistoryReader, readWithAccount } from "./account";

const channel = { username: null, chatId: -100777n };

describe("lecture par compte réel membre (faux MTProto)", () => {
  it("lots de 50, un lot toutes les 5 s, 200 posts au plus", async () => {
    const reader = fakeAccountReader({ posts: fakePosts(900, 300, FIXTURE_NOW, 1) });
    const sleep = fakeSleep();
    const r = await readWithAccount(reader, channel, { now: FIXTURE_NOW, sleep });
    expect(r.ok && r.posts.length).toBe(200);
    expect(reader.calls.map((c) => c.limit)).toEqual([50, 50, 50, 50]);
    expect(reader.calls.map((c) => c.beforeId)).toEqual([undefined, 851, 801, 751]);
    expect(sleep.calls).toEqual([5000, 5000, 5000]);
    expect(r).toMatchObject({ ok: true, accountId: "acc1", chatId: -100777n, title: "Canal privé (exemple)" });
  });

  it("verrou de lecture renouvelé après chaque lot ; verrou perdu → la lecture s'arrête", async () => {
    let batches = 0;
    const r = await readWithAccount(fakeAccountReader({ posts: fakePosts(900, 300, FIXTURE_NOW, 1) }), channel, {
      now: FIXTURE_NOW,
      sleep: fakeSleep(),
      onBatch: async () => {
        batches++;
      },
    });
    expect(r.ok).toBe(true);
    expect(batches).toBe(4);
    await expect(
      readWithAccount(fakeAccountReader({ posts: fakePosts(900, 300, FIXTURE_NOW, 1) }), channel, {
        now: FIXTURE_NOW,
        sleep: fakeSleep(),
        onBatch: async () => Promise.reject(new Error("verrou perdu")),
      }),
    ).rejects.toThrow("verrou perdu");
  });

  it("arrêt au bout de l'historique, à 90 jours et au dernier post connu", async () => {
    const short = fakeAccountReader({ posts: fakePosts(60, 60) });
    expect((await readWithAccount(short, channel, { now: FIXTURE_NOW, sleep: fakeSleep() })).ok).toBe(true);
    expect(short.calls).toHaveLength(2);
    // Un post par jour : 90 jours au plus.
    const daily = fakeAccountReader({ posts: fakePosts(500, 150, FIXTURE_NOW, 24) });
    const r = await readWithAccount(daily, channel, { now: FIXTURE_NOW, sleep: fakeSleep() });
    expect(r.ok && r.posts.length).toBe(90);
    const since = await readWithAccount(fakeAccountReader({ posts: fakePosts(500, 150) }), channel, { now: FIXTURE_NOW, sleep: fakeSleep(), sinceId: 480, maxPosts: 50 });
    expect(since.ok && since.posts.map((p) => p.externalId)).toEqual(Array.from({ length: 20 }, (_, i) => 500 - i));
  });

  it("FLOOD_WAIT court : attendu puis reprise du même lot", async () => {
    const reader = fakeAccountReader({ posts: fakePosts(120, 120), floods: [0, 42] });
    const sleep = fakeSleep();
    const r = await readWithAccount(reader, channel, { now: FIXTURE_NOW, sleep });
    expect(r.ok && r.posts.length).toBe(120);
    expect(sleep.calls).toContain(42_000);
    expect(reader.calls[1]!.beforeId).toBe(reader.calls[2]!.beforeId);
    expect(r).not.toHaveProperty("partial");
  });

  it("FLOOD_WAIT de plus de 5 minutes : arrêt propre avec ce qui est lu ; rien lu → rate_limited", async () => {
    const reader = fakeAccountReader({ posts: fakePosts(200, 200), floods: [0, 600] });
    const r = await readWithAccount(reader, channel, { now: FIXTURE_NOW, sleep: fakeSleep() });
    expect(r).toMatchObject({ ok: true, partial: "rate_limited" });
    expect(r.ok && r.posts.length).toBe(50);
    const none = await readWithAccount(fakeAccountReader({ posts: fakePosts(10, 10), floods: [900] }), channel, { now: FIXTURE_NOW, sleep: fakeSleep() });
    expect(none).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("aucun compte membre libre → no_account (transfert de posts demandé)", async () => {
    const r = await readWithAccount(fakeAccountReader({ members: [] }), channel, { now: FIXTURE_NOW, sleep: fakeSleep() });
    expect(r).toMatchObject({ ok: false, reason: "no_account" });
    expect(!r.ok && r.message).toMatch(/transfère-moi 10 à 30/);
  });

  it("rejoindre : une seule tentative, lien d'invitation seulement, débit lent ; jamais par un nom public", async () => {
    const reader = fakeAccountReader();
    const sleep = fakeSleep();
    expect(await joinWithInviteOnce(reader, "acc1", "https://t.me/+AbCdEf12", { sleep })).toMatchObject({ ok: true, chatId: -100777n });
    expect(reader.joins).toEqual([{ accountId: "acc1", inviteLink: "https://t.me/+AbCdEf12" }]);
    expect(sleep.calls).toEqual([5000]);
    expect(await joinWithInviteOnce(reader, "acc1", "t.me/casino_public", { sleep })).toMatchObject({ ok: false, reason: "invalid_link" });
    expect(reader.joins).toHaveLength(1);
    const flood = { ...reader, joinWithInvite: async () => ({ floodWaitSeconds: 30 }) };
    expect(await joinWithInviteOnce(flood, "acc1", "https://t.me/+AbCdEf12", { sleep })).toMatchObject({ ok: false, reason: "rate_limited" });
  });
});

describe("lecteur réel", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const prisma = createFakePrisma({
    telegramUserAccount: [
      { id: "libre", isActive: true, status: "ACTIVE", personaId: null, botId: null },
      { id: "persona", isActive: true, status: "ACTIVE", personaId: "p1", botId: null },
      { id: "fantome", isActive: true, status: "ACTIVE", personaId: null, botId: "b1" },
      { id: "inactif", isActive: false, status: "ACTIVE", personaId: null, botId: null },
      { id: "dm", isActive: true, status: "ACTIVE", personaId: null, botId: null },
    ],
    accountDm: [{ accountId: "dm", status: "SENT", createdAt: new Date("2026-10-22T10:00:00Z") }],
  });
  it("comptes libres : actifs, sans persona ni bot fantôme, sans DM depuis 7 jours", async () => {
    expect(await freeReaderAccounts(prisma, now)).toEqual(["libre"]);
  });
  it("sans transport sûr (sessions tenues par le service userbot) : indisponible, aucun compte proposé", async () => {
    const reader = prismaAccountHistoryReader(prisma);
    expect(reader.available).toBe(false);
    expect(reader.unavailableReason).toBe(ACCOUNT_READER_UNAVAILABLE);
    expect(await reader.memberAccounts(channel)).toEqual([]);
    expect(reader.joinWithInvite).toBeUndefined();
    await expect(reader.history("libre", channel, { limit: 50 })).rejects.toThrow();
  });
  it("avec transport : seuls les comptes libres qui voient le canal", async () => {
    const reader = prismaAccountHistoryReader(prisma, {
      now: () => now,
      transport: { isMember: async (id) => id === "libre", history: async () => ({ posts: [], title: null, chatId: null }) },
    });
    expect(await reader.memberAccounts(channel)).toEqual(["libre"]);
  });
});
