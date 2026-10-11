/**
 * Messages privés partis avec les emojis normaux (phase 12, D8) : la note écrite par le service d'arrière-plan sur
 * le message (`OutboundMessage.error`) est reconnue et racontée en français sur la fiche d'un envoi à un groupe.
 */
import { describe, expect, it } from "vitest";
import {
  EMOJI_FALLBACK_NOTE_MARK,
  emojiFallbackSentence,
  emojiFallbackWhere,
  isEmojiFallbackNote,
} from "./dm-fallback";

describe("note « Envoyé avec les emojis normaux »", () => {
  it("reconnue dans les deux notes du service d'arrière-plan, même après une erreur de média", () => {
    expect(
      isEmojiFallbackNote("Envoyé avec les emojis normaux : Telegram a refusé les emojis animés."),
    ).toBe(true);
    expect(
      isEmojiFallbackNote("Telegram a affiché les emojis normaux à la place des emojis animés."),
    ).toBe(true);
    expect(
      isEmojiFallbackNote(
        "Média non envoyé : fichier trop gros ; Envoyé avec les emojis normaux : Telegram a refusé les emojis animés.",
      ),
    ).toBe(true);
    expect(isEmojiFallbackNote("Média non envoyé : fichier trop gros")).toBe(false);
    expect(isEmojiFallbackNote(null)).toBe(false);
  });

  it("fiche d'un envoi à un groupe : une phrase, au singulier ou au pluriel, rien s'il n'y en a pas", () => {
    expect(emojiFallbackSentence(0)).toBeNull();
    expect(emojiFallbackSentence(1)).toBe(
      "1 message est parti avec les emojis normaux à la place des emojis animés : Telegram les a refusés. Vérifiez que le compte Telegram propriétaire des bots a toujours Telegram Premium.",
    );
    expect(emojiFallbackSentence(1234)).toMatch(
      /^1\s234 messages sont partis avec les emojis normaux à la place des emojis animés/,
    );
  });

  it("requête : messages partis (et seulement eux) de cet envoi qui portent la note", () => {
    expect(emojiFallbackWhere("b1")).toEqual({
      broadcastId: "b1",
      status: "SENT",
      error: { contains: EMOJI_FALLBACK_NOTE_MARK },
    });
  });
});
