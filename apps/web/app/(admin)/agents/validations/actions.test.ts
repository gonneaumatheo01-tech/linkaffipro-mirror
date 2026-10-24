/**
 * Onglet Demandes : le rôle de l'utilisateur est transmis au moteur, qui refuse à un MANAGER les demandes réservées
 * aux ADMIN (clé, passage en vrai, niveau 2…). Relecture adverse de la phase 25.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({
  answerHumanRequestFromSite: vi.fn(async () => ({ ok: false, message: "Cette demande est réservée aux administrateurs." })),
  skipHumanRequest: vi.fn(async () => ({ ok: true, message: "ok" })),
  decideValidation: vi.fn(),
  relaunchHumanRequest: vi.fn(),
}));
const session = vi.hoisted(() => ({ role: "MANAGER" as "ADMIN" | "MANAGER" }));

vi.mock("@linkaffipro/agents", () => engine);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({}) }));
vi.mock("@/lib/agents/redirect", () => ({
  backTo: (path: string, params: Record<string, string>) => {
    throw Object.assign(new Error(`${path}?${new URLSearchParams(params)}`), { digest: "NEXT_REDIRECT" });
  },
  isRedirectError: (err: unknown) => (err as { digest?: string })?.digest === "NEXT_REDIRECT",
  errorText: (err: unknown) => (err as Error).message,
}));
vi.mock("@/lib/session", () => ({ requireUser: async () => ({ id: "u1", role: session.role }) }));

import { answerHumanRequestAction, skipHumanRequestAction } from "./actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  engine.answerHumanRequestFromSite.mockClear();
  engine.skipHumanRequest.mockClear();
});

describe("demandes au client depuis le site", () => {
  it("le rôle MANAGER est passé au moteur ; son refus est affiché", async () => {
    session.role = "MANAGER";
    await expect(answerHumanRequestAction(form({ requestId: "r1", answer: "oui" }))).rejects.toThrow(/error=Cette/);
    expect(engine.answerHumanRequestFromSite).toHaveBeenCalledWith({}, "r1", "oui", { userId: "u1", via: "SITE" }, "MANAGER");
  });

  it("« Plus tard » transmet aussi le rôle", async () => {
    session.role = "ADMIN";
    await expect(skipHumanRequestAction(form({ requestId: "r2" }))).rejects.toThrow(/NEXT_REDIRECT|agents/);
    expect(engine.skipHumanRequest).toHaveBeenCalledWith({}, "r2", { userId: "u1", via: "SITE" }, "ADMIN");
  });
});
