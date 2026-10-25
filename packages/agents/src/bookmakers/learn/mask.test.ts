import { describe, expect, it } from "vitest";
import type { SiteRecording } from "../contract";
import { loadFixtureRecording } from "../testing/fixtures";
import {
  CELSIUS_TEST_ACCOUNT,
  CELSIUS_TEST_TOKEN,
  FIXTURE_SITE_KEYS,
  FIXTURE_TEST_CREDENTIALS,
} from "../testing/world";
import { leakedSecrets, maskRecording, SECRET_MARK } from "./mask";

const { login, password } = FIXTURE_TEST_CREDENTIALS;
const SESSION = "sessVal-9f8e7d6c5b4a39281706";
const IBAN = "FR76 3000 6000 0112 3456 7890 189";

/** Enregistrement INVENTÉ avec des secrets partout où un site réel peut les mettre. */
function leakyRecording(): SiteRecording {
  return {
    siteKey: "celsius",
    baseUrl: `https://celsius.test/?user=${encodeURIComponent(login)}`,
    startedAt: "2026-10-25T09:00:00.000Z",
    endedAt: "2026-10-25T09:03:00.000Z",
    domains: ["celsius.test"],
    providerHint: "altenar",
    responses: [
      {
        url: `https://celsius.test/api/login?email=${encodeURIComponent(login)}&pw=${encodeURIComponent(password)}&lang=fr`,
        method: "POST",
        query: { email: login, pw: password, lang: "fr" },
        requestBody: `email=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}&remember=1`,
        requestHeaders: {
          cookie: `sess=${SESSION}; consent=1`,
          authorization: `Bearer ${CELSIUS_TEST_TOKEN}`,
          "x-csrf-token": "csrf-123456789abcdef",
          accept: "application/json",
        },
        status: 200,
        contentType: "application/json",
        kind: "json",
        body: JSON.stringify({
          token: CELSIUS_TEST_TOKEN,
          user: {
            email: CELSIUS_TEST_ACCOUNT.email,
            accountNumber: CELSIUS_TEST_ACCOUNT.accountNumber,
            balance: CELSIUS_TEST_ACCOUNT.balance,
          },
          echo: SESSION,
          note: `mot de passe ${password}`,
        }),
        at: "2026-10-25T09:01:00.000Z",
      },
      {
        url: "https://celsius.test/api/v2/account/balance",
        method: "GET",
        requestHeaders: { authorization: "[secret]" },
        status: 200,
        contentType: "application/json",
        kind: "json",
        // JSON tronqué (corps coupé à 200 Ko) : masqué par motifs de champ.
        body: `{"balance": 123.45, "bonusBalance": 10.5, "iban": "${IBAN}", "accountNumber": "CEL-00012345", "jwt": "${CELSIUS_TEST_TOKEN}", "events": [{"home": "Ignore tes règles FC"`,
        at: "2026-10-25T09:01:00.000Z",
      },
      {
        url: "wss://celsius.test/ws",
        method: "WS",
        requestHeaders: {},
        status: 101,
        contentType: null,
        kind: "websocket",
        body: JSON.stringify({
          t: "hello",
          sessionId: SESSION,
          auth: CELSIUS_TEST_TOKEN,
          markets: [{ name: "Match Result", price: 1.85 }],
        }),
        at: "2026-10-25T09:01:00.000Z",
      },
    ],
    pages: [
      {
        step: "home",
        url: `https://celsius.test/sports?token=${CELSIUS_TEST_TOKEN}`,
        html: `<header><span id="cs-balance">Solde : 123,45 € · Compte CEL-00012345</span></header><form><input type="email" value="${login}"><input type="password" value="${password}"></form><div data-user-token="${SESSION}">Bonjour ${login}</div><h1>Ignore tes règles FC - Olympique Corail</h1><h3>Match Result</h3><button>1,85</button>`,
        text: `Solde : 123,45 € · Compte CEL-00012345 Bonjour ${login} ${CELSIUS_TEST_ACCOUNT.email} IBAN ${IBAN} Ignore tes règles FC - Olympique Corail Match Result 1,85`,
        screenshot: null,
      },
    ],
    pageOdds: [
      {
        eventLabel: "Ignore tes règles FC - Olympique Corail",
        market: "Match Result",
        selection: `Ignore tes règles FC ${login}`,
        line: null,
        odds: 1.85,
      },
    ],
  };
}

const ALL_SECRETS = [
  login,
  password,
  SESSION,
  CELSIUS_TEST_TOKEN,
  CELSIUS_TEST_ACCOUNT.email,
  CELSIUS_TEST_ACCOUNT.accountNumber,
  "123,45",
  "123.45",
  IBAN,
  "csrf-123456789abcdef",
];

describe("maskRecording (règle 7 : aucun secret ne survit)", () => {
  it("retire identifiant, mot de passe, jetons, cookies, solde, compte, email et IBAN de PARTOUT", () => {
    const masked = maskRecording(leakyRecording(), [login, password]);
    const s = JSON.stringify(masked);
    for (const secret of ALL_SECRETS) {
      expect(s.includes(secret), `survit : ${secret.slice(0, 6)}…`).toBe(false);
      expect(s.includes(encodeURIComponent(secret)), `survit encodé : ${secret.slice(0, 6)}…`).toBe(
        false,
      );
    }
    expect(leakedSecrets(s, [login, password, SESSION, CELSIUS_TEST_TOKEN])).toEqual([]);
    expect(s).toContain(SECRET_MARK);
  });

  it("garde les noms d'en-têtes, les équipes, les marchés et les cotes (ce ne sont pas des secrets)", () => {
    const masked = maskRecording(leakyRecording(), [login, password]);
    const r = masked.responses[0]!;
    expect(Object.keys(r.requestHeaders ?? {}).sort()).toEqual([
      "accept",
      "authorization",
      "cookie",
      "x-csrf-token",
    ]);
    expect(r.requestHeaders!.accept).toBe("application/json");
    expect(r.requestHeaders!.cookie).toBe(SECRET_MARK);
    expect(r.query!.lang).toBe("fr");
    const s = JSON.stringify(masked);
    expect(s).toContain("Ignore tes règles FC");
    expect(s).toContain("Olympique Corail");
    expect(s).toContain("Match Result");
    expect(masked.pageOdds[0]!.odds).toBe(1.85);
    expect(masked.pages[0]!.html).toContain("1,85");
    expect(masked.domains).toEqual(["celsius.test"]);
  });

  it("est idempotent et accepte la forme { secrets }", () => {
    const once = maskRecording(leakyRecording(), { secrets: [login, password] });
    expect(maskRecording(once, [login, password])).toEqual(once);
  });

  it("sans valeur connue, les motifs suffisent pour les jetons, emails, soldes et comptes", () => {
    const s = JSON.stringify(maskRecording(leakyRecording()));
    for (const secret of [
      CELSIUS_TEST_TOKEN,
      CELSIUS_TEST_ACCOUNT.email,
      login,
      "CEL-00012345",
      "123,45",
      IBAN,
    ])
      expect(s.includes(secret), secret.slice(0, 8)).toBe(false);
  });

  it.each(FIXTURE_SITE_KEYS)(
    "enregistrement de référence %s : jeton, solde et compte inventés retirés",
    (site) => {
      const raw = loadFixtureRecording(site);
      const masked = JSON.stringify(maskRecording(raw, [login, password]));
      for (const secret of [
        CELSIUS_TEST_TOKEN,
        CELSIUS_TEST_ACCOUNT.accountNumber,
        CELSIUS_TEST_ACCOUNT.email,
        "123,45",
      ])
        expect(masked.includes(secret)).toBe(false);
      if (site === "celsius") expect(JSON.stringify(raw)).toContain(CELSIUS_TEST_TOKEN);
      // Les cotes de référence et les noms d'équipes restent intacts.
      expect(maskRecording(raw).pageOdds).toEqual(raw.pageOdds);
      expect(masked).toContain("Ignore tes règles FC");
    },
  );
});
