import { beforeEach, describe, expect, it, vi } from "vitest";

// Réglages → Comptes : la persona d'un vrai compte Telegram est une persona Rencontres, jamais Casino ni Paris
// sportifs (refus côté serveur, en plus de la liste affichée).
const m = vi.hoisted(() => ({
  persona: null as { universe: string } | null,
  setPersona: vi.fn(async (..._a: unknown[]) => ({})),
  findUnique: vi.fn(async (..._a: unknown[]) => null as unknown),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn(async () => ({ id: "u1", role: "ADMIN" })) }));
vi.mock("@linkaffipro/db", () => ({ audit: vi.fn(), prisma: { persona: { findUnique: m.findUnique } } }));
vi.mock("@linkaffipro/userbot", () => ({
  disconnect: vi.fn(),
  ensureShadowBot: vi.fn(),
  refresh: vi.fn(),
  setActive: vi.fn(),
  setPersona: m.setPersona,
  startOnboarding: vi.fn(),
  submitCode: vi.fn(),
  submitPassword: vi.fn(),
}));

import { setAccountPersonaAction } from "./actions";
import { accountPersonaWhere, isAccountPersonaAllowed } from "@/lib/accounts/persona-choice";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return decodeURIComponent(String((err as Error).message).replace(/\+/g, " "));
  }
  throw new Error("aucune redirection");
}

beforeEach(() => {
  m.setPersona.mockClear();
  m.findUnique.mockReset();
});

describe("persona d'un compte Telegram", () => {
  it("règle : Rencontres seulement ; la liste ne propose que les personas Rencontres", () => {
    expect(accountPersonaWhere).toEqual({ universe: "dating" });
    expect(isAccountPersonaAllowed({ universe: "dating" })).toBe(true);
    for (const u of ["casino", "sports", "", null]) expect(isAccountPersonaAllowed({ universe: u })).toBe(false);
    expect(isAccountPersonaAllowed(null)).toBe(false);
  });

  it("persona Rencontres : enregistrée", async () => {
    m.findUnique.mockResolvedValue({ universe: "dating" });
    const url = await redirectOf(setAccountPersonaAction(fd({ accountId: "a1", personaId: "p1" })));
    expect(m.setPersona).toHaveBeenCalledWith("a1", "p1");
    expect(url).toContain("ok=");
  });

  it("persona Casino ou Paris sportifs, ou inconnue : refusée, rien n'est changé", async () => {
    for (const universe of ["casino", "sports"]) {
      m.findUnique.mockResolvedValue({ universe });
      expect(await redirectOf(setAccountPersonaAction(fd({ accountId: "a1", personaId: "p2" })))).toContain("Rencontres");
    }
    m.findUnique.mockResolvedValue(null);
    expect(await redirectOf(setAccountPersonaAction(fd({ accountId: "a1", personaId: "zz" })))).toContain("error=");
    expect(m.setPersona).not.toHaveBeenCalled();
  });

  it("« Aucune » : toujours permis", async () => {
    await redirectOf(setAccountPersonaAction(fd({ accountId: "a1", personaId: "" })));
    expect(m.setPersona).toHaveBeenCalledWith("a1", null);
    expect(m.findUnique).not.toHaveBeenCalled();
  });
});
