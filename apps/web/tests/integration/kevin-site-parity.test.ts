/**
 * Phase 34 — « tout par Kevin » sur base réelle : faux Telegram, fausse IA de Kevin (`createFakeBossLlm` rend l'outil
 * `site_<domaine>` qu'aurait choisi la vraie IA), aucun réseau. Vraie route webhook de Kevin, vrai chemin rapide, vrai
 * interprète (`processBossText` comme le worker), vrai déroulé (`site/flow.ts`) et VRAIS cœurs du site exécutés en
 * processus (`inProcessSiteOps`, posé par la route du webhook) : mêmes validations, mêmes droits, même journal.
 *
 * 1. Les 12 exemples du prompt de la phase 34, de la phrase de l'admin à l'état en base.
 * 2. Au moins deux phrases par domaine du site.
 * 3. Égalité site ↔ Kevin : action serveur (session simulée) puis la même par Kevin sur une base remise à zéro →
 *    même état et même `AuditLog` (hors `via`, identifiants et horodatages).
 * 4. Sécurité : responsable du groupe → refus d'une action d'admin ; « oui » ne supprime pas, « SUPPRIMER » si ;
 *    secret dans le groupe → « en privé », rien d'enregistré ; requête signée trafiquée / rejouée / trop vieille → refus.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Update } from "grammy/types";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  createFakeBossLlm,
  fromParis,
  parisDay,
  voiceCheck,
  type AgentsDeps,
  type AgentsOrchestratorJob,
} from "@linkaffipro/agents";
import { getOrCreateBot, prismaTelegramDeps, realBossEngine } from "@linkaffipro/telegram";
import { POST } from "@/app/api/telegram/[botId]/route";
import { createTestBot, ctx, FakeTelegramWorld, resetDb, webhookRequest } from "./helpers";
import { prismaBossTurnFor, processBossText, type BossTextDeps } from "../../../worker/src/agents/boss-text";

/** Appels de l'API Telegram faits par un client direct (`new Api(token)` : messager admin…). */
const direct = vi.hoisted(() => ({ calls: [] as Array<{ token: string; method: string; payload: Record<string, unknown> }>, next: 7000 }));

vi.mock("grammy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("grammy")>();
  class FakeApi {
    constructor(readonly token: string) {
      // Toute méthode non prévue répond « true » (aucun réseau).
      return new Proxy(this, {
        get(target, prop, recv) {
          if (prop in target || typeof prop !== "string" || prop === "then" || prop === "toJSON") return Reflect.get(target, prop, recv);
          return async (...args: unknown[]) => {
            direct.calls.push({ token: target.token, method: prop, payload: { args } });
            return true;
          };
        },
      });
    }
    private rec(method: string, payload: Record<string, unknown> = {}) {
      direct.calls.push({ token: this.token, method, payload });
    }
    async getMe() {
      this.rec("getMe");
      const id = Number(this.token.split(":")[0]);
      return { id, is_bot: true, first_name: id === KEVIN_TG ? "Kevin" : `Bot ${id}`, username: id === KEVIN_TG ? "kevin_boss_bot" : `bot_${id}` };
    }
    async sendMessage(chat_id: number, text: string, other: Record<string, unknown> = {}) {
      this.rec("sendMessage", { chat_id, text, ...other });
      return { message_id: direct.next++, date: 0, chat: { id: chat_id, type: chat_id < 0 ? "supergroup" : "private" }, text };
    }
    async deleteMessage(chat_id: number, message_id: number) {
      this.rec("deleteMessage", { chat_id, message_id });
      return true;
    }
    async sendChatAction(chat_id: number, action: string) {
      this.rec("sendChatAction", { chat_id, action });
      return true;
    }
    async createChatInviteLink(chat_id: number, other: Record<string, unknown> = {}) {
      this.rec("createChatInviteLink", { chat_id, ...other });
      const id = Number(this.token.split(":")[0]);
      return { invite_link: `https://t.me/+direct${id}x${direct.next++}`, creator: { id, is_bot: true, first_name: `Bot ${id}` }, creates_join_request: other.creates_join_request === true, is_primary: false, is_revoked: false, name: other.name };
    }
    async revokeChatInviteLink(chat_id: number, invite_link: string) {
      this.rec("revokeChatInviteLink", { chat_id, invite_link });
      const id = Number(this.token.split(":")[0]);
      return { invite_link, creator: { id, is_bot: true, first_name: `Bot ${id}` }, creates_join_request: false, is_primary: false, is_revoked: true };
    }
  }
  return { ...orig, Api: FakeApi };
});

// Hors d'une requête Next : pas de cache de pages à invalider ; une redirection du site devient une erreur lisible.
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url, digest: "NEXT_REDIRECT" });
  },
}));
/** Session simulée des actions serveur du site (partie 3). */
const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name: string; role: "ADMIN" | "MANAGER"; telegramUserId: bigint | null } }));
vi.mock("@/lib/session", () => {
  class ForbiddenError extends Error {}
  const requireUser = async () => {
    if (!session.user) throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/login", digest: "NEXT_REDIRECT" });
    return session.user;
  };
  const requireAdmin = async () => {
    const u = await requireUser();
    if (u.role !== "ADMIN") throw new ForbiddenError("Action réservée aux administrateurs");
    return u;
  };
  return { ForbiddenError, requireUser, requireAdmin, requireAdminPage: requireAdmin };
});

const ADMIN = 78484;
const LEA_TG = 7101;
const KEVIN_TG = 5550;
const GROUP = -1007777000111;
const KEVIN_TOKEN = `${KEVIN_TG}:KEVIN-TOKEN-${"k".repeat(30)}`;
const SPORTAZA_LOGIN = "mathieu.sportaza@exemple.fr";
const SPORTAZA_PASSWORD = "Sp0rtaza!Secret#2026";

/** Appels des instances grammY des webhooks (Kevin). */
const hooked: Array<{ method: string; payload: Record<string, unknown> }> = [];
const enqueued: Array<{ job: AgentsOrchestratorJob; jobId?: string }> = [];
const ids = { kevin: "", kevinSecret: "", admin: "", zone: "", sportsBot: "", casinoBot: "", datingBot: "" };
const started = new Date();
const world = new FakeTelegramWorld();

// ------------------------------------------------------------------------------------------------ fausse IA de Kevin

const site = (domain: string, op: string, params: Record<string, unknown> = {}) => ({ name: `site_${domain}`, input: { op, params } });

/** Demain à 20 h, heure de Paris, au format du schéma (« AAAA-MM-JJTHH:mm »), comme la vraie IA le donne. */
function tomorrowLocal(hour: number): string {
  return `${parisDay(new Date(Date.now() + 24 * 3600_000))}T${String(hour).padStart(2, "0")}:00`;
}
/** Le même instant en UTC (ce qui doit être en base). */
function tomorrowAt(hour: number): string {
  return fromParis(parisDay(new Date(Date.now() + 24 * 3600_000)), hour * 60).toISOString();
}

/** Phrases des parties 3 et 4 (même fausse IA). */
const parityLlm: Array<[string | RegExp, unknown]> = [
  ["crée l'étiquette Parité en vert", site("reglages", "reglages.etiquette_creer", { name: "Parité", color: "green" })],
  ["note sur Membre4 : à rappeler lundi", site("membres", "membres.note_ajouter", { member: "Membre4", text: "À rappeler lundi" })],
  ["ajoute le thème casino Roulette Live", site("univers", "univers.theme_casino_ajouter", { label: "Roulette Live" })],
  ["envoie-moi le rapport à 7 h", site("reglages", "reglages.rapports", { hour: 7 })],
  ["supprime la campagne Parité", site("campagnes", "campagnes.supprimer", { campaign: "Parité" })],
  ["supprime la campagne Celsius FR", site("campagnes", "campagnes.supprimer", { campaign: "Celsius FR" })],
  [
    "écris aux membres de Zone Interdite demain 21 h : Ce soir 20 h en gras",
    () => site("envois", "envois.creer", { name: "Parité envoi", channels: ["Zone Interdite"], text: "<b>Ce soir</b> 20 h", intent: "schedule", scheduledAt: tomorrowLocal(21) }),
  ],
  ["crée l'étiquette Interdite", site("reglages", "reglages.etiquette_creer", { name: "Interdite" })],
];

const fakeLlm = createFakeBossLlm([
  // ---- les 12 exemples
  ["ajoute le canal t.me/zone_paris et mets-le en paris sportifs", site("canaux", "canaux.ajouter", { link: "t.me/zone_paris", vertical: "SPORTS" })],
  ["crée une campagne pour Celsius en France avec un CPA de 120", site("campagnes", "campagnes.creer", { name: "Celsius FR", country: "FR", cpa: 120 })],
  ["donne-moi un lien de suivi pour TikTok sur Zone Interdite", site("campagnes", "campagnes.lien_suivi", { channel: "Zone Interdite", platform: "TIKTOK" })],
  ["passe le casino en vrai", { name: "simulation", input: { equipe: "casino", mode: "vrai" } }],
  ["monte le budget vidéo à 80 € ce mois-ci", site("agents", "agents.budget_fournisseur", { poste: "video", equipe: "dating", euros: 80 })],
  ["crée la persona Inès, 24 ans, Lyon, étudiante", site("univers", "univers.persona_enregistrer", { name: "Inès", age: 24, personality: "Lyonnaise, étudiante", universe: "dating" })],
  ["voici les photos d'Inès", site("univers", "univers.persona_medias", { persona: "Inès" })],
  [
    "envoie ça à tous les membres de Zone Interdite demain 20 h",
    () => site("envois", "envois.creer", { channels: ["Zone Interdite"], intent: "schedule", scheduledAt: tomorrowLocal(20) }),
  ],
  ["active la catégorie corners avec des cotes entre 1,6 et 2,5", site("univers", "univers.categorie_paris_regler", { categorie: "Corners (Kevin)", active: true, minOdds: 1.6, maxOdds: 2.5 })],
  ["ajoute mon compte Sportaza", site("univers", "univers.bookmaker_identifiants", { bookmaker: "sportaza" })],
  ["ajoute Léa à l'équipe comme responsable", site("equipe", "equipe.inviter", { role: "MANAGER" })],
  ["son adresse c'est lea@exemple.fr", site("equipe", "equipe.inviter", { email: "lea@exemple.fr", role: "MANAGER" })],
  ["préviens-moi si les dépenses pub dépassent 200 € par jour", { name: "pas_prevu", input: {} }],
  ["envoie-moi le rapport à 8 h au lieu de 9 h", site("reglages", "reglages.rapports", { hour: 8 })],
  // ---- deux phrases (au moins) par domaine
  ["passe Zone Paris en anglais", site("canaux", "canaux.regler", { channel: "Zone Paris", language: "en" })],
  ["crée un lien de partage Influenceurs sur Zone Interdite", site("canaux", "canaux.lien_partage_creer", { channel: "Zone Interdite", name: "Influenceurs" })],
  ["programme ça sur Zone Interdite demain 9 h", () => site("messages", "messages.programmer", { channels: ["Zone Interdite"], scheduledAt: tomorrowLocal(9) })],
  ["annule ce message programmé", () => site("messages", "messages.annuler", { code: world2.postCode })],
  ["crée la catégorie de messages Bonus du soir", site("messages", "messages.categorie_creer", { name: "Bonus du soir" })],
  ["crée une page pour Zone Interdite avec le titre Rejoins la Zone", site("pages", "pages.creer", { channel: "Zone Interdite", name: "Zone TikTok", headline: "Rejoins la Zone", buttonText: "J'entre" })],
  ["sur la page Zone TikTok mets le bouton « Je rejoins »", site("pages", "pages.modifier", { page: "Zone TikTok", buttonText: "Je rejoins" })],
  ["fais-moi un lien suivi vers https://exemple.fr/promo appelé Promo bio", site("campagnes", "campagnes.lien_generique", { label: "Promo bio", url: "https://exemple.fr/promo" })],
  ["ajoute 150 € de dépense hier sur Celsius FR", () => site("campagnes", "campagnes.depense_ajouter", { campaign: "Celsius FR", date: parisDay(new Date(Date.now() - 24 * 3600_000)), spend: 150 })],
  ["note sur Membre1 : très actif le soir", site("membres", "membres.note_ajouter", { member: "Membre1", text: "Très actif le soir" })],
  ["mets l'étiquette VIP à Membre2", site("membres", "membres.etiquettes", { member: "Membre2", add: ["VIP"] })],
  ["annule l'envoi de demain", () => site("envois", "envois.annuler", { broadcast: world2.broadcastName })],
  ["règle la relance de bienvenue : Bienvenue {prenom}, ravi de te voir !", site("automatisations", "automatisations.carte", { templateKey: "welcome", text: "Bienvenue {prenom}, ravi de te voir !" })],
  ["active la relance de bienvenue", site("automatisations", "automatisations.activer", { templateKey: "welcome", active: true })],
  ["je prends la main sur la conversation de Membre3", site("conversations", "conversations.prendre_la_main", { member: "Membre3" })],
  ["la conversation de Membre3 est traitée", site("conversations", "conversations.marquer_traitee", { member: "Membre3" })],
  ["interdis le mot garanti à l'équipe casino", site("agents", "agents.equipe_reglages", { team: "casino", addForbiddenWords: ["garanti"] })],
  ["ajoute le thème casino Blackjack VIP", site("univers", "univers.theme_casino_ajouter", { label: "Blackjack VIP" })],
  ["crée l'étiquette VIP en orange", site("reglages", "reglages.etiquette_creer", { name: "VIP", color: "orange" })],
  ["un membre est VIP à partir de 500 € déposés", site("reglages", "reglages.niveaux_depense", { vip: 500 })],
  ["relis Link Affi maintenant", site("connecteurs", "connecteurs.linkaffi_synchroniser", {})],
  ["l'adresse des événements Link Affi c'est https://linkaffi.exemple.fr/functions/v1/telegram-events", site("connecteurs", "connecteurs.affilies_adresse", { eventsUrl: "https://linkaffi.exemple.fr/functions/v1/telegram-events" })],
  ["qui est dans l'équipe du site ?", site("equipe", "equipe.lister", {})],
  ["recalcule les statistiques", site("statistiques", "statistiques.recalculer", {})],
  ["combien j'ai dépensé ce mois ?", { name: "repondre_question", input: { sujet: "depenses", question: "Combien ai-je dépensé ce mois ?" } }],
  ...(parityLlm as Array<[string, never]>),
]);

/** Valeurs connues seulement en cours de scénario (la vraie IA les lirait dans la conversation). */
const world2 = { postCode: "", broadcastName: "" };

function agents(): AgentsDeps {
  return prismaTelegramDeps.agentsDeps!();
}

function bossTextDeps(): BossTextDeps {
  return {
    agents: agents(),
    engine: realBossEngine,
    loadLlm: async () => fakeLlm,
    async botApi() {
      const rec = await prisma.bot.findUniqueOrThrow({ where: { id: ids.kevin } });
      const api = getOrCreateBot(rec, prismaTelegramDeps).api;
      return { sendMessage: (c, t, o) => api.sendMessage(c, t, o), deleteMessage: (c, m) => api.deleteMessage(c, m) };
    },
    adminTelegramId: async () => BigInt(ADMIN),
    bossTurnFor: prismaBossTurnFor,
  };
}

// ------------------------------------------------------------------------------------------------ messages Telegram

let uid = 1;
let mid = 100;
const names: Record<number, { first_name: string; username?: string }> = {
  [ADMIN]: { first_name: "Mathéo", username: "matheo" },
  [LEA_TG]: { first_name: "Léa", username: "lea" },
};
const user = (id: number) => ({ id, is_bot: false, ...(names[id] ?? { first_name: `Personne ${id}` }) });

function privateMsg(from: number, extra: Record<string, unknown>): Update {
  mid += 1;
  return { update_id: uid++, message: { message_id: mid, date: Math.floor(Date.now() / 1000), chat: { id: from, type: "private", first_name: "x" }, from: user(from), ...extra } } as Update;
}
function groupMsg(from: number, text: string, extra: Record<string, unknown> = {}): Update {
  mid += 1;
  return { update_id: uid++, message: { message_id: mid, date: Math.floor(Date.now() / 1000), chat: { id: GROUP, type: "supergroup", title: "Équipe" }, from: user(from), text, ...extra } } as Update;
}
function callback(from: number, data: string, chatId = from): Update {
  return {
    update_id: uid++,
    callback_query: { id: `cb${uid}`, chat_instance: "x", from: user(from), message: { message_id: 3001, date: 0, chat: { id: chatId, type: chatId < 0 ? "supergroup" : "private", first_name: "x" }, text: "?" }, data },
  } as Update;
}

async function toKevin(u: Update): Promise<Update> {
  const res = await POST(webhookRequest(u, ids.kevinSecret), ctx({ botId: ids.kevin }));
  expect(res.status).toBe(200);
  return u;
}

type Sent = { chat: number; text: string; buttons: Array<{ text: string; callback_data: string }> };
const mark = () => ({ h: hooked.length, d: direct.calls.length });
function sentSince(m: { h: number; d: number }): Sent[] {
  const of = (p: Record<string, unknown>): Sent => ({
    chat: Number(p.chat_id),
    text: String(p.text),
    buttons: ((p.reply_markup as { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } | undefined)?.inline_keyboard ?? []).flat(),
  });
  return [
    ...hooked.slice(m.h).filter((c) => c.method === "sendMessage").map((c) => of(c.payload)),
    ...direct.calls.slice(m.d).filter((c) => c.token === KEVIN_TOKEN && c.method === "sendMessage").map((c) => of(c.payload)),
  ];
}
const deletedSince = (m: { h: number; d: number }) => [
  ...hooked.slice(m.h).filter((c) => c.method === "deleteMessage").map((c) => Number(c.payload.message_id)),
  ...direct.calls.slice(m.d).filter((c) => c.method === "deleteMessage").map((c) => Number(c.payload.message_id)),
];

/** Webhook → tâches boss-text traitées comme par le worker → ce que Kevin a répondu. */
async function deliver(u: Update): Promise<{ sent: Sent[]; text: string; update: Update }> {
  const m = mark();
  const before = enqueued.length;
  await toKevin(u);
  for (const e of enqueued.slice(before)) if (e.job.type === "boss-text") await processBossText(e.job as Extract<AgentsOrchestratorJob, { type: "boss-text" }>, bossTextDeps());
  const sent = sentSince(m);
  return { sent, text: sent.map((s) => s.text).join("\n"), update: u };
}
/** L'admin écrit à Kevin en privé. */
const say = (text: string, extra: Record<string, unknown> = {}) => deliver(privateMsg(ADMIN, { text, ...extra }));
/** Bouton OUI de la dernière confirmation montrée. */
async function pressYes(sent: Sent[], from = ADMIN): Promise<{ sent: Sent[]; text: string }> {
  const yes = sent.flatMap((s) => s.buttons).find((b) => /:yes$/.test(b.callback_data));
  expect(yes, `bouton OUI attendu dans : ${sent.map((s) => s.text).join(" | ")}`).toBeTruthy();
  return deliver(callback(from, yes!.callback_data));
}

/** Demande, puis OUI si Kevin le demande (règle de la phase 33) ; rend la confirmation et le résultat. */
async function sayAndConfirm(text: string): Promise<{ ask: { sent: Sent[]; text: string }; done: { sent: Sent[]; text: string } }> {
  const ask = await say(text);
  const hasYes = ask.sent.some((s) => s.buttons.some((b) => /:yes$/.test(b.callback_data)));
  return { ask, done: hasYes ? await pressYes(ask.sent) : ask };
}

function expectVoice(text: string) {
  for (const line of text.split("\n").filter((l) => l.trim())) expect(voiceCheck(line).ok, `voix de Kevin : ${line}`).toBe(true);
}

/** Journal depuis un instant (actions données). */
const auditsSince = (since: Date, action?: string) =>
  prisma.auditLog.findMany({ where: { createdAt: { gte: since }, ...(action ? { action } : {}) }, orderBy: { createdAt: "asc" } });

// ------------------------------------------------------------------------------------------------ monde

async function cleanup() {
  await prisma.broadcast.deleteMany();
  await prisma.automationRun.deleteMany();
  await prisma.automationRule.deleteMany();
  await prisma.landingPage.deleteMany();
  await prisma.adCost.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.messageCategory.deleteMany({ where: { name: "Bonus du soir" } });
  await prisma.invitation.deleteMany({ where: { email: { contains: "@exemple.fr" } } });
  await resetDb();
  await prisma.bossTurn.deleteMany();
  await prisma.bossUnmet.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.agentTeamConfig.deleteMany();
  await prisma.agentUsage.deleteMany();
  await prisma.mediaAsset.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.betCategory.deleteMany({ where: { key: { startsWith: "kp-" } } });
  await prisma.setting.deleteMany({
    where: { OR: [{ key: { startsWith: "boss." } }, { key: { startsWith: "agents." } }, { key: "reports.config" }, { key: "members.tags" }] },
  });
  await prisma.memberNote.deleteMany({ where: { text: { in: ["À rappeler lundi", "Très actif le soir"] } } });
  await prisma.user.deleteMany({ where: { email: { in: ["kevin-parity@linkaffipro.internal", "lea@exemple.fr"] } } });
}

/** Grammy des bots de canal branché sur le monde simulé, plus les liens d'invitation. */
function installWorld(bot: { id: string; telegramBotId: bigint; username: string; name: string }) {
  const api = getOrCreateBot(bot as never, prismaTelegramDeps).api;
  world.install(api, bot);
  let n = 1;
  api.config.use(async (prev, method, payload, signal) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (method === "createChatInviteLink")
      return {
        ok: true,
        result: { invite_link: `https://t.me/+fake${bot.telegramBotId}x${n++}`, creator: { id: Number(bot.telegramBotId), is_bot: true, first_name: bot.name }, creates_join_request: p.creates_join_request === true, is_primary: false, is_revoked: false, name: p.name },
      } as never;
    if (method === "revokeChatInviteLink") return { ok: true, result: { invite_link: String(p.invite_link), creator: { id: Number(bot.telegramBotId), is_bot: true, first_name: bot.name }, creates_join_request: false, is_primary: false, is_revoked: true } } as never;
    return prev(method, payload, signal);
  });
}

let linkaffiKey: Awaited<ReturnType<typeof prisma.integrationKey.findUnique>> = null;

beforeAll(async () => {
  linkaffiKey = await prisma.integrationKey.findUnique({ where: { provider: "linkaffi" } });
  await cleanup();
  await prisma.setting.upsert({ where: { key: "admin.telegramUserId" }, create: { key: "admin.telegramUserId", value: String(ADMIN) }, update: { value: String(ADMIN) } });
  ids.admin = (
    await prisma.user.create({ data: { email: "kevin-parity@linkaffipro.internal", name: "Mathéo", passwordHash: "x", role: "ADMIN", telegramUserId: BigInt(ADMIN) } })
  ).id;
  const kevin = await prisma.bot.create({
    data: { name: "Kevin", username: "kevin_boss_bot", telegramBotId: BigInt(KEVIN_TG), tokenEncrypted: encrypt(KEVIN_TOKEN), vertical: "CASINO", webhookSecret: "secret-kevin", role: "ADMIN" },
  });
  ids.kevin = kevin.id;
  ids.kevinSecret = kevin.webhookSecret;
  let n = 3000;
  getOrCreateBot(kevin, prismaTelegramDeps).api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    hooked.push({ method, payload: p });
    if (/^send(Message|Photo|Video|Document)$/.test(method))
      return { ok: true, result: { message_id: n++, date: 0, chat: { id: Number(p.chat_id), type: Number(p.chat_id) < 0 ? "supergroup" : "private" }, text: p.text ?? "" } } as never;
    return { ok: true, result: true } as never;
  });
  // Bots de canal (un par univers) dans le monde simulé.
  const sports = await createTestBot(111, "SPORTS", "secret-sports");
  const casino = await createTestBot(333, "CASINO", "secret-casino");
  const dating = await createTestBot(444, "DATING", "secret-dating");
  ids.sportsBot = sports.id;
  ids.casinoBot = casino.id;
  ids.datingBot = dating.id;
  for (const b of [sports, casino, dating]) installWorld(b);
  // Canal « Zone Interdite » (paris sportifs) : 3 membres joignables par le bot, 1 qui a bloqué le bot.
  world.addChat({ id: -1001110000001, title: "Zone Interdite", username: "zone_interdite", admins: [111] });
  world.addChat({ id: -1001110000002, title: "Zone Paris", username: "zone_paris", admins: [111, 333] });
  const zone = await prisma.channel.create({
    data: { telegramChatId: -1001110000001n, title: "Zone Interdite", username: "zone_interdite", type: "CHANNEL", language: "fr", vertical: "SPORTS", primaryBotId: sports.id },
  });
  ids.zone = zone.id;
  await prisma.channelBotAdmin.create({ data: { channelId: zone.id, botId: sports.id, rights: { status: "administrator", can_invite_users: true, can_post_messages: true } } });
  for (let i = 1; i <= 4; i++) {
    const m = await prisma.member.create({ data: { telegramUserId: BigInt(900000 + i), firstName: `Membre${i}`, languageCode: "fr" } });
    await prisma.membership.create({ data: { memberId: m.id, channelId: zone.id, status: "APPROVED", code: `zi${i}` } });
    await prisma.memberBotState.create({ data: { memberId: m.id, botId: sports.id, canDm: i <= 3, startedAt: new Date(), ...(i === 4 ? { blockedAt: new Date() } : {}) } });
  }
  await prisma.betCategory.create({ data: { key: "kp-corners", name: "Corners (Kevin)", marketTypes: ["corners-all-game-ou-over"], leagues: ["EPL"], bookmakers: ["sportaza"], active: false } });
  prismaTelegramDeps.workerDown = async () => false;
  agents().enqueue = { orchestrator: async (job, opts) => void enqueued.push({ job, jobId: opts?.jobId }), step: async () => undefined };
  // Médias d'un message transféré : rangés dans la médiathèque comme le ferait le bot (sans téléchargement réseau).
  agents().ingestForwardedMedia = async (content) => {
    const assetIds: string[] = [];
    for (const m of content.media) {
      const a = await prisma.mediaAsset.create({
        data: { filename: `${m.fileId}.jpg`, mimeType: m.kind === "video" ? "video/mp4" : "image/jpeg", size: 3, sha256: `sha-${m.fileId}-${Date.now()}`, bytes: Buffer.from([1, 2, 3]), origin: "HUMAN" },
      });
      assetIds.push(a.id);
    }
    return { assetIds };
  };
});

afterAll(async () => {
  await cleanup();
  // Clé d'intégration Link Affi remise comme avant (partagée avec les autres tests).
  if (linkaffiKey) await prisma.integrationKey.update({ where: { provider: "linkaffi" }, data: { eventsUrl: linkaffiKey.eventsUrl } });
  else await prisma.integrationKey.deleteMany({ where: { provider: "linkaffi" } });
});

// ================================================================================================ 1. les 12 exemples

describe("phase 34 : les 12 exemples du prompt, de bout en bout", () => {
  it("1. « ajoute le canal t.me/zone_paris et mets-le en paris sportifs » : canal créé, univers Paris sportifs", async () => {
    const since = new Date();
    const { ask, done: r } = await sayAndConfirm("ajoute le canal t.me/zone_paris et mets-le en paris sportifs");
    expect(ask.text).toMatch(/@zone_paris/);
    const ch = await prisma.channel.findFirst({ where: { username: "zone_paris" } });
    expect(ch, r.text).not.toBeNull();
    expect(ch!.vertical).toBe("SPORTS");
    expect(r.text).toMatch(/Zone Paris/);
    expectVoice(r.text);
    const audits = await auditsSince(since);
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) expect((a.metadata as { via?: string } | null)?.via, a.action).toBe("TELEGRAM");
  });

  it("2. « crée une campagne pour Celsius en France avec un CPA de 120 » : campagne en base, pays et CPA notés", async () => {
    const { done: r } = await sayAndConfirm("crée une campagne pour Celsius en France avec un CPA de 120");
    const c = await prisma.campaign.findFirst({ where: { name: { contains: "Celsius" } } });
    expect(c, r.text).not.toBeNull();
    expect(c!.notes ?? "").toMatch(/FR|France/);
    expect(c!.notes ?? "").toMatch(/120/);
    expectVoice(r.text);
  });

  it("3. « donne-moi un lien de suivi pour TikTok sur Zone Interdite » : lien goolink + invitation avec demande d'adhésion", async () => {
    const { done: r } = await sayAndConfirm("donne-moi un lien de suivi pour TikTok sur Zone Interdite");
    const link = await prisma.inviteLink.findFirst({ where: { channelId: ids.zone }, orderBy: { createdAt: "desc" } });
    expect(link, r.text).not.toBeNull();
    expect(link!.createsJoinRequest).toBe(true);
    expect(r.text).toMatch(/go\.goolink\.eu|t\.me\/\+/);
  });

  it("4. « passe le casino en vrai » + OUI : l'équipe Casino passe en vrai", async () => {
    const ask = await say("passe le casino en vrai");
    expect(ask.text).toMatch(/vrai/);
    expect((await prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" } }))?.simulation ?? true).toBe(true);
    await pressYes(ask.sent);
    expect((await prisma.agentTeamConfig.findUniqueOrThrow({ where: { teamKey: "casino" } })).simulation).toBe(false);
    await prisma.agentTeamConfig.update({ where: { teamKey: "casino" }, data: { simulation: true } });
  });

  it("5. « monte le budget vidéo à 80 € ce mois-ci » + OUI : plafond vidéo Rencontres à 80 €", async () => {
    const ask = await say("monte le budget vidéo à 80 € ce mois-ci");
    expect(ask.text).toMatch(/80/);
    const before = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "dating" } });
    expect((before?.monthlyBudgetCents as Record<string, number> | undefined)?.video ?? null).not.toBe(8000);
    const done = await pressYes(ask.sent);
    expectVoice(done.text);
    const cfg = await prisma.agentTeamConfig.findUniqueOrThrow({ where: { teamKey: "dating" } });
    expect((cfg.monthlyBudgetCents as Record<string, number>).video).toBe(8000);
  });

  it("6. « crée la persona Inès, 24 ans, Lyon, étudiante » puis les photos transférées : persona et images de référence", async () => {
    const { done } = await sayAndConfirm("crée la persona Inès, 24 ans, Lyon, étudiante");
    const ines = await prisma.persona.findFirst({ where: { name: "Inès" } });
    expect(ines, done.text).not.toBeNull();
    expect(ines!.age).toBe(24);
    expect(ines!.personality).toMatch(/Lyon/);
    // Deux photos transférées (album), puis la phrase : rangées dans la médiathèque et posées sur la persona.
    const photo = (n: number) => ({ forward_origin: { type: "user", sender_user: { id: 4040, is_bot: false, first_name: "Inès" }, date: 0 }, media_group_id: "album-ines", photo: [{ file_id: `ines-photo-${n}-small`, file_unique_id: `u${n}s`, width: 90, height: 90 }, { file_id: `ines-photo-${n}`, file_unique_id: `u${n}`, width: 1080, height: 1350 }] });
    await deliver(privateMsg(ADMIN, photo(1)));
    await deliver(privateMsg(ADMIN, photo(2)));
    const r = await sayAndConfirm("voici les photos d'Inès");
    const after = await prisma.persona.findUniqueOrThrow({ where: { id: ines!.id } });
    const refs = String(after.referenceImageIds ?? "").split(",").filter(Boolean);
    expect(refs, r.done.text).toHaveLength(2);
    const assets = await prisma.mediaAsset.findMany({ where: { id: { in: refs } } });
    expect(assets.map((a) => a.filename).sort()).toEqual(["ines-photo-1.jpg", "ines-photo-2.jpg"]);
  });

  it("7. message transféré (gras, lien, emoji animé) + « envoie ça à tous les membres de Zone Interdite demain 20 h » : aperçu EXACT, 3 destinataires, OUI → envoi programmé, rien de parti", async () => {
    const text = "Ce soir on joue la finale ! Tous les détails ici 🔥";
    const entities = [
      { type: "bold", offset: 0, length: 7 },
      { type: "text_link", offset: 28, length: 20, url: "https://exemple.fr/finale" },
      { type: "custom_emoji", offset: 49, length: 2, custom_emoji_id: "5368324170671202286" },
    ];
    const { telegramEntitiesToHtml } = await import("../../../../packages/agents/src/admin/entities-html");
    const html = telegramEntitiesToHtml(text, entities as never);
    expect(html).toContain("<b>Ce soir</b>");
    expect(html).toContain('<a href="https://exemple.fr/finale">');
    expect(html).toContain('<tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji>');
    await deliver(privateMsg(ADMIN, { text, entities, forward_origin: { type: "user", sender_user: { id: 4041, is_bot: false, first_name: "Source" }, date: 0 } }));
    const memberChats = new Set(["900001", "900002", "900003", "900004"]);
    const m0 = mark();
    const ask = await say("envoie ça à tous les membres de Zone Interdite demain 20 h");
    // Aperçu exact (HTML gardé tel quel, jamais réécrit) et nombre de destinataires (le membre qui a bloqué le bot exclu).
    expect(ask.text).toContain(html);
    expect(ask.text).toMatch(/\b3 personnes\b/);
    expect(await prisma.broadcast.count()).toBe(0);
    const done = await pressYes(ask.sent);
    expectVoice(done.text);
    const b = await prisma.broadcast.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(b.text).toBe(html);
    expect(b.status).toBe("SCHEDULED");
    expect(b.scheduledAt!.toISOString()).toBe(tomorrowAt(20));
    expect(b.botId).toBe(ids.sportsBot);
    // Aucun message n'est parti vers un membre (l'envoi part à l'heure, par le worker).
    expect(await prisma.outboundMessage.count({ where: { broadcastId: b.id } })).toBe(0);
    const touched = [...hooked.slice(m0.h), ...direct.calls.slice(m0.d)].filter((c) => memberChats.has(String(c.payload.chat_id)));
    expect(touched).toEqual([]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: b.id } });
    expect((audit.metadata as { via?: string }).via).toBe("TELEGRAM");
  });

  it("8. « active la catégorie corners avec des cotes entre 1,6 et 2,5 » + OUI : catégorie active, bornes posées", async () => {
    const { ask, done } = await sayAndConfirm("active la catégorie corners avec des cotes entre 1,6 et 2,5");
    expect(ask.text).toMatch(/[Cc]orners/);
    const c = await prisma.betCategory.findUniqueOrThrow({ where: { key: "kp-corners" } });
    expect(c, done.text).toMatchObject({ active: true, minOdds: 1.6, maxOdds: 2.5 });
  });

  it("9. « ajoute mon compte Sportaza » en privé : identifiant et mot de passe demandés à part, chiffrés, messages effacés, rien en clair nulle part", async () => {
    const since = new Date();
    const ask = await say("ajoute mon compte Sportaza");
    expect(ask.text).not.toContain(SPORTAZA_LOGIN);
    const first = await prisma.humanRequest.findFirstOrThrow({ where: { kind: "SECRET", status: "PENDING" } });
    const m1 = mark();
    const a1 = await say(SPORTAZA_LOGIN, { reply_to_message: { message_id: first.telegramMessageId, date: 0, chat: { id: ADMIN, type: "private" }, text: "?" } });
    expect(deletedSince(m1)).toContain(a1.update.message!.message_id);
    const second = await prisma.humanRequest.findFirstOrThrow({ where: { kind: "SECRET", status: "PENDING" } });
    expect(second.id).not.toBe(first.id);
    const m2 = mark();
    const a2 = await say(SPORTAZA_PASSWORD, { reply_to_message: { message_id: second.telegramMessageId, date: 0, chat: { id: ADMIN, type: "private" }, text: "?" } });
    expect(deletedSince(m2)).toContain(a2.update.message!.message_id);
    const login = await prisma.setting.findUnique({ where: { key: "agents.secret.providers.bookmakers.sportaza.login" } });
    const password = await prisma.setting.findUnique({ where: { key: "agents.secret.providers.bookmakers.sportaza.password" } });
    expect(login, a2.text).not.toBeNull();
    expect(password).not.toBeNull();
    expect(JSON.stringify(login!.value)).not.toContain(SPORTAZA_LOGIN);
    expect(JSON.stringify(password!.value)).not.toContain(SPORTAZA_PASSWORD);
    const { decrypt } = await import("@linkaffipro/core");
    expect(decrypt((login!.value as { enc: string }).enc)).toBe(SPORTAZA_LOGIN);
    expect(decrypt((password!.value as { enc: string }).enc)).toBe(SPORTAZA_PASSWORD);
    // Rien en clair : ni journal d'événements, ni journal des actions, ni mémoire de Kevin, ni réponses, ni réglages.
    const everything = JSON.stringify([
      await prisma.event.findMany({ where: { createdAt: { gte: since } } }),
      await prisma.auditLog.findMany({ where: { createdAt: { gte: since } } }),
      await prisma.bossTurn.findMany({ where: { createdAt: { gte: since } } }),
      await prisma.humanRequest.findMany({ where: { createdAt: { gte: since } } }),
      await prisma.setting.findMany({ where: { updatedAt: { gte: since } } }),
      sentSince({ h: 0, d: 0 }),
    ], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(everything).not.toContain(SPORTAZA_LOGIN);
    expect(everything).not.toContain(SPORTAZA_PASSWORD);
    // Les secrets du déroulé (rangement temporaire) sont effacés après usage.
    expect(await prisma.setting.count({ where: { key: { startsWith: "agents.secret.site." } } })).toBe(0);
  });

  it("10. « ajoute Léa à l'équipe comme responsable » : l'adresse est demandée, puis invitation responsable + lien en privé", async () => {
    const ask = await say("ajoute Léa à l'équipe comme responsable");
    expectVoice(ask.text);
    expect(await prisma.invitation.count({ where: { email: "lea@exemple.fr" } })).toBe(0);
    const { done } = await sayAndConfirm("son adresse c'est lea@exemple.fr");
    const inv = await prisma.invitation.findFirstOrThrow({ where: { email: "lea@exemple.fr" } });
    expect(inv.role).toBe("MANAGER");
    expect(done.text).toMatch(/https?:\/\/\S+/);
    expect(done.sent.every((s) => s.chat === ADMIN)).toBe(true);
  });

  it("11. « préviens-moi si les dépenses pub dépassent 200 € par jour » : Kevin dit honnêtement que ça n'existe pas, rien n'est changé", async () => {
    const before = await prisma.setting.findMany({ where: { key: { startsWith: "alerts." } } });
    const r = await say("préviens-moi si les dépenses pub dépassent 200 € par jour");
    expectVoice(r.text);
    expect(r.text).not.toMatch(/C'est fait|Fait ✅|réglé/);
    expect(await prisma.bossUnmet.count()).toBeGreaterThan(0);
    expect(await prisma.setting.findMany({ where: { key: { startsWith: "alerts." } } })).toEqual(before);
  });

  it("12. « envoie-moi le rapport à 8 h au lieu de 9 h » : rapports à 8 h, le reste inchangé", async () => {
    await prisma.setting.upsert({ where: { key: "reports.config" }, create: { key: "reports.config", value: { daily: true, weekly: false, hour: 9 } }, update: { value: { daily: true, weekly: false, hour: 9 } } });
    const { done } = await sayAndConfirm("envoie-moi le rapport à 8 h au lieu de 9 h");
    expectVoice(done.text);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "reports.config" } })).value).toEqual({ daily: true, weekly: false, hour: 8 });
  });
});

// ================================================================================================ 2. par domaine

describe("phase 34 : au moins deux phrases par domaine du site", () => {
  /** Chaque action écrite par Kevin porte `via: TELEGRAM` dans le journal. */
  async function expectTelegramAudit(since: Date) {
    const audits = await auditsSince(since);
    const via = audits.map((a) => (a.metadata as { via?: string } | null)?.via ?? null);
    // L'action elle-même porte `via: TELEGRAM` ; les lignes automatiques qui la suivent (lien créé par le moteur…)
    // sont les mêmes que depuis le site : jamais `WEB`.
    expect(via, audits.map((a) => a.action).join(", ")).toContain("TELEGRAM");
    expect(via).not.toContain("WEB");
  }

  it("canaux : langue d'un canal, lien de partage", async () => {
    let since = new Date();
    const a = await sayAndConfirm("passe Zone Paris en anglais");
    expect((await prisma.channel.findFirstOrThrow({ where: { username: "zone_paris" } })).language, a.done.text).toBe("en");
    await expectTelegramAudit(since);
    since = new Date();
    const b = await sayAndConfirm("crée un lien de partage Influenceurs sur Zone Interdite");
    const share = await prisma.inviteLink.findFirst({ where: { channelId: ids.zone, kind: "SHARE" } });
    expect(share, b.done.text).not.toBeNull();
    expect(share!.name).toContain("Influenceurs");
    expect(b.done.text).toContain("t.me/+");
    await expectTelegramAudit(since);
  });

  it("messages : message transféré à emoji animé gardé fidèlement (brouillon honnête sans compte), message programmé puis annulé ; catégorie", async () => {
    // Emoji animé : publié par le compte Telegram connecté ; sans compte, Kevin garde le brouillon et dit pourquoi.
    const text = "Pronostic du jour 🔥";
    const entities = [{ type: "custom_emoji", offset: 18, length: 2, custom_emoji_id: "5368324170671202299" }];
    await deliver(privateMsg(ADMIN, { text, entities, forward_origin: { type: "user", sender_user: { id: 4042, is_bot: false, first_name: "Source" }, date: 0 } }));
    const a = await sayAndConfirm("programme ça sur Zone Interdite demain 9 h");
    const draft = await prisma.post.findFirst({ where: { channelId: ids.zone }, orderBy: { createdAt: "desc" } });
    expect(draft, a.done.text).not.toBeNull();
    expect(draft!.text).toBe('Pronostic du jour <tg-emoji emoji-id="5368324170671202299">🔥</tg-emoji>');
    expect(draft!.status).toBe("DRAFT");
    expect(a.done.text).toMatch(/compte Telegram/);
    // Même phrase, message sans emoji animé : programmé par le bot.
    await deliver(privateMsg(ADMIN, { text: "Cote boostée ce soir", entities: [{ type: "bold", offset: 0, length: 12 }], forward_origin: { type: "user", sender_user: { id: 4042, is_bot: false, first_name: "Source" }, date: 0 } }));
    const since = new Date();
    const b = await sayAndConfirm("programme ça sur Zone Interdite demain 9 h");
    const post = await prisma.post.findFirst({ where: { channelId: ids.zone, status: "SCHEDULED" }, orderBy: { createdAt: "desc" } });
    expect(post, b.done.text).not.toBeNull();
    expect(post!.text).toBe("<b>Cote boostée</b> ce soir");
    expect(post!.scheduledAt!.toISOString()).toBe(tomorrowAt(9));
    await expectTelegramAudit(since);
    world2.postCode = post!.code;
    const c = await sayAndConfirm("annule ce message programmé");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post!.id } })).status, c.done.text).not.toBe("SCHEDULED");
    const d = await sayAndConfirm("crée la catégorie de messages Bonus du soir");
    expect(await prisma.messageCategory.count({ where: { name: "Bonus du soir" } }), d.done.text).toBe(1);
  });

  it("pages : page d'atterrissage créée puis modifiée", async () => {
    const since = new Date();
    const a = await sayAndConfirm("crée une page pour Zone Interdite avec le titre Rejoins la Zone");
    const page = await prisma.landingPage.findFirst({ where: { channelId: ids.zone } });
    expect(page, a.done.text).not.toBeNull();
    expect(page!.headline).toBe("Rejoins la Zone");
    await expectTelegramAudit(since);
    const b = await sayAndConfirm("sur la page Zone TikTok mets le bouton « Je rejoins »");
    expect((await prisma.landingPage.findUniqueOrThrow({ where: { id: page!.id } })).buttonText, b.done.text).toBe("Je rejoins");
  });

  it("campagnes : lien générique, dépense saisie à la main", async () => {
    const a = await sayAndConfirm("fais-moi un lien suivi vers https://exemple.fr/promo appelé Promo bio");
    const link = await prisma.trackingLink.findFirst({ where: { label: "Promo bio" } });
    expect(link, a.done.text).not.toBeNull();
    expect(link!.destinationTemplate).toContain("https://exemple.fr/promo");
    const b = await sayAndConfirm("ajoute 150 € de dépense hier sur Celsius FR");
    expect(b.ask.text).toMatch(/150/);
    const cost = await prisma.adCost.findFirst({ where: { campaign: { name: { contains: "Celsius" } } } });
    expect(cost, b.done.text).not.toBeNull();
    expect(Number(cost!.spend)).toBe(150);
  });

  it("membres : note sur une fiche, étiquette posée", async () => {
    const a = await sayAndConfirm("note sur Membre1 : très actif le soir");
    expect(await prisma.memberNote.count({ where: { member: { firstName: "Membre1" }, text: "Très actif le soir" } }), a.done.text).toBe(1);
    // L'étiquette doit exister dans Réglages → Étiquettes (créée plus bas par le domaine réglages) : on la crée ici.
    await sayAndConfirm("crée l'étiquette VIP en orange");
    const b = await sayAndConfirm("mets l'étiquette VIP à Membre2");
    expect((await prisma.member.findFirstOrThrow({ where: { firstName: "Membre2" } })).tags, b.done.text).toContain("VIP");
  });

  it("envois : envoi programmé annulé (rien ne part)", async () => {
    const b = await prisma.broadcast.findFirstOrThrow({ where: { status: "SCHEDULED" }, orderBy: { createdAt: "desc" } });
    world2.broadcastName = b.name;
    const r = await sayAndConfirm("annule l'envoi de demain");
    expect((await prisma.broadcast.findUniqueOrThrow({ where: { id: b.id } })).status, r.done.text).toBe("CANCELLED");
    expect(await prisma.outboundMessage.count({ where: { broadcastId: b.id } })).toBe(0);
  });

  it("automatisations : relance de bienvenue réglée, puis activée après l'aperçu exact + OUI", async () => {
    const a = await sayAndConfirm("règle la relance de bienvenue : Bienvenue {prenom}, ravi de te voir !");
    const rule = await prisma.automationRule.findFirst({ where: { templateKey: "welcome" } });
    expect(rule, a.done.text).not.toBeNull();
    expect(rule!.isActive).toBe(false);
    const ask = await say("active la relance de bienvenue");
    expect(ask.text).toContain("Bienvenue {prenom}, ravi de te voir !");
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: rule!.id } })).isActive).toBe(false);
    const done = await pressYes(ask.sent);
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: rule!.id } })).isActive, done.text).toBe(true);
  });

  it("conversations : prendre la main, marquer traitée", async () => {
    const member = await prisma.member.findFirstOrThrow({ where: { firstName: "Membre3" } });
    const conv = await prisma.conversation.create({ data: { botId: ids.datingBot, memberId: member.id, needsHumanAt: new Date(), needsHumanReason: "question hors fiche" } });
    const a = await sayAndConfirm("je prends la main sur la conversation de Membre3");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status, a.done.text).toBe("HUMAN");
    const b = await sayAndConfirm("la conversation de Membre3 est traitée");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).needsHumanAt, b.done.text).toBeNull();
  });

  it("agents : plafond vidéo (exemple 5) et mot interdit pour l'équipe Casino", async () => {
    const r = await sayAndConfirm("interdis le mot garanti à l'équipe casino");
    const cfg = await prisma.agentTeamConfig.findUniqueOrThrow({ where: { teamKey: "casino" } });
    expect(cfg.forbiddenWords, r.done.text).toContain("garanti");
  });

  it("univers : persona et catégorie de paris (exemples 6 et 8), thème casino ajouté", async () => {
    const r = await sayAndConfirm("ajoute le thème casino Blackjack VIP");
    const cfg = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" } });
    expect(JSON.stringify(cfg?.settings ?? {}), r.done.text).toContain("Blackjack VIP");
  });

  it("réglages : étiquette (plus haut), rapports (exemple 12), niveau VIP des membres", async () => {
    const r = await sayAndConfirm("un membre est VIP à partir de 500 € déposés");
    const s = await prisma.setting.findMany({ where: { updatedAt: { gte: started } } });
    expect(JSON.stringify(s.map((x) => [x.key, x.value])), r.done.text).toMatch(/500/);
    expect((await prisma.setting.findUnique({ where: { key: "members.tags" } }))?.value).toBeTruthy();
  });

  it("connecteurs : relecture Link Affi lancée, adresse des événements des affiliés changée (OUI)", async () => {
    const jobs0 = (globalThis.__jobs ?? []).length;
    const a = await sayAndConfirm("relis Link Affi maintenant");
    expect((globalThis.__jobs ?? []).slice(jobs0).some((j) => j.queue === "sync-linkaffi"), a.done.text).toBe(true);
    const b = await sayAndConfirm("l'adresse des événements Link Affi c'est https://linkaffi.exemple.fr/functions/v1/telegram-events");
    expect((await prisma.integrationKey.findUnique({ where: { provider: "linkaffi" } }))?.eventsUrl, b.done.text).toBe("https://linkaffi.exemple.fr/functions/v1/telegram-events");
  });

  it("équipe : invitation (exemple 10), liste de l'équipe", async () => {
    const r = await say("qui est dans l'équipe du site ?");
    expect(r.text).toMatch(/comptes? actifs?/);
    expect(r.text).toMatch(/invitation/);
    expectVoice(r.text);
  });

  it("statistiques : recalcul lancé, question sur les dépenses du mois", async () => {
    const jobs0 = (globalThis.__jobs ?? []).length;
    const a = await sayAndConfirm("recalcule les statistiques");
    expect((globalThis.__jobs ?? []).slice(jobs0).some((j) => j.queue === "stats"), a.done.text).toBe(true);
    const b = await say("combien j'ai dépensé ce mois ?");
    expect(b.text).toMatch(/€/);
    expectVoice(b.text);
  });
});

// ================================================================================================ 3. site ↔ Kevin

/** Identifiants et dates remplacés, `via` retiré : ce qui doit être identique entre le site et Kevin. */
function normalized(v: unknown): unknown {
  if (v instanceof Date) return "<date>";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") {
    if (/^c[a-z0-9]{20,30}$/.test(v)) return "<id>";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return "<date>";
    return v;
  }
  if (Array.isArray(v)) return v.map(normalized);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!["id", "createdAt", "updatedAt", "via"].includes(k)) out[k] = normalized(x);
    return out;
  }
  return v;
}

/** Résultat d'une action serveur (une redirection = fin normale). */
async function siteAction(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (err) {
    const e = err as { digest?: string; url?: string };
    if (e.digest?.startsWith("NEXT_REDIRECT")) return e.url ?? "";
    throw err;
  }
}

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

type Parity = { reset: () => Promise<void>; site: () => Promise<unknown>; kevin: () => Promise<unknown>; state: () => Promise<unknown>; actions: string[] };

/** Site puis Kevin sur une base remise à zéro : même état et même journal (hors `via`, identifiants, dates). */
async function expectParity(p: Parity) {
  const run = async (who: () => Promise<unknown>) => {
    await p.reset();
    const t0 = new Date(Date.now() - 1);
    const out = await who();
    const audits = await prisma.auditLog.findMany({ where: { createdAt: { gte: t0 }, action: { in: p.actions } }, orderBy: { createdAt: "asc" }, select: { userId: true, action: true, entityType: true, entityId: true, metadata: true } });
    return { out, state: normalized(await p.state()), audits: normalized(audits), vias: audits.map((a) => (a.metadata as { via?: string } | null)?.via ?? null) };
  };
  session.user = { id: ids.admin, email: "kevin-parity@linkaffipro.internal", name: "Mathéo", role: "ADMIN", telegramUserId: BigInt(ADMIN) };
  const web = await run(p.site);
  session.user = null;
  const kevin = await run(p.kevin);
  expect(web.audits, "le site a journalisé l'action").not.toEqual([]);
  expect(kevin.state, `état après Kevin (${JSON.stringify(kevin.out).slice(0, 300)})`).toEqual(web.state);
  expect(kevin.audits).toEqual(web.audits);
  // Même journal, seule la provenance change.
  expect(web.vias.every((v) => v === "WEB" || v === null)).toBe(true);
  expect(kevin.vias).toContain("TELEGRAM");
  expect(kevin.vias).not.toContain("WEB");
}

describe("phase 34 : le site et Kevin laissent le même état et le même journal", () => {
  it("lot B — Réglages → Étiquettes : créer une étiquette", async () => {
    const { createTagAction } = await import("@/app/(admin)/settings/tags/actions");
    await expectParity({
      reset: async () => void (await prisma.setting.deleteMany({ where: { key: "members.tags" } })),
      site: () => siteAction(createTagAction(form({ name: "Parité", color: "green" }))),
      kevin: () => sayAndConfirm("crée l'étiquette Parité en vert"),
      state: () => prisma.setting.findUnique({ where: { key: "members.tags" }, select: { value: true } }),
      actions: ["tag.created"],
    });
  });

  it("lot C — fiche membre : ajouter une note", async () => {
    const { addNoteAction } = await import("@/app/(admin)/members/[id]/actions");
    const member = await prisma.member.findFirstOrThrow({ where: { firstName: "Membre4" } });
    await expectParity({
      reset: async () => void (await prisma.memberNote.deleteMany({ where: { memberId: member.id } })),
      site: () => siteAction(addNoteAction(form({ memberId: member.id, text: "À rappeler lundi" }))),
      kevin: () => sayAndConfirm("note sur Membre4 : à rappeler lundi"),
      state: () => prisma.memberNote.findMany({ where: { memberId: member.id }, select: { memberId: true, authorId: true, text: true } }),
      actions: ["member.note_added"],
    });
  });

  it("lot D — Agents → Casino : ajouter un thème", async () => {
    const { addCasinoThemeAction } = await import("@/app/(admin)/agents/[equipe]/casino-actions");
    const initial = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" }, select: { settings: true } });
    await expectParity({
      reset: async () => {
        await prisma.agentTeamConfig.upsert({ where: { teamKey: "casino" }, create: { teamKey: "casino", settings: (initial?.settings ?? {}) as never }, update: { settings: (initial?.settings ?? {}) as never } });
      },
      site: () => siteAction(addCasinoThemeAction(form({ label: "Roulette Live" }))),
      kevin: () => sayAndConfirm("ajoute le thème casino Roulette Live"),
      state: () => prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" }, select: { settings: true } }),
      actions: ["agents.casino_theme_added"],
    });
  });

  it("lot E — Réglages → Rapports : changer l'heure d'envoi", async () => {
    const { saveReportsConfigAction } = await import("@/app/(admin)/settings/reports/actions");
    await expectParity({
      reset: async () => {
        const value = { daily: true, weekly: true, hour: 9 };
        await prisma.setting.upsert({ where: { key: "reports.config" }, create: { key: "reports.config", value }, update: { value } });
      },
      site: () => siteAction(saveReportsConfigAction(form({ hour: "7", daily: "on", weekly: "on" }))),
      kevin: () => sayAndConfirm("envoie-moi le rapport à 7 h"),
      state: () => prisma.setting.findUnique({ where: { key: "reports.config" }, select: { value: true } }),
      actions: ["settings.reports_changed"],
    });
  });

  it("suppression — supprimer une campagne (Kevin : récapitulatif puis SUPPRIMER)", async () => {
    const { deleteCampaignAction } = await import("@/app/(admin)/campaigns/actions");
    let campaignId = "";
    await expectParity({
      reset: async () => {
        await prisma.campaign.deleteMany({ where: { name: "Parité" } });
        campaignId = (await prisma.campaign.create({ data: { name: "Parité", vertical: "SPORTS", channelIds: [ids.zone] } })).id;
      },
      site: () => siteAction(deleteCampaignAction(form({ campaignId }))),
      kevin: async () => {
        const ask = await say("supprime la campagne Parité");
        expect(ask.text).toContain("SUPPRIMER");
        return say("SUPPRIMER");
      },
      state: () => prisma.campaign.count({ where: { name: "Parité" } }),
      actions: ["campaign.deleted"],
    });
  });

  it("envoi — écrire à un groupe à une heure donnée (Kevin : aperçu exact + OUI)", async () => {
    const { createBroadcastAction } = await import("@/app/(admin)/members/broadcasts/actions");
    const { segmentFormFields } = await import("@/lib/broadcasts/group");
    await expectParity({
      reset: async () => void (await prisma.broadcast.deleteMany({ where: { name: "Parité envoi" } })),
      site: () =>
        siteAction(
          createBroadcastAction(
            (() => {
              const fd = form({ name: "Parité envoi", botId: ids.sportsBot, text: "<b>Ce soir</b> 20 h", mediaAssetId: "", buttons: "[]", intent: "schedule", scheduledAt: tomorrowLocal(21) });
              for (const [k, v] of segmentFormFields({ channelIds: [ids.zone] })) fd.append(k, v);
              return fd;
            })(),
          ),
        ),
      kevin: async () => {
        const ask = await say("écris aux membres de Zone Interdite demain 21 h : Ce soir 20 h en gras");
        expect(ask.text).toContain("<b>Ce soir</b> 20 h");
        expect(ask.text).toMatch(/\b3 personnes\b/);
        return pressYes(ask.sent);
      },
      state: () => prisma.broadcast.findMany({ where: { name: "Parité envoi" }, select: { name: true, botId: true, segment: true, text: true, buttons: true, status: true, scheduledAt: true, targeted: true, mediaAssetId: true, createdById: true } }),
      actions: ["broadcast.created", "broadcast.scheduled"],
    });
    expect(await prisma.outboundMessage.count({ where: { broadcast: { name: "Parité envoi" } } })).toBe(0);
  });
});

// ================================================================================================ 4. sécurité

describe("phase 34 : sécurité", () => {
  beforeAll(async () => {
    await prisma.setting.upsert({ where: { key: "boss.groupChatId" }, create: { key: "boss.groupChatId", value: String(GROUP) }, update: { value: String(GROUP) } });
    await prisma.teamMember.create({ data: { telegramUserId: BigInt(LEA_TG), firstName: "Léa", username: "lea", role: "MANAGER", startedPrivateAt: new Date() } });
  });

  it("un responsable (MANAGER) du groupe tente une action d'admin : refus, rien n'est écrit", async () => {
    const tags = await prisma.setting.findUnique({ where: { key: "members.tags" } });
    const r = await deliver(groupMsg(LEA_TG, "Kevin, crée l'étiquette Interdite"));
    expect(r.text).toMatch(/Mathéo|l'admin/);
    expect(r.text).toMatch(/décide/);
    expect(await prisma.setting.findUnique({ where: { key: "members.tags" } })).toEqual(tags);
    const del = await deliver(groupMsg(LEA_TG, "Kevin, supprime la campagne Celsius FR"));
    expect(del.text).toMatch(/Mathéo|l'admin/);
    expect(await prisma.campaign.count({ where: { name: "Celsius FR" } })).toBe(1);
    expect(await prisma.setting.findUnique({ where: { key: "boss.pending" } }).then((x) => x?.value ?? null)).toBeFalsy();
  });

  it("« supprime la campagne Celsius FR » : « oui » refusé, « SUPPRIMER » supprime", async () => {
    const ask = await say("supprime la campagne Celsius FR");
    expect(ask.text).toContain("SUPPRIMER");
    // Aucun bouton OUI pour une suppression (seulement NON).
    expect(ask.sent.flatMap((s) => s.buttons).some((b) => /:yes$/.test(b.callback_data))).toBe(false);
    for (const word of ["oui", "OUI", "supprimer"]) {
      const r = await say(word);
      expect(r.text, word).toMatch(/SUPPRIMER/);
      expect(await prisma.campaign.count({ where: { name: "Celsius FR" } })).toBe(1);
    }
    const since = new Date();
    const done = await say("SUPPRIMER");
    expectVoice(done.text);
    expect(await prisma.campaign.count({ where: { name: "Celsius FR" } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "campaign.deleted", createdAt: { gte: since } } });
    expect(audit.userId).toBe(ids.admin);
    expect((audit.metadata as { via?: string }).via).toBe("TELEGRAM");
  });

  it("un secret demandé dans le groupe : « en privé », rien d'enregistré ; une clé collée dans le groupe est effacée", async () => {
    const before = await prisma.humanRequest.count({ where: { kind: "SECRET" } });
    const settings = await prisma.setting.count({ where: { key: { startsWith: "agents.secret." } } });
    const r = await deliver(groupMsg(ADMIN, "Kevin, ajoute mon compte Sportaza"));
    expect(r.text).toMatch(/privé/);
    expect(r.sent.every((x) => x.chat === GROUP)).toBe(true);
    expect(await prisma.humanRequest.count({ where: { kind: "SECRET" } })).toBe(before);
    const token = `987654321:AAH${"q".repeat(32)}`;
    const m = mark();
    const pasted = await deliver(groupMsg(ADMIN, token));
    expect(deletedSince(m)).toContain(pasted.update.message!.message_id);
    expect(await prisma.setting.count({ where: { key: { startsWith: "agents.secret." } } })).toBe(settings);
    expect(await prisma.bot.count({ where: { telegramBotId: 987654321n } })).toBe(0);
    const logged = JSON.stringify([await prisma.event.findMany({ where: { createdAt: { gte: started } } }), await prisma.bossTurn.findMany({ where: { createdAt: { gte: started } } })], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(logged).not.toContain(token);
  });

  it("entrée interne signée : juste → exécutée ; trafiquée, rejouée, trop vieille, rôle remonté → refus, rien d'exécuté", async () => {
    const { POST: SITE_OPS } = await import("@/app/api/internal/site-ops/route");
    const { SITE_OPS_SIGNATURE_HEADER, SITE_OPS_TIMESTAMP_HEADER, signSiteOpsBody, siteOpsKeyFrom } = await import("@linkaffipro/agents");
    const key = siteOpsKeyFrom(process.env.APP_ENCRYPTION_KEY);
    const actor = { userId: ids.admin, role: "ADMIN", via: "TELEGRAM", telegramUserId: String(ADMIN) };
    const req = (body: string, opts: { ts?: number; sig?: string } = {}) => {
      const ts = String(opts.ts ?? Date.now());
      return new Request("http://localhost/api/internal/site-ops", {
        method: "POST",
        headers: { "content-type": "application/json", [SITE_OPS_TIMESTAMP_HEADER]: ts, [SITE_OPS_SIGNATURE_HEADER]: opts.sig ?? signSiteOpsBody(key, ts, body) },
        body,
      });
    };
    const tagNames = async () => JSON.stringify((await prisma.setting.findUnique({ where: { key: "members.tags" } }))?.value ?? null);
    const body = JSON.stringify({ op: "reglages.etiquette_creer", input: { name: "Signée", color: "blue" }, actor });
    // Juste : exécutée par le même cœur que le site.
    const ts = Date.now();
    const sig = signSiteOpsBody(key, String(ts), body);
    const ok = await SITE_OPS(req(body, { ts, sig }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
    expect(await tagNames()).toContain("Signée");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { userId: ids.admin }, orderBy: { createdAt: "desc" } });
    expect((audit.metadata as { via?: string }).via).toBe("TELEGRAM");
    // Rejouée (même signature) : refusée.
    expect((await SITE_OPS(req(body, { ts, sig }))).status).toBe(401);
    // Trafiquée : corps changé après la signature.
    const evil = JSON.stringify({ op: "reglages.etiquette_creer", input: { name: "Pirate", color: "red" }, actor });
    expect((await SITE_OPS(req(evil, { ts: Date.now(), sig: signSiteOpsBody(key, String(Date.now()), body) }))).status).toBe(401);
    // Signée avec une autre clé.
    const other = siteOpsKeyFrom("une-autre-cle");
    const t2 = Date.now();
    expect((await SITE_OPS(req(evil, { ts: t2, sig: signSiteOpsBody(other, String(t2), evil) }))).status).toBe(401);
    // Trop vieille (5 minutes).
    const old = Date.now() - 5 * 60_000;
    expect((await SITE_OPS(req(evil, { ts: old, sig: signSiteOpsBody(key, String(old), evil) }))).status).toBe(401);
    // Sans en-têtes.
    expect((await SITE_OPS(new Request("http://localhost/api/internal/site-ops", { method: "POST", body: evil }))).status).toBe(401);
    expect(await tagNames()).not.toContain("Pirate");
    // Bien signée mais rôle remonté : Léa (responsable du groupe, sans compte du site) se dit ADMIN → refus.
    const lea = JSON.stringify({ op: "reglages.etiquette_creer", input: { name: "Pirate", color: "red" }, actor: { userId: null, role: "ADMIN", via: "TELEGRAM", telegramUserId: String(LEA_TG) } });
    const r = await SITE_OPS(req(lea));
    expect(await r.json()).toMatchObject({ ok: false, code: "forbidden" });
    expect(await tagNames()).not.toContain("Pirate");
  });
});
