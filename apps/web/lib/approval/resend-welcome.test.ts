import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ membershipId: string }>,
  outcomes: [] as Array<Record<string, unknown>>,
  resend: vi.fn(),
  audit: vi.fn(async () => undefined),
  requireUser: vi.fn(async () => ({ id: "u1", role: "MANAGER", telegramUserId: null })),
}));
vi.mock("@linkaffipro/telegram", () => ({
  listGateLinksMissing: async () => mocks.rows,
  resendGateWelcomeWithDb: mocks.resend,
}));
vi.mock("@linkaffipro/db", () => ({ audit: mocks.audit }));
vi.mock("@/lib/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url, digest: "NEXT_REDIRECT" });
  },
}));

import { resendGateWelcomeAction } from "./resend-welcome-action";
import { resendSummary } from "./resend-welcome";

const problem = (title: string, suggestedBot: string | null = "womendatingoobot") => ({
  channelId: title,
  title,
  error: "x",
  tried: [],
  suggestedBot,
});

describe("résumé du renvoi de l'accueil", () => {
  it("aucune demande concernée", () => {
    expect(resendSummary([])).toEqual({ ok: "Aucune demande n'attend de liens dans ce canal." });
  });

  it("envoyés, liens prêts et liens toujours impossibles", () => {
    expect(
      resendSummary([
        { status: "sent", gates: 2 },
        { status: "sent", gates: 2 },
        { status: "links_ready", gates: 2 },
        { status: "still_missing", missing: [problem("TIR CADRÉ")] },
      ]),
    ).toEqual({
      ok: "Accueil renvoyé avec les liens à 2 personnes. Liens prêts pour 1 personne qui n'a pas ouvert la conversation avec le bot : Telegram ne permet pas de lui réécrire en premier, elle recevra les liens en appuyant sur « ✅ J'ai rejoint ».",
      error:
        "Liens toujours impossibles à créer pour « TIR CADRÉ » : ajoutez @womendatingoobot comme administrateur de ce canal avec le droit « Inviter via un lien », puis réessayez. Rien n'a été envoyé à ces personnes.",
    });
  });

  it("canal toujours impossible à vérifier : solution claire, rien n'est envoyé", () => {
    expect(
      resendSummary([
        { status: "still_missing", missing: [problem("TIR CADRÉ")] },
        {
          status: "still_missing",
          missing: [{ ...problem("Canal public"), reason: "cannot_verify" }],
        },
      ]),
    ).toEqual({
      error:
        "Liens toujours impossibles à créer pour « TIR CADRÉ » : ajoutez @womendatingoobot comme administrateur de ce canal avec le droit « Inviter via un lien », puis réessayez. Le bot ne peut toujours pas vérifier « Canal public » : ajoutez @womendatingoobot comme administrateur de ce canal, puis réessayez. Rien n'a été envoyé à ces personnes.",
    });
  });

  it("demandes plus en attente : rien n'est envoyé", () => {
    expect(resendSummary([{ status: "not_pending" }, { status: "not_found" }])).toEqual({
      ok: "Ces demandes ne sont plus en attente : rien n'a été envoyé.",
    });
  });
});

describe("bouton « Renvoyer l'accueil avec les liens »", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.resend.mockReset();
    mocks.audit.mockClear();
    mocks.requireUser.mockClear();
  });

  async function run(f: FormData): Promise<string> {
    try {
      await resendGateWelcomeAction(f);
    } catch (err) {
      return (err as { url?: string }).url ?? String(err);
    }
    return "";
  }

  it("personne non connectée : rien n'est renvoyé", async () => {
    mocks.requireUser.mockImplementationOnce(async () => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/login", digest: "NEXT_REDIRECT" });
    });
    mocks.rows = [{ membershipId: "ms1" }];
    const f = new FormData();
    f.append("channelId", "ch1");
    expect(await run(f)).toBe("/login");
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("renvoie chaque demande concernée, journalise l'action et revient sur l'accueil", async () => {
    mocks.rows = [{ membershipId: "ms1" }, { membershipId: "ms2" }];
    mocks.resend
      .mockResolvedValueOnce({ status: "sent", gates: 2 })
      .mockResolvedValueOnce({ status: "not_pending" });
    const f = new FormData();
    f.append("channelId", "ch1");
    f.append("returnTo", "https://evil.example");
    const url = await run(f);
    expect(mocks.resend).toHaveBeenNthCalledWith(1, "ms1", { byUserId: "u1" });
    expect(mocks.resend).toHaveBeenNthCalledWith(2, "ms2", { byUserId: "u1" });
    expect(mocks.audit).toHaveBeenCalledWith({
      userId: "u1",
      action: "membership.gate_welcome_resent",
      entityType: "Channel",
      entityId: "ch1",
      metadata: {
        requests: 2,
        sent: 1,
        linksReady: 0,
        stillMissing: 0,
        notPending: 1,
        membershipIds: ["ms1", "ms2"],
        via: "WEB",
      },
    });
    // Adresse externe refusée : retour sur l'accueil.
    expect(url.startsWith("/?ok=")).toBe(true);
    expect(new URLSearchParams(url.slice(2)).get("ok")).toBe(
      "Accueil renvoyé avec les liens à 1 personne.",
    );
  });
});
