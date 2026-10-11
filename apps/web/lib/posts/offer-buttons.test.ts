import { describe, expect, it } from "vitest";
import {
  isOfferToChoose,
  offerButtonIssues,
  offerIssuesSummary,
  rowsToVerify,
  templateOfferButton,
} from "./offer-buttons";
import type { PostButtonRow } from "./buttons";

const toChoose = { text: "🎁 J'en profite", type: "OFFER" as const };
const complete = {
  text: "Jouer",
  type: "OFFER" as const,
  campaignId: "camp1",
  affiliateCampaignId: "aff1",
};
const site = { text: "Site", type: "URL" as const, url: "https://example.org" };

describe("modèle : bouton Offre dont la campagne se choisit à l'utilisation", () => {
  it("un bouton Offre sans campagne ou sans offre est « à choisir » ; un bouton complet ne l'est pas", () => {
    expect(isOfferToChoose(toChoose)).toBe(true);
    expect(isOfferToChoose({ ...toChoose, campaignId: "camp1" })).toBe(true);
    // Ancien bouton (offre sans campagne) : un nouveau message exige une campagne.
    expect(isOfferToChoose({ ...toChoose, affiliateCampaignId: "aff1" })).toBe(true);
    expect(isOfferToChoose(complete)).toBe(false);
    expect(isOfferToChoose(site)).toBe(false);
  });

  it("modèle : les boutons Offre à choisir ne passent pas par la vérification des campagnes", () => {
    const rows: PostButtonRow[] = [[toChoose, site], [complete], [toChoose]];
    expect(rowsToVerify(rows, true)).toEqual([[site], [complete]]);
    // Message réel : tout est vérifié (le bouton sans campagne sera refusé).
    expect(rowsToVerify(rows, false)).toEqual(rows);
  });

  it("bouton gardé dans le modèle : libellé, et la campagne si elle est déjà choisie ; jamais de lien", () => {
    expect(templateOfferButton({ ...toChoose, trackingLinkId: "tl1", slug: "abc" })).toEqual({
      text: "🎁 J'en profite",
      type: "OFFER",
    });
    expect(templateOfferButton({ ...toChoose, campaignId: "camp1" })).toEqual({
      text: "🎁 J'en profite",
      type: "OFFER",
      campaignId: "camp1",
    });
    expect(templateOfferButton({ ...toChoose, affiliateCampaignId: "aff-old" })).toEqual({
      text: "🎁 J'en profite",
      type: "OFFER",
    });
  });
});

describe("message : bouton Offre à compléter signalé avant l'envoi du formulaire", () => {
  it("campagne non choisie, ou campagne à plusieurs offres sans offre : signalé à sa place", () => {
    const issues = offerButtonIssues([
      [site, toChoose],
      [complete, { ...toChoose, campaignId: "c2" }],
    ]);
    expect(issues).toEqual([
      {
        version: "A",
        row: 0,
        col: 1,
        text: "🎁 J'en profite",
        message: "Choisissez la campagne de ce bouton Offre.",
      },
      {
        version: "A",
        row: 1,
        col: 1,
        text: "🎁 J'en profite",
        message: "Choisissez l'offre de la campagne pour ce bouton.",
      },
    ]);
  });

  it("version B : signalée comme telle", () => {
    expect(offerButtonIssues([[toChoose]], { version: "B" })[0]).toMatchObject({
      version: "B",
      row: 0,
      col: 0,
    });
  });

  it("ancien bouton déjà enregistré (offre sans campagne, lien existant) : accepté comme au serveur", () => {
    expect(
      offerButtonIssues([[{ ...toChoose, affiliateCampaignId: "aff1", trackingLinkId: "tl1" }]]),
    ).toEqual([]);
    // Copie d'un ancien bouton (lien retiré à la copie) : une campagne est exigée.
    expect(offerButtonIssues([[{ ...toChoose, affiliateCampaignId: "aff1" }]])).toHaveLength(1);
  });

  it("enregistré comme modèle : rien à signaler (la campagne se choisit en utilisant le modèle)", () => {
    expect(offerButtonIssues([[toChoose]], { template: true })).toEqual([]);
  });

  it("boutons complets ou sans offre : rien à signaler", () => {
    expect(offerButtonIssues([[complete, site]])).toEqual([]);
    expect(offerButtonIssues([])).toEqual([]);
  });

  it("phrase d'alerte près du bouton d'enregistrement, en français simple", () => {
    expect(offerIssuesSummary([])).toBeNull();
    const one = offerButtonIssues([[toChoose]]);
    expect(offerIssuesSummary(one)).toBe(
      "Choisissez la campagne du bouton « 🎁 J'en profite » (bloc Boutons) : c'est elle qui donne le lien de l'offre. Votre texte est gardé.",
    );
    const two = [...one, ...offerButtonIssues([[{ ...toChoose, text: "" }]], { version: "B" })];
    expect(offerIssuesSummary(two)).toBe(
      "Choisissez la campagne des boutons « 🎁 J'en profite » et « Offre » (bloc Boutons) : c'est elle qui donne le lien de l'offre. Votre texte est gardé.",
    );
  });
});
