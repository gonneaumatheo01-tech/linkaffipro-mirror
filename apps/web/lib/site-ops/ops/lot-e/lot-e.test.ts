import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 34, lot E — cœurs des réglages, connecteurs et de l'équipe : un seul code pour le site et pour Kevin.
 * Vérifie : chaque opération est déclarée des deux côtés ; chaque action serveur du lot est couverte (ou exclue avec
 * raison et remplacement) ; un MANAGER est refusé ; l'essai à blanc n'écrit rien et n'appelle rien dehors ; mêmes
 * textes d'erreur que le site (textes d'origine) ; aucun secret dans les paramètres, l'aperçu ni le journal.
 */
/** Arguments d'un appel Prisma simulé. */
type Q = { where: Record<string, unknown>; data?: Record<string, unknown>; create?: Record<string, unknown> };

const m = vi.hoisted(() => {
  const WRITE = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
  const calls: Array<{ model: string; method: string; args: unknown }> = [];
  const overrides: Record<string, Record<string, (args: Q) => unknown>> = {};
  const defaults = (method: string, args: Q | undefined): unknown => {
    if (method === "findMany") return [];
    if (method === "count") return 0;
    if (method.startsWith("find")) return null;
    if (method === "updateMany" || method === "deleteMany") return { count: 0 };
    return { id: "new1", ...(args?.data ?? args?.create ?? {}), expiresAt: new Date("2026-11-01T00:00:00Z") };
  };
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async (args: unknown) => {
          calls.push({ model: name, method, args });
          const f = overrides[name]?.[method];
          return f ? f(args as Q) : defaults(method, args as Q | undefined);
        },
      },
    );
  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, name: string) =>
        name === "$transaction"
          ? async (x: unknown) => (Array.isArray(x) ? Promise.all(x) : (x as (tx: unknown) => unknown)(prisma))
          : model(name),
    },
  );
  const audits: Array<Record<string, unknown>> = [];
  const external = new Map<string, ReturnType<typeof vi.fn>>();
  /** Fonction « au dehors » (réseau, file, Telegram, fonctions métier qui écrivent) : comptée, jamais appelée en essai à blanc. */
  const ext = (name: string, impl: (...a: never[]) => unknown = async () => undefined) => {
    const f = vi.fn(impl);
    external.set(name, f);
    return f;
  };
  return { WRITE, calls, overrides, prisma, audits, external, ext, sandbox: false };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}`, url });
  },
}));
vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin1", role: "ADMIN", email: "a@x.fr", name: "Admin" })),
  requireUser: vi.fn(async () => ({ id: "admin1", role: "ADMIN", email: "a@x.fr", name: "Admin" })),
  ForbiddenError: class extends Error {},
}));
vi.mock("@/auth", () => ({ forgetSessionVersion: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { appBaseUrl: "https://app.test" } }));
vi.mock("@linkaffipro/db", () => ({
  prisma: m.prisma,
  audit: vi.fn(async (a: Record<string, unknown>) => void m.audits.push(a)),
  toJsonValue: (x: unknown) => x,
}));
vi.mock("@linkaffipro/core", async (orig) => ({
  ...(await orig<typeof import("@linkaffipro/core")>()),
  encrypt: (s: string) => `enc(${s.length})`,
}));
vi.mock("@linkaffipro/queue", () => ({
  QUEUE_NAMES: ["stats", "maintenance"],
  enqueue: m.ext("enqueue"),
  getRedis: vi.fn(),
  withMtprotoLock: m.ext("withMtprotoLock", async (_r: unknown, fn: () => unknown) => fn()),
  retryFailedJob: m.ext("retryFailedJob", async () => ({ ok: true })),
  cleanFailedOlderThan: m.ext("cleanFailedOlderThan", async () => 0),
}));
vi.mock("@linkaffipro/connectors", () => ({
  describeConnectorError: (e: unknown) => String(e),
  metaProvider: { verifyApp: m.ext("meta.verifyApp", async () => ({ ok: true })) },
  tiktokProvider: { verifyApp: m.ext("tiktok.verifyApp", async () => ({ ok: true })) },
}));
vi.mock("@linkaffipro/connectors/tiktok", () => ({ listAccountsByIds: m.ext("listAccountsByIds", async () => []) }));
vi.mock("@/lib/connectors/common", () => ({
  loadAppCredentials: vi.fn(async () => ({ clientId: "1234567", secret: "s", extra: { sandbox: m.sandbox } })),
  loadAppState: vi.fn(async () => ({ hasSecret: true, extra: {} })),
  loadPending: vi.fn(async () => ({
    tokens: { accessToken: "t" },
    accounts: [
      { externalId: "act_1", name: "Zone Interdite" },
      { externalId: "act_2", name: "Autre" },
    ],
    createdAt: new Date().toISOString(),
  })),
  saveAppCredentials: m.ext("saveAppCredentials"),
  markAppVerified: m.ext("markAppVerified"),
  requestSyncNow: m.ext("requestSyncNow"),
  disconnectConnection: m.ext("disconnectConnection"),
  saveConnections: m.ext("saveConnections", async () => ["c9"]),
  clearPending: m.ext("clearPending"),
}));
vi.mock("@linkaffipro/mtproto", () => ({
  isValidApiHash: (h: string) => /^[a-f0-9]{32}$/i.test(h),
  normalizePhone: (p: string) => (/^\+?\d[\d\s]{7,}$/.test(p.trim()) ? `+${p.replace(/\D/g, "")}` : null),
  sendCode: m.ext("sendCode", async () => ({ session: "S", phoneCodeHash: "H" })),
  checkPassword: m.ext("checkPassword", async () => ({ session: "S", user: { firstName: "A", username: "a" } })),
  logOut: m.ext("logOut", async () => true),
  MtprotoFloodWait: class extends Error {
    seconds = 1;
  },
  TELEGRAM_SESSION_ID: "main",
  TELEGRAM_USER_API_SETTING: "telegram.userApi",
}));
vi.mock("@/lib/views/session", () => ({
  getTelegramUserApi: vi.fn(async () => ({ apiId: 1, apiHash: "h" })),
  getTelegramSessionSecret: vi.fn(async () => ({ status: "PENDING_PASSWORD", session: "S", phone: "+33612345678" })),
}));
vi.mock("@linkaffipro/userbot", () => ({
  startOnboarding: m.ext("startOnboarding", async () => ({ id: "ta1" })),
  submitCode: m.ext("submitCode"),
  submitPassword: m.ext("submitPassword"),
  ensureShadowBot: m.ext("ensureShadowBot"),
  setActive: m.ext("setActive"),
  setPersona: m.ext("setPersona"),
  refresh: m.ext("refresh", async () => ({ status: "ACTIVE" })),
  disconnect: m.ext("disconnect"),
}));
vi.mock("@/lib/integrations/linkaffi/settings", () => ({
  generateLinkaffiApiKey: m.ext("generateLinkaffiApiKey", async () => ({ value: "lak_SECRET", prefix: "lak_", regenerated: true })),
  generateLinkaffiWebhookSecret: m.ext("generateLinkaffiWebhookSecret", async () => ({ value: "whs_SECRET", prefix: "whs", regenerated: false })),
  saveLinkaffiEventsUrl: m.ext("saveLinkaffiEventsUrl", async () => ({ ok: true, url: "https://x", isDefault: false })),
  runLinkaffiTestEvent: m.ext("runLinkaffiTestEvent", async () => ({ ok: true, outcome: "received", status: 200, message: "Reçu." })),
  linkaffiTestPrerequisites: vi.fn(async () => ({ ok: true, row: { webhookSecretEncrypted: "e", eventsUrl: null }, anonKey: "k" })),
  parseEventsUrl: (raw: unknown) => (String(raw ?? "").startsWith("https://") || !raw ? { url: raw || null } : { error: "L'adresse doit commencer par https:// (connexion chiffrée)." }),
}));
vi.mock("@/lib/postback/apply", () => ({
  handlePostback: m.ext("handlePostback", async () => ({ status: "ACCEPTED", message: "ok" })),
  applyParsedPostback: m.ext("applyParsedPostback", async () => ({ status: "ACCEPTED", message: "ok" })),
}));
vi.mock("@linkaffipro/telegram", () => ({
  BOT_TOKEN_PATTERN: /^\d+:[A-Za-z0-9_-]{30,}$/,
  BossRegisterError: class extends Error {},
  bossRegisteredText: (u: string) => `Kevin est prêt (@${u}).`,
  evictBot: m.ext("evictBot"),
  registerBossFromToken: m.ext("registerBossFromToken"),
  registerBotFromToken: m.ext("registerBotFromToken", async () => ({ botId: "b9", username: "nouveau_bot", created: true })),
  setAssistantProfile: m.ext("setAssistantProfile", async () => ({ mode: "STANDARD", applied: true, warnings: [] })),
  setWebhookForBot: m.ext("setWebhookForBot", async () => ({ url: "https://app.test/api/telegram/b1" })),
}));
vi.mock("@/app/(admin)/settings/bots/assistant-handover", () => ({
  loadAssistantHandover: vi.fn(async () => ({ primaries: [], posts: [], stuck: [] })),
  applyAssistantHandover: m.ext("applyAssistantHandover", async () => ({ replaced: 0, emptied: 0, posts: 0 })),
}));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: vi.fn(() => ({})) }));
vi.mock("@linkaffipro/agents", () => ({
  matchNames: (raw: string, items: Array<{ name: string; extra?: string[] }>) =>
    items.filter((i) => [i.name, ...(i.extra ?? [])].some((x) => x.toLowerCase().includes(raw.toLowerCase()))),
  resumeMissions: m.ext("resumeMissions", async () => ({ requeued: 0, continued: 0, revalidated: 0 })),
}));

import { LOT_E_IMPL } from "../lot-e";
import { LOT_E_OPS } from "../../../../../../packages/agents/src/site/ops/lot-e";
import { LOT_E_PARITY } from "../../../../../../packages/agents/src/site/parity/lot-e";
import type { SiteOpActor, SiteOpResult } from "./common";
import * as team from "./team";
import * as ads from "./connectors-ads";
import * as la from "./connectors-linkaffi";
import * as tg from "./connectors-telegram";
import * as pb from "./postbacks";
import * as al from "./alerts";
import * as bots from "./bots";
import * as st from "./status";
import * as acc from "./accounts";

const ADMIN: SiteOpActor = { userId: "admin1", role: "ADMIN", via: "TELEGRAM", telegramUserId: "42" };
const MANAGER: SiteOpActor = { userId: "man1", role: "MANAGER", via: "TELEGRAM", telegramUserId: "43" };

const writes = () => m.calls.filter((c) => m.WRITE.has(c.method));
const externalCalls = () => [...m.external.entries()].filter(([, f]) => f.mock.calls.length > 0).map(([k]) => k);

/** Monde de départ : une ligne pour chaque chose qu'une opération peut désigner. */
function world(): void {
  for (const k of Object.keys(m.overrides)) delete m.overrides[k];
  Object.assign(m.overrides, {
    adAccountConnection: {
      findUnique: ({ where }: Q) =>
        where.id === "c1"
          ? { id: "c1", platform: "TIKTOK", status: "ACTIVE", name: "Zone TikTok" }
          : where.id === "c2"
            ? { id: "c2", platform: "META", status: "ACTIVE", name: "Zone Meta" }
            : null,
      findMany: () => [{ id: "c1", platform: "TIKTOK", status: "ACTIVE", name: "Zone TikTok", externalId: "7001" }],
    },
    telegramUserAccount: {
      findUnique: () => ({ id: "ta1", label: "Inès", status: "PENDING_PASSWORD" }),
      findMany: () => [{ id: "ta1", label: "Inès", phone: "+33612345678", telegramUsername: "ines" }],
    },
    persona: {
      findUnique: () => ({ id: "p1", name: "Inès", isActive: true, universe: "dating" }),
      findMany: () => [{ id: "p1", name: "Inès" }],
    },
    user: {
      findUnique: ({ where }: Q) =>
        where.email ? null : where.id === "u2" ? { id: "u2", name: "Léa", email: "lea@x.fr", role: "MANAGER", isActive: true } : null,
      findMany: () => [{ id: "u2", name: "Léa", email: "lea@x.fr", role: "MANAGER", isActive: true, telegramUserId: null }],
      count: () => 1,
    },
    invitation: {
      findUnique: () => ({ id: "i1", email: "lea@x.fr" }),
      findFirst: () => ({ id: "i1" }),
      update: () => ({ id: "i1", email: "lea@x.fr" }),
    },
    postbackEndpoint: {
      findUnique: ({ where }: Q) =>
        where.id === "e1" ? { id: "e1", name: "Celsius", isActive: true, mapping: {}, token: "TOKEN_POSTBACK", programId: "pr1" } : null,
      findMany: () => [{ id: "e1", name: "Celsius" }],
    },
    affiliateProgram: {
      findUnique: () => ({ id: "pr1", name: "Celsius" }),
      findMany: () => [{ id: "pr1", name: "Celsius" }],
    },
    alert: { findUnique: () => ({ id: "al1" }) },
    bot: {
      findUnique: () => ({ id: "b1", username: "zone_bot", mode: "STANDARD", personaId: null, role: "CHANNEL", isActive: true }),
      findMany: () => [{ id: "b1", username: "zone_bot", name: "Zone" }],
    },
    integrationKey: { findUnique: () => ({ apiKeyHash: "h", webhookSecretEncrypted: "e" }) },
  });
}

const CSV = "player_id,event,sub_id\np1,registration,abc\np2,ftd,def\n";

/** Entrées valides de chaque opération (phrase de Kevin ou formulaire du site). */
const VALID: Record<string, Record<string, unknown>> = {
  "connecteurs.tiktok_application": { clientId: "1234567", secret: "SECRET_TIKTOK_APP" },
  "connecteurs.tiktok_verifier": {},
  "connecteurs.tiktok_connecter": {},
  "connecteurs.tiktok_comptes_proposes": {},
  "connecteurs.tiktok_choisir_comptes": { accounts: ["Zone Interdite"] },
  "connecteurs.tiktok_annuler_connexion": {},
  "connecteurs.tiktok_bac_a_sable": { token: "SANDBOX_TOKEN_SECRET", advertiserIds: "70011, 70022" },
  "connecteurs.tiktok_synchroniser": { account: "Zone TikTok", mode: "full" },
  "connecteurs.tiktok_deconnecter": { connectionId: "c1" },
  "connecteurs.meta_application": { clientId: "1234567", secret: "SECRET_META_APP" },
  "connecteurs.meta_verifier": {},
  "connecteurs.meta_connecter": {},
  "connecteurs.meta_comptes_proposes": {},
  "connecteurs.meta_choisir_comptes": { accounts: ["act_1"] },
  "connecteurs.meta_annuler_connexion": {},
  "connecteurs.meta_synchroniser": { connectionId: "c2" },
  "connecteurs.meta_deconnecter": { connectionId: "c2" },
  "connecteurs.telegram_application": { apiId: 1234567, apiHash: "0123456789abcdef0123456789ABCDEF" },
  "connecteurs.telegram_envoyer_code": { phone: "+33 6 12 34 56 78" },
  "connecteurs.telegram_mot_de_passe": { password: "MOT_DE_PASSE_2FA" },
  "connecteurs.telegram_deconnecter": {},
  "connecteurs.telegram_relever_vues": {},
  "connecteurs.compte_ajouter": { phone: "+33612345678", label: "Inès" },
  "connecteurs.compte_mot_de_passe": { account: "Inès", password: "MOT_DE_PASSE_2FA" },
  "connecteurs.compte_activer": { account: "Inès", active: false },
  "connecteurs.compte_persona": { account: "Inès", persona: "Inès" },
  "connecteurs.compte_verifier": { account: "+33612345678" },
  "connecteurs.compte_deconnecter": { account: "Inès" },
  "connecteurs.linkaffi_synchroniser": { full: true },
  "connecteurs.affilies_cle": {},
  "connecteurs.affilies_secret": {},
  "connecteurs.affilies_adresse": { eventsUrl: "https://linkaffi.example/telegram-events" },
  "connecteurs.affilies_test": {},
  "reglages.niveaux_depense": { vip: 800 },
  "reglages.taux_change": { rates: { USD: 1.08 } },
  "reglages.postback_creer": { program: "Celsius", name: "Celsius direct" },
  "reglages.postback_modifier": { endpoint: "Celsius", name: "Celsius FR" },
  "reglages.postback_activer": { endpoint: "Celsius", active: false },
  "reglages.postback_nouvelle_adresse": { endpointId: "e1" },
  "reglages.postback_tester": { endpoint: "Celsius", event: "ftd", amount: "50" },
  "reglages.postback_import_apercu": { program: "Celsius", file: { fileName: "joueurs.csv", text: CSV } },
  "reglages.postback_importer": { program: "Celsius", file: { fileName: "joueurs.csv", text: CSV } },
  "reglages.alertes_ouvertes": {},
  "reglages.alerte_resoudre": { alertId: "al1" },
  "reglages.alertes_seuils": { spendNoConversionEur: 200, enabled: { spend_no_conversion: true } },
  "reglages.alertes_verifier": {},
  "reglages.conservation": { months: 12 },
  "reglages.purge": {},
  "reglages.bot_ajouter": { token: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", vertical: "sports" },
  "reglages.bot_connexion": { bot: "@zone_bot" },
  "reglages.bot_activer": { bot: "zone_bot", active: false },
  "reglages.bot_mode": { bot: "zone_bot", mode: "ASSISTANT", persona: "Inès" },
  "reglages.tache_relancer": { queue: "stats", jobId: "j1" },
  "reglages.taches_echouees_effacer": {},
  "reglages.missions_relancer": {},
  "reglages.rapports": { hour: 8 },
  "reglages.rapport_envoyer": { kind: "weekly" },
  "equipe.lister": {},
  "equipe.inviter": { email: "lea@exemple.fr", role: "responsable" },
  "equipe.invitation_annuler": { email: "lea@x.fr" },
  "equipe.role": { user: "Léa", role: "ADMIN" },
  "equipe.retirer": { user: "lea@x.fr" },
  "equipe.reactiver": { userId: "u2" },
  "equipe.mot_de_passe_lien": { user: "Léa" },
};

const SECRETS = ["SECRET_TIKTOK_APP", "SECRET_META_APP", "SANDBOX_TOKEN_SECRET", "0123456789abcdef", "MOT_DE_PASSE_2FA", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];

/** Réglages propres à une opération (l'application TikTok en bac à sable pour le formulaire bac à sable). */
const SETUP: Record<string, () => void> = {
  "connecteurs.tiktok_bac_a_sable": () => {
    m.sandbox = true;
  },
};

beforeEach(() => {
  m.sandbox = false;
  m.calls.length = 0;
  m.audits.length = 0;
  for (const f of m.external.values()) f.mockClear();
  world();
});

const impl = (key: string) => {
  SETUP[key]?.();
  return LOT_E_IMPL.find((o) => o.key === key)!;
};

describe("registre du lot E", () => {
  it("chaque opération a son cœur et ses métadonnées, sans doublon, avec deux phrases type", () => {
    const implKeys = LOT_E_IMPL.map((o) => o.key);
    const metaKeys = LOT_E_OPS.map((o) => o.key);
    expect(new Set(implKeys).size).toBe(implKeys.length);
    expect([...implKeys].sort()).toEqual([...metaKeys].sort());
    for (const op of LOT_E_OPS) {
      expect(op.key.startsWith(`${op.domain}.`), op.key).toBe(true);
      expect(["reglages", "connecteurs", "equipe"]).toContain(op.domain);
      expect(op.examples.length, op.key).toBeGreaterThanOrEqual(2);
      expect(VALID[op.key], `entrée de test pour ${op.key}`).toBeDefined();
      // Aucun champ secret dans le schéma envoyé à l'IA.
      const props = Object.keys(((op.params as { properties?: object }).properties ?? {}) as object);
      for (const sp of op.secretParams ?? []) expect(props, op.key).not.toContain(sp);
      for (const p of props) expect(/token|secret|password|apiHash/i.test(p), `${op.key}.${p}`).toBe(false);
      if (op.secretParams?.length) expect(op.kind, op.key).toBe("secret");
      if (op.kind === "delete") expect(op.confirm, op.key).toBe("delete");
    }
  });

  it("chaque action serveur du lot est couverte par une opération ou exclue avec raison et remplacement", () => {
    const files = [
      "app/(admin)/settings/connectors/tiktok/actions.ts",
      "app/(admin)/settings/connectors/meta/actions.ts",
      "app/(admin)/settings/connectors/telegram/actions.ts",
      "app/(admin)/settings/connectors/actions.ts",
      "app/(admin)/settings/connectors/affiliates-actions.ts",
      "app/(admin)/settings/accounts/actions.ts",
      "app/(admin)/settings/team/actions.ts",
      "app/(admin)/settings/postbacks/actions.ts",
      "app/(admin)/settings/postbacks/import/actions.ts",
      "app/(admin)/settings/alerts/actions.ts",
      "app/(admin)/settings/bots/actions.ts",
      "app/(admin)/settings/status/actions.ts",
      "app/(admin)/settings/reports/actions.ts",
      "app/(admin)/account/actions.ts",
      "lib/onboarding/actions.ts",
      "app/(auth)/login/actions.ts",
      "app/invite/[token]/actions.ts",
    ];
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const expected: string[] = [];
    for (const f of files) {
      const src = readFileSync(`${root}${f}`, "utf8");
      expect(src.startsWith('"use server"'), f).toBe(true);
      for (const [, name] of src.matchAll(/export async function (\w+)/g)) expected.push(`${f}#${name}`);
    }
    expect(expected.length).toBe(67);
    expect(Object.keys(LOT_E_PARITY).sort()).toEqual([...expected].sort());
    const keys = new Set(LOT_E_OPS.map((o) => o.key));
    for (const [action, entry] of Object.entries(LOT_E_PARITY)) {
      if ("op" in entry) expect(keys.has(entry.op), action).toBe(true);
      else if ("excluded" in entry) {
        expect(entry.excluded.reason.length, action).toBeGreaterThan(20);
        expect(entry.excluded.replacement.length, action).toBeGreaterThan(20);
      } else throw new Error(`correspondance inattendue pour ${action}`);
    }
    // Exclusions limitées à la sécurité du compte, au code de connexion Telegram et à l'affichage seul.
    expect(
      Object.entries(LOT_E_PARITY)
        .filter(([, e]) => "excluded" in e)
        .map(([a]) => a.split("#")[1])
        .sort(),
    ).toEqual([
      "acceptInviteAction",
      "changePasswordAction",
      "completeTourAction",
      "dismissChecklistAction",
      "generateTelegramLinkAction",
      "loginAction",
      "restartTourAction",
      "signInAction",
      "submitCodeAction",
      "unlinkTelegramAction",
    ]);
  });
});

describe("droits : un responsable (MANAGER) est refusé partout où le site exige un administrateur", () => {
  for (const op of LOT_E_OPS.filter((o) => o.role === "ADMIN"))
    it(op.key, async () => {
      for (const dryRun of [true, false]) {
        const r = await impl(op.key).run(VALID[op.key]!, MANAGER, { dryRun });
        expect(r.ok, op.key).toBe(false);
        expect(!r.ok && r.code).toBe("forbidden");
      }
      expect(writes()).toEqual([]);
      expect(m.audits).toEqual([]);
      expect(externalCalls()).toEqual([]);
    });

  it("reposer la connexion Telegram d'un bot reste permis au responsable, comme sur le site", async () => {
    const r = await impl("reglages.bot_connexion").run(VALID["reglages.bot_connexion"]!, MANAGER, {});
    expect(r).toMatchObject({ ok: true, message: "Connexion Telegram reposée : le bot reçoit à nouveau les messages." });
    expect(m.audits[0]).toMatchObject({ userId: "man1", action: "bot.webhook_resync", metadata: { via: "TELEGRAM" } });
  });
});

describe("essai à blanc : tout est validé, rien n'est écrit ni envoyé", () => {
  for (const op of LOT_E_OPS)
    it(op.key, async () => {
      const r = await impl(op.key).run(VALID[op.key]!, ADMIN, { dryRun: true });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(writes(), op.key).toEqual([]);
      expect(m.audits, op.key).toEqual([]);
      expect(externalCalls(), op.key).toEqual([]);
      const text = JSON.stringify(r);
      for (const sec of SECRETS) expect(text.includes(sec), `${op.key} : ${sec}`).toBe(false);
      if (op.kind !== "read" && op.kind !== "connect" && r.ok) expect(r.message.length).toBeGreaterThan(5);
    });
});

describe("exécution par Kevin : même journal que le site, avec via TELEGRAM, jamais de secret", () => {
  for (const op of LOT_E_OPS.filter((o) => o.kind !== "read" && o.kind !== "connect"))
    it(op.key, async () => {
      await impl(op.key).run(VALID[op.key]!, ADMIN, {});
      for (const a of m.audits) expect((a.metadata as { via?: string })?.via, `${op.key} ${String(a.action)}`).toBe("TELEGRAM");
      const journal = JSON.stringify(m.audits);
      for (const sec of [...SECRETS, "lak_SECRET", "whs_SECRET", "TOKEN_POSTBACK"]) expect(journal.includes(sec), `${op.key} : ${sec}`).toBe(false);
    });

  it("les fonctions métier qui journalisent elles-mêmes reçoivent via", async () => {
    await impl("connecteurs.tiktok_application").run(VALID["connecteurs.tiktok_application"]!, ADMIN, {});
    expect(m.external.get("saveAppCredentials")!.mock.calls[0]).toEqual([
      "TIKTOK",
      { clientId: "1234567", secret: "SECRET_TIKTOK_APP", extra: { sandbox: false } },
      "admin1",
      { via: "TELEGRAM" },
    ]);
    await impl("connecteurs.affilies_cle").run({}, ADMIN, {});
    expect(m.external.get("generateLinkaffiApiKey")!.mock.calls[0]).toEqual(["admin1", { via: "TELEGRAM" }]);
  });
});

/** Erreur rendue par le cœur. */
async function err(p: Promise<SiteOpResult>): Promise<string> {
  const r = await p;
  if (r.ok) throw new Error(`succès inattendu : ${r.message}`);
  return r.error;
}

describe("mêmes textes d'erreur que le site (textes d'origine des actions)", () => {
  it("équipe", async () => {
    expect(await err(team.teamInvite({ email: "pas-une-adresse" }, ADMIN))).toBe("L'adresse e-mail n'est pas valide.");
    expect(await err(team.teamInvite({ email: "a@b.fr", role: "CHEF" }, ADMIN))).toBe("Choisissez un rôle dans la liste.");
    m.overrides.user!.findUnique = () => ({ id: "u3" });
    expect(await err(team.teamInvite({ email: "a@b.fr" }, ADMIN))).toContain("Un compte existe déjà avec cette adresse.");
    world();
    expect(await err(team.teamToggleUser({ userId: "admin1" }, ADMIN))).toBe("Vous ne pouvez pas désactiver votre propre compte.");
    m.overrides.user!.findUnique = () => ({ id: "u2", name: "Léa", email: "lea@x.fr", role: "ADMIN", isActive: true });
    m.overrides.user!.count = () => 0;
    expect(await err(team.teamToggleUser({ userId: "u2" }, ADMIN))).toBe("Impossible : ce compte est le dernier administrateur actif.");
    expect(await err(team.teamSetRole({ userId: "u2", role: "MANAGER" }, ADMIN))).toBe("Impossible : ce compte est le dernier administrateur actif.");
    expect(await err(team.teamSetRole({ userId: "admin1", role: "MANAGER" }, ADMIN))).toBe("Vous ne pouvez pas retirer votre propre rôle d'administrateur.");
    expect(await err(team.teamSetRole({ userId: "u2", role: "" }, ADMIN))).toBe("Choisissez un rôle dans la liste.");
    expect(writes()).toEqual([]);
  });

  it("connecteurs", async () => {
    expect(await err(ads.tiktokSaveApp({ clientId: "abc" }, ADMIN))).toBe("L'App ID TikTok est un nombre (copiez-le dans My Apps → Basic Information).");
    expect(await err(ads.metaSaveApp({ clientId: "12", configId: "" }, ADMIN))).toBe("L'App ID est un nombre (entre 6 et 20 chiffres).");
    expect(await err(ads.metaSaveApp({ clientId: "1234567", configId: "x1" }, ADMIN))).toBe("Le config_id est un nombre (ou vide).");
    expect(await err(ads.tiktokSync({ connectionId: "zz" }, ADMIN))).toBe("Connexion TikTok introuvable.");
    expect(await err(ads.tiktokSync({ connectionId: "c2" }, ADMIN))).toBe("Connexion TikTok introuvable.");
    expect(await err(ads.metaSync({ connectionId: "" }, ADMIN))).toBe("Connexion introuvable.");
    expect(await err(ads.metaChooseAccounts({ accounts: [] }, ADMIN))).toBe("Cochez au moins un compte à connecter.");
    expect(await err(ads.tiktokChooseAccounts({ accounts: ["inconnu"] }, ADMIN))).toBe("Cochez au moins un compte.");
    expect(await err(ads.tiktokSandbox({ token: "", advertiserIds: "1" }, ADMIN))).toBe(
      "Cochez « Mode bac à sable » dans l'application, puis Enregistrer, avant d'utiliser ce formulaire.",
    );
    expect(await err(tg.telegramSaveUserApi({ apiId: "x", apiHash: "court" }, ADMIN))).toBe(
      "Vérifiez les deux champs : api_id est un nombre, api_hash fait 32 caractères (lettres et chiffres).",
    );
    expect(await err(tg.telegramSendCode({ phone: "12" }, ADMIN))).toBe(
      "Numéro invalide : utilisez le format international, par exemple +33 6 12 34 56 78.",
    );
    expect(await err(tg.telegramCheckPassword({ password: "" }, ADMIN))).toBe("Entrez le mot de passe de validation en deux étapes.");
    expect(await err(la.spendThresholdsSave({ vip: -1, regularDeposits: 3 }, ADMIN))).toBe(
      "Seuils invalides : le seuil VIP doit être un montant positif et le nombre de dépôts un entier d'au moins 1.",
    );
    expect(await err(la.ratesSave({ rates: "dollar=beaucoup" }, ADMIN))).toBe("Taux illisible : « dollar=beaucoup » (attendu : USD=1.08).");
    expect(await err(la.linkaffiKeyGenerate({}, MANAGER))).toBe("Réservé aux administrateurs.");
    m.overrides.persona!.findUnique = () => ({ universe: "casino" });
    expect(await err(acc.accountSetPersona({ accountId: "ta1", personaId: "p9" }, ADMIN))).toContain("qu'une persona Rencontres");
    m.overrides.persona!.findUnique = () => null;
    expect(await err(acc.accountSetPersona({ accountId: "ta1", personaId: "p9" }, ADMIN))).toBe("Persona introuvable : rechargez la page.");
    expect(writes()).toEqual([]);
  });

  it("réglages", async () => {
    expect(await err(pb.postbackCreate({ programId: "pr1", name: "x" }, ADMIN))).toBe(
      "Choisissez un programme et donnez un nom (2 caractères minimum).",
    );
    expect(await err(pb.postbackCreate({ programId: "pr1", name: "Celsius", mapping: "{pas du json" }, ADMIN))).toBe(
      "La correspondance des paramètres doit être un JSON valide (ou laissez le champ vide pour la valeur par défaut).",
    );
    expect(await err(pb.postbackUpdate({ endpointId: "e1", name: "x" }, ADMIN))).toBe("Le nom doit faire entre 2 et 80 caractères.");
    expect(await err(pb.playersImportPreview({ csv: CSV }, ADMIN))).toBe("Choisissez d'abord un programme.");
    expect(await err(pb.playersImportPreview({ programId: "pr1", csv: "" }, ADMIN))).toBe("Choisissez d'abord un fichier CSV.");
    expect(await err(pb.playersImportPreview({ programId: "pr1", csv: "a,b\n" }, ADMIN))).toBe(
      "Le fichier ne contient aucune ligne de données sous l'en-tête.",
    );
    expect(await err(al.retentionSave({ months: 3 }, ADMIN))).toBe("La durée de conservation doit être un nombre de mois entre 6 et 120.");
    expect(await err(al.alertThresholdsSave({ registrationsDropPct: 0 }, ADMIN))).toBe(
      "Seuils invalides : les pourcentages vont de 1 à 100 et la dépense est un montant positif en euros.",
    );
    expect(await err(st.reportsConfigSave({ hour: 25 }, ADMIN))).toBe("L'heure doit être un nombre entre 0 et 23.");
    expect(await err(st.jobRetry({ queue: "inconnue", jobId: "1" }, ADMIN))).toBe(
      "Cette tâche n'est pas reconnue : rechargez la page et réessayez.",
    );
    expect(await err(bots.botAdd({ token: "1:abc", vertical: "poker" }, ADMIN))).toBe(
      "Choisissez un univers (casino, paris sportifs ou rencontres).",
    );
    expect(await err(bots.botSetMode({ botId: "b1", mode: "AUTRE" }, ADMIN))).toBe("Choisissez un mode valide pour le bot.");
    m.overrides.bot!.findUnique = () => ({ id: "b1", username: "kevin_bot", mode: "STANDARD", personaId: null, role: "ADMIN" });
    expect(await err(bots.botSetMode({ botId: "b1", mode: "ASSISTANT" }, ADMIN))).toBe(
      "Ce bot est le Boss : il parle seulement avec l'administrateur et ne peut pas devenir assistant de conversation.",
    );
    expect(writes()).toEqual([]);
  });
});

describe("phrases de Kevin", () => {
  it("« ajoute Léa à l'équipe comme responsable » : invitation créée comme le site, lien rendu hors du message", async () => {
    const r = await impl("equipe.inviter").run({ email: "Lea@Exemple.fr", role: "responsable" }, ADMIN, {});
    expect(r).toMatchObject({ ok: true, message: "Invitation créée pour lea@exemple.fr. Copiez le lien ci-dessous et envoyez-le." });
    const created = m.calls.find((c) => c.model === "invitation" && c.method === "create")!.args as { data: Record<string, unknown> };
    expect(created.data).toMatchObject({ email: "lea@exemple.fr", role: "MANAGER", invitedById: "admin1" });
    expect(r.ok && String(r.data?.inviteUrl)).toBe(`https://app.test/invite/${String(created.data.token)}`);
    expect(r.ok && r.message).not.toContain(String(created.data.token));
    expect(m.audits).toEqual([
      expect.objectContaining({ action: "invitation.created", metadata: { email: "lea@exemple.fr", role: "MANAGER", via: "TELEGRAM" } }),
    ]);
  });

  it("« envoie-moi le rapport à 8 h au lieu de 9 h » : seule l'heure change, le reste est gardé", async () => {
    m.overrides.setting = { findUnique: () => ({ value: { daily: true, weekly: false, hour: 9 } }) };
    const r = await impl("reglages.rapports").run({ hour: 8 }, ADMIN, {});
    expect(r).toMatchObject({ ok: true, data: { daily: true, weekly: false, hour: 8 } });
    const up = m.calls.find((c) => c.method === "upsert")!.args as { update: { value: unknown } };
    expect(up.update.value).toEqual({ daily: true, weekly: false, hour: 8 });
  });

  it("« préviens-moi si une pub dépense plus de 200 € sans inscription » : seuil existant, les autres seuils gardés", async () => {
    m.overrides.setting = { findUnique: () => ({ value: { registrationsDropPct: 40, channelLeakPct: 12, enabled: { spend_no_conversion: false } } }) };
    const r = await impl("reglages.alertes_seuils").run({ spendNoConversionEur: 200, enabled: { spend_no_conversion: true } }, ADMIN, {});
    expect(r).toMatchObject({ ok: true, data: { registrationsDropPct: 40, spendNoConversionEur: 200, channelLeakPct: 12 } });
    expect(r.ok ? (r.data?.enabled as Record<string, boolean>).spend_no_conversion : null).toBe(true);
  });

  it("« retire Léa de l'équipe » : désactivation, jamais une réactivation par erreur", async () => {
    m.overrides.user!.findUnique = () => ({ id: "u2", name: "Léa", email: "lea@x.fr", role: "MANAGER", isActive: false });
    const r = await impl("equipe.retirer").run({ user: "Léa" }, ADMIN, {});
    expect(r).toMatchObject({ ok: true, data: { unchanged: true } });
    expect(writes()).toEqual([]);
  });

  it("choix des comptes publicitaires par leur nom (boutons de Kevin)", async () => {
    const r = await impl("connecteurs.meta_choisir_comptes").run({ accounts: ["zone interdite"] }, ADMIN, {});
    expect(r.ok).toBe(true);
    expect(m.external.get("saveConnections")!.mock.calls[0]![3]).toEqual([{ externalId: "act_1", name: "Zone Interdite" }]);
  });

  it("lien d'autorisation : prérequis vérifiés, rien écrit, but du lien rendu", async () => {
    expect(await impl("connecteurs.meta_connecter").run({}, ADMIN, {})).toMatchObject({ ok: true, data: { authPurpose: "oauth_meta" } });
    expect(await impl("connecteurs.tiktok_connecter").run({}, ADMIN, {})).toMatchObject({ ok: true, data: { authPurpose: "oauth_tiktok" } });
    expect(writes()).toEqual([]);
  });

  it("import CSV : l'aperçu de l'essai à blanc compte les lignes, l'exécution importe", async () => {
    const dry = await impl("reglages.postback_importer").run(VALID["reglages.postback_importer"]!, ADMIN, { dryRun: true });
    expect(dry).toMatchObject({ ok: true, data: { total: 2, programId: "pr1" } });
    const r = await impl("reglages.postback_importer").run(VALID["reglages.postback_importer"]!, ADMIN, {});
    expect(r).toMatchObject({ ok: true, data: { imported: 2, total: 2 } });
    expect(m.calls.some((c) => c.model === "importBatch" && c.method === "create")).toBe(true);
  });
});
