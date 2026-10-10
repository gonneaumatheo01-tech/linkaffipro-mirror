import { describe, expect, it } from "vitest";
import { AiError } from "./errors";
import { AI_MODELS, DEFAULT_MODEL, QUALITY_MODEL, USD_TO_EUR, estimateCostEur } from "./models";
import { extractJson, parseTranslations, parseVersions } from "./parse";
import {
  buildExamplesBlock,
  buildRulesBlock,
  buildSystemBlocks,
  buildUserMessage,
  maxLengthFor,
  resolveRiskNotice,
} from "./prompt";
import { suggest } from "./suggest";
import { DEFAULT_RISK_NOTICE, type AiClient, type AiMessageRequest, type AiRequest } from "./types";
import { createAnthropicClient, verifyApiKey } from "./client";
import {
  ensureRiskNotice,
  hasAdultMention,
  hasRiskNotice,
  linksOf,
  placeholdersOf,
  validateVersion,
} from "./validate";

const NOTICE = resolveRiskNotice(null);
const usage = { inputTokens: 2000, outputTokens: 800, cachedTokens: 0, cacheWriteTokens: 0 };

/** Client simulé : renvoie les réponses dans l'ordre et mémorise les requêtes. */
function fakeClient(responses: string[]): AiClient & { calls: AiMessageRequest[] } {
  const calls: AiMessageRequest[] = [];
  return {
    calls,
    async createMessage(req) {
      calls.push(req);
      const text = responses[calls.length - 1] ?? responses.at(-1) ?? "";
      return { text, usage, stopReason: "end_turn" };
    },
  };
}

const base: AiRequest = {
  kind: "improve",
  text: "Bonjour {prenom}, l'offre <b>{offre}</b> est ouverte : https://go.goolink.eu/abc",
  context: { vertical: "CASINO", language: "fr", surface: "post", hasMedia: false },
  model: DEFAULT_MODEL,
};

const json = (versions: Array<{ text: string; why?: string }>) => JSON.stringify({ versions });

describe("prompt système", () => {
  it("contient toutes les règles imposées et la mention des risques réglable", () => {
    const rules = buildRulesBlock(resolveRiskNotice({ casino: "Texte casino perso.", sports: "" }));
    for (const s of [
      "promesse de gains",
      "argent facile",
      "18+",
      "Texte casino perso.",
      DEFAULT_RISK_NOTICE.sports,
      "faux témoignage",
      "[à compléter]",
      "adultes uniquement",
      "mineurs",
      "<tg-spoiler>",
      "1024",
      "4096",
      "{prenom}",
      "liens",
    ]) {
      expect(rules).toContain(s);
    }
  });
  it("met les règles puis les exemples en cache, sans bloc d'exemples s'il n'y en a pas", () => {
    expect(buildSystemBlocks(base)).toHaveLength(1);
    const blocks = buildSystemBlocks({
      ...base,
      examples: [{ text: "Exemple A", note: "12 % de clics" }, { text: " " }],
    });
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.cache)).toBe(true);
    expect(blocks[1]!.text).toContain("Exemple 1 (12 % de clics)");
    expect(buildExamplesBlock([{ text: " " }])).toBeNull();
  });
  it("décrit le contexte, le brouillon et le format JSON dans le message utilisateur", () => {
    const msg = buildUserMessage({
      ...base,
      context: {
        ...base.context,
        objective: "signup",
        tone: "sober",
        length: "short",
        categoryName: "Bonus",
        hasMedia: true,
      },
    });
    for (const s of [
      "Casino",
      "Inscription",
      "Sobre",
      "Court",
      "Bonus",
      "1024",
      base.text,
      '"versions"',
      "exactement 3",
    ])
      expect(msg).toContain(s);
    expect(maxLengthFor({ hasMedia: true })).toBe(1024);
    expect(maxLengthFor({})).toBe(4096);
  });
  it("demande les 5 autres langues pour une traduction", () => {
    const msg = buildUserMessage({ ...base, kind: "translate" });
    expect(msg).toContain('"translations"');
    expect(msg).toContain("en (Anglais)");
    expect(msg).not.toContain('"fr": "texte');
  });
  it("langue d'un texte du bot hors des 6 langues principales (russe…) : la demande est faite dans cette langue", () => {
    const ru = { ...base.context, language: "ru" as const };
    expect(buildUserMessage({ ...base, context: ru })).toContain("Langue : Russe.");
    expect(buildUserMessage({ ...base, context: { ...base.context, language: "ar" } })).toContain(
      "Langue : Arabe.",
    );
    // Traduction depuis le russe : vers les 6 langues principales du bot (français compris), jamais vers lui-même.
    const tr = buildUserMessage({ ...base, kind: "translate", context: ru });
    expect(tr).toContain('"fr": "texte');
    expect(tr).toContain('"it": "texte');
    expect(tr).not.toContain('"ru": "texte');
    expect(tr).not.toContain('"ar": "texte');
  });
  it("écrit une idée au lieu d'un brouillon", () => {
    expect(buildUserMessage({ ...base, kind: "idea", text: "bonus du week-end" })).toContain(
      "IDÉE",
    );
  });
});

describe("parsing strict", () => {
  it("accepte un JSON nu ou dans un bloc de code, limite à 3 versions", () => {
    const v = parseVersions(
      "```json\n" +
        json([{ text: "a", why: "x" }, { text: "b" }, { text: "c", why: "z" }, { text: "d" }]) +
        "\n```",
    );
    expect(v).toHaveLength(3);
    expect(v[1]!.why).toBe("Version reformulée.");
    expect(extractJson('Voici : {"versions": []} merci')).toEqual({ versions: [] });
  });
  it("rejette une sortie invalide avec une erreur lisible", () => {
    expect(() => parseVersions("pas du json")).toThrow(AiError);
    expect(() => parseVersions('{"autre": 1}')).toThrow(/versions/);
    expect(() => parseVersions(json([{ text: "" }]))).toThrow(/aucune version/);
  });
  it("lit les traductions par langue connue", () => {
    const t = parseTranslations(
      JSON.stringify({ translations: { en: "Hello", xx: "?", es: "Hola" } }),
    );
    expect(t.map((x) => x.lang)).toEqual(["en", "es"]);
    expect(t[0]!.why).toContain("anglais");
    const ru = parseTranslations(JSON.stringify({ translations: { ru: "Привет", nl: "Hallo" } }));
    expect(ru.map((x) => [x.lang, x.why])).toEqual([
      ["nl", "Traduction : néerlandais."],
      ["ru", "Traduction : russe."],
    ]);
    expect(() => parseTranslations("{}")).toThrow(/traductions/);
  });
});

describe("validation côté code", () => {
  it("repère les placeholders et les liens", () => {
    expect(placeholdersOf("{prenom} et {canal} et {prenom}")).toEqual(["{prenom}", "{canal}"]);
    expect(linksOf('voir https://a.b/c, et <a href="https://x.y/z">ici</a>.')).toEqual([
      "https://a.b/c",
      "https://x.y/z",
    ]);
  });
  it("ajoute la mention des risques et 18+ quand elles manquent (casino, paris), pas pour le dating", () => {
    const out = ensureRiskNotice("Texte", "CASINO", NOTICE, "fr");
    expect(out).toBe(`Texte\n\n<i>${DEFAULT_RISK_NOTICE.casino} 18+</i>`);
    expect(ensureRiskNotice("Texte", "DATING", NOTICE, "fr")).toBe("Texte");
    const already = `Texte\n<i>${DEFAULT_RISK_NOTICE.sports}</i> 18+`;
    expect(ensureRiskNotice(already, "SPORTS", NOTICE, "fr")).toBe(already);
    expect(
      ensureRiskNotice(
        "Texte <i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
        "SPORTS",
        NOTICE,
        "fr",
      ),
    ).toMatch(/<i>18\+<\/i>$/);
    expect(
      hasRiskNotice(
        "JOUER COMPORTE DES RISQUES: endettement, isolement, dependance",
        NOTICE.casino,
      ),
    ).toBe(true);
    expect(hasAdultMention("Réservé aux 18 +")).toBe(true);
  });
  it("hors français, exige seulement 18+", () => {
    expect(ensureRiskNotice("Gambling involves risks. 18+", "CASINO", NOTICE, "en")).toBe(
      "Gambling involves risks. 18+",
    );
    expect(ensureRiskNotice("Gambling text", "CASINO", NOTICE, "en")).toContain("18+");
  });
  it("refuse une version qui perd un repère ou un lien, ou qui en invente", () => {
    const input = {
      source: base.text,
      context: base.context,
      notice: NOTICE,
      max: 4096,
      checkSource: true,
    };
    expect(
      validateVersion(
        { text: "Bonjour, l'offre {offre} : https://go.goolink.eu/abc", why: "" },
        input,
      ),
    ).toEqual({ ok: false, reason: "Repère(s) perdu(s) : {prenom}." });
    expect(
      validateVersion({ text: "Bonjour {prenom}, l'offre {offre} est là", why: "" }, input),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("Lien(s) perdu(s)") });
    expect(
      validateVersion(
        { text: "{prenom} {offre} https://go.goolink.eu/abc {bonus_invente}", why: "" },
        input,
      ),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("inconnu") });
  });
  it("normalise le HTML, remplace les balises refusées par du texte, et contrôle la longueur", () => {
    const input = {
      source: "x",
      context: { vertical: "DATING" as const, hasMedia: true },
      notice: NOTICE,
      max: 1024,
      checkSource: false,
    };
    const ok = validateVersion({ text: "<B>Salut</B> <div>toi</div>", why: "w" }, input);
    expect(ok).toEqual({ ok: true, version: { text: "Salut toi", why: "w" } });
    expect(validateVersion({ text: "<b>Gras</b> &amp; <i>fin</i>", why: "w" }, input)).toEqual({
      ok: true,
      version: { text: "<b>Gras</b> &amp; <i>fin</i>", why: "w" },
    });
    expect(validateVersion({ text: "a".repeat(1025), why: "w" }, input)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Trop long"),
    });
    expect(validateVersion({ text: "   ", why: "w" }, input)).toEqual({
      ok: false,
      reason: "Texte vide.",
    });
  });
  it("ajoute la mention pendant la validation d'une version casino", () => {
    const out = validateVersion(
      { text: "Bonjour {prenom}, <b>{offre}</b> : https://go.goolink.eu/abc", why: "w" },
      { source: base.text, context: base.context, notice: NOTICE, max: 4096, checkSource: true },
    );
    expect(out.ok && out.version.text.endsWith(`<i>${DEFAULT_RISK_NOTICE.casino} 18+</i>`)).toBe(
      true,
    );
  });
});

describe("coût estimé", () => {
  it("applique les prix publics, le cache et le taux USD→EUR", () => {
    expect(USD_TO_EUR).toBe(0.92);
    const haiku = estimateCostEur("claude-haiku-5-5", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(haiku).toBe(0.092);
    const out = estimateCostEur("claude-sonnet-5-5", {
      inputTokens: 0,
      outputTokens: 1_000_000,
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(out).toBe(9.2);
    const cached = estimateCostEur("claude-haiku-5-5", {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    expect(cached).toBe(Math.round(0.1 * (0.1 + 1.25) * 0.92 * 10_000) / 10_000);
    expect(
      estimateCostEur("inconnu", {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(
      estimateCostEur(QUALITY_MODEL, {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
      }),
    );
    expect(Object.keys(AI_MODELS)).toContain(DEFAULT_MODEL);
  });
});

describe("suggest (client simulé)", () => {
  const good = json([
    {
      text: "Salut {prenom} ! <b>{offre}</b> t'attend : https://go.goolink.eu/abc",
      why: "Plus direct.",
    },
    { text: "{prenom}, découvre {offre} ici https://go.goolink.eu/abc", why: "Plus court." },
    { text: "Envie de tester {offre}, {prenom} ? https://go.goolink.eu/abc", why: "Question." },
  ]);
  it("renvoie 3 versions validées avec mention ajoutée, usage et coût", async () => {
    const client = fakeClient([good]);
    const res = await suggest(base, client);
    expect(res.versions).toHaveLength(3);
    expect(res.versions.every((v) => v.text.includes("18+"))).toBe(true);
    expect(res.usage.inputTokens).toBe(2000);
    expect(res.costEur).toBeGreaterThan(0);
    expect(res.rejected).toEqual([]);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.system[0]!.cache).toBe(true);
    expect(client.calls[0]!.system[0]!.text).toContain("RÈGLES ABSOLUES");
    expect(client.calls[0]!.user).toContain(base.text);
  });
  it("réessaie une fois après une sortie invalide, puis réussit", async () => {
    const client = fakeClient(["n'importe quoi", good]);
    const res = await suggest(base, client);
    expect(res.versions).toHaveLength(3);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.user).toContain("RAPPEL");
    expect(res.usage.inputTokens).toBe(4000);
  });
  it("échoue lisiblement après deux sorties invalides", async () => {
    await expect(suggest(base, fakeClient(["x", "y"]))).rejects.toThrow(
      /pas donné de version utilisable/,
    );
  });
  it("écarte les versions qui perdent un repère et réessaie si aucune ne reste", async () => {
    const bad = json([{ text: "Sans repère ni lien", why: "" }]);
    const client = fakeClient([bad, good]);
    const res = await suggest(base, client);
    expect(client.calls).toHaveLength(2);
    expect(res.rejected[0]!.reason).toContain("Repère");
    expect(res.versions).toHaveLength(3);
  });
  it("ne vérifie pas les repères pour une idée, et renvoie les traductions par langue", async () => {
    const idea = await suggest(
      { ...base, kind: "idea", text: "bonus du week-end", context: { vertical: "DATING" } },
      fakeClient([
        json([
          { text: "Proposition 1", why: "a" },
          { text: "Proposition 2", why: "b" },
        ]),
      ]),
    );
    expect(idea.versions.map((v) => v.text)).toEqual(["Proposition 1", "Proposition 2"]);
    const tr = await suggest(
      { ...base, kind: "translate" },
      fakeClient([
        JSON.stringify({
          translations: {
            en: "Hi {prenom}, <b>{offre}</b> is open: https://go.goolink.eu/abc 18+",
            es: "Hola {prenom}, <b>{offre}</b>: https://go.goolink.eu/abc",
          },
        }),
      ]),
    );
    expect(tr.versions.map((v) => v.lang)).toEqual(["en", "es"]);
    expect(tr.versions[1]!.text).toContain("18+");
  });
  it("refuse un brouillon vide sans appeler le client", async () => {
    const client = fakeClient([good]);
    await expect(suggest({ ...base, text: "  " }, client)).rejects.toThrow(/brouillon/);
    expect(client.calls).toHaveLength(0);
  });
});

describe("vérification de clé", () => {
  it("renvoie ok avec un client simulé, et une erreur lisible sinon", async () => {
    expect(await verifyApiKey("sk-ant-test", DEFAULT_MODEL, fakeClient(["ok"]))).toEqual({
      ok: true,
      usage,
    });
    const failing: AiClient = {
      createMessage: async () => {
        throw new AiError("auth", "Clé refusée.");
      },
    };
    expect(await verifyApiKey("sk-ant-test", DEFAULT_MODEL, failing)).toEqual({
      ok: false,
      error: "Clé refusée.",
    });
  });
});

describe("réponse coupée (stop_reason max_tokens) et réglages d'appel", () => {
  const good = json([
    {
      text: "Salut {prenom} ! <b>{offre}</b> t'attend : https://go.goolink.eu/abc",
      why: "Plus direct.",
    },
  ]);
  it("demande 16 000 jetons au maximum (la réflexion du modèle compte dedans)", async () => {
    const client = fakeClient([good]);
    await suggest(base, client);
    expect(client.calls[0]!.maxTokens).toBe(16_000);
  });
  it("lève une erreur lisible sans nouvel essai, avec l'usage facturé", async () => {
    const calls: AiMessageRequest[] = [];
    const client: AiClient = {
      async createMessage(req) {
        calls.push(req);
        return { text: '{"versions": [{"text": "Début coupé', usage, stopReason: "max_tokens" };
      },
    };
    const err = await suggest(base, client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("too_long");
    expect((err as AiError).message).toMatch(/trop long.*Court/i);
    expect((err as AiError).usage).toEqual(usage);
    expect((err as AiError).costEur).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });
  it("joint l'usage cumulé à l'erreur après deux sorties invalides", async () => {
    const err = await suggest(base, fakeClient(["x", "y"])).catch((e: unknown) => e);
    expect((err as AiError).usage?.inputTokens).toBe(4000);
  });
});

describe("client Anthropic réel (fetch simulé, aucun appel réseau)", () => {
  function fakeFetch(body: Record<string, unknown>) {
    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl = async (_url: unknown, init?: { body?: unknown }) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", "request-id": "req_test" },
      });
    };
    return { requests, fetchImpl };
  }
  const message = (stop: string) => ({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    content: [{ type: "text", text: '{"versions": []}' }],
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 3,
    },
  });
  it("envoie l'effort « low », le plafond de jetons et le cache du prompt système", async () => {
    const { requests, fetchImpl } = fakeFetch(message("end_turn"));
    const client = createAnthropicClient("sk-ant-test", {
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.createMessage({
      model: DEFAULT_MODEL,
      maxTokens: 16_000,
      system: [{ text: "Règles", cache: true }],
      user: "Bonjour",
    });
    expect(requests[0]).toMatchObject({
      model: DEFAULT_MODEL,
      max_tokens: 16_000,
      output_config: { effort: "low" },
      system: [{ type: "text", text: "Règles", cache_control: { type: "ephemeral" } }],
    });
    expect(res).toEqual({
      text: '{"versions": []}',
      usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 3, cacheWriteTokens: 0 },
      stopReason: "end_turn",
    });
  });
  it("transmet stop_reason max_tokens au lieu de le masquer", async () => {
    const { fetchImpl } = fakeFetch(message("max_tokens"));
    const client = createAnthropicClient("sk-ant-test", {
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.createMessage({
      model: DEFAULT_MODEL,
      maxTokens: 100,
      system: [],
      user: "x",
    });
    expect(res.stopReason).toBe("max_tokens");
  });
});
