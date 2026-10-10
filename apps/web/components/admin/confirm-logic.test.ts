import { describe, expect, it } from "vitest";
import { confirmSubmitDefaults, confirmTriggerAria, submitFromOpener } from "./confirm-logic";
import { modifiedLabel } from "./form-section";

describe("ConfirmSubmit : valeurs par défaut de la boîte de confirmation", () => {
  it("reprend le libellé du bouton pour le titre et le bouton de confirmation", () => {
    expect(confirmSubmitDefaults({ children: "Supprimer" })).toEqual({
      title: "Supprimer ?",
      confirmLabel: "Supprimer",
      destructive: false,
    });
  });

  it("a un repli quand le bouton n'a pas de texte (icône)", () => {
    expect(confirmSubmitDefaults({ children: null })).toEqual({
      title: "Confirmer cette action ?",
      confirmLabel: "Confirmer",
      destructive: false,
    });
  });

  it("respecte un titre et un libellé fournis", () => {
    const d = confirmSubmitDefaults({
      children: "Envoyer",
      confirmTitle: "Envoyer à 1 240 membres ?",
      confirmLabel: "Oui, envoyer",
    });
    expect(d.title).toBe("Envoyer à 1 240 membres ?");
    expect(d.confirmLabel).toBe("Oui, envoyer");
  });

  it("reconnaît une action destructive (variante ou texte rouge)", () => {
    expect(confirmSubmitDefaults({ children: "x", variant: "destructive" }).destructive).toBe(true);
    expect(
      confirmSubmitDefaults({ children: "x", className: "text-destructive max-md:h-10" })
        .destructive,
    ).toBe(true);
    expect(confirmSubmitDefaults({ children: "x", className: "text-danger" }).destructive).toBe(
      true,
    );
    expect(
      confirmSubmitDefaults({ children: "x", variant: "outline", className: "max-md:h-10" })
        .destructive,
    ).toBe(false);
    // Une classe calculée (fonction) n'est pas lue.
    expect(
      confirmSubmitDefaults({ children: "x", className: () => "text-danger" }).destructive,
    ).toBe(false);
    // Choix explicite prioritaire.
    expect(
      confirmSubmitDefaults({ children: "x", variant: "destructive", destructive: false })
        .destructive,
    ).toBe(false);
  });
});

describe("bloc « Avancé »", () => {
  it("compte les réglages modifiés au singulier et au pluriel", () => {
    expect(modifiedLabel(1)).toBe("1 réglage modifié");
    expect(modifiedLabel(3)).toBe("3 réglages modifiés");
  });
});

/** Faux formulaire : note chaque envoi et le bouton qui l'a déclenché (comme `SubmitEvent.submitter`). */
function fakeForm() {
  const sent: Array<{ submitter: unknown }> = [];
  return {
    sent,
    form: {
      requestSubmit(submitter?: unknown) {
        sent.push({ submitter });
      },
    },
  };
}

describe("ConfirmDialog : envoi du formulaire après confirmation", () => {
  it("envoie une seule fois, avec le bouton qui a ouvert la boîte (name, value et formAction conservés)", () => {
    const { form, sent } = fakeForm();
    const button = { type: "submit", name: "intent", value: "now", form };
    expect(submitFromOpener(button)).toBe(true);
    expect(sent).toEqual([{ submitter: button }]);
  });

  it("un bouton type=button envoie le formulaire sans « submitter »", () => {
    const { form, sent } = fakeForm();
    expect(submitFromOpener({ type: "button", form })).toBe(true);
    expect(sent).toEqual([{ submitter: undefined }]);
  });

  it("n'envoie rien sans formulaire (lien, bouton hors formulaire, rien d'ouvert)", () => {
    expect(submitFromOpener({ type: "submit", form: null })).toBe(false);
    expect(submitFromOpener({ href: "/x" })).toBe(false);
    expect(submitFromOpener(null)).toBe(false);
    expect(submitFromOpener(undefined)).toBe(false);
  });

  it("le déclencheur annonce qu'il ouvre une boîte de dialogue, et si elle est ouverte", () => {
    expect(confirmTriggerAria({}, false)).toEqual({
      "aria-haspopup": "dialog",
      "aria-expanded": false,
    });
    expect(confirmTriggerAria({}, true)["aria-expanded"]).toBe(true);
    // Une valeur fournie par l'appelant n'est pas écrasée.
    expect(confirmTriggerAria({ "aria-haspopup": "true", "aria-expanded": true }, false)).toEqual({
      "aria-haspopup": "true",
      "aria-expanded": true,
    });
  });
});
