import { describe, expect, it } from "vitest";
import { botsOnlineLabel, buildStatusBar, pointsLabel, statusParts, syncLabel } from "./status";

const now = new Date("2026-10-10T10:00:00Z");
const minAgo = (n: number) => new Date(now.getTime() - n * 60_000);
const bot = (username: string, lastError: string | null = null, isActive = true) => ({
  username,
  lastError,
  isActive,
});

describe("barre d'état de l'accueil", () => {
  it("tout va bien : bots en ligne et synchro récente", () => {
    const bar = buildStatusBar({
      workerDown: false,
      bots: [bot("casino_bot"), bot("sport_bot"), bot("dating_bot"), bot("old_bot", "x", false)],
      sync: [
        { lastSuccessAt: minAgo(5), lastError: null },
        { lastSuccessAt: minAgo(2), lastError: null },
      ],
      openAlerts: [],
    });
    expect(bar.ok).toBe(true);
    expect(bar.points).toBe(0);
    expect(bar.botsOnline).toBe(3);
    expect(bar.lastSyncAt).toEqual(minAgo(2));
    expect(statusParts(bar, now)).toEqual([
      "Tout va bien",
      "3 bots en ligne",
      "Link Affi synchronisé il y a 2 min",
    ]);
  });

  it("compte les points : service muet, bot en erreur, synchro en échec, alertes", () => {
    const bar = buildStatusBar({
      workerDown: true,
      bots: [bot("casino_bot", "Unauthorized"), bot("sport_bot")],
      sync: [{ lastSuccessAt: minAgo(30), lastError: "timeout" }],
      openAlerts: [
        { kind: "worker_down" },
        { kind: "sync_failed" },
        { kind: "channel_leak" },
        { kind: "post_failed" },
      ],
    });
    expect(bar.ok).toBe(false);
    // service + bot + synchro + 2 alertes qui ne redisent rien (worker_down et sync_failed sont déjà comptées).
    expect(bar.points).toBe(5);
    expect(bar.issues.map((i) => i.label)).toEqual([
      "Envois et synchro à l'arrêt",
      "Bot @casino_bot en erreur",
      "Synchro Link Affi en échec",
      "2 alertes ouvertes",
    ]);
    expect(bar.botsOnline).toBe(1);
    expect(statusParts(bar, now)[0]).toBe("5 points à voir");
  });

  it("une alerte worker_down compte si le service répond de nouveau (pas encore résolue)", () => {
    const bar = buildStatusBar({
      workerDown: false,
      bots: [bot("a")],
      sync: [],
      openAlerts: [{ kind: "worker_down" }],
    });
    expect(bar.points).toBe(1);
    expect(bar.issues[0]!.label).toBe("1 alerte ouverte");
  });

  it("aucun bot actif est un point à voir", () => {
    const bar = buildStatusBar({
      workerDown: false,
      bots: [bot("x", null, false)],
      sync: [],
      openAlerts: [],
    });
    expect(bar.ok).toBe(false);
    expect(bar.issues.map((i) => i.key)).toEqual(["no-bot"]);
    expect(statusParts(bar, now)).toEqual([
      "1 point à voir",
      "Aucun bot en ligne",
      "Link Affi pas encore synchronisé",
    ]);
  });

  it("libellés", () => {
    expect(botsOnlineLabel(1)).toBe("1 bot en ligne");
    expect(pointsLabel(1)).toBe("1 point à voir");
    expect(pointsLabel(4)).toBe("4 points à voir");
    expect(syncLabel(new Date(now.getTime() - 10_000), now)).toBe(
      "Link Affi synchronisé à l'instant",
    );
  });
});
