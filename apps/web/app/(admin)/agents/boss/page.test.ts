import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, primaryButtonCount, visibleText } from "../../settings/categories/page-checks";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";
import type { BossPageData } from "@/lib/agents/boss-queries";

// Page Agents → Kevin rendue côté serveur avec des données simulées (aucune base).
const m = vi.hoisted(() => ({ user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" }, data: null as unknown }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/agents/boss",
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("./actions", () => ({ saveBossBudgetAction: vi.fn(), saveBossNameAction: vi.fn() }));
vi.mock("@/lib/agents/queries", () => ({ loadPendingCounts: vi.fn(async () => ({ validations: 1, requests: 2 })) }));
vi.mock("@/lib/agents/boss-queries", () => ({ loadBossPage: vi.fn(async () => m.data) }));

import BossPage from "./page";

const base = (): BossPageData => ({
  name: "Kevin",
  bot: { id: "b1", name: "Kevin", username: "kevin_lap_bot", isActive: true, lastWebhookAt: new Date("2026-10-24T08:00:00Z"), lastError: null },
  capCents: 1000,
  spentCents: 850,
  calls: 42,
  unmet: [{ id: "u1", text: "fais moi un export des dépôts", count: 3, firstAt: new Date("2026-10-20T08:00:00Z"), lastAt: new Date("2026-10-24T08:00:00Z") }],
  unmetTotal: 1,
  turns: [
    { id: "t1", createdAt: new Date("2026-10-24T08:00:00Z"), role: "ADMIN", text: "clé fal [secret]", actionKey: null, status: "done", source: "text", costCents: 0 },
    { id: "t2", createdAt: new Date("2026-10-24T08:00:01Z"), role: "BOSS", text: "Clé fal.ai enregistrée ✅", actionKey: null, status: "answered", source: "voice", costCents: 0 },
  ],
  members: [
    { id: "m1", firstName: "Léa", username: "lea", role: "MEMBER", roleLabel: "vidéos casino", responsibilities: { teams: ["casino"], kinds: ["media"] }, available: true, awayUntil: new Date("2099-01-01T00:00:00Z"), startedPrivate: false },
  ],
  groupChatId: "-100123",
});

const render = async () => renderToStaticMarkup(await BossPage({ searchParams: Promise.resolve({}) } as never));
function checks(html: string) {
  expect(h1Count(html)).toBe(1);
  expect(primaryButtonCount(html)).toBeLessThanOrEqual(1);
  const text = visibleText(html);
  expect(jargonIn(text)).toEqual([]);
  expect(text).not.toMatch(/\bDating\b|BullMQ|worker|webhook|\bJSON\b|\bAPI\b/);
  return text;
}

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.data = base();
});

describe("Agents → Kevin (/agents/boss)", () => {
  it("administrateur : bot, prénom, dépense et plafond, équipe, besoins, échanges", async () => {
    const html = await render();
    const text = checks(html);
    for (const t of [
      "Kevin",
      "En service",
      "@kevin_lap_bot",
      "Enregistrer le prénom",
      "8,50 € sur 10,00 €",
      "42 appels",
      "85 % du plafond",
      "Enregistrer le plafond",
      "Équipe",
      "Enregistré",
      "Léa",
      "@lea",
      "Membre",
      "vidéos casino",
      "Casino · médias",
      "Absent jusqu'au",
      "fais moi un export des dépôts",
      "Exporter",
      "clé fal [secret]",
      "Vous",
      "vocal",
      "Répondu",
    ])
      expect(text).toContain(t);
    expect(html).toContain('href="https://t.me/kevin_lap_bot"');
    expect(html).toContain('href="/agents/boss/export"');
    expect(html).toContain('aria-current="page"');
  });

  it("responsable : lecture seule", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const text = checks(await render());
    expect(text).not.toContain("Enregistrer le plafond");
    expect(text).not.toContain("Enregistrer le prénom");
    expect(text).toContain("Seuls les administrateurs peuvent changer le plafond.");
    expect(text).toContain("fais moi un export des dépôts");
  });

  it("pas encore de bot, personne présenté, rien d'enregistré : les étapes pour le créer", async () => {
    m.data = { ...base(), name: "Bob", bot: null, members: [], groupChatId: null, unmet: [], unmetTotal: 0, turns: [], spentCents: 1000 };
    const html = await render();
    const text = checks(html);
    expect(text).toContain("Pas encore créé");
    expect(text).toContain("@BotFather");
    expect(text).toContain("jeton boss");
    expect(text).toContain("nommez-le « Bob »");
    expect(html).toContain('href="/settings/bots"');
    expect(text).toContain("Personne n'est encore présenté");
    expect(text).toContain("Aucun");
    expect(text).toContain("Rien pour l'instant");
    expect(text).toContain("Aucun échange encore");
    expect(text).toContain("Plafond atteint");
    expect(text).not.toContain("Exporter");
  });
});
