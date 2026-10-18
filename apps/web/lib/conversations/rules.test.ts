import { describe, expect, it } from "vitest";
import {
  busyRefusal,
  checkTeamText,
  conversationActions,
  isFinal,
  isReopenableByTeam,
  lastSentAt,
  refusalFor,
  reopenStage,
  sendLock,
  TEAM_MESSAGE_MAX,
  TEAM_TURN_PREFIX,
  teamTurnId,
  type ConversationRuleInput,
} from "./rules";

const c = (over: Partial<ConversationRuleInput> = {}): ConversationRuleInput => ({
  status: "BOT",
  stoppedAt: null,
  isMinor: false,
  closedReason: null,
  memberBlocked: false,
  botActive: true,
  ...over,
});

describe("actions possibles selon l'état de la conversation", () => {
  it("l'assistante répond : prendre la main, fermer, bloquer, écrire (pas « rendre »)", () => {
    expect(conversationActions(c())).toEqual({
      takeOver: true,
      release: false,
      close: true,
      block: true,
      send: true,
      lock: null,
    });
  });

  it("l'équipe a la main : rendre, fermer, bloquer, écrire (pas « prendre »)", () => {
    const a = conversationActions(c({ status: "HUMAN" }));
    expect(a).toMatchObject({
      takeOver: false,
      release: true,
      close: true,
      block: true,
      send: true,
    });
  });

  it("fermée par l'équipe : rouvrable (prendre ou rendre la main, écrire), pas « fermer »", () => {
    const a = conversationActions(c({ status: "CLOSED", closedReason: "TEAM_CLOSED" }));
    expect(a).toMatchObject({
      takeOver: true,
      release: true,
      close: false,
      block: true,
      send: true,
    });
  });

  it("/stop, mineur, bloquée par l'équipe : plus rien, définitivement", () => {
    for (const over of [
      { status: "CLOSED" as const, closedReason: "STOP", stoppedAt: new Date() },
      { status: "CLOSED" as const, closedReason: "MINOR", isMinor: true },
      { status: "CLOSED" as const, closedReason: "TEAM" },
    ]) {
      const a = conversationActions(c(over));
      expect(a).toMatchObject({
        takeOver: false,
        release: false,
        close: false,
        block: false,
        send: false,
      });
      expect(a.lock).not.toBeNull();
      expect(isFinal(c(over))).toBe(true);
    }
  });

  it("la personne a bloqué le bot : seulement « Bloquer » (sinon elle reprend toute seule si elle réécrit)", () => {
    const a = conversationActions(c({ status: "CLOSED", closedReason: "BLOCKED" }));
    expect(a).toMatchObject({
      takeOver: false,
      release: false,
      close: false,
      block: true,
      send: false,
    });
    expect(a.lock?.code).toBe("member_blocked");
    const u = conversationActions(c({ status: "CLOSED", closedReason: "UNREACHABLE" }));
    expect(u.lock?.code).toBe("unreachable");
  });

  it("bot bloqué alors que la conversation est ouverte : on peut prendre la main, pas écrire", () => {
    const a = conversationActions(c({ memberBlocked: true }));
    expect(a).toMatchObject({ takeOver: true, send: false });
    expect(a.lock?.code).toBe("member_blocked");
  });

  it("bot désactivé : impossible d'écrire", () => {
    expect(sendLock(c({ botActive: false }))?.code).toBe("bot_inactive");
  });
});

describe("phrases d'explication", () => {
  it("/stop : la phrase du client", () => {
    expect(sendLock(c({ stoppedAt: new Date(), status: "CLOSED" }))?.message).toBe(
      "Cette personne a demandé l'arrêt (/stop) : plus aucun message ne peut lui être envoyé.",
    );
    expect(sendLock(c({ isMinor: true }))?.message).toContain("moins de 18 ans");
  });

  it("refus : la raison d'abord (définitif), sinon l'état", () => {
    const stopped = c({ stoppedAt: new Date(), status: "CLOSED" });
    expect(refusalFor("takeOver", stopped, "l'assistante")).toContain("/stop");
    expect(refusalFor("takeOver", c({ status: "HUMAN" }), "l'assistante")).toBe(
      "L'équipe a déjà la main sur cette conversation.",
    );
    expect(refusalFor("release", c(), "l'assistant")).toBe(
      "C'est déjà l'assistant qui répond dans cette conversation.",
    );
    expect(refusalFor("close", c({ status: "CLOSED", closedReason: "TEAM_CLOSED" }), "x")).toBe(
      "Cette conversation est déjà fermée.",
    );
    expect(refusalFor("send", c({ memberBlocked: true }), "x")).toContain("bloqué le bot");
  });
});

describe("réouverture par l'équipe", () => {
  it("seulement une conversation fermée par l'équipe (ou pour une raison inconnue)", () => {
    expect(isReopenableByTeam(c({ status: "CLOSED", closedReason: "TEAM_CLOSED" }))).toBe(true);
    expect(isReopenableByTeam(c({ status: "CLOSED", closedReason: null }))).toBe(true);
    expect(isReopenableByTeam(c({ status: "CLOSED", closedReason: "TEAM" }))).toBe(false);
    expect(isReopenableByTeam(c({ status: "CLOSED", closedReason: "BLOCKED" }))).toBe(false);
    expect(isReopenableByTeam(c({ status: "BOT" }))).toBe(false);
  });

  it("étape d'avant la fermeture, sinon Discussion si l'assistante a parlé, sinon Accueil", () => {
    expect(reopenStage({ stageBeforeClose: "LINK_SENT", assistantTurns: 3 })).toBe("LINK_SENT");
    expect(reopenStage({ stageBeforeClose: "CLOSED", assistantTurns: 3 })).toBe("CHAT");
    expect(reopenStage({ stageBeforeClose: null, assistantTurns: 0 })).toBe("WELCOME");
  });

  it("repère des messages reçus pendant la reprise : team-<horodatage>", () => {
    const now = new Date("2026-10-18T10:00:00Z");
    expect(teamTurnId(now)).toBe(`${TEAM_TURN_PREFIX}${now.getTime()}`);
    expect(teamTurnId(now)).toMatch(/^team-\d+$/);
  });
});

describe("texte d'un message de l'équipe", () => {
  it("non vide, espaces retirés, retours à la ligne gardés", () => {
    expect(checkTeamText("  ")).toEqual({
      ok: false,
      error: "Écrivez un message avant de cliquer sur « Envoyer ».",
    });
    expect(checkTeamText(null).ok).toBe(false);
    expect(checkTeamText("  Salut\r\nça va ?  ")).toEqual({ ok: true, text: "Salut\nça va ?" });
  });

  it("4 000 caractères au plus (emojis comptés pour un)", () => {
    expect(checkTeamText("a".repeat(TEAM_MESSAGE_MAX)).ok).toBe(true);
    expect(checkTeamText("😀".repeat(TEAM_MESSAGE_MAX)).ok).toBe(true);
    const r = checkTeamText("a".repeat(TEAM_MESSAGE_MAX + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/4\s000 caractères au plus/);
  });
});

describe("rendre la main", () => {
  it("dernier message parti : le plus récent entre celui de l'assistante et le dernier message sortant du fil", () => {
    const assistant = new Date("2026-10-18T10:00:00Z");
    const team = new Date("2026-10-18T10:07:00Z");
    expect(lastSentAt(assistant, team)).toBe(team);
    expect(lastSentAt(null, team)).toBe(team);
    const later = new Date("2026-10-18T10:08:00Z");
    expect(lastSentAt(later, team)).toBe(later);
  });

  it("tour en cours : refus expliqué, au bon genre", () => {
    expect(busyRefusal("F")).toBe(
      "L'assistante finit de traiter un message de cette conversation : réessayez dans quelques secondes.",
    );
    expect(busyRefusal("M")).toMatch(/^L'assistant finit/);
    expect(busyRefusal(null)).toMatch(/^L'assistante finit/);
  });
});
