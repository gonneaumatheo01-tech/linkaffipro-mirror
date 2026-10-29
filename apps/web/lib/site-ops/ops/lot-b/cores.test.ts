/**
 * Phase 34, lot B — cœurs partagés par le site et Kevin : mêmes refus que le site (mêmes textes), droits contrôlés
 * dans le cœur (un responsable ne fait pas ce qui est réservé aux administrateurs), essai à blanc (`dryRun`) qui
 * n'écrit rien, n'envoie rien et ne met rien en file, désignation par nom pour Kevin (plusieurs → liste), message
 * transféré repris tel quel (emojis animés gardés). Base, Telegram et file simulés : aucun réseau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpActor, SiteOpResult } from "@linkaffipro/agents";

type Row = Record<string, unknown>;
const WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

const db = vi.hoisted(() => ({
  /** Réponses par « modèle.méthode » (valeur ou fonction des arguments). */
  answers: new Map<string, unknown>(),
  writes: [] as string[],
  audits: [] as Row[],
  calls: [] as string[],
}));

vi.mock("@linkaffipro/db", () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string | symbol) =>
          method === "then" || typeof method === "symbol"
            ? undefined
            : async (args?: unknown) => {
            const key = `${name}.${method}`;
            db.calls.push(key);
            if (WRITES.has(method)) db.writes.push(key);
            const a = db.answers.get(key);
            if (typeof a === "function") return (a as (x: unknown) => unknown)(args);
            if (a !== undefined) return a;
            if (method === "findMany") return [];
            if (method === "count") return 0;
            if (method === "aggregate") return { _max: { sortOrder: null } };
            if (method === "updateMany" || method === "deleteMany") return { count: 0 };
            if (WRITES.has(method)) return { id: `${name}-new`, ...((args as { data?: Row })?.data ?? {}) };
            return null;
          },
      },
    );
  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, prop: string | symbol) => {
        if (prop === "then" || typeof prop === "symbol") return undefined;
        if (prop === "$transaction")
          return async (arg: unknown) => {
            db.writes.push("$transaction");
            return typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]);
          };
        if (prop === "$queryRaw") return async () => {
          db.writes.push("$queryRaw");
          return [];
        };
        return model(prop);
      },
    },
  );
  return {
    prisma,
    audit: vi.fn(async (a: Row) => {
      db.audits.push(a);
    }),
    recordEvent: vi.fn(async () => undefined),
    toJsonValue: (v: unknown) => v,
  };
});

const queue = vi.hoisted(() => ({
  enqueue: vi.fn(async () => ({})),
  enqueueDm: vi.fn(async () => ({})),
  publishLandingInvalidate: vi.fn(async () => undefined),
  emitLinkaffiEvent: vi.fn(async () => undefined),
}));
vi.mock("@linkaffipro/queue", () => queue);

const tg = vi.hoisted(() => ({
  importChannelByUsername: vi.fn(),
  importChannelByChatId: vi.fn(),
  importedChannelMessage: vi.fn(() => "Canal ajouté"),
  listActiveBots: vi.fn(async () => []),
  mapWithLimit: vi.fn(),
  recheckAllChannelRights: vi.fn(),
  recheckChannelRights: vi.fn(),
  ensureDefaultSequences: vi.fn(async () => undefined),
  defaultSequenceText: vi.fn(() => "Bienvenue {prenom}"),
  previewText: (t: string) => t,
  listGateLinksMissing: vi.fn(async () => [{ membershipId: "ms1" }, { membershipId: "ms2" }]),
  resendGateWelcomeWithDb: vi.fn(),
  syncLandingAdLinksWithDb: vi.fn(async () => ({ recomputeNeeded: false })),
  memberReachabilityWithDb: vi.fn(),
  getOrCreateBot: vi.fn(),
  prismaTelegramDeps: {},
  parseChannelLink: (raw: string) => {
    const m = /^(?:https?:\/\/)?(?:t\.me\/)?@?([A-Za-z][A-Za-z0-9_]{3,31})$/.exec(raw.trim());
    if (/\/\+|joinchat/.test(raw)) return { kind: "invite" };
    return m ? { kind: "username", username: m[1] } : { kind: "invalid" };
  },
}));
vi.mock("@linkaffipro/telegram", () => tg);
// Rapprochement des noms de Kevin : la vraie fonction (`boss/resolve.ts`), sans charger tout le paquet des agents.
vi.mock("@linkaffipro/agents", async () => ({
  matchNames: (await import("../../../../../../packages/agents/src/boss/resolve")).matchNames,
}));
vi.mock("@/lib/posts/queries", () => ({ publishingBotFor: vi.fn(async () => ({ id: "bot1" })) }));
vi.mock("@/lib/campaigns/refresh", () => ({ refreshCampaignStats: vi.fn(async () => undefined) }));
vi.mock("@/lib/channels/acting-bot", () => ({ actingStandardBotFor: vi.fn(async () => ({ id: "bot1" })) }));
const tags = vi.hoisted(() => ({ registry: [] as Array<{ name: string; color: string }>, saved: 0 }));
vi.mock("@/lib/members/tags", async (orig) => ({
  ...(await orig<typeof import("@/lib/members/tags")>()),
  getTagRegistry: async () => tags.registry.map((t) => ({ ...t })),
  saveTagRegistry: async () => {
    tags.saved++;
  },
}));

const { tagCreate, tagDelete, tagUpdate, TAG_NAME_ERROR } = await import("./tags");
const { categoryCreate, categoryCreateInline, categoryDelete, categoryUpdate } = await import("./categories");
const { channelAdd, channelUpdate, PRIMARY_BOT_ASSISTANT_ERROR } = await import("./channel-settings");
const rules = await import("./channel-rules");
const seq = await import("./sequences");
const posts = await import("./posts");
const { pageDelete, PAGE_DELETE_ADMIN_ONLY } = await import("./pages");
const { emojiHide, emojiImportPack, EMOJI_ADMIN_ONLY } = await import("./emojis");
const { shareLinkCreate, welcomeResend } = await import("./share-links");
const { resolveChannelRef } = await import("./common");
const { parseShareName } = await import("@/lib/channels/share-links");
const parseShareNameError = (raw: string) => {
  const r = parseShareName(raw);
  return "error" in r ? r.error : "";
};
/** Première désignation par nom : le rapprochement de Kevin (`matchNames`) se charge une fois (lent à froid). */
const SLOW = { timeout: 60_000 };

const ADMIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "TELEGRAM", telegramUserId: "42" };
const MANAGER: SiteOpActor = { userId: "u2", role: "MANAGER", via: "TELEGRAM", telegramUserId: "43" };
const WEB: SiteOpActor = { userId: "u1", role: "ADMIN", via: "WEB" };

function err(r: SiteOpResult): string {
  if (r.ok) throw new Error(`réussite inattendue : ${r.message}`);
  return r.error;
}
/** Rien n'a été écrit, journalisé, envoyé ni mis en file. */
function nothingDone(): void {
  expect(db.writes).toEqual([]);
  expect(db.audits).toEqual([]);
  expect(queue.enqueue).not.toHaveBeenCalled();
  expect(queue.enqueueDm).not.toHaveBeenCalled();
}

beforeEach(() => {
  db.answers.clear();
  db.writes = [];
  db.audits = [];
  db.calls = [];
  tags.registry = [{ name: "VIP", color: "green" }];
  tags.saved = 0;
  vi.clearAllMocks();
});

describe("étiquettes", () => {
  it("mêmes refus que le site", async () => {
    expect(err(await tagCreate({ name: "   " }, ADMIN))).toBe(TAG_NAME_ERROR);
    expect(err(await tagCreate({ name: "Gros joueur", color: "fuchsia" }, ADMIN))).toBe("Choisissez une couleur dans la liste.");
    expect(err(await tagCreate({ name: "vip" }, ADMIN))).toBe("L'étiquette « vip » existe déjà.");
    expect(err(await tagUpdate({ oldName: "Inconnue", name: "X" }, ADMIN))).toBe("Cette étiquette n'existe plus.");
    expect(err(await tagDelete({ name: "Inconnue" }, ADMIN))).toBe("Cette étiquette n'existe plus.");
  });
  it("réservé aux administrateurs (réglage)", async () => {
    for (const r of [await tagCreate({ name: "Neuve" }, MANAGER), await tagDelete({ name: "VIP" }, MANAGER)]) {
      expect(r).toMatchObject({ ok: false, code: "forbidden" });
    }
    expect(tags.saved).toBe(0);
  });
  it("essai à blanc : rien n'est écrit ; suppression : impact annoncé", async () => {
    db.answers.set("member.findMany", [{ id: "m1", tags: ["VIP"] }, { id: "m2", tags: ["VIP"] }]);
    const r = await tagDelete({ name: "vip" }, ADMIN, { dryRun: true });
    expect(r.ok && r.preview?.impact).toBe("Elle sera retirée de 2 membres.");
    expect(tags.saved).toBe(0);
    nothingDone();
  });
  it("vraie création : journal avec `via`", async () => {
    const r = await tagCreate({ name: "Gros joueur", color: "red" }, ADMIN);
    expect(r).toMatchObject({ ok: true, message: "Étiquette « Gros joueur » créée." });
    expect(db.audits[0]).toMatchObject({ action: "tag.created", metadata: { name: "Gros joueur", color: "red", via: "TELEGRAM" } });
  });
});

describe("catégories de messages", () => {
  it("Réglages → Catégories : mêmes refus que le site, réservé aux administrateurs", async () => {
    expect(err(await categoryCreate({ name: "x" }, ADMIN))).toBe("Le nom doit faire entre 2 et 40 caractères.");
    expect(err(await categoryCreate({ name: "Bonus", color: "rouge" }, ADMIN))).toBe(
      "La couleur n'est pas valide : choisissez-la avec le sélecteur.",
    );
    expect(err(await categoryDelete({ id: "c1", replacementId: "c1" }, ADMIN))).toBe("La catégorie de remplacement doit être différente.");
    expect(await categoryCreate({ name: "Bonus" }, MANAGER)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await categoryUpdate({ id: "c1", name: "Bonus" }, MANAGER)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await categoryDelete({ id: "c1" }, MANAGER)).toMatchObject({ ok: false, code: "forbidden" });
    nothingDone();
  });
  it("suppression à blanc : impact annoncé, rien n'est touché", async () => {
    db.answers.set("messageCategory.findUnique", (a: { where: { id: string } }) => ({ id: a.where.id, name: a.where.id === "c1" ? "Promo" : "Bonus" }));
    db.answers.set("post.count", 3);
    const r = await categoryDelete({ id: "c1", replacementId: "c2" }, ADMIN, { dryRun: true });
    expect(r.ok && r.preview).toMatchObject({ summary: "Supprimer la catégorie « Promo » (fusion dans « Bonus »).", impact: "3 messages passent dans « Bonus »." });
    nothingDone();
  });
  it("Kevin : catégorie désignée par son nom (insensible aux accents) ; plusieurs → la liste", SLOW, async () => {
    db.answers.set("messageCategory.findMany", [
      { id: "c1", name: "Bonus été", slug: "bonus-ete" },
      { id: "c2", name: "Bonus hiver", slug: "bonus-hiver" },
    ]);
    db.answers.set("messageCategory.findUnique", (a: { where: { id: string } }) => ({ id: a.where.id, name: "Bonus été", color: "#123456", sortOrder: 1, vertical: null, isActive: true }));
    const r = await categoryUpdate({ category: "bonus ete", isActive: false }, ADMIN, { dryRun: true });
    expect(r.ok && r.preview?.summary).toContain("désactivée");
    const many = err(await categoryDelete({ category: "bonus" }, ADMIN, { dryRun: true }));
    expect(many).toContain("plusieurs");
    expect(many).toContain("« Bonus été »");
    nothingDone();
  });
  it("création rapide (formulaire de message) : un responsable ne réactive pas une catégorie désactivée", async () => {
    expect(err(await categoryCreateInline({ name: "  " }, MANAGER))).toBe("Donnez un nom (40 caractères maximum) et choisissez une couleur valide.");
    db.answers.set("messageCategory.findFirst", { id: "c1", name: "Bonus", color: "#123456", isActive: false });
    expect(err(await categoryCreateInline({ name: "bonus" }, MANAGER))).toContain("Réglages → Catégories");
    nothingDone();
  });
});

describe("réglages d'un canal et ajout", () => {
  it("même refus que le site pour un bot assistant ; essai à blanc sans écriture", async () => {
    db.answers.set("channel.findUnique", { title: "Zone", vertical: null, language: "fr", primaryBotId: null, isTest: false, isMediaLibrary: false, isActive: true });
    db.answers.set("bot.findUnique", { mode: "ASSISTANT", role: "STANDARD" });
    expect(err(await channelUpdate({ channelId: "ch1", primaryBotId: "b2" }, MANAGER))).toBe(PRIMARY_BOT_ASSISTANT_ERROR);
    expect(err(await channelUpdate({ channelId: "ch1", language: "x" }, MANAGER))).toBe(
      "Vérifiez les réglages du canal : la langue doit être un code de 2 à 5 lettres (fr, en, pt-br…).",
    );
    const r = await channelUpdate({ channelId: "ch1", vertical: "paris sportifs" }, MANAGER, { dryRun: true });
    expect(r.ok && r.preview?.summary).toBe("Canal « Zone » : paris sportifs, langue fr.");
    nothingDone();
  });
  it("« ajoute le canal t.me/xxx et mets-le en paris sportifs » : lien vérifié, univers annoncé, rien n'est ajouté à blanc", async () => {
    expect(err(await channelAdd({ link: " " }, MANAGER))).toBe("Collez le lien public du canal (t.me/mon_canal) ou son @nom.");
    const r = await channelAdd({ link: "t.me/zone_interdite", vertical: "paris sportifs" }, MANAGER, { dryRun: true });
    expect(r.ok && r.preview?.summary).toBe("Ajout du canal @zone_interdite, univers paris sportifs.");
    expect(tg.importChannelByUsername).not.toHaveBeenCalled();
    expect(err(await channelAdd({ link: "t.me/+AbCdEf" }, MANAGER, { dryRun: true }))).toContain("privé");
    nothingDone();
  });
  it("vrai ajout puis réglages par le même cœur, journal avec `via`", async () => {
    tg.importChannelByUsername.mockResolvedValueOnce({ channelId: "ch9", title: "XXX", created: true, admins: [], status: "ok", warning: null });
    db.answers.set("channel.findUnique", { title: "XXX", vertical: null, language: "fr", primaryBotId: null, isTest: false, isMediaLibrary: false, isActive: true });
    const r = await channelAdd({ link: "t.me/xxx_canal", vertical: "paris sportifs" }, MANAGER);
    expect(r).toMatchObject({ ok: true, data: { channelId: "ch9" } });
    expect(tg.importChannelByUsername).toHaveBeenCalledWith("t.me/xxx_canal", { userId: "u2", metadata: { via: "TELEGRAM" } });
    expect(db.audits[0]).toMatchObject({ action: "channel.updated", entityId: "ch9", metadata: { vertical: "SPORTS", via: "TELEGRAM" } });
  });
  it("Kevin : canal par son lien ou son nom stylisé ; plusieurs → la liste, aucun → introuvable", SLOW, async () => {
    db.answers.set("channel.findMany", [
      { id: "a", title: "🚩𝑪𝑶𝑹𝑵𝑬𝑹 VIP", username: "corner_vip" },
      { id: "b", title: "Corner Free", username: null },
      { id: "c", title: "Zone Interdite", username: "zone_interdite" },
    ]);
    expect(await resolveChannelRef({ channel: "https://t.me/zone_interdite" })).toMatchObject({ ok: true, id: "c" });
    expect(await resolveChannelRef({ channel: "corner vip" })).toMatchObject({ ok: true, id: "a" });
    const many = await resolveChannelRef({ channel: "corner" });
    expect(many?.ok).toBe(false);
    if (many && !many.ok) expect(many.result.error).toContain("plusieurs");
    expect(await resolveChannelRef({ channel: "Rien du tout" })).toMatchObject({ ok: false });
  });
});

describe("règles d'acceptation et exceptions", () => {
  const rule = {
    channelId: "ch1",
    mode: "DELAY",
    delayPreset: "5m",
    gateMode: "NONE",
    gateChannelIds: [],
    reminderAfterMinutes: "",
    maxReminders: 2,
    expireAction: "KEEP",
    sendAcceptedMessage: false,
    sendWelcome: true,
  };
  it("même message qu'à l'écran pour un champ refusé", async () => {
    expect(err(await rules.channelRuleSave({ ...rule, maxReminders: 50 }, MANAGER))).toBe(
      "Vérifiez le champ « Nombre maximal de rappels » : un nombre entre 0 et 10.",
    );
    expect(err(await rules.channelRuleSave({ ...rule, mode: null }, MANAGER))).toBe("Vérifiez le champ « Mode » : valeur invalide.");
    nothingDone();
  });
  it("Kevin : « accepte au bout de 5 minutes » sur une règle existante, à blanc", async () => {
    db.answers.set("approvalRule.findFirst", {
      id: "r1",
      mode: "IMMEDIATE",
      delaySeconds: 0,
      gateMode: "NONE",
      gateChannelIds: [],
      reminderAfterMinutes: [],
      maxReminders: 2,
      expireAfterHours: null,
      expireAction: "KEEP",
      sendAcceptedMessage: false,
      sendWelcome: true,
    });
    const r = await rules.channelRuleSave({ channelId: "ch1", delaySeconds: 300 }, MANAGER, { dryRun: true });
    expect(r.ok && r.preview?.summary).toContain("acceptée après 5 min");
    nothingDone();
  });
  it("supprimer une exception : administrateurs seulement, même texte que le site", async () => {
    expect(err(await rules.channelExceptionDelete({ channelId: "ch1", ruleId: "r2" }, MANAGER))).toBe(rules.EXCEPTION_DELETE_ADMIN_ONLY);
    expect(err(await rules.channelExceptionDelete({ channelId: "ch1", ruleId: "r2" }, ADMIN))).toBe("Cette exception n'existe plus.");
    nothingDone();
  });
  it("exception : provenance manquante et canal d'origine identique refusés comme à l'écran", async () => {
    expect(err(await rules.channelExceptionSave({ ...rule, provenance: "" }, MANAGER))).toBe(
      "Vérifiez le champ « Si la personne vient » : choisissez d'où vient la personne.",
    );
    db.answers.set("channel.findUnique", { id: "ch1" });
    expect(err(await rules.channelExceptionSave({ ...rule, provenance: "channel:ch1" }, MANAGER))).toBe(
      "Choisissez un autre canal que celui-ci : la personne vient d'ailleurs.",
    );
    nothingDone();
  });
  it("tout accepter à blanc : nombre de demandes annoncé, rien n'est accepté", async () => {
    db.answers.set("channel.findUnique", { id: "ch1", title: "Zone", isActive: true, botAdmins: [{ botId: "b1" }] });
    db.answers.set("membership.findMany", [{ id: "m1", status: "PENDING_GATE" }, { id: "m2", status: "PENDING_GATE" }]);
    const r = await rules.channelRequestsApproveAll({ channelId: "ch1" }, MANAGER, { dryRun: true });
    expect(r.ok && r.preview?.recipients).toBe(2);
    nothingDone();
    db.answers.set("channel.findUnique", { id: "ch1", title: "Zone", isActive: false, botAdmins: [] });
    expect(err(await rules.channelRequestsApproveAll({ channelId: "ch1" }, MANAGER))).toBe(
      "Ce canal est désactivé : réactivez-le dans « Réglages du canal » pour que les demandes soient acceptées.",
    );
  });
});

describe("messages du bot (séquences)", () => {
  const EMOJI = '<tg-emoji emoji-id="5368324170671202286">🎉</tg-emoji>';
  it("test sur soi-même à blanc, canal sans séquence : texte par défaut annoncé, rien n'est créé", async () => {
    db.answers.set("channel.findUnique", { id: "ch1", title: "Zone", vertical: null });
    db.answers.set("member.findUnique", { id: "m1", botStates: [{ canDm: true }] });
    // `sequence.findFirst` : null (aucune séquence encore créée pour ce canal).
    const r = await seq.sequenceTestSend({ channelId: "ch1", trigger: "APPROVED", prenom: "Léa" }, MANAGER, { dryRun: true });
    expect(r.ok && r.preview?.exactText).toContain("🧪 Test (APPROVED, FR)");
    expect(tg.ensureDefaultSequences).not.toHaveBeenCalled();
    expect(tg.defaultSequenceText).toHaveBeenCalledWith(null, "APPROVED");
    nothingDone();
  });
  it("retirer une langue à blanc : ce qui est effacé est annoncé (confirmation SUPPRIMER)", async () => {
    const r = await seq.sequenceLangRemove({ channelId: "ch1", trigger: "APPROVED", lang: "en" }, MANAGER, { dryRun: true });
    expect(r.ok && r.preview?.impact).toContain("Le texte EN est effacé");
    nothingDone();
  });
  it("français obligatoire, même texte que le site", async () => {
    expect(err(await seq.sequenceTextSave({ channelId: "ch1", trigger: "APPROVED", lang: "fr", text: "  " }, MANAGER))).toBe(
      "Le texte en français est obligatoire : c'est celui que reçoivent les membres dont la langue n'est pas traduite.",
    );
    expect(err(await seq.sequenceLangRemove({ channelId: "ch1", trigger: "APPROVED", lang: "fr" }, MANAGER))).toBe(
      "Le français ne peut pas être retiré.",
    );
    nothingDone();
  });
  it("message transféré comme accueil : HTML et emoji animé gardés tels quels, à blanc", async () => {
    const content = { html: `Bienvenue <b>{prenom}</b> ${EMOJI}`, media: [], receivedAt: new Date().toISOString() };
    const r = await seq.sequenceTextSave({ channelId: "ch1", trigger: "accueil", content }, MANAGER, { dryRun: true });
    expect(r.ok && r.preview?.exactText).toBe(`Bienvenue <b>{prenom}</b> ${EMOJI}`);
    nothingDone();
  });
  it("accueil transféré avec photo : refusé sans média rangé ; avec le média de Kevin, aperçu « avec une photo » et média joint", async () => {
    const content = { html: "Bienvenue", media: [{ kind: "photo", fileId: "f1" }, { kind: "photo", fileId: "f2" }], receivedAt: new Date().toISOString() };
    expect(err(await seq.sequenceTextSave({ channelId: "ch1", trigger: "accueil", content }, MANAGER, { dryRun: true }))).toContain("médiathèque");
    nothingDone();
    db.answers.set("mediaAsset.findMany", [{ id: "a1", mimeType: "image/jpeg" }]);
    const dry = await seq.sequenceTextSave({ channelId: "ch1", trigger: "accueil", content, mediaAssetId: "a1", mediaAssetIds: ["a1", "a2"] }, MANAGER, { dryRun: true });
    expect(dry.ok && dry.preview?.summary).toContain(", avec une photo (1 photo sur 2 gardée : un message du bot ne joint qu'un média) :");
    nothingDone();
    const updates: Row[] = [];
    db.answers.set("sequence.findFirst", { id: "s1", steps: [{ id: "st1", texts: {}, mediaAssetId: null }] });
    db.answers.set("sequenceStep.update", (a: Row) => (updates.push(a), { id: "st1" }));
    const real = await seq.sequenceTextSave({ channelId: "ch1", trigger: "accueil", content, mediaAssetId: "a1", mediaAssetIds: ["a1", "a2"] }, MANAGER);
    expect(real).toMatchObject({ ok: true, message: "Texte FR enregistré, avec son média." });
    expect(updates[0]).toMatchObject({ where: { id: "st1" }, data: { mediaAssetId: "a1" } });
  });
  it("test sur soi-même : aperçu exact, un seul destinataire, rien en file à blanc", async () => {
    db.answers.set("channel.findUnique", { id: "ch1", title: "Zone" });
    db.answers.set("member.findUnique", { id: "m1", botStates: [{ canDm: true }] });
    db.answers.set("sequence.findFirst", { id: "s1", isActive: true, steps: [{ id: "st1", texts: { fr: "Salut {canal}" }, mediaAssetId: null }] });
    const r = await seq.sequenceTestSend({ channelId: "ch1", trigger: "APPROVED", prenom: "Léa" }, MANAGER, { dryRun: true });
    expect(r.ok && r.preview).toMatchObject({ recipients: 1, exactText: "🧪 Test (APPROVED, FR)\n\nSalut {canal}" });
    nothingDone();
    // Séquences par défaut jamais créées par l'essai à blanc.
    expect(tg.ensureDefaultSequences).not.toHaveBeenCalled();
    expect(err(await seq.sequenceTestSend({ channelId: "ch1", trigger: "APPROVED", lang: "fr" }, { ...MANAGER, telegramUserId: null }))).toBe(
      "Liez votre Telegram dans Mon compte (menu en haut à droite) pour recevoir un test.",
    );
  });
});

describe("messages de canal", () => {
  it("vidéo du montage retiré : refusée dès la programmation", async () => {
    db.answers.set("mediaAsset.findMany", [{ id: "sh1", kind: "SHORT", storage: "telegram", mimeType: "video/mp4" }]);
    const r = await posts.postSchedule({ channelIds: ["ch1"], text: "Regarde ça", mediaAssetIds: ["sh1"], scheduledAt: soon() }, MANAGER, { dryRun: true });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/montage, qui n'existe plus/) });
  });

  const EMOJI = '<tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji>';
  const soon = () => {
    const d = new Date(Date.now() + 2 * 86_400_000);
    return d.toISOString();
  };
  it("mêmes refus que le site : aucun canal, date passée", async () => {
    expect(err(await posts.postSchedule({ text: "Bonjour", scheduledAt: "2020-01-01T10:00" }, MANAGER))).toBe("Choisissez au moins un canal.");
    expect(err(await posts.postSchedule({ channelIds: ["ch1"], text: "Bonjour", scheduledAt: "2020-01-01T10:00" }, MANAGER))).toBe(
      "La date choisie est déjà passée : choisissez un moment à venir.",
    );
    expect(err(await posts.postDraft({ channelIds: ["ch1"], text: "" }, MANAGER))).toBe("Le message est vide : ajoutez un texte ou un média.");
    nothingDone();
  });
  it("« programme ça sur Zone demain 20 h » : texte transféré gardé tel quel (emoji animé), rien n'est créé à blanc", SLOW, async () => {
    db.answers.set("channel.findMany", [{ id: "ch1", title: "Zone", username: "zone" }]);
    const content = { html: `Ce soir <b>gros bonus</b> ${EMOJI}`, media: [], receivedAt: new Date().toISOString() };
    const r = await posts.postSchedule({ channel: "Zone", content, scheduledAt: soon(), emojiButtonsChoice: "emojis" }, MANAGER, { dryRun: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.preview?.exactText).toContain(EMOJI);
      expect(r.preview?.exactText).toContain("<b>gros bonus</b>");
      expect(r.preview?.summary).toContain("« Zone »");
    }
    nothingDone();
  });
  it("média transféré absent de la médiathèque : jamais deviné", async () => {
    const content = { html: "Photo", media: [{ kind: "photo", fileId: "AgAD" }], receivedAt: new Date().toISOString() };
    expect(err(await posts.postSchedule({ channelIds: ["ch1"], content, scheduledAt: soon() }, MANAGER, { dryRun: true }))).toContain(
      "médiathèque",
    );
    nothingDone();
  });
  it("médias rangés par Kevin avant l'essai à blanc : acceptés dans l'ordre, l'aperçu dit « avec 2 photos et 1 vidéo »", async () => {
    const content = {
      html: "Album",
      media: [{ kind: "photo", fileId: "f1" }, { kind: "photo", fileId: "f2" }, { kind: "video", fileId: "f3" }],
      receivedAt: new Date().toISOString(),
    };
    db.answers.set("mediaAsset.findMany", [
      { id: "a3", mimeType: "video/mp4" },
      { id: "a1", mimeType: "image/jpeg" },
      { id: "a2", mimeType: "image/jpeg" },
    ]);
    const r = await posts.postSchedule(
      { channelIds: ["ch1"], content, mediaAssetId: "a1", mediaAssetIds: ["a1", "a2", "a3"], scheduledAt: soon() },
      MANAGER,
      { dryRun: true },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.preview?.summary).toContain("Avec 2 photos et 1 vidéo.");
    // Aucun média cherché par identifiant de fichier Telegram : ceux du déroulé suffisent.
    expect(db.calls).not.toContain("mediaAssetTelegramFile.findMany");
    nothingDone();
  });
  it("média donné par Kevin mais introuvable : refusé", async () => {
    const content = { html: "Photo", media: [{ kind: "photo", fileId: "AgAD" }], receivedAt: new Date().toISOString() };
    const r = await posts.postSchedule({ channelIds: ["ch1"], content, mediaAssetIds: ["zz"], scheduledAt: soon() }, MANAGER, { dryRun: true });
    expect(r).toMatchObject({ ok: false, code: "not_found" });
    nothingDone();
  });
  it("retirer ou supprimer sur Telegram : administrateurs seulement ; statut vérifié comme sur le site", async () => {
    expect(await posts.postDiscard({ postId: "p1" }, MANAGER)).toMatchObject({ ok: false, code: "forbidden", error: "Action réservée aux administrateurs" });
    expect(await posts.postDeleteOnTelegram({ postId: "p1" }, MANAGER)).toMatchObject({ ok: false, code: "forbidden" });
    db.answers.set("post.findUniqueOrThrow", { id: "p1", code: "ABC", status: "DRAFT", isTemplate: false, scheduledAt: null });
    expect(err(await posts.postDeleteOnTelegram({ postId: "p1" }, ADMIN))).toBe("Seul un message déjà envoyé peut être supprimé du canal Telegram.");
    expect(err(await posts.postCancel({ postId: "p1" }, MANAGER))).toBe("Seul un message programmé peut être annulé.");
    const d = await posts.postDiscard({ code: "ABC" }, ADMIN, { dryRun: true });
    expect(d.ok && d.preview?.impact).toBeTruthy();
    nothingDone();
  });
  it("déplacer : même refus que le calendrier", async () => {
    expect(err(await posts.postMove({ postId: "p1" }, MANAGER))).toBe("Demande invalide : rechargez la page.");
    nothingDone();
  });
});

describe("pages, emojis, liens de partage, accueil", () => {
  it("supprimer une page : administrateurs seulement ; à blanc : impact, rien d'effacé", async () => {
    expect(err(await pageDelete({ pageId: "pg1" }, MANAGER))).toBe(PAGE_DELETE_ADMIN_ONLY);
    db.answers.set("landingPage.findUnique", { id: "pg1", name: "Zone", slug: "zone", channelId: "ch1" });
    db.answers.set("landingSource.count", 2);
    db.answers.set("landingEvent.count", 120);
    const r = await pageDelete({ pageId: "pg1" }, ADMIN, { dryRun: true });
    expect(r.ok && r.preview).toMatchObject({ summary: "Supprimer la page « Zone » (/j/zone).", impact: expect.stringContaining("120 visites") });
    nothingDone();
  });
  it("emojis : retirer réservé aux administrateurs ; lien vide ou d'autocollants refusé", async () => {
    expect(err(await emojiHide({ customEmojiId: "5368324170671202286" }, MANAGER))).toBe(EMOJI_ADMIN_ONLY);
    expect(err(await emojiImportPack({ link: "" }, MANAGER))).toBe("Collez le lien du pack (il commence par https://t.me/addemoji/).");
    expect(err(await emojiImportPack({ link: "https://t.me/addstickers/Chats" }, MANAGER, { dryRun: true }))).toBe(
      "Ce lien est un pack d'autocollants, pas d'emojis animés.",
    );
    nothingDone();
  });
  it("lien de partage : même refus de nom ; à blanc, aucun lien créé chez Telegram", async () => {
    expect(err(await shareLinkCreate({ channelId: "ch1", name: "  " }, MANAGER))).toBe(parseShareNameError("  "));
    db.answers.set("channel.findUnique", { id: "ch1", title: "Zone", telegramChatId: 1n, language: "fr" });
    const r = await shareLinkCreate({ channelId: "ch1", name: "Story" }, MANAGER, { dryRun: true });
    expect(r.ok && r.preview?.summary).toBe("Nouveau lien de partage « Story » pour « ch1 ».");
    nothingDone();
  });
  it("renvoyer l'accueil à blanc : nombre de destinataires, rien n'est envoyé", async () => {
    const r = await welcomeResend({ channelId: "ch1" }, MANAGER, { dryRun: true });
    expect(r.ok && r.preview?.recipients).toBe(2);
    expect(tg.resendGateWelcomeWithDb).not.toHaveBeenCalled();
    nothingDone();
  });
  it("site : le journal porte `via: WEB`", async () => {
    await tagCreate({ name: "Nouveau", color: "blue" }, WEB);
    expect(db.audits[0]).toMatchObject({ metadata: { via: "WEB" } });
  });
});
