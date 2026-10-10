import { describe, expect, it } from "vitest";
import {
  accountLock,
  accountLockSentence,
  emailBreakParts,
  INVITATION_KIND_LABELS,
  invitationKind,
  teamSummary,
} from "./team-view";

const admin = (id: string, isActive = true) => ({ id, role: "ADMIN", isActive });
const manager = (id: string, isActive = true) => ({ id, role: "MANAGER", isActive });

describe("Réglages → Équipe : garde-fous affichés", () => {
  it("son propre compte est verrouillé, quel que soit le nombre d'administrateurs", () => {
    expect(accountLock(admin("me"), "me", 3)).toBe("self");
    expect(accountLock(manager("me"), "me", 1)).toBe("self");
  });

  it("le dernier administrateur actif est verrouillé ; un autre administrateur ou un manager ne l'est pas", () => {
    expect(accountLock(admin("a"), "me", 1)).toBe("lastAdmin");
    expect(accountLock(admin("a"), "me", 2)).toBeNull();
    expect(accountLock(admin("a", false), "me", 1)).toBeNull();
    expect(accountLock(manager("m"), "me", 1)).toBeNull();
  });

  it("chaque verrou a une phrase claire, aucune phrase sans verrou", () => {
    expect(accountLockSentence("self")).toMatch(/votre compte/);
    expect(accountLockSentence("lastAdmin")).toMatch(/Dernier administrateur actif/);
    expect(accountLockSentence(null)).toBeNull();
  });
});

describe("Réglages → Équipe : invitations et résumé", () => {
  it("une invitation vers une adresse connue est un nouveau mot de passe", () => {
    const known = new Set(["lea@exemple.fr"]);
    expect(invitationKind("lea@exemple.fr", known)).toBe("reset");
    expect(invitationKind("max@exemple.fr", known)).toBe("new");
    expect(INVITATION_KIND_LABELS.reset).toBe("Nouveau mot de passe");
  });

  it("résumé de l'équipe au singulier et au pluriel", () => {
    expect(teamSummary([])).toBe("Aucun compte");
    expect(teamSummary([{ isActive: true }])).toBe("1 compte, actif");
    expect(teamSummary([{ isActive: true }, { isActive: true }])).toBe("2 comptes, tous actifs");
    expect(teamSummary([{ isActive: true }, { isActive: false }, { isActive: false }])).toBe(
      "3 comptes, dont 1 actif",
    );
  });
});

describe("Réglages → Équipe : e-mail lisible sur téléphone", () => {
  it("coupure avant « @ » : le nom de domaine n'est jamais coupé", () => {
    expect(emailBreakParts("gonneaumatheo.business@gmail.com")).toEqual([
      "gonneaumatheo.business",
      "@gmail.com",
    ]);
  });

  it("le dernier « @ » sépare le domaine", () => {
    expect(emailBreakParts('"a@b"@exemple.fr')).toEqual(['"a@b"', "@exemple.fr"]);
  });

  it("adresse sans « @ » ou qui commence par « @ » : pas de coupure", () => {
    expect(emailBreakParts("sans-arobase")).toEqual(["sans-arobase"]);
    expect(emailBreakParts("@exemple.fr")).toEqual(["@exemple.fr"]);
  });
});
