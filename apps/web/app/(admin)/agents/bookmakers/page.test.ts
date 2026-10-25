import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, primaryButtonCount, visibleText } from "../../settings/categories/page-checks";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";
import type { BookmakersPage } from "@/lib/agents/bookmakers-queries";

// Page Agents → Bookmakers rendue côté serveur avec des données simulées : administrateur (gestes) et manager (lecture).
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  data: null as unknown,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/agents/bookmakers",
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/app/(admin)/agents/bookmakers/actions", () => ({
  testSiteAction: vi.fn(),
  relearnSiteAction: vi.fn(),
  openBrowserAction: vi.fn(),
  setSiteUrlAction: vi.fn(),
}));
vi.mock("@/lib/agents/queries", () => ({
  loadPendingCounts: vi.fn(async () => ({ validations: 0, requests: 0 })),
}));
vi.mock("@/lib/agents/bookmakers-queries", () => ({
  loadBookmakersPage: vi.fn(async () => m.data),
}));

import Page from "./page";

const NOW = new Date();
const site = (o: Record<string, unknown> = {}) => ({
  key: "sportaza",
  label: "Sportaza",
  baseUrl: "https://sportaza.com/fr/sports",
  providerHint: "altenar",
  readTarget: "auto",
  isActive: true,
  status: "READY",
  statusReason: null,
  lastReadAt: NOW,
  lastOkAt: new Date(NOW.getTime() - 10 * 60_000),
  ...o,
});

function data(): BookmakersPage {
  return {
    mac: { alive: true, at: new Date(NOW.getTime() - 30_000) },
    commonCredentials: true,
    sites: [
      {
        site: site(),
        rate: { total: 20, ratio: 0.95 },
        recipe: {
          version: 2,
          level: "api",
          createdBy: "learn",
          createdAt: NOW,
          mapping: { marketMap: { Corners: "corners", "1X2": "resultat" } },
        },
        jobs: [
          {
            id: "j1",
            siteKey: "sportaza",
            kind: "events",
            target: "server",
            status: "DONE",
            result: { value: [1, 2], durationMs: 3000 },
            createdAt: NOW,
            finishedAt: NOW,
          },
          {
            id: "j2",
            siteKey: "sportaza",
            kind: "test",
            target: "mac",
            status: "NEEDS_HUMAN",
            result: { value: { obstacle: "captcha" } },
            createdAt: NOW,
            finishedAt: NOW,
          },
        ],
        events: [
          {
            siteKey: "sportaza",
            siteEventId: "e1",
            league: "Ligue 1",
            homeTeam: "PSG",
            awayTeam: "OM",
            startsAt: new Date(NOW.getTime() + 3600_000),
            marketsCount: 120,
            fetchedAt: NOW,
          },
        ],
        picks: [
          {
            id: "p1",
            homeTeam: "PSG",
            awayTeam: "OM",
            selectionLabel: "PSG",
            marketLabel: "Résultat",
            odds: 2.4,
            consensusOdds: 2,
            kickoffAt: NOW,
          },
        ],
        credentials: "default",
      },
      {
        site: site({
          key: "celsius",
          label: "Celsius",
          status: "BLOCKED",
          statusReason: "le site demande un code de connexion",
          readTarget: "mac",
        }),
        rate: { total: 0, ratio: null },
        recipe: null,
        jobs: [],
        events: [],
        picks: [],
        credentials: "default",
      },
    ],
  };
}

async function render(): Promise<string> {
  const el = await Page({ searchParams: Promise.resolve({}) } as never);
  return renderToStaticMarkup(el);
}

describe("page Agents → Bookmakers", () => {
  beforeEach(() => {
    m.user = { id: "u1", role: "ADMIN" };
    m.data = data();
  });

  it("administrateur : état, qui lit, réussite, méthode apprise, lectures, matchs, écart et gestes ; sans jargon", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBeLessThanOrEqual(1);
    const text = visibleText(html);
    expect(jargonIn(text)).toEqual([]);
    expect(text).not.toMatch(/recette|scraping|\bDOM\b|\bAPI\b|\bJSON\b|worker|BullMQ|Playwright/i);
    for (const s of [
      "Se lit bien",
      "Ne se lit plus",
      "Le site demande un code de connexion",
      "Le Mac",
      "Version 2 : lecture directe des données du site",
      "Corners",
      "Liste des matchs",
      "Attend votre aide",
      "Ligue 1",
      "PSG - OM",
      "cote inhabituelle",
      "Tester",
      "Ré-apprendre",
      "Ouvrir le navigateur sur le Mac",
      "Changer l'adresse",
      "Pas encore appris",
    ])
      expect(text, s).toContain(s);
    expect(text).toMatch(/ne mise jamais/);
  });

  it("manager : tout en lecture, aucun geste", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const text = visibleText(await render());
    expect(text).toContain("Sportaza");
    for (const s of ["Ré-apprendre", "Ouvrir le navigateur sur le Mac", "Changer l'adresse"])
      expect(text, s).not.toContain(s);
  });

  it("aucun site : état vide qui dit quoi faire", async () => {
    m.data = { mac: { alive: false, at: null }, commonCredentials: false, sites: [] };
    const text = visibleText(await render());
    expect(text).toContain("Aucun bookmaker pour l'instant");
    expect(text).toContain("ajoute le bookmaker");
  });
});
