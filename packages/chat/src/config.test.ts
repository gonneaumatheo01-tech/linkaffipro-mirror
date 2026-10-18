import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SETTING_KEY,
  DEFAULT_ASSISTANT_CONFIG,
  assistantConfigState,
  canAssistantReply,
  keyHint,
  parisDayKey,
  parisDayStart,
  parisMonthStart,
  parseAssistantConfig,
} from "./config";

const model = {
  id: "venice-uncensored-role-play",
  name: "Venice Role Play",
  inputUsdPerM: 0.5,
  outputUsdPerM: 2,
  maxCompletionTokens: 4096,
  contextLength: 32768,
  supportsResponseSchema: true,
  supportsReasoning: false,
  uncensored: true,
  offline: false,
  deprecated: false,
};

describe("réglages de l'assistant de conversation", () => {
  it("clé du réglage et valeurs par défaut du contrat (désactivé par défaut)", () => {
    expect(ASSISTANT_SETTING_KEY).toBe("assistant.venice");
    expect(DEFAULT_ASSISTANT_CONFIG).toEqual({
      apiKeyEncrypted: null,
      activation: "off",
      defaultModel: "venice-uncensored-role-play",
      fallbackModel: "venice-uncensored-1-2",
      temperature: 0.85,
      maxTokens: 400,
      monthlyCapEur: 30,
      perConversationDailyLimit: 60,
      models: [],
      modelsFetchedAt: null,
      verifiedAt: null,
      lastError: null,
    });
    expect(parseAssistantConfig(undefined)).toEqual(DEFAULT_ASSISTANT_CONFIG);
    expect(parseAssistantConfig(null)).toEqual(DEFAULT_ASSISTANT_CONFIG);
    expect(parseAssistantConfig("n'importe quoi")).toEqual(DEFAULT_ASSISTANT_CONFIG);
    expect(parseAssistantConfig([1, 2])).toEqual(DEFAULT_ASSISTANT_CONFIG);
  });

  it("garde les valeurs valides", () => {
    const cfg = parseAssistantConfig({
      apiKeyEncrypted: "v1:abc",
      activation: "team",
      defaultModel: "llama-3.3-70b",
      fallbackModel: "qwen3-4b",
      temperature: 1.2,
      maxTokens: 600,
      monthlyCapEur: 0,
      perConversationDailyLimit: 10,
      models: [model],
      modelsFetchedAt: "2026-10-18T10:00:00.000Z",
      verifiedAt: "2026-10-18T10:00:00.000Z",
      lastError: "Clé refusée",
    });
    expect(cfg).toEqual({
      apiKeyEncrypted: "v1:abc",
      activation: "team",
      defaultModel: "llama-3.3-70b",
      fallbackModel: "qwen3-4b",
      temperature: 1.2,
      maxTokens: 600,
      monthlyCapEur: 0,
      perConversationDailyLimit: 10,
      models: [model],
      modelsFetchedAt: "2026-10-18T10:00:00.000Z",
      verifiedAt: "2026-10-18T10:00:00.000Z",
      lastError: "Clé refusée",
    });
  });

  it("chaque champ invalide ou hors bornes prend sa valeur par défaut, sans toucher aux autres", () => {
    const cfg = parseAssistantConfig({
      apiKeyEncrypted: "   ",
      activation: "on",
      defaultModel: "modèle avec espaces",
      fallbackModel: 42,
      temperature: 2.5,
      maxTokens: 10,
      monthlyCapEur: -1,
      perConversationDailyLimit: 5000,
      models: "rien",
      modelsFetchedAt: "pas une date",
      verifiedAt: 12,
      lastError: "",
    });
    expect(cfg).toEqual(DEFAULT_ASSISTANT_CONFIG);
    expect(parseAssistantConfig({ temperature: -0.1 }).temperature).toBe(0.85);
    expect(parseAssistantConfig({ temperature: 0 }).temperature).toBe(0);
    expect(parseAssistantConfig({ temperature: 2 }).temperature).toBe(2);
    expect(parseAssistantConfig({ maxTokens: 2001 }).maxTokens).toBe(400);
    expect(parseAssistantConfig({ maxTokens: 64 }).maxTokens).toBe(64);
    expect(parseAssistantConfig({ maxTokens: 512.4 }).maxTokens).toBe(512);
    expect(parseAssistantConfig({ monthlyCapEur: 100_001 }).monthlyCapEur).toBe(30);
    expect(parseAssistantConfig({ perConversationDailyLimit: 0 }).perConversationDailyLimit).toBe(
      60,
    );
    expect(parseAssistantConfig({ temperature: Number.NaN }).temperature).toBe(0.85);
    expect(parseAssistantConfig({ temperature: "0,7" }).temperature).toBe(0.7);
    expect(parseAssistantConfig({ activation: "all", maxTokens: "abc" })).toMatchObject({
      activation: "all",
      maxTokens: 400,
    });
  });

  it("cache des modèles : entrées inexploitables écartées, doublons retirés, champs manquants complétés", () => {
    const cfg = parseAssistantConfig({
      models: [model, { ...model, name: "doublon" }, null, { name: "sans id" }, { id: "qwen3-4b" }],
    });
    expect(cfg.models.map((m) => m.id)).toEqual(["venice-uncensored-role-play", "qwen3-4b"]);
    expect(cfg.models[0]?.name).toBe("Venice Role Play");
    expect(cfg.models[1]).toEqual({
      id: "qwen3-4b",
      name: "qwen3-4b",
      inputUsdPerM: null,
      outputUsdPerM: null,
      maxCompletionTokens: null,
      contextLength: null,
      supportsResponseSchema: false,
      supportsReasoning: false,
      uncensored: false,
      offline: false,
      deprecated: false,
    });
  });

  it("état affichable : jamais la clé, seulement un indice", () => {
    const cfg = parseAssistantConfig({ apiKeyEncrypted: "chiffrée" });
    const state = assistantConfigState(cfg, () => "VENICE-abcdefghijklmnop-WXYZ");
    expect(state.hasKey).toBe(true);
    expect(state.keyHint).toBe("VENI…WXYZ");
    expect(JSON.stringify(state)).not.toContain("abcdefghijklmnop");
    expect("apiKeyEncrypted" in state).toBe(false);
    const broken = assistantConfigState(cfg, () => {
      throw new Error("clé de chiffrement changée");
    });
    expect(broken.keyHint).toBe("(illisible : recollez la clé)");
    const none = assistantConfigState(parseAssistantConfig({}), () => "x");
    expect(none).toMatchObject({ hasKey: false, keyHint: null, activation: "off" });
  });

  it("indice d'une clé courte : rien de lisible", () => {
    expect(keyHint("court")).toBe("••••");
    expect(keyHint("  0123456789abcdef  ")).toBe("0123…cdef");
  });

  it("activation : désactivé = personne, équipe = seulement l'équipe, tout le monde = tous", () => {
    expect(canAssistantReply("off", { isTeamMember: true })).toBe(false);
    expect(canAssistantReply("off", { isTeamMember: false })).toBe(false);
    expect(canAssistantReply("team", { isTeamMember: true })).toBe(true);
    expect(canAssistantReply("team", { isTeamMember: false })).toBe(false);
    expect(canAssistantReply("all", { isTeamMember: false })).toBe(true);
  });
});

describe("heure de Paris", () => {
  it("début du mois : minuit à Paris, en hiver (UTC+1) et en été (UTC+2)", () => {
    expect(parisMonthStart(new Date("2026-01-15T12:00:00Z")).toISOString()).toBe(
      "2025-12-31T23:00:00.000Z",
    );
    expect(parisMonthStart(new Date("2026-07-15T12:00:00Z")).toISOString()).toBe(
      "2026-06-30T22:00:00.000Z",
    );
  });

  it("fin octobre (après le passage à l'heure d'hiver) : le 1er octobre était encore à l'heure d'été", () => {
    expect(parisMonthStart(new Date("2026-10-30T12:00:00Z")).toISOString()).toBe(
      "2026-09-30T22:00:00.000Z",
    );
  });

  it("fin mars (après le passage à l'heure d'été) : le 1er mars était à l'heure d'hiver", () => {
    expect(parisMonthStart(new Date("2026-03-31T12:00:00Z")).toISOString()).toBe(
      "2026-02-28T23:00:00.000Z",
    );
  });

  it("premier instant du mois à Paris alors qu'il est encore le mois d'avant en UTC", () => {
    // 31 octobre 23 h 30 UTC = 1er novembre 0 h 30 à Paris.
    const now = new Date("2026-10-31T23:30:00Z");
    expect(parisMonthStart(now).toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(parisDayKey(now)).toBe("2026-11-01");
    // Juste avant minuit à Paris : encore octobre.
    expect(parisMonthStart(new Date("2026-10-31T22:59:59Z")).toISOString()).toBe(
      "2026-09-30T22:00:00.000Z",
    );
  });

  it("jour de Paris et son début, y compris les jours de changement d'heure", () => {
    expect(parisDayKey(new Date("2026-10-18T21:59:00Z"))).toBe("2026-10-18");
    expect(parisDayKey(new Date("2026-10-18T22:00:00Z"))).toBe("2026-10-19");
    expect(parisDayStart(new Date("2026-10-18T12:00:00Z")).toISOString()).toBe(
      "2026-10-17T22:00:00.000Z",
    );
    // Dimanche 25 octobre 2026 : minuit à l'heure d'été (UTC+2), le jour dure 25 h.
    expect(parisDayStart(new Date("2026-10-25T20:00:00Z")).toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
    expect(parisDayStart(new Date("2026-10-26T08:00:00Z")).toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
    // Dimanche 29 mars 2026 : minuit à l'heure d'hiver (UTC+1), le jour dure 23 h.
    expect(parisDayStart(new Date("2026-03-29T20:00:00Z")).toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(parisDayKey(new Date("2026-03-29T22:30:00Z"))).toBe("2026-03-30");
  });
});
