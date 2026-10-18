import { describe, expect, it } from "vitest";
import {
  nobodyRepliesSentence,
  releaseWarning,
  replyBlock,
  replyBlockTitle,
  type ReplyCheck,
} from "./reply-state";

const ok: ReplyCheck = {
  activation: "all",
  botActive: true,
  botMode: "ASSISTANT",
  personaActive: true,
  isTeamMember: false,
};

describe("l'assistante répondra-t-elle à cette personne ? (même règle que le webhook)", () => {
  it("tout est en place : elle répond", () => {
    expect(replyBlock(ok)).toBeNull();
    expect(replyBlock({ ...ok, activation: "team", isTeamMember: true })).toBeNull();
  });

  it("essai réservé à l'équipe : personne ne répond à quelqu'un hors équipe", () => {
    expect(replyBlock({ ...ok, activation: "team", isTeamMember: false })).toBe("team_only");
  });

  it("désactivé, bot désactivé, bot repassé en bot normal, sans persona, persona désactivée", () => {
    expect(replyBlock({ ...ok, activation: "off" })).toBe("activation_off");
    expect(replyBlock({ ...ok, botActive: false })).toBe("bot_inactive");
    expect(replyBlock({ ...ok, botMode: "STANDARD" })).toBe("not_assistant_bot");
    expect(replyBlock({ ...ok, personaActive: null })).toBe("no_persona");
    expect(replyBlock({ ...ok, personaActive: false })).toBe("persona_inactive");
    // La raison la plus générale d'abord : l'activation coupée cache tout le reste.
    expect(replyBlock({ ...ok, activation: "off", personaActive: false })).toBe("activation_off");
  });

  it("phrases : la raison et quoi faire, sans terme technique", () => {
    expect(nobodyRepliesSentence("team_only")).toBe(
      "Personne ne répond pour l'instant : l'essai est limité aux comptes de l'équipe, et cette personne n'en fait pas partie (Réglages → IA de conversation). Prenez la main pour lui répondre vous-même.",
    );
    expect(releaseWarning("persona_inactive")).toBe(
      "En rendant la main, personne ne répondra : la persona de cette conversation est désactivée (onglet Personas).",
    );
    expect(replyBlockTitle("not_assistant_bot")).toBe(
      "Ce bot n'est plus en mode assistant (Réglages → Bots).",
    );
  });
});
