import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash, REDACTED, redactDetailed, redactForQa, redactText } from "./redact";

describe("redactForQa : chaque type de donnée sensible est masqué", () => {
  const cases: Array<[string, string, string]> = [
    ["jeton de bot Telegram", "Jeton : 7234567891:AAHk3j2l4k5j6h7g8f9d0s1a2q3w4e5r6t7y8 à garder", "7234567891:AAHk3j2l4k5j6h7g8f9d0s1a2q3w4e5r6t7y8"],
    ["clé Anthropic", "clé sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 ok", "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"],
    ["clé OpenAI de projet", "sk-proj-abcdefghijklmnop1234", "sk-proj-abcdefghijklmnop1234"],
    ["clé Stripe", "rk_live_51HxYzAbCdEfGhIj", "rk_live_51HxYzAbCdEfGhIj"],
    ["jeton GitHub", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["clé AWS", "AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"],
    ["clé Google", "AIzaSyA-1234567890abcdefghijklmnopqrstu", "AIzaSyA-1234567890abcdefghijklmnopqrstu"],
    ["jeton Slack", "xoxb-1234567890-abcdefghij", "xoxb-1234567890-abcdefghij"],
    ["Bearer", "Authorization: Bearer abc.def-123_456~xyz", "abc.def-123_456~xyz"],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "eyJhbGciOiJIUzI1NiJ9"],
    ["mot de passe", "mot de passe : Soleil2026!", "Soleil2026!"],
    ["password=", "password=hunter22", "hunter22"],
    ["mdp", "mdp → azerty123", "azerty123"],
    ["secret dans une adresse", "https://site.fr/x?token=abcdef123456&lang=fr", "abcdef123456"],
    ["courriel", "écris à jean.dupont@gmail.com vite", "jean.dupont@gmail.com"],
    ["téléphone français", "appelle le 06 12 34 56 78", "06 12 34 56 78"],
    ["téléphone collé", "0612345678", "0612345678"],
    ["téléphone international", "+33 6 12 34 56 78", "+33 6 12 34 56 78"],
    ["téléphone anglais", "+44 20 7946 0958", "+44 20 7946 0958"],
    ["IBAN", "IBAN FR76 3000 6000 0112 3456 7890 189", "FR76 3000 6000 0112 3456 7890 189"],
    ["IBAN collé", "FR7630006000011234567890189", "FR7630006000011234567890189"],
    ["carte bancaire", "carte 4111 1111 1111 1111", "4111 1111 1111 1111"],
    ["cuid", "post ckz1a2b3c4d5e6f7g8h9i0j1k", "ckz1a2b3c4d5e6f7g8h9i0j1k"],
    ["UUID", "id 123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174000"],
    ["hexadécimal long", "empreinte 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "9f86d081884c7d659a2feaa0c55ad015"],
    ["identifiant de groupe Telegram", "groupe -1001234567890", "-1001234567890"],
    ["identifiant d'utilisateur Telegram", "utilisateur 5123456789", "5123456789"],
  ];
  it.each(cases)("%s", (_label, text, secret) => {
    const r = redactText(text);
    expect(r.text).not.toContain(secret);
    expect(r.text).toContain(REDACTED);
    expect(r.found.length).toBeGreaterThan(0);
  });

  it("ne touche pas un texte ordinaire (chiffres, cotes, heures, adresses publiques, pourcentages)", () => {
    const plain = [
      "Ce soir 21 h : tournoi, 42 inscriptions, 7 premiers dépôts, 120 € de pub.",
      "Cote 1,85 sur le match de 20:45, +12 % sur la semaine, 1 234 vues.",
      "Lien : https://go.goolink.eu/o/ab12cd et https://www.reddit.com/r/Affiliatemarketing/comments/q1x2y3/meta_casino_ads_france/",
      "Ton mot de passe est perdu ? Va dans Réglages.",
      "Le 26/10/2026 à 01:30, durée 30 000 ms.",
    ];
    for (const t of plain) expect(redactText(t)).toEqual({ text: t, found: [] });
  });

  it("champs secrets et techniques d'un objet : masqués ; seuls les secrets comptent comme fuite", () => {
    const input = { postId: "ckz1a2b3c4d5e6f7g8h9i0j1k", sourceEntryIds: ["a", "b"], password: "x1y2z3", nested: { apiKey: "abc", text: "ok" }, n: 12, b: true };
    const r = redactDetailed(input);
    expect(r.value).toEqual({ postId: REDACTED, sourceEntryIds: [REDACTED, REDACTED], password: REDACTED, nested: { apiKey: REDACTED, text: "ok" }, n: 12, b: true });
    expect(r.found).toEqual(["password"]);
    expect(redactDetailed({ postId: "ckz1a2b3c4d5e6f7g8h9i0j1k" }).found).toEqual([]);
  });

  it("ne modifie jamais l'original", () => {
    const input = Object.freeze({ text: "jean@ex.fr", list: Object.freeze(["06 12 34 56 78"]) });
    const before = JSON.stringify(input);
    redactForQa(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("dates, entiers longs, valeurs circulaires", () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(redactForQa({ at: new Date("2026-10-26T00:00:00Z"), big: 12n, loop })).toEqual({ at: "2026-10-26T00:00:00.000Z", big: "12", loop: { a: 1, self: null } });
  });
});

describe("contentHash", () => {
  it("indépendant de l'ordre des clés, sensible au moindre changement", () => {
    expect(contentHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(contentHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(contentHash({ text: "Bonjour" })).not.toBe(contentHash({ text: "Bonjour " }));
    expect(contentHash({ a: [1, 2] })).not.toBe(contentHash({ a: [2, 1] }));
    expect(contentHash({ a: 1, u: undefined })).toBe(contentHash({ a: 1 }));
    expect(contentHash({ text: "x" })).toMatch(/^[0-9a-f]{64}$/);
  });
  it("JSON canonique", () => {
    expect(canonicalJson({ b: 1, a: new Date("2026-01-01T00:00:00Z"), c: 5n })).toBe('{"a":"2026-01-01T00:00:00.000Z","b":1,"c":"5"}');
  });
});
