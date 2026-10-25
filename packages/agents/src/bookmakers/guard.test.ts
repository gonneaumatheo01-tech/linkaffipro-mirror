/**
 * Phase 35 (règle 1) : garde « jamais de mise » étendue à la lecture. Règles pures, puis test adverse par ANALYSE
 * STATIQUE : aucune fonction du lecteur (transport, lecture, apprentissage, fournisseur direct) ne peut atteindre une
 * page ou un bouton sans passer par la garde (`GuardedPage`, `forbiddenApiCallReason`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { forbiddenApiCallReason, forbiddenFrameUrlReason, forbiddenReadClickReason, forbiddenReadUrlReason, readClickExtraReason } from "./guard";

const HOSTS = ["sportaza.com"];

describe("adresses de lecture", () => {
  it.each([
    "https://sportaza.com/fr/deposit",
    "https://sportaza.com/fr/withdraw",
    "https://sportaza.com/fr/cashier",
    "https://cashier.sportaza.com/",
    "https://sportaza.com/fr/sports?modal=deposit",
    "https://sportaza.com/fr/sports#/cashier/deposit",
    "https://sportaza.com/fr/sports/betslip",
    "https://sportaza.com/fr/coupon",
    "https://sportaza.com/fr/sports/place-bet",
    "https://sportaza.com/fr/profile",
    "https://sportaza.com/fr/account/settings",
    "https://sportaza.com/fr/my-bets",
    "https://sportaza.com/fr/bonus",
    "https://sportaza.com/fr/rewards",
    "https://sportaza.com/fr/sports?tab=%2564eposit",
    "https://evil.example/fr/sports",
    "javascript:alert(1)",
  ])("refusée : %s", (url) => {
    expect(forbiddenReadUrlReason(url, HOSTS)).not.toBeNull();
  });

  it.each(["https://sportaza.com/fr/sports", "https://sportaza.com/fr/sports/football/ligue-1", "https://sportaza.com/api/v2/events?date=2026-11-10&sport=football", "https://sportaza.com/fr/login"])(
    "permise : %s",
    (url) => {
      expect(forbiddenReadUrlReason(url, HOSTS)).toBeNull();
    },
  );

  it("cadres : moteur de paris tiers permis, sa caisse jamais", () => {
    expect(forbiddenFrameUrlReason("https://sb.betby.com/sportsbook?lang=fr")).toBeNull();
    expect(forbiddenFrameUrlReason("https://cashier.betby.com/")).not.toBeNull();
    expect(forbiddenFrameUrlReason("https://sb.betby.com/betslip")).not.toBeNull();
    expect(forbiddenFrameUrlReason("https://pay.example.com/checkout")).not.toBeNull();
  });
});

describe("clics de lecture", () => {
  const el = (text: string, o: Partial<{ attributes: string[]; tag: string; type: string; ownText: string; nestedTexts: string[] }> = {}) => ({ text, attributes: [], ...o });

  it.each([
    ["Placer le pari", {}],
    ["Parier", {}],
    ["Miser 10 €", {}],
    ["Valider mon ticket", {}],
    ["Déposer", {}],
    ["Retrait", {}],
    ["Caisse", {}],
    ["Mon compte", {}],
    ["Ajouter au coupon", {}],
    ["Confirmer", {}],
    ["Cash out", {}],
    ["1,85", {}],
    ["2.10", {}],
    ["PSG", { attributes: ['class="outcome-button"'] }],
    ["Voir", { attributes: ['data-odds-id="1"'] }],
    ["Over 2.5 — 1,90", {}],
    ["Résultat", { nestedTexts: ["1,85", "3,40"] }],
    ["Envoyer", { type: "submit" }],
  ])("refusé : %s", (text, o) => {
    expect(forbiddenReadClickReason(el(text, o))).not.toBeNull();
  });

  it.each(["Football", "Aujourd'hui", "Demain", "Corners", "Buts", "Voir plus", "Ligue 1"])("permis : %s", (text) => {
    expect(forbiddenReadClickReason(el(text))).toBeNull();
  });

  it("aucun motif ne lève l'interdiction d'une mise", () => {
    for (const purpose of ["cookie_accept", "login_submit", "open_login", "market_tab", "show_more"] as const) {
      expect(readClickExtraReason(el("Ajouter au coupon"), purpose)).not.toBeNull();
      expect(readClickExtraReason(el("1,85"), purpose)).not.toBeNull();
    }
    expect(readClickExtraReason(el("Accepter", { attributes: ['id="cookie-accept"'] }), "cookie_accept")).toBeNull();
  });
});

describe("appels d'API", () => {
  it("lecture seule : GET, ou POST de lecture", () => {
    expect(forbiddenApiCallReason({ method: "GET", url: "https://sportaza.com/api/events" }, HOSTS)).toBeNull();
    expect(forbiddenApiCallReason({ method: "POST", url: "https://sportaza.com/graphql", body: '{"query":"query { events { id } }"}' }, HOSTS)).toBeNull();
    for (const m of ["PUT", "PATCH", "DELETE"]) expect(forbiddenApiCallReason({ method: m, url: "https://sportaza.com/api/events" }, HOSTS)).not.toBeNull();
    for (const body of ['{"query":"mutation { placeBet(id: 1) }"}', '{"stake": 10}', '{"amount": 5}', '{"op":"addToSlip"}', '{"password":"x"}'])
      expect(forbiddenApiCallReason({ method: "POST", url: "https://sportaza.com/graphql", body }, HOSTS)).not.toBeNull();
    expect(forbiddenApiCallReason({ method: "GET", url: "https://sportaza.com/api/wallet/balance" }, HOSTS)).not.toBeNull();
    expect(forbiddenApiCallReason({ method: "GET", url: "https://sportaza.com/api/betslip" }, HOSTS)).not.toBeNull();
  });

  it("relecture adverse : mutation nommée, mise au pluriel ou en préfixe, POST vers un point d'entrée de paris", () => {
    for (const body of [
      '{"query":"mutation M { addSelection(id: 1) }"}',
      '{"selections":[{"id":1}],"stakes":[10]}',
      '{"stakeAmount":10}',
      '{"wagerId":3}',
    ])
      expect(forbiddenApiCallReason({ method: "POST", url: "https://sportaza.com/graphql", body }, HOSTS)).not.toBeNull();
    expect(forbiddenApiCallReason({ method: "POST", url: "https://sportaza.com/api/bets", body: '{"ids":[1]}' }, HOSTS)).not.toBeNull();
    expect(forbiddenApiCallReason({ method: "POST", url: "https://sportaza.com/api/v2/events", body: '{"sport":"football"}' }, HOSTS)).toBeNull();
  });
});

// ---------- analyse statique (test adverse) ----------

const SRC = fileURLToPath(new URL("../", import.meta.url));

/** Outils de test (faux transports vers 127.0.0.1) : hors du lecteur, et jamais importés par lui (vérifié plus bas). */
const TEST_ONLY = /^(test-|fake-)[\w-]*\.ts$/;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !TEST_ONLY.test(name)) out.push(p);
  }
  return out;
}

/** Code qui lit les bookmakers (hors outils de test, qui fabriquent les faux sites). */
function readerFiles(): string[] {
  const roots = ["bookmakers/transport", "bookmakers/read", "bookmakers/learn"].map((r) => join(SRC, r));
  const single = ["bookmakers/guard.ts", "bookmakers/jobs.ts", "providers/bookmaker-direct.ts", "sports/direct-odds.ts", "providers/screenshot/runner-api.ts"].map((f) => join(SRC, f));
  const all = [...roots.flatMap((r) => (safeIsDir(r) ? filesUnder(r) : [])), ...single.filter((f) => safeIsFile(f))];
  return all;
}
const safeIsDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const safeIsFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Sans commentaires (un commentaire peut citer `page.click`). */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/\s.*$/gm, "");
}

describe("analyse statique : aucun chemin vers une mise", () => {
  const files = readerFiles();

  it("le code du lecteur est bien trouvé", () => {
    expect(files.some((f) => f.endsWith("transport/server.ts"))).toBe(true);
    expect(files.length).toBeGreaterThan(5);
  });

  it("aucun outil de test importé par le code du lecteur", () => {
    for (const f of files) expect(code(f), f).not.toMatch(/from "\.{1,2}\/[\w/.-]*\/?(test-|fake-)[\w-]*"/);
  });

  it("aucune action brute de Playwright (double clic, toucher, cocher, souris, clavier, événement, envoi de formulaire)", () => {
    const bad = /\.(dblclick|tap|check|uncheck|selectOption|setInputFiles|dispatchEvent|dragTo|hover)\(|\.(mouse|keyboard|touchscreen)\.|\.submit\(\)|\.requestSubmit\(/;
    for (const f of files) {
      const hit = code(f)
        .split("\n")
        .find((l) => bad.test(l));
      expect(hit, `${f} : ${hit}`).toBeUndefined();
    }
  });

  it("tout clic passe par GuardedPage.click(cible, motif) ; aucun clic dans le code exécuté par la page", () => {
    for (const f of files) {
      const src = code(f);
      for (const m of src.matchAll(/\.click\(([^)]*)\)/g)) {
        const args = m[1]!.trim();
        // `GuardedPage.click(cible, "motif")` : deux arguments, le second est un motif (texte ou variable `purpose`).
        expect(args, `${f} : .click(${args})`).toMatch(/^[\w.!]+(\[[^\]]+\])?,\s*("[a-z_]+"|'[a-z_]+'|purpose)\s*(,|$)/);
      }
      expect(/\.click\(\)/.test(src), `${f} : .click() sans motif`).toBe(false);
    }
  });

  it("aucune navigation hors garde : `goto` seulement sur la page gardée", () => {
    for (const f of files) {
      for (const m of code(f).matchAll(/([\w.]+)\.goto\(/g)) {
        expect(m[1], `${f} : ${m[0]}`).toMatch(/(^|\.)(gp|guarded|page)$/);
        // `page` doit être une GuardedPage : seul server.ts / playwright-io.ts tiennent la page brute, sans `page.goto`.
        if (/(^|\.)page$/.test(m[1]!)) expect(code(f), f).toMatch(/GuardedPage|RecordIo/);
      }
    }
  });

  it("la page brute ne sort jamais du transport : seuls server.ts et l'adaptateur d'apprentissage créent une GuardedPage", () => {
    const creators = files.filter((f) => /new GuardedPage\(/.test(code(f))).map((f) => f.replace(SRC, ""));
    for (const c of creators) expect(["bookmakers/transport/server.ts", "bookmakers/learn/playwright-io.ts"]).toContain(c);
  });

  it("aucun appel réseau direct vers un site : `fetch` global seulement hors du lecteur", () => {
    for (const f of files) {
      const hit = code(f)
        .split("\n")
        .find((l) => /(await|return|=|\(|,|globalThis\.)\s*fetch\(/.test(l));
      expect(hit, `${f} : ${hit}`).toBeUndefined();
    }
  });

  it("le contexte de requêtes n'est appelé que derrière la garde d'API", () => {
    const server = code(join(SRC, "bookmakers/transport/server.ts"));
    const iGuard = server.indexOf("forbiddenApiCallReason({ method");
    const iFetch = server.indexOf("ctx.fetch(");
    expect(iGuard).toBeGreaterThan(0);
    expect(iFetch).toBeGreaterThan(iGuard);
    // Chaque redirection repasse par la garde avant d'être suivie.
    expect(server.slice(iFetch)).toMatch(/forbiddenReadUrlReason\(next/);
    // Navigations du navigateur : garde avant l'envoi et à chaque redirection.
    expect(server).toMatch(/context\.route\("\*\*\/\*", \(route: Route, req: PwRequest\) => guardNavigation\(/);
    expect(server).toMatch(/maxRedirects: 0/);
  });
});
