import { describe, expect, it, vi } from "vitest";
import { webhookProblems, webhookRepairRefusal, webhookTargetRefusal } from "./webhook-health";
import { runWebhookRepair, type WebhookRepairDeps } from "./webhook-repair";
import { diagLines, formatDiag, type DiagSnapshot } from "./diag";
import { adminBot, type AdminBotDb } from "./admin-bot";

const NOW = new Date("2026-10-24T12:00:00Z");
const URL_OK = "https://app.linkaffipro.com/api/telegram/b1";
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

describe("santé d'un webhook (phase 26)", () => {
  it("adresse, 403 récent, types d'update", () => {
    expect(webhookProblems({ url: URL_OK, allowed_updates: ["message", "callback_query"] }, URL_OK, NOW)).toEqual([]);
    expect(webhookProblems({ url: "" }, URL_OK, NOW)).toEqual(["no_url"]);
    expect(webhookProblems({ url: "https://autre/x" }, URL_OK, NOW)).toEqual(["url_mismatch"]);
    const recent = { url: URL_OK, last_error_message: "Wrong response from the webhook: 403 Forbidden", last_error_date: sec(NOW) - 600 };
    expect(webhookProblems(recent, URL_OK, NOW)).toEqual(["forbidden"]);
    expect(webhookProblems({ ...recent, last_error_date: sec(NOW) - 7200 }, URL_OK, NOW)).toEqual([]);
    expect(webhookProblems({ url: URL_OK, allowed_updates: ["chat_member"] }, URL_OK, NOW)).toEqual(["missing_updates"]);
  });

  it("jamais de webhook public posé depuis une base locale (cause du 21 octobre)", () => {
    const local = { DATABASE_URL: "postgresql://u:p@localhost:54329/db" };
    expect(webhookTargetRefusal("https://app.linkaffipro.com/api/telegram/x", local)).toMatch(/Base locale/);
    expect(webhookTargetRefusal("http://localhost:3000/api/telegram/x", local)).toBeNull();
    expect(webhookTargetRefusal("https://app.linkaffipro.com/api/telegram/x", { DATABASE_URL: "postgresql://u:p@postgres.railway.internal:5432/db" })).toBeNull();
    expect(webhookTargetRefusal("https://app.linkaffipro.com/x", { ...local, ALLOW_REMOTE_WEBHOOK: "1" })).toBeNull();
  });

  it("réparation automatique seulement en production", () => {
    expect(webhookRepairRefusal({ APP_BASE_URL: "http://localhost:3000", DATABASE_URL: "postgresql://localhost/x" })).not.toBeNull();
    expect(webhookRepairRefusal({ APP_BASE_URL: "https://app.linkaffipro.com", DATABASE_URL: "postgresql://localhost/x" })).toBe("base locale");
    expect(webhookRepairRefusal({ APP_BASE_URL: "https://app.linkaffipro.com", DATABASE_URL: "postgresql://postgres.railway.internal/x" })).toBeNull();
  });
});

function fakeRepair(infos: Record<string, { url?: string; last_error_message?: string; last_error_date?: number }>, failRepair = false) {
  const repaired: string[] = [];
  const events: Array<{ bot: string; payload: Record<string, unknown> }> = [];
  let saved: unknown = null;
  const deps: WebhookRepairDeps = {
    listBots: async () => Object.keys(infos).map((id) => ({ id, username: id === "ghost" ? "userbot_abc" : `${id}_bot` })),
    getInfo: async (id) => infos[id]!,
    repair: vi.fn(async (id) => {
      if (failRepair) throw new Error("Telegram injoignable");
      repaired.push(id);
      return { url: `https://app.linkaffipro.com/api/telegram/${id}`, pending_update_count: 0 };
    }),
    expectedUrl: (id) => `https://app.linkaffipro.com/api/telegram/${id}`,
    recordRepaired: async (bot, payload) => void events.push({ bot: bot.id, payload }),
    saveCheck: async (c) => void (saved = c),
    now: () => NOW,
  };
  return { deps, repaired, events, saved: () => saved };
}

describe("réparation des webhooks (faux Telegram)", () => {
  it("403 récent et mauvaise adresse → reposés avec événement ; bon webhook et bot fantôme : rien", async () => {
    const f = fakeRepair({
      b1: { url: "https://app.linkaffipro.com/api/telegram/b1" },
      b2: { url: "https://app.linkaffipro.com/api/telegram/b2", last_error_message: "403 Forbidden", last_error_date: sec(NOW) - 60 },
      b3: { url: "http://localhost:3000/api/telegram/b3" },
      ghost: { url: "" },
    });
    const check = await runWebhookRepair(f.deps);
    expect(f.repaired).toEqual(["b2", "b3"]);
    expect(f.events.map((e) => e.bot)).toEqual(["b2", "b3"]);
    expect(f.events[0]!.payload.problems).toEqual(["forbidden"]);
    expect(check.bots.map((b) => [b.botId, b.ok, b.repaired])).toEqual([
      ["b1", true, false],
      ["b2", true, true],
      ["b3", true, true],
    ]);
    expect(f.saved()).toEqual(check);
  });

  it("réparation impossible : notée, sans événement, sans lever", async () => {
    const f = fakeRepair({ b1: { url: "" } }, true);
    const check = await runWebhookRepair(f.deps);
    expect(check.bots[0]).toMatchObject({ ok: false, repaired: false, error: "Telegram injoignable" });
    expect(f.events).toEqual([]);
  });
});

describe("choix du bot du dialogue admin", () => {
  const row = (id: string, role: string) => ({ id, role, username: id }) as never;
  it("le Boss actif s'il existe, sinon le repli casino", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const db = (bossRow: unknown, fallback: unknown): AdminBotDb => ({
      bot: {
        findFirst: async (args) => {
          calls.push(args.where);
          return (args.where.role === "ADMIN" ? bossRow : fallback) as never;
        },
      },
    });
    expect(await adminBot(db(row("boss", "ADMIN"), row("casino", "CHANNEL")))).toMatchObject({ id: "boss", isBoss: true });
    expect(await adminBot(db(null, row("casino", "CHANNEL")))).toMatchObject({ id: "casino", isBoss: false });
    expect(await adminBot(db(null, null))).toBeNull();
    // Le repli exclut le Boss, les assistants et les bots fantômes ; le Boss doit être actif et normal.
    expect(calls[0]).toMatchObject({ role: "ADMIN", isActive: true, mode: "STANDARD" });
    expect(calls.find((w) => w.role === "CHANNEL")).toMatchObject({ vertical: "CASINO", isActive: true, mode: "STANDARD" });
  });
});

describe("pnpm tg:diag (lignes)", () => {
  const base: DiagSnapshot = {
    now: NOW,
    adminId: "4242",
    adminBotId: "boss",
    adminBotIsBoss: true,
    baseUrl: "https://app.linkaffipro.com",
    bots: [
      { id: "boss", username: "kevin_bot", role: "ADMIN", mode: "STANDARD", isActive: true, info: { url: "https://app.linkaffipro.com/api/telegram/boss", pending_update_count: 0 }, canReadAllGroupMessages: false },
      { id: "c1", username: "casinogamblingoobot", role: "CHANNEL", mode: "STANDARD", isActive: true, info: { url: "https://app.linkaffipro.com/api/telegram/c1", pending_update_count: 12, last_error_message: "Wrong response from the webhook: 403 Forbidden", last_error_date: sec(NOW) - 120 } },
      { id: "g", username: "userbot_x", role: "CHANNEL", mode: "STANDARD", isActive: true, ghost: true },
    ],
    lastAdminMessage: { at: new Date(NOW.getTime() - 600_000), botUsername: "kevin_bot", textLength: 6, isCommand: false },
    lastBossTurn: { at: new Date(NOW.getTime() - 590_000), role: "BOSS", status: "done", actionKey: "etat" },
    lastAuditAfter: null,
    queues: [{ name: "agents-orchestrator", waiting: 1, active: 0, failed: 0, delayed: 0, lastActivityAt: NOW, oldestWaitingAt: new Date(NOW.getTime() - 300_000) }],
    heartbeatAgeSec: 20,
    pendingRequest: null,
    webDialogWired: true,
  };
  it("403 → secret différent ; file en retard ; mode confidentialité du Boss ; fantôme ignoré", () => {
    const out = formatDiag(diagLines(base));
    expect(out).toContain("❌ @casinogamblingoobot");
    expect(out).toContain("secret du webhook différent : relancer pnpm telegram:webhooks");
    expect(out).toContain("mode confidentialité activé");
    expect(out).toContain("bot fantôme");
    expect(out).toContain("✅ Bot du dialogue admin : @kevin_bot (Boss");
    expect(out).toMatch(/❌ File agents-orchestrator/);
    expect(out).toContain("✅ Suivi : tour du Boss");
  });
  it("aucun identifiant admin, aucun bot du dialogue, worker muet", () => {
    const out = formatDiag(diagLines({ ...base, adminId: null, adminBotId: null, heartbeatAgeSec: null, lastAdminMessage: null }));
    expect(out).toContain("❌ Identifiant admin absent");
    expect(out).toContain("❌ Aucun bot du dialogue admin");
    expect(out).toContain("❌ Battement du service d'arrière-plan absent");
  });
});
