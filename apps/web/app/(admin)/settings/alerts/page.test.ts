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
  /** Valeur du réglage `alerts.thresholds` (seuils et interrupteurs) ; `undefined` = réglage absent. */
  thresholds: undefined as unknown,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    alert: { findMany: vi.fn(async () => mocks.alerts) },
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        where.key === "alerts.thresholds" && mocks.thresholds !== undefined
          ? { value: mocks.thresholds }
          : null,
      ),
    },
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
  mocks.thresholds = undefined;
});

/** Balise `<input type="checkbox">` envoyée par la case de ce nom (le seuil, lui, reste un champ normal). */
function checkboxInput(html: string, name: string): string {
  const tag = [...html.matchAll(/<input\b[^>]*>/g)]
    .map((m) => m[0])
    .find((t) => t.includes(`name="${name}"`));
  expect(tag, `case ${name}`).toBeDefined();
  expect(tag).toContain('type="checkbox"');
  expect(tag).toContain('value="on"');
  return tag!;
}

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

  it("une case « Alerte activée » par alerte sur les chiffres, cochée par défaut, à côté de son seuil", async () => {
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain("Alertes sur vos chiffres");
    expect(text).toContain("Une alerte désactivée n'est plus envoyée");
    expect(text.match(/Alerte activée/g)).toHaveLength(3);
    for (const name of [
      "registrationsDropEnabled",
      "spendNoConversionEnabled",
      "channelLeakEnabled",
    ])
      expect(checkboxInput(html, name)).toMatch(/\bchecked=""/);
    // Les seuils restent toujours envoyés, même alerte désactivée.
    for (const name of ["registrationsDropPct", "spendNoConversionEur", "channelLeakPct"]) {
      const tag = [...html.matchAll(/<input\b[^>]*>/g)]
        .map((m) => m[0])
        .find((t) => t.includes(`name="${name}"`));
      expect(tag).toBeDefined();
      expect(tag).not.toMatch(/\sdisabled=""/);
    }
    // Les lecteurs d'écran distinguent les trois cases par le nom de l'alerte.
    expect(html).toContain('<span class="sr-only"> : Canal qui perd ses membres</span>');
    expect(primaryButtonCount(html)).toBe(1);
    expect(jargonIn(text)).toEqual([]);
  });

  it("une alerte désactivée : sa case est décochée, les autres restent cochées, seuils gardés", async () => {
    mocks.thresholds = {
      registrationsDropPct: 30,
      spendNoConversionEur: 120,
      channelLeakPct: 5,
      enabled: { registrations_drop: true, spend_no_conversion: false, channel_leak: false },
    };
    const html = await render();
    expect(checkboxInput(html, "registrationsDropEnabled")).toMatch(/\bchecked=""/);
    expect(checkboxInput(html, "spendNoConversionEnabled")).not.toMatch(/\bchecked/);
    expect(checkboxInput(html, "channelLeakEnabled")).not.toMatch(/\bchecked/);
    expect(html).toMatch(
      /name="registrationsDropPct"[^>]*value="30"|value="30"[^>]*name="registrationsDropPct"/,
    );
    expect(html).toMatch(
      /name="spendNoConversionEur"[^>]*value="120"|value="120"[^>]*name="spendNoConversionEur"/,
    );
    expect(primaryButtonCount(html)).toBe(1);
  });
});
