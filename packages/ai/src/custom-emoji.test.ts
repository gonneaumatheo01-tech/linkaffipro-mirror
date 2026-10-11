import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL } from "./models";
import { buildRulesBlock, buildUserMessage, resolveRiskNotice } from "./prompt";
import { suggest } from "./suggest";
import type { AiClient, AiMessageRequest, AiRequest } from "./types";
import { customEmojiProblem, customEmojiTagsOf, validateVersion } from "./validate";

// Emojis animés (phase 12, D7) : les balises <tg-emoji> du texte d'origine sont gardées telles quelles (mêmes
// identifiants, même emoji de remplacement, même nombre) dans chaque version et chaque traduction.
const NOTICE = resolveRiskNotice(null);
const usage = { inputTokens: 1000, outputTokens: 400, cachedTokens: 0, cacheWriteTokens: 0 };
const FIRE = '<tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji>';
const GIFT = '<tg-emoji emoji-id="5235837920081887219">🎁</tg-emoji>';

function fakeClient(responses: string[]): AiClient & { calls: AiMessageRequest[] } {
  const calls: AiMessageRequest[] = [];
  return {
    calls,
    async createMessage(req) {
      calls.push(req);
      return {
        text: responses[calls.length - 1] ?? responses.at(-1) ?? "",
        usage,
        stopReason: "end_turn",
      };
    },
  };
}
const versions = (texts: string[]) =>
  JSON.stringify({ versions: texts.map((text) => ({ text, why: "Autre angle." })) });

const req: AiRequest = {
  kind: "improve",
  text: `${FIRE} Le tournoi du soir commence ${GIFT}`,
  context: { vertical: "DATING", language: "fr", surface: "broadcast", hasMedia: false },
  model: DEFAULT_MODEL,
};

describe("règle dans le prompt système (bloc stable)", () => {
  it("demande de recopier les balises tg-emoji exactement, sans en ajouter ni en retirer", () => {
    const rules = buildRulesBlock(NOTICE);
    expect(rules).toContain('<tg-emoji emoji-id="…">');
    expect(rules).toMatch(/emojis animés/i);
    expect(rules).toMatch(/recopie[^\n]*exactement/i);
    expect(rules).toMatch(/n'en ajoute jamais/i);
    // Bloc stable : identique d'une demande à l'autre (mis en cache).
    expect(buildRulesBlock(NOTICE)).toBe(rules);
  });
  it("la traduction rappelle de garder les emojis animés", () => {
    expect(buildUserMessage({ ...req, kind: "translate" })).toMatch(/emojis animés/i);
  });
});

describe("balises d'emojis animés", () => {
  it("lues avec leur identifiant et leur emoji de remplacement, guillemets simples compris", () => {
    expect(
      customEmojiTagsOf(`a ${FIRE} b <tg-emoji emoji-id='12'> 👍 </tg-emoji> ${FIRE}`),
    ).toEqual(["5368324170671202286:🔥", "12:👍", "5368324170671202286:🔥"]);
  });
  it("même jeu de balises, à un autre endroit : rien à redire", () => {
    expect(customEmojiProblem(req.text, `Ce soir ${GIFT} le tournoi ${FIRE}`)).toBeNull();
    expect(customEmojiProblem("sans emoji", "toujours sans")).toBeNull();
  });
  it("perdue, modifiée (identifiant ou emoji), en moins ou en trop : refusée", () => {
    expect(customEmojiProblem(req.text, `Le tournoi ${FIRE}`)).toMatch(/perdu/);
    expect(
      customEmojiProblem(req.text, `${FIRE} ${GIFT.replace("5235837920081887219", "1")}`),
    ).toMatch(/perdu|modifi/);
    expect(customEmojiProblem(req.text, `${FIRE} ${GIFT.replace("🎁", "🎉")}`)).toMatch(
      /perdu|modifi/,
    );
    expect(customEmojiProblem(`${FIRE}${FIRE}`, FIRE)).toMatch(/perdu/);
    expect(customEmojiProblem(FIRE, `${FIRE} ${FIRE}`)).toMatch(/ajout/);
    expect(customEmojiProblem("sans emoji", `avec ${FIRE}`)).toMatch(/ajout/);
  });
  it("validateVersion : gardée telle quelle si tout est là, refusée sinon", () => {
    const input = {
      source: req.text,
      context: req.context,
      notice: NOTICE,
      max: 4096,
      checkSource: true,
    };
    const ok = validateVersion({ text: `${GIFT} Ce soir, tournoi ! ${FIRE}`, why: "x" }, input);
    expect(ok).toEqual({
      ok: true,
      version: { text: `${GIFT} Ce soir, tournoi ! ${FIRE}`, why: "x" },
    });
    const lost = validateVersion({ text: "Ce soir, tournoi ! 🔥🎁", why: "x" }, input);
    expect(lost.ok).toBe(false);
    // HTML refusé : le repli « texte sans balises » ne peut pas faire disparaître les emojis animés en silence.
    const broken = validateVersion({ text: `<h1>Titre</h1> ${FIRE} ${GIFT}`, why: "x" }, input);
    expect(broken.ok).toBe(false);
  });
  it("une idée qui contient des emojis animés les garde aussi ; aucune version n'en invente", () => {
    const idea = {
      source: `Soirée ${FIRE}`,
      context: req.context,
      notice: NOTICE,
      max: 4096,
      checkSource: false,
    };
    expect(validateVersion({ text: "Soirée !", why: "x" }, idea).ok).toBe(false);
    expect(validateVersion({ text: `Grande soirée ${FIRE}`, why: "x" }, idea).ok).toBe(true);
    const plain = { ...idea, source: "Soirée" };
    expect(validateVersion({ text: `Soirée ${FIRE}`, why: "x" }, plain).ok).toBe(false);
  });
  it("compte comme son emoji de remplacement dans la longueur (même mesure que textLength)", () => {
    const input = {
      source: FIRE,
      context: req.context,
      notice: NOTICE,
      max: "ab🔥".length,
      checkSource: true,
    };
    expect(validateVersion({ text: `ab${FIRE}`, why: "x" }, input).ok).toBe(true);
    expect(validateVersion({ text: `abc${FIRE}`, why: "x" }, input).ok).toBe(false);
  });
});

describe("suggest et traduction (API simulée)", () => {
  it("écarte les versions qui perdent ou modifient un emoji animé, garde les autres", async () => {
    const client = fakeClient([
      versions([
        `${FIRE} Le tournoi démarre ce soir ${GIFT}`,
        "🔥 Le tournoi démarre ce soir 🎁",
        `${FIRE} Ce soir, tournoi ${GIFT.replace("🎁", "🎉")}`,
      ]),
    ]);
    const res = await suggest(req, client);
    expect(res.versions.map((v) => v.text)).toEqual([`${FIRE} Le tournoi démarre ce soir ${GIFT}`]);
    expect(res.rejected).toHaveLength(2);
    expect(client.calls).toHaveLength(1);
  });
  it("aucune version valable : nouvel essai avec le rappel des emojis animés", async () => {
    const client = fakeClient([
      versions(["Le tournoi démarre ce soir"]),
      versions([`${FIRE} Tournoi ce soir ${GIFT}`]),
    ]);
    const res = await suggest(req, client);
    expect(res.versions).toHaveLength(1);
    expect(client.calls[1]!.user).toMatch(/<tg-emoji>/);
  });
  it("traductions : chaque langue garde les mêmes balises ; une langue qui en perd est écartée", async () => {
    const client = fakeClient([
      JSON.stringify({
        translations: {
          en: `${FIRE} The evening tournament starts ${GIFT}`,
          es: `${FIRE} Empieza el torneo de la noche`,
          pt: `${GIFT} Começa o torneio da noite ${FIRE}`,
          de: `${FIRE} Das Abendturnier beginnt ${GIFT} ${GIFT}`,
          it: `${FIRE} Inizia il torneo della sera ${GIFT}`,
        },
      }),
    ]);
    const res = await suggest({ ...req, kind: "translate" }, client);
    expect(res.versions.map((v) => v.lang)).toEqual(["en", "pt", "it"]);
    for (const v of res.versions)
      expect(customEmojiTagsOf(v.text).sort()).toEqual(customEmojiTagsOf(req.text).sort());
    expect(res.rejected.map((r) => r.reason).join(" ")).toMatch(/perdu/);
    expect(res.rejected.map((r) => r.reason).join(" ")).toMatch(/ajout/);
  });
});
