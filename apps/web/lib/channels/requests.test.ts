import { describe, expect, it } from "vitest";
import {
  memberHandle,
  memberName,
  membersSummary,
  remaining,
  requestNext,
  requestsTabLabel,
  sourceHint,
  sourceLabel,
  trackedMembersLabel,
} from "./requests";

const now = new Date("2026-10-10T12:00:00Z");
const inS = (s: number) => new Date(now.getTime() + s * 1000);

describe("demandes d'un canal", () => {
  it("temps restant avant l'acceptation", () => {
    expect(remaining(null, now)).toBe("—");
    expect(remaining(inS(-5), now)).toBe("imminent");
    expect(remaining(inS(45), now)).toBe("45 s");
    expect(remaining(inS(600), now)).toBe("10 min");
    expect(remaining(inS(3 * 3600), now)).toBe("3 h");
    expect(remaining(inS(2 * 86400), now)).toBe("2 j");
  });

  it("ce qui va se passer, en une phrase", () => {
    expect(requestNext("SCHEDULED", inS(600), now)).toBe("Acceptée dans 10 min");
    expect(requestNext("SCHEDULED", inS(-1), now)).toBe("Acceptée dans un instant");
    expect(requestNext("PENDING_GATE", null, now)).toBe(
      "Acceptée toute seule une fois les canaux rejoints",
    );
    expect(requestNext("REQUESTED", null, now)).toBe("À valider à la main");
    expect(requestNext("FAILED", null, now)).toBe("Réessayez « Accepter » ou refusez la demande");
    expect(requestNext("APPROVED", null, now)).toBe("—");
  });

  it("la phrase dit la suite, sans répéter la pastille d'état (« Attente canaux requis », « Échec »)", () => {
    expect(requestNext("PENDING_GATE", null, now)).not.toMatch(/attend/i);
    expect(requestNext("FAILED", null, now)).not.toMatch(/échou|échec/i);
  });

  it("origine d'une adhésion", () => {
    expect(
      sourceLabel({ inviteLink: { name: "Pub TikTok 1", adPlatform: "TIKTOK" } }, () => "TikTok"),
    ).toBe("Pub TikTok 1 (TikTok)");
    expect(sourceLabel({ inviteLink: { name: "Lien manuel", adPlatform: null } })).toBe(
      "Lien manuel",
    );
    expect(sourceLabel({ joinedDirectly: true })).toBe("Entrée directe");
    // Pas un lien d'entrée créé ici : rien ne ressemble à une panne.
    expect(sourceLabel(null)).toBe("Sans lien suivi");
    expect(sourceLabel({ inviteLink: null, telegramInviteLink: "https://t.me/+abc" })).toBe(
      "Sans lien suivi",
    );
  });

  it("explication de l'origine dans le volet de détail, seulement quand le lien n'est pas suivi", () => {
    expect(sourceHint({ inviteLink: { name: "Pub TikTok 1" } })).toBeNull();
    expect(sourceHint({ joinedDirectly: true })).toBeNull();
    expect(sourceHint(null)).toMatch(/lien d'invitation qui n'a pas été créé ici/);
  });

  it("résumé des membres de l'onglet : présents, puis partis et exclus s'il y en a", () => {
    expect(membersSummary({ present: 65, left: 12, kicked: 1 })).toBe(
      "65 membres présents · 12 partis · 1 exclu",
    );
    expect(membersSummary({ present: 1, left: 0, kicked: 0 })).toBe("1 membre présent");
    expect(membersSummary({ present: 0, left: 1, kicked: 2 })).toBe(
      "0 membre présent · 1 parti · 2 exclus",
    );
    expect(membersSummary({ present: 1200, left: 0, kicked: 0 })).toBe(
      "1\u202f200 membres présents",
    );
  });

  it("nom d'un membre", () => {
    expect(memberName({ firstName: "Léa", lastName: "M.", username: "lea" })).toBe("Léa M.");
    expect(memberName({ firstName: null, lastName: null, username: "lea" })).toBe("@lea");
    expect(memberName({ firstName: null, lastName: null })).toBe("Membre sans nom");
  });

  it("@nom sous le nom, jamais l'identifiant Telegram brut", () => {
    expect(memberHandle({ firstName: "Léa", lastName: null, username: "lea" })).toBe("@lea");
    // Le nom affiché est déjà le @nom : pas de répétition.
    expect(memberHandle({ firstName: null, lastName: null, username: "lea" })).toBeNull();
    expect(memberHandle({ firstName: "Léa", lastName: null, username: null })).toBeNull();
    expect(memberHandle({ firstName: null, lastName: null, username: null })).toBeNull();
  });

  it("membres suivis (pas le nombre d'abonnés du canal)", () => {
    expect(trackedMembersLabel(0)).toBe("0 membre suivi");
    expect(trackedMembersLabel(1)).toBe("1 membre suivi");
    expect(trackedMembersLabel(1234)).toBe(`${(1234).toLocaleString("fr-FR")} membres suivis`);
  });

  it("libellé de l'onglet pour les lecteurs d'écran", () => {
    expect(requestsTabLabel(3)).toBe("Demandes, 3 en attente");
    expect(requestsTabLabel(0)).toBe("Demandes, aucune en attente");
  });
});
