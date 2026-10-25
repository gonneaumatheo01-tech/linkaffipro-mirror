/**
 * Phase 34, chantier F — liens d'autorisation de Kevin côté site (`/k/<jeton>`) et reprise après OAuth : usage unique,
 * page « lien expiré », redirections internes seulement, cookie de reprise chiffré, crochet du retour OAuth (Kevin écrit
 * dans la conversation d'origine), enregistrement des comptes choisis par les fonctions de la page de choix. Base en
 * mémoire, faux messager, aucun réseau.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ADMIN_TG_ID, createTestKit } from "@linkaffipro/agents/test-kit";
import { bossAdAccountsPort, createAuthLink, setBossAdAccountsPort } from "@linkaffipro/agents";
import { isPublicPath } from "@/lib/routing";
import { openAuthLink } from "./auth-link-route";
import { decodeResumeMark, encodeResumeMark, KEVIN_OAUTH_COOKIE, newResumeMark } from "./cookie";
import { installBossAdAccountsPort, kevinOAuthResume } from "./oauth-resume";

const common = vi.hoisted(() => ({
  loadPending: vi.fn(),
  saveConnections: vi.fn(async () => ["conn_1"]),
  clearPending: vi.fn(async () => undefined),
}));
vi.mock("@/lib/connectors/common", () => common);

afterEach(() => setBossAdAccountsPort(null));

const BASE = "https://app.linkaffipro.com";
const CHAT = ADMIN_TG_ID.toString();
const tokenOf = (url: string) => url.split("/k/")[1]!;

function routeDeps(kit: ReturnType<typeof createTestKit>, user: { id: string; role: "ADMIN" | "MANAGER" } | null = { id: "u1", role: "ADMIN" }) {
  return { links: kit.deps, user: async () => user, baseUrl: BASE };
}

describe("/k/<jeton>", () => {
  it("chemin public (le jeton fait foi)", () => {
    expect(isPublicPath("/k/abc")).toBe(true);
    expect(isPublicPath("/k")).toBe(false);
  });

  it("connexion : marqué utilisé puis redirigé vers la connexion (e-mail pré-rempli) ; 2e ouverture → page « expiré »", async () => {
    const kit = createTestKit();
    const link = await createAuthLink(kit.deps, { purpose: "login", userId: null, chatId: CHAT, payload: { email: "mat@linkaffipro.com" } });
    const res = await openAuthLink(tokenOf(link.url), routeDeps(kit, null));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/login?email=mat%40linkaffipro.com`);
    expect(res.headers.get("set-cookie")).toBeNull();
    const again = await openAuthLink(tokenOf(link.url), routeDeps(kit, null));
    expect(again.status).toBe(410);
    const html = await again.text();
    expect(html).toContain("Redemande-le à Kevin");
    expect(again.headers.get("cache-control")).toBe("no-store");
  });

  it("inconnu, expiré : page « expiré » ; page interne : redirigée ; jamais vers l'extérieur", async () => {
    const kit = createTestKit();
    expect((await openAuthLink("n'importe-quoi", routeDeps(kit))).status).toBe(410);
    const old = await createAuthLink(kit.deps, { purpose: "page", userId: null, chatId: CHAT, payload: { path: "/agents/orders" } });
    kit.advance(15 * 60_000 + 1);
    expect((await openAuthLink(tokenOf(old.url), routeDeps(kit))).status).toBe(410);
    const page = await createAuthLink(kit.deps, { purpose: "page", userId: null, chatId: CHAT, payload: { path: "/agents/orders" } });
    const res = await openAuthLink(tokenOf(page.url), routeDeps(kit));
    expect(res.headers.get("location")).toBe(`${BASE}/agents/orders`);
    // Ligne trafiquée en base : adresse externe → accueil du site.
    const forged = await createAuthLink(kit.deps, { purpose: "page", userId: null, chatId: CHAT, payload: { path: "/ok" } });
    const row = kit.tables("setting").find((s) => String(s.key).startsWith("boss.authlink."))!;
    (row.value as { payload: Record<string, unknown> }).payload = { path: "https://evil.example" };
    const out = await openAuthLink(tokenOf(forged.url), routeDeps(kit));
    expect(new URL(out.headers.get("location")!).origin).toBe(BASE);
  });

  it("invitation : vers /invite/<jeton d'invitation>", async () => {
    const kit = createTestKit();
    const link = await createAuthLink(kit.deps, { purpose: "invite", userId: null, chatId: CHAT, payload: { inviteToken: "inv_abcdefgh123" } });
    expect((await openAuthLink(tokenOf(link.url), routeDeps(kit, null))).headers.get("location")).toBe(`${BASE}/invite/inv_abcdefgh123`);
  });

  it("OAuth Meta : démarrage existant + cookie de reprise chiffré (conversation d'origine) ; sans session, la connexion d'abord", async () => {
    const kit = createTestKit();
    const link = await createAuthLink(kit.deps, { purpose: "oauth_meta", userId: "u1", chatId: "-100123" });
    const res = await openAuthLink(tokenOf(link.url), routeDeps(kit));
    expect(res.headers.get("location")).toBe(`${BASE}/api/connectors/meta/start`);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${KEVIN_OAUTH_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/connectors/);
    expect(cookie).not.toContain("-100123");
    const value = decodeURIComponent(cookie.split(";")[0]!.split("=").slice(1).join("="));
    expect(decodeResumeMark(value)).toMatchObject({ platform: "META", chatId: "-100123", linkUserId: "u1" });

    const link2 = await createAuthLink(kit.deps, { purpose: "oauth_tiktok", userId: null, chatId: CHAT });
    const res2 = await openAuthLink(tokenOf(link2.url), routeDeps(kit, null));
    expect(res2.headers.get("location")).toBe(`${BASE}/login?callbackUrl=${encodeURIComponent("/api/connectors/tiktok/start")}`);
  });

  it("cookie falsifié ou expiré : ignoré", () => {
    expect(decodeResumeMark("v1.faux.faux.faux")).toBeNull();
    const m = newResumeMark("META", CHAT, null, Date.now() - 16 * 60_000);
    expect(decodeResumeMark(encodeResumeMark(m))).toBeNull();
  });
});

function callbackReq(cookie: string | null): Request {
  return new Request(`${BASE}/api/connectors/meta/callback?code=x&state=y`, { headers: cookie ? { cookie: `autre=1; ${KEVIN_OAUTH_COOKIE}=${encodeURIComponent(cookie)}` } : {} });
}

describe("retour OAuth : Kevin reprend la conversation", () => {
  const accounts = [
    { externalId: "act_1", name: "Celsius FR" },
    { externalId: "act_2", name: "Celsius BE" },
  ];

  it("autorisation venue d'un lien de Kevin : message avec un bouton par compte, cookie effacé, redirection du site inchangée", async () => {
    const kit = createTestKit();
    const res = NextResponse.redirect(new URL("/settings/connectors/meta/choose", BASE));
    const r = await kevinOAuthResume(callbackReq(encodeResumeMark(newResumeMark("META", CHAT, "u1"))), res, { platform: "META", userId: "u1", accounts }, { deps: async () => kit.deps });
    expect(r.resumed).toBe(true);
    expect(res.headers.get("location")).toBe(`${BASE}/settings/connectors/meta/choose`);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${KEVIN_OAUTH_COOKIE}=;`));
    const sent = kit.sent.at(-1)!;
    expect(sent.html).toMatch(/Meta/);
    expect(sent.buttons!.flat().map((b) => b.text)).toEqual(["Celsius FR", "Celsius BE", "Tous"]);
  });

  it("connexion faite depuis le site (sans cookie), autre plateforme, autre utilisateur : rien d'envoyé", async () => {
    const kit = createTestKit();
    const res = () => NextResponse.redirect(new URL("/x", BASE));
    const deps = { deps: async () => kit.deps };
    expect((await kevinOAuthResume(callbackReq(null), res(), { platform: "META", userId: "u1", accounts }, deps)).resumed).toBe(false);
    expect((await kevinOAuthResume(callbackReq(encodeResumeMark(newResumeMark("TIKTOK", CHAT, null))), res(), { platform: "META", userId: "u1", accounts }, deps)).resumed).toBe(false);
    expect((await kevinOAuthResume(callbackReq(encodeResumeMark(newResumeMark("META", CHAT, "u2"))), res(), { platform: "META", userId: "u1", accounts }, deps)).resumed).toBe(false);
    expect(kit.sent).toHaveLength(0);
  });

  it("choix par bouton : mêmes fonctions que la page « Choisir les comptes » (comptes en attente, saveConnections, via TELEGRAM)", async () => {
    installBossAdAccountsPort();
    const save = bossAdAccountsPort()!;
    expect(save).toBeTruthy();
    const tokens = { accessToken: "tok", refreshToken: null, expiresAt: null };
    common.loadPending.mockResolvedValueOnce({ tokens, accounts: [{ externalId: "act_1", name: "A" }, { externalId: "act_2", name: "B" }], createdAt: "" });
    expect(await save({ platform: "META", userId: "u1", externalIds: ["act_2"], final: true, telegramUserId: CHAT })).toEqual({ ok: true, connected: 1 });
    expect(common.saveConnections).toHaveBeenCalledWith("META", "u1", tokens, [{ externalId: "act_2", name: "B" }], { via: "TELEGRAM", telegramActorId: CHAT });
    expect(common.clearPending).toHaveBeenCalledWith("META", "u1");
    common.loadPending.mockResolvedValueOnce(null);
    expect(await save({ platform: "META", userId: "u1", externalIds: ["act_1"], final: false, telegramUserId: CHAT })).toMatchObject({ ok: false });
  });
});
