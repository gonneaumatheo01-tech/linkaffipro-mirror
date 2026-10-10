import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, primaryButtonCount, visibleText } from "../settings/categories/page-checks";

// Mon compte rendue côté serveur avec une base simulée.
const mocks = vi.hoisted(() => ({
  user: { telegramLinkToken: null as string | null, telegramUserId: null as bigint | null },
  bots: [{ username: "demo_bot", name: "Bot démo" }] as Array<{ username: string; name: string }>,
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    user: { findUniqueOrThrow: vi.fn(async () => mocks.user) },
    bot: { findMany: vi.fn(async () => mocks.bots) },
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({
    id: "u1",
    name: "Léa",
    email: "lea@exemple.fr",
    role: "MANAGER",
  })),
}));
vi.mock("@/lib/onboarding/actions", () => ({ restartTourAction: vi.fn() }));
vi.mock("./actions", () => ({
  changePasswordAction: vi.fn(),
  generateTelegramLinkAction: vi.fn(),
  unlinkTelegramAction: vi.fn(),
}));

import AccountPage from "./page";

async function render(): Promise<string> {
  return renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve({}) } as never));
}

beforeEach(() => {
  mocks.user = { telegramLinkToken: null, telegramUserId: null };
  mocks.bots = [{ username: "demo_bot", name: "Bot démo" }];
});

describe("Mon compte", () => {
  it("un titre, un seul bouton orange, « Revoir la visite » toujours là", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(1);
    const text = visibleText(html);
    expect(text).toContain("Revoir la visite");
    expect(text).toContain("Manager");
    expect(text).toContain("Non lié");
    for (const name of ["current", "password", "confirm"]) expect(html).toContain(`name="${name}"`);
  });

  it("lien Telegram généré : liens à copier, le bouton orange revient au mot de passe", async () => {
    mocks.user = { telegramLinkToken: "abc", telegramUserId: null };
    const html = await render();
    expect(html).toContain("https://t.me/demo_bot?start=admin_abc");
    expect(primaryButtonCount(html)).toBe(1);
    expect(visibleText(html)).toContain("Générer un nouveau lien");
  });

  it("Telegram lié : bouton « Délier », toujours un seul bouton orange", async () => {
    mocks.user = { telegramLinkToken: null, telegramUserId: 123n };
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain("Lié");
    expect(text).toContain("Délier");
    expect(primaryButtonCount(html)).toBe(1);
  });
});
