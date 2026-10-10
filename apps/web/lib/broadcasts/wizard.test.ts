import { describe, expect, it } from "vitest";
import { toParisLocalInput } from "@/lib/posts/time";
import {
  WIZARD_STEPS,
  abSplitSentence,
  confirmSendMessage,
  finalIntent,
  filledRows,
  finalLabel,
  firstInvalidStep,
  plainText,
  rangeFillPercent,
  scheduleErrors,
  suggestName,
  validateStep,
  whenSentence,
  type WizardDraft,
} from "./wizard";

const now = new Date("2026-10-10T10:00:00Z");
const inOneHour = toParisLocalInput(new Date(now.getTime() + 3_600_000));
const base: WizardDraft = {
  botId: "bot1",
  name: "Bonus du week-end",
  text: "Bonjour <b>à tous</b>",
  buttons: [],
  ab: { enabled: false, textB: "", buttonsB: [] },
  when: "now",
  scheduledAt: inOneHour,
};

describe("étapes de l'assistant", () => {
  it("trois étapes : Qui, Quoi, Quand, chacune avec une ligne d'aide", () => {
    expect(WIZARD_STEPS.map((s) => s.title)).toEqual(["Qui", "Quoi", "Quand"]);
    for (const s of WIZARD_STEPS) expect(s.help.length).toBeGreaterThan(20);
  });

  it("Qui : le bot expéditeur est obligatoire", () => {
    expect(validateStep("who", base, now)).toEqual([]);
    expect(validateStep("who", { ...base, botId: "" }, now)).toEqual([
      "Choisissez le bot qui envoie le message.",
    ]);
  });

  it("Qui : un critère ajouté mais pas réglé bloque, avec une consigne par critère", () => {
    expect(
      validateStep("who", { ...base, pendingCriteria: ["inactiveDays", "languages"] }, now),
    ).toEqual([
      "«\u00a0Rien fait depuis\u00a0» : choisissez une durée, ou retirez ce critère.",
      "«\u00a0Langue de leur Telegram\u00a0» : cochez au moins une langue, ou retirez ce critère.",
    ]);
    expect(
      validateStep("who", { ...base, botId: "", pendingCriteria: ["tags"] }, now),
    ).toHaveLength(2);
    expect(validateStep("who", { ...base, pendingCriteria: [] }, now)).toEqual([]);
    // Toute action finale (brouillon compris) renvoie à l'étape Qui.
    expect(
      firstInvalidStep("draft", { ...base, pendingCriteria: ["inactiveDays"] }, now)?.step,
    ).toBe(0);
  });

  it("Quoi : texte présent et accepté par Telegram", () => {
    expect(validateStep("what", base, now)).toEqual([]);
    expect(validateStep("what", { ...base, text: "   " }, now)).toEqual([
      "Écrivez le texte du message.",
    ]);
    const bad = validateStep("what", { ...base, text: "<script>x</script>" }, now);
    expect(bad[0]).toMatch(/^Texte du message : Balise <script> non acceptée/);
  });

  it("Quoi : boutons complets (libellé, adresse en https, campagne d'une offre)", () => {
    expect(
      validateStep(
        "what",
        {
          ...base,
          buttons: [
            [
              { text: "Site", type: "URL", url: "http://ok.example" },
              { text: "", type: "URL", url: "" },
            ],
          ],
        },
        now,
      ),
    ).toEqual([]);
    expect(
      validateStep(
        "what",
        { ...base, buttons: [[{ text: "Site", type: "URL", url: "ftp://x" }]] },
        now,
      ),
    ).toEqual(["Boutons : bouton « Site » : l'adresse doit commencer par https://."]);
    expect(
      validateStep(
        "what",
        { ...base, buttons: [[{ text: "", type: "URL", url: "https://x" }]] },
        now,
      ),
    ).toEqual(["Boutons : donnez un libellé à chaque bouton, ou retirez-le."]);
    expect(
      validateStep("what", { ...base, buttons: [[{ text: "Jouer", type: "OFFER" }]] }, now),
    ).toEqual(["Boutons : bouton « Jouer » : choisissez une campagne."]);
    expect(
      validateStep(
        "what",
        { ...base, buttons: [[{ text: "Jouer", type: "OFFER", campaignId: "k1" }]] },
        now,
      ),
    ).toEqual([]);
  });

  it("Quoi : test A/B, la version B doit être écrite", () => {
    const ab = { ...base, ab: { enabled: true, textB: "", buttonsB: [] } };
    expect(validateStep("what", ab, now)).toEqual(["Écrivez le texte de la version B."]);
    expect(validateStep("what", { ...ab, text: "", ab: { ...ab.ab, textB: "B" } }, now)).toEqual([
      "Écrivez le texte de la version A.",
    ]);
    expect(
      validateStep(
        "what",
        {
          ...ab,
          ab: { enabled: true, textB: "B", buttonsB: [[{ text: "Go", type: "BUTTON", url: "x" }]] },
        },
        now,
      ),
    ).toEqual(["Version B : bouton « Go » : l'adresse doit commencer par https://."]);
  });

  it("Quand : nom et date dans le futur (heure de Paris)", () => {
    expect(validateStep("when", base, now)).toEqual([]);
    expect(validateStep("when", { ...base, name: " " }, now)).toEqual(["Donnez un nom à l'envoi."]);
    expect(validateStep("when", { ...base, name: "x".repeat(121) }, now)).toEqual([
      "Le nom est trop long (120 caractères au plus).",
    ]);
    expect(validateStep("when", { ...base, when: "later" }, now)).toEqual([]);
    expect(validateStep("when", { ...base, when: "later", scheduledAt: "" }, now)).toEqual([
      "Choisissez la date et l'heure d'envoi.",
    ]);
    const past = toParisLocalInput(new Date(now.getTime() - 3_600_000));
    expect(scheduleErrors(past, now)).toEqual(["Choisissez une date et une heure dans le futur."]);
    // « Maintenant » : la date n'est pas vérifiée.
    expect(validateStep("when", { ...base, when: "now", scheduledAt: past }, now)).toEqual([]);
  });

  it("action finale : renvoie à la première étape à corriger", () => {
    expect(firstInvalidStep("now", base, now)).toBeNull();
    expect(firstInvalidStep("draft", { ...base, botId: "", text: "" }, now)).toEqual({
      step: 0,
      errors: ["Choisissez le bot qui envoie le message."],
    });
    expect(firstInvalidStep("now", { ...base, text: "" }, now)?.step).toBe(1);
    // Programmer exige une date même si « Maintenant » était choisi ; le brouillon, non.
    expect(firstInvalidStep("schedule", { ...base, scheduledAt: "" }, now)?.step).toBe(2);
    expect(firstInvalidStep("draft", { ...base, when: "later", scheduledAt: "" }, now)).toBeNull();
  });

  it("boutons enregistrés : sans ceux laissés sans libellé", () => {
    expect(
      filledRows([
        [
          { text: "Jouer", type: "URL", url: "https://a" },
          { text: " ", type: "URL" },
        ],
        [{ text: "", type: "OFFER" }],
      ]),
    ).toEqual([[{ text: "Jouer", type: "URL", url: "https://a" }]]);
  });

  it("curseur de la part A : remplissage de la piste en pourcentage, borné", () => {
    expect(rangeFillPercent(50, 10, 90)).toBe(50);
    expect(rangeFillPercent(10, 10, 90)).toBe(0);
    expect(rangeFillPercent(90, 10, 90)).toBe(100);
    expect(rangeFillPercent(30, 10, 90)).toBe(25);
    expect(rangeFillPercent(200, 10, 90)).toBe(100);
    expect(rangeFillPercent(0, 10, 90)).toBe(0);
    expect(rangeFillPercent(5, 5, 5)).toBe(0);
  });

  it("bouton final selon « Quand »", () => {
    expect(finalIntent("now")).toBe("now");
    expect(finalIntent("later")).toBe("schedule");
    expect(finalLabel("now")).toBe("Envoyer");
    expect(finalLabel("later")).toBe("Programmer");
  });
});

describe("textes du récapitulatif", () => {
  it("nom proposé : début du texte sans mise en forme, sinon la date", () => {
    expect(plainText("Salut <b>toi</b> &amp; les autres\n\n🎁")).toBe("Salut toi & les autres 🎁");
    expect(suggestName("Bonjour <b>à tous</b>", now)).toBe("Bonjour à tous");
    expect(
      suggestName(
        "Ce week-end seulement, votre bonus de bienvenue est doublé sur tous les jeux du casino",
        now,
      ),
    ).toBe("Ce week-end seulement, votre bonus de bienvenue…");
    expect(suggestName("", now)).toBe("Message du 10/10/2026");
  });

  it("quand : maintenant ou date en toutes lettres (heure de Paris)", () => {
    expect(whenSentence("now", "")).toBe("Tout de suite, dès votre confirmation.");
    expect(whenSentence("later", "2026-10-11T18:00")).toBe(
      "Le dimanche 11 octobre 2026 à 18:00 (heure de Paris).",
    );
    expect(whenSentence("later", "")).toBe("Date et heure à choisir.");
  });

  it("confirmation de l'envoi immédiat et part du test A/B", () => {
    expect(abSplitSentence(30)).toBe("Version A : 30 % du groupe · version B : 70 %");
    expect(confirmSendMessage(1, { enabled: false, split: 50 })).toBe(
      "Le message va partir maintenant à 1 membre. Une fois parti, un message ne peut pas être rappelé.",
    );
    expect(confirmSendMessage(null, { enabled: false, split: 50 })).toMatch(
      /tous les membres du groupe qui peuvent le recevoir/,
    );
    expect(confirmSendMessage(12, { enabled: true, split: 40 })).toBe(
      "Les deux versions vont partir maintenant à 12 membres (version A : 40 %, version B : 60 %). Une fois parti, un message ne peut pas être rappelé.",
    );
  });
});
