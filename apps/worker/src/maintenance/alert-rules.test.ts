import { describe, expect, it } from "vitest";
import { backupFileDate, detectBackupFailed, detectBotWebhook, detectDmBlocked, detectJobFailures, detectQueueBacklog, detectSubIdHealth, detectSyncFailed, detectWorkerDown, formatAlert, shouldCreate } from "./alert-rules";

const now = new Date("2026-10-09T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

describe("alertes bots", () => {
  it("signale un bot en erreur", () => {
    const d = detectBotWebhook([{ username: "a", isActive: true, lastWebhookAt: ago(1), lastError: "webhook 500" }], now);
    expect(d?.kind).toBe("bot_webhook");
    expect(d?.message).toContain("@a");
  });
  it("signale un bot silencieux seulement si un autre reçoit des updates", () => {
    expect(detectBotWebhook([{ username: "a", isActive: true, lastWebhookAt: ago(30), lastError: null }], now)).toBeNull();
    const d = detectBotWebhook([{ username: "a", isActive: true, lastWebhookAt: ago(30), lastError: null }, { username: "b", isActive: true, lastWebhookAt: ago(2), lastError: null }], now);
    expect(d?.payload.bots).toEqual(["a"]);
  });
  it("ignore les bots inactifs", () => {
    expect(detectBotWebhook([{ username: "a", isActive: false, lastWebhookAt: null, lastError: "x" }], now)).toBeNull();
  });
});

describe("autres règles", () => {
  it("synchro en échec après 3 passages", () => {
    expect(detectSyncFailed([{ source: "players", lastError: "500", errorStreak: 2 }])).toBeNull();
    expect(detectSyncFailed([{ source: "players", lastError: "500", errorStreak: 3 }])?.payload.sources).toEqual(["players"]);
  });
  it("file engorgée au-delà de 500", () => {
    expect(detectQueueBacklog(500)).toBeNull();
    expect(detectQueueBacklog(501)?.kind).toBe("queue_backlog");
  });
  it("blocages en masse au-delà de 50", () => {
    expect(detectDmBlocked(50)).toBeNull();
    expect(detectDmBlocked(51)?.severity).toBe("WARNING");
  });
  it("santé du sub-ID seulement en état alert", () => {
    expect(detectSubIdHealth("warning", "x")).toBeNull();
    expect(detectSubIdHealth("alert", "tronqué")?.message).toContain("tronqué");
  });
  it("dédoublonne sur une heure", () => {
    expect(shouldCreate("bot_webhook", [{ kind: "bot_webhook", createdAt: ago(30) }], now)).toBe(false);
    expect(shouldCreate("bot_webhook", [{ kind: "bot_webhook", createdAt: ago(23 * 60) }], now)).toBe(false);
    expect(shouldCreate("bot_webhook", [{ kind: "bot_webhook", createdAt: ago(25 * 60) }], now)).toBe(true);
    expect(shouldCreate("bot_webhook", [{ kind: "sync_failed", createdAt: ago(1) }], now)).toBe(true);
  });
  it("formate en HTML échappé", () => {
    const t = formatAlert({ kind: "queue_backlog", severity: "WARNING", message: "a <b> & c", payload: {} });
    expect(t).toContain("🟠");
    expect(t).toContain("a &lt;b&gt; &amp; c");
  });
});

describe("règles de solidité", () => {
  it("worker arrêté seulement au-delà de 3 minutes sans battement", () => {
    expect(detectWorkerDown(null, now)).toBeNull();
    expect(detectWorkerDown(ago(2), now)).toBeNull();
    const d = detectWorkerDown(ago(12), now);
    expect(d?.kind).toBe("worker_down");
    expect(d?.severity).toBe("CRITICAL");
    expect(d?.payload.downMinutes).toBe(12);
    expect(d?.message).toContain("12 min");
  });
  it("sauvegarde en échec seulement sans succès depuis 36 h", () => {
    expect(detectBackupFailed(null, now)).toBeNull();
    expect(detectBackupFailed({ at: now.toISOString(), file: "linkaffipro-2026-10-09T02-00-00.sql.gz", ok: true }, now)).toBeNull();
    // Échec mais un succès de la nuit est conservé : pas encore d'alerte.
    expect(detectBackupFailed({ at: now.toISOString(), file: "linkaffipro-2026-10-09T02-00-00.sql.gz", ok: false, error: "pg_dump absent" }, now)).toBeNull();
    // Échec et dernier succès vieux de 2 jours.
    const d = detectBackupFailed({ at: now.toISOString(), file: "linkaffipro-2026-10-07T02-00-00.sql.gz", ok: false, error: "pg_dump absent" }, now);
    expect(d?.kind).toBe("backup_failed");
    expect(d?.message).toBe("La sauvegarde automatique de la base a échoué : pg_dump absent");
    // Échec sans aucun succès connu.
    expect(detectBackupFailed({ at: now.toISOString(), file: null, ok: false }, now)?.message).toContain("erreur inconnue");
    expect(backupFileDate("linkaffipro-2026-10-07T02-30-15.sql.gz")?.toISOString()).toBe("2026-10-07T02:30:15.000Z");
    expect(backupFileDate("autre.sql.gz")).toBeNull();
  });
  it("erreurs répétées à partir de 10 échecs sur une même file", () => {
    expect(detectJobFailures({ stats: 9, "telegram-send": 3 })).toBeNull();
    const d = detectJobFailures({ stats: 10, "telegram-send": 3 });
    expect(d?.kind).toBe("job_failures");
    expect(d?.message).toContain("stats (10)");
    expect(d?.message).not.toContain("telegram-send");
    expect(d?.payload.queues).toEqual({ stats: 10 });
  });
});
