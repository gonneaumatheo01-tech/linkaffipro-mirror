import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Messages → Emojis animés rendu côté serveur, base simulée : état vide, packs, droits (retirer : administrateurs).
type Row = {
  id: string;
  customEmojiId: string;
  fallback: string;
  setName: string | null;
  setTitle: string | null;
  format: string | null;
  previewMime: string | null;
  previewError: string | null;
  useCount: number;
  lastUsedAt: Date | null;
  source: "FORWARD" | "PACK" | "ACCOUNT";
  createdAt: Date;
  hiddenAt: Date | null;
  addedBy: { name: string } | null;
};
const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  role: "ADMIN" as "ADMIN" | "MANAGER",
  findMany: vi.fn(),
  session: null as null | { status: string; lastError: string | null },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@linkaffipro/queue", () => ({ enqueue: vi.fn() }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    customEmoji: {
      findMany: mocks.findMany,
      count: vi.fn(async (args: { where: { hiddenAt: unknown; previewMime?: unknown } }) =>
        args.where.previewMime === null
          ? mocks.rows.filter((r) => !r.hiddenAt && !r.previewMime).length
          : args.where.hiddenAt === null
            ? mocks.rows.filter((r) => !r.hiddenAt).length
            : mocks.rows.filter((r) => r.hiddenAt).length,
      ),
    },
    bot: {
      findMany: vi.fn(async () => [
        { username: "casinogamblingoobot", name: "Casino" },
        { username: "sportbettingoobot", name: "Paris" },
      ]),
    },
    telegramUserSession: { findUnique: vi.fn(async () => mocks.session) },
    auditLog: { findFirst: vi.fn(async () => null) },
    event: { findFirst: vi.fn(async () => null) },
  },
  audit: vi.fn(),
  recordEvent: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: mocks.role })),
}));

import { createElement } from "react";
import Page from "./page";
import { AddEmojisContent } from "@/components/custom-emoji/add-emojis-panel";
import { accountImportState, activeBotUsernames } from "@/lib/custom-emoji/queries";

/** Contenu du volet (le volet lui-même s'ouvre dans le navigateur : pas de rendu serveur de son contenu). */
async function renderPanel(): Promise<string> {
  const noop = async () => null;
  return renderToStaticMarkup(
    createElement(AddEmojisContent, {
      bots: await activeBotUsernames(),
      account: await accountImportState(),
      importPack: noop,
      importAccount: noop,
    }),
  );
}

async function render(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) } as never));
}

const row = (
  id: string,
  fallback: string,
  setName: string | null,
  extra: Partial<Row> = {},
): Row => ({
  id: `r${id}`,
  customEmojiId: id,
  fallback,
  setName,
  setTitle: setName ? `Pack ${setName}` : null,
  format: "tgs",
  previewMime: "application/x-tgsticker",
  previewError: null,
  useCount: 0,
  lastUsedAt: null,
  source: "PACK",
  createdAt: new Date("2026-10-11T10:00:00Z"),
  hiddenAt: null,
  addedBy: { name: "Alice" },
  ...extra,
});

beforeEach(() => {
  mocks.rows = [];
  mocks.role = "ADMIN";
  mocks.session = null;
  mocks.findMany.mockReset();
  mocks.findMany.mockImplementation(async (args: { where: { hiddenAt: unknown } }) =>
    mocks.rows.filter((r) => (args.where.hiddenAt === null ? !r.hiddenAt : Boolean(r.hiddenAt))),
  );
});

describe("Messages → Emojis animés", () => {
  it("en-tête, un seul bouton principal, onglets des Messages (Emojis animés ouvert)", async () => {
    const html = await render();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(">Emojis animés</h1>");
    expect(html).toContain("Ajouter des emojis animés");
    expect(html).toMatch(/aria-label="Vue des messages"/);
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/messages\/emojis"/);
    expect(html).toContain('href="/messages?view=templates"');
  });

  it("bibliothèque vide : explique comment ajouter des emojis (transférer un message au bot)", async () => {
    const html = await render();
    expect(html).toContain("Aucun emoji animé pour l&#x27;instant");
    expect(html).toContain("Transférez au bot un message qui contient vos emojis animés");
  });

  it("un bloc par pack, dans l'ordre alphabétique, emojis sans pack en dernier ; aperçus manquants signalés", async () => {
    mocks.rows = [
      row("3", "⭐", null, { previewMime: null }),
      row("1", "🎰", "Zeta"),
      row("2", "⚽", "Alpha"),
    ];
    const html = await render();
    const order = ["Pack Alpha", "Pack Zeta", "Autres emojis"].map((t) =>
      html.indexOf(`>${t}</h2>`),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('aria-label="Emoji animé 🎰 (Pack Zeta) : voir le détail"');
    expect(html).toContain('href="https://t.me/addemoji/Zeta"');
    expect(html).toContain("1 aperçu pas encore récupéré");
    expect(html).toContain("3 emojis animés · 3 packs");
  });

  it("administrateur : accès aux emojis retirés ; responsable : jamais (même par l'adresse)", async () => {
    mocks.rows = [row("1", "🎰", "Zeta"), row("2", "⚽", "Alpha", { hiddenAt: new Date() })];
    expect(await render()).toContain("Emojis retirés (1)");
    const hidden = await render({ vue: "retires" });
    expect(hidden).toContain("Emojis retirés de la bibliothèque");
    expect(hidden).toContain("⚽");
    expect(hidden).not.toContain("🎰");
    mocks.role = "MANAGER";
    const manager = await render({ vue: "retires" });
    expect(manager).not.toContain("Emojis retirés");
    expect(manager).toContain("🎰");
    expect(mocks.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { hiddenAt: null } }),
    );
  });

  it("tous les emojis retirés : l'administrateur garde le lien « Emojis retirés (N) » dans l'état vide, pas le responsable", async () => {
    mocks.rows = [
      row("1", "🎰", "Zeta", { hiddenAt: new Date() }),
      row("2", "⚽", "Alpha", { hiddenAt: new Date() }),
    ];
    const html = await render();
    expect(html).toContain("Aucun emoji animé pour l&#x27;instant");
    expect(html).toMatch(
      /<a[^>]*href="\/messages\/emojis\?vue=retires"[^>]*>Emojis retirés \(2\)<\/a>/,
    );
    mocks.role = "MANAGER";
    expect(await render()).not.toContain("Emojis retirés");
  });

  it("volet « Ajouter des emojis animés » : les 3 façons, nos bots, l'état du compte", async () => {
    mocks.session = { status: "ACTIVE", lastError: null };
    const html = await renderPanel();
    expect(html).toContain("Transférer un message au bot");
    expect(html).toContain("Coller le lien d&#x27;un pack");
    expect(html).toContain("Importer les packs de votre compte Telegram");
    expect(html).toContain('href="https://t.me/casinogamblingoobot"');
    expect(html).toContain("@sportbettingoobot");
    expect(html).toContain('placeholder="https://t.me/addemoji/NomDuPack"');
    expect(html).toContain("Compte Telegram connecté.");
    expect(html).toContain("Importer mes packs");
  });

  it("sans compte Telegram connecté : lien vers Réglages → Connexions → Telegram", async () => {
    const html = await renderPanel();
    expect(html).toContain("Aucun compte Telegram connecté");
    expect(html).toContain('href="/settings/connectors/telegram"');
    expect(html).not.toContain("Importer mes packs");
  });
});
