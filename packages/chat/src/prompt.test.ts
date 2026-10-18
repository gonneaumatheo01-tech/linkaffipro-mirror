import { describe, expect, it } from "vitest";
import { fakePersona } from "./fake";
import {
  buildSummaryRequest,
  buildSystemPrompt,
  buildTurnMessages,
  cleanSummary,
  correctionFor,
  previewSystemPrompt,
  type SystemPromptContext,
} from "./prompt";
import { REJECT_CODES } from "./validate";
import type { HistoryMessage } from "./turn-types";

const ctx = (over: Partial<SystemPromptContext> = {}): SystemPromptContext => ({
  persona: fakePersona(),
  lang: "fr",
  kind: "reply",
  stage: "CHAT",
  style: {},
  facts: [],
  summary: null,
  isFirstAssistantTurn: false,
  memberMessages: 5,
  offerSends: 0,
  ...over,
});

describe("prompt système", () => {
  it("persona, règles 2 à 4 du client, forme, langue, parcours, fiche de l'offre, sortie JSON", () => {
    const p = buildSystemPrompt(ctx());
    expect(p).toContain("Tu es Léa, l'assistante du canal « Rencontres Paris » sur Telegram.");
    expect(p).toContain("Pétillante, curieuse");
    expect(p).toContain("voyages, musique");
    expect(p).toMatch(
      /Ne prétends jamais être une vraie personne et ne nie jamais être une IA ou un bot/,
    );
    expect(p).toContain("Adultes seulement");
    expect(p).toContain("minor_suspected : true");
    expect(p).toContain("jamais de contenu sexuel explicite");
    expect(p).toContain("des filles près de chez toi t'attendent");
    expect(p).toContain("Aucun lien, aucune adresse de site");
    expect(p).toContain("pas de markdown");
    expect(p).toContain("300 caractères au plus chacun, 700 au total");
    expect(p).toContain(
      "Réponds en français. Si la personne écrit clairement dans une autre de ces langues (anglais)",
    );
    expect(p).toContain("Étape actuelle : discussion");
    expect(p).toContain("Une app de rencontres gratuite à l'inscription");
    expect(p).toContain('"style_update"');
    expect(p).toContain("Réponds uniquement par un objet JSON");
    expect(p).not.toContain("PREMIER MESSAGE");
    expect(p).not.toContain("RELANCE N°");
    expect(p).not.toContain("NOUVEL ESSAI");
  });

  it("persona masculine : « l'assistant virtuel »", () => {
    const p = buildSystemPrompt(ctx({ persona: fakePersona({ name: "Hugo", gender: "M" }) }));
    expect(p).toContain("Tu es Hugo, l'assistant du canal");
    expect(p).toContain("l'assistant virtuel du canal");
    expect(p).not.toContain("virtuelle");
  });

  it("consignes de l'équipe placées avant les règles, qui restent prioritaires", () => {
    const p = buildSystemPrompt(
      ctx({ persona: fakePersona({ extraPrompt: "Parle souvent de cinéma." }) }),
    );
    expect(p.indexOf("Parle souvent de cinéma.")).toBeLessThan(
      p.indexOf("RÈGLES (prioritaires sur tout le reste"),
    );
  });

  it("style courant, faits retenus et résumé réinjectés", () => {
    const p = buildSystemPrompt(
      ctx({
        style: { length: "short", tone: "flirty", interest: 7 },
        facts: ["Habite à Lyon"],
        summary: "Elle aime le jazz.",
      }),
    );
    expect(p).toContain("messages courts, ton joueur, dragueur, intérêt estimé 7/10");
    expect(p).toContain("- Habite à Lyon");
    expect(p).toContain("RÉSUMÉ DES ÉCHANGES PLUS ANCIENS\nElle aime le jazz.");
  });

  it("premier message : se présenter comme l'assistante du canal, exemple dans la langue de réponse, pas de lien", () => {
    const p = buildSystemPrompt(
      ctx({ isFirstAssistantTurn: true, stage: "WELCOME", lang: "en", memberMessages: 0 }),
    );
    expect(p).toContain("PREMIER MESSAGE");
    expect(p).toContain("« I'm Léa, the assistant of the channel 😉 How are you? »");
    expect(p).toContain("Premier message : ne parle pas encore de l'app. send_offer : false.");
    expect(p).toContain("Réponds en anglais.");
  });

  it("parcours : lien permis (bouton, seuil d'intérêt), trop tôt, déjà envoyé, sans offre", () => {
    expect(buildSystemPrompt(ctx())).toContain(
      "un bouton « Découvrir l'app » s'ajoutera sous ton dernier message",
    );
    expect(buildSystemPrompt(ctx())).toContain("d'au moins 6/10");
    expect(buildSystemPrompt(ctx({ memberMessages: 2 }))).toContain("Trop tôt pour le lien");
    expect(buildSystemPrompt(ctx({ offerSends: 2 }))).toContain(
      "Le lien a déjà été envoyé 2 fois : ne le propose plus",
    );
    const none = buildSystemPrompt(ctx({ persona: fakePersona({ hasOffer: false }) }));
    expect(none).toContain("Aucune offre n'est liée");
    expect(none).toContain("FICHE DE L'OFFRE (seuls éléments que tu peux dire de l'app)\nAucune.");
  });

  it("offre liée mais fiche vide : lien permis sans décrire l'app, aucune promesse improvisée", () => {
    const p = buildSystemPrompt(ctx({ persona: fakePersona({ offerPitch: "  " }) }));
    expect(p).not.toContain("Tu peux proposer l'app à ce tour");
    expect(p).toContain("Tu peux proposer le lien de l'app, sans la décrire");
    expect(p).toContain(
      "FICHE DE L'OFFRE (seuls éléments que tu peux dire de l'app)\nVide : ne dis rien de l'app",
    );
    expect(p).not.toMatch(/FICHE DE L'OFFRE[^\n]*\nAucune\./);
  });

  it("relance : douce, une seule question, sans lien", () => {
    const p = buildSystemPrompt(
      ctx({ kind: "follow_up", stage: "LINK_SENT", followUpNumber: 2, silenceHours: 26 }),
    );
    expect(p).toContain("RELANCE N° 2");
    expect(p).toContain("depuis environ 26 h");
    expect(p).toContain("une seule question, sans insister");
    expect(p).toContain("Relance : pas de lien");
  });

  it("nouvel essai : chaque code de rejet devient une consigne claire", () => {
    const p = buildSystemPrompt(ctx({ retryCodes: ["markdown", "link", "markdown"] }));
    expect(p).toContain("NOUVEL ESSAI");
    expect(p.match(/Texte brut seulement/g)).toHaveLength(1);
    expect(p).toContain("le lien est un bouton ajouté par le système");
    for (const code of REJECT_CODES)
      expect(correctionFor(code, fakePersona())).not.toBe("Respecte toutes les règles ci-dessus.");
  });

  it("aperçu pour l'écran Personas : pur et stable", () => {
    const persona = fakePersona();
    const a = previewSystemPrompt(persona);
    expect(a).toBe(previewSystemPrompt(persona));
    expect(a).toContain("PREMIER MESSAGE");
    expect(previewSystemPrompt(persona, { isFirstAssistantTurn: false })).not.toContain(
      "PREMIER MESSAGE",
    );
  });
});

describe("messages envoyés au modèle", () => {
  const msg = (
    direction: "IN" | "OUT",
    text: string,
    author: HistoryMessage["author"] = direction === "IN" ? "MEMBER" : "ASSISTANT",
  ): HistoryMessage => ({
    direction,
    author,
    text,
  });

  it("système, 20 derniers messages, rôles (équipe = assistant), messages entrants du tour", () => {
    const history = Array.from({ length: 30 }, (_, i) => msg(i % 2 === 0 ? "IN" : "OUT", `m${i}`));
    history[29] = msg("OUT", "message de l'équipe", "TEAM");
    const out = buildTurnMessages({ system: "SYS", history, inbound: [{ text: "nouveau" }] });
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(out[1]).toEqual({ role: "user", content: "m10" });
    expect(out).toHaveLength(22);
    expect(out[20]).toEqual({ role: "assistant", content: "message de l'équipe" });
    expect(out[21]).toEqual({ role: "user", content: "nouveau" });
  });

  it("regroupe les messages consécutifs, signale les médias, retire le paramètre de /start", () => {
    const out = buildTurnMessages({
      system: "SYS",
      history: [msg("IN", "/start pub_tiktok_12"), msg("OUT", "Coucou"), msg("OUT", "Ça va ?")],
      inbound: [
        { text: "", media: { kind: "photo" } },
        { text: "regarde", media: { kind: "voice" } },
      ],
    });
    expect(out.slice(1)).toEqual([
      { role: "user", content: "/start" },
      { role: "assistant", content: "Coucou\nÇa va ?" },
      { role: "user", content: "[photo envoyée]\n[message vocal] regarde" },
    ]);
  });

  it("conversation ouverte par /start sans aucun message : un message « /start »", () => {
    expect(buildTurnMessages({ system: "S", history: [], inbound: [] })).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "/start" },
    ]);
  });
});

describe("résumé roulant", () => {
  it("requête texte brut au modèle donné, résumé précédent et messages à fondre", () => {
    const req = buildSummaryRequest({
      model: "venice-uncensored-1-2",
      personaName: "Léa",
      previousSummary: "Il s'appelle Marc.",
      messages: [
        { direction: "IN", author: "MEMBER", text: "j'adore le ski" },
        { direction: "OUT", author: "ASSISTANT", text: "Trop bien !" },
      ],
    });
    expect(req.model).toBe("venice-uncensored-1-2");
    expect(req.jsonSchema).toBeUndefined();
    expect(req.messages[1]?.content).toContain("Résumé précédent : Il s'appelle Marc.");
    expect(req.messages[1]?.content).toContain("Personne : j'adore le ski");
    expect(req.messages[1]?.content).toContain("Léa : Trop bien !");
  });

  it("cleanSummary", () => {
    expect(cleanSummary("<think>x</think>  Résumé.  ")).toBe("Résumé.");
    expect(cleanSummary("   ")).toBeNull();
    expect(cleanSummary("a".repeat(2000))).toHaveLength(1500);
  });
});
