/**
 * Phase 34, chantier A — déroulé « tout par Kevin » de bout en bout, sans réseau : fausse IA (`createFakeBossLlm`),
 * faux prisma (`createBossKit`), faux client du site (`siteOps`), opérations factices (une par confirmation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpMeta, SiteOpResult, SiteOpsClient } from "./contract";

const FAKE_OPS: SiteOpMeta[] = [
  {
    key: "reglages.etiquette_creer",
    domain: "reglages",
    description: "Créer une étiquette de membres",
    examples: ["crée l'étiquette VIP", "ajoute une étiquette fidèles"],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: { type: "object", additionalProperties: false, properties: { nom: { type: "string" } }, required: ["nom"] },
    serverActions: ["app/(admin)/settings/tags/actions.ts#createTagAction"],
  },
  {
    key: "agents.budget_video",
    domain: "agents",
    description: "Changer le plafond vidéo du mois",
    examples: ["monte le budget vidéo à 80 € ce mois-ci", "plafond vidéo à 50 €"],
    kind: "setting",
    role: "ADMIN",
    confirm: "yes",
    params: { type: "object", additionalProperties: false, properties: { euros: { type: "number" } }, required: ["euros"] },
    serverActions: [],
  },
  {
    key: "campagnes.supprimer",
    domain: "campagnes",
    description: "Supprimer une campagne",
    examples: ["supprime la campagne Celsius", "efface la campagne test"],
    kind: "delete",
    role: "ADMIN",
    confirm: "delete",
    params: { type: "object", additionalProperties: false, properties: { campagne: { type: "string" } }, required: ["campagne"] },
    serverActions: [],
  },
  {
    key: "envois.creer",
    domain: "envois",
    description: "Écrire à un groupe de membres",
    examples: ["envoie ce message à tous les membres de Zone Interdite demain 20 h", "écris aux membres VIP"],
    kind: "send",
    role: "MANAGER",
    confirm: "send",
    params: { type: "object", additionalProperties: false, properties: { canal: { type: "string" }, quand: { type: "string" } }, required: ["canal"] },
    inputs: ["forwarded"],
    serverActions: [],
  },
  {
    key: "campagnes.creer",
    domain: "campagnes",
    description: "Créer une campagne",
    examples: ["crée une campagne pour Celsius en France avec un CPA de 120", "nouvelle campagne Sportaza"],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: {
      type: "object",
      additionalProperties: false,
      properties: { marque: { type: "string" }, univers: { type: "string", enum: ["casino", "paris", "rencontres"] }, pays: { type: "string" } },
      required: ["marque"],
    },
    serverActions: [],
  },
  {
    key: "statistiques.resume",
    domain: "statistiques",
    description: "Lire les chiffres du jour",
    examples: ["donne-moi les chiffres du jour", "résumé d'aujourd'hui"],
    kind: "read",
    role: "MANAGER",
    confirm: "none",
    params: { type: "object", additionalProperties: false, properties: {} },
    serverActions: [],
  },
  {
    key: "equipe.inviter",
    domain: "equipe",
    description: "Inviter une personne sur le site",
    examples: ["invite lea@exemple.fr comme manager", "ajoute Paul à l'équipe du site"],
    kind: "create",
    role: "ADMIN",
    confirm: "yes",
    params: { type: "object", additionalProperties: false, properties: { email: { type: "string" } }, required: ["email"] },
    serverActions: [],
  },
  {
    key: "connecteurs.meta_connecter",
    domain: "connecteurs",
    description: "Connecter Meta",
    examples: ["connecte Meta", "branche le compte Facebook pub"],
    kind: "connect",
    role: "ADMIN",
    confirm: "none",
    params: { type: "object", additionalProperties: false, properties: {} },
    serverActions: [],
  },
  {
    key: "reglages.bot_ajouter",
    domain: "reglages",
    description: "Ajouter un bot Telegram par son jeton",
    examples: ["ajoute le bot casino", "nouveau bot pour les paris"],
    kind: "secret",
    role: "ADMIN",
    confirm: "none",
    params: { type: "object", additionalProperties: false, properties: { univers: { type: "string" } } },
    secretParams: ["jeton"],
    serverActions: [],
  },
];

vi.mock("./ops", () => ({ SITE_OPS: FAKE_OPS }));

const forwardedStore = new Map<string, unknown>();
vi.mock("./inputs", () => ({
  peekForwarded: vi.fn(async (_d: unknown, chatId: string) => forwardedStore.get(chatId) ?? null),
  takeForwarded: vi.fn(async (_d: unknown, chatId: string) => {
    const v = forwardedStore.get(chatId) ?? null;
    forwardedStore.delete(chatId);
    return v;
  }),
  peekDocument: vi.fn(async () => null),
  takeDocument: vi.fn(async () => null),
  createAuthLink: vi.fn(async (_d: unknown, req: { purpose: string; chatId: string }) => ({ url: `https://app.linkaffipro.com/k/jeton-${req.purpose}-${req.chatId}`, expiresAt: "" })),
}));

vi.mock("../missions/lifecycle", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  continueMission: vi.fn(async () => undefined),
}));

const { createBossKit } = await import("../boss/testing");
const { bossAiTurn } = await import("../boss/execute");
const { bossFastPath } = await import("../boss/fast");
const { handleBossCallback, isBossCallbackData } = await import("../boss/confirm");
const { voiceCheck, resetVoiceRotation } = await import("../boss/voice");
const { respondToRequest } = await import("../human/respond");
const { ADMIN_TG_ID } = await import("../human/test-kit");
const { capability, listCapabilities } = await import("../orders/registry");
const { colleagueError } = await import("./errors");
const { siteOpAllowed } = await import("./flow");

type Call = Parameters<SiteOpsClient>[0];

function fakeSite(handler: (req: Call) => SiteOpResult | Promise<SiteOpResult>) {
  const calls: Call[] = [];
  const client: SiteOpsClient = async (req) => {
    calls.push(JSON.parse(JSON.stringify(req)) as Call);
    return handler(req);
  };
  return { client, calls, real: () => calls.filter((c) => !c.dryRun) };
}

const tool = (op: string, params: Record<string, unknown> = {}) => ({ name: `site_${op.split(".")[0]}`, input: { op, params } });

async function kitWith(table: Parameters<typeof createBossKit>[0], site: ReturnType<typeof fakeSite>) {
  const kit = await createBossKit(table);
  kit.deps.siteOps = site.client;
  return kit;
}

const okVoice = (t: string | undefined) => {
  const r = voiceCheck(t ?? "", { allowList: true });
  expect(r.problems, t).toEqual([]);
};

beforeEach(() => {
  resetVoiceRotation();
  forwardedStore.clear();
});

describe("déroulé : confirmation « none »", () => {
  it("essai à blanc puis exécution, message du site en phrase de collègue, aucun journal en double côté Kevin", async () => {
    const site = fakeSite((r) => (r.dryRun ? { ok: true, message: "", preview: { summary: "Étiquette VIP" } } : { ok: true, message: "Étiquette « VIP » créée." }));
    const kit = await kitWith([["crée l'étiquette VIP", tool("reglages.etiquette_creer", { nom: "VIP" })]], site);
    const r = await bossAiTurn(kit.deps, kit.input("crée l'étiquette VIP"));
    expect(site.calls.map((c) => c.dryRun)).toEqual([true, false]);
    expect(site.calls[0]!.actor).toMatchObject({ role: "ADMIN", via: "TELEGRAM", telegramUserId: ADMIN_TG_ID.toString() });
    expect(r.reply).toBe("Étiquette « VIP » créée.");
    okVoice(r.reply);
    expect(kit.tables("auditLog").filter((a) => String(a.action).startsWith("boss."))).toEqual([]);
  });
});

describe("déroulé : confirmation « yes » (OUI / NON)", () => {
  it("récapitulatif + OUI, puis exécution au OUI ; aucun boss.site_op au journal", async () => {
    const site = fakeSite((r) => (r.dryRun ? { ok: true, message: "", preview: { summary: "Plafond vidéo de ce mois : 80 € (au lieu de 100 €)" } } : { ok: true, message: "Plafond vidéo réglé à 80 €." }));
    const kit = await kitWith([["monte le budget vidéo à 80", tool("agents.budget_video", { euros: 80 })]], site);
    const r = await bossAiTurn(kit.deps, kit.input("monte le budget vidéo à 80"));
    expect(r.pendingId).toBeTruthy();
    expect(r.reply).toContain("80 €");
    expect(r.reply).toMatch(/OUI/);
    expect(site.real()).toHaveLength(0);
    const yes = await bossFastPath(kit.deps, kit.input("OUI"));
    expect(yes.handled).toBe(true);
    expect(site.real()).toHaveLength(1);
    expect(site.real()[0]!.input).toEqual({ euros: 80 });
    expect((yes as { reply?: string }).reply).toBe("Plafond vidéo réglé à 80 €.");
    expect(kit.tables("auditLog").filter((a) => a.action === "boss.site_op")).toEqual([]);
  });

  it("NON : rien n'est fait", async () => {
    const site = fakeSite((r) => (r.dryRun ? { ok: true, message: "", preview: { summary: "Plafond vidéo : 80 €" } } : { ok: true, message: "fait" }));
    const kit = await kitWith([["plafond 80", tool("agents.budget_video", { euros: 80 })]], site);
    await bossAiTurn(kit.deps, kit.input("plafond 80"));
    await bossFastPath(kit.deps, kit.input("NON"));
    expect(site.real()).toHaveLength(0);
  });
});

describe("relecture : valeur montrée une seule fois par le site", () => {
  it("le lien d'invitation part en privé à l'admin, à part ; jamais dans la réponse (groupe compris) ni dans la mémoire", async () => {
    const url = "https://app.linkaffipro.com/invite/tok_SECRET_123";
    const site = fakeSite((r) =>
      r.dryRun ? { ok: true, message: "", preview: { summary: "Invitation de lea@exemple.fr" } } : { ok: true, message: "Invitation créée pour lea@exemple.fr.", data: { inviteUrl: url } },
    );
    const kit = await kitWith([["invite lea@exemple.fr", tool("equipe.inviter", { email: "lea@exemple.fr" })]], site);
    await bossAiTurn(kit.deps, kit.input("invite lea@exemple.fr"));
    const before = kit.sent.length;
    const yes = await bossFastPath(kit.deps, kit.input("OUI"));
    expect(site.real()).toHaveLength(1);
    const reply = (yes as { reply?: string }).reply ?? "";
    expect(reply).not.toContain("tok_SECRET_123");
    expect(reply).toMatch(/privé/);
    const privates = kit.sent.slice(before).map((m) => m.html);
    expect(privates.some((h) => h.includes(url))).toBe(true);
    expect(JSON.stringify(kit.tables("bossTurn"))).not.toContain("tok_SECRET_123");
  });
});

describe("relecture : connexion par navigateur", () => {
  it("« connecte Meta » : le lien d'autorisation à usage unique part en privé à l'admin", async () => {
    const site = fakeSite((r) =>
      r.dryRun ? { ok: true, message: "", preview: { summary: "Connexion Meta" } } : { ok: true, message: "Ouvre le lien d'autorisation Meta, puis choisis les comptes à suivre.", data: { authPurpose: "oauth_meta", startPath: "/api/connectors/meta/start" } },
    );
    const kit = await kitWith([["connecte Meta", tool("connecteurs.meta_connecter", {})]], site);
    const before = kit.sent.length;
    const r = await bossAiTurn(kit.deps, kit.input("connecte Meta"));
    expect(site.real()).toHaveLength(1);
    expect(r.reply).toMatch(/privé/);
    expect(r.reply).not.toContain("/k/");
    expect(kit.sent.slice(before).some((m) => m.html.includes(`/k/jeton-oauth_meta-${ADMIN_TG_ID.toString()}`))).toBe(true);
  });
});

describe("déroulé : suppression (mot SUPPRIMER)", () => {
  it("récapitulatif + ce qui disparaît ; « oui » refusé ; « SUPPRIMER » exécute", async () => {
    const site = fakeSite((r) =>
      r.dryRun ? { ok: true, message: "", preview: { summary: "Campagne Celsius FR", impact: "12 liens, les clics restent dans les chiffres" } } : { ok: true, message: "Campagne supprimée." },
    );
    const kit = await kitWith([["supprime la campagne Celsius", tool("campagnes.supprimer", { campagne: "Celsius" })]], site);
    const ask = await bossAiTurn(kit.deps, kit.input("supprime la campagne Celsius"));
    expect(ask.reply).toContain("Campagne Celsius FR");
    expect(ask.reply).toContain("12 liens");
    expect(ask.reply).toContain("SUPPRIMER");
    // Aucun bouton OUI : seulement NON.
    expect(ask.buttons?.flat().map((b) => b.callbackData)).toEqual([`bsc:${ask.pendingId}:no`]);
    okVoice(ask.reply);

    const oui = await bossFastPath(kit.deps, kit.input("oui"));
    expect((oui as { reply?: string }).reply).toContain("SUPPRIMER");
    okVoice((oui as { reply?: string }).reply);
    const lower = await bossFastPath(kit.deps, kit.input("supprimer"));
    expect((lower as { reply?: string }).reply).toContain("SUPPRIMER");
    expect(site.real()).toHaveLength(0);

    const done = await bossFastPath(kit.deps, kit.input("SUPPRIMER"));
    expect(site.real()).toHaveLength(1);
    expect((done as { reply?: string }).reply).toBe("Campagne supprimée.");
    // Le mot ne sert qu'une fois.
    await bossFastPath(kit.deps, kit.input("SUPPRIMER"));
    expect(site.real()).toHaveLength(1);
  });

  it("un OUI qui arriverait jusqu'à l'entrée cachée ne supprime rien (filet)", async () => {
    const site = fakeSite((r) => (r.dryRun ? { ok: true, message: "", preview: { summary: "Campagne test" } } : { ok: true, message: "supprimée" }));
    const kit = await kitWith([["supprime la campagne test", tool("campagnes.supprimer", { campagne: "test" })]], site);
    const ask = await bossAiTurn(kit.deps, kit.input("supprime la campagne test"));
    const forged = await handleBossCallback(kit.deps, { data: `bsc:${ask.pendingId}:yes`, fromTelegramId: ADMIN_TG_ID });
    expect(forged.reply).toContain("SUPPRIMER");
    expect(site.real()).toHaveLength(0);
  });
});

describe("déroulé : envoi (aperçu exact + destinataires + OUI)", () => {
  it("le message transféré devient le contenu ; l'aperçu EXACT est montré tel qu'il partira", async () => {
    const exact = '<b>Ce soir</b> 20 h <tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji> on joue';
    const site = fakeSite((r) =>
      r.dryRun ? { ok: true, message: "", preview: { summary: "Envoi aux membres de Zone Interdite, demain 20 h", exactText: exact, recipients: 340 } } : { ok: true, message: "Envoi programmé pour demain 20 h." },
    );
    const kit = await kitWith([["envoie ça à zone interdite demain 20h", tool("envois.creer", { canal: "Zone Interdite", quand: "demain 20:00" })]], site);
    const forwarded = { html: exact, media: [], from: "@source", receivedAt: "2026-10-23T08:00:00Z" };
    forwardedStore.set(ADMIN_TG_ID.toString(), forwarded);
    const ask = await bossAiTurn(kit.deps, kit.input("envoie ça à zone interdite demain 20h"));
    expect(site.calls[0]!.input.content).toEqual(forwarded);
    expect(ask.reply).toContain(exact);
    expect(ask.reply).toContain("340 personnes");
    expect(ask.reply).toMatch(/OUI/);
    expect(site.real()).toHaveLength(0);
    const yes = await bossFastPath(kit.deps, kit.input("OUI"));
    expect(site.real()).toHaveLength(1);
    expect(site.real()[0]!.input.content).toEqual(forwarded);
    expect((yes as { reply?: string }).reply).toBe("Envoi programmé pour demain 20 h.");
    // Consommé après l'envoi : un second envoi ne reprend jamais le même message.
    expect(forwardedStore.has(ADMIN_TG_ID.toString())).toBe(false);
  });
});

describe("déroulé : message transféré avec médias (règle 6)", () => {
  const withPhoto = (n = 1) => ({
    html: "<b>Ce soir</b> on joue",
    media: Array.from({ length: n }, (_, i) => ({ kind: "photo" as const, fileId: `AgAD${i}` })),
    from: "@source",
    receivedAt: "2026-10-23T08:00:00Z",
  });
  const siteWithMedia = () =>
    fakeSite((r) => {
      const media = typeof r.input.mediaAssetId === "string" ? " Avec une photo." : "";
      return r.dryRun
        ? { ok: true, message: "", preview: { summary: `Envoi aux membres de Zone Interdite, demain 20 h.${media}`, exactText: "<b>Ce soir</b> on joue", recipients: 12 } }
        : { ok: true, message: "Envoi programmé pour demain 20 h." };
    });

  it("photo rangée AVANT l'essai à blanc : l'essai reçoit mediaAssetId, l'aperçu dit « avec une photo », l'envoi garde le même média", async () => {
    const site = siteWithMedia();
    const kit = await kitWith([["envoie ça à zone interdite demain 20h", tool("envois.creer", { canal: "Zone Interdite", quand: "demain 20:00" })]], site);
    const ingest = vi.fn(async (c: { media: unknown[] }) => ({ assetIds: c.media.map((_, i) => `asset${i + 1}`) }));
    kit.deps.ingestForwardedMedia = ingest;
    forwardedStore.set(ADMIN_TG_ID.toString(), withPhoto(3));
    const ask = await bossAiTurn(kit.deps, kit.input("envoie ça à zone interdite demain 20h"));
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(site.calls[0]!.dryRun).toBe(true);
    expect(site.calls[0]!.input).toMatchObject({ mediaAssetId: "asset1", mediaAssetIds: ["asset1", "asset2", "asset3"] });
    expect(ask.reply).toContain("Avec une photo.");
    await bossFastPath(kit.deps, kit.input("OUI"));
    expect(site.real()).toHaveLength(1);
    // Même média à l'exécution, sans nouvelle ingestion.
    expect(site.real()[0]!.input).toMatchObject({ mediaAssetId: "asset1" });
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("média trop lourd : phrase de Kevin, rien n'est appelé sur le site", async () => {
    const site = siteWithMedia();
    const kit = await kitWith([["envoie ça à zone interdite", tool("envois.creer", { canal: "Zone Interdite" })]], site);
    kit.deps.ingestForwardedMedia = async () => ({ error: "vidéo de plus de 20 Mo", code: "too_big" as const });
    forwardedStore.set(ADMIN_TG_ID.toString(), withPhoto());
    const r = await bossAiTurn(kit.deps, kit.input("envoie ça à zone interdite"));
    expect(site.calls).toHaveLength(0);
    expect(r.reply).toMatch(/20 Mo/);
    okVoice(r.reply);
    // Le contenu reste disponible (rien n'est consommé) : l'admin peut renvoyer une version plus légère.
    expect(forwardedStore.has(ADMIN_TG_ID.toString())).toBe(true);
  });

  it("téléchargement en échec : phrase de Kevin, rien n'est envoyé", async () => {
    const site = siteWithMedia();
    const kit = await kitWith([["envoie ça à zone interdite", tool("envois.creer", { canal: "Zone Interdite" })]], site);
    kit.deps.ingestForwardedMedia = async () => {
      throw new Error("réseau");
    };
    forwardedStore.set(ADMIN_TG_ID.toString(), withPhoto());
    const r = await bossAiTurn(kit.deps, kit.input("envoie ça à zone interdite"));
    expect(site.calls).toHaveLength(0);
    okVoice(r.reply);
  });

  it("sans média, ou sans ingestion branchée : rien ne change (le site décide)", async () => {
    const site = siteWithMedia();
    const kit = await kitWith([["envoie ça à zone interdite", tool("envois.creer", { canal: "Zone Interdite" })]], site);
    forwardedStore.set(ADMIN_TG_ID.toString(), withPhoto());
    await bossAiTurn(kit.deps, kit.input("envoie ça à zone interdite"));
    expect(site.calls[0]!.input.mediaAssetId).toBeUndefined();
  });

  it("textes des erreurs de médias : voix de Kevin", async () => {
    const { SITE_FLOW_VARIANTS } = await import("./flow");
    for (const t of [...SITE_FLOW_VARIANTS.mediaTooBig, ...SITE_FLOW_VARIANTS.mediaFailed]) okVoice(t);
  });
});

describe("valeur manquante : question, puis boutons", () => {
  it("champ sans liste : une question de collègue", async () => {
    const site = fakeSite(() => ({ ok: false, code: "invalid", field: "pays", error: "Le champ pays est obligatoire." }));
    const kit = await kitWith([["crée une campagne Celsius", tool("campagnes.creer", { marque: "Celsius" })]], site);
    const r = await bossAiTurn(kit.deps, kit.input("crée une campagne Celsius"));
    expect(r.reply).toMatch(/le pays/);
    expect(r.reply).toMatch(/\?/);
    expect(r.buttons).toBeUndefined();
    okVoice(r.reply);
  });

  it("champ avec liste : des boutons bsk:, le choix reprend le déroulé", async () => {
    const site = fakeSite((r) => {
      if (!r.input.univers) return { ok: false, code: "invalid", field: "univers", error: "Choisissez un univers." };
      return r.dryRun ? { ok: true, message: "", preview: { summary: "Campagne Celsius casino" } } : { ok: true, message: "Campagne Celsius créée." };
    });
    const kit = await kitWith([["crée une campagne Celsius", tool("campagnes.creer", { marque: "Celsius" })]], site);
    const r = await bossAiTurn(kit.deps, kit.input("crée une campagne Celsius"));
    const datas = r.buttons!.flat().map((b) => b.callbackData);
    expect(datas).toHaveLength(3);
    expect(datas.every((d) => d.startsWith("bsk:"))).toBe(true);
    expect(isBossCallbackData(datas[0]!)).toBe(true);
    okVoice(r.reply);
    // Une autre personne : silence.
    const other = await handleBossCallback(kit.deps, { data: datas[0]!, fromTelegramId: 999n });
    expect(other.reply).toBeUndefined();
    expect(site.real()).toHaveLength(0);
    const chosen = await handleBossCallback(kit.deps, { data: datas[0]!, fromTelegramId: ADMIN_TG_ID });
    expect(site.real()).toHaveLength(1);
    expect(site.real()[0]!.input).toMatchObject({ marque: "Celsius", univers: "casino" });
    expect(chosen.reply).toBe("Campagne Celsius créée.");
    // Bouton déjà utilisé : plus valable.
    const again = await handleBossCallback(kit.deps, { data: datas[0]!, fromTelegramId: ADMIN_TG_ID });
    expect(again.reply).toBeUndefined();
    expect(site.real()).toHaveLength(1);
  });

  it("relecture : une lecture réservée à l'admin, dans un ordre, est un réglage d'admin (un membre ne la lance pas)", async () => {
    const { siteCapability } = await import("./capabilities");
    const { adminOnlyOrder } = await import("../orders/recap");
    const kit = await kitWith([], fakeSite(() => ({ ok: true, message: "", preview: { summary: "3 comptes" } })));
    const adminRead: SiteOpMeta = { ...FAKE_OPS.find((o) => o.kind === "read")!, key: "statistiques.comptes", role: "ADMIN" };
    const steps = await siteCapability(adminRead).plan(kit.deps, {}, { now: new Date(), mode: "simulation" });
    expect(adminOnlyOrder({ plannedSteps: steps } as never)).toBe(true);
    const managerRead = FAKE_OPS.find((o) => o.kind === "read")!;
    const steps2 = await siteCapability(managerRead).plan(kit.deps, {}, { now: new Date(), mode: "simulation" });
    expect(adminOnlyOrder({ plannedSteps: steps2 } as never)).toBe(false);
  });
});

describe("droits (règle 2)", () => {
  const group = { type: "group" as const, chatId: -100123n };

  async function member(kit: Awaited<ReturnType<typeof kitWith>>, role: "ADMIN" | "MANAGER" | "MEMBER", id = 77n) {
    await kit.prisma.teamMember.create({ data: { telegramUserId: id, firstName: "Léa", role } as never });
    return { kind: "member" as const, telegramUserId: id, memberId: "m", role, firstName: "Léa" };
  }

  it("niveau du site : lecture seule ne permet que les lectures ; MANAGER pas les opérations ADMIN", () => {
    const read = FAKE_OPS.find((o) => o.kind === "read")!;
    const admin = FAKE_OPS.find((o) => o.role === "ADMIN")!;
    const managerOp = FAKE_OPS.find((o) => o.role === "MANAGER" && o.kind === "create")!;
    expect(siteOpAllowed(read, "READ")).toBe(true);
    expect(siteOpAllowed(managerOp, "READ")).toBe(false);
    expect(siteOpAllowed(admin, "MANAGER")).toBe(false);
    expect(siteOpAllowed(managerOp, "MANAGER")).toBe(true);
    expect(siteOpAllowed(admin, "ADMIN")).toBe(true);
    expect(siteOpAllowed(read, null)).toBe(false);
    // Relecture : une lecture réservée à l'admin n'est jamais ouverte au simple membre (lecture seule).
    expect(siteOpAllowed({ kind: "read", role: "ADMIN" }, "READ")).toBe(false);
    expect(siteOpAllowed({ kind: "read", role: "ADMIN" }, "MANAGER")).toBe(false);
  });

  it("responsable du groupe sur une opération d'admin : refus, rien n'est appelé", async () => {
    const site = fakeSite(() => ({ ok: true, message: "fait", preview: { summary: "x" } }));
    const kit = await kitWith([["plafond vidéo 80", tool("agents.budget_video", { euros: 80 })]], site);
    const lea = await member(kit, "MANAGER");
    const r = await bossAiTurn(kit.deps, kit.input("plafond vidéo 80", { speaker: lea, chat: group }));
    expect(site.calls).toHaveLength(0);
    expect(r.reply).toMatch(/qui décide/);
    okVoice(r.reply);
  });

  it("responsable : une opération MANAGER passe avec son rôle (relu en base)", async () => {
    const site = fakeSite((r) => (r.dryRun ? { ok: true, message: "" } : { ok: true, message: "Étiquette créée." }));
    const kit = await kitWith([["crée l'étiquette VIP", tool("reglages.etiquette_creer", { nom: "VIP" })]], site);
    const lea = await member(kit, "MANAGER");
    const r = await bossAiTurn(kit.deps, kit.input("crée l'étiquette VIP", { speaker: lea, chat: group }));
    expect(site.real()).toHaveLength(1);
    expect(site.real()[0]!.actor).toMatchObject({ role: "MANAGER", telegramUserId: "77", via: "TELEGRAM" });
    expect(r.reply).toBe("Étiquette créée.");
  });

  it("membre simple : lecture oui, réglage non", async () => {
    const site = fakeSite(() => ({ ok: true, message: "Aujourd'hui : 12 nouveaux membres." }));
    const kit = await kitWith(
      [
        ["les chiffres du jour", tool("statistiques.resume")],
        ["crée l'étiquette VIP", tool("reglages.etiquette_creer", { nom: "VIP" })],
      ],
      site,
    );
    const marc = await member(kit, "MEMBER", 88n);
    const read = await bossAiTurn(kit.deps, kit.input("les chiffres du jour", { speaker: marc, chat: group }));
    expect(read.reply).toContain("12 nouveaux membres");
    const n = site.calls.length;
    const write = await bossAiTurn(kit.deps, kit.input("crée l'étiquette VIP", { speaker: marc, chat: group }));
    expect(site.calls.length).toBe(n);
    expect(write.reply).toMatch(/regarder|consulter/);
    okVoice(write.reply);
  });

  it("inconnu (membre retiré ou jamais présenté) : rien", async () => {
    const site = fakeSite(() => ({ ok: true, message: "x" }));
    const kit = await kitWith([["les chiffres du jour", tool("statistiques.resume")]], site);
    const ghost = { kind: "member" as const, telegramUserId: 555n, memberId: "x", role: "ADMIN" as const, firstName: "Inconnu" };
    const r = await bossAiTurn(kit.deps, kit.input("les chiffres du jour", { speaker: ghost, chat: group }));
    expect(site.calls).toHaveLength(0);
    expect(r.reply ?? "").toBe("");
  });
});

describe("secrets (règle 4)", () => {
  it("dans le groupe : « envoie-le-moi en privé », rien n'est demandé ni appelé", async () => {
    const site = fakeSite(() => ({ ok: true, message: "x" }));
    const kit = await kitWith([["ajoute le bot casino", tool("reglages.bot_ajouter", { univers: "casino" })]], site);
    await kit.prisma.teamMember.create({ data: { telegramUserId: 77n, firstName: "Léa", role: "ADMIN" } as never });
    const lea = { kind: "member" as const, telegramUserId: 77n, memberId: "m", role: "ADMIN" as const, firstName: "Léa" };
    const r = await bossAiTurn(kit.deps, kit.input("ajoute le bot casino", { speaker: lea, chat: { type: "group", chatId: -100n } }));
    expect(r.reply).toMatch(/en privé/);
    okVoice(r.reply);
    expect(site.calls).toHaveLength(0);
    expect(kit.tables("humanRequest")).toHaveLength(0);
  });

  it("en privé : demande SECRET, jamais à l'IA ; la réponse reprend le déroulé ; secret effacé après usage", async () => {
    const site = fakeSite((r) => (r.dryRun ? { ok: true, message: "" } : { ok: true, message: "Bot @casino_bot ajouté." }));
    // L'IA essaie de glisser un jeton dans les paramètres : retiré.
    const kit = await kitWith([["ajoute le bot casino", tool("reglages.bot_ajouter", { univers: "casino", jeton: "123456:AAAA" })]], site);
    const r = await bossAiTurn(kit.deps, kit.input("ajoute le bot casino"));
    okVoice(r.reply);
    const req = kit.tables("humanRequest")[0]!;
    expect(req.kind).toBe("SECRET");
    expect(String(req.key)).toMatch(/^site\.reglages\.bot_ajouter\.jeton\./);
    expect(site.calls).toHaveLength(0);
    const token = "7012345678:AAH-abcdefghijklmnopqrstuvwxyz012345";
    const res = await respondToRequest(kit.deps, req as never, token, { userId: null, via: "TELEGRAM" });
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Bot @casino_bot ajouté.");
    expect(site.real()).toHaveLength(1);
    expect(site.real()[0]!.input).toEqual({ univers: "casino", jeton: token });
    // Le secret n'est plus rangé, ni dans l'état, ni dans le journal, ni chez l'IA.
    expect(kit.tables("setting").some((s) => String(s.key).startsWith("agents.secret.site."))).toBe(false);
    expect(JSON.stringify(kit.tables("setting"))).not.toContain(token);
    expect(JSON.stringify([kit.tables("auditLog"), kit.tables("event")])).not.toContain(token);
    expect(JSON.stringify(kit.llm.calls)).not.toContain(token);
  });
});

describe("erreur du site traduite (voix de Kevin)", () => {
  it("vouvoiement et impératif du site → tutoiement, jamais recopié s'il ne passe pas", async () => {
    const t = await colleagueError({ ok: false, code: "invalid", error: "Veuillez choisir un pays valide pour votre campagne." });
    okVoice(t);
    expect(t).not.toMatch(/vous|votre|Veuillez/i);
    const raw = "Erreur PENDING_DONE dans la mission : payload invalide, vous devez réessayer.";
    const u = await colleagueError({ ok: false, code: "invalid", error: raw });
    okVoice(u);
    expect(u).not.toBe(raw);
    expect(await colleagueError({ ok: false, code: "unavailable", error: "ECONNREFUSED 10.0.0.1" })).not.toContain("ECONNREFUSED");
  });

  it("règles : champ manquant → question, impératifs et vouvoiement → tutoiement", async () => {
    const { colleagueRules } = await import("./errors");
    expect(colleagueRules("Une étiquette porte déjà ce nom, choisissez-en un autre.")).toBe("Une étiquette porte déjà ce nom, choisis-en un autre.");
    expect(colleagueRules("Indiquez votre pays.")).toBe("Dis-moi ton pays.");
    expect(colleagueRules("Modifiez le nom.")).toBe("Modifie le nom.");
    expect(colleagueRules("Le champ pays est obligatoire.")).toMatch(/^Il (me manque|me faut encore) le pays/);
    expect(colleagueRules("Nom requis")).toMatch(/le nom/);
  });

  it("dans le déroulé : l'erreur du site arrive traduite", async () => {
    const site = fakeSite(() => ({ ok: false, code: "conflict", error: "Une étiquette porte déjà ce nom, choisissez-en un autre." }));
    const kit = await kitWith([["crée l'étiquette VIP", tool("reglages.etiquette_creer", { nom: "VIP" })]], site);
    const r = await bossAiTurn(kit.deps, kit.input("crée l'étiquette VIP"));
    okVoice(r.reply);
    expect(r.reply).not.toMatch(/choisissez/);
  });

  it("site injoignable (pas de client) : phrase simple", async () => {
    const kit = await createBossKit([["crée l'étiquette VIP", tool("reglages.etiquette_creer", { nom: "VIP" })]]);
    const r = await bossAiTurn(kit.deps, kit.input("crée l'étiquette VIP"));
    expect(r.reply).toMatch(/site/);
    okVoice(r.reply);
  });
});

describe("outils de l'IA et capacités du planificateur", () => {
  it("un outil par domaine, sans champ secret ; opération d'un autre domaine refusée", async () => {
    const { bossTools, decisionOf } = await import("../boss/interpret");
    const names = bossTools().map((t) => t.name);
    for (const d of ["site_reglages", "site_agents", "site_campagnes", "site_envois", "site_statistiques"]) expect(names).toContain(d);
    const reglages = bossTools().find((t) => t.name === "site_reglages")!;
    expect(JSON.stringify(reglages.inputSchema)).not.toContain("jeton");
    expect(reglages.description).toContain("reglages.etiquette_creer : Créer une étiquette de membres — « crée l'étiquette VIP »");
    expect(decisionOf({ name: "site_reglages", input: { op: "campagnes.supprimer", params: {} } }).type).toBe("pas_prevu");
    expect(decisionOf({ name: "site_reglages", input: { op: "reglages.etiquette_creer", params: { nom: "x" } } }).type).toBe("site");
  });

  it("capacités : lectures, réglages et créations enregistrées (équipe transverse) ; jamais suppression, envoi ni secret", async () => {
    expect(capability("transverse", "reglages.etiquette_creer")).not.toBeNull();
    expect(capability("transverse", "agents.budget_video")).not.toBeNull();
    expect(capability("transverse", "statistiques.resume")).not.toBeNull();
    expect(capability("transverse", "campagnes.supprimer")).toBeNull();
    expect(capability("transverse", "envois.creer")).toBeNull();
    expect(capability("transverse", "reglages.bot_ajouter")).toBeNull();
    expect(listCapabilities().some((c) => c.key === "faire_comme_si")).toBe(true);
    const site = fakeSite((r) => {
      if (!r.input.univers) return { ok: false, code: "invalid", field: "univers", error: "Choisissez un univers." };
      return r.dryRun ? { ok: true, message: "", preview: { summary: "Campagne Celsius casino" } } : { ok: true, message: "Campagne créée." };
    });
    const kit = await kitWith([], site);
    const cap = capability("transverse", "campagnes.creer")!;
    const bad = await cap.check(kit.deps, { marque: "Celsius" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.alternatives.map((a) => a.label)).toEqual(["casino", "paris", "rencontres"]);
    const good = await cap.check(kit.deps, { marque: "Celsius", univers: "casino" });
    expect(good.ok).toBe(true);
    const steps = await cap.plan(kit.deps, { marque: "Celsius", univers: "casino" }, { now: new Date(), mode: "simulation" });
    expect(steps[0]).toMatchObject({ summary: "Campagne Celsius casino", touches: { setting: true } });
    expect(site.real()).toHaveLength(0);
    const run = await cap.run(kit.deps, { id: "o", number: 1, teamKey: "transverse", kind: "ADJUST", status: "RUNNING", interpretation: {}, startsAt: null, endsAt: null, chatId: null, createdById: null, progress: {} }, steps[0]!);
    expect(run).toMatchObject({ ok: true, message: "Campagne créée." });
    expect(site.real()).toHaveLength(1);
  });
});

describe("aide par domaine et « comment je fais »", () => {
  it("« aide campagnes » détaille le domaine ; « comment je fais pour créer une campagne ? » donne la phrase", async () => {
    const kit = await createBossKit();
    const aide = await bossFastPath(kit.deps, kit.input("aide campagnes"));
    const a = (aide as { reply?: string }).reply ?? "";
    expect(a).toContain("crée une campagne pour Celsius en France avec un CPA de 120");
    expect(a).toContain("supprime la campagne Celsius");
    expect(voiceCheck(a, { allowList: true, allowLong: true }).problems).toEqual([]);
    const how = await bossFastPath(kit.deps, kit.input("comment je fais pour créer une campagne ?"));
    const h = (how as { reply?: string }).reply ?? "";
    expect(h).toContain("crée une campagne pour Celsius en France");
    expect(h).not.toMatch(/va sur le site/);
    okVoice(h);
    const full = await bossFastPath(kit.deps, kit.input("aide"));
    const f = (full as { reply?: string }).reply ?? "";
    expect(f).toMatch(/• Campagnes : « .+ », « .+ »/);
    expect(f).toContain("« crée une campagne pour Celsius en France avec un CPA de 120 »");
    expect(voiceCheck(f, { allowList: true, allowLong: true }).problems).toEqual([]);
  });
});

describe("« comment je fais » : exclusion documentée → son remplacement", () => {
  it("jamais « va sur le site », le remplacement de l'exclusion à la place", async () => {
    const { bossHowToReply } = await import("../boss/guide");
    const exclusions = { "app/login/actions.ts#loginAction": { excluded: { reason: "connexion au site (sécurité du compte)", replacement: "je t'envoie le lien de connexion, valable 15 minutes" } } };
    const r = bossHowToReply("comment je fais pour la connexion au site ?", null, { ops: [], exclusions })!;
    expect(r).toContain("je t'envoie le lien de connexion, valable 15 minutes");
    expect(r).not.toMatch(/va sur le site/);
    expect(voiceCheck(r).problems).toEqual([]);
    expect(bossHowToReply("comment ça va ?", null, { ops: [], exclusions })).toBeNull();
    expect(bossHowToReply("crée une campagne", null, { ops: [], exclusions })).toBeNull();
  });
});
