/**
 * Phase 34, lot C — cœurs des membres, envois groupés, relances, conversations et personas : mêmes erreurs que le
 * site, droits, essai à blanc sans écriture ni mise en file, aperçu EXACT d'un envoi (message transféré gardé tel
 * quel, emojis animés compris, {prenom} d'un vrai destinataire) avec le nombre réel de destinataires.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForwardedContent, SiteOpActor } from "@linkaffipro/agents";

const db = vi.hoisted(() => {
  const writes: string[] = [];
  const data: Record<string, Record<string, (args: unknown) => unknown>> = {};
  const WRITE = /^(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, m: string) => async (args: unknown) => {
          if (WRITE.test(m)) writes.push(`${name}.${m}`);
          const fn = data[name]?.[m];
          if (fn) return fn(args);
          if (WRITE.test(m)) return { id: `${name}-new`, count: 0 };
          return m === "findMany" ? [] : m === "count" ? 0 : null;
        },
      },
    );
  const base: Record<string, unknown> = {
    $transaction: async (x: unknown) => {
      writes.push("$transaction");
      return Array.isArray(x) ? Promise.all(x) : (x as (p: unknown) => unknown)(prisma);
    },
  };
  const prisma: Record<string, unknown> = new Proxy(base, {
    get: (t, k: string) => (k in t ? t[k] : model(k)),
  });
  return {
    prisma,
    writes,
    data,
    audit: vi.fn(async (..._a: unknown[]) => undefined),
    recordEvent: vi.fn(async () => undefined),
    toJsonValue: (v: unknown) => v,
    Prisma: { DbNull: "DbNull" },
  };
});
vi.mock("@linkaffipro/db", () => db);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f }));
vi.mock("@/lib/dashboard/cache", () => ({ invalidateDashboards: vi.fn(), cachedDashboard: (_n: string, f: unknown) => f }));
vi.mock("@/lib/campaigns/queries", () => ({ campaignTree: vi.fn(async () => []), apiFedCampaignIds: vi.fn(async () => new Set()) }));
const queue = vi.hoisted(() => ({
  enqueue: vi.fn(async (..._a: unknown[]) => ({})),
  enqueueDm: vi.fn(async (..._a: unknown[]) => ({ outboundMessageId: "o1" })),
}));
vi.mock("@linkaffipro/queue", () => queue);
vi.mock("@linkaffipro/telegram", () => ({ offerDeepLink: vi.fn(() => "https://t.me/x") }));
vi.mock("@/lib/env", () => ({ env: { trackingBaseUrl: "https://go.example" } }));
vi.mock("@/lib/campaigns/refresh", () => ({ refreshCampaignStats: vi.fn(async () => undefined) }));
vi.mock("@/lib/custom-emoji/usage", () => ({ markCustomEmojisUsed: vi.fn(async () => 0) }));
vi.mock("@/lib/broadcasts/queries", () => ({ countTargets: vi.fn(async () => 37) }));
vi.mock("@/lib/broadcasts/ab-queries", () => ({ loadAbComparison: vi.fn(async () => null) }));
vi.mock("@/lib/members/tags", () => ({
  getTagRegistry: async () => [{ name: "VIP", color: "gold" }, { name: "à relancer", color: "blue" }],
  memberTags: (v: unknown) => (Array.isArray(v) ? v : []),
}));
vi.mock("@/lib/affiliates/anonymize", () => ({ scrubLinkaffiEventsOps: () => [] }));
const attribution = vi.hoisted(() => ({
  changeMemberAffiliate: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Le membre sera rattaché à Max." })),
  removeMemberAffiliate: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "ok" })),
}));
vi.mock("@/lib/affiliates/attribution-server", () => attribution);
const ops = vi.hoisted(() => ({
  takeOverConversation: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Vous avez la main." })),
  releaseConversation: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Rendue." })),
  closeConversation: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Fermée." })),
  blockConversation: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Bloquée." })),
  clearNeedsHuman: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Traitée." })),
  sendTeamMessage: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Message envoyé.", tookOver: true })),
  previewTeamAction: vi.fn(async (_id: unknown, kind: unknown, text?: unknown) =>
    kind === "block"
      ? { ok: false, error: "La personne a écrit /stop : la conversation est terminée." }
      : { ok: true, message: "Vous aurez la main.", ...(typeof text === "string" ? { text } : {}) },
  ),
}));
vi.mock("@/lib/conversations/operations", () => ops);
const personas = vi.hoisted(() => ({
  savePersona: vi.fn(async (..._a: unknown[]) => ({
    ok: true,
    id: "p1",
    created: true,
    message: "Persona « Inès » créée.",
    problem: null,
  })),
  deletePersona: vi.fn(async (_id: unknown, user: { role: string }) =>
    user.role === "ADMIN"
      ? { ok: true, message: "Persona supprimée." }
      : { ok: false, error: "Seul un administrateur peut supprimer une persona." },
  ),
}));
vi.mock("@/lib/personas/save", () => personas);
const personaMedia = vi.hoisted(() => ({
  savePersonaMedia: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Médias enregistrés." })),
  loadPersonaMedia: vi.fn(async () => ({
    referenceImageIds: ["img1"],
    references: [],
    loraUrl: null,
    loraTrigger: null,
    loraScale: 0.8,
    mediaNotes: null,
  })),
}));
vi.mock("@/lib/personas/media-save", () => personaMedia);
vi.mock("@/lib/personas/queries", () => ({
  loadPersona: vi.fn(async () => null),
  profileTemplates: () => ({}),
}));

import { addNote, anonymizeMember, ANONYMIZE_CONFIRM_ERROR, changeAffiliate, editNote, setMemberTags } from "./members";
import { ASSISTANT_BOT_ERROR, cancelBroadcast, createBroadcast, deleteDraft, sendNow, testToMe } from "./broadcasts";
import { deleteRule, saveCard, saveRuleCore, testRuleOnMe, toggleRule } from "./automations";
import {
  block,
  deletePersonaCore,
  savePersonaCore,
  savePersonaMediaCore,
  sendTeam,
  takeOver,
} from "./conversations";
import { LOT_C_IMPL } from "../lot-c";

const KEVIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "TELEGRAM", telegramUserId: "42" };
const MANAGER: SiteOpActor = { ...KEVIN, userId: "u2", role: "MANAGER" };
const WEB: SiteOpActor = { userId: "u1", role: "ADMIN", via: "WEB", telegramUserId: null };

function err(r: { ok: boolean; error?: string }): string {
  if (r.ok) throw new Error("réussite inattendue");
  return r.error!;
}

const CHANNELS = [{ id: "ch1", title: "🚩𝒁𝒐𝒏𝒆 𝑰𝒏𝒕𝒆𝒓𝒅𝒊𝒕𝒆", username: "zone_interdite" }];
const BOT = { id: "bot1", isActive: true, mode: "STANDARD", role: "CHANNEL", name: "Zone Bot", username: "zone_bot" };

beforeEach(() => {
  vi.clearAllMocks();
  db.writes.length = 0;
  for (const k of Object.keys(db.data)) delete db.data[k];
  db.data.channel = {
    findMany: () => CHANNELS,
    findUnique: () => ({ primaryBotId: "bot1" }),
  };
  db.data.bot = { findMany: () => [BOT], findUnique: () => BOT };
  db.data.member = {
    findUnique: () => ({ id: "m1", firstName: "Paul", username: "paulm", telegramUserId: 777n, anonymizedAt: null, tags: ["VIP"], botStates: [{ canDm: true }] }),
    findFirst: () => ({ firstName: "Léa" }),
    findMany: () => [{ id: "m1", firstName: "Paul", lastName: "Martin", username: "paulm" }],
  };
});

describe("fiche membre", () => {
  it("note vide : même message que le site ; Kevin trouve le membre par son @pseudo", async () => {
    expect(err(await addNote({ memberId: "m1", text: "  " }, WEB))).toBe("La note est vide ou dépasse 2 000 caractères.");
    db.data.member!.findUnique = (a) =>
      (a as { where: { id?: string } }).where.id === "@paulm" ? null : { id: "m1", firstName: "Paul", username: "paulm" };
    const dry = await addNote({ member: "@paulm", text: "a demandé un bonus" }, KEVIN, { dryRun: true });
    expect(dry.ok).toBe(true);
    expect(db.writes).toEqual([]);
  });

  it("un responsable ne modifie pas la note d'un autre", async () => {
    db.data.memberNote = { findUnique: () => ({ id: "n1", memberId: "m1", authorId: "u1", text: "x" }) };
    expect(err(await editNote({ noteId: "n1", text: "y" }, MANAGER))).toBe("Vous ne pouvez modifier que vos propres notes.");
  });

  it("étiquettes : inconnue refusée ; ajout gardant les autres ; essai à blanc sans écriture", async () => {
    expect(err(await setMemberTags({ memberId: "m1", add: ["Inconnue"] }, KEVIN))).toMatch(/Étiquette inconnue/);
    const dry = await setMemberTags({ memberId: "m1", add: ["à relancer"] }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview?.summary).toBe("Étiquettes du membre : VIP, à relancer.");
    expect(db.writes).toEqual([]);
  });

  it("anonymiser : ADMIN seulement, mot SUPPRIMER exigé sur le site, essai à blanc avec l'impact", async () => {
    expect(err(await anonymizeMember({ memberId: "m1" }, MANAGER))).toBe("Réservé aux administrateurs.");
    expect(err(await anonymizeMember({ memberId: "m1", confirm: "oui" }, WEB))).toBe(ANONYMIZE_CONFIRM_ERROR);
    const dry = await anonymizeMember({ memberId: "m1" }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview?.impact).toMatch(/Irréversible/);
    expect(db.writes).toEqual([]);
    const r = await anonymizeMember({ memberId: "m1" }, KEVIN);
    expect(r.ok).toBe(true);
    expect(db.writes).toContain("$transaction");
    expect(db.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "member.anonymized", metadata: { via: "TELEGRAM" } }));
  });

  it("affilié : ADMIN seulement ; essai à blanc transmis à la fonction métier", async () => {
    expect(err(await changeAffiliate({ memberId: "m1", inviteLinkId: "l1", reason: "x" }, MANAGER))).toBe(
      "Réservé aux administrateurs.",
    );
    await changeAffiliate({ memberId: "m1", inviteLinkId: "l1", reason: "erreur de lien" }, KEVIN, { dryRun: true });
    expect(attribution.changeMemberAffiliate).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "m1", dryRun: true, via: "TELEGRAM" }),
    );
  });
});

describe("écrire à un groupe (« envoie ce message à tous les membres de Zone Interdite demain 20 h »)", () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const forwarded: ForwardedContent = {
    html: 'Ce soir, <b>{prenom}</b> : jackpot <tg-emoji emoji-id="5368324170671202286">🎰</tg-emoji>',
    media: [],
    from: "@casino",
    receivedAt: new Date().toISOString(),
  };

  it("essai à blanc : texte EXACT (emoji animé gardé, {prenom} d'un vrai membre), 37 destinataires, rien d'écrit ni de mis en file", async () => {
    const r = await createBroadcast(
      { forwarded, channels: ["zone interdite"], scheduledAt: `${tomorrow}T20:00` },
      KEVIN,
      { dryRun: true },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview?.exactText).toBe(
      'Ce soir, <b>Léa</b> : jackpot <tg-emoji emoji-id="5368324170671202286">🎰</tg-emoji>',
    );
    expect(r.preview?.recipients).toBe(37);
    expect(r.preview?.summary).toMatch(/Envoi programmé/);
    expect(db.writes).toEqual([]);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("vrai : envoi programmé avec le texte transféré tel quel, bot du canal, journal via TELEGRAM", async () => {
    let created: { data: { text: string; botId: string } } | null = null;
    db.data.broadcast = { create: (a) => ((created = a as typeof created), { id: "b1" }) };
    const r = await createBroadcast({ forwarded, channels: ["Zone Interdite"], scheduledAt: `${tomorrow}T20:00` }, KEVIN);
    expect(r.ok && r.message).toBe("Envoi programmé.");
    expect(created!.data.text).toBe(forwarded.html);
    expect(created!.data.botId).toBe("bot1");
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "broadcast.created", metadata: expect.objectContaining({ intent: "schedule", via: "TELEGRAM" }) }),
    );
  });

  it("mêmes erreurs que le site : texte vide, bot assistant, date passée ; média transféré à ranger d'abord", async () => {
    expect(err(await createBroadcast({ name: "x", botId: "bot1", text: "", intent: "draft" }, WEB))).toBe("Le texte est vide.");
    db.data.bot!.findUnique = () => ({ ...BOT, mode: "ASSISTANT" });
    expect(err(await createBroadcast({ name: "x", botId: "bot1", text: "Salut", intent: "draft" }, WEB))).toBe(ASSISTANT_BOT_ERROR);
    db.data.bot!.findUnique = () => BOT;
    expect(err(await createBroadcast({ name: "x", botId: "bot1", text: "Salut", intent: "schedule", scheduledAt: "2020-01-01T10:00" }, WEB))).toBe(
      "Choisissez une date et une heure dans le futur.",
    );
    expect(
      err(await createBroadcast({ forwarded: { ...forwarded, media: [{ kind: "photo", fileId: "f1" }] }, channels: ["Zone Interdite"] }, KEVIN)),
    ).toMatch(/médiathèque/);
    expect(db.writes).toEqual([]);
  });

  it("médias rangés par Kevin avant l'essai à blanc : le premier est joint, l'aperçu dit « 1 photo sur 3 gardée »", async () => {
    const album = { ...forwarded, media: [{ kind: "photo" as const, fileId: "f1" }, { kind: "photo" as const, fileId: "f2" }, { kind: "photo" as const, fileId: "f3" }] };
    db.data.mediaAsset = { findMany: () => [{ id: "a1", mimeType: "image/jpeg" }] };
    const dry = await createBroadcast(
      { content: album, mediaAssetId: "a1", mediaAssetIds: ["a1", "a2", "a3"], channels: ["Zone Interdite"], scheduledAt: `${tomorrow}T20:00` },
      KEVIN,
      { dryRun: true },
    );
    expect(dry.ok).toBe(true);
    if (dry.ok) expect(dry.preview?.summary).toContain("Avec une photo (1 photo sur 3 gardée : un envoi ne joint qu'un média).");
    expect(db.writes).toEqual([]);
    let created: { data: { mediaAssetId: string | null } } | null = null;
    db.data.broadcast = { create: (a) => ((created = a as typeof created), { id: "b1" }) };
    const r = await createBroadcast({ content: album, mediaAssetId: "a1", mediaAssetIds: ["a1", "a2", "a3"], channels: ["Zone Interdite"], scheduledAt: `${tomorrow}T20:00` }, KEVIN);
    expect(r.ok).toBe(true);
    expect(created!.data.mediaAssetId).toBe("a1");
  });

  it("une seule photo : « Avec une photo. » ; média donné mais introuvable : refusé, rien d'écrit", async () => {
    const one = { ...forwarded, media: [{ kind: "photo" as const, fileId: "f1" }] };
    db.data.mediaAsset = { findMany: () => [{ id: "a1", mimeType: "image/jpeg" }] };
    const dry = await createBroadcast({ content: one, mediaAssetId: "a1", channels: ["Zone Interdite"], scheduledAt: `${tomorrow}T20:00` }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview?.summary).toMatch(/Avec une photo\.$/);
    db.data.mediaAsset = { findMany: () => [] };
    const missing = await createBroadcast({ content: one, mediaAssetId: "zz", channels: ["Zone Interdite"], scheduledAt: `${tomorrow}T20:00` }, KEVIN);
    expect(missing).toMatchObject({ ok: false, code: "not_found" });
    expect(db.writes).toEqual([]);
  });

  it("envoyer maintenant : aperçu exact et destinataires ; déjà parti refusé ; annuler à blanc sans écriture", async () => {
    db.data.broadcast = {
      findUniqueOrThrow: () => ({ id: "b1", name: "Bonus", status: "DRAFT", botId: "bot1", text: "Salut {prenom} !", segment: { channelIds: ["ch1"] }, buttons: [] }),
      findMany: () => [{ id: "b1", name: "Bonus du soir" }],
    };
    const dry = await sendNow({ broadcast: "bonus du soir" }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview).toMatchObject({ exactText: "Salut Léa !", recipients: 37 });
    expect(db.writes).toEqual([]);
    expect(queue.enqueue).not.toHaveBeenCalled();
    db.data.broadcast.findUniqueOrThrow = () => ({ id: "b1", name: "Bonus", status: "SENT", botId: "bot1", text: "x", segment: {} });
    expect(err(await sendNow({ broadcastId: "b1" }, KEVIN))).toBe("Cet envoi est déjà parti ou annulé : il ne peut plus être lancé.");
    expect(err(await cancelBroadcast({ broadcastId: "b1" }, KEVIN, { dryRun: true }))).toBe("Cet envoi est déjà terminé.");
  });

  it("supprimer : ADMIN seulement ; test à moi sans compte Telegram : même raison que le site", async () => {
    expect(err(await deleteDraft({ broadcastId: "b1" }, MANAGER))).toBe("Réservé aux administrateurs.");
    db.data.broadcast = {
      findUniqueOrThrow: () => ({ id: "b1", botId: "bot1", text: "x", buttons: [], bot: BOT }),
    };
    expect(err(await testToMe({ broadcastId: "b1" }, { ...KEVIN, telegramUserId: null }))).toBe(
      "Liez d'abord votre compte Telegram dans « Mon compte » (menu en haut à droite).",
    );
    const dry = await testToMe({ broadcastId: "b1" }, KEVIN, { dryRun: true });
    expect(dry.ok).toBe(true);
    expect(queue.enqueueDm).not.toHaveBeenCalled();
  });
});

describe("relances automatiques", () => {
  it("carte : même message que le site sans texte ; Kevin crée la bienvenue (désactivée) avec son texte", async () => {
    expect(err(await saveCard({ templateKey: "welcome", text: "" }, WEB))).toBe("Écrivez le message que le bot va envoyer.");
    const dry = await saveCard({ templateKey: "welcome", text: "Salut {prenom}, bienvenue !" }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview?.summary).toMatch(/créée, désactivée/);
    expect(db.writes).toEqual([]);
    const r = await saveCard({ templateKey: "welcome", text: "Salut {prenom}, bienvenue !" }, KEVIN);
    expect(r.ok).toBe(true);
    expect(db.writes).toContain("automationRule.create");
  });

  it("activer = envoi : aperçu exact du premier message, rien d'écrit ; supprimer : ADMIN seulement", async () => {
    db.data.automationRule = {
      findMany: () => [{ id: "r1", name: "Bienvenue", templateKey: "welcome" }],
      findUniqueOrThrow: () => ({
        id: "r1",
        name: "Bienvenue",
        isActive: false,
        oncePerMember: true,
        templateKey: "welcome",
        graph: null,
        actions: [{ type: "send_message", text: "Salut {prenom} !" }],
      }),
    };
    const dry = await toggleRule({ rule: "bienvenue", active: true }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview?.exactText).toBe("Salut {prenom} !");
    expect(db.writes).toEqual([]);
    expect(err(await deleteRule({ ruleId: "r1" }, MANAGER))).toBe("Réservé aux administrateurs.");
  });

  it("enregistrer : même message que le site (nom trop court) ; tester sur moi à blanc sans mise en file", async () => {
    expect(err(await saveRuleCore("editor")({ name: "x", trigger: "JOINED" }, KEVIN))).toBe(
      "Donnez un nom à la relance (2 caractères au moins).",
    );
    const dry = await testRuleOnMe({ ruleId: "r1" }, KEVIN, { dryRun: true });
    expect(dry.ok).toBe(true);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe("conversations et personas", () => {
  it("essai à blanc : refus identique à l'action réelle, aucune opération lancée", async () => {
    const r = await block({ id: "conv12345678" }, KEVIN, { dryRun: true });
    expect(err(r)).toMatch(/\/stop/);
    expect(ops.blockConversation).not.toHaveBeenCalled();
    const ok = await takeOver({ id: "conv12345678" }, KEVIN, { dryRun: true });
    expect(ok.ok).toBe(true);
    expect(ops.takeOverConversation).not.toHaveBeenCalled();
  });

  it("écrire : aperçu exact (texte échappé), une destinataire ; vrai : provenance transmise", async () => {
    const dry = await sendTeam({ id: "conv12345678", text: "Bonus <ok>" }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview).toMatchObject({ exactText: "Bonus &lt;ok&gt;", recipients: 1 });
    expect(ops.sendTeamMessage).not.toHaveBeenCalled();
    db.data.user = { findUnique: () => ({ name: "Matheo" }) };
    await takeOver({ id: "conv12345678" }, KEVIN);
    expect(ops.takeOverConversation).toHaveBeenCalledWith("conv12345678", { id: "u1", name: "Matheo", via: "TELEGRAM" });
  });

  it("« crée la persona Inès, 24 ans, Lyon, étudiante » : brouillon du formulaire, essai à blanc transmis", async () => {
    await savePersonaCore(
      { name: "Inès", age: 24, personality: "Étudiante à Lyon, drôle et curieuse." },
      KEVIN,
      { dryRun: true },
    );
    const [draft, user, opts] = personas.savePersona.mock.calls[0]!;
    expect(draft).toMatchObject({ name: "Inès", age: "24", personality: "Étudiante à Lyon, drôle et curieuse.", isActive: false });
    expect(user).toEqual({ id: "u1", role: "ADMIN", via: "TELEGRAM" });
    expect(opts).toEqual({ dryRun: true });
  }, 60_000);

  it("supprimer une persona : refus du responsable rendu tel quel (code forbidden)", async () => {
    db.data.persona = { findMany: () => [{ id: "p1", name: "Inès" }] };
    const r = await deletePersonaCore({ persona: "ines" }, MANAGER);
    expect(err(r)).toBe("Seul un administrateur peut supprimer une persona.");
    expect(!r.ok && r.code).toBe("forbidden");
  });

  it("photos envoyées à Kevin : ajoutées aux images de référence existantes", async () => {
    db.data.persona = { findMany: () => [{ id: "p1", name: "Inès" }] };
    await savePersonaMediaCore({ persona: "Inès", media: ["img2", "img3"] }, KEVIN);
    expect(personaMedia.savePersonaMedia).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ referenceImageIds: ["img1", "img2", "img3"] }),
      "u1",
      { via: "TELEGRAM" },
    );
  });
});

describe("registre du lot C", () => {
  it("chaque cœur a une clé unique et ne renvoie jamais l'adresse de retour du site à Kevin", async () => {
    const keys = LOT_C_IMPL.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    const impl = LOT_C_IMPL.find((i) => i.key === "membres.note_ajouter")!;
    const r = await impl.run({ memberId: "m1", text: "ok" }, KEVIN, {});
    expect(r).not.toHaveProperty("back");
  });
});
