import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../testing/fake-prisma";
import { askUserbot, freeReaderAccounts, USERBOT_HEARTBEAT_KEY, USERBOT_REQUEST_PREFIX, userbotMailboxAlive, UserbotTimeout } from "./userbot-mailbox";

describe("comptes réels libres", () => {
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
  it("actifs, sans persona ni bot fantôme, sans DM depuis 7 jours", async () => {
    expect(await freeReaderAccounts(prisma, now)).toEqual(["libre"]);
  });
});

describe("boîte aux lettres du userbot", () => {
  it("voie fermée si le userbot est muet depuis plus d'une minute", async () => {
    const now = new Date("2026-10-24T12:00:00Z");
    const prisma = createFakePrisma({ setting: [{ key: USERBOT_HEARTBEAT_KEY, value: { at: "2026-10-24T11:58:00Z" } }] });
    expect(await userbotMailboxAlive(prisma, now)).toBe(false);
    await prisma.setting.update({ where: { key: USERBOT_HEARTBEAT_KEY }, data: { value: { at: "2026-10-24T11:59:30Z" } } });
    expect(await userbotMailboxAlive(prisma, now)).toBe(true);
  });
  it("demande déposée, réponse lue, ligne effacée ; sans réponse à temps → UserbotTimeout", async () => {
    const prisma = createFakePrisma({});
    let t = 0;
    const now = () => new Date(Date.UTC(2026, 9, 24, 12) + t);
    const sleep = async (ms: number) => {
      t += ms;
      for (const row of await prisma.setting.findMany({ where: { key: { startsWith: USERBOT_REQUEST_PREFIX } } }))
        await prisma.setting.update({ where: { key: row.key }, data: { value: { ...(row.value as object), status: "DONE", response: { ok: true } } } });
    };
    expect(await askUserbot(prisma, { kind: "prospect-search", accountId: "acc1" }, { timeoutMs: 10_000, sleep, now })).toEqual({ ok: true });
    expect(await prisma.setting.findMany({ where: { key: { startsWith: USERBOT_REQUEST_PREFIX } } })).toHaveLength(0);
    await expect(askUserbot(prisma, { kind: "prospect-search" }, { timeoutMs: 3_000, sleep: async (ms) => void (t += ms), now })).rejects.toBeInstanceOf(UserbotTimeout);
    expect(await prisma.setting.findMany({ where: { key: { startsWith: USERBOT_REQUEST_PREFIX } } })).toHaveLength(0);
  });
});
