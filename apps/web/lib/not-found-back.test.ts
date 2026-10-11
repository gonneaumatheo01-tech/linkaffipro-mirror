import { describe, expect, it } from "vitest";
import { NOT_FOUND_HOME, notFoundBack } from "./not-found-back";

describe("page introuvable : retour vers la rubrique", () => {
  it("une fiche supprimée ramène à la liste de sa rubrique", () => {
    expect(notFoundBack("/campaigns/inexistant-0000")).toEqual({
      href: "/campaigns",
      label: "Retour aux campagnes",
    });
    expect(notFoundBack("/members/inexistant-0000")).toEqual({
      href: "/members",
      label: "Retour aux membres",
    });
    expect(notFoundBack("/channels/abc/")).toMatchObject({ href: "/channels" });
    expect(notFoundBack("/messages/abc/edit")).toMatchObject({ href: "/messages" });
    expect(notFoundBack("/settings/connectors/x")).toMatchObject({ href: "/settings" });
  });

  it("la rubrique la plus précise l'emporte", () => {
    expect(notFoundBack("/members/broadcasts/b1")).toMatchObject({ href: "/members/broadcasts" });
    expect(notFoundBack("/members/automations/r1")).toMatchObject({
      href: "/members/automations",
    });
    expect(notFoundBack("/campaigns/links/l1")).toMatchObject({ href: "/campaigns/links" });
  });

  it("la rubrique elle-même ou une adresse inconnue : retour à l'accueil (pas de boucle)", () => {
    expect(notFoundBack("/campaigns")).toEqual(NOT_FOUND_HOME);
    expect(notFoundBack("/campaignsx/1")).toEqual(NOT_FOUND_HOME);
    expect(notFoundBack("/")).toEqual(NOT_FOUND_HOME);
    expect(notFoundBack(null)).toEqual(NOT_FOUND_HOME);
    expect(NOT_FOUND_HOME.label).toBe("Retour à l'accueil");
  });
});
