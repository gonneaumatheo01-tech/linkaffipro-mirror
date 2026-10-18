import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions des écrans Personas : session vérifiée côté serveur, rôle transmis à l'enregistrement, retours par l'adresse.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "MANAGER" as "ADMIN" | "MANAGER" },
  save: vi.fn(),
  del: vi.fn(),
  revalidated: [] as string[],
}));

class Redirect extends Error {
  digest: string;
  constructor(readonly url: string) {
    super("NEXT_REDIRECT");
    this.digest = `NEXT_REDIRECT;${url}`;
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => void m.revalidated.push(p) }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/lib/personas/save", () => ({ savePersona: m.save, deletePersona: m.del }));

import { deletePersonaAction, savePersonaAction } from "./actions";

async function redirected(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof Redirect) return err.url;
    throw err;
  }
  throw new Error("pas de redirection");
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  m.user = { id: "u1", role: "MANAGER" };
  m.save.mockReset();
  m.del.mockReset();
  m.revalidated.length = 0;
});

describe("savePersonaAction", () => {
  it("brouillon illisible : la saisie est gardée, message clair", async () => {
    const r = await savePersonaAction(null, fd({ payload: "{pas du json" }));
    expect(r?.error).toMatch(/rechargez la page/);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("refus de l'enregistrement : erreurs rendues au formulaire, pas de redirection", async () => {
    m.save.mockResolvedValue({
      ok: false,
      error: "Un champ est à corriger.",
      errors: { name: "x" },
    });
    const r = await savePersonaAction(null, fd({ payload: JSON.stringify({ name: "" }) }));
    expect(r).toEqual({ error: "Un champ est à corriger.", errors: { name: "x" } });
  });

  it("enregistré : rôle transmis, fiche ouverte avec le retour (et le problème Telegram s'il y en a)", async () => {
    m.save.mockResolvedValue({
      ok: true,
      id: "p1",
      created: true,
      message: "Persona « Léa » créée.",
      problem: "Telegram injoignable.",
    });
    const url = await redirected(savePersonaAction(null, fd({ payload: JSON.stringify({}) })));
    expect(m.save).toHaveBeenCalledWith({}, { id: "u1", role: "MANAGER" });
    const [path, query] = url.split("?");
    expect(path).toBe("/conversations/personas/p1");
    const q = new URLSearchParams(query);
    expect(q.get("ok")).toBe("Persona « Léa » créée.");
    expect(q.get("error")).toBe("Telegram injoignable.");
    expect(m.revalidated).toContain("/conversations/personas");
    expect(m.revalidated).toContain("/settings/bots");
  });
});

describe("deletePersonaAction", () => {
  it("refus (responsable, ou bot qui l'utilise) : retour sur la fiche avec le message", async () => {
    m.del.mockResolvedValue({
      ok: false,
      error: "Seul un administrateur peut supprimer une persona.",
    });
    const url = await redirected(deletePersonaAction(fd({ personaId: "p1" })));
    expect(m.del).toHaveBeenCalledWith("p1", { id: "u1", role: "MANAGER" });
    expect(url.startsWith("/conversations/personas/p1?")).toBe(true);
    expect(new URLSearchParams(url.split("?")[1]).get("error")).toMatch(/administrateur/);
  });

  it("supprimée : retour à la liste", async () => {
    m.user = { id: "a1", role: "ADMIN" };
    m.del.mockResolvedValue({ ok: true, message: "Persona supprimée." });
    const url = await redirected(deletePersonaAction(fd({ personaId: "p1" })));
    expect(url).toBe(
      `/conversations/personas?${new URLSearchParams({ ok: "Persona supprimée." })}`,
    );
  });
});
