/**
 * Phase 34 : entrée interne `POST /api/internal/site-ops` (aucun réseau, base simulée). Signature, fenêtre, rejeu,
 * rôle relu en base (jamais remonté), opération inconnue, exception sans pile.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpImpl, SiteOpMeta } from "@linkaffipro/agents";

const META: Record<string, SiteOpMeta> = {
  "reglages.etiquette_creer": { key: "reglages.etiquette_creer", domain: "reglages", description: "Créer une étiquette", examples: ["crée l'étiquette VIP"], kind: "create", role: "MANAGER", confirm: "none", params: {}, serverActions: [] },
  "reglages.jeton": { key: "reglages.jeton", domain: "reglages", description: "Ajouter un bot", examples: ["ajoute le bot"], kind: "secret", role: "ADMIN", confirm: "none", params: {}, serverActions: [] },
  "statistiques.resume": { key: "statistiques.resume", domain: "statistiques", description: "Chiffres", examples: ["les chiffres"], kind: "read", role: "MANAGER", confirm: "none", params: {}, serverActions: [] },
  "reglages.casse": { key: "reglages.casse", domain: "reglages", description: "Casse", examples: ["casse"], kind: "setting", role: "MANAGER", confirm: "none", params: {}, serverActions: [] },
};
const runs: { key: string; input: unknown; actor: unknown; dryRun?: boolean }[] = [];
const impl = (key: string): SiteOpImpl => ({
  key,
  async run(input, actor, opts) {
    runs.push({ key, input, actor, dryRun: opts.dryRun });
    if (key === "reglages.casse") throw new Error("boom secret stack at /app/lib/x.ts:12");
    return { ok: true, message: "fait" };
  },
});

vi.mock("@linkaffipro/agents", async (orig) => ({ ...(await orig<Record<string, unknown>>()), siteOp: (k: string) => META[k] ?? null }));
vi.mock("./registry", () => ({ siteOpImpl: (k: string) => (META[k] ? impl(k) : null) }));

const { SITE_OPS_SIGNATURE_HEADER, SITE_OPS_TIMESTAMP_HEADER, signSiteOpsBody, siteOpsKeyFrom } = await import("@linkaffipro/agents");
const { handleSiteOpsPost } = await import("./endpoint");
const { createReplayGuard } = await import("./endpoint-auth");
const { executeSiteOp, resolveSiteActor } = await import("./execute");
const { requireRole, webActor } = await import("./actor");

const KEY = siteOpsKeyFrom(Buffer.alloc(32, 3).toString("base64"));
const NOW = 1_761_400_000_000;
const ADMIN_TG = 4242n;

function fakeDb() {
  const users = [
    { id: "admin", role: "ADMIN", isActive: true, telegramUserId: ADMIN_TG },
    { id: "lea", role: "MANAGER", isActive: true, telegramUserId: 77n },
    { id: "old", role: "ADMIN", isActive: false, telegramUserId: null },
  ];
  const members = new Map<bigint, { role: string; removedAt: Date | null }>([
    [77n, { role: "MANAGER", removedAt: null }],
    [88n, { role: "MEMBER", removedAt: null }],
    [99n, { role: "ADMIN", removedAt: new Date() }],
  ]);
  return {
    setting: { findUnique: async ({ where }: { where: { key: string } }) => (where.key === "admin.telegramUserId" ? { value: ADMIN_TG.toString() } : null) },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.find((u) => u.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { telegramUserId: bigint; role?: string } }) => users.find((u) => u.telegramUserId === where.telegramUserId && u.isActive && (!where.role || u.role === where.role)) ?? null,
    },
    teamMember: { findUnique: async ({ where }: { where: { telegramUserId: bigint } }) => members.get(where.telegramUserId) ?? null },
  };
}

function signed(body: unknown, opts: { ts?: number; key?: Buffer; sig?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(opts.ts ?? NOW);
  const sig = opts.sig ?? signSiteOpsBody(opts.key ?? KEY, ts, raw);
  return new Request("http://site/api/internal/site-ops", { method: "POST", headers: { [SITE_OPS_TIMESTAMP_HEADER]: ts, [SITE_OPS_SIGNATURE_HEADER]: sig, "content-type": "application/json" }, body: raw });
}

const admin = { userId: null, role: "ADMIN" as const, via: "TELEGRAM" as const, telegramUserId: ADMIN_TG.toString() };

async function post(req: Request, replay = createReplayGuard()) {
  const db = fakeDb();
  const res = await handleSiteOpsPost(req, { key: KEY, now: NOW + 500, replay, run: (r) => executeSiteOp(db as never, r) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  runs.length = 0;
});

describe("signature de l'entrée interne", () => {
  it("signature juste : l'opération s'exécute avec l'acteur relu en base", async () => {
    const r = await post(signed({ op: "reglages.etiquette_creer", input: { nom: "VIP" }, actor: admin, dryRun: true }));
    expect(r).toEqual({ status: 200, body: { ok: true, message: "fait" } });
    expect(runs[0]).toMatchObject({ key: "reglages.etiquette_creer", input: { nom: "VIP" }, dryRun: true, actor: { userId: "admin", role: "ADMIN", via: "TELEGRAM" } });
  });

  it("signature fausse, autre clé, hors fenêtre, en-têtes absents : 401, rien d'exécuté", async () => {
    const body = { op: "reglages.etiquette_creer", input: {}, actor: admin };
    expect((await post(signed(body, { key: siteOpsKeyFrom("autre") }))).status).toBe(401);
    expect((await post(signed(body, { sig: "0".repeat(64) }))).status).toBe(401);
    expect((await post(signed(body, { ts: NOW - 120_000 }))).status).toBe(401);
    expect((await post(new Request("http://site/x", { method: "POST", body: JSON.stringify(body) }))).status).toBe(401);
    expect(runs).toHaveLength(0);
  });

  it("rejeu : la même requête signée une seconde fois est refusée", async () => {
    const replay = createReplayGuard();
    const body = { op: "reglages.etiquette_creer", input: {}, actor: admin };
    const raw = JSON.stringify(body);
    const sig = signSiteOpsBody(KEY, String(NOW), raw);
    expect((await post(signed(body, { sig }), replay)).status).toBe(200);
    expect((await post(signed(body, { sig }), replay)).status).toBe(401);
    expect(runs).toHaveLength(1);
  });

  it("opération inconnue : not_found ; exception du cœur : unavailable, sans pile", async () => {
    expect((await post(signed({ op: "x.inconnue", input: {}, actor: admin }))).body).toMatchObject({ ok: false, code: "not_found" });
    const r = await post(signed({ op: "reglages.casse", input: {}, actor: admin }));
    expect(r.body).toMatchObject({ ok: false, code: "unavailable" });
    expect(JSON.stringify(r.body)).not.toMatch(/boom|stack|\/app\//);
  });

  it("corps illisible : 400", async () => {
    const raw = "pas du json";
    const sig = signSiteOpsBody(KEY, String(NOW), raw);
    const req = new Request("http://site/x", { method: "POST", headers: { [SITE_OPS_TIMESTAMP_HEADER]: String(NOW), [SITE_OPS_SIGNATURE_HEADER]: sig }, body: raw });
    expect((await post(req)).status).toBe(400);
  });
});

describe("rôle relu en base (jamais remonté)", () => {
  it("un responsable qui se dit ADMIN : refusé ; avec son vrai rôle : accepté sur une opération MANAGER, refusé sur une ADMIN", async () => {
    const lea = { userId: "lea", role: "ADMIN" as const, via: "TELEGRAM" as const, telegramUserId: "77" };
    expect((await post(signed({ op: "reglages.etiquette_creer", input: {}, actor: lea }))).body).toMatchObject({ ok: false, code: "forbidden" });
    const real = { ...lea, role: "MANAGER" as const };
    expect((await post(signed({ op: "reglages.etiquette_creer", input: {}, actor: real }))).body).toMatchObject({ ok: true });
    expect((await post(signed({ op: "reglages.jeton", input: {}, actor: real }))).body).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("membre simple : lecture seulement ; membre retiré, inconnu, compte inactif : rien", async () => {
    const marc = { userId: null, role: "MANAGER" as const, via: "TELEGRAM" as const, telegramUserId: "88" };
    expect((await post(signed({ op: "statistiques.resume", input: {}, actor: marc }))).body).toMatchObject({ ok: true });
    expect((await post(signed({ op: "reglages.etiquette_creer", input: {}, actor: marc }))).body).toMatchObject({ code: "forbidden" });
    const gone = { userId: null, role: "ADMIN" as const, via: "TELEGRAM" as const, telegramUserId: "99" };
    expect((await post(signed({ op: "statistiques.resume", input: {}, actor: gone }))).body).toMatchObject({ code: "forbidden" });
    const nobody = { userId: null, role: "MANAGER" as const, via: "TELEGRAM" as const, telegramUserId: "12345" };
    expect((await post(signed({ op: "statistiques.resume", input: {}, actor: nobody }))).body).toMatchObject({ code: "forbidden" });
    const inactive = { userId: "old", role: "ADMIN" as const, via: "TELEGRAM" as const, telegramUserId: null };
    expect((await post(signed({ op: "statistiques.resume", input: {}, actor: inactive }))).body).toMatchObject({ code: "forbidden" });
    expect(runs.map((r) => r.key)).toEqual(["statistiques.resume"]);
  });

  it("compte du site et identifiant Telegram qui ne vont pas ensemble : refusé ; via toujours TELEGRAM", async () => {
    const db = fakeDb();
    expect(await resolveSiteActor(db as never, { userId: "lea", role: "MANAGER", via: "TELEGRAM", telegramUserId: ADMIN_TG.toString() })).toBeNull();
    const r = await resolveSiteActor(db as never, { userId: "admin", role: "ADMIN", via: "WEB", telegramUserId: null });
    expect(r?.actor.via).toBe("TELEGRAM");
  });
});

describe("acteur du site", () => {
  it("webActor et requireRole", () => {
    const a = webActor({ id: "u", role: "MANAGER" });
    expect(a).toEqual({ userId: "u", role: "MANAGER", via: "WEB", telegramUserId: null });
    expect(requireRole(a, "MANAGER")).toBeNull();
    expect(requireRole(a, "ADMIN")).toMatchObject({ ok: false, code: "forbidden" });
    expect(requireRole(a, "ADMIN")!.error).toMatch(/administrateurs/);
    expect(requireRole(webActor({ id: "x", role: "ADMIN" }), "ADMIN")).toBeNull();
  });
});
