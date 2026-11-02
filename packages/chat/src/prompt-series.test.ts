// Prompt d'une fille avec série de photos : elle provoque, l'app ne vient qu'avec la série, le lien n'est annoncé qu'au
// tour où il part, et le début du prompt ne change pas d'un tour à l'autre (cache du fournisseur).
import { describe, expect, it } from "vitest";
import { fakePersona } from "./fake";
import { decideFlirt, type FlirtPhase } from "./flirt";
import { buildSystemPrompt, type SystemPromptContext } from "./prompt";
import { veniceRequestBody } from "./venice";

const PHOTOS = [1, 2, 3, 4, 5].map((slot) => ({
  slot,
  assetId: `a${slot}`,
  description: `photo ${slot}`,
}));
const persona = fakePersona({
  identity: "GIRL",
  illusion: true,
  hasOffer: true,
  flirtPhotos: PHOTOS,
});

function prompt(
  step: FlirtPhase,
  teases: number,
  text: string,
  over: Partial<SystemPromptContext> = {},
) {
  const d = decideFlirt({ step, teases, recent: [], text, hasPhotos: [1, 2, 3, 4, 5] });
  return buildSystemPrompt({
    persona,
    lang: "fr",
    kind: "reply",
    stage: "CHAT",
    style: {},
    facts: [],
    summary: null,
    isFirstAssistantTurn: false,
    memberMessages: 10,
    offerSends: 0,
    flirt: {
      allow: d.allow,
      photoSlot: d.photoSlot,
      directive: d.directive,
      photo: d.photoSlot ? "photo" : null,
      phase: d.state.phase,
    },
    ...over,
  });
}

describe("prompt de la série de photos", () => {
  it("elle provoque et tranche, sans mots qui hésitent", () => {
    const p = prompt("NONE", 0, "ça va");
    expect(p).toContain("tu cherches quoi ici toi ?");
    expect(p).toContain("« du sexe ? 😏 »");
    expect(p).toContain("« on verra »");
    expect(p).not.toContain("ca depend comment c'est utilise");
  });

  it("pas encore chaud : la provocation est redite à la fin, avec la consigne du tour", () => {
    const p = prompt("NONE", 0, "ça va");
    expect(p.lastIndexOf("Pas encore chaud : à ce tour tu provoques")).toBeGreaterThan(
      p.indexOf("AVANT D'ENVOYER"),
    );
    expect(prompt("PHOTOS", 101, "ptn t'es bonne")).not.toContain("Pas encore chaud");
  });

  it("pas d'app tant que ce n'est pas chaud", () => {
    const p = prompt("NONE", 0, "ça va");
    expect(p).toContain("Pas d'app ni de lien maintenant");
    expect(p).not.toContain("d'ailleurs ici y'a trop de mecs bizarres");
  });

  it("tour de vente : chaude de fou, pas à l'aise d'être trop chaude sur telegram, grave chaude sur l'appli", () => {
    const p = prompt("OFFER", 300, "mmh");
    expect(p).toContain("Tu vends l'app à ce tour, SANS lien");
    expect(p).toContain("jsuis chaude de fou la");
    expect(p).toContain("jsuis pas a l'aise ici");
    expect(p).toContain("la bas jsuis grave chaude");
  });

  it("tour du lien : il part seul, l'app n'est jamais décrite", () => {
    const p = prompt("OFFER", 301, "envoie la suite");
    expect(p).toContain("C'est le moment du lien");
    expect(p).toContain(`Action obligatoire ce tour : "lien".`);
    expect(p).not.toContain("tu dis juste : « c'est une appli pour parler »");
    expect(p).not.toContain("→ c'est une appli pour parler");
  });

  it("sans série de photos, la réponse « c'est une appli pour parler » ne change pas", () => {
    const sans = buildSystemPrompt({
      persona: fakePersona({ identity: "GIRL", illusion: true, hasOffer: true }),
      lang: "fr",
      kind: "reply",
      stage: "CHAT",
      style: {},
      facts: [],
      summary: null,
      isFirstAssistantTurn: false,
      memberMessages: 10,
      offerSends: 0,
    });
    expect(sans).toContain("tu dis juste : « c'est une appli pour parler »");
  });

  it("refus : un argument, et le lien n'est plus reproposé", () => {
    const p = prompt("OFFER", 300, "non je reste ici");
    expect(p).toContain("dommage, j'envoie pas de photos sur");
    expect(p).toContain("Il a refusé l'app : ne la repropose pas");
  });

  it("un autocollant est un salut, pas un vocal", () => {
    expect(prompt("NONE", 0, "😘")).toContain("Un [autocollant] n'est pas un vocal");
  });

  it("le début du prompt est le même d'un tour à l'autre, la consigne du tour est à la fin", () => {
    const a = prompt("NONE", 0, "ça va", { facts: ["prénom: Max"], style: { interest: 3 } });
    const b = prompt("PHOTOS", 101, "ptn t'es bonne", { memberMessages: 14, retryCodes: ["link"] });
    let i = 0;
    while (a[i] === b[i]) i++;
    expect(i / a.length).toBeGreaterThan(0.9);
    expect(b.lastIndexOf("PHOTOS (ce tour)")).toBeGreaterThan(b.indexOf("AVANT D'ENVOYER"));
  });
});

describe("clé de cache du prompt", () => {
  it("envoyée à Venice seulement quand elle est posée", () => {
    const base = { model: "m", messages: [], temperature: 0.8, maxTokens: 400 };
    expect(veniceRequestBody({ ...base, cacheKey: "persona:Léa" })).toMatchObject({
      prompt_cache_key: "persona:Léa",
    });
    expect(veniceRequestBody(base)).not.toHaveProperty("prompt_cache_key");
  });
});
