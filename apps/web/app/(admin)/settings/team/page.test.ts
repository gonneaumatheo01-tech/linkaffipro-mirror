import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, jargonIn, primaryButtonCount, visibleText } from "../categories/page-checks";

// Réglages → Équipe rendue côté serveur avec une base simulée.
const mocks = vi.hoisted(() => ({
  users: [] as Array<Record<string, unknown>>,
  invitations: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    user: { findMany: vi.fn(async () => mocks.users) },
    invitation: { findMany: vi.fn(async () => mocks.invitations) },
  },
}));
vi.mock("@/lib/session", () => ({ requireAdminPage: vi.fn(async () => ({ id: "me" })) }));
vi.mock("./actions", () => ({
  inviteAction: vi.fn(),
  resetPasswordAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
  setRoleAction: vi.fn(),
  toggleUserAction: vi.fn(),
}));

import TeamPage from "./page";

async function render(): Promise<string> {
  return renderToStaticMarkup(await TeamPage({ searchParams: Promise.resolve({}) } as never));
}

const user = (id: string, name: string, role: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  email: `${id}@exemple.fr`,
  role,
  isActive: true,
  telegramUserId: null,
  lastLoginAt: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  ...extra,
});

beforeEach(() => {
  mocks.users = [
    user("me", "Moi", "ADMIN"),
    user("lea", "Léa", "MANAGER", { telegramUserId: 42n }),
  ];
  mocks.invitations = [];
});

describe("Réglages → Équipe", () => {
  it("socle : un titre, retour vers Réglages, un seul bouton orange « Inviter un équipier »", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(html).toContain('href="/settings"');
    expect(primaryButtonCount(html)).toBe(1);
    expect(visibleText(html)).toContain("Inviter un équipier");
  });

  it("tableau : personne, rôle, état et Telegram en mots simples ; résumé de l'équipe", async () => {
    const text = visibleText(await render());
    expect(text).toContain("2 comptes, tous actifs");
    expect(text).toContain("Moi (vous)");
    expect(text).toContain("Manager");
    expect(text).toContain("Lié");
    expect(text).toContain("Non lié");
    expect(jargonIn(text)).toEqual([]);
  });

  it("e-mail : passe à la ligne avant « @ » seulement, jamais au milieu du domaine", async () => {
    mocks.users = [user("me", "Moi", "ADMIN", { email: "gonneaumatheo.business@gmail.com" })];
    mocks.invitations = [
      {
        id: "i1",
        email: "max.durand@exemple.fr",
        role: "MANAGER",
        token: "jeton123",
        expiresAt: new Date("2026-10-17T10:00:00Z"),
        invitedBy: { name: "Moi" },
      },
    ];
    const html = await render();
    expect(html).toContain("gonneaumatheo.business<wbr/>@gmail.com");
    expect(html).toContain("max.durand<wbr/>@exemple.fr");
    expect(html).not.toContain("break-all");
  });

  it("invitations : lien à copier et nature de l'invitation", async () => {
    mocks.invitations = [
      {
        id: "i1",
        email: "lea@exemple.fr",
        role: "MANAGER",
        token: "jeton123",
        expiresAt: new Date("2026-10-17T10:00:00Z"),
        invitedBy: { name: "Moi" },
      },
      {
        id: "i2",
        email: "max@exemple.fr",
        role: "ADMIN",
        token: "jeton456",
        expiresAt: new Date("2026-10-17T10:00:00Z"),
        invitedBy: { name: "Moi" },
      },
    ];
    const html = await render();
    expect(html).toContain("/invite/jeton123");
    expect(html).toContain("/invite/jeton456");
    const text = visibleText(html);
    expect(text).toContain("Nouveau mot de passe");
    expect(text).toContain("Nouveau compte");
    expect(text).toContain("Annuler l'invitation");
  });
});
