import { describe, expect, it } from "vitest";
import { botCheck, botsTile, healthSummary, healthTiles } from "./health";
import type { HealthInput } from "./queries";
import {
  NO_STATE_INPUT,
  adPlatformState,
  aiState,
  alertsState,
  assistantState,
  botsState,
  categoriesState,
  linkAffiState,
  plural,
  postbacksState,
  settingsStates,
  systemState,
  tagsState,
  teamState,
  telegramState,
} from "./settings-cards";

const now = new Date("2026-10-10T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const bot = (
  username: string,
  webhook: HealthInput["bots"][number]["webhook"],
  lastError: string | null = null,
) => ({
  id: username,
  name: username,
  username,
  isActive: true,
  lastWebhookAt: null,
  lastError,
  webhook,
});

const healthy: HealthInput = {
  web: { db: "ok", dbLatencyMs: 3, redis: "ok" },
  worker: {
    heartbeat: {
      at: minutesAgo(0.5).toISOString(),
      startedAt: minutesAgo(600).toISOString(),
      version: "1",
      pid: 1,
    },
    ageSec: 30,
    down: false,
  },
  backup: { at: minutesAgo(8 * 60), file: "db.sql.gz", bytes: 1, ok: true },
  bots: [bot("casino_bot", { ok: true })],
  syncStates: [
    {
      source: "players",
      lastRunAt: minutesAgo(2),
      lastSuccessAt: minutesAgo(2),
      lastError: null,
      rowsImported: 1,
      isRunning: false,
    },
  ],
  openAlerts: [],
};

/** Base de démonstration locale : jetons factices, pas de service d'arrière-plan, pas de sauvegarde. */
const local: HealthInput = {
  ...healthy,
  worker: { heartbeat: null, ageSec: null, down: true },
  backup: null,
  bots: [
    bot("demo_casino_bot", { ok: false, fetchError: "Unauthorized" }, "Unauthorized"),
    bot("demo_sports_bot", { ok: false, fetchError: "Unauthorized" }),
    bot("demo_dating_bot", { ok: false, fetchError: "Unauthorized" }),
    bot("test_bot", { ok: false, url: "" }),
  ],
  syncStates: [{ ...healthy.syncStates[0]!, lastSuccessAt: minutesAgo(90) }],
};

describe("pastilles des cartes de Réglages", () => {
  it("accorde le pluriel et sépare les milliers", () => {
    expect(plural(1, "compte", "comptes")).toBe("1 compte");
    expect(plural(0, "compte", "comptes")).toBe("0 compte");
    expect(plural(1240, "compte", "comptes")).toBe("1 240 comptes");
  });

  it("Link Affi : synchronisé il y a 2 min, en retard, en échec, jamais", () => {
    expect(linkAffiState(null, now)).toBeUndefined();
    expect(linkAffiState([], now)).toEqual({ tone: "muted", label: "Pas encore synchronisé" });
    expect(
      linkAffiState(
        [
          { lastSuccessAt: minutesAgo(5), lastError: null },
          { lastSuccessAt: minutesAgo(2), lastError: null },
        ],
        now,
      ),
    ).toEqual({ tone: "success", label: "Synchronisé il y a 2 min" });
    const late = linkAffiState([{ lastSuccessAt: minutesAgo(180), lastError: null }], now);
    expect(late?.tone).toBe("warning");
    expect(late?.label).toBe("Synchronisé il y a 3 h");
    expect(
      linkAffiState(
        [
          { lastSuccessAt: minutesAgo(2), lastError: "timeout" },
          { lastSuccessAt: minutesAgo(2), lastError: "500" },
        ],
        now,
      ),
    ).toEqual({
      tone: "danger",
      label: "Synchro en échec",
      title: "2 données Link Affi en erreur",
    });
    expect(linkAffiState([{ lastSuccessAt: null, lastError: null }], now)?.label).toBe(
      "Pas encore synchronisé",
    );
  });

  it("Meta et TikTok : à reconnecter d'abord, puis comptes connectés, sinon aucun", () => {
    const rows = [
      { platform: "META", status: "ACTIVE", count: 2 },
      { platform: "META", status: "DISABLED", count: 4 },
      { platform: "TIKTOK", status: "ACTIVE", count: 1 },
      { platform: "TIKTOK", status: "NEEDS_RECONNECT", count: 1 },
    ];
    expect(adPlatformState(rows, "META")).toEqual({
      tone: "success",
      label: "2 comptes connectés",
    });
    expect(adPlatformState(rows, "TIKTOK")).toEqual({
      tone: "danger",
      label: "1 compte à reconnecter",
    });
    expect(adPlatformState([], "META")).toEqual({ tone: "muted", label: "Aucun compte connecté" });
    expect(
      adPlatformState([{ platform: "META", status: "DISABLED", count: 3 }], "META")?.label,
    ).toBe("Aucun compte connecté");
    expect(adPlatformState(null, "META")).toBeUndefined();
  });

  it("compte Telegram des vues", () => {
    expect(telegramState({ status: "ACTIVE" })).toEqual({ tone: "success", label: "Connecté" });
    expect(telegramState({ status: "ERROR" })?.tone).toBe("danger");
    expect(telegramState({ status: "PENDING_CODE" })?.label).toBe("Connexion à terminer");
    expect(telegramState({ status: null })).toEqual({ tone: "muted", label: "Non connecté" });
    expect(telegramState({ status: "DISCONNECTED" })?.label).toBe("Non connecté");
    expect(telegramState(null)).toBeUndefined();
  });

  it("bots : aucun, à vérifier (connexion ou erreur du bot), inactifs ou en ligne", () => {
    const ok = { ok: true };
    expect(botsState([])).toEqual({ tone: "warning", label: "Aucun bot" });
    expect(
      botsState([
        { isActive: true, lastError: null, webhook: ok },
        { isActive: true, lastError: "401", webhook: ok },
        { isActive: true, lastError: null, webhook: { ok: false, fetchError: "Unauthorized" } },
        { isActive: false, lastError: "ancien", webhook: null },
      ]),
    ).toEqual({ tone: "danger", label: "2 à vérifier" });
    expect(botsState([{ isActive: false, lastError: null, webhook: null }])?.label).toBe(
      "Aucun actif",
    );
    expect(
      botsState([
        { isActive: true, lastError: null, webhook: ok },
        { isActive: true, lastError: null, webhook: ok },
        { isActive: false, lastError: null, webhook: null },
      ]),
    ).toEqual({ tone: "success", label: "Tous en ligne" });
    expect(botsState(null)).toBeUndefined();
  });

  it("état d'un bot : inactif, Telegram injoignable, à reposer, erreur du bot, en ligne", () => {
    expect(botCheck({ isActive: false, lastError: "x", webhook: null })).toBe("off");
    expect(
      botCheck({ isActive: true, lastError: null, webhook: { ok: false, fetchError: "timeout" } }),
    ).toBe("unreachable");
    expect(botCheck({ isActive: true, lastError: null, webhook: { ok: false } })).toBe("check");
    expect(botCheck({ isActive: true, lastError: null, webhook: null })).toBe("check");
    expect(botCheck({ isActive: true, lastError: "Bad Request", webhook: { ok: true } })).toBe(
      "error",
    );
    expect(botCheck({ isActive: true, lastError: null, webhook: { ok: true } })).toBe("ok");
  });

  it("équipe, alertes, catégories, étiquettes et retours du casino", () => {
    expect(teamState({ users: 4, pendingInvitations: 0 })).toEqual({
      tone: "neutral",
      label: "4 comptes",
    });
    expect(teamState({ users: 1, pendingInvitations: 2 })?.label).toBe(
      "1 compte · 2 invitations en attente",
    );
    expect(alertsState(0)).toEqual({ tone: "success", label: "Aucune alerte ouverte" });
    expect(alertsState(3)).toEqual({ tone: "warning", label: "3 alertes ouvertes" });
    expect(categoriesState(0)?.label).toBe("Aucune catégorie");
    expect(categoriesState(5)).toEqual({ tone: "neutral", label: "5 catégories" });
    expect(tagsState(1)?.label).toBe("1 étiquette");
    expect(tagsState(0)?.tone).toBe("muted");
    expect(postbacksState(2)?.label).toBe("2 adresses actives");
    expect(postbacksState(0)?.label).toBe("Aucune adresse");
    for (const f of [alertsState, categoriesState, tagsState, postbacksState])
      expect(f(null)).toBeUndefined();
    expect(teamState(null)).toBeUndefined();
  });

  it("IA : clé absente, refusée ou prête", () => {
    expect(aiState({ hasKey: false, lastError: null })).toEqual({
      tone: "warning",
      label: "Clé IA absente",
    });
    expect(aiState({ hasKey: true, lastError: "401 invalid x-api-key" })).toEqual({
      tone: "danger",
      label: "Clé IA refusée",
      title: "401 invalid x-api-key",
    });
    expect(aiState({ hasKey: true, lastError: null })?.label).toBe("Prêt");
  });

  it("IA de conversation : refusée, absente, désactivée, à vérifier, essai par l'équipe, actif", () => {
    const a = (over: Partial<NonNullable<Parameters<typeof assistantState>[0]>> = {}) =>
      assistantState({
        hasKey: true,
        lastError: null,
        verifiedAt: "2026-10-18T10:00:00.000Z",
        activation: "all",
        ...over,
      });
    expect(assistantState(null)).toBeUndefined();
    expect(a({ lastError: "Solde Venice vide" })).toEqual({
      tone: "danger",
      label: "Clé Venice refusée",
      title: "Solde Venice vide",
    });
    // Sans clé : grave seulement si l'assistant est activé (il ne peut répondre à personne).
    expect(a({ hasKey: false, activation: "off" })).toEqual({
      tone: "muted",
      label: "Clé Venice absente",
    });
    expect(a({ hasKey: false, activation: "team" })).toEqual({
      tone: "danger",
      label: "Clé Venice absente",
    });
    expect(a({ activation: "off" })).toEqual({ tone: "muted", label: "Désactivé" });
    expect(a({ verifiedAt: null })).toEqual({ tone: "warning", label: "Clé à vérifier" });
    expect(a({ activation: "team" })).toEqual({ tone: "info", label: "Essai par l'équipe" });
    expect(a()).toEqual({ tone: "success", label: "Actif pour tout le monde" });
  });

  it("état du système : tout va bien, sinon le nombre de tuiles qui ne sont pas vertes", () => {
    expect(systemState(healthy, now)).toEqual({ tone: "success", label: "Tout va bien" });
    const s = systemState(local, now);
    expect(s?.tone).toBe("danger");
    expect(s?.label).toBe("4 points à voir");
    expect(s?.title).toBe(
      "Service d'arrière-plan : Inconnu · Sauvegarde : Aucune · Bots : 4 à vérifier · Synchro Link Affi : En retard",
    );
    const late = systemState(
      { ...healthy, backup: { ...healthy.backup!, at: minutesAgo(40 * 60) } },
      now,
    );
    expect(late).toMatchObject({ tone: "warning", label: "1 point à voir" });
    expect(systemState(null, now)).toBeUndefined();
  });

  it("Réglages, État du système et Bots disent la même chose au même moment", () => {
    // Situation de la base de démonstration : 3 bots injoignables, 1 à reposer (dont un en erreur), service et
    // sauvegarde inconnus, synchro en retard.
    const tiles = healthTiles(local, now);
    const notGreen = tiles.filter((t) => t.state.tone !== "success");
    const states = settingsStates(
      { ...NO_STATE_INPUT, health: local, bots: local.bots, sync: local.syncStates },
      now,
    );
    // Carte « État du système » = résumé de la page = nombre de tuiles qui ne sont pas vertes.
    expect(states.status?.label).toBe(`${notGreen.length} points à voir`);
    expect(healthSummary(tiles).label).toBe(states.status?.label);
    // Carte « Bots » = tuile « Bots » = bots dont la page Bots ne dit pas « Connecté » ni « Inactif ».
    const botsTileState = tiles.find((t) => t.key === "bots")!.state;
    expect(states.bots).toEqual(botsTileState);
    expect(botsTile(local.bots).state).toEqual(botsTileState);
    const toCheck = local.bots.filter((b) => !["ok", "off"].includes(botCheck(b))).length;
    expect(botsTileState.label).toBe(`${toCheck} à vérifier`);
    // Carte Link Affi = tuile « Synchro Link Affi » (même règle de retard).
    expect(states.linkaffi?.tone).toBe(tiles.find((t) => t.key === "sync")!.state.tone);
  });

  it("ne garde que les pastilles calculables", () => {
    expect(settingsStates(NO_STATE_INPUT, now)).toEqual({});
    const states = settingsStates(
      { ...NO_STATE_INPUT, bots: [], ai: { hasKey: false, lastError: null }, openAlerts: 0 },
      now,
    );
    expect(Object.keys(states).sort()).toEqual(["ai", "alerts", "bots"]);
    expect(states.ai?.label).toBe("Clé IA absente");
  });
});
