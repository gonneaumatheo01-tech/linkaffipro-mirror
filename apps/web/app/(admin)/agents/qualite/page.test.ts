import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, primaryButtonCount, visibleText } from "../../settings/categories/page-checks";
import { AGENTS_JARGON, jargonIn } from "@/tests/vocabulary/jargon-scan";
import type { QaCheckLite } from "@/lib/agents/qualite";
import type { CheckDetail, HistoryRow } from "@/lib/agents/qualite-queries";

// Page Agents → Qualité (3 vues), rendue côté serveur, données simulées.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  rows: [] as unknown[],
  history: { rows: [] as unknown[], total: 0 },
  detail: null as unknown,
  state: { enabled: true, latest: null as unknown },
  calls: {} as Record<string, unknown[]>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/agents/qualite",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/lib/agents/queries", () => ({ loadPendingCounts: vi.fn(async () => ({ validations: 0, requests: 0 })) }));
vi.mock("@/lib/agents/qualite-queries", () => {
  const track =
    <T,>(name: string, value: () => T) =>
    async (...a: unknown[]) => {
      m.calls[name] = a;
      return value();
    };
  return {
    HISTORY_PAGE_SIZE: 50,
    loadQaRows: track("rows", () => m.rows),
    loadHistory: track("history", () => m.history),
    loadCheck: track("check", () => m.detail),
    loadQaState: track("state", () => m.state),
    loadQaTeams: track("teams", () => ["casino", "montage"]),
  };
});
vi.mock("@linkaffipro/db", () => ({ prisma: {}, audit: vi.fn() }));

import Page from "./page";

const NOW = Date.now();
const H = 3_600_000;
const SECRET = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";
let n = 0;
const lite = (o: Partial<QaCheckLite> & { ago?: number } = {}): QaCheckLite => {
  const { ago = H / 4, ...rest } = o;
  return { id: `q${++n}`, contentType: "POST", teamKey: "casino", verdict: "APPROVED", reasons: [], durationMs: 2000, createdAt: new Date(NOW - ago), ...rest };
};
const hist = (o: Partial<HistoryRow> = {}): HistoryRow => ({ ...lite(), contentId: "p1", attempt: 1, label: "Post n° 42 sur Casino VIP", ...o });
const gain = [{ code: "GAIN_PROMISE", message: `« 500 euros garantis » ; jeton ${SECRET}`, severity: "critical" }];

function checks(html: string) {
  expect(h1Count(html)).toBe(1);
  expect(primaryButtonCount(html)).toBeLessThanOrEqual(1);
  const text = visibleText(html);
  expect(jargonIn(text)).toEqual([]);
  expect(AGENTS_JARGON.filter((r) => r.re.test(text)).map((r) => r.word)).toEqual([]);
  // Aucun code technique en surface.
  expect(text).not.toMatch(/\b(APPROVED|REJECTED|TIMEOUT|GAIN_PROMISE|KEVIN_RESPONSE|claude-fable)\b/);
  expect(text).not.toContain(SECRET);
  return text;
}
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) } as never));

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.rows = [
    lite(),
    lite({ verdict: "REJECTED", reasons: gain, durationMs: 4000 }),
    lite({ verdict: "TIMEOUT", teamKey: "montage", contentType: "SHORT", durationMs: 30000 }),
    lite({ verdict: "ERROR", contentType: "REPORT", teamKey: "analystes", ago: 30 * H }),
  ];
  m.history = { rows: [hist({ verdict: "REJECTED", reasons: gain, attempt: 2 }), hist({ id: "h2", contentType: "SHORT", teamKey: "montage", label: "Short n° 3", verdict: "APPROVED" })], total: 2 };
  m.detail = null;
  m.state = { enabled: true, latest: { verdict: "APPROVED", createdAt: new Date(NOW) } };
  m.calls = {};
});

describe("Agents → Qualité : tableau de bord (vue par défaut)", () => {
  it("parts acceptées, temps moyen, blocages, courbe, par équipe et par type ; onglet de la sous-navigation", async () => {
    const html = await render();
    const text = checks(html);
    expect(m.calls.rows?.[0]).toBe(7);
    for (const t of [
      "Qualité",
      "Tableau de bord",
      "Historique",
      "Tendances",
      "Acceptés sur 7 jours",
      "25 %",
      "Temps moyen d'une vérification",
      "3 s",
      "Bloqués faute de contrôle",
      "1 contrôle indisponible, 1 contrôle trop long (7 jours)",
      "Part des contenus acceptés",
      "Par jour",
      "Par heure",
      "Voir les chiffres jour par jour",
      "Par équipe",
      "Casino",
      "Montage",
      "Analystes",
      "Par type de contenu",
      "Short",
      "Rapport du marché",
      "Parler à Kevin",
    ])
      expect(text).toContain(t);
    expect(html).toContain('href="/agents/qualite"');
    expect(html).toMatch(/<svg[^>]*role="img"/);
    // Jamais de geste « accepter à la place du contrôle ».
    expect(html).not.toMatch(/<form[^>]*method="post"/i);
    expect(text).not.toMatch(/Approuver|Accepter quand même|Forcer/);
  });

  it("par heure : 168 points ; rien vérifié : message clair", async () => {
    const html = await render({ pas: "heure" });
    expect(checks(html)).toContain("Voir les chiffres heure par heure");
    m.rows = [];
    expect(checks(await render())).toContain("Rien de vérifié ces 7 derniers jours");
  });

  it("modèle indisponible : « En pause », jamais accepté par défaut ; coupé : dit", async () => {
    m.state = { enabled: true, latest: { verdict: "ERROR", createdAt: new Date(NOW - 60_000) } };
    const text = checks(await render());
    expect(text).toContain("En pause : le modèle du contrôle ne répond plus.");
    expect(text).toContain("jamais acceptés par défaut");
    m.state = { enabled: false, latest: null };
    expect(checks(await render())).toContain("Le contrôle qualité global est coupé dans les réglages");
  });

  it("responsable : même lecture", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    expect(checks(await render())).toContain("Acceptés sur 7 jours");
  });
});

describe("Agents → Qualité : historique", () => {
  it("filtres transmis, liste, lien de détail qui garde les filtres, pagination", async () => {
    const html = await render({ vue: "historique", resultat: "REJECTED", equipe: "casino", du: "2026-10-20" });
    const text = checks(html);
    expect(m.calls.history?.[0]).toMatchObject({ verdict: "REJECTED", team: "casino", from: "2026-10-20", type: null, page: 1 });
    for (const t of ["Résultat", "Type", "Équipe", "Du", "Au", "Filtrer", "Refusé", "Accepté", "Post n° 42 sur Casino VIP", "Short n° 3", "tentative 2", "Promesse de gain", "Voir le détail", "2 vérifications"])
      expect(text).toContain(t);
    expect(html).toContain('href="/agents/qualite?vue=historique&amp;resultat=REJECTED&amp;equipe=casino&amp;du=2026-10-20&amp;voir=');
    expect(m.calls.check).toBeUndefined();
  });

  it("détail : motifs, corrections, tentative, durée, modèle, contenu MASQUÉ", async () => {
    m.detail = {
      ...hist({ id: "h1", verdict: "REJECTED", reasons: [...gain, { code: "LANGUAGE", message: "virgule", severity: "warning" }], attempt: 3, durationMs: 4200 }),
      corrections: [{ field: "texte", expected: "aucune promesse", got: "écris à jean@mail.fr", suggestion: "Retire « garantis »" }],
      content: { text: "Gagne gros ce soir, écris à jean@mail.fr ou au 06 12 34 56 78", token: SECRET, buttons: [{ label: "Offre" }] },
      modelUsed: "claude-fable-5-1",
      checkedBy: "qa-global",
      previous: [{ id: "h0", verdict: "REJECTED", attempt: 2, createdAt: new Date(NOW - H) }],
    } satisfies CheckDetail;
    const html = await render({ vue: "historique", voir: "h1" });
    const text = checks(html);
    expect(m.calls.check?.[0]).toBe("h1");
    for (const t of [
      "Détail de la vérification",
      "Fermer le détail",
      "3 sur 3",
      "4,2 s",
      "Fable 5.1",
      "Bloquant : Promesse de gain",
      "« 500 euros garantis » ; jeton [jeton masqué]",
      "Remarque : Français à corriger",
      "Corrections demandées à l'équipe",
      "texte : Retire « garantis »",
      "Attendu : aucune promesse",
      "Contenu vérifié (masqué)",
      "Gagne gros ce soir, écris à [courriel masqué] ou au [téléphone masqué]",
      "[masqué]",
      "Autres vérifications de ce contenu",
    ])
      expect(text).toContain(t);
    expect(text).not.toContain("jean@mail.fr");
    expect(text).not.toContain("06 12 34 56 78");
  });

  it("rien pour ces filtres : effacer les filtres", async () => {
    m.history = { rows: [], total: 0 };
    expect(checks(await render({ vue: "historique", type: "ALERT" }))).toContain("Rien pour ces filtres");
    expect(checks(await render({ vue: "historique" }))).toContain("Aucune vérification pour l'instant");
  });
});

describe("Agents → Qualité : tendances", () => {
  it("motifs les plus fréquents, équipes les plus refusées, refus jour par jour, semaine d'avant", async () => {
    m.rows = [...(m.rows as QaCheckLite[]), lite({ verdict: "REJECTED", reasons: gain, ago: 10 * 24 * H })];
    const html = await render({ vue: "tendances" });
    const text = checks(html);
    expect(m.calls.rows?.[0]).toBe(28);
    for (const t of ["Motifs de refus les plus fréquents", "Promesse de gain", "2 refus", "Équipes les plus refusées", "Refus jour par jour", "7 derniers jours : 1 refus sur 4 vérifications", "Semaine d'avant : 1 refus sur 1"])
      expect(text).toContain(t);
  });

  it("aucun refus : message clair", async () => {
    m.rows = [lite()];
    expect(checks(await render({ vue: "tendances" }))).toContain("Aucun refus sur 4 semaines");
  });
});
