import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  currentLinks,
  h1Count,
  jargonIn,
  primaryButtonCount,
  visibleText,
} from "../categories/page-checks";

// Réglages → Alertes rendue côté serveur avec une base simulée.
const mocks = vi.hoisted(() => ({
  alerts: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    alert: { findMany: vi.fn(async () => mocks.alerts) },
    setting: { findUnique: vi.fn(async () => null) },
    auditLog: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/session", () => ({ requireAdminPage: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("./actions", () => ({
  checkAlertsNowAction: vi.fn(),
  purgeNowAction: vi.fn(),
  resolveAlertAction: vi.fn(),
  saveAlertThresholdsAction: vi.fn(),
  saveRetentionAction: vi.fn(),
}));

import AlertsPage from "./page";

async function render(): Promise<string> {
  return renderToStaticMarkup(await AlertsPage({ searchParams: Promise.resolve({}) } as never));
}

beforeEach(() => {
  mocks.alerts = [];
});

describe("Réglages → Alertes", () => {
  it("socle : un titre, retour vers Réglages, un seul bouton orange, onglet « Alertes » actif", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(html).toContain('href="/settings"');
    expect(primaryButtonCount(html)).toBe(1);
    expect(html).toContain('aria-label="Alertes et rapports"');
    expect(currentLinks(html)).toEqual(["/settings/alerts"]);
    expect(html).toContain('href="/settings/reports"');
    const text = visibleText(html);
    expect(text).toContain("Aucune alerte ouverte");
    // Mêmes champs qu'avant (actions serveur inchangées).
    for (const name of ["registrationsDropPct", "spendNoConversionEur", "channelLeakPct", "months"])
      expect(html).toContain(`name="${name}"`);
  });

  it("liste : type d'alerte en mots simples, gravité et état ; purge rangée dans « Avancé »", async () => {
    mocks.alerts = [
      {
        id: "a1",
        kind: "subid_health",
        severity: "CRITICAL",
        message: "Peu de joueurs reviennent avec leur identifiant.",
        createdAt: new Date("2026-10-10T08:00:00Z"),
        notifiedAt: null,
        resolvedAt: null,
      },
    ];
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain("1 alerte ouverte");
    expect(text).toContain("Identifiant de suivi qui ne revient pas");
    expect(text).toContain("Critique");
    expect(text).toContain("Ouverte");
    expect(jargonIn(text)).toEqual([]);
    expect(html).toMatch(/<details[^>]*data-slot="advanced-section"/);
    expect(text).toContain("Avancé : purge manuelle");
  });
});
