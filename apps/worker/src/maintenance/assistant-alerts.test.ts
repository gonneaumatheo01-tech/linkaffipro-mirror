/**
 * Phase 17 : alertes de l'assistant de conversation (IA en panne, plafond du mois atteint), bot assistant jamais
 * « silencieux », et libellé en français de chaque type d'alerte.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALERT_KIND_LABELS, alertKindLabel } from "@linkaffipro/core";
import {
  REOPEN_KINDS,
  WEBHOOK_SILENCE_MS,
  detectAssistantAiFailing,
  detectAssistantCapReached,
  detectBotWebhook,
  formatAlert,
} from "./alert-rules";

describe("assistant de conversation en panne", () => {
  it("rien, ou moins de 3 pannes passagères sans abandon : pas d'alerte", () => {
    expect(detectAssistantAiFailing([])).toBeNull();
    expect(
      detectAssistantAiFailing([
        { code: "server", final: false },
        { code: "rate_limit", final: false },
      ]),
    ).toBeNull();
  });

  it("clé refusée, solde vide ou clé absente : tout de suite, critique, avec la marche à suivre", () => {
    for (const [code, reason] of [
      ["auth", "la clé Venice est refusée"],
      ["balance", "le solde Venice est vide"],
      ["no_key", "aucune clé Venice n'est enregistrée"],
    ] as const) {
      const d = detectAssistantAiFailing([{ code, final: true }]);
      expect(d).toMatchObject({ kind: "assistant_ai_failing", severity: "CRITICAL" });
      expect(d!.message).toContain(reason);
      expect(d!.message).toContain(
        "Vérifiez la clé et le solde Venice dans Réglages → IA de conversation",
      );
    }
  });

  it("3 pannes en 15 minutes, ou une réponse abandonnée : avertissement", () => {
    const three = detectAssistantAiFailing([
      { code: "server", final: false },
      { code: "timeout", final: false },
      { code: "server", final: false },
    ]);
    expect(three).toMatchObject({
      severity: "WARNING",
      payload: { failures: 3, final: 0, codes: ["server", "timeout"] },
    });
    expect(three!.message).toContain("3 fois en 15 minutes");
    const final = detectAssistantAiFailing([{ code: "invalid_output", final: true }]);
    expect(final).toMatchObject({ severity: "WARNING" });
    expect(final!.message).toContain("1 message resté sans réponse");
  });

  it("condition qui va et vient : rouverte en silence (une notification par 24 h au plus)", () => {
    expect(REOPEN_KINDS.has("assistant_ai_failing")).toBe(true);
    expect(REOPEN_KINDS.has("assistant_cap_reached")).toBe(false);
  });
});

describe("plafond du mois de l'assistant atteint", () => {
  it("activé et plafond atteint : alerte avec la dépense et quoi faire", () => {
    const d = detectAssistantCapReached({ activation: "all", spentEur: 30.42, capEur: 30 });
    expect(d).toMatchObject({
      kind: "assistant_cap_reached",
      severity: "WARNING",
      payload: { spentEur: 30.42, capEur: 30 },
    });
    expect(d!.message).toContain("30,42 €");
    expect(d!.message).toContain("augmentez le plafond dans Réglages → IA de conversation");
  });

  it("sous le plafond, assistant désactivé, ou plafond à 0 € voulu par l'équipe : rien", () => {
    expect(detectAssistantCapReached(null)).toBeNull();
    expect(detectAssistantCapReached({ activation: "all", spentEur: 12, capEur: 30 })).toBeNull();
    expect(detectAssistantCapReached({ activation: "off", spentEur: 40, capEur: 30 })).toBeNull();
    expect(detectAssistantCapReached({ activation: "team", spentEur: 0, capEur: 0 })).toBeNull();
  });
});

describe("bot assistant de conversation et alerte « bot en difficulté »", () => {
  const now = new Date("2026-10-18T10:00:00Z");
  const recent = new Date(now.getTime() - 60_000);
  const silent = new Date(now.getTime() - WEBHOOK_SILENCE_MS - 60_000);

  it("un bot assistant n'est jamais « silencieux »", () => {
    expect(
      detectBotWebhook(
        [
          {
            username: "casino",
            isActive: true,
            lastWebhookAt: recent,
            lastError: null,
            mode: "STANDARD",
          },
          {
            username: "lea",
            isActive: true,
            lastWebhookAt: silent,
            lastError: null,
            mode: "ASSISTANT",
          },
        ],
        now,
      ),
    ).toBeNull();
  });

  it("il ne sert pas de référence : son activité ne rend pas les autres bots « silencieux »", () => {
    expect(
      detectBotWebhook(
        [
          {
            username: "casino",
            isActive: true,
            lastWebhookAt: silent,
            lastError: null,
            mode: "STANDARD",
          },
          {
            username: "lea",
            isActive: true,
            lastWebhookAt: recent,
            lastError: null,
            mode: "ASSISTANT",
          },
        ],
        now,
      ),
    ).toBeNull();
  });

  it("en erreur : signalé comme les autres", () => {
    const d = detectBotWebhook(
      [
        {
          username: "lea",
          isActive: true,
          lastWebhookAt: silent,
          lastError: "401 Unauthorized",
          mode: "ASSISTANT",
        },
      ],
      now,
    );
    expect(d?.message).toContain("@lea (401 Unauthorized)");
  });
});

describe("libellés des alertes", () => {
  it("chaque type d'alerte du worker a son libellé en français, sans jargon", () => {
    const src = readFileSync(join(__dirname, "alert-rules.ts"), "utf8");
    const union = /export type AlertKind =([^;]+);/.exec(src)?.[1] ?? "";
    const kinds = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(kinds).toEqual(
      expect.arrayContaining(["assistant_ai_failing", "assistant_cap_reached"]),
    );
    for (const k of kinds) {
      expect(ALERT_KIND_LABELS[k], k).toBeTruthy();
      expect(ALERT_KIND_LABELS[k]).not.toMatch(/webhook|worker|dating|entonnoir|\bllm\b|prompt/i);
    }
    expect(alertKindLabel("assistant_ai_failing")).toBe("Assistant de conversation en panne");
    expect(alertKindLabel("assistant_cap_reached")).toBe(
      "Plafond de l'assistant de conversation atteint",
    );
  });

  it("message Telegram de l'alerte : titre français, jamais le code technique", () => {
    const d = detectAssistantAiFailing([{ code: "auth", final: true }])!;
    const text = formatAlert(d);
    expect(text).toContain("Alerte : Assistant de conversation en panne");
    expect(text).not.toContain("assistant_ai_failing");
  });
});
