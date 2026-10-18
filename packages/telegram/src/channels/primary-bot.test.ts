import { describe, expect, it } from "vitest";
import { choosePrimaryBot, sameRights } from "./primary-bot";

const casino = { id: "b_casino", vertical: "CASINO" };
const sport = { id: "b_sport", vertical: "SPORTS" };
const dating = { id: "b_dating", vertical: "DATING" };

describe("choosePrimaryBot", () => {
  it("préfère un bot administrateur du même univers que le canal", () => {
    expect(
      choosePrimaryBot({ channelVertical: "SPORTS", detector: casino, admins: [casino, sport] }),
    ).toEqual({ botId: "b_sport", reason: "same_vertical" });
  });
  it("sinon le bot détecteur s'il est administrateur", () => {
    expect(
      choosePrimaryBot({ channelVertical: null, detector: sport, admins: [casino, sport] }),
    ).toEqual({ botId: "b_sport", reason: "detector_admin" });
    expect(
      choosePrimaryBot({ channelVertical: "DATING", detector: sport, admins: [casino, sport] }),
    ).toEqual({ botId: "b_sport", reason: "detector_admin" });
  });
  it("sinon le premier bot administrateur", () => {
    expect(
      choosePrimaryBot({ channelVertical: null, detector: dating, admins: [casino, sport] }),
    ).toEqual({ botId: "b_casino", reason: "first_admin" });
    expect(
      choosePrimaryBot({ channelVertical: null, detector: null, admins: [sport, casino] }),
    ).toEqual({ botId: "b_sport", reason: "first_admin" });
  });
  it("aucun bot administrateur : le bot détecteur, sinon rien", () => {
    expect(choosePrimaryBot({ channelVertical: null, detector: dating, admins: [] })).toEqual({
      botId: "b_dating",
      reason: "detector",
    });
    expect(choosePrimaryBot({ channelVertical: "CASINO", detector: null, admins: [] })).toBeNull();
  });
  it("jamais un bot assistant de conversation (phase 17), même du bon univers ou détecteur", () => {
    const assistant = { id: "b_assistant", vertical: "DATING", mode: "ASSISTANT" };
    expect(
      choosePrimaryBot({
        channelVertical: "DATING",
        detector: assistant,
        admins: [assistant, sport],
      }),
    ).toEqual({ botId: "b_sport", reason: "first_admin" });
    expect(
      choosePrimaryBot({ channelVertical: "DATING", detector: assistant, admins: [assistant] }),
    ).toBeNull();
    expect(
      choosePrimaryBot({
        channelVertical: "DATING",
        detector: null,
        admins: [{ ...dating, mode: "STANDARD" }],
      }),
    ).toEqual({ botId: "b_dating", reason: "same_vertical" });
  });
});

describe("sameRights", () => {
  it("ignore l'ordre des clés et les droits faux ou absents", () => {
    expect(
      sameRights(
        { status: "administrator", can_invite_users: true, can_post_messages: false },
        { can_invite_users: true, status: "administrator" },
      ),
    ).toBe(true);
  });
  it("détecte un droit gagné, perdu ou un statut différent", () => {
    expect(
      sameRights({ status: "administrator", can_invite_users: true }, { status: "administrator" }),
    ).toBe(false);
    expect(
      sameRights({ status: "administrator" }, { status: "administrator", can_invite_users: true }),
    ).toBe(false);
    expect(sameRights({ status: "administrator" }, { status: "creator" })).toBe(false);
  });
  it("une valeur enregistrée illisible est différente de vrais droits", () => {
    expect(sameRights(null, { status: "administrator" })).toBe(false);
    expect(sameRights("x", {})).toBe(true);
  });
});
