import { describe, expect, it } from "vitest";
import { createFakePrisma, type FakePrisma } from "../../testing/fake-prisma";
import { fakePosts, FIXTURE_NOW } from "../testing/fixtures";
import { prismaAccountHistoryReader, readWithAccount } from "./account";
import { createDefaultAccountReader, createUserbotHistoryTransport, USERBOT_HEARTBEAT_KEY, USERBOT_REQUEST_PREFIX, type UserbotResponse, type UserbotRow } from "./userbot-mailbox";

/** Faux userbot : à chaque attente du worker, répond aux demandes en attente dans la base en mémoire. */
function fakeUserbot(prisma: FakePrisma, answer: (row: UserbotRow) => UserbotResponse | null) {
  let now = FIXTURE_NOW;
  const seen: UserbotRow[] = [];
  const sleep = async (ms: number) => {
    now = new Date(now.getTime() + ms);
    for (const r of prisma._tables.setting ?? []) {
      if (!String(r.key).startsWith(USERBOT_REQUEST_PREFIX)) continue;
      const row = r.value as UserbotRow;
      if (row.status !== "PENDING") continue;
      seen.push(row);
      const res = answer(row);
      if (res) r.value = { ...row, status: "DONE", response: res };
    }
  };
  return { sleep, now: () => now, seen };
}

const alive = () => createFakePrisma({ setting: [{ key: USERBOT_HEARTBEAT_KEY, value: { at: FIXTURE_NOW.toISOString() } }] });
const wire = (n: number, count: number) => fakePosts(n, count).map((p) => ({ ...p, postedAt: p.postedAt.toISOString() }));

describe("lecture par compte réel via le service userbot (aucune seconde connexion)", () => {
  it("userbot muet depuis plus d'une minute : voie fermée (indisponible)", async () => {
    const prisma = createFakePrisma({ setting: [{ key: USERBOT_HEARTBEAT_KEY, value: { at: new Date(FIXTURE_NOW.getTime() - 120_000).toISOString() } }] });
    expect(await createUserbotHistoryTransport(prisma, { now: () => FIXTURE_NOW })).toBeNull();
    expect(await createUserbotHistoryTransport(createFakePrisma(), { now: () => FIXTURE_NOW })).toBeNull();
    const reader = await createDefaultAccountReader(createFakePrisma(), { now: () => FIXTURE_NOW });
    expect(reader.available).toBe(false);
  });

  it("de bout en bout : compte libre membre, lots de 50 lus par le userbot, lignes de demande effacées", async () => {
    const prisma = alive();
    prisma._tables.telegramUserAccount = [{ id: "libre", isActive: true, status: "ACTIVE", personaId: null, botId: null, createdAt: FIXTURE_NOW }];
    const ub = fakeUserbot(prisma, (row) => {
      if (row.kind === "is-member") return { ok: true, member: true };
      if (row.kind === "history") return { ok: true, posts: wire(row.beforeId ? row.beforeId - 1 : 120, Math.min(row.limit, row.beforeId ? row.beforeId - 1 : 120)), title: "Club (exemple)", chatId: "-100777" };
      return null;
    });
    const transport = await createUserbotHistoryTransport(prisma, { sleep: ub.sleep, now: ub.now });
    const reader = prismaAccountHistoryReader(prisma, { transport, now: ub.now });
    const r = await readWithAccount(reader, { username: "club_exemple", chatId: null }, { now: FIXTURE_NOW, sleep: ub.sleep });
    expect(r).toMatchObject({ ok: true, accountId: "libre", chatId: -100777n, title: "Club (exemple)" });
    expect(r.ok && r.posts.length).toBe(120);
    expect(ub.seen.filter((s) => s.kind === "history").map((s) => (s.kind === "history" ? [s.limit, s.beforeId ?? null] : null))).toEqual([[50, null], [50, 71], [50, 21]]);
    expect((prisma._tables.setting ?? []).filter((s) => String(s.key).startsWith(USERBOT_REQUEST_PREFIX))).toEqual([]);
  });

  it("FLOOD_WAIT renvoyé par le userbot → attendu par le worker ; pas de réponse en 5 minutes → arrêt (rate_limited)", async () => {
    const prisma = alive();
    let floods = 1;
    const ub = fakeUserbot(prisma, (row) => {
      if (row.kind !== "history") return null;
      if (floods-- > 0) return { ok: false, floodWaitSeconds: 30 };
      return { ok: true, posts: wire(10, 10) };
    });
    const transport = (await createUserbotHistoryTransport(prisma, { sleep: ub.sleep, now: ub.now }))!;
    expect(await transport.history("libre", { username: "x_exemple", chatId: null }, { limit: 50 })).toEqual({ floodWaitSeconds: 30 });
    const ok = await transport.history("libre", { username: "x_exemple", chatId: null }, { limit: 50 });
    expect("posts" in ok && ok.posts).toHaveLength(10);

    const muteNow = { t: FIXTURE_NOW.getTime() };
    const t2 = (await createUserbotHistoryTransport(prisma, { sleep: async (ms) => void (muteNow.t += ms), now: () => new Date(muteNow.t) }))!;
    expect(await t2.history("libre", { username: "x_exemple", chatId: null }, { limit: 50 })).toEqual({ floodWaitSeconds: Number.MAX_SAFE_INTEGER });
    expect(muteNow.t - FIXTURE_NOW.getTime()).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("rejoindre par lien d'invitation : une demande, réponse du userbot", async () => {
    const prisma = alive();
    const ub = fakeUserbot(prisma, (row) => (row.kind === "join-invite" ? { ok: true, chatId: "-100555", title: "Privé" } : null));
    const transport = (await createUserbotHistoryTransport(prisma, { sleep: ub.sleep, now: ub.now }))!;
    expect(await transport.joinWithInvite!("libre", "https://t.me/+AbC")).toEqual({ ok: true, chatId: -100555n, title: "Privé" });
    expect(ub.seen.filter((s) => s.kind === "join-invite")).toHaveLength(1);
  });
});
