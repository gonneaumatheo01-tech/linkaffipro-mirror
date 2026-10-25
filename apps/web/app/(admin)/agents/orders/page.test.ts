import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, primaryButtonCount, visibleText } from "../../settings/categories/page-checks";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";
import type { OrderDetail, OrderListRow } from "@/lib/agents/orders-queries";
import { parsePlan, parseProgress } from "@/lib/agents/orders";

// Pages Agents → Ordres (liste et fiche d'un ordre) et encart de la fiche canal, rendus côté serveur avec des
// données simulées (aucune base, aucun moteur).
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  list: { rows: [] as unknown[], total: 0 },
  detail: null as unknown,
  overrides: [] as unknown[],
  caps: new Map<string, string>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/agents/orders",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/app/(admin)/agents/orders/actions", () => ({ stopOrderAction: vi.fn(), extendOrderAction: vi.fn() }));
vi.mock("./actions", () => ({ stopOrderAction: vi.fn(), extendOrderAction: vi.fn() }));
vi.mock("@/lib/agents/queries", () => ({ loadPendingCounts: vi.fn(async () => ({ validations: 0, requests: 0 })) }));
vi.mock("@/lib/agents/orders-engine", () => ({ loadCapabilityDescriptions: vi.fn(async () => m.caps) }));
vi.mock("@/lib/agents/orders-queries", () => ({
  ORDERS_SHOWN: 200,
  loadOrdersList: vi.fn(async () => m.list),
  loadOrderDetail: vi.fn(async () => m.detail),
  loadChannelOrderOverrides: vi.fn(async () => m.overrides),
}));
vi.mock("@linkaffipro/db", () => ({ prisma: {}, audit: vi.fn() }));

import ListPage from "./page";
import DetailPage from "./[id]/page";
import { ChannelOrderCard } from "@/components/agents/orders/channel-order-card";

const row = (o: Partial<OrderListRow> = {}): OrderListRow => ({
  id: "o1",
  number: 12,
  status: "RUNNING",
  kind: "WHAT_IF",
  teamKey: "sports",
  asIfTeamKey: "sports",
  requestText: "Sur le canal de test faisons comme si c'était un canal Paris sportifs, programme les paris pour 3 jours",
  createdAt: new Date("2026-10-25T08:00:00Z"),
  mode: "simulation",
  channels: ["Canal Test"],
  test: true,
  period: { from: "2026-10-25", to: "2026-10-27", days: 3 },
  figures: { planned: 6, done: 2, failed: 1, waiting: 0 },
  costCents: 12,
  ...o,
});

const detail = (o: Partial<OrderDetail> = {}): OrderDetail => ({
  id: "o1",
  number: 12,
  status: "RUNNING",
  kind: "WHAT_IF",
  teamKey: "sports",
  requestText: "Sur le canal de test faisons comme si c'était un canal Paris sportifs, programme les paris pour 3 jours, avec comme thème les hors-jeux",
  recap: "Paris sportifs sur le canal Test, pour de faux.\n2 paris par jour du 25 au 27 octobre, thème hors-jeux.",
  createdAt: new Date("2026-10-25T08:00:00Z"),
  updatedAt: new Date("2026-10-25T08:01:00Z"),
  startsAt: new Date("2026-10-25T08:01:00Z"),
  endsAt: null,
  createdByName: "Matheo",
  fromTelegram: true,
  plan: parsePlan({
    teamKey: "sports",
    asIfTeamKey: "sports",
    scope: { test: true },
    kind: "WHAT_IF",
    period: { start: "2026-10-25", days: 3 },
    perDay: 2,
    theme: "hors-jeux",
    categoryId: "cat1",
    mode: "simulation",
    steps: [{ capability: "programmer_paris", teamKey: "sports", params: { picksPerDay: 2, theme: "hors-jeux" } }],
    resolved: { start: { value: "2026-10-25", from: "défaut du système" } },
  }),
  impossible: [{ part: "Thème hors-jeux sur la Ligue 1", reason: "Aucune cote ce week-end.", alternatives: ["thème corners", "thème cartons"] }],
  progress: parseProgress({ missionsPlanned: 6, missionsDone: 2, perDay: [{ day: "2026-10-25", done: 2, failed: 0, postIds: ["p1", "p2"] }] }),
  counts: { total: 0, done: 0, failed: 0, waiting: 0, cancelled: 0 },
  period: { from: "2026-10-25", to: "2026-10-27", days: 3 },
  costCents: 12,
  missions: [],
  overrides: [
    {
      id: "ov1",
      channelId: "test",
      teamKey: "sports",
      fromDay: "2026-10-25",
      toDay: "2099-10-27",
      postsPerDay: null,
      picksPerDay: 2,
      betCategoryId: "cat1",
      themes: ["hors-jeux"],
      mix: null,
      format: null,
      windowStart: null,
      windowEnd: null,
      personaId: null,
      isTest: true,
      closedAt: null,
    },
  ],
  channelTeams: new Map([["test", "dating"]]),
  names: { channels: new Map([["test", "Canal Test"]]), categories: new Map([["cat1", "Hors-jeux"]]), personas: new Map() },
  events: [{ type: "agents.order.started", occurredAt: new Date("2026-10-25T08:01:00Z"), payload: { orderId: "o1" } }],
  audits: [],
  ...o,
});

function checks(html: string) {
  expect(h1Count(html)).toBe(1);
  expect(primaryButtonCount(html)).toBeLessThanOrEqual(1);
  const text = visibleText(html);
  expect(jargonIn(text)).toEqual([]);
  expect(text).not.toMatch(/\bDating\b|\bJSON\b|\bAPI\b|override|picksPerDay|programmer_paris|\{"/);
  return text;
}
const renderList = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve(sp) } as never));
const renderDetail = async () =>
  renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "o1" }), searchParams: Promise.resolve({}) } as never));

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.list = { rows: [row()], total: 1 };
  m.detail = detail();
  m.overrides = [];
  m.caps = new Map([["sports:programmer_paris", "programmer des paris sur un canal pour N jours"]]);
});

describe("Agents → Ordres (liste)", () => {
  it("une ligne par ordre : numéro, statut, équipe, canal, période, progression, coût, lien vers la fiche", async () => {
    const html = await renderList();
    const text = checks(html);
    for (const t of [
      "Ordre n°12",
      "En cours",
      "Faire comme si",
      "Paris sportifs",
      "Canal Test",
      "Pour de faux",
      "Du 25 oct. au 27 oct. 2026 (3 jours)",
      "2 sur 6 faites · 1 en échec",
      "0,12 €",
      "1 ordre · 1 en cours",
      "Toutes les équipes",
      "Tous les statuts",
      "Attend votre OUI",
    ])
      expect(text).toContain(t);
    expect(html).toContain('href="/agents/orders/o1"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/agents/boss"');
  });

  it("aucun ordre : l'état vide explique avec la phrase du client", async () => {
    m.list = { rows: [], total: 0 };
    const text = checks(await renderList());
    expect(text).toContain("Aucun ordre pour l'instant");
    expect(text).toContain("Demandez à Kevin");
    expect(text).toContain("hors-jeux");
    expect(text).toContain("demande votre OUI pour un vrai canal");
  });

  it("filtres sans résultat : message de filtre, pas l'état vide de départ", async () => {
    m.list = { rows: [], total: 0 };
    const text = checks(await renderList({ team: "casino", status: "DONE" }));
    expect(text).toContain("Aucun ordre ne correspond à ces filtres");
    expect(text).not.toContain("Aucun ordre pour l'instant");
  });
});

describe("Agents → Ordres (fiche)", () => {
  it("administrateur : demande, récapitulatif, plan en mots, impossibles, réglage temporaire, chronologie, boutons", async () => {
    const html = await renderDetail();
    const text = checks(html);
    for (const t of [
      "Ordre n°12",
      "comme thème les hors-jeux",
      "Récapitulatif de Kevin",
      "2 paris par jour du 25 au 27 octobre",
      "Le canal Test est traité comme un canal Paris sportifs pendant la période",
      "Catégorie de paris",
      "Hors-jeux",
      "Programmer des paris sur un canal pour N jours",
      "Paris par jour : 2",
      "Ce que Kevin a compris tout seul",
      "défaut du système",
      "Ce qui n'a pas pu être pris",
      "Aucune cote ce week-end.",
      "thème corners",
      "Réglage temporaire du canal",
      "Travaillé comme un canal Paris sportifs",
      "En cours",
      "Pas encore de mission",
      "2 faites · 2 posts",
      "Chronologie",
      "Demandé à Kevin",
      "Lancé",
      "Prolonger",
      "Arrêter",
      "par Matheo",
    ])
      expect(text).toContain(t);
    expect(html).toContain('href="/channels/test"');
    expect(text).not.toContain("Seuls les administrateurs");
  });

  it("responsable : lecture seule, sans Arrêter ni Prolonger", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const text = checks(await renderDetail());
    expect(text).toContain("Seuls les administrateurs peuvent arrêter ou prolonger un ordre");
    expect(text).not.toContain("Prolonger de");
    expect(text).not.toMatch(/Arrêter\b(?! ou)/);
    expect(text).toContain("Ce qui n'a pas pu être pris");
  });

  it("ordre fini : plus de boutons ; sans réglage temporaire ni impossible ; registre absent → clé en mots", async () => {
    m.caps = new Map();
    m.detail = detail({ status: "DONE", overrides: [], impossible: [], recap: "", events: [] });
    const text = checks(await renderDetail());
    expect(text).toContain("Fini");
    expect(text).not.toContain("Prolonger de");
    expect(text).toContain("Aucun réglage temporaire");
    expect(text).not.toContain("Ce qui n'a pas pu être pris");
    expect(text).toContain("Programmer paris");
  });

  it("ordre inconnu → page introuvable", async () => {
    m.detail = null;
    await expect(renderDetail()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("Fiche canal : encart de l'ordre en cours", () => {
  it("rien sans réglage temporaire actif", async () => {
    expect(await ChannelOrderCard({ channelId: "test" })).toBeNull();
  });

  it("« Réglage temporaire en cours jusqu'au … (ordre n°…) » avec le lien", async () => {
    m.overrides = [{ id: "ov1", orderId: "o1", orderNumber: 12, orderStatus: "RUNNING", toDay: "2026-10-27", teamKey: "sports", isTest: true }];
    const html = renderToStaticMarkup((await ChannelOrderCard({ channelId: "test" }))!);
    const text = visibleText(html);
    expect(text).toContain("Réglage temporaire en cours jusqu'au 27 oct. 2026 (ordre n°12)");
    expect(text).toContain("Travaillé comme un canal Paris sportifs, pour de faux.");
    expect(html).toContain('href="/agents/orders/o1"');
    expect(jargonIn(text)).toEqual([]);
  });
});
