import { describe, expect, it } from "vitest";
import { profileErrorMessage, profileErrorNextStep, profileErrorReason } from "./profile-error";

describe("échec de la description du bot dans Telegram : jamais le texte technique", () => {
  it("limite de débit (429) : attendre quelques secondes, sans aucun mot anglais", () => {
    const err = new Error(
      "Call to 'setMyDescription' failed! (429: Too Many Requests: retry after 31)",
    );
    const m = profileErrorMessage("lea_bot", err);
    expect(m).toBe(
      "La description de @lea_bot n'a pas pu être posée dans Telegram : Telegram demande d'attendre quelques secondes. Réenregistrez dans un instant.",
    );
    expect(m).not.toMatch(/Call to|setMyDescription|Too Many|retry/);
  });

  it("réseau, jeton refusé, autre refus", () => {
    expect(profileErrorReason(new Error("Network request for 'setMyCommands' failed!"))).toBe(
      "Telegram ne répond pas pour l'instant",
    );
    const token = profileErrorMessage(
      "lea_bot",
      new Error("Call to 'setMyDescription' failed! (401: Unauthorized)"),
    );
    expect(token).toContain("Telegram refuse le jeton de ce bot");
    expect(token).toContain("« Ajouter un bot »");
    expect(
      profileErrorReason(new Error("Call to 'setMyDescription' failed! (400: Bad Request: x)")),
    ).toBe("Telegram a refusé la description");
    expect(profileErrorReason("bizarre")).toBe("Telegram a refusé la description");
  });

  it("refus de notre garde-fou : la phrase française est gardée", () => {
    const m = profileErrorMessage(
      "lea_bot",
      new Error(
        "Description du bot refusée : elle doit dire que c'est l'assistante ou l'assistant du canal.",
      ),
    );
    expect(m).toBe(
      "La description de @lea_bot n'a pas pu être posée dans Telegram : Description du bot refusée : elle doit dire que c'est l'assistante ou l'assistant du canal. Corrigez la description dans le bloc « Profil du bot » de la persona, puis réenregistrez.",
    );
  });
});

describe("suite à donner : réessayer seulement quand l'échec est passager", () => {
  it("jeton refusé : coller le nouveau jeton, quelle que soit la phrase de reprise", () => {
    const err = new Error("Call to 'setMyDescription' failed! (401: Unauthorized)");
    const next =
      "Collez le nouveau jeton avec « Ajouter un bot » (Réglages → Bots), puis réenregistrez.";
    expect(profileErrorNextStep(err)).toBe(next);
    expect(profileErrorNextStep(err, "Réessayez dans un instant.")).toBe(next);
  });

  it("description refusée par notre garde-fou : la corriger dans la persona", () => {
    const err = new Error("Description du bot refusée : elle doit dire que c'est l'assistante.");
    expect(profileErrorNextStep(err, "Réessayez dans un instant.")).toBe(
      "Corrigez la description dans le bloc « Profil du bot » de la persona, puis réenregistrez.",
    );
  });

  it("échec passager (réseau, 429, autre refus) : la phrase de reprise demandée", () => {
    expect(profileErrorNextStep(new Error("Network request for 'setMyCommands' failed!"))).toBe(
      "Réenregistrez dans un instant.",
    );
    expect(
      profileErrorNextStep(
        new Error("Call to 'setMyDescription' failed! (429: Too Many Requests: retry after 31)"),
        "Réessayez dans un instant.",
      ),
    ).toBe("Réessayez dans un instant.");
    expect(profileErrorNextStep("bizarre")).toBe("Réenregistrez dans un instant.");
  });

  it("le message complet de la fiche persona utilise la même suite", () => {
    const err = new Error("Call to 'setMyDescription' failed! (401: Unauthorized)");
    expect(profileErrorMessage("lea_bot", err).endsWith(profileErrorNextStep(err))).toBe(true);
  });
});
