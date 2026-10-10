import { describe, expect, it } from "vitest";
import { rightsMessage, rightsSummary } from "./rights-message";

const base = { channelId: "c1", title: "VIP", admins: [], revoked: [], warning: null };
const admin = { botId: "b1", telegramBotId: 1n, username: "casinobot", rights: {} };

describe("messages de vérification des droits", () => {
  it("liste les bots administrateurs", () => {
    expect(rightsMessage({ ...base, admins: [admin] })).toBe("Droits vérifiés pour « VIP » : @casinobot");
  });
  it("signale l'absence de bot et les droits retirés", () => {
    expect(rightsMessage({ ...base, revoked: ["sportbot"], warning: "Aucun de nos bots n'est administrateur de ce canal." })).toBe(
      "Droits vérifiés pour « VIP » : aucun de nos bots n'est administrateur ; droits retirés : @sportbot",
    );
  });
  it("garde l'explication quand la vérification est impossible", () => {
    expect(rightsMessage({ ...base, warning: "Vérification impossible pour le moment (réseau). Les droits enregistrés sont conservés." })).toContain("Vérification impossible");
  });
  it("résume tous les canaux", () => {
    expect(rightsSummary([])).toBe("Droits vérifiés : aucun canal actif.");
    expect(rightsSummary([{ ...base, admins: [admin] }, { ...base, channelId: "c2", title: "Test", revoked: ["casinobot"] }])).toBe(
      "Droits vérifiés sur 2 canaux ; sans bot administrateur : « Test » ; droits retirés : @casinobot sur « Test ».",
    );
  });
});
