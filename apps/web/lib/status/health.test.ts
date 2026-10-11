import { describe, expect, it } from "vitest";
import { healthTiles, syncRowState, type HealthTile } from "./health";

const now = new Date("2026-10-10T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

const hb = (min: number) => ({
  at: ago(min).toISOString(),
  startedAt: ago(600).toISOString(),
  version: "1.0.0",
  pid: 1,
  commit: "abc1234",
});

type Input = Parameters<typeof healthTiles>[0];

const healthy: Input = {
  web: { db: "ok", dbLatencyMs: 4.2, redis: "ok" },
  worker: { heartbeat: hb(0.3), ageSec: 20, down: false },
  backup: { at: ago(8 * 60), file: "db.sql.gz", bytes: 1000, ok: true },
  bots: [
    {
      id: "b1",
      name: "Casino",
      username: "casino_bot",
      isActive: true,
      lastWebhookAt: ago(1),
      lastError: null,
      webhook: { ok: true },
    },
    {
      id: "b2",
      name: "Ancien",
      username: "old_bot",
      isActive: false,
      lastWebhookAt: null,
      lastError: null,
      webhook: null,
    },
  ],
  syncStates: [
    {
      source: "players",
      lastRunAt: ago(2),
      lastSuccessAt: ago(2),
      lastError: null,
      rowsImported: 10,
      isRunning: false,
    },
  ],
  openAlerts: [],
};

const byKey = (tiles: HealthTile[]) => Object.fromEntries(tiles.map((t) => [t.key, t]));

describe("tuiles de l'état du système", () => {
  it("tout va bien : six tuiles vertes, dans l'ordre", () => {
    const tiles = healthTiles(healthy, now);
    expect(tiles.map((t) => t.key)).toEqual(["site", "worker", "backup", "bots", "sync", "alerts"]);
    expect(tiles.every((t) => t.state.tone === "success")).toBe(true);
    const t = byKey(tiles);
    expect(t.site!.detail).toBe("Base de données en 4 ms.");
    expect(t.worker!.term).toBe("worker");
    expect(t.worker!.label).toBe("Service d'arrière-plan");
    expect(t.bots!.detail).toBe("1 bot actif sur 2.");
    expect(t.bots!.state.label).toBe("En ligne");
    expect(t.sync!.detail).toBe("Synchronisé il y a 2 min.");
    expect(t.alerts!.state.label).toBe("Aucune");
  });

  it("pannes : site, service arrêté, sauvegarde en échec, bot à vérifier, synchro en erreur, alerte critique", () => {
    const t = byKey(
      healthTiles(
        {
          web: { db: "erreur : connexion refusée", dbLatencyMs: null, redis: "ok" },
          worker: { heartbeat: hb(5), ageSec: 300, down: true },
          backup: { at: ago(60), file: null, bytes: 0, ok: false, error: "pg_dump" },
          bots: [{ ...healthy.bots[0]!, webhook: { ok: false, lastError: "502" } }],
          syncStates: [{ ...healthy.syncStates[0]!, lastError: "timeout" }],
          openAlerts: [
            { id: "a", kind: "worker_down", severity: "CRITICAL", message: "x", createdAt: now },
            { id: "b", kind: "sync_failed", severity: "WARNING", message: "y", createdAt: now },
          ],
        },
        now,
      ),
    );
    expect(t.site!.state).toEqual({ tone: "danger", label: "En panne" });
    expect(t.site!.detail).toMatch(/base de données/);
    expect(t.worker!.state.label).toBe("Arrêté");
    expect(t.worker!.detail).toMatch(/il y a 5 min/);
    expect(t.backup!.state.tone).toBe("danger");
    expect(t.bots!.state).toEqual({ tone: "danger", label: "1 à vérifier" });
    expect(t.sync!.state.label).toBe("En échec");
    expect(t.sync!.detail).toBe("1 donnée en erreur sur 1.");
    expect(t.alerts!.state).toEqual({ tone: "danger", label: "2 ouvertes" });
    expect(t.alerts!.detail).toMatch(/1 critique/);
  });

  it("états intermédiaires : lent, inconnu, sans sauvegarde ou en retard, aucun bot, pas encore synchronisé", () => {
    const t = byKey(
      healthTiles(
        {
          ...healthy,
          web: { db: "ok", dbLatencyMs: 230, redis: "ok" },
          worker: { heartbeat: null, ageSec: null, down: true },
          backup: null,
          bots: [],
          syncStates: [],
          openAlerts: [
            { id: "b", kind: "sync_failed", severity: "WARNING", message: "y", createdAt: now },
          ],
        },
        now,
      ),
    );
    expect(t.site!.state.label).toBe("Lent");
    expect(t.worker!.state).toEqual({ tone: "muted", label: "Inconnu" });
    expect(t.backup!.state.label).toBe("Aucune");
    expect(t.bots!.state.label).toBe("Aucun bot");
    expect(t.sync!.state.label).toBe("Pas encore");
    expect(t.alerts!.state).toEqual({ tone: "warning", label: "1 ouverte" });

    const late = byKey(
      healthTiles({ ...healthy, backup: { ...healthy.backup!, at: ago(40 * 60) } }, now),
    );
    expect(late.backup!.state.label).toBe("En retard");
    const stale = byKey(
      healthTiles(
        { ...healthy, syncStates: [{ ...healthy.syncStates[0]!, lastSuccessAt: ago(60) }] },
        now,
      ),
    );
    expect(stale.sync!.state).toEqual({ tone: "warning", label: "En retard" });
    expect(
      byKey(
        healthTiles(
          { ...healthy, worker: { ...healthy.worker, error: "ECONNREFUSED", heartbeat: null } },
          now,
        ),
      ).worker!.state.label,
    ).toBe("Injoignable");
  });
});

describe("lignes du tableau « Synchro Link Affi »", () => {
  const row = (o: Partial<Parameters<typeof syncRowState>[0]>) => ({
    isRunning: false,
    lastError: null,
    lastSuccessAt: ago(1),
    ...o,
  });

  it("même seuil que la tuile : un dernier succès de plus de 15 minutes est « en retard »", () => {
    expect(syncRowState(row({ lastSuccessAt: ago(2) }), now)).toBe("ok");
    expect(syncRowState(row({ lastSuccessAt: ago(14) }), now)).toBe("ok");
    expect(syncRowState(row({ lastSuccessAt: ago(16) }), now)).toBe("late");
    expect(syncRowState(row({ lastSuccessAt: ago(13 * 60) }), now)).toBe("late");
  });

  it("en cours, en erreur et jamais passée l'emportent sur le retard", () => {
    expect(syncRowState(row({ isRunning: true, lastSuccessAt: ago(600) }), now)).toBe("running");
    expect(syncRowState(row({ lastError: "boom", lastSuccessAt: ago(600) }), now)).toBe("error");
    expect(syncRowState(row({ lastSuccessAt: null }), now)).toBe("never");
  });

  it("la tuile « En retard » et les lignes disent la même chose", () => {
    const syncStates = [{ ...healthy.syncStates[0]!, lastSuccessAt: ago(780) }];
    const tiles = healthTiles({ ...healthy, syncStates }, now);
    expect(tiles.find((t) => t.key === "sync")?.state.label).toBe("En retard");
    expect(syncStates.map((s) => syncRowState(s, now))).toEqual(["late"]);
  });
});
