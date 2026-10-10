import { describe, expect, it } from "vitest";
import { importOutcomeOf, importSummary, rightsMessage, rightsSummary } from "./rights-message";

const base = {
  channelId: "c1",
  title: "VIP",
  admins: [],
  revoked: [],
  status: "ok" as const,
  warning: null,
};
const admin = { botId: "b1", telegramBotId: 1n, username: "casinobot", rights: {} };

describe("messages de vérification des droits", () => {
  it("liste les bots administrateurs", () => {
    expect(rightsMessage({ ...base, admins: [admin] })).toBe(
      "Droits vérifiés pour « VIP » : @casinobot",
    );
  });
  it("signale l'absence de bot et les droits retirés", () => {
    expect(
      rightsMessage({
        ...base,
        status: "not_admin",
        revoked: ["sportbot"],
        warning: "Aucun de nos bots n'est administrateur de ce canal.",
      }),
    ).toBe(
      "Droits vérifiés pour « VIP » : aucun de nos bots n'est administrateur ; droits retirés : @sportbot",
    );
  });
  it("garde l'explication quand la vérification est impossible", () => {
    expect(
      rightsMessage({
        ...base,
        status: "unavailable",
        warning:
          "Vérification impossible pour le moment (réseau). Les droits enregistrés sont conservés.",
      }),
    ).toContain("Vérification impossible");
  });
  it("résume tous les canaux", () => {
    expect(rightsSummary([])).toBe("Droits vérifiés : aucun canal actif.");
    expect(
      rightsSummary([
        { ...base, admins: [admin] },
        { ...base, channelId: "c2", title: "Test", status: "not_admin", revoked: ["casinobot"] },
      ]),
    ).toBe(
      "Droits vérifiés sur 2 canaux ; sans bot administrateur : « Test » ; droits retirés : @casinobot sur « Test ».",
    );
  });
  it("un canal non vérifiable n'est pas annoncé « sans bot »", () => {
    expect(
      rightsSummary([
        { ...base, admins: [admin] },
        {
          ...base,
          channelId: "c2",
          title: "Lent",
          status: "unavailable",
          warning: "Vérification impossible pour le moment (réseau).",
        },
      ]),
    ).toBe(
      "Droits vérifiés sur 2 canaux ; tous ont au moins un bot administrateur ; 1 non vérifiable pour le moment (droits conservés, réessayez dans une minute).",
    );
  });
});

describe("résumé de l'import du compte", () => {
  it("« 12 canaux importés, 3 sans bot » au lieu d'une phrase par canal", () => {
    const outcomes = [
      ...Array.from({ length: 9 }, (_, i) => ({
        title: `C${i}`,
        created: true,
        withoutBot: false,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({ title: `S${i}`, created: true, withoutBot: true })),
    ];
    const r = importSummary(outcomes);
    expect(r.ok).toBe(
      "12 canaux importés, 3 sans bot : ajoutez un de nos bots comme administrateur dans Telegram, puis cliquez « Re-vérifier les droits des bots ».",
    );
    expect(r.error).toBeUndefined();
  });
  it("canaux non vérifiables (429, panne) : ni comptés « sans bot » ni conseil d'ajouter un bot", () => {
    const outcomes = [
      { title: "A", created: true, withoutBot: false },
      ...Array.from({ length: 4 }, (_, i) => ({
        title: `Lent${i}`,
        created: true,
        withoutBot: false,
        unverified: true,
      })),
    ];
    expect(importSummary(outcomes)).toEqual({
      ok: "5 canaux importés. 4 non vérifiables pour le moment : réessayez « Re-vérifier les droits des bots » dans une minute.",
    });
  });
  it("sans bot ET non vérifiable : les deux comptes, chacun avec son conseil", () => {
    expect(
      importSummary([
        { title: "S", created: true, withoutBot: true },
        { title: "L", created: true, withoutBot: false, unverified: true },
      ]),
    ).toEqual({
      ok: "2 canaux importés, 1 sans bot : ajoutez un de nos bots comme administrateur dans Telegram, puis cliquez « Re-vérifier les droits des bots ». 1 non vérifiable pour le moment : réessayez « Re-vérifier les droits des bots » dans une minute.",
    });
  });
  it("issue d'un import (statut de la re-vérification) : « sans bot » seulement si aucun de nos bots n'a accès", () => {
    const r = { title: "T", created: true, admins: [] };
    expect(importOutcomeOf({ ...r, status: "not_admin" })).toEqual({
      title: "T",
      created: true,
      withoutBot: true,
      unverified: false,
    });
    expect(importOutcomeOf({ ...r, status: "unavailable" })).toEqual({
      title: "T",
      created: true,
      withoutBot: false,
      unverified: true,
    });
    expect(importOutcomeOf({ ...r, status: "no_bot" }).unverified).toBe(true);
    expect(importOutcomeOf({ ...r, admins: [admin], status: "ok" })).toEqual({
      title: "T",
      created: true,
      withoutBot: false,
      unverified: false,
    });
  });
  it("un seul canal, déjà connu", () => {
    expect(importSummary([{ title: "A", created: false, withoutBot: false }])).toEqual({
      ok: "1 canal importé (dont 1 déjà connu, mis à jour).",
    });
  });
  it("import partiel : réussites ET échecs, liste courte des échecs", () => {
    const outcomes = [
      { title: "Bon", created: true },
      ...Array.from({ length: 7 }, (_, i) => ({
        title: `KO${i}`,
        error: "Telegram ne répond pas",
      })),
    ];
    const r = importSummary(outcomes);
    expect(r.ok).toBe("1 canal importé.");
    expect(r.error).toBe(
      "7 canaux non importés : « KO0 », « KO1 », « KO2 », « KO3 », « KO4 » et 2 autres (Telegram ne répond pas).",
    );
  });
});
