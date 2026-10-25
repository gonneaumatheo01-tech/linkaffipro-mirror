import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, primaryButtonCount, visibleText } from "../../settings/categories/page-checks";
import { AGENTS_JARGON, jargonIn } from "@/tests/vocabulary/jargon-scan";
import type { LibraryItem, MontageDetail, MontageJobRow, ShortClipView } from "@/lib/agents/montage-queries";

// Pages Agents → Montage (liste des travaux, médiathèque, fiche d'un travail) rendues côté serveur, données simulées.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  list: [] as unknown[],
  detail: null as unknown,
  library: { items: [] as unknown[], themes: [] as string[] },
  libraryArgs: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/agents/montage",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("./actions", () => ({ approveShortAction: vi.fn(), rejectShortAction: vi.fn(), modifyShortAction: vi.fn(), cancelMontageAction: vi.fn() }));
vi.mock("@/app/(admin)/agents/montage/actions", () => ({ approveShortAction: vi.fn(), rejectShortAction: vi.fn(), modifyShortAction: vi.fn(), cancelMontageAction: vi.fn() }));
vi.mock("@/lib/agents/queries", () => ({ loadPendingCounts: vi.fn(async () => ({ validations: 0, requests: 0 })) }));
vi.mock("@/lib/agents/montage-queries", () => ({
  loadMontageList: vi.fn(async () => m.list),
  loadMontageDetail: vi.fn(async () => m.detail),
  loadMontageLibrary: vi.fn(async (...a: unknown[]) => {
    m.libraryArgs = a;
    return m.library;
  }),
  loadLibraryChannelUsername: vi.fn(async () => null),
}));
vi.mock("@linkaffipro/db", () => ({ prisma: {}, audit: vi.fn() }));

import ListPage from "./page";
import DetailPage from "./[id]/page";

const MB = 1024 * 1024;
const source = { id: "s1", filename: "roulette-live-24-oct.mp4", size: 1.2 * 1024 * MB, width: 1920, height: 1080, duration: 2832 };
const instructions = { theme: "roulette", format: "VERTICAL_9_16", durationTarget: 15, pipPosition: "TOP_RIGHT", subtitles: true, overlayText: null, count: 3, speed: null, rawText: "découpe ça en shorts de 15 secondes, cam en haut à droite" };

const row = (o: Partial<MontageJobRow> = {}): MontageJobRow => ({
  id: "j1",
  status: "PREVIEW",
  createdAt: new Date("2026-10-25T08:00:00Z"),
  completedAt: null,
  instructions,
  sourceMeta: { durationMs: 2_832_000, width: 1920, height: 1080, sizeBytes: 1.2 * 1024 * MB, fps: 30 },
  error: null,
  source,
  thumbId: "th1",
  clipStatuses: ["APPROVED", "PREVIEW_SENT", "REJECTED"],
  ...o,
});

const clip = (o: Partial<ShortClipView> = {}): ShortClipView => ({
  id: "c1",
  index: 1,
  startMs: 150_000,
  endMs: 165_000,
  durationMs: 15_000,
  description: "Gros gain à la roulette",
  score: 9,
  format: "VERTICAL_9_16",
  pipPosition: "TOP_RIGHT",
  subtitles: true,
  overlayText: null,
  status: "PREVIEW_SENT",
  qc: { ok: true, durationMs: 15_000, width: 1080, height: 1920, sizeBytes: 18 * MB, blackSec: 0, silent: false, clipping: false, problems: [] },
  compressed: false,
  clientFeedback: null,
  redoCount: 0,
  updatedAt: new Date("2026-10-25T09:00:00Z"),
  asset: { id: "a1", storage: "telegram", size: 18 * MB, mimeType: "video/mp4", width: 1080, height: 1920, telegramRef: { chatId: "-1001234567890", messageId: 77 } },
  thumbId: null,
  ...o,
});

const detail = (o: Partial<MontageDetail> = {}): MontageDetail => {
  const { clipStatuses: _c, ...r } = row();
  return {
    ...r,
    currentStep: "preview",
    planApprovedAt: new Date("2026-10-25T08:20:00Z"),
    createdByName: "Matheo",
    source: { ...source, telegramRef: { chatId: "777", messageId: 5 } },
    shorts: [
      clip(),
      clip({
        id: "c2",
        index: 2,
        startMs: 310_000,
        endMs: 325_000,
        description: "Série de mises",
        score: 8,
        status: "APPROVED",
        compressed: true,
        clientFeedback: "parfait",
        asset: { id: "a2", storage: "telegram", size: 48 * MB, mimeType: "video/mp4", width: 1080, height: 1920, telegramRef: { chatId: "-1001234567890", messageId: 78 } },
      }),
      clip({
        id: "c3",
        index: 3,
        startMs: 900_000,
        endMs: 915_000,
        status: "QC_FAILED",
        description: null,
        qc: { ok: false, blackSec: 3.2, silent: false, problems: ["3,2 s de noir au début"] },
        asset: { id: "a3", storage: "telegram", size: 10 * MB, mimeType: "video/mp4", width: 1080, height: 1920, telegramRef: null },
      }),
      clip({ id: "c4", index: 4, status: "PLANNED", qc: null, asset: null, description: "Réaction du croupier" }),
    ],
    ...o,
  };
};

const libItem = (o: Partial<LibraryItem> = {}): LibraryItem => ({
  id: "a2",
  kind: "SHORT",
  filename: "short-2.mp4",
  size: 48 * MB,
  duration: 15,
  width: 1080,
  height: 1920,
  themes: ["roulette"],
  createdAt: new Date("2026-10-25T09:00:00Z"),
  telegramRef: { chatId: "-1001234567890", messageId: 78 },
  clip: { id: "c2", index: 2, montageJobId: "j1", status: "APPROVED" },
  jobId: "j1",
  ...o,
});

function checks(html: string) {
  expect(h1Count(html)).toBe(1);
  expect(primaryButtonCount(html)).toBeLessThanOrEqual(1);
  const text = visibleText(html);
  expect(jargonIn(text)).toEqual([]);
  expect(AGENTS_JARGON.filter((r) => r.re.test(text)).map((r) => r.word)).toEqual([]);
  return text;
}
const renderList = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve(sp) } as never));
const renderDetail = async (id = "j1") =>
  renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as never));

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.list = [row(), row({ id: "j2", status: "FAILED", thumbId: null, clipStatuses: [], error: "vidéo illisible" })];
  m.detail = detail();
  m.library = { items: [libItem(), libItem({ id: "s1", kind: "LONG_VIDEO", filename: "roulette-live-24-oct.mp4", clip: null, size: 1.2 * 1024 * MB, duration: 2832, width: 1920, height: 1080 })], themes: ["blackjack", "roulette"] };
});

describe("Agents → Montage (travaux)", () => {
  it("liste : miniature, vidéo, durée, statut en français, shorts validés sur le total, lien vers la fiche", async () => {
    const html = await renderList();
    const text = checks(html);
    for (const t of ["Montage", "Rien n'est publié sans votre ✅", "Travaux", "Médiathèque", "roulette-live-24-oct.mp4", "47 min 12 s", "1920 × 1080 (1080p)", "thème roulette", "Aperçus à valider", "1 à valider", "1 validé sur 3", "En échec", "aucun short pour l'instant", "Parler à Kevin"])
      expect(text).toContain(t);
    expect(html).toContain('href="/agents/montage/j1"');
    expect(html).toContain('src="/api/agents/media/th1"');
    expect(html).toContain('aria-current="page"');
  });

  it("aucun travail : comment envoyer une vidéo à Kevin", async () => {
    m.list = [];
    const text = checks(await renderList());
    expect(text).toContain("Aucun montage pour l'instant");
    expect(text).toContain("en privé, depuis votre compte Telegram (2 Go au plus)");
  });
});

describe("Agents → Montage (médiathèque)", () => {
  it("shorts et vidéos longues, filtres par type et par thème, lien vers Telegram", async () => {
    const html = await renderList({ vue: "mediatheque", type: "SHORT", theme: "roulette" });
    const text = checks(html);
    expect(m.libraryArgs).toEqual(["SHORT", "roulette"]);
    for (const t of ["Shorts", "Vidéos longues", "Thème", "blackjack", "Short 2", "Vidéo longue", "Validé", "48 Mo", "Ouvrir dans Telegram"]) expect(text).toContain(t);
    expect(html).toContain('href="/agents/montage?vue=mediatheque&amp;type=LONG_VIDEO&amp;theme=roulette"');
    expect(html).toContain('href="https://t.me/c/1234567890/78"');
    expect(html).toContain('href="/agents/montage/j1#short-c2"');
  });

  it("thème sans résultat", async () => {
    m.library = { items: [], themes: ["roulette"] };
    expect(checks(await renderList({ vue: "mediatheque", theme: "slots" }))).toContain("Rien pour le thème « slots »");
  });
});

describe("Agents → Montage (fiche d'un travail)", () => {
  it("administrateur : source, consignes, plan en frise, shorts avec lecture, contrôle et boutons", async () => {
    const html = await renderDetail();
    const text = checks(html);
    for (const t of [
      "roulette-live-24-oct.mp4",
      "La vidéo source",
      "47 min 12 s",
      "1,2 Go",
      "« découpe ça en shorts de 15 secondes, cam en haut à droite »",
      "Caméra en haut à droite",
      "Plan de coupe",
      "Plan validé le",
      "2:30 à 2:45",
      "intérêt 9/10",
      "Gros gain à la roulette",
      "Shorts",
      "À valider",
      "Contrôle réussi : 15 s, 1080 × 1920, 18 Mo, pas d'écran noir, son présent.",
      "Compressé pour Telegram",
      "« parfait »",
      "Contrôle raté",
      "3,2 s de noir au début",
      "Pas encore fabriqué.",
      "Valider",
      "Refuser",
      "Modifier",
      "Annuler le montage",
    ])
      expect(text).toContain(t);
    // Lecture dans le navigateur par la route protégée, chargée au clic seulement.
    expect(html).toContain('src="/api/agents/montage/short/c1"');
    expect(html).toContain('preload="none"');
    // Short de plus de 20 Mo : pas de lecteur, « ouvrez-le dans Telegram » avec le lien du message.
    expect(html).not.toContain('src="/api/agents/montage/short/c2"');
    expect(text).toContain("ouvrez-le dans Telegram");
    expect(html).toContain('href="https://t.me/c/1234567890/78"');
    // Frise : moment 1 placé à 150 s sur 2 832 s.
    expect(html).toMatch(/left:5\.29\d*%/);
    expect(html).toContain('id="short-c1"');
  });

  it("responsable : lecture seule, aucun bouton", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const html = await renderDetail();
    const text = checks(html);
    expect(text).toContain("Seuls les administrateurs peuvent valider, modifier ou refuser un short");
    for (const t of ["Annuler le montage", "Refuser", "Refaire le short"]) expect(text).not.toContain(t);
    expect(html).not.toContain('name="clipId"');
    expect(text).toContain("Gros gain à la roulette");
  });

  it("montage annulé : plus de bouton d'annulation ni de décision", async () => {
    m.detail = detail({ status: "CANCELLED" });
    const html = await renderDetail();
    expect(visibleText(html)).not.toContain("Annuler le montage");
    expect(html).not.toContain('name="clipId"');
  });

  it("en échec : la raison ; pas encore de plan : explication", async () => {
    m.detail = detail({ status: "FAILED", error: "la vidéo est illisible", shorts: [] });
    const text = checks(await renderDetail());
    expect(text).toContain("Le montage s'est arrêté : la vidéo est illisible");
    expect(text).toContain("Pas encore de plan");
  });

  it("travail inconnu ou identifiant douteux : page introuvable", async () => {
    m.detail = null;
    await expect(renderDetail()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderDetail("../x")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
