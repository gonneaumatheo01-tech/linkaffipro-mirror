import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de l'équipe sur une conversation : utilisateur connecté exigé (administrateur ou manager, vérifié côté
// serveur avant toute écriture), identifiant contrôlé, retour par l'adresse (bandeau vert ou rouge) ; « Envoyer »
// renvoie son état au formulaire. Les écritures elles-mêmes sont testées sur base réelle
// (tests/integration/conversations-inbox.test.ts).
const m = vi.hoisted(() => ({
  user: { id: "u1", name: "Marie", role: "MANAGER" as const },
  requireUser: vi.fn(),
  ops: {
    takeOverConversation: vi.fn(),
    releaseConversation: vi.fn(),
    closeConversation: vi.fn(),
    blockConversation: vi.fn(),
    clearNeedsHuman: vi.fn(),
    sendTeamMessage: vi.fn(),
  },
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
vi.mock("@/lib/session", () => ({ requireUser: m.requireUser }));
vi.mock("@/lib/conversations/operations", () => m.ops);

import {
  blockAction,
  clearNeedsHumanAction,
  closeAction,
  releaseAction,
  sendTeamMessageAction,
  takeOverAction,
} from "./actions";

const ID = "clconversation0001";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function redirected(p: Promise<unknown>): Promise<{ path: string; params: URLSearchParams }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof Redirect) {
      const [path, q] = err.url.split("?");
      return { path: path!, params: new URLSearchParams(q) };
    }
    throw err;
  }
  throw new Error("aucune redirection");
}

beforeEach(() => {
  m.requireUser.mockReset();
  m.requireUser.mockImplementation(async () => m.user);
  for (const f of Object.values(m.ops)) f.mockReset();
  m.revalidated.length = 0;
});

describe("prendre la main, rendre, fermer, bloquer, marquer comme traitée", () => {
  it.each([
    ["takeOverAction", takeOverAction, "takeOverConversation"],
    ["releaseAction", releaseAction, "releaseConversation"],
    ["closeAction", closeAction, "closeConversation"],
    ["blockAction", blockAction, "blockConversation"],
    ["clearNeedsHumanAction", clearNeedsHumanAction, "clearNeedsHuman"],
  ] as const)(
    "%s : utilisateur exigé, opération appelée, retour vert sur la fiche",
    async (_n, action, op) => {
      m.ops[op].mockResolvedValue({ ok: true, message: "C'est fait." });
      const r = await redirected(action(form({ id: ID })));
      expect(m.requireUser).toHaveBeenCalledTimes(1);
      expect(m.ops[op]).toHaveBeenCalledWith(ID, { id: "u1", name: "Marie" });
      expect(r.path).toBe(`/conversations/${ID}`);
      expect(r.params.get("ok")).toBe("C'est fait.");
      expect(m.revalidated).toEqual([`/conversations/${ID}`, "/conversations"]);
    },
  );

  it("refus : bandeau rouge avec la raison", async () => {
    m.ops.takeOverConversation.mockResolvedValue({
      ok: false,
      error:
        "Cette personne a demandé l'arrêt (/stop) : plus aucun message ne peut lui être envoyé.",
    });
    const r = await redirected(takeOverAction(form({ id: ID })));
    expect(r.params.get("error")).toContain("/stop");
  });

  it("« Marquer comme traitée » : ouvert aux managers, identifiant invalide refusé sans écriture", async () => {
    m.ops.clearNeedsHuman.mockResolvedValue({
      ok: true,
      message: "Conversation marquée comme traitée.",
    });
    const ok = await redirected(clearNeedsHumanAction(form({ id: ID })));
    expect(ok.params.get("ok")).toBe("Conversation marquée comme traitée.");
    const bad = await redirected(clearNeedsHumanAction(form({ id: "x;DROP" })));
    expect(bad.params.get("error")).toBe("Conversation introuvable.");
    expect(m.ops.clearNeedsHuman).toHaveBeenCalledTimes(1);
  });

  it("identifiant invalide : rien n'est écrit", async () => {
    const r = await redirected(blockAction(form({ id: "../../x" })));
    expect(r.path).toBe("/conversations");
    expect(r.params.get("error")).toBe("Conversation introuvable.");
    expect(m.ops.blockConversation).not.toHaveBeenCalled();
  });

  it("sans session valide : requireUser redirige avant toute écriture", async () => {
    m.requireUser.mockImplementation(async () => {
      throw new Redirect("/login");
    });
    const r = await redirected(closeAction(form({ id: ID })));
    expect(r.path).toBe("/login");
    expect(m.ops.closeConversation).not.toHaveBeenCalled();
  });
});

describe("Envoyer", () => {
  it("message envoyé : état « envoyé » (avec la prise de main)", async () => {
    m.ops.sendTeamMessage.mockResolvedValue({
      ok: true,
      message: "Message envoyé.",
      tookOver: true,
    });
    const s = await sendTeamMessageAction({ status: "idle" }, form({ id: ID, text: "Coucou" }));
    expect(m.ops.sendTeamMessage).toHaveBeenCalledWith(ID, { id: "u1", name: "Marie" }, "Coucou");
    expect(s).toMatchObject({ status: "sent", message: "Message envoyé.", tookOver: true });
  });

  it("refus : état « erreur » avec la raison (le texte reste dans le champ)", async () => {
    m.ops.sendTeamMessage.mockResolvedValue({ ok: false, error: "Message trop long." });
    const s = await sendTeamMessageAction({ status: "idle" }, form({ id: ID, text: "x" }));
    expect(s).toMatchObject({ status: "error", error: "Message trop long." });
  });

  it("identifiant invalide : refusé sans écriture", async () => {
    const s = await sendTeamMessageAction({ status: "idle" }, form({ id: "", text: "x" }));
    expect(s).toMatchObject({ status: "error", error: "Conversation introuvable." });
    expect(m.ops.sendTeamMessage).not.toHaveBeenCalled();
  });
});
