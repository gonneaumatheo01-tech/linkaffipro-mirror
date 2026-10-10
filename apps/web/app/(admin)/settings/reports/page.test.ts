import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  currentLinks,
  h1Count,
  jargonIn,
  primaryButtonCount,
  visibleText,
} from "../categories/page-checks";

// Réglages → Rapports automatiques rendue côté serveur avec une base simulée.
const mocks = vi.hoisted(() => ({
  settings: [] as Array<{ key: string; value: unknown }>,
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: { setting: { findMany: vi.fn(async () => mocks.settings) } },
}));
vi.mock("@/lib/session", () => ({ requireAdminPage: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("./actions", () => ({
  saveReportsConfigAction: vi.fn(),
  sendReportNowAction: vi.fn(),
}));

import ReportsPage from "./page";

async function render(): Promise<string> {
  return renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({}) } as never));
}

beforeEach(() => {
  mocks.settings = [];
});

describe("Réglages → Rapports automatiques", () => {
  it("socle : un titre, retour vers Réglages, un seul bouton orange, onglet du groupe actif", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(html).toContain('href="/settings"');
    expect(primaryButtonCount(html)).toBe(1);
    expect(currentLinks(html)).toEqual(["/settings/reports"]);
    expect(html).toContain('href="/settings/alerts"');
  });

  it("mots du client en surface, terme technique au survol ; mêmes champs qu'avant", async () => {
    mocks.settings = [{ key: "reports.config", value: { daily: false, weekly: true, hour: 7 } }];
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain("premiers dépôts");
    expect(text).toContain("revenu net");
    expect(jargonIn(text)).toEqual([]);
    expect(html).toContain('title="FTD"');
    expect(html).toContain('title="NGR"');
    expect(text).toContain("Vous recevez le rapport du lundi à 7 h (heure de Paris).");
    for (const name of ["daily", "weekly", "hour"]) expect(html).toContain(`name="${name}"`);
    expect(html).toMatch(/<option value="7" selected="">7 h<\/option>/);
  });

  it("dernier texte envoyé affiché sans la mise en forme Telegram", async () => {
    mocks.settings = [
      { key: "reports.lastDaily", value: "2026-10-09" },
      { key: "reports.lastDailyText", value: "<b>Résumé</b> du 9" },
    ];
    const text = visibleText(await render());
    expect(text).toContain("Résumé du 9");
    expect(text).toContain("9 octobre 2026");
  });
});
