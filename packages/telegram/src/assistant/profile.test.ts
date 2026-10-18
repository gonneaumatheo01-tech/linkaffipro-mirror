import { describe, expect, it } from "vitest";
import {
  BOT_DESCRIPTION_MAX,
  BOT_SHORT_DESCRIPTION_MAX,
  assistantProfilePlan,
  mentionsAssistant,
  personaChatLangs,
} from "./profile";
import { cachedBotMatches } from "../factory";

const lea = {
  name: "Léa",
  gender: "F",
  languages: ["fr", "en"],
  botDescription: null,
  botShortDescription: null,
};

describe("profil Telegram d'un bot assistant", () => {
  it("par défaut : dit « l'assistante du canal » et « une IA », dans chaque langue de la persona", () => {
    const plan = assistantProfilePlan(lea);
    expect(plan.languages).toEqual(["fr", "en"]);
    // Valeur par défaut (sans langue) dans la première langue, puis une entrée par langue.
    expect(plan.entries.map((e) => e.languageCode)).toEqual([null, "fr", "en"]);
    const [def, fr, en] = plan.entries;
    expect(def!.description).toBe(fr!.description);
    expect(fr!.description).toContain("Moi c'est Léa, l'assistante du canal : une IA");
    expect(fr!.shortDescription).toBe("Léa, l'assistante du canal (une IA)");
    expect(en!.description).toContain("I'm Léa, the assistant of the channel: an AI");
    for (const e of plan.entries) {
      expect(mentionsAssistant(e.description)).toBe(true);
      expect(mentionsAssistant(e.shortDescription)).toBe(true);
      expect(e.description.length).toBeLessThanOrEqual(BOT_DESCRIPTION_MAX);
      expect(e.shortDescription.length).toBeLessThanOrEqual(BOT_SHORT_DESCRIPTION_MAX);
    }
    expect(fr!.commands).toEqual([
      { command: "start", description: "Commencer la conversation" },
      { command: "stop", description: "Arrêter la conversation" },
      { command: "reset", description: "Tout effacer et recommencer" },
    ]);
    expect(en!.commands.map((c) => c.description)).toEqual([
      "Start the conversation",
      "Stop the conversation",
      "Erase everything and start over",
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("persona masculine et autres langues : « l'assistant », « el asistente », « der Assistent »", () => {
    const plan = assistantProfilePlan({
      ...lea,
      name: "Hugo",
      gender: "M",
      languages: ["es", "de", "it", "pt"],
    });
    const byLang = Object.fromEntries(
      plan.entries.filter((e) => e.languageCode).map((e) => [e.languageCode, e]),
    );
    expect(byLang.es!.description).toContain("Soy Hugo, el asistente del canal");
    expect(byLang.de!.description).toContain("Ich bin Hugo, der Assistent des Kanals");
    expect(byLang.it!.shortDescription).toBe("Hugo, l'assistente del canale (un'IA)");
    expect(byLang.pt!.shortDescription).toBe("Hugo, o assistente do canal (uma IA)");
    for (const e of plan.entries) expect(mentionsAssistant(e.description)).toBe(true);
  });

  it("textes de la fiche : gardés s'ils disent « assistante », pour la première langue et par défaut", () => {
    const plan = assistantProfilePlan({
      ...lea,
      botDescription: "Je suis Léa, l'assistante virtuelle du canal Rencontres. Écris-moi !",
      botShortDescription: "Léa, assistante du canal",
    });
    expect(plan.entries[0]!.description).toBe(
      "Je suis Léa, l'assistante virtuelle du canal Rencontres. Écris-moi !",
    );
    expect(plan.entries[1]!.shortDescription).toBe("Léa, assistante du canal");
    // Les autres langues gardent le texte traduit par défaut.
    expect(plan.entries[2]!.description).toContain("the assistant");
    expect(plan.warnings).toEqual([]);
  });

  it("garde-fou : un texte qui ne dit pas « assistant(e) » ou trop long est refusé (texte par défaut)", () => {
    const plan = assistantProfilePlan({
      ...lea,
      botDescription: "Coucou c'est Léa, 24 ans, viens discuter avec moi 😘",
      botShortDescription: `Léa, l'assistante ${"x".repeat(130)}`,
    });
    expect(plan.entries[0]!.description).toContain("l'assistante du canal : une IA");
    expect(plan.entries[0]!.shortDescription).toBe("Léa, l'assistante du canal (une IA)");
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings[0]).toMatch(/refusée/);
    expect(plan.warnings[1]).toMatch(/trop longue/);
  });

  it("langues : seulement les 6 du bot, sans doublon, français si aucune", () => {
    expect(personaChatLangs(["fr", "FR", "ru", "pt-BR"])).toEqual(["fr", "pt"]);
    expect(personaChatLangs([])).toEqual(["fr"]);
    expect(mentionsAssistant("Die Assistentin")).toBe(true);
    expect(mentionsAssistant("la asistente")).toBe(true);
    expect(mentionsAssistant("ta copine Léa")).toBe(false);
  });
});

describe("cache des instances de bot", () => {
  const hit = { tokenEncrypted: "t1", mode: "ASSISTANT" as const, personaId: "p1" };
  it("même jeton, même mode, même persona : instance réutilisée", () => {
    expect(
      cachedBotMatches(hit, { tokenEncrypted: "t1", mode: "ASSISTANT", personaId: "p1" }),
    ).toBe(true);
  });
  it("jeton, mode ou persona changés : nouvelle instance", () => {
    expect(
      cachedBotMatches(hit, { tokenEncrypted: "t2", mode: "ASSISTANT", personaId: "p1" }),
    ).toBe(false);
    expect(cachedBotMatches(hit, { tokenEncrypted: "t1", mode: "STANDARD", personaId: "p1" })).toBe(
      false,
    );
    expect(
      cachedBotMatches(hit, { tokenEncrypted: "t1", mode: "ASSISTANT", personaId: null }),
    ).toBe(false);
  });
  it("appelant qui ne connaît ni le mode ni la persona (lecture seule) : instance réutilisée", () => {
    expect(cachedBotMatches(hit, { tokenEncrypted: "t1" })).toBe(true);
  });
});
