/**
 * Phase 13 : alerte « Événements Link Affi en attente » quand un événement d'un membre d'affilié n'est pas reçu par
 * Link Affi depuis plus d'une heure ; une notification Telegram par 24 h au plus (alerte rouverte en silence).
 */
import { describe, expect, it } from "vitest";
import { alertKindLabel } from "@linkaffipro/core";
import { alertToReopen, detectLinkaffiEventsStuck, formatAlert, REOPEN_KINDS } from "./alert-rules";

const NOW = new Date("2026-10-14T12:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

describe("événements Link Affi bloqués", () => {
  it("rien en attente, ou le plus ancien attend depuis moins d'une heure : pas d'alerte", () => {
    expect(detectLinkaffiEventsStuck(null, NOW)).toBeNull();
    expect(
      detectLinkaffiEventsStuck(
        { pending: 3, oldestCreatedAt: minutesAgo(59), lastError: null },
        NOW,
      ),
    ).toBeNull();
  });

  it("plus d'une heure : alerte avec le nombre, l'attente, la raison et quoi faire", () => {
    const d = detectLinkaffiEventsStuck(
      {
        pending: 4,
        oldestCreatedAt: minutesAgo(90),
        lastError: "Réponse 401 de Link Affi : signature invalide",
      },
      NOW,
    );
    expect(d).toMatchObject({ kind: "linkaffi_events_stuck", severity: "WARNING" });
    expect(d!.message).toContain("4 événements de membres d'affiliés attendent");
    expect(d!.message).toContain("depuis 90 min");
    expect(d!.message).toContain("Réponse 401 de Link Affi : signature invalide");
    expect(d!.message).toContain("Réglages → Connexions → Link Affi");
    expect(d!.payload).toEqual({
      pending: 4,
      oldestCreatedAt: minutesAgo(90).toISOString(),
      lastError: "Réponse 401 de Link Affi : signature invalide",
    });
    const one = detectLinkaffiEventsStuck(
      { pending: 1, oldestCreatedAt: minutesAgo(300), lastError: null },
      NOW,
    );
    expect(one!.message).toMatch(/^1 événement de membre d'affilié attend .* depuis 5 h\./);
  });

  it("titre en français dans le message Telegram, jamais le code technique", () => {
    const d = detectLinkaffiEventsStuck(
      { pending: 2, oldestCreatedAt: minutesAgo(120), lastError: null },
      NOW,
    )!;
    expect(alertKindLabel("linkaffi_events_stuck")).toBe("Événements Link Affi en attente");
    expect(formatAlert(d)).toContain("Alerte : Événements Link Affi en attente");
    expect(formatAlert(d)).not.toContain("linkaffi_events_stuck");
  });

  it("une notification par 24 h au plus : l'alerte des dernières 24 h est rouverte en silence", () => {
    expect(REOPEN_KINDS.has("linkaffi_events_stuck")).toBe(true);
    const recent = [
      { id: "a1", kind: "linkaffi_events_stuck", createdAt: minutesAgo(600) },
      { id: "a0", kind: "linkaffi_events_stuck", createdAt: minutesAgo(25 * 60) },
    ];
    expect(alertToReopen("linkaffi_events_stuck", recent, NOW)).toBe("a1");
    expect(alertToReopen("linkaffi_events_stuck", [recent[1]!], NOW)).toBeNull();
  });
});
