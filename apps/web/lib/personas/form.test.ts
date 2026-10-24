import { describe, expect, it } from "vitest";
// Règles du profil du bot de packages/telegram (pures) : relues directement, pour vérifier que le formulaire applique
// exactement la même règle que `setAssistantProfile` et propose exactement les mêmes textes.
import {
  assistantProfilePlan,
  mentionsAssistant,
} from "../../../../packages/telegram/src/assistant/profile";
import { CHAT_LANGS } from "@linkaffipro/chat";
import {
  PERSONA_LIMITS,
  activationProblems,
  advancedModifiedCount,
  botProfileTextProblem,
  emptyPersonaForm,
  hidesAssistant,
  parseInterests,
  personaRole,
  personaToForm,
  proposedProfileTexts,
  saysAssistant,
  validatePersonaForm,
  withProfileTexts,
  type PersonaFormState,
  type PersonaRecord,
  type ProfileTemplates,
} from "./form";

/** Mêmes textes proposés que `profileTemplates()` (lib/personas/queries.ts), calculés depuis packages/telegram. */
function templates(): ProfileTemplates {
  const out: ProfileTemplates = {};
  for (const lang of CHAT_LANGS) {
    const e = (gender: "F" | "M") => {
      const entry = assistantProfilePlan({
        name: "{name}",
        gender,
        languages: [lang],
        botDescription: null,
        botShortDescription: null,
      }).entries[0]!;
      return { long: entry.description, short: entry.shortDescription };
    };
    out[lang] = { F: e("F"), M: e("M") };
  }
  return out;
}

const T = templates();

function form(over: Partial<PersonaFormState> = {}): PersonaFormState {
  return {
    ...emptyPersonaForm(T),
    name: "Léa",
    personality: "Pétillante, curieuse",
    tone: "complice, léger",
    interests: "voyages, musique",
    ...over,
  };
}

describe("nouvelle persona", () => {
  it("désactivée, valeurs par défaut du contrat (4 messages, 2 envois, 24 h, 2 relances), français", () => {
    const f = emptyPersonaForm(T);
    expect(f.isActive).toBe(false);
    expect(f.gender).toBe("F");
    expect(f.languages).toEqual(["fr"]);
    expect(f.minExchangesBeforeOffer).toBe("4");
    expect(f.maxOfferSends).toBe("2");
    expect(f.followUpAfterHours).toBe("24");
    expect(f.followUpsMax).toBe("2");
    expect(f.requireInterest).toBe(true);
    expect(f.offerButtonText).toBe("Découvrir l'app");
  });

  it("sans prénom, descriptions du bot vides (jamais un prénom d'exemple) ; proposées dès qu'un prénom est tapé", () => {
    const f = emptyPersonaForm(T);
    expect(f.botDescription).toBe("");
    expect(f.botShortDescription).toBe("");
    expect(proposedProfileTexts(T, f)).toBeNull();
    expect(proposedProfileTexts(T, { ...f, name: "   " })).toBeNull();
    const named = withProfileTexts(f, { ...f, name: "Chloé" }, T);
    expect(named.botDescription).toContain("Chloé, l'assistante du canal");
    expect(named.botShortDescription).toContain("Chloé, l'assistante du canal");
    expect(named.botDescription).not.toContain("Léa");
    expect(mentionsAssistant(named.botDescription)).toBe(true);
    expect(mentionsAssistant(named.botShortDescription)).toBe(true);
    expect(named.botDescription.length).toBeLessThanOrEqual(PERSONA_LIMITS.botDescription);
    expect(named.botShortDescription.length).toBeLessThanOrEqual(
      PERSONA_LIMITS.botShortDescription,
    );
    // Le prénom effacé : les textes proposés repartent ; un texte réécrit par l'équipe reste.
    const cleared = withProfileTexts(named, { ...named, name: "" }, T);
    expect(cleared.botDescription).toBe("");
    expect(cleared.botShortDescription).toBe("");
    const custom = { ...named, botDescription: "Moi c'est Chloé, l'assistante du canal, une IA." };
    const kept = withProfileTexts(custom, { ...custom, name: "" }, T);
    expect(kept.botDescription).toBe("Moi c'est Chloé, l'assistante du canal, une IA.");
    expect(kept.botShortDescription).toBe("");
    // Un texte écrit avant le prénom n'est pas remplacé quand le prénom arrive.
    const early = { ...f, botDescription: "Je suis l'assistante du canal, une IA." };
    expect(withProfileTexts(early, { ...early, name: "Chloé" }, T).botDescription).toBe(
      "Je suis l'assistante du canal, une IA.",
    );
  });

  it("les textes proposés sont exactement ceux que Telegram reçoit par défaut, pour chaque langue et chaque rôle", () => {
    for (const lang of CHAT_LANGS)
      for (const gender of ["F", "M"] as const) {
        const texts = proposedProfileTexts(T, {
          name: "Zoé",
          gender,
          identityKind: "ASSISTANT",
          languages: [lang],
        })!;
        const entry = assistantProfilePlan({
          name: "Zoé",
          gender,
          languages: [lang],
          botDescription: null,
          botShortDescription: null,
        }).entries[0]!;
        expect(texts.long).toBe(entry.description);
        expect(texts.short).toBe(entry.shortDescription);
      }
  });

  it("les textes proposés suivent le prénom, le rôle et la langue tant qu'ils n'ont pas été réécrits", () => {
    const before = emptyPersonaForm(T);
    const named = withProfileTexts(before, { ...before, name: "Inès" }, T);
    expect(named.botDescription).toContain("Inès");
    const male = withProfileTexts(named, { ...named, gender: "M" }, T);
    expect(male.botDescription).toContain("l'assistant du canal");
    const english = withProfileTexts(male, { ...male, languages: ["en", "fr"] }, T);
    expect(english.botShortDescription).toContain("the assistant");
    // Texte réécrit par l'équipe : gardé tel quel.
    const custom = { ...english, botDescription: "Moi c'est Inès, l'assistante du canal, une IA." };
    const kept = withProfileTexts(custom, { ...custom, name: "Inès B." }, T);
    expect(kept.botDescription).toBe("Moi c'est Inès, l'assistante du canal, une IA.");
    expect(kept.botShortDescription).toContain("Inès B.");
  });
});

describe("règle « assistant(e) » du profil du bot", () => {
  it("même règle que mentionsAssistant (packages/telegram)", () => {
    for (const t of [
      "l'assistante du canal",
      "L'ASSISTANT",
      "the assistant",
      "la asistente",
      "die Assistentin",
      "o assistente",
      "ta copine Léa",
      "une IA",
      "",
      "assistance",
    ])
      expect(saysAssistant(t), t).toBe(mentionsAssistant(t));
  });

  it("refuse une description qui ne dit pas « assistante » ou « assistant », ou trop longue", () => {
    const r = validatePersonaForm(form({ botDescription: "Moi c'est Léa, ta copine du canal 😘" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.botDescription).toMatch(/assistant/);
    const short = validatePersonaForm(form({ botShortDescription: "Léa, du canal" }));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors.botShortDescription).toBeTruthy();
    const long = validatePersonaForm(form({ botDescription: `assistante ${"x".repeat(520)}` }));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors.botDescription).toMatch(/512/);
  });

  it("refuse une description qui dit « assistante » mais le nie, ou laisse croire à une vraie personne", () => {
    const r = validatePersonaForm({
      ...emptyPersonaForm(),
      name: "Léa",
      botDescription:
        "Léa, 24 ans. Je ne suis pas une assistante ni un bot, juste une vraie personne.",
      botShortDescription: "Moi c'est Léa, pas une assistante : une vraie fille de Paris 😉",
      isActive: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.botDescription).toMatch(/^Refusé : l'assistante dit toujours/);
    expect(r.errors.botDescription).toMatch(/Retirez « Je ne suis pas une assistante »/);
    expect(r.errors.botShortDescription).toMatch(/^Refusé : l'assistante dit toujours/);
    for (const t of [
      "Léa, l'assistante du canal. Je suis une vraie fille de Lyon.",
      "Léa, l'assistante du canal, mais pas un bot 😉",
    ])
      expect(botProfileTextProblem(t, "long"), t).toMatch(/^Refusé/);
  });

  it("les textes proposés, dans chaque langue et pour chaque rôle, passent tous les contrôles", () => {
    for (const lang of CHAT_LANGS)
      for (const gender of ["F", "M"] as const) {
        const entry = assistantProfilePlan({
          name: "Léa",
          gender,
          languages: [lang],
          botDescription: null,
          botShortDescription: null,
        }).entries[0]!;
        expect(botProfileTextProblem(entry.description, "long"), entry.description).toBeNull();
        expect(
          botProfileTextProblem(entry.shortDescription, "short"),
          entry.shortDescription,
        ).toBeNull();
      }
    expect(
      botProfileTextProblem("Léa, l'assistante du canal : une IA, pas une vraie personne.", "long"),
    ).toBeNull();
  });

  it("description vide : le texte proposé sera utilisé (null enregistré)", () => {
    const r = validatePersonaForm(form({ botDescription: "  ", botShortDescription: "" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.botDescription).toBeNull();
      expect(r.data.botShortDescription).toBeNull();
    }
  });
});

describe("aucune option pour cacher qu'il s'agit d'un assistant", () => {
  it("repère les consignes qui feraient passer l'assistante pour une vraie personne", () => {
    for (const t of [
      "Tu es une vraie fille de Lyon",
      "Fais-toi passer pour une vraie personne",
      "Ne dis jamais que tu es une IA",
      "tu n'es pas un bot",
      "cache que tu es une IA",
      "Pretend to be a real woman",
      "Never admit you are an AI",
      "You are human",
      // élision, infinitif, « à personne », tournures sans « ne »
      "N'avoue jamais que tu es une IA.",
      "N'admets jamais être un bot.",
      "Ne jamais dire que tu es une IA.",
      "Ne dis à personne que tu es une IA.",
      "Ne dis jamais à personne que tu es une IA.",
      "Tu ne dois jamais dire que tu es une IA",
      "Il ne faut pas que tu dises que tu es un bot",
      "Ne révèle jamais ta nature d'IA",
      "Ne dis rien sur le fait que tu es une IA",
      "Évite de dire que tu es une IA",
      "dis jamais que t'es une IA",
      "Si on te demande, cache que tu es une IA",
      "Nie être une IA si on te pose la question",
      "Si on te le demande, tu es une vraie personne",
      // première et troisième personne
      "Je suis une vraie fille de Paris",
      "Je ne suis pas un bot",
      "C'est une vraie personne qui répond",
      "Rappelle que tu n'es pas une IA",
      "Don't tell them you're a bot",
      "Hide that you are an AI",
    ])
      expect(hidesAssistant(t), t).not.toBeNull();
  });

  it("une consigne qui demande justement de ne jamais cacher l'IA est acceptée", () => {
    for (const t of [
      "Tu ne dois jamais cacher que tu es une IA.",
      "Ne pas cacher que tu es une IA.",
      "Sans jamais cacher que tu es une IA, reste légère.",
      "N'essaie jamais de cacher que tu es une IA.",
      "Interdiction de cacher que tu es une IA.",
      "Ne nie jamais être une IA.",
      "Ne dis jamais que tu n'es pas une IA.",
      "Ne dis jamais que tu es une vraie personne.",
      "Ne dis jamais que tu es une vraie personne : tu es une IA.",
      "Si on te demande si tu es une vraie personne, réponds que tu es une IA.",
      "Si on te demande « tu es une vraie personne ? », réponds franchement que tu es une IA.",
      "Ne te fais jamais passer pour une vraie personne.",
      "Ne jamais te faire passer pour une vraie personne.",
      "Ne prétends jamais être humaine.",
      "N'hésite pas à dire que tu es une IA.",
      "Dis toujours que tu es une IA quand on te le demande.",
      "Never pretend to be human.",
      "Don't pretend you are a real person.",
      "Never deny being an AI.",
      // silence qui ne porte pas sur ce qu'elle est
      "Ne dis jamais que le bot est payant",
      "Ne mentionne jamais l'offre avant le 4e message.",
      "Ne dis jamais de gros mots.",
    ]) {
      expect(hidesAssistant(t), t).toBeNull();
      expect(validatePersonaForm(form({ extraPrompt: t })).ok, t).toBe(true);
    }
  });

  it("ne repère pas une consigne honnête ou un simple caractère", () => {
    for (const t of [
      "Pétillante, curieuse, pleine d'humour",
      "Ne cache jamais que tu es une IA",
      "Parle de séries si la personne aime le cinéma",
      "complice, léger, taquin",
      "",
    ])
      expect(hidesAssistant(t), t).toBeNull();
  });

  it("refuse l'enregistrement d'une telle consigne, avec le passage en cause", () => {
    const r = validatePersonaForm(
      form({ extraPrompt: "Si on te demande, ne dis jamais que tu es une IA." }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.extraPrompt).toMatch(/Retirez « ne dis jamais que tu es une IA »/i);
    const elided = validatePersonaForm(form({ extraPrompt: "N'avoue jamais que tu es une IA." }));
    expect(elided.ok).toBe(false);
    if (!elided.ok)
      expect(elided.errors.extraPrompt).toBe(
        "Refusé : l'assistante dit toujours qu'elle est une assistante (une IA). Retirez « N'avoue jamais que tu es une IA ».",
      );
    const p = validatePersonaForm(form({ personality: "Tu es une vraie femme, drôle" }));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.personality).toBeTruthy();
  });
});

describe("parcours : bornes du client", () => {
  it("jamais de lien au premier message : au moins 1 message de la personne", () => {
    const r = validatePersonaForm(form({ minExchangesBeforeOffer: "0" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.minExchangesBeforeOffer).toMatch(/premier message/);
  });

  it("envois du lien de 1 à 3, relance après 4 h au moins, 2 relances au plus", () => {
    const bad = validatePersonaForm(
      form({ maxOfferSends: "4", followUpAfterHours: "3", followUpsMax: "3" }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.maxOfferSends).toBeTruthy();
      expect(bad.errors.followUpAfterHours).toBeTruthy();
      expect(bad.errors.followUpsMax).toMatch(/jamais plus de 2/);
    }
    const ok = validatePersonaForm(
      form({
        minExchangesBeforeOffer: "1",
        maxOfferSends: "3",
        followUpAfterHours: "4",
        followUpsMax: "0",
      }),
    );
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect(ok.data).toMatchObject({
        minExchangesBeforeOffer: 1,
        maxOfferSends: 3,
        followUpAfterHours: 4,
        followUpsMax: 0,
      });
  });

  it("refuse un nombre à virgule ou du texte", () => {
    const r = validatePersonaForm(
      form({ minExchangesBeforeOffer: "2,5", followUpAfterHours: "abc" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.minExchangesBeforeOffer).toBeTruthy();
      expect(r.errors.followUpAfterHours).toBeTruthy();
    }
  });
});

describe("activation", () => {
  it("refusée sans prénom", () => {
    expect(
      activationProblems({ name: " ", affiliateCampaignId: null, offerPitch: "" }),
    ).toHaveLength(1);
    const r = validatePersonaForm(form({ name: "", isActive: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.isActive).toMatch(/Activation impossible/);
      expect(r.errors.name).toBeTruthy();
    }
  });

  it("refusée avec une offre liée et une fiche de l'offre vide", () => {
    const r = validatePersonaForm(
      form({ affiliateCampaignId: "aff1", offerPitch: " ", isActive: true }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.isActive).toMatch(/Ce que l'assistante peut dire de l'app/);
      expect(r.errors.offerPitch).toBeTruthy();
    }
  });

  it("persona masculine : le refus cite le champ tel qu'il est affiché (« Ce que l'assistant… »)", () => {
    const r = validatePersonaForm(
      form({ gender: "M", affiliateCampaignId: "aff1", offerPitch: " ", isActive: true }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.isActive).toContain("« Ce que l'assistant peut dire de l'app »");
      expect(r.errors.isActive).toContain("il ne pourrait rien en dire");
    }
  });

  it("permise avec un prénom et une fiche de l'offre (ou sans offre)", () => {
    expect(
      validatePersonaForm(
        form({
          affiliateCampaignId: "aff1",
          offerPitch: "Gratuite à l'inscription.",
          isActive: true,
        }),
      ).ok,
    ).toBe(true);
    expect(validatePersonaForm(form({ isActive: true })).ok).toBe(true);
  });

  it("une persona désactivée s'enregistre même sans prénom ni fiche (brouillon)", () => {
    const r = validatePersonaForm(form({ name: "", affiliateCampaignId: "aff1", offerPitch: "" }));
    expect(r.ok).toBe(true);
  });
});

describe("lecture du brouillon", () => {
  it("langues : seulement les 6 langues, la première est la langue par défaut", () => {
    const r = validatePersonaForm(form({ languages: ["en", "xx" as never, "fr", "en"] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.languages).toEqual(["en", "fr"]);
    const none = validatePersonaForm(form({ languages: [] }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors.languages).toBeTruthy();
  });

  it("centres d'intérêt séparés par des virgules, sans doublon, 12 au plus", () => {
    expect(parseInterests("voyages, Musique ;musique\n cuisine,, ")).toEqual([
      "voyages",
      "Musique",
      "cuisine",
    ]);
    const many = validatePersonaForm(
      form({ interests: Array.from({ length: 13 }, (_, i) => `goût ${i}`).join(", ") }),
    );
    expect(many.ok).toBe(false);
  });

  it("modèle et créativité : vides = réglages généraux ; créativité de 0 à 2, virgule acceptée", () => {
    const r = validatePersonaForm(form({ model: "", temperature: "" }));
    expect(r.ok && r.data.model === null && r.data.temperature === null).toBe(true);
    const t = validatePersonaForm(form({ model: "venice-uncensored-1-2", temperature: "0,9" }));
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.data).toMatchObject({ model: "venice-uncensored-1-2", temperature: 0.9 });
    const bad = validatePersonaForm(form({ temperature: "3", model: "un modèle ?" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.temperature).toBeTruthy();
      expect(bad.errors.model).toBeTruthy();
    }
  });

  it("texte du bouton obligatoire ; références vides = null", () => {
    const r = validatePersonaForm(form({ offerButtonText: " " }));
    expect(r.ok).toBe(false);
    const ok = validatePersonaForm(form());
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect(ok.data).toMatchObject({
        affiliateCampaignId: null,
        campaignId: null,
        offerMediaAssetId: null,
        extraPrompt: null,
      });
  });

  describe("fille (GIRL)", () => {
    it("âge obligatoire, description sans mot de machine, aucun texte de profil proposé", () => {
      const sansAge = validatePersonaForm(form({ identityKind: "GIRL" }));
      expect(sansAge.ok).toBe(false);
      if (!sansAge.ok) expect(sansAge.errors.age).toMatch(/âge/i);

      const ok = validatePersonaForm(form({ identityKind: "GIRL", age: "23" }));
      expect(ok.ok).toBe(true);
      if (ok.ok) expect(ok.data.identityKind).toBe("GIRL");

      expect(proposedProfileTexts(T, { ...form(), identityKind: "GIRL" })).toBeNull();

      const machine = validatePersonaForm(
        form({ identityKind: "GIRL", age: "23", botDescription: "Léa, l'assistante du canal" }),
      );
      expect(machine.ok).toBe(false);
      if (!machine.ok) expect(machine.errors.botDescription).toMatch(/machine/);

      const propre = validatePersonaForm(
        form({ identityKind: "GIRL", age: "23", botDescription: "Léa, 23 ans. Paris." }),
      );
      expect(propre.ok).toBe(true);
    });

    it("« ne dis jamais que tu es une IA » est accepté pour une fille, refusé pour une assistante", () => {
      const extra = "Ne dis jamais que tu es une IA.";
      expect(
        validatePersonaForm(form({ identityKind: "GIRL", age: "23", extraPrompt: extra })).ok,
      ).toBe(true);
      expect(validatePersonaForm(form({ extraPrompt: extra })).ok).toBe(false);
    });

    it("passer en fille vide la description restée au texte proposé", () => {
      const before = { ...emptyPersonaForm(T), name: "Léa" };
      const named = withProfileTexts(emptyPersonaForm(T), before, T);
      expect(named.botDescription).not.toBe("");
      const girl = withProfileTexts(named, { ...named, identityKind: "GIRL" }, T);
      expect(girl.botDescription).toBe("");
      expect(girl.botShortDescription).toBe("");
    });
  });

  it("brouillon illisible : refus clair, sans planter", () => {
    expect(validatePersonaForm(null).ok).toBe(false);
    const r = validatePersonaForm("n'importe quoi");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/rechargez la page/);
  });

  it("persona enregistrée → formulaire → mêmes valeurs", () => {
    const rec: PersonaRecord = {
      id: "p1",
      name: "Léa",
      gender: "F",
      identityKind: "ASSISTANT",
      age: null,
      styleExamples: null,
      personality: "Pétillante",
      tone: "complice",
      languages: ["fr", "en"],
      interests: ["voyages", "musique"],
      extraPrompt: null,
      model: null,
      temperature: 0.7,
      minExchangesBeforeOffer: 5,
      requireInterest: false,
      maxOfferSends: 1,
      followUpAfterHours: 48,
      followUpsMax: 1,
      affiliateCampaignId: "aff1",
      campaignId: "c1",
      offerPitch: "Gratuite à l'inscription.",
      offerButtonText: "Voir l'app",
      offerMediaAssetId: "m1",
      botDescription: null,
      botShortDescription: "Léa, l'assistante du canal",
      isActive: true,
    };
    const f = personaToForm(rec, T);
    expect(f.botDescription).toContain("Léa, l'assistante du canal");
    expect(f.interests).toBe("voyages, musique");
    const r = validatePersonaForm(f);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.id).toBe("p1");
      expect(r.data).toMatchObject({
        temperature: 0.7,
        minExchangesBeforeOffer: 5,
        requireInterest: false,
        maxOfferSends: 1,
        followUpAfterHours: 48,
        followUpsMax: 1,
        affiliateCampaignId: "aff1",
        campaignId: "c1",
        offerMediaAssetId: "m1",
        languages: ["fr", "en"],
        isActive: true,
      });
    }
  });
});

describe("affichage", () => {
  it("rôle : l'assistante / l'assistant", () => {
    expect(personaRole("F")).toBe("l'assistante");
    expect(personaRole("M")).toBe("l'assistant");
  });

  it("compteur « Avancé » : modèle, créativité, consigne", () => {
    expect(advancedModifiedCount(form())).toBe(0);
    expect(advancedModifiedCount(form({ model: "m", extraPrompt: "x" }))).toBe(2);
  });
});

describe("univers et fiche d'informations (phase 25)", () => {
  it("Casino et Paris sportifs : « une fille » et le mode illusion refusés côté serveur", () => {
    for (const universe of ["casino", "sports"] as const) {
      const girl = validatePersonaForm(form({ universe, identityKind: "GIRL", age: "23" }));
      expect(girl.ok).toBe(false);
      if (!girl.ok) expect(girl.errors.identityKind).toMatch(/toujours l'assistante/);
      const illusion = validatePersonaForm({ ...form({ universe }), illusion: true });
      expect(illusion.ok).toBe(false);
      const ok = validatePersonaForm(form({ universe }));
      expect(ok.ok && ok.data.universe).toBe(universe);
    }
    expect(validatePersonaForm(form({ identityKind: "GIRL", age: "23" })).ok).toBe(true);
  });

  it("univers inconnu → Rencontres ; fiche lue et vérifiée ; absente → null (inchangée)", () => {
    const r = validatePersonaForm({ ...form(), universe: "poker", faq: undefined });
    expect(r.ok && r.data.universe).toBe("dating");
    expect(r.ok && r.data.faq).toBeNull();
    const f = validatePersonaForm(form({ universe: "casino", faq: [{ q: " VIP ? ", a: "Oui" }] }));
    expect(f.ok && f.data.faq).toEqual([{ q: "VIP ?", a: "Oui" }]);
    const bad = validatePersonaForm(form({ faq: [{ q: "VIP ?", a: "" }] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.faq).toMatch(/réponse est vide/);
  });
});
