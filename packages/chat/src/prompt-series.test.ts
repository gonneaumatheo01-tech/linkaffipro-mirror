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
  // NONE entre désormais directement dans le tunnel scripté (zéro IA, pas de prompt). Les tests de provocation et d'app
  // ne s'appliquent plus à NONE. On vérifie que la provocation reste présente sur PHOTOS (conversations pré-tunnel).
  it("elle provoque et tranche sur PHOTOS", () => {
    const p = prompt("PHOTOS", 101, "ptn t'es bonne");
    expect(p).toContain("tu cherches quoi ici toi ?");
    expect(p).toContain("« du sexe ? 😏 »");
  });

  it("tour de vente : chaude de fou, pas à l'aise d'être trop chaude sur telegram, grave chaude sur l'appli", () => {
    const p = prompt("OFFER", 300, "mmh");
    expect(p).toContain("Tu vends l'app à ce tour, SANS lien");
    expect(p).toContain("jsuis chaude de fou la");
    expect(p).toContain("jsuis pas a l'aise ici");
    expect(p).toContain("la bas jsuis grave chaude");
  });

  it("tour du lien : jamais balancé, il répond d'abord, l'app n'est jamais décrite", () => {
    const p = prompt("OFFER", 301, "envoie la suite");
    expect(p).toContain("C'est le moment du lien");
    expect(p).toContain(`Action obligatoire ce tour : "lien".`);
    expect(p).toContain("tu réponds d'abord à ce qu'il vient de dire (sa question en premier)");
    expect(p).toContain("mais jamais balancée d'un coup");
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

  it("photo reçue : la réaction part toute seule, le modèle ne commente pas la photo", () => {
    const p = prompt("PHOTOS", 100, "regarde", { memberPhoto: true });
    expect(p.lastIndexOf("« t'es mignon hihi » part déjà tout seul")).toBeGreaterThan(
      p.indexOf("AVANT D'ENVOYER"),
    );
    expect(prompt("PHOTOS", 100, "regarde")).not.toContain("t'es mignon hihi");
  });

  it("la conversation d'abord, à chaque tour de réponse : redit en fin de prompt, sans sauter l'étape", () => {
    for (const [step, teases, text] of [
      ["NONE", 0, "t'as quel age ?"],
      ["PHOTOS", 101, "tu fais quoi ce soir ?"],
      ["OFFER", 300, "t'es d'ou ?"],
      ["OFFER", 301, "pourquoi t'es pas a l'aise ici ?"],
    ] as const) {
      const p = prompt(step, teases, text);
      expect(p.lastIndexOf("LA CONVERSATION D'ABORD")).toBeGreaterThan(
        p.indexOf("AVANT D'ENVOYER"),
      );
      expect(p).toContain("tu ne sautes pas l'étape");
    }
    expect(prompt("PHOTOS", 101, "ok", { kind: "follow_up" })).not.toContain(
      "LA CONVERSATION D'ABORD",
    );
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
