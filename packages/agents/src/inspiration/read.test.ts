import { describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "../testing/fake-prisma";
import type { AgentsDeps } from "../types";
import { enqueueReferenceRead, INSPIRATION_LOCK_KEY, INSPIRATION_READS_KEY, readsUsedToday, runReferenceRead, runWeeklyRereads, setReferenceReadHooks } from "./read";
import { fakeAccountReader, fakePosts, fakeSleep, FIXTURE_CHANNELS, FIXTURE_NOW, fixtureFetch } from "./testing/fixtures";

type Row = Record<string, unknown>;

function kit(refs: Row[], extra: Record<string, Row[]> = {}) {
  let now = FIXTURE_NOW;
  const prisma = createFakePrisma({ referenceChannel: refs.map((r) => ({ status: "READING", postCount: 0, removedAt: null, accountId: null, telegramChatId: null, username: null, ...r })), ...extra });
  const orchestrator = vi.fn(async () => undefined);
  const deps: AgentsDeps = { prisma, now: () => now, enqueue: { orchestrator, step: vi.fn(async () => undefined) } };
  const afterRead = vi.fn(async () => undefined);
  const afterReread = vi.fn(async () => undefined);
  const fetch = fixtureFetch();
  const io = { fetch, sleep: fakeSleep(), afterRead, afterReread, accountReader: fakeAccountReader({ members: [] }) };
  const ref = (id: string) => prisma._tables.referenceChannel!.find((r) => r.id === id)!;
  const posts = (id: string) => (prisma._tables.referencePost ?? []).filter((p) => p.referenceChannelId === id);
  return { prisma, deps, io, fetch, afterRead, afterReread, orchestrator, ref, posts, setNow: (d: Date) => (now = d) };
}

describe("lecture d'une référence : voie choisie", () => {
  it("nom public et aperçu ouvert → aperçu web ; posts rangés, READY, relecture dans 7 jours, Kevin prévenu, verrou rendu", async () => {
    const k = kit([{ id: "r1", username: FIXTURE_CHANNELS.casino, via: "WEB", universe: "casino" }]);
    const out = await runReferenceRead(k.deps, "r1", k.io);
    expect(out).toMatchObject({ ok: true, via: "WEB", status: "READY", created: 31 });
    expect(k.posts("r1")).toHaveLength(31);
    expect(k.ref("r1")).toMatchObject({ status: "READY", via: "WEB", postCount: 31, title: "Casino Lumière 🎰 (exemple)", lastReadAt: FIXTURE_NOW });
    expect(k.ref("r1").nextReadAt).toEqual(new Date(FIXTURE_NOW.getTime() + 7 * 86_400_000));
    expect(k.afterRead).toHaveBeenCalledWith(k.deps, "r1");
    expect(k.prisma._tables.setting!.some((s) => s.key === INSPIRATION_LOCK_KEY)).toBe(false);
    expect(await readsUsedToday(k.deps)).toBe(1);
  });

  it("aperçu fermé + compte réel membre → compte (identifiant du compte gardé)", async () => {
    const k = kit([{ id: "r1", username: FIXTURE_CHANNELS.private, via: "WEB", universe: "dating" }]);
    const out = await runReferenceRead(k.deps, "r1", { ...k.io, accountReader: fakeAccountReader({ posts: fakePosts(300, 40) }) });
    expect(out).toMatchObject({ ok: true, via: "ACCOUNT", created: 40 });
    expect(k.ref("r1")).toMatchObject({ status: "READY", via: "ACCOUNT", accountId: "acc1", telegramChatId: -100777n });
  });

  it("aperçu fermé et aucun compte membre → UNAVAILABLE avec la raison ; Kevin prévenu (il demandera des posts transférés)", async () => {
    const k = kit([{ id: "r1", username: FIXTURE_CHANNELS.private, via: "WEB", universe: "dating" }]);
    const out = await runReferenceRead(k.deps, "r1", k.io);
    expect(out).toMatchObject({ ok: false, status: "UNAVAILABLE" });
    expect(k.ref("r1").status).toBe("UNAVAILABLE");
    expect(String(k.ref("r1").unavailableReason)).toMatch(/aperçu public.*transfère-moi/s);
    expect(k.afterRead).toHaveBeenCalledTimes(1);
  });

  it("lecteur réel par défaut (sessions tenues par le service userbot) : jamais de connexion, indisponible", async () => {
    const k = kit([{ id: "r1", username: null, telegramChatId: -100555n, via: "ACCOUNT", universe: "casino" }], {
      telegramUserAccount: [{ id: "libre", isActive: true, status: "ACTIVE", personaId: null, botId: null }],
    });
    const { accountReader: _ignored, ...io } = k.io;
    const out = await runReferenceRead(k.deps, "r1", io);
    expect(out).toMatchObject({ ok: false, status: "UNAVAILABLE" });
    expect(k.fetch.urls).toEqual([]);
  });

  it("posts transférés : rien à lire ; référence retirée : rien", async () => {
    const k = kit([
      { id: "f1", username: null, via: "FORWARDED", universe: "sports", status: "READY" },
      { id: "x1", username: FIXTURE_CHANNELS.casino, via: "WEB", universe: "casino", removedAt: FIXTURE_NOW },
    ]);
    expect(await runReferenceRead(k.deps, "f1", k.io)).toMatchObject({ ok: true, via: "FORWARDED" });
    expect(await runReferenceRead(k.deps, "x1", k.io)).toMatchObject({ ok: false });
    expect(k.fetch.urls).toEqual([]);
    expect(k.afterRead).not.toHaveBeenCalled();
  });

  it("Telegram indisponible (503) → à refaire dans 10 min, toujours READING, Kevin pas encore prévenu", async () => {
    const k = kit([{ id: "r1", username: "panne_exemple", via: "WEB", universe: "casino" }]);
    const out = await runReferenceRead(k.deps, "r1", { ...k.io, fetch: async () => ({ status: 503, body: "" }) });
    expect(out).toMatchObject({ ok: false, retryInMs: 600_000, status: "READING" });
    expect(k.ref("r1").status).toBe("READING");
    expect(k.afterRead).not.toHaveBeenCalled();
  });
});

describe("une lecture à la fois, 5 par jour, reprise", () => {
  it("verrou tenu par une autre lecture → nouvel essai dans une minute, rien de lu ; verrou abandonné (15 min) → repris", async () => {
    const until = new Date(FIXTURE_NOW.getTime() + 5 * 60_000).toISOString();
    const k = kit([{ id: "r1", username: FIXTURE_CHANNELS.casino, via: "WEB", universe: "casino" }], {
      setting: [{ key: INSPIRATION_LOCK_KEY, value: { holder: "autre", until } }],
    });
    expect(await runReferenceRead(k.deps, "r1", k.io)).toMatchObject({ ok: false, retryInMs: 60_000 });
    expect(k.fetch.urls).toEqual([]);
    k.setNow(new Date(FIXTURE_NOW.getTime() + 6 * 60_000));
    expect(await runReferenceRead(k.deps, "r1", k.io)).toMatchObject({ ok: true });
  });

  it("6e lecture du jour → remise au lendemain (Paris) ; le lendemain elle passe", async () => {
    const names = [FIXTURE_CHANNELS.casino, FIXTURE_CHANNELS.sports, FIXTURE_CHANNELS.dating, FIXTURE_CHANNELS.casino, FIXTURE_CHANNELS.sports, FIXTURE_CHANNELS.dating];
    const k = kit(names.map((n, i) => ({ id: `r${i}`, username: n, via: "WEB", universe: "casino", status: "READY" })));
    for (let i = 0; i < 5; i++) expect(await runReferenceRead(k.deps, `r${i}`, k.io)).toMatchObject({ ok: true });
    const sixth = await runReferenceRead(k.deps, "r5", k.io);
    expect(sixth).toMatchObject({ ok: false });
    // 12:00 UTC = 14:00 Paris : minuit de Paris dans 10 h (+5 min de marge).
    expect(sixth.retryInMs).toBe(10 * 3_600_000 + 5 * 60_000);
    k.setNow(new Date("2026-10-25T08:00:00Z"));
    expect(await runReferenceRead(k.deps, "r5", k.io)).toMatchObject({ ok: true });
    expect(await readsUsedToday(k.deps)).toBe(1);
  });

  it("reprise d'une lecture interrompue : pas de doublon, pas comptée deux fois", async () => {
    const k = kit([{ id: "r1", username: FIXTURE_CHANNELS.sports, via: "WEB", universe: "sports", status: "READING" }], {
      setting: [{ key: INSPIRATION_READS_KEY, value: { day: "2026-10-24", ids: ["r1"] } }],
      // Lecture coupée après 2 posts déjà rangés ; son verrou est resté.
      referencePost: [
        { referenceChannelId: "r1", externalId: 530, postedAt: FIXTURE_NOW, via: "WEB", text: "x", shingles: [], keywords: [], features: {} },
        { referenceChannelId: "r1", externalId: 531, postedAt: FIXTURE_NOW, via: "WEB", text: "y", shingles: [], keywords: [], features: {} },
      ],
    });
    await k.prisma.setting.create({ data: { key: INSPIRATION_LOCK_KEY, value: { holder: "r1", until: new Date(FIXTURE_NOW.getTime() + 600_000).toISOString() } } });
    const out = await runReferenceRead(k.deps, "r1", k.io);
    expect(out).toMatchObject({ ok: true, created: 27, updated: 2 });
    expect(k.posts("r1")).toHaveLength(29);
    expect(await readsUsedToday(k.deps)).toBe(1);
  });
});

describe("relecture hebdomadaire", () => {
  it("référence due : seulement les posts plus récents que le dernier connu, relecture suivante dans 7 jours, Kevin décide", async () => {
    const past = new Date(FIXTURE_NOW.getTime() - 3_600_000);
    const k = kit(
      [
        { id: "due", username: FIXTURE_CHANNELS.casino, via: "WEB", universe: "casino", status: "READY", nextReadAt: past },
        { id: "later", username: FIXTURE_CHANNELS.sports, via: "WEB", universe: "sports", status: "READY", nextReadAt: new Date(FIXTURE_NOW.getTime() + 86_400_000) },
        { id: "fwd", username: null, via: "FORWARDED", universe: "sports", status: "READY", nextReadAt: past },
        { id: "stuck", username: FIXTURE_CHANNELS.dating, via: "WEB", universe: "dating", status: "READING" },
      ],
      { referencePost: [{ referenceChannelId: "due", externalId: 1027, postedAt: FIXTURE_NOW, via: "WEB", shingles: [], keywords: [], features: {} }] },
    );
    k.ref("stuck").updatedAt = new Date(FIXTURE_NOW.getTime() - 2 * 3_600_000);
    const s = await runWeeklyRereads(k.deps, k.io);
    expect(s).toEqual({ reread: 1, resumed: 1, skipped: 0, stoppedBy: null });
    expect(k.posts("due").map((p) => p.externalId).sort()).toEqual([1027, 1028, 1029, 1030, 1031, 1032]);
    expect(k.fetch.urls).toEqual(["https://t.me/s/casino_lumiere_exemple"]);
    expect(k.ref("due").nextReadAt).toEqual(new Date(FIXTURE_NOW.getTime() + 7 * 86_400_000));
    expect(k.afterReread).toHaveBeenCalledWith(k.deps, "due");
    expect(k.afterReread).toHaveBeenCalledTimes(1);
    expect(k.orchestrator).toHaveBeenCalledWith({ type: "inspiration-read", referenceChannelId: "stuck" }, { jobId: "inspiration-read:stuck" });
  });

  it("aperçu fermé entre-temps : posts gardés, nouvel essai demain, aucune entrée en force", async () => {
    const k = kit([{ id: "due", username: FIXTURE_CHANNELS.private, via: "WEB", universe: "dating", status: "READY", nextReadAt: FIXTURE_NOW }]);
    expect(await runWeeklyRereads(k.deps, k.io)).toMatchObject({ reread: 0, skipped: 1 });
    expect(k.ref("due")).toMatchObject({ status: "READY", nextReadAt: new Date(FIXTURE_NOW.getTime() + 86_400_000) });
    expect(k.afterReread).not.toHaveBeenCalled();
  });

  it("quota du jour atteint : la relecture attend", async () => {
    const k = kit([{ id: "due", username: FIXTURE_CHANNELS.casino, via: "WEB", universe: "casino", status: "READY", nextReadAt: FIXTURE_NOW }], {
      setting: [{ key: INSPIRATION_READS_KEY, value: { day: "2026-10-24", ids: ["a", "b", "c", "d", "e"] } }],
    });
    expect(await runWeeklyRereads(k.deps, k.io)).toMatchObject({ reread: 0, stoppedBy: "quota" });
    expect(k.fetch.urls).toEqual([]);
  });
});

describe("mise en file et suites de Kevin", () => {
  it("enqueueReferenceRead : tâche du Grand Chef transmise à agents-algo, identifiant inspiration-read:<id>", async () => {
    const k = kit([]);
    await enqueueReferenceRead(k.deps, "abc");
    expect(k.orchestrator).toHaveBeenCalledWith({ type: "inspiration-read", referenceChannelId: "abc" }, { jobId: "inspiration-read:abc" });
  });
  it("suites branchées par setReferenceReadHooks quand rien n'est injecté", async () => {
    const k = kit([{ id: "r1", username: FIXTURE_CHANNELS.casino, via: "WEB", universe: "casino" }]);
    const afterRead = vi.fn(async () => undefined);
    setReferenceReadHooks({ afterRead });
    const { afterRead: _a, ...io } = k.io;
    await runReferenceRead(k.deps, "r1", io);
    expect(afterRead).toHaveBeenCalledWith(k.deps, "r1");
    setReferenceReadHooks({ afterRead: undefined });
  });
});
