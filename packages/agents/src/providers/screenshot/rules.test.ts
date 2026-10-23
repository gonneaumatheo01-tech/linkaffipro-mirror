/** Règles pures de la capture : garde « jamais de mise », classement des erreurs, parade, lecture des cotes, file. */
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../../testing/fake-prisma";
import { splitSelector } from "./adapter";
import { mergeBookmakerConfig } from "./adapters";
import { captureBlocked, captureParade, classifyCaptureError, CaptureError, detectPageObstacle, looksLikeLoginFailure } from "./errors";
import { forbiddenClickReason, forbiddenFillReason, forbiddenUrlReason } from "./guard";
import { marketCandidates, oddsWithinTolerance, parseOddsText, textMatchesSelection, textMentionsMatch } from "./match";
import { claimNextCaptureRequest, completeCaptureRequest, createCaptureRequest, readCaptureRequest } from "./requests";
import { credentialsFrom, parseProxyUrl } from "./session";
import { parseCaptureSettings } from "./settings";
import { SPORTAZA_CONFIG } from "./sportaza";
import { renderFallbackHtml } from "./template";
import { TINY_PNG } from "./fake";

const d = (text: string, attributes: string[] = [], type: string | null = null) => ({ text, attributes, type });

describe("garde « jamais de mise »", () => {
  it("refuse miser / parier / déposer / retirer / payer / compte, en plusieurs langues", () => {
    for (const t of ["Parier", "Placer un pari", "Miser 10 €", "Place bet", "Bet now", "Apostar", "Wetten", "Déposer", "Dépôt", "Deposit", "Retrait", "Withdraw", "Payer", "Caisse", "Mon compte", "Modifier le profil", "Mot de passe oublié", "Auto-exclusion", "Inscription", "Déconnexion", "Cash out", "Mes paris"])
      expect(forbiddenClickReason(d(t), "market_tab"), t).not.toBeNull();
  });
  it("refuse par attributs : ticket, bouton de mise, caisse, cote cliquable", () => {
    expect(forbiddenClickReason(d("2,10", ["class=odds-button"]), "search_result")).not.toBeNull();
    expect(forbiddenClickReason(d("OK", ["class=betslip__submit"]), "login_submit")).not.toBeNull();
    expect(forbiddenClickReason(d("Go", ["href=/fr/cashier"]), "open_login")).not.toBeNull();
    expect(forbiddenClickReason(d("x", ["data-outcome-id=123"]), "market_tab")).not.toBeNull();
  });
  it("permet connexion, recherche, onglet de marché, cookies, et un match du PSG", () => {
    expect(forbiddenClickReason(d("Connexion", ["data-testid=login-button"]), "open_login")).toBeNull();
    expect(forbiddenClickReason(d("Se connecter", [], "submit"), "login_submit")).toBeNull();
    expect(forbiddenClickReason(d("Paris Saint-Germain - Olympique de Marseille", ["href=/fr/sports/match/psg-om"]), "search_result")).toBeNull();
    expect(forbiddenClickReason(d("Tirs cadrés", ["role=tab"]), "market_tab")).toBeNull();
    expect(forbiddenClickReason(d("Tout accepter", ["id=onetrust-accept-btn-handler"]), "cookie_accept")).toBeNull();
  });
  it("un bouton d'envoi hors connexion est refusé", () => {
    expect(forbiddenClickReason(d("Valider", [], "submit"), "market_tab")).not.toBeNull();
  });
  it("champs : mot de passe seulement dans un champ mot de passe, jamais de montant", () => {
    expect(forbiddenFillReason(d("", ["name=email"], "email"), "login")).toBeNull();
    expect(forbiddenFillReason(d("", ["name=password"], "password"), "password")).toBeNull();
    expect(forbiddenFillReason(d("", ["name=email"], "email"), "password")).not.toBeNull();
    expect(forbiddenFillReason(d("", ["name=stake"], "text"), "search")).not.toBeNull();
    expect(forbiddenFillReason(d("", ["name=amount"], "number"), "login")).not.toBeNull();
    expect(forbiddenFillReason(d("", ["type=search", "name=q"], "search"), "search")).toBeNull();
  });
  it("adresses : domaine du bookmaker seulement, jamais une page d'argent ou de compte", () => {
    const hosts = ["sportaza.com"];
    expect(forbiddenUrlReason("https://sportaza.com/fr/sports", hosts)).toBeNull();
    expect(forbiddenUrlReason("https://www.sportaza.com/fr/sports/match/1", hosts)).toBeNull();
    expect(forbiddenUrlReason("https://sportaza.com/account/login", hosts)).toBeNull();
    expect(forbiddenUrlReason("https://sportaza.com/fr/deposit", hosts)).not.toBeNull();
    expect(forbiddenUrlReason("https://sportaza.com/account/withdraw", hosts)).not.toBeNull();
    expect(forbiddenUrlReason("https://evil-sportaza.com/", hosts)).not.toBeNull();
    expect(forbiddenUrlReason("javascript:alert(1)", hosts)).not.toBeNull();
  });
});

describe("classement des erreurs et parade", () => {
  it("reconnaît captcha, blocage géographique, double authentification (après connexion seulement)", () => {
    expect(detectPageObstacle({ text: "Vérifiez que vous êtes humain", frames: ["https://hcaptcha.com/x"] })).toBe("captcha");
    expect(detectPageObstacle({ text: "Just a moment...", title: "Attention Required" })).toBe("captcha");
    expect(detectPageObstacle({ text: "Sportaza n'est pas disponible dans votre pays." })).toBe("geo_blocked");
    expect(detectPageObstacle({ text: "This site is not available in your country" })).toBe("geo_blocked");
    expect(detectPageObstacle({ text: "", status: 451 })).toBe("geo_blocked");
    expect(detectPageObstacle({ text: "Entrez le code envoyé par SMS" })).toBeNull();
    expect(detectPageObstacle({ text: "Entrez le code envoyé par SMS" }, { afterLogin: true })).toBe("two_factor");
    expect(detectPageObstacle({ text: "Football, tennis, basket : toutes les cotes" })).toBeNull();
    expect(looksLikeLoginFailure("Mot de passe incorrect")).toBe(true);
  });
  it("erreurs techniques classées sans secret", () => {
    expect(classifyCaptureError(Object.assign(new Error("page.goto: Timeout 30000ms exceeded"), { name: "TimeoutError" })).kind).toBe("timeout");
    expect(classifyCaptureError(new Error("net::ERR_PROXY_CONNECTION_FAILED")).kind).toBe("timeout");
    expect(classifyCaptureError(new CaptureError("not_found", "match introuvable")).kind).toBe("not_found");
  });
  it("parade : proxy ou Mac si bloqué, identifiants si refus, repli sinon", () => {
    const f = (kind: Parameters<typeof captureParade>[0] extends infer R ? (R extends { ok: false; kind: infer K } ? K : never) : never) => ({ ok: false as const, kind, message: "" });
    expect(captureBlocked(f("captcha"))).toBe(true);
    expect(captureBlocked(f("geo_blocked"))).toBe(true);
    expect(captureBlocked(f("login_failed"))).toBe(false);
    expect(captureParade(f("two_factor"))).toBe("fix_credentials");
    expect(captureParade(f("timeout"))).toBe("retry");
    expect(captureParade(f("not_found"))).toBe("fallback");
    expect(captureParade(f("forbidden_action"))).toBe("refuse");
    expect(captureParade({ ok: true, png: TINY_PNG, readOdds: 2, pageUrl: "" })).toBeNull();
  });
});

describe("lecture des textes du site", () => {
  it("cotes décimales, fractionnaires, américaines", () => {
    expect(parseOddsText("2,10")).toBe(2.1);
    expect(parseOddsText(" 1.85 ")).toBe(1.85);
    expect(parseOddsText("11/10")).toBe(2.1);
    expect(parseOddsText("+150")).toBe(2.5);
    expect(parseOddsText("-200")).toBe(1.5);
    expect(parseOddsText("—")).toBeNull();
  });
  it("écart toléré", () => {
    expect(oddsWithinTolerance(2.1, 2.0, 5)).toBe(true);
    expect(oddsWithinTolerance(2.1, 1.95, 5)).toBe(false);
  });
  it("équipes, marchés et sélections", () => {
    expect(textMentionsMatch("PSG - Marseille", "Paris Saint-Germain", "Olympique de Marseille")).toBe(true);
    expect(textMentionsMatch("Lyon - Nice", "Paris Saint-Germain", "Olympique de Marseille")).toBe(false);
    expect(marketCandidates("Shots on target")).toContain("tirs cadres");
    expect(textMatchesSelection("Plus de 8,5 2,10", "Over", 8.5)).toBe(true);
    expect(textMatchesSelection("Moins de 8,5 1,70", "Over", 8.5)).toBe(false);
    expect(textMatchesSelection("Plus de 9,5 1,95", "Plus de", 8.5)).toBe(false);
  });
  it("sélecteurs : alternatives lues par ordre de préférence", () => {
    expect(splitSelector("a[href*='x,y'], button:has-text('Se connecter, ok'), li")).toEqual(["a[href*='x,y']", "button:has-text('Se connecter, ok')", "li"]);
  });
});

describe("réglages et secrets", () => {
  it("identifiants : JSON complet ou deux clés", () => {
    expect(credentialsFrom(JSON.stringify({ login: "a", password: "b" }), null)).toEqual({ login: "a", password: "b" });
    expect(credentialsFrom("a", "b")).toEqual({ login: "a", password: "b" });
    expect(credentialsFrom("a", null)).toBeNull();
  });
  it("proxy : identifiants séparés de l'adresse", () => {
    expect(parseProxyUrl("http://u:p%40ss@proxy.example:8080")).toEqual({ server: "http://proxy.example:8080", username: "u", password: "p@ss" });
    expect(parseProxyUrl("proxy.example:3128")).toEqual({ server: "http://proxy.example:3128" });
    expect(parseProxyUrl("n'importe quoi")).toBeNull();
  });
  it("corrections d'adaptateur sans redéploiement ; mode Mac", () => {
    const c = mergeBookmakerConfig(SPORTAZA_CONFIG, { selectors: { searchInput: "#q", inconnu: "x" }, allowedHosts: ["sportaza.fr"], stepTimeoutMs: 5 });
    expect(c.selectors.searchInput).toBe("#q");
    expect(c.allowedHosts).toEqual(["sportaza.fr"]);
    expect(c.stepTimeoutMs).toBe(SPORTAZA_CONFIG.stepTimeoutMs);
    expect(parseCaptureSettings({ sports: { captureMode: "mac" } }).mode).toBe("mac");
    expect(parseCaptureSettings({}).mode).toBe("server");
  });
  it("gabarit de repli : échappé, mention « capture indisponible »", () => {
    const html = renderFallbackHtml({ homeTeam: "A<script>", awayTeam: "B", kickoffAt: new Date("2026-10-25T19:45:00Z"), marketLabel: "Tirs cadrés", selectionLabel: "Plus de", line: 8.5, odds: 2.1, bookmaker: "Sportaza" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("capture indisponible");
    expect(html).toContain("2,10");
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe("file des demandes de capture (base)", () => {
  it("création, prise unique, résultat rangé en SCREENSHOT / HUMAN_SITE", async () => {
    const prisma = createFakePrisma();
    const req = await createCaptureRequest(prisma, { kind: "test", target: "mac", bookmaker: "sportaza" });
    expect(await claimNextCaptureRequest(prisma, "server", "worker")).toBeNull();
    const claimed = await claimNextCaptureRequest(prisma, "mac", "mac-1");
    expect(claimed?.id).toBe(req.id);
    expect(await claimNextCaptureRequest(prisma, "mac", "mac-2")).toBeNull();
    const done = await completeCaptureRequest(prisma, req.id, { ok: true, png: TINY_PNG, readOdds: 0, pageUrl: "https://sportaza.com/" });
    expect(done?.status).toBe("DONE");
    const assetId = done?.result?.ok ? done.result.assetId : null;
    const asset = (prisma as unknown as { _tables: Record<string, Array<Record<string, unknown>>> })._tables.mediaAsset!.find((a) => a.id === assetId);
    expect(asset).toMatchObject({ kind: "SCREENSHOT", origin: "HUMAN_SITE", teamKey: "sports", mimeType: "image/png" });
    expect((await readCaptureRequest(prisma, req.id))?.status).toBe("DONE");
  });
  it("une prise abandonnée depuis 10 min est reprise", async () => {
    const prisma = createFakePrisma();
    const t0 = new Date("2026-10-24T10:00:00Z");
    await createCaptureRequest(prisma, { kind: "test", target: "server", bookmaker: "sportaza", now: t0 });
    expect(await claimNextCaptureRequest(prisma, "server", "a", t0)).not.toBeNull();
    expect(await claimNextCaptureRequest(prisma, "server", "b", new Date(t0.getTime() + 5 * 60_000))).toBeNull();
    expect((await claimNextCaptureRequest(prisma, "server", "b", new Date(t0.getTime() + 11 * 60_000)))?.claimedBy).toBe("b");
  });
});
