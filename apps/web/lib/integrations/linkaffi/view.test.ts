import { describe, expect, it } from "vitest";
import { linkaffiConnectionStatus } from "./view";

/** Pastille et phrase de l'état de la connexion des campagnes Telegram des affiliés. */
describe("état de la connexion", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  const base = {
    keyPrefix: "lap_live_abcd…",
    hasSecret: true,
    lastApiCallAt: null as Date | null,
    queue: { stuck: false },
  };
  it("il manque une valeur : à brancher, en disant laquelle", () => {
    expect(
      linkaffiConnectionStatus({ ...base, keyPrefix: null, hasSecret: false }, now),
    ).toMatchObject({
      tone: "warning",
      label: "À brancher",
      sentence: expect.stringMatching(/la clé de connexion et le secret de signature/),
    });
    expect(linkaffiConnectionStatus({ ...base, hasSecret: false }, now).sentence).toMatch(
      /^Générez le secret de signature/,
    );
  });
  it("valeurs prêtes, aucun appel : en attente de Link Affi", () => {
    expect(linkaffiConnectionStatus(base, now)).toMatchObject({ tone: "info" });
  });
  it("appel reçu : branché, avec l'heure du dernier appel", () => {
    expect(
      linkaffiConnectionStatus({ ...base, lastApiCallAt: new Date("2026-10-14T09:57:00Z") }, now),
    ).toEqual({
      tone: "success",
      label: "Branché",
      sentence: "Link Affi nous a appelés il y a 3 min.",
    });
  });
  it("file bloquée depuis plus d'une heure : en rouge", () => {
    expect(
      linkaffiConnectionStatus({ ...base, lastApiCallAt: now, queue: { stuck: true } }, now),
    ).toMatchObject({ tone: "danger", label: "Envois bloqués" });
  });
});
