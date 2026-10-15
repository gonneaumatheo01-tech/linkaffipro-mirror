import { describe, expect, it } from "vitest";
import { mentionsRequiredStep as coreMentionsRequiredStep } from "@linkaffipro/core";
import {
  BOT_MOMENTS,
  BOT_MOMENT_TEXT,
  PLACEHOLDER_CHIPS,
  channelLanguageOptions,
  fillExamples,
  langLabel,
  messageLangs,
  SOFT_WELCOME_WARNING,
  mentionsRequiredStep,
  momentNote,
  previewButtons,
  softGateWarning,
  softWelcomeWarning,
  textKey,
} from "./bot-messages";
import type { EntryRule } from "./entry-rule";

const rule: EntryRule = {
  mode: "DELAY",
  delaySeconds: 600,
  gateMode: "NONE",
  gateChannelIds: [],
  reminderAfterMinutes: [60, 1440],
  maxReminders: 2,
  expireAfterHours: null,
  expireAction: "KEEP",
  sendAcceptedMessage: true,
  isActive: true,
};
const gate: EntryRule = { ...rule, gateMode: "REQUIRED", gateChannelIds: ["a", "b"] };
const labels = { join: "Rejoindre", joined: "✅ J'ai rejoint", offer: "Ouvrir l'offre" };

describe("ce que dit le bot", () => {
  it("cinq moments, chacun avec un titre et une phrase", () => {
    expect(BOT_MOMENTS).toEqual([
      "JOIN_REQUEST",
      "GATE_REMINDER",
      "GATE_SATISFIED",
      "APPROVED",
      "OFFER_REPLY",
    ]);
    for (const m of BOT_MOMENTS) {
      expect(BOT_MOMENT_TEXT[m].title).not.toBe("");
      expect(BOT_MOMENT_TEXT[m].when).toMatch(/\.$/);
    }
  });

  it("langues : le français d'abord", () => {
    expect(messageLangs({ en: "Hi", fr: "Salut", de: "Hallo" })).toEqual(["fr", "de", "en"]);
    expect(messageLangs({})).toEqual(["fr"]);
    expect(langLabel("pt")).toBe("Portugais");
    expect(langLabel("xx")).toBe("XX");
  });

  it("signale un message que personne ne recevra avec la règle actuelle", () => {
    expect(momentNote("JOIN_REQUEST", null)).toMatch(/pas de règle/);
    expect(momentNote("JOIN_REQUEST", rule)).toBeNull();
    expect(momentNote("GATE_REMINDER", rule)).toMatch(/obligatoires/);
    expect(momentNote("GATE_REMINDER", { ...gate, gateMode: "SOFT" })).toMatch(/obligatoires/);
    expect(momentNote("GATE_REMINDER", gate)).toBeNull();
    expect(momentNote("GATE_REMINDER", { ...gate, maxReminders: 0 })).toMatch(/Aucun rappel/);
    expect(momentNote("GATE_SATISFIED", rule)).toMatch(/Après avoir rejoint/);
    expect(momentNote("GATE_SATISFIED", gate)).toBeNull();
    expect(momentNote("APPROVED", { ...rule, sendAcceptedMessage: false })).toMatch(/Pas envoyé/);
    expect(momentNote("APPROVED", null)).toBeNull();
    expect(momentNote("OFFER_REPLY", null)).toBeNull();
  });

  it("validation à la main : aucun rappel (le worker ne relance que les demandes qui attendent les canaux)", () => {
    expect(momentNote("GATE_REMINDER", { ...gate, mode: "MANUAL" })).toMatch(/validez vous-même/);
    // Le texte « Canaux rejoints » reste utilisé : le bot vérifie les canaux puis répond avec ce texte.
    expect(momentNote("GATE_SATISFIED", { ...gate, mode: "MANUAL" })).toBeNull();
    expect(momentNote("GATE_SATISFIED", { ...gate, mode: "MANUAL", gateMode: "SOFT" })).toBeNull();
  });

  it("canaux proposés (hors validation à la main) : pas de « J'ai rejoint », la personne est acceptée de toute façon", () => {
    expect(momentNote("GATE_SATISFIED", { ...gate, gateMode: "SOFT" })).toBe(
      "Pas envoyé avec des canaux proposés : la personne est acceptée de toute façon, l'accueil n'a pas de bouton « ✅ J'ai rejoint ».",
    );
    expect(momentNote("GATE_SATISFIED", { ...gate, gateMode: "SOFT", mode: "IMMEDIATE" })).toMatch(
      /acceptée de toute façon/,
    );
  });

  it("langue du canal en toutes lettres, sans perdre une langue inconnue", () => {
    const opts = channelLanguageOptions("fr");
    expect(opts[0]).toEqual({ value: "fr", label: "Français" });
    expect(opts.map((o) => o.value)).toContain("en");
    expect(opts.find((o) => o.value === "de")?.label).toBe("Allemand");
    expect(opts.some((o) => o.value === "fr" && o.label === "fr")).toBe(false);
    const unknown = channelLanguageOptions("xx");
    expect(unknown.at(-1)).toEqual({ value: "xx", label: "XX" });
    expect(channelLanguageOptions("EN").filter((o) => o.value === "en")).toHaveLength(1);
  });

  it("boutons ajoutés par le bot dans l'aperçu", () => {
    expect(previewButtons("OFFER_REPLY", null, [], labels)).toEqual([[{ text: "Ouvrir l'offre" }]]);
    expect(previewButtons("JOIN_REQUEST", rule, [], labels)).toEqual([]);
    expect(previewButtons("JOIN_REQUEST", gate, ["VIP", "Live"], labels)).toEqual([
      [{ text: "Rejoindre VIP" }],
      [{ text: "Rejoindre Live" }],
      [{ text: "✅ J'ai rejoint" }],
    ]);
    expect(previewButtons("GATE_REMINDER", gate, ["VIP"], labels)).toHaveLength(2);
    // Comme le bot : avec des canaux à rejoindre, « ✅ J'ai rejoint » est toujours là (même si un canal a disparu).
    expect(previewButtons("JOIN_REQUEST", gate, [], labels)).toEqual([
      [{ text: "✅ J'ai rejoint" }],
    ]);
    expect(previewButtons("APPROVED", gate, ["VIP"], labels)).toEqual([]);
    expect(previewButtons("JOIN_REQUEST", { ...gate, isActive: false }, ["VIP"], labels)).toEqual(
      [],
    );
  });

  it("clé de texte stable", () => {
    expect(textKey("abc")).toBe(textKey("abc"));
    expect(textKey("abc")).not.toBe(textKey("abd"));
  });
});

describe("aperçu des mots magiques", () => {
  it("remplace les mots connus par les exemples", async () => {
    const { fillExamples } = await import("./bot-messages");
    expect(
      fillExamples("Salut {prenom}, bienvenue dans {canal} {delai} {inconnu} {bot}", {
        prenom: "Léa",
        canal: "VIP",
        delai: "dans 10 minutes",
      }),
    ).toBe("Salut Léa, bienvenue dans VIP dans 10 minutes {inconnu} {bot}");
  });

  it("les mots à insérer sont ceux que le bot remplace", () => {
    const filled = fillExamples(PLACEHOLDER_CHIPS.map((c) => `{${c.key}}`).join(" "), {
      prenom: "Léa",
      canal: "VIP",
      liste_canaux: "A, B",
      delai: "10 min",
      bot: "@b",
    });
    expect(filled).toBe("Léa VIP A, B 10 min @b");
  });
});

describe("canaux proposés : accueil cohérent avec la règle (phase 14)", () => {
  const soft: EntryRule = { ...gate, gateMode: "SOFT" };

  it("aperçu : avec des canaux proposés, seulement les boutons « Rejoindre … », sans « ✅ J'ai rejoint »", () => {
    expect(previewButtons("JOIN_REQUEST", soft, ["VIP", "Live"], labels)).toEqual([
      [{ text: "Rejoindre VIP" }],
      [{ text: "Rejoindre Live" }],
    ]);
    expect(previewButtons("JOIN_REQUEST", soft, [], labels)).toEqual([]);
    // Canaux obligatoires : « ✅ J'ai rejoint » reste là.
    expect(previewButtons("JOIN_REQUEST", gate, ["VIP"], labels).at(-1)).toEqual([
      { text: "✅ J'ai rejoint" },
    ]);
  });

  it("repère un texte qui parle d'une étape obligatoire avec la règle unique du paquet core", () => {
    // Les formules (six langues, mise en forme, accents, apostrophes) sont testées dans packages/core.
    expect(mentionsRequiredStep).toBe(coreMentionsRequiredStep);
    expect(
      mentionsRequiredStep("Rejoins les canaux puis clique sur « J'ai rejoint » pour être accepté"),
    ).toBe(true);
    expect(mentionsRequiredStep("Bienvenue !")).toBe(false);
  });

  it("« Ce que dit le bot » : avertissement quand des canaux proposés et un accueil qui les dit obligatoires", () => {
    expect(SOFT_WELCOME_WARNING).toBe(
      "Vos canaux sont proposés : la personne est acceptée de toute façon. Votre message d'accueil dit qu'elle doit les rejoindre : pensez à l'adapter.",
    );
    const texts = { fr: "Rejoins les canaux puis clique sur « J'ai rejoint » pour être accepté." };
    expect(softWelcomeWarning([soft], texts)).toBe(SOFT_WELCOME_WARNING);
    // Une exception avec des canaux proposés suffit.
    expect(softWelcomeWarning([gate, soft], texts)).toBe(SOFT_WELCOME_WARNING);
    // Pas d'avertissement : canaux obligatoires, aucune règle, texte neutre, validation à la main, règle inactive.
    expect(softWelcomeWarning([gate], texts)).toBeNull();
    expect(softWelcomeWarning([null], texts)).toBeNull();
    expect(softWelcomeWarning([soft], { fr: "Bienvenue !" })).toBeNull();
    expect(softWelcomeWarning([{ ...soft, mode: "MANUAL" }], texts)).toBeNull();
    expect(softWelcomeWarning([{ ...soft, isActive: false }], texts)).toBeNull();
    expect(softWelcomeWarning([{ ...soft, gateChannelIds: [] }], texts)).toBeNull();
    // Une autre langue qui parle d'étape obligatoire compte aussi.
    expect(softWelcomeWarning([soft], { fr: "Bienvenue !", en: "Last step: tap I joined" })).toBe(
      SOFT_WELCOME_WARNING,
    );
  });

  it("sur la règle (formulaire) : « Proposés » choisi et accueil qui parle d'une étape obligatoire", () => {
    const state = {
      choice: "gate" as const,
      gateMode: "SOFT" as const,
      manual: false,
      gateIds: ["a"],
    };
    expect(softGateWarning(state, true)).toBe(SOFT_WELCOME_WARNING);
    expect(softGateWarning(state, false)).toBeNull();
    expect(softGateWarning({ ...state, gateMode: "REQUIRED" }, true)).toBeNull();
    expect(softGateWarning({ ...state, choice: "delay" }, true)).toBeNull();
    expect(softGateWarning({ ...state, manual: true }, true)).toBeNull();
    expect(softGateWarning({ ...state, gateIds: [] }, true)).toBeNull();
  });

  it("moments : « Canaux rejoints » vu par le bot, rappels tardifs et « Accepté » seulement si le bot peut écrire", () => {
    expect(BOT_MOMENT_TEXT.GATE_SATISFIED.when).toBe(
      "Envoyé quand la personne a rejoint tous les canaux obligatoires (le bot le voit tout seul, ou elle appuie sur « ✅ J'ai rejoint »), si le bot peut encore lui écrire.",
    );
    expect(BOT_MOMENT_TEXT.GATE_REMINDER.when).toContain(
      "Après 5 minutes, seulement aux personnes qui ont déjà écrit au bot.",
    );
    expect(BOT_MOMENT_TEXT.APPROVED.when).toContain("si le bot peut encore lui écrire");
  });
});
