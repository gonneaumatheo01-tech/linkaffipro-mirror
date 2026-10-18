// Données de démonstration LOCALES (phase 9 : captures d'écran, contrôle axe, travail sur la refonte).
// Exécution : `pnpm db:demo` (lit `.env.local` à la racine). REFUSE toute base qui n'est pas sur localhost / 127.0.0.1.
// Aucun appel réseau : jetons de bots factices (chiffrés avec APP_ENCRYPTION_KEY), liens Telegram et offres Link Affi
// inventés, aucun message envoyé à qui que ce soit. Idempotent : les données de démonstration d'une passe précédente
// (repères ci-dessous : préfixe « Démo · », identifiants Telegram réservés, codes « demo-… ») sont retirées puis
// recréées avec des dates relatives à maintenant (60 jours d'historique, dont aujourd'hui et hier, et les messages
// programmés de la semaine en cours et de la suivante). Rien d'autre n'est touché (comptes, canaux et réglages de
// l'équipe restent tels quels ; les étiquettes de démonstration sont ajoutées au registre sans rien retirer).
// Enfin, les statistiques journalières (recalcul complet) et les meilleurs horaires sont calculés par les fonctions du
// worker, sans Redis.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import {
  affiliateAttributionEndsAt,
  buildLinkaffiEvent,
  encrypt,
  fillUrlTemplate,
  landingInviteLinkName,
  linkaffiInviteLinkName,
  newSubId,
  parseEncryptionKey,
  provenanceLabel,
  provenanceOfLink,
  randomToken,
  shortId,
  withTelegramCampaignParam,
  type LinkaffiEventType,
  type ProvenanceLink,
} from "@linkaffipro/core";
import type { Prisma, PrismaClient } from "@prisma/client";
import { GATE_EXCEPTION_LABEL } from "./phase11-gate-exceptions";

// ============================================================
// Repères des données de démonstration
// ============================================================

export const DEFAULT_DEMO_PASSWORD = "demo-local-1234";
export const VERIFICATION_EMAIL = "verification@linkaffipro.internal";
export const MANAGER_EMAIL = "manager.demo@linkaffipro.internal";
export const DEMO_PREFIX = "Démo · ";
/** Identifiants Telegram des membres de démonstration : bien au-delà des vrais comptes (≈ 8 × 10⁹ aujourd'hui). */
export const DEMO_MEMBER_ID_BASE = 990_000_000_000n;
const DEMO_MEMBER_ID_END = DEMO_MEMBER_ID_BASE + 1_000_000n;
/** Bots de démonstration : les trois bots d'univers, puis le bot de l'assistante de conversation (phase 17). */
const DEMO_BOT_IDS = [9_900_000_001n, 9_900_000_002n, 9_900_000_003n, 9_900_000_004n];
/** Canaux de démonstration : six canaux habituels, puis les trois du cas du client de la phase 11 (7, 8, 9). */
const DEMO_CHAT_IDS = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n].map((n) => -1_009_900_000_000n - n);
const MEMBER_COUNT = 300;
const SEED = 20_261_010;

export function isDemoTelegramUserId(id: bigint): boolean {
  return id >= DEMO_MEMBER_ID_BASE && id < DEMO_MEMBER_ID_END;
}

// ============================================================
// Garde-fou : base locale seulement
// ============================================================

export class DemoGuardError extends Error {}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

export function checkLocalDatabaseUrl(
  raw: string | undefined,
): { ok: true; host: string; database: string } | { ok: false; reason: string } {
  if (!raw || !raw.trim())
    return { ok: false, reason: "DATABASE_URL absente : rien à remplir (voir .env.local)." };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "DATABASE_URL illisible : adresse PostgreSQL attendue." };
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:")
    return { ok: false, reason: "DATABASE_URL doit viser une base PostgreSQL (postgresql://…)." };
  const hostParam = url.searchParams.get("host");
  if (hostParam && !hostParam.startsWith("/") && !LOCAL_HOSTS.includes(hostParam))
    return {
      ok: false,
      reason: `DATABASE_URL renvoie vers « ${hostParam} » (paramètre host) : données de démonstration refusées hors de la machine.`,
    };
  if (!LOCAL_HOSTS.includes(url.hostname))
    return {
      ok: false,
      reason: `DATABASE_URL vise « ${url.hostname} » : les données de démonstration ne s'écrivent que dans une base locale (localhost ou 127.0.0.1), jamais en production.`,
    };
  return { ok: true, host: url.hostname, database: url.pathname.replace(/^\//, "") || "postgres" };
}

export function assertLocalDatabaseUrl(raw: string | undefined): void {
  const c = checkLocalDatabaseUrl(raw);
  if (!c.ok) throw new DemoGuardError(c.reason);
}

// ============================================================
// Heures de Paris et tirage reproductible
// ============================================================

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const PARIS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parisParts(d: Date) {
  const p = Object.fromEntries(PARIS.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    mi: Number(p.minute),
    s: Number(p.second),
  };
}

/** Jour civil de Paris (AAAA-MM-JJ). */
export function parisDayKey(d: Date): string {
  const p = parisParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Instant UTC de minuit (heure de Paris) du jour de `d`, changements d'heure compris. */
export function parisDayStart(d: Date): Date {
  const p = parisParts(d);
  const offset =
    Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000;
  let guess = Date.UTC(p.y, p.m - 1, p.d) - offset;
  const q = parisParts(new Date(guess));
  if (q.h !== 0 || q.mi !== 0) guess -= (q.h >= 12 ? q.h - 24 : q.h) * HOUR + q.mi * MIN;
  return new Date(guess);
}

/** Générateur pseudo-aléatoire reproductible (mulberry32) et petits tirages. */
export function createRandom(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    /** Montant arrondi au centime entre min et max. */
    amount: (min: number, max: number) => Math.round((min + next() * (max - min)) * 100) / 100,
    weighted: <T>(items: ReadonlyArray<readonly [T, number]>): T => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [v, w] of items) {
        x -= w;
        if (x <= 0) return v;
      }
      return items[items.length - 1]![0];
    },
  };
}
type Random = ReturnType<typeof createRandom>;

// ============================================================
// Catalogue de démonstration
// ============================================================

type Vertical = "CASINO" | "SPORTS" | "DATING";
type ChannelKey =
  "casinoVip" | "casinoBonus" | "sportsFoot" | "sportsTest" | "datingParis" | "datingLyon";
type OfferKey = "casinoA" | "casinoB" | "sportsA" | "sportsB" | "datingA" | "other";

const BOTS: ReadonlyArray<{ vertical: Vertical; name: string; username: string; tgId: bigint }> = [
  {
    vertical: "CASINO",
    name: `${DEMO_PREFIX}Bot Casino`,
    username: "demo_casino_bot",
    tgId: DEMO_BOT_IDS[0]!,
  },
  {
    vertical: "SPORTS",
    name: `${DEMO_PREFIX}Bot Paris sportifs`,
    username: "demo_sports_bot",
    tgId: DEMO_BOT_IDS[1]!,
  },
  {
    vertical: "DATING",
    name: `${DEMO_PREFIX}Bot Rencontres`,
    username: "demo_dating_bot",
    tgId: DEMO_BOT_IDS[2]!,
  },
];

type ChannelDef = {
  key: ChannelKey;
  vertical: Vertical;
  title: string;
  username: string | null;
  chatId: bigint;
  isTest: boolean;
  /** Part des nouveaux membres. */
  weight: number;
  /** Heures de publication habituelles (Paris). */
  hours: number[];
};

const CHANNELS: ChannelDef[] = [
  {
    key: "casinoVip",
    vertical: "CASINO",
    title: `${DEMO_PREFIX}Casino VIP`,
    username: "demo_casino_vip",
    chatId: DEMO_CHAT_IDS[0]!,
    isTest: false,
    weight: 0.26,
    hours: [12, 19, 21, 21, 22],
  },
  {
    key: "casinoBonus",
    vertical: "CASINO",
    title: `${DEMO_PREFIX}Bonus Casino du jour`,
    username: null,
    chatId: DEMO_CHAT_IDS[1]!,
    isTest: false,
    weight: 0.14,
    hours: [11, 18, 21],
  },
  {
    key: "sportsFoot",
    vertical: "SPORTS",
    title: `${DEMO_PREFIX}Pronos Foot`,
    username: "demo_pronos_foot",
    chatId: DEMO_CHAT_IDS[2]!,
    isTest: false,
    weight: 0.26,
    hours: [9, 12, 12, 18, 20],
  },
  {
    key: "sportsTest",
    vertical: "SPORTS",
    title: `${DEMO_PREFIX}Canal TEST`,
    username: null,
    chatId: DEMO_CHAT_IDS[3]!,
    isTest: true,
    weight: 0.02,
    hours: [10, 15],
  },
  {
    key: "datingParis",
    vertical: "DATING",
    title: `${DEMO_PREFIX}Rencontres Paris`,
    username: "demo_rencontres_paris",
    chatId: DEMO_CHAT_IDS[4]!,
    isTest: false,
    weight: 0.2,
    hours: [19, 21, 22],
  },
  {
    key: "datingLyon",
    vertical: "DATING",
    title: `${DEMO_PREFIX}Rencontres Lyon`,
    username: null,
    chatId: DEMO_CHAT_IDS[5]!,
    isTest: false,
    weight: 0.12,
    hours: [20, 22],
  },
];

const PROGRAMS: ReadonlyArray<{
  externalId: string;
  name: string;
  vertical: Vertical;
  affiliateId: string;
  offers: ReadonlyArray<{ key: OfferKey; name: string; campaignKey: string }>;
}> = [
  {
    externalId: "demo-casino-royal",
    name: `${DEMO_PREFIX}Casino Royal`,
    vertical: "CASINO",
    affiliateId: "demo-affilie",
    offers: [
      {
        key: "casinoA",
        name: `${DEMO_PREFIX}Casino Royal — Bienvenue 200 %`,
        campaignKey: "demoa001",
      },
      {
        key: "casinoB",
        name: `${DEMO_PREFIX}Casino Royal — Tours gratuits`,
        campaignKey: "demoa002",
      },
    ],
  },
  {
    externalId: "demo-betfoot",
    name: `${DEMO_PREFIX}BetFoot`,
    vertical: "SPORTS",
    affiliateId: "demo-affilie",
    offers: [
      {
        key: "sportsA",
        name: `${DEMO_PREFIX}BetFoot — Premier pari remboursé`,
        campaignKey: "demob001",
      },
      { key: "sportsB", name: `${DEMO_PREFIX}BetFoot — Cote boostée`, campaignKey: "demob002" },
    ],
  },
  {
    externalId: "demo-coeurs",
    name: `${DEMO_PREFIX}Cœurs à prendre`,
    vertical: "DATING",
    affiliateId: "demo-affilie",
    offers: [
      {
        key: "datingA",
        name: `${DEMO_PREFIX}Cœurs à prendre — Inscription gratuite`,
        campaignKey: "democ001",
      },
    ],
  },
  {
    externalId: "demo-autre-affilie",
    name: `${DEMO_PREFIX}Autre affilié`,
    vertical: "CASINO",
    affiliateId: "demo-autre-affilie",
    offers: [{ key: "other", name: `${DEMO_PREFIX}Offre non rattachée`, campaignKey: "demod001" }],
  },
];

type CampaignDef = {
  name: string;
  vertical: Vertical;
  status: "ACTIVE" | "PAUSED";
  platform: "TIKTOK" | "META" | "OTHER";
  channels: ChannelKey[];
  entry: ChannelKey;
  offers: OfferKey[];
  startDaysAgo: number;
  /** Pub arrêtée depuis N jours (campagne en pause). */
  stopDaysAgo: number | null;
  budgetDaily: number;
  costSource: "CSV" | "MANUAL";
  adSets: ReadonlyArray<{ name: string; ads: string[] }>;
};

const CAMPAIGNS: CampaignDef[] = [
  {
    name: `${DEMO_PREFIX}Casino Bienvenue TikTok`,
    vertical: "CASINO",
    status: "ACTIVE",
    platform: "TIKTOK",
    channels: ["casinoVip", "casinoBonus"],
    entry: "casinoVip",
    offers: ["casinoA", "casinoB"],
    startDaysAgo: 45,
    stopDaysAgo: null,
    budgetDaily: 60,
    costSource: "CSV",
    adSets: [
      {
        name: "Groupe 1 · Jeunes actifs",
        ads: ["Vidéo bonus", "Carrousel des gains", "Témoignage"],
      },
      { name: "Groupe 2 · Soirée", ads: ["Soirée 1", "Soirée 2"] },
    ],
  },
  {
    name: `${DEMO_PREFIX}Pronos Foot Meta`,
    vertical: "SPORTS",
    status: "ACTIVE",
    platform: "META",
    channels: ["sportsFoot"],
    entry: "sportsFoot",
    offers: ["sportsA"],
    startDaysAgo: 50,
    stopDaysAgo: null,
    budgetDaily: 40,
    costSource: "MANUAL",
    adSets: [
      { name: "Groupe 1 · Ligue 1", ads: ["Ligue 1 · A", "Ligue 1 · B"] },
      { name: "Groupe 2 · Coupes d'Europe", ads: ["Coupe d'Europe"] },
    ],
  },
  {
    name: `${DEMO_PREFIX}Rencontres Été`,
    vertical: "DATING",
    status: "PAUSED",
    platform: "TIKTOK",
    channels: ["datingParis", "datingLyon"],
    entry: "datingParis",
    offers: ["datingA"],
    startDaysAgo: 60,
    stopDaysAgo: 10,
    budgetDaily: 35,
    costSource: "CSV",
    adSets: [{ name: "Groupe 1", ads: ["Paris", "Lyon"] }],
  },
  {
    name: `${DEMO_PREFIX}Paris Ligue des champions`,
    vertical: "SPORTS",
    status: "ACTIVE",
    platform: "OTHER",
    channels: ["sportsFoot"],
    entry: "sportsFoot",
    offers: ["sportsA", "sportsB"],
    startDaysAgo: 20,
    stopDaysAgo: null,
    budgetDaily: 25,
    costSource: "MANUAL",
    adSets: [{ name: "Groupe 1", ads: ["Influenceur"] }],
  },
];

const CATEGORIES = [
  { slug: "demo-bonus", name: `${DEMO_PREFIX}Bonus`, color: "#d97706" },
  { slug: "demo-preuves", name: `${DEMO_PREFIX}Preuves de gains`, color: "#059669" },
  { slug: "demo-teasing", name: `${DEMO_PREFIX}Teasing`, color: "#2563eb" },
] as const;

const TAGS = [
  { name: "VIP", color: "orange" },
  { name: "Déposant", color: "green" },
  { name: "À relancer", color: "blue" },
] as const;

const RISK =
  "<i>Jouer comporte des risques : endettement, isolement, dépendance. Appelez le 09 74 75 13 13.</i>";

const TEXTS: Record<Vertical, string[]> = {
  CASINO: [
    `<b>Bonus de bienvenue</b>\nJusqu'à 200 % sur votre premier dépôt, ce soir seulement.\n\n${RISK}`,
    `<b>Tours gratuits</b>\n50 tours offerts sur la machine de la semaine, sans condition de mise.\n\n${RISK}`,
    `<b>Ils ont gagné cette semaine</b>\nTrois membres du canal ont décroché le jackpot. Votre tour ?\n\n${RISK}`,
    `<b>Ce soir 21 h</b>\nTournoi exclusif réservé aux membres du canal. Inscription par le bouton ci-dessous.\n\n${RISK}`,
    `<b>Rappel</b>\nVotre bonus expire à minuit : pensez à l'activer.\n\n${RISK}`,
  ],
  SPORTS: [
    `<b>Prono du jour</b>\nParis SG – Lyon : victoire de Paris, cote 1,85.\n\n${RISK}`,
    `<b>Premier pari remboursé</b>\nJusqu'à 100 € remboursés si votre premier pari est perdant.\n\n${RISK}`,
    `<b>Combiné du week-end</b>\nQuatre matchs, une cote totale de 6,40. Détails dans le canal.\n\n${RISK}`,
    `<b>Résultat d'hier</b>\n3 pronos sur 4 gagnants. Merci de votre confiance !\n\n${RISK}`,
    `<b>Cote boostée</b>\nMarseille gagnant passe de 2,10 à 3,00 pour les membres du canal.\n\n${RISK}`,
  ],
  DATING: [
    "<b>Nouveaux profils près de chez vous</b>\nPlus de 200 inscrits cette semaine dans votre ville.",
    "<b>Soirée célibataires</b>\nSamedi soir, une soirée réservée aux membres du canal. Places limitées.",
    "<b>Inscription gratuite</b>\nCréez votre profil en deux minutes et recevez vos premières suggestions.",
    "<b>Conseil du jour</b>\nUne photo souriante et une phrase sur vos passions : deux fois plus de réponses.",
    "<b>Rappel</b>\nVotre profil n'est pas encore complet : ajoutez une photo pour être visible.",
  ],
};

const FIRST_NAMES = [
  "Léa",
  "Lucas",
  "Emma",
  "Hugo",
  "Chloé",
  "Louis",
  "Manon",
  "Nathan",
  "Camille",
  "Enzo",
  "Inès",
  "Théo",
  "Jade",
  "Mathis",
  "Sarah",
  "Tom",
  "Lina",
  "Noah",
  "Zoé",
  "Gabriel",
  "Alice",
  "Raphaël",
  "Louise",
  "Arthur",
  "Julie",
  "Maxime",
  "Clara",
  "Antoine",
  "Anaïs",
  "Yanis",
  "Mélissa",
  "Karim",
  "Sofia",
  "Mehdi",
  "Nina",
  "Paul",
];
const LAST_INITIALS = "ABCDEFGHJKLMNPRSTV";
const LANGUAGES: ReadonlyArray<readonly [string, number]> = [
  ["fr", 0.84],
  ["en", 0.06],
  ["es", 0.03],
  ["de", 0.02],
  ["it", 0.02],
  ["pt-br", 0.03],
];

// ============================================================
// Construction
// ============================================================

type Db = Prisma.TransactionClient;

/** Identifiant au format cuid (25 caractères), créé ici pour relier les lignes avant leur insertion en lot. */
function newId(): string {
  return `c${shortId(24).toLowerCase()}`;
}

/**
 * Identifiant stable des objets principaux (bots, canaux, campagnes, pubs, offres, membres…) : le même à chaque passe,
 * pour que les adresses des fiches (`/campaigns/<id>`, `/members/<id>`…) restent valables après un nouveau `pnpm db:demo`.
 */
export function stableId(key: string): string {
  const hex = createHash("sha256").update(`linkaffipro-demo:${key}`).digest("hex");
  return `c${BigInt(`0x${hex}`).toString(36).padStart(24, "0").slice(0, 24)}`;
}

async function inBatches<T>(rows: T[], size: number, insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

/** Retire les données de démonstration d'une passe précédente (repères stricts, rien d'autre). */
async function removeDemo(db: Db): Promise<Record<string, number>> {
  const bots = (
    await db.bot.findMany({
      where: {
        OR: [
          { telegramBotId: { in: DEMO_BOT_IDS } },
          { username: { in: [...BOTS.map((b) => b.username), P17_BOT.username] } },
        ],
      },
      select: { id: true },
    })
  ).map((b) => b.id);
  // Phase 17 : coûts de l'IA de la persona de démonstration et de ses conversations (sans eux, la suppression de la
  // persona et des conversations les laisserait sans rattachement).
  const p17Conversations = (
    await db.conversation.findMany({ where: { botId: { in: bots } }, select: { id: true } })
  ).map((c) => c.id);
  const p17Usages = await db.aiConversationUsage.deleteMany({
    where: {
      OR: [{ personaId: P17_PERSONA_ID }, { conversationId: { in: p17Conversations } }],
    },
  });
  const channels = (
    await db.channel.findMany({
      where: { telegramChatId: { in: DEMO_CHAT_IDS } },
      select: { id: true },
    })
  ).map((c) => c.id);
  const members = (
    await db.member.findMany({
      where: { telegramUserId: { gte: DEMO_MEMBER_ID_BASE, lt: DEMO_MEMBER_ID_END } },
      select: { id: true },
    })
  ).map((m) => m.id);
  const campaigns = (
    await db.campaign.findMany({
      where: { name: { startsWith: DEMO_PREFIX } },
      select: { id: true },
    })
  ).map((c) => c.id);
  const programs = await db.affiliateProgram.findMany({
    where: { source: "LINKAFFI", externalId: { startsWith: "demo-" } },
    select: { id: true, campaigns: { select: { id: true } } },
  });
  const offers = programs.flatMap((p) => p.campaigns.map((c) => c.id));
  const posts = (
    await db.post.findMany({
      where: { OR: [{ botId: { in: bots } }, { channelId: { in: channels } }] },
      select: { id: true },
    })
  ).map((p) => p.id);
  const invites = (
    await db.inviteLink.findMany({
      where: { OR: [{ botId: { in: bots } }, { channelId: { in: channels } }] },
      select: { id: true },
    })
  ).map((l) => l.id);

  const n: Record<string, number> = {};
  const count = (k: string, r: { count: number }) => (n[k] = (n[k] ?? 0) + r.count);
  count("coûts de l'IA de conversation", p17Usages);
  count(
    "événements",
    await db.event.deleteMany({
      where: {
        OR: [
          { memberId: { in: members } },
          { channelId: { in: channels } },
          { botId: { in: bots } },
        ],
      },
    }),
  );
  count(
    "messages privés",
    await db.outboundMessage.deleteMany({
      where: { OR: [{ botId: { in: bots } }, { memberId: { in: members } }] },
    }),
  );
  count("envois groupés", await db.broadcast.deleteMany({ where: { botId: { in: bots } } }));
  count(
    "liens traqués",
    await db.trackingLink.deleteMany({
      where: {
        OR: [
          { channelId: { in: channels } },
          { campaignId: { in: campaigns } },
          { affiliateCampaignId: { in: offers } },
          { postId: { in: posts } },
          { inviteLinkId: { in: invites } },
        ],
      },
    }),
  );
  count(
    "clics",
    await db.click.deleteMany({
      where: {
        OR: [{ memberId: { in: members } }, { botId: { in: bots } }, { postId: { in: posts } }],
      },
    }),
  );
  count("joueurs", await db.player.deleteMany({ where: { memberId: { in: members } } }));
  // Phase 13 : événements à envoyer à Link Affi des membres de démonstration (aucune clé étrangère).
  count(
    "événements pour Link Affi",
    await db.linkaffiEvent.deleteMany({
      where: { OR: [{ memberId: { in: members } }, { campaignKey: { startsWith: "demotg" } }] },
    }),
  );
  count(
    "programmes",
    await db.affiliateProgram.deleteMany({ where: { id: { in: programs.map((p) => p.id) } } }),
  );
  count("campagnes", await db.campaign.deleteMany({ where: { id: { in: campaigns } } }));
  count("messages", await db.post.deleteMany({ where: { id: { in: posts } } }));
  // Phase 15 : pages d'atterrissage des canaux de démonstration (sources et visites supprimées avec elles).
  count(
    "pages d'atterrissage",
    await db.landingPage.deleteMany({ where: { channelId: { in: channels } } }),
  );
  count("liens d'invitation", await db.inviteLink.deleteMany({ where: { id: { in: invites } } }));
  count("canaux", await db.channel.deleteMany({ where: { id: { in: channels } } }));
  count("membres", await db.member.deleteMany({ where: { id: { in: members } } }));
  count(
    "relances automatiques",
    await db.automationRule.deleteMany({ where: { name: { startsWith: DEMO_PREFIX } } }),
  );
  // Le bot de l'assistante emporte ses conversations (messages, événements, liens de l'offre) ; la persona de
  // démonstration est retirée par son identifiant fixe (jamais une persona créée par l'équipe).
  count("bots", await db.bot.deleteMany({ where: { id: { in: bots } } }));
  count("personas", await db.persona.deleteMany({ where: { id: P17_PERSONA_ID } }));
  count(
    "catégories",
    await db.messageCategory.deleteMany({ where: { slug: { startsWith: "demo-" } } }),
  );
  count(
    "imports",
    await db.importBatch.deleteMany({ where: { filename: { startsWith: "demo-" } } }),
  );
  count(
    "réglages",
    await db.setting.deleteMany({
      where: { key: { in: channels.map((id) => `besthours.${id}`) } },
    }),
  );
  return n;
}

/** Comptes de démonstration : créés, ou remis en ADMIN / MANAGER actif avec le mot de passe de démonstration. */
async function upsertUsers(db: Db, password: string) {
  const out: Record<"admin" | "manager", string> = { admin: "", manager: "" };
  const defs = [
    {
      key: "admin" as const,
      email: VERIFICATION_EMAIL,
      name: "Compte de vérification",
      role: "ADMIN" as const,
    },
    {
      key: "manager" as const,
      email: MANAGER_EMAIL,
      name: `${DEMO_PREFIX}Manager`,
      role: "MANAGER" as const,
    },
  ];
  for (const d of defs) {
    const existing = await db.user.findUnique({ where: { email: d.email } });
    if (!existing) {
      const u = await db.user.create({
        data: {
          email: d.email,
          name: d.name,
          role: d.role,
          passwordHash: await bcrypt.hash(password, 10),
        },
      });
      out[d.key] = u.id;
      continue;
    }
    const same = await bcrypt.compare(password, existing.passwordHash);
    await db.user.update({
      where: { id: existing.id },
      data: {
        role: d.role,
        isActive: true,
        ...(same ? {} : { passwordHash: await bcrypt.hash(password, 10) }),
      },
    });
    out[d.key] = existing.id;
  }
  return out;
}

type MemberRec = {
  id: string;
  tgId: bigint;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string;
  isPremium: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  tags: Set<string>;
};

type MembershipRec = {
  id: string;
  code: string;
  memberId: string;
  channelKey: ChannelKey;
  status: "REQUESTED" | "PENDING_GATE" | "SCHEDULED" | "APPROVED" | "DECLINED" | "LEFT" | "EXPIRED";
  inviteLinkId: string | null;
  requestedAt: Date;
  gateSatisfiedAt: Date | null;
  approveAt: Date | null;
  approvedAt: Date | null;
  declinedAt: Date | null;
  joinedAt: Date | null;
  leftAt: Date | null;
  expiresAt: Date | null;
  remindersSent: number;
};

type AdRec = {
  id: string;
  campaignIndex: number;
  adSetId: string;
  name: string;
  inviteLinkId: string;
  trackingLinkId: string;
  platform: CampaignDef["platform"];
};

type ClickRec = Prisma.ClickCreateManyInput & { id: string; createdAt: Date };

type PlayerPlan = {
  offerKey: OfferKey;
  click: ClickRec | null;
  memberId: string | null;
  registeredAt: Date;
  ftdAt: Date | null;
  /** Événements de NGR forcés (aujourd'hui, hier). */
  ngrAt: Date[];
  postId: string | null;
};

async function createDemo(db: Db, ctx: { now: Date; password: string; key: string; r: Random }) {
  const { now, r } = ctx;
  const todayStart = parisDayStart(now);
  /** Minuit (Paris) il y a `n` jours. */
  const dayStart = (n: number) =>
    parisDayStart(new Date(todayStart.getTime() - n * DAY + 12 * HOUR));
  /** Instant au hasard dans le jour `n` (entre `fromHour` et `toHour`, Paris), jamais dans le futur. */
  const timeOnDay = (n: number, fromHour = 8, toHour = 23.9): Date => {
    const start = dayStart(n).getTime();
    const lo = start + fromHour * HOUR;
    const hi = Math.min(start + toHour * HOUR, now.getTime() - 2 * MIN);
    if (hi <= start) return new Date(now.getTime() - MIN);
    if (hi <= lo) return new Date(start + r.next() * (hi - start));
    return new Date(lo + r.next() * (hi - lo));
  };
  const notFuture = (d: Date) =>
    d.getTime() > now.getTime() - MIN ? new Date(now.getTime() - MIN) : d;
  const between = (a: Date, b: Date) =>
    new Date(a.getTime() + r.next() * Math.max(0, b.getTime() - a.getTime()));

  const users = await upsertUsers(db, ctx.password);

  // Bots (jetons factices : Telegram les refuserait, rien ne peut partir).
  const botIdByVertical = {} as Record<Vertical, string>;
  const botUsername = {} as Record<Vertical, string>;
  for (const b of BOTS) {
    const id = stableId(`bot:${b.vertical}`);
    botIdByVertical[b.vertical] = id;
    botUsername[b.vertical] = b.username;
    await db.bot.create({
      data: {
        id,
        name: b.name,
        username: b.username,
        telegramBotId: b.tgId,
        tokenEncrypted: encrypt(`${b.tgId}:DEMO-${b.vertical}-jeton-factice-hors-service`, ctx.key),
        vertical: b.vertical,
        isActive: true,
        webhookSecret: randomToken(16),
        lastWebhookAt: new Date(now.getTime() - r.int(1, 6) * MIN),
        createdAt: new Date(now.getTime() - 75 * DAY),
      },
    });
  }

  // Canaux, droits des bots, règles d'adhésion.
  const channelId = {} as Record<ChannelKey, string>;
  const channelDef = {} as Record<ChannelKey, ChannelDef>;
  for (const c of CHANNELS) {
    const id = stableId(`channel:${c.key}`);
    channelId[c.key] = id;
    channelDef[c.key] = c;
    await db.channel.create({
      data: {
        id,
        telegramChatId: c.chatId,
        title: c.title,
        username: c.username,
        type: "CHANNEL",
        vertical: c.vertical,
        language: "fr",
        primaryBotId: botIdByVertical[c.vertical],
        isTest: c.isTest,
        createdAt: new Date(now.getTime() - 70 * DAY),
      },
    });
    await db.channelBotAdmin.create({
      data: {
        channelId: id,
        botId: botIdByVertical[c.vertical],
        detectedAt: new Date(now.getTime() - 70 * DAY),
        rights: {
          status: "administrator",
          can_post_messages: true,
          can_edit_messages: true,
          can_delete_messages: true,
          can_invite_users: true,
          can_manage_chat: true,
          can_restrict_members: true,
          can_promote_members: false,
          can_change_info: true,
        },
      },
    });
  }
  const RULES: Record<ChannelKey, Omit<Prisma.ApprovalRuleCreateManyInput, "channelId">> = {
    casinoVip: {
      name: "Règle du canal",
      mode: "DELAY",
      delaySeconds: 600,
      gateMode: "REQUIRED",
      gateChannelIds: [channelId.casinoBonus],
      expireAfterHours: 72,
      expireAction: "DECLINE",
    },
    casinoBonus: { name: "Règle du canal", mode: "IMMEDIATE", delaySeconds: 0 },
    sportsFoot: { name: "Règle du canal", mode: "DELAY", delaySeconds: 300, expireAfterHours: 48 },
    sportsTest: { name: "Règle du canal", mode: "IMMEDIATE", delaySeconds: 0 },
    datingParis: {
      name: "Règle du canal",
      mode: "DELAY",
      delaySeconds: 900,
      gateMode: "SOFT",
      gateChannelIds: [channelId.datingLyon],
    },
    datingLyon: {
      name: "Validation à la main",
      mode: "MANUAL",
      delaySeconds: 0,
      expireAfterHours: 168,
    },
  };
  const ruleId = {} as Record<ChannelKey, string>;
  for (const c of CHANNELS) {
    const id = stableId(`rule:${c.key}`);
    ruleId[c.key] = id;
    await db.approvalRule.create({
      data: { id, channelId: channelId[c.key], isDefault: true, ...RULES[c.key] },
    });
  }

  // Offres Link Affi factices (programmes et campagnes Link Affi).
  const offerId = {} as Record<OfferKey, string>;
  const offerTemplate = {} as Record<OfferKey, string>;
  for (const p of PROGRAMS) {
    const programId = stableId(`program:${p.externalId}`);
    await db.affiliateProgram.create({
      data: {
        id: programId,
        name: p.name,
        vertical: p.vertical,
        source: "LINKAFFI",
        externalId: p.externalId,
        raw: { demo: true },
        createdAt: new Date(now.getTime() - 80 * DAY),
      },
    });
    for (const o of p.offers) {
      const id = stableId(`offer:${o.key}`);
      offerId[o.key] = id;
      offerTemplate[o.key] = `https://linkaffi.me/go/${o.campaignKey}?sub_id={subid}`;
      await db.affiliateCampaign.create({
        data: {
          id,
          programId,
          externalId: `demo-${o.campaignKey}`,
          campaignKey: o.campaignKey,
          name: o.name,
          vertical: p.vertical,
          trackingUrlTemplate: offerTemplate[o.key],
          raw: { demo: true, affiliate_id: p.affiliateId },
          createdAt: new Date(now.getTime() - 80 * DAY),
        },
      });
    }
  }

  // Campagnes, groupes de pubs, pubs (une pub = un lien d'entrée : invitation Telegram + lien goolink).
  const campaignIds: string[] = [];
  const ads: AdRec[] = [];
  const entryTracking: Prisma.TrackingLinkCreateManyInput[] = [];
  for (const [ci, c] of CAMPAIGNS.entries()) {
    const id = stableId(`campaign:${ci}`);
    campaignIds.push(id);
    await db.campaign.create({
      data: {
        id,
        name: c.name,
        vertical: c.vertical,
        channelIds: c.channels.map((k) => channelId[k]),
        affiliateCampaignIds: c.offers.map((k) => offerId[k]),
        adPlatform: c.platform,
        budgetDaily: c.budgetDaily,
        startAt: new Date(`${parisDayKey(dayStart(c.startDaysAgo))}T00:00:00.000Z`),
        endAt: null,
        status: c.status,
        notes: c.status === "PAUSED" ? "Pubs en pause : saison terminée (démonstration)." : null,
        createdAt: new Date(dayStart(c.startDaysAgo).getTime() - DAY),
      },
    });
    for (const s of c.adSets) {
      const adSetId = stableId(`adset:${ci}:${s.name}`);
      await db.adSet.create({ data: { id: adSetId, campaignId: id, name: s.name } });
      for (const adName of s.ads) {
        const inviteLinkId = stableId(`invite:${ci}:${s.name}:${adName}`);
        const trackingLinkId = stableId(`entry:${ci}:${s.name}:${adName}`);
        const label = `${c.name.slice(DEMO_PREFIX.length)} — ${adName}`.slice(0, 64);
        const invite = `https://t.me/+DEMO${shortId(14)}`;
        await db.inviteLink.create({
          data: {
            id: inviteLinkId,
            channelId: channelId[c.entry],
            botId: botIdByVertical[channelDef[c.entry].vertical],
            telegramInviteLink: invite,
            name: label,
            kind: "AD_ENTRY",
            createsJoinRequest: true,
            campaignId: id,
            adPlatform: c.platform,
            adCampaignName: c.name,
            adSetName: s.name,
            adName,
            createdById: users.admin,
            createdAt: new Date(dayStart(c.startDaysAgo).getTime() - DAY),
          },
        });
        entryTracking.push({
          id: trackingLinkId,
          slug: shortId(8),
          kind: "AD_ENTRY",
          destinationTemplate: invite,
          label,
          inviteLinkId,
          channelId: channelId[c.entry],
          campaignId: id,
          createdById: users.admin,
          createdAt: new Date(dayStart(c.startDaysAgo).getTime() - DAY),
        });
        ads.push({
          id: stableId(`ad:${ci}:${s.name}:${adName}`),
          campaignIndex: ci,
          adSetId,
          name: adName,
          inviteLinkId,
          trackingLinkId,
          platform: c.platform,
        });
      }
    }
  }
  await db.trackingLink.createMany({ data: entryTracking });
  await db.ad.createMany({
    data: ads.map((a) => ({
      id: a.id,
      adSetId: a.adSetId,
      name: a.name,
      inviteLinkId: a.inviteLinkId,
      trackingLinkId: a.trackingLinkId,
    })),
  });

  // Coûts des pubs sur 30 jours (import CSV ou saisie, selon la campagne).
  const importBatchId = stableId("import:tiktok");
  const costs: Prisma.AdCostCreateManyInput[] = [];
  for (const a of ads) {
    const c = CAMPAIGNS[a.campaignIndex]!;
    const perAd = c.budgetDaily / c.adSets.reduce((s, x) => s + x.ads.length, 0);
    for (let n = Math.min(29, c.startDaysAgo); n >= (c.stopDaysAgo ?? 0); n--) {
      const elapsed = n === 0 ? Math.min(1, (now.getTime() - todayStart.getTime()) / DAY) : 1;
      const spend = Math.round(perAd * (0.6 + r.next() * 0.8) * elapsed * 100) / 100;
      if (spend <= 0) continue;
      const impressions = Math.round(spend * r.int(90, 220));
      costs.push({
        adId: a.id,
        levelKey: `ad:${a.id}`,
        date: new Date(`${parisDayKey(dayStart(n))}T00:00:00.000Z`),
        spend,
        impressions,
        clicks: Math.round(impressions * (0.008 + r.next() * 0.012)),
        currency: "EUR",
        source: c.costSource,
        importBatchId: c.costSource === "CSV" ? importBatchId : null,
      });
    }
  }
  const csvRows = costs.filter((x) => x.source === "CSV").length;
  await db.importBatch.create({
    data: {
      id: importBatchId,
      kind: "TIKTOK_CSV",
      filename: "demo-tiktok-couts.csv",
      rows: csvRows,
      imported: csvRows,
      createdById: users.admin,
      createdAt: new Date(now.getTime() - 2 * HOUR),
    },
  });
  await inBatches(costs, 500, (chunk) => db.adCost.createMany({ data: chunk }));

  // Catégories de messages.
  const categoryIds: string[] = [];
  for (const [i, c] of CATEGORIES.entries()) {
    const id = stableId(`category:${c.slug}`);
    categoryIds.push(id);
    await db.messageCategory.create({
      data: { id, slug: c.slug, name: c.name, color: c.color, sortOrder: 100 + i },
    });
  }

  // Membres et adhésions (60 jours, dont aujourd'hui et hier) ; quelques demandes en attente.
  const members: MemberRec[] = [];
  const memberships: MembershipRec[] = [];
  const ruleOf = (k: ChannelKey) => RULES[k];
  const adsByEntry = (k: ChannelKey, at: Date) =>
    ads.filter((a) => {
      const c = CAMPAIGNS[a.campaignIndex]!;
      if (c.entry !== k) return false;
      if (at < dayStart(c.startDaysAgo)) return false;
      return c.stopDaysAgo === null || at < dayStart(c.stopDaysAgo - 1);
    });
  const sibling: Record<ChannelKey, ChannelKey | null> = {
    casinoVip: "casinoBonus",
    casinoBonus: "casinoVip",
    sportsFoot: null,
    sportsTest: null,
    datingParis: "datingLyon",
    datingLyon: "datingParis",
  };
  /** Adhésion acceptée selon la règle du canal (dates d'acceptation, d'entrée, éventuel départ). */
  const settled = (
    memberId: string,
    k: ChannelKey,
    requestedAt: Date,
    inviteLinkId: string | null,
  ): MembershipRec => {
    const rule = ruleOf(k);
    const base: MembershipRec = {
      id: newId(),
      code: shortId(8),
      memberId,
      channelKey: k,
      status: "APPROVED",
      inviteLinkId,
      requestedAt,
      gateSatisfiedAt: null,
      approveAt: null,
      approvedAt: null,
      declinedAt: null,
      joinedAt: null,
      leftAt: null,
      expiresAt: null,
      remindersSent: 0,
    };
    let approvedAt: Date;
    if (rule.mode === "IMMEDIATE")
      approvedAt = new Date(requestedAt.getTime() + r.int(1, 5) * 1000);
    else if (rule.mode === "MANUAL")
      approvedAt = new Date(requestedAt.getTime() + r.int(20, 600) * MIN);
    else {
      let start = requestedAt.getTime();
      if (rule.gateMode === "REQUIRED") {
        base.gateSatisfiedAt = new Date(start + r.int(1, 90) * MIN);
        start = base.gateSatisfiedAt.getTime();
      }
      approvedAt = new Date(start + (rule.delaySeconds ?? 0) * 1000 + r.int(0, 40) * 1000);
      base.approveAt = approvedAt;
    }
    const fate = r.next();
    if (fate < 0.03) {
      base.status = rule.mode === "MANUAL" ? "DECLINED" : "EXPIRED";
      if (base.status === "DECLINED") base.declinedAt = notFuture(approvedAt);
      base.approveAt = null;
      base.gateSatisfiedAt = null;
      return base;
    }
    base.approvedAt = notFuture(approvedAt);
    base.joinedAt = notFuture(new Date(base.approvedAt.getTime() + r.int(2, 90) * 1000));
    if (fate > 0.9 && now.getTime() - base.joinedAt.getTime() > 2 * DAY) {
      base.status = "LEFT";
      base.leftAt = between(new Date(base.joinedAt.getTime() + DAY), now);
    }
    return base;
  };

  const channelWeights = CHANNELS.map((c) => [c.key, c.weight] as const);
  const pendingPlan: Array<{
    k: ChannelKey;
    status: MembershipRec["status"];
    agoMin: [number, number];
  }> = [
    { k: "datingLyon", status: "REQUESTED", agoMin: [30, 2000] },
    { k: "datingLyon", status: "REQUESTED", agoMin: [30, 2000] },
    { k: "datingLyon", status: "REQUESTED", agoMin: [5, 600] },
    { k: "datingLyon", status: "REQUESTED", agoMin: [5, 300] },
    { k: "casinoVip", status: "PENDING_GATE", agoMin: [90, 1400] },
    { k: "casinoVip", status: "PENDING_GATE", agoMin: [20, 900] },
    { k: "casinoVip", status: "PENDING_GATE", agoMin: [10, 300] },
    { k: "casinoVip", status: "SCHEDULED", agoMin: [2, 6] },
    { k: "casinoVip", status: "SCHEDULED", agoMin: [2, 6] },
    { k: "sportsFoot", status: "SCHEDULED", agoMin: [1, 3] },
  ];
  for (let i = 0; i < MEMBER_COUNT; i++) {
    const tgId = DEMO_MEMBER_ID_BASE + BigInt(i + 1);
    const firstName = r.pick(FIRST_NAMES);
    const id = stableId(`member:${i}`);
    const pending = pendingPlan[i];
    let requestedAt: Date;
    let k: ChannelKey;
    if (pending) {
      k = pending.k;
      requestedAt = notFuture(
        new Date(now.getTime() - r.int(pending.agoMin[0], pending.agoMin[1]) * MIN),
      );
    } else {
      k = r.weighted(channelWeights);
      const daysAgo =
        i < 18 ? 0 : i < 30 ? 1 : Math.min(59, Math.floor(60 * Math.pow(r.next(), 1.3)));
      requestedAt = timeOnDay(daysAgo);
    }
    const lang = r.weighted(LANGUAGES);
    const m: MemberRec = {
      id,
      tgId,
      firstName,
      lastName: r.chance(0.4) ? `${LAST_INITIALS[r.int(0, LAST_INITIALS.length - 1)]}.` : null,
      username: r.chance(0.6)
        ? `${firstName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()}_${r.int(10, 9999)}`
        : null,
      languageCode: lang,
      isPremium: r.chance(0.1),
      firstSeenAt: new Date(requestedAt.getTime() - r.int(0, 30) * 1000),
      lastSeenAt: requestedAt,
      tags: new Set(),
    };
    members.push(m);
    const candidates = adsByEntry(k, requestedAt);
    const viaAd = candidates.length > 0 && r.chance(0.68) ? r.pick(candidates) : null;
    if (pending) {
      const rule = ruleOf(k);
      memberships.push({
        id: newId(),
        code: shortId(8),
        memberId: id,
        channelKey: k,
        status: pending.status,
        inviteLinkId: viaAd?.inviteLinkId ?? null,
        requestedAt,
        gateSatisfiedAt:
          pending.status === "SCHEDULED" && rule.gateMode === "REQUIRED" ? requestedAt : null,
        approveAt:
          pending.status === "SCHEDULED"
            ? new Date(requestedAt.getTime() + (rule.delaySeconds ?? 0) * 1000)
            : null,
        approvedAt: null,
        declinedAt: null,
        joinedAt: null,
        leftAt: null,
        expiresAt: rule.expireAfterHours
          ? new Date(requestedAt.getTime() + rule.expireAfterHours * HOUR)
          : null,
        remindersSent:
          pending.status === "PENDING_GATE" && now.getTime() - requestedAt.getTime() > HOUR ? 1 : 0,
      });
      continue;
    }
    const main = settled(id, k, requestedAt, viaAd?.inviteLinkId ?? null);
    memberships.push(main);
    // Une partie des membres rejoint aussi l'autre canal du même univers (canal à rejoindre d'abord, invitation).
    const other = sibling[k];
    if (other && main.joinedAt && r.chance(k === "casinoVip" ? 0.85 : 0.22)) {
      const at =
        k === "casinoVip"
          ? new Date(requestedAt.getTime() + r.int(1, 60) * MIN)
          : between(main.joinedAt, now);
      if (at.getTime() < now.getTime() - 2 * MIN) memberships.push(settled(id, other, at, null));
    }
  }
  const membershipsOf = new Map<string, MembershipRec[]>();
  for (const ms of memberships) {
    const list = membershipsOf.get(ms.memberId) ?? [];
    list.push(ms);
    membershipsOf.set(ms.memberId, list);
  }
  for (const m of members) {
    const list = membershipsOf.get(m.id) ?? [];
    const times = list.flatMap((x) => [x.requestedAt, x.joinedAt].filter((d): d is Date => !!d));
    m.firstSeenAt = new Date(Math.min(...times.map((d) => d.getTime())) - 5_000);
    m.lastSeenAt = new Date(Math.max(...times.map((d) => d.getTime())));
  }

  // Messages de canal envoyés (8 semaines) avec bouton Offre, test A/B, un message en échec ; messages programmés.
  const campaignOfChannel = (k: ChannelKey): number | null => {
    const i = CAMPAIGNS.findIndex((c) => c.channels.includes(k) && c.status === "ACTIVE");
    if (i >= 0) return i;
    const j = CAMPAIGNS.findIndex((c) => c.channels.includes(k));
    return j >= 0 ? j : null;
  };
  type PostRec = Prisma.PostCreateManyInput & {
    id: string;
    channelKey: ChannelKey;
    offerLinkId: string | null;
    offerKey: OfferKey | null;
  };
  const posts: PostRec[] = [];
  const offerLinks: Prisma.TrackingLinkCreateManyInput[] = [];
  let messageId = 1200;
  const makePost = (
    k: ChannelKey,
    at: Date,
    status: "SENT" | "SCHEDULED" | "DRAFT" | "FAILED",
    extra: Partial<PostRec> = {},
  ): PostRec => {
    const c = channelDef[k];
    const ci = campaignOfChannel(k);
    const id = newId();
    let buttons: Prisma.InputJsonValue = [];
    let offerLinkId: string | null = null;
    let offerKey: OfferKey | null = null;
    if (ci !== null && r.chance(0.78)) {
      const camp = CAMPAIGNS[ci]!;
      offerKey = r.pick(camp.offers);
      offerLinkId = newId();
      const slug = shortId(8);
      offerLinks.push({
        id: offerLinkId,
        slug,
        kind: "OFFER",
        destinationTemplate: offerTemplate[offerKey],
        label: `Offre — ${camp.name.slice(DEMO_PREFIX.length)}`.slice(0, 64),
        channelId: channelId[k],
        campaignId: campaignIds[ci]!,
        affiliateCampaignId: offerId[offerKey],
        postId: id,
        createdById: users.admin,
        createdAt: new Date(at.getTime() - DAY),
      });
      buttons = [
        [
          {
            text: c.vertical === "DATING" ? "Je m'inscris" : "J'en profite",
            type: "OFFER",
            trackingLinkId: offerLinkId,
            slug,
            affiliateCampaignId: offerId[offerKey],
            campaignId: campaignIds[ci]!,
          },
        ],
      ];
    }
    return {
      id,
      code: shortId(8),
      channelId: channelId[k],
      botId: botIdByVertical[c.vertical],
      status,
      scheduledAt: status === "DRAFT" ? null : at,
      sentAt: status === "SENT" ? new Date(at.getTime() + r.int(1, 20) * 1000) : null,
      telegramMessageIds: status === "SENT" ? [messageId++] : [],
      categoryId: r.chance(0.85) ? r.pick(categoryIds) : null,
      language: "fr",
      text: r.pick(TEXTS[c.vertical]),
      buttons,
      vertical: c.vertical,
      pinAfterSend: r.chance(0.08),
      createdById: users.admin,
      createdAt: new Date(Math.min(at.getTime(), now.getTime()) - r.int(2, 72) * HOUR),
      channelKey: k,
      offerLinkId,
      offerKey,
      ...extra,
    };
  };
  for (const c of CHANNELS) {
    for (let n = 55; n >= 0; n--) {
      if (!r.chance(c.isTest ? 0.1 : 0.55)) continue;
      const hour = r.pick(c.hours);
      const at = new Date(dayStart(n).getTime() + hour * HOUR + r.pick([0, 0, 15, 30]) * MIN);
      if (at.getTime() > now.getTime() - 20 * MIN) continue;
      posts.push(makePost(c.key, at, "SENT"));
    }
  }
  // Test A/B (deux variantes envoyées il y a 3 jours sur Casino VIP).
  const abGroupId = `demo-ab-${shortId(6)}`;
  const abAt = new Date(dayStart(3).getTime() + 19 * HOUR);
  posts.push(
    makePost("casinoVip", abAt, "SENT", { abGroupId, abVariant: "A", text: TEXTS.CASINO[0]! }),
  );
  posts.push(
    makePost("casinoVip", abAt, "SENT", { abGroupId, abVariant: "B", text: TEXTS.CASINO[1]! }),
  );
  // Message en échec (hier soir).
  posts.push(
    makePost("casinoBonus", new Date(dayStart(1).getTime() + 21 * HOUR), "FAILED", {
      lastError:
        "Telegram a refusé l'envoi : le bot n'est plus administrateur du canal (exemple de démonstration).",
      attempts: 3,
    }),
  );
  // Programmés : de maintenant à la fin de la semaine prochaine (dimanche soir, Paris).
  const weekday = ((new Date(todayStart.getTime() + 12 * HOUR).getUTCDay() + 6) % 7) + 1; // lundi = 1
  const daysLeft = 7 - weekday + 7;
  for (let n = 0; n <= daysLeft; n++) {
    const start = dayStart(-n);
    for (const c of CHANNELS) {
      if (!r.chance(c.isTest ? 0.15 : 0.8)) continue;
      const at = new Date(start.getTime() + r.pick(c.hours) * HOUR + r.pick([0, 30]) * MIN);
      if (at.getTime() < now.getTime() + 15 * MIN) continue;
      posts.push(makePost(c.key, at, "SCHEDULED"));
    }
  }
  posts.push(makePost("sportsFoot", new Date(dayStart(-2).getTime() + 12 * HOUR), "DRAFT"));
  posts.push(makePost("datingParis", new Date(dayStart(-3).getTime() + 21 * HOUR), "DRAFT"));
  await inBatches(posts, 200, (chunk) =>
    db.post.createMany({
      data: chunk.map(({ channelKey: _c, offerLinkId: _o, offerKey: _k, ...p }) => p),
    }),
  );
  await inBatches(offerLinks, 300, (chunk) => db.trackingLink.createMany({ data: chunk }));

  // Clics : entrée par les pubs (anonymes, avant la demande d'adhésion) et offres (un identifiant de suivi par membre et
  // par message), puis joueurs Link Affi rattachés.
  const clicks: ClickRec[] = [];
  const adByInvite = new Map(ads.map((a) => [a.inviteLinkId, a]));
  const clickIdParams = (platform: CampaignDef["platform"]) =>
    platform === "TIKTOK"
      ? { ttclid: shortId(20) }
      : platform === "META"
        ? { fbclid: shortId(20) }
        : {};
  for (const ms of memberships) {
    const ad = ms.inviteLinkId ? adByInvite.get(ms.inviteLinkId) : undefined;
    if (!ad) continue;
    clicks.push({
      id: newId(),
      trackingLinkId: ad.trackingLinkId,
      createdAt: new Date(ms.requestedAt.getTime() - r.int(20, 600) * 1000),
      isBot: false,
      country: "FR",
      utm: { source: ad.platform.toLowerCase(), campaign: CAMPAIGNS[ad.campaignIndex]!.name },
      ...clickIdParams(ad.platform),
    });
  }
  for (const ad of ads) {
    const c = CAMPAIGNS[ad.campaignIndex]!;
    for (let n = Math.min(29, c.startDaysAgo); n >= (c.stopDaysAgo ?? 0); n--) {
      const k = r.int(0, 4);
      for (let j = 0; j < k; j++)
        clicks.push({
          id: newId(),
          trackingLinkId: ad.trackingLinkId,
          createdAt: timeOnDay(n, 7, 23.9),
          isBot: r.chance(0.04),
          country: r.chance(0.9) ? "FR" : "BE",
          ...clickIdParams(ad.platform),
        });
    }
  }
  const memberById = new Map(members.map((m) => [m.id, m]));
  const insideAt = (k: ChannelKey, at: Date) =>
    memberships.filter(
      (ms) =>
        ms.channelKey === k && ms.joinedAt && ms.joinedAt < at && (!ms.leftAt || ms.leftAt > at),
    );
  const offerClickOf = new Map<string, ClickRec[]>(); // postId → clics offre
  const addOfferClick = (post: PostRec, memberId: string, at: Date): ClickRec => {
    const subId = newSubId();
    const click: ClickRec = {
      id: newId(),
      trackingLinkId: post.offerLinkId!,
      subId,
      memberId,
      postId: post.id,
      botId: post.botId,
      isBot: false,
      country: "FR",
      destination: fillUrlTemplate(offerTemplate[post.offerKey!], { subid: subId }),
      createdAt: at,
    };
    clicks.push(click);
    const list = offerClickOf.get(post.id) ?? [];
    list.push(click);
    offerClickOf.set(post.id, list);
    const m = memberById.get(memberId);
    if (m && at > m.lastSeenAt) m.lastSeenAt = at;
    return click;
  };
  const sentWithOffer = posts.filter((p) => p.status === "SENT" && p.offerLinkId && p.sentAt);
  for (const p of sentWithOffer) {
    const sentAt = p.sentAt as Date;
    const audience = insideAt(p.channelKey, sentAt);
    const share = p.abVariant === "B" ? 0.14 : p.abVariant === "A" ? 0.07 : 0.03 + r.next() * 0.08;
    const n = Math.min(audience.length, Math.round(audience.length * share));
    const chosen = new Set<string>();
    for (let j = 0; j < n * 3 && chosen.size < n; j++) chosen.add(r.pick(audience).memberId);
    for (const memberId of chosen)
      addOfferClick(
        p,
        memberId,
        notFuture(new Date(sentAt.getTime() + Math.pow(r.next(), 3) * 36 * HOUR + 30_000)),
      );
  }

  // Joueurs : une partie des cliqueurs s'inscrit, une partie fait un premier dépôt ; quelques-uns forcés aujourd'hui et
  // hier pour que l'accueil ait ses chiffres du jour.
  const plans: PlayerPlan[] = [];
  const offerKeyOfPost = new Map(posts.map((p) => [p.id, p.offerKey]));
  const usedClick = new Set<string>();
  for (const [postId, list] of offerClickOf) {
    const offerKey = offerKeyOfPost.get(postId);
    if (!offerKey) continue;
    for (const c of list) {
      if (!r.chance(0.22)) continue;
      const reg = notFuture(new Date(c.createdAt.getTime() + r.int(5, 30 * 60) * MIN));
      if (reg <= c.createdAt) continue;
      const ftdAt = r.chance(0.45)
        ? notFuture(new Date(reg.getTime() + r.int(3, 3 * 24 * 60) * MIN))
        : null;
      usedClick.add(c.id);
      plans.push({
        offerKey,
        click: c,
        memberId: c.memberId ?? null,
        registeredAt: reg,
        ftdAt: ftdAt && ftdAt > reg ? ftdAt : null,
        ngrAt: [],
        postId,
      });
    }
  }
  const recentWindow = (n: number): [Date, Date] => {
    const start = dayStart(n);
    const end = n === 0 ? new Date(now.getTime() - 2 * MIN) : dayStart(n - 1);
    return [start, end > start ? end : new Date(start.getTime() + MIN)];
  };
  for (const [n, ftds, regsOnly] of [
    [0, 3, 2],
    [1, 4, 2],
  ] as const) {
    const [start, end] = recentWindow(n);
    const width = end.getTime() - start.getTime();
    // Messages envoyés dans la semaine qui précède ce jour, tous canaux confondus.
    const recentPosts = sentWithOffer.filter(
      (p) => (p.sentAt as Date) < start && (p.sentAt as Date).getTime() > start.getTime() - 7 * DAY,
    );
    for (let j = 0; j < ftds + regsOnly && recentPosts.length > 0; j++) {
      const post = r.pick(recentPosts);
      const audience = insideAt(post.channelKey, start);
      if (audience.length === 0) break;
      const memberId = r.pick(audience).memberId;
      const clickAt = new Date(start.getTime() + width * (0.05 + 0.25 * r.next()));
      const click = addOfferClick(post, memberId, clickAt);
      usedClick.add(click.id);
      const reg = new Date(clickAt.getTime() + width * 0.15 * r.next() + 1000);
      const ftdAt = j < ftds ? new Date(reg.getTime() + width * 0.2 * r.next() + 1000) : null;
      plans.push({
        offerKey: post.offerKey!,
        click,
        memberId,
        registeredAt: reg,
        ftdAt,
        ngrAt: [],
        postId: post.id,
      });
    }
  }
  // Joueurs rattachés seulement par l'offre d'une campagne (sans clic à nous) et joueurs d'un autre affilié.
  for (let j = 0; j < 14; j++) {
    const offerKey = r.pick<OfferKey>(["casinoA", "sportsA", "datingA"]);
    const reg = timeOnDay(r.int(0, 58));
    plans.push({
      offerKey,
      click: null,
      memberId: null,
      registeredAt: reg,
      ftdAt: r.chance(0.5)
        ? notFuture(new Date(reg.getTime() + r.int(10, 2 * 24 * 60) * MIN))
        : null,
      ngrAt: [],
      postId: null,
    });
  }
  for (let j = 0; j < 6; j++) {
    const reg = timeOnDay(r.int(0, 50));
    plans.push({
      offerKey: "other",
      click: null,
      memberId: null,
      registeredAt: reg,
      ftdAt: notFuture(new Date(reg.getTime() + HOUR)),
      ngrAt: [],
      postId: null,
    });
  }
  // Revenu net daté aujourd'hui et hier pour une partie des déposants.
  for (const p of plans) {
    if (!p.ftdAt) continue;
    for (const n of [1, 0]) {
      const [start, end] = recentWindow(n);
      if (p.ftdAt < start && r.chance(0.45)) p.ngrAt.push(between(start, end));
    }
  }

  const players: Prisma.PlayerCreateManyInput[] = [];
  const playerEvents: Prisma.PlayerEventCreateManyInput[] = [];
  const events: Prisma.EventCreateManyInput[] = [];
  const postFigures = new Map<
    string,
    { registrations: number; ftds: number; deposits: number; depositAmount: number }
  >();
  for (const [i, p] of plans.entries()) {
    const playerId = newId();
    const ext = `demo-${String(i + 1).padStart(4, "0")}`;
    const evs: Array<{
      type: "REGISTRATION" | "FTD" | "DEPOSIT" | "NGR";
      amount: number | null;
      at: Date;
    }> = [{ type: "REGISTRATION", amount: null, at: p.registeredAt }];
    let depositTotal = 0;
    let deposits = 0;
    let ngr = 0;
    let ftdAmount: number | null = null;
    if (p.ftdAt) {
      ftdAmount = r.pick([20, 25, 30, 50, 50, 75, 100, 150, 200, 250]);
      evs.push({ type: "FTD", amount: ftdAmount, at: p.ftdAt });
      depositTotal += ftdAmount;
      deposits = 1;
      const extra = r.int(0, 5);
      for (let j = 0; j < extra; j++) {
        const at = between(p.ftdAt, now);
        if (at.getTime() >= now.getTime() - MIN) continue;
        const amount = r.pick([10, 20, 30, 50, 80, 100, 150]);
        evs.push({ type: "DEPOSIT", amount, at });
        depositTotal += amount;
        deposits++;
      }
      // Revenu net : un relevé tous les 2 à 4 jours depuis le premier dépôt, plus ceux d'aujourd'hui et d'hier.
      for (
        let t = p.ftdAt.getTime() + r.int(1, 3) * DAY;
        t < todayStart.getTime() - DAY;
        t += r.int(2, 4) * DAY
      ) {
        const amount = r.amount(-25, 70);
        evs.push({ type: "NGR", amount, at: new Date(t) });
        ngr += amount;
      }
      for (const at of p.ngrAt) {
        const amount = r.amount(-10, 45);
        evs.push({ type: "NGR", amount, at });
        ngr += amount;
      }
      if (depositTotal > 300 && p.memberId) memberById.get(p.memberId)?.tags.add("VIP");
      if (p.memberId) memberById.get(p.memberId)?.tags.add("Déposant");
    }
    const lastEventAt = new Date(Math.max(...evs.map((e) => e.at.getTime())));
    players.push({
      id: playerId,
      affiliateCampaignId: offerId[p.offerKey],
      externalPlayerId: ext,
      subId: p.click?.subId ?? null,
      subIdSource: p.click ? "postback" : null,
      clickId: p.click?.id ?? null,
      memberId: p.memberId,
      registeredAt: p.registeredAt,
      ftdAt: p.ftdAt,
      ftdAmount,
      depositCount: deposits,
      redepositCount: Math.max(0, deposits - 1),
      depositTotal: Math.round(depositTotal * 100) / 100,
      ngr: Math.round(ngr * 100) / 100,
      currency: "EUR",
      status: "active",
      lastEventAt,
      raw: { demo: true },
      createdAt: p.registeredAt,
    });
    for (const [j, e] of evs.entries())
      playerEvents.push({
        playerId,
        type: e.type,
        amount: e.amount,
        currency: e.amount === null ? null : "EUR",
        occurredAt: e.at,
        externalId: `${ext}-${e.type.toLowerCase()}-${j}`,
        raw: { demo: true },
      });
    if (p.memberId) {
      events.push({
        type: "player.registered",
        occurredAt: p.registeredAt,
        memberId: p.memberId,
        payload: { playerId, demo: true },
      });
      if (p.ftdAt)
        events.push({
          type: "player.ftd",
          occurredAt: p.ftdAt,
          memberId: p.memberId,
          payload: { playerId, amount: ftdAmount, demo: true },
        });
    }
    if (p.postId) {
      const f = postFigures.get(p.postId) ?? {
        registrations: 0,
        ftds: 0,
        deposits: 0,
        depositAmount: 0,
      };
      f.registrations++;
      if (p.ftdAt) f.ftds++;
      f.deposits += deposits;
      f.depositAmount += depositTotal;
      postFigures.set(p.postId, f);
    }
  }

  // Étiquettes : « À relancer » pour une partie des membres sans activité depuis 14 jours.
  for (const m of members)
    if (
      !m.tags.has("Déposant") &&
      now.getTime() - m.lastSeenAt.getTime() > 14 * DAY &&
      r.chance(0.3)
    )
      m.tags.add("À relancer");

  await inBatches(members, 500, (chunk) =>
    db.member.createMany({
      data: chunk.map((m) => ({
        id: m.id,
        telegramUserId: m.tgId,
        firstName: m.firstName,
        lastName: m.lastName,
        username: m.username,
        languageCode: m.languageCode,
        isPremium: m.isPremium,
        firstSeenAt: m.firstSeenAt,
        lastSeenAt: m.lastSeenAt,
        tags: [...m.tags],
      })),
    }),
  );
  const botStates: Prisma.MemberBotStateCreateManyInput[] = [];
  for (const m of members) {
    const verticals = new Set(
      (membershipsOf.get(m.id) ?? []).map((x) => channelDef[x.channelKey].vertical),
    );
    for (const v of verticals) {
      const blocked = r.chance(0.03);
      botStates.push({
        memberId: m.id,
        botId: botIdByVertical[v],
        canDm: !blocked && r.chance(0.93),
        startedAt: m.firstSeenAt,
        blockedAt: blocked ? between(m.firstSeenAt, now) : null,
        lastDmAt: m.lastSeenAt,
      });
    }
  }
  await inBatches(botStates, 500, (chunk) => db.memberBotState.createMany({ data: chunk }));

  const inviteById = new Map(ads.map((a) => [a.inviteLinkId, a]));
  await inBatches(memberships, 500, (chunk) =>
    db.membership.createMany({
      data: chunk.map((ms) => {
        const k = ms.channelKey;
        const ad = ms.inviteLinkId ? inviteById.get(ms.inviteLinkId) : undefined;
        const camp = ad ? CAMPAIGNS[ad.campaignIndex] : undefined;
        const rule = ruleOf(k);
        const code = ms.code;
        return {
          id: ms.id,
          code,
          memberId: ms.memberId,
          channelId: channelId[k],
          status: ms.status,
          inviteLinkId: ms.inviteLinkId,
          approvalRuleId: ruleId[k],
          requestedAt: ms.requestedAt,
          gateSatisfiedAt: ms.gateSatisfiedAt,
          approveAt: ms.approveAt,
          approvedAt: ms.approvedAt,
          declinedAt: ms.declinedAt,
          joinedAt: ms.joinedAt,
          leftAt: ms.leftAt,
          expiresAt: ms.expiresAt,
          approvedByBotId: ms.approvedAt ? botIdByVertical[channelDef[k].vertical] : null,
          remindersSent: ms.remindersSent,
          lastReminderAt: ms.remindersSent ? new Date(ms.requestedAt.getTime() + HOUR) : null,
          source: {
            demo: true,
            inviteLink: ad
              ? {
                  id: ad.inviteLinkId,
                  name: `${camp!.name.slice(DEMO_PREFIX.length)} — ${ad.name}`.slice(0, 64),
                  kind: "AD_ENTRY",
                  campaignId: campaignIds[ad.campaignIndex],
                  adPlatform: ad.platform,
                  adCampaignName: camp!.name,
                  adName: ad.name,
                }
              : null,
            rule: {
              id: ruleId[k],
              name: rule.name,
              mode: rule.mode,
              delaySeconds: rule.delaySeconds,
              gateMode: rule.gateMode ?? "NONE",
            },
            gates: [],
            startUrl: `https://t.me/${botUsername[channelDef[k].vertical]}?start=g${code}`,
            botId: botIdByVertical[channelDef[k].vertical],
          },
        };
      }),
    }),
  );

  // Compteurs dénormalisés des liens d'entrée et des liens traqués.
  for (const a of ads) {
    const list = memberships.filter((ms) => ms.inviteLinkId === a.inviteLinkId);
    await db.inviteLink.update({
      where: { id: a.inviteLinkId },
      data: {
        requests: list.length,
        approved: list.filter((x) => x.approvedAt).length,
        joined: list.filter((x) => x.joinedAt).length,
        left: list.filter((x) => x.leftAt).length,
      },
    });
  }
  await inBatches(clicks, 500, (chunk) => db.click.createMany({ data: chunk.map((c) => c) }));
  const clicksByLink = new Map<string, ClickRec[]>();
  for (const c of clicks) {
    if (c.isBot) continue;
    const list = clicksByLink.get(c.trackingLinkId) ?? [];
    list.push(c);
    clicksByLink.set(c.trackingLinkId, list);
  }
  for (const [linkId, list] of clicksByLink) {
    const unique = new Set(list.map((c) => c.memberId ?? c.id)).size;
    await db.trackingLink.update({
      where: { id: linkId },
      data: { clicks: list.length, uniqueClicks: unique },
    });
  }
  await inBatches(players, 500, (chunk) => db.player.createMany({ data: chunk }));
  await inBatches(playerEvents, 1000, (chunk) => db.playerEvent.createMany({ data: chunk }));

  // Chiffres des messages envoyés (vues, réactions, clics, joueurs).
  const stats: Prisma.PostStatsCreateManyInput[] = [];
  for (const p of posts.filter((x) => x.status === "SENT")) {
    const audience = insideAt(p.channelKey, p.sentAt as Date).length;
    const views = Math.max(3, Math.round(audience * (0.45 + r.next() * 0.45)));
    const offer = offerClickOf.get(p.id) ?? [];
    const f = postFigures.get(p.id) ?? { registrations: 0, ftds: 0, deposits: 0, depositAmount: 0 };
    const fire = Math.round(views * r.next() * 0.06);
    const like = Math.round(views * r.next() * 0.05);
    stats.push({
      postId: p.id,
      views,
      forwards: Math.round(views * r.next() * 0.02),
      reactions: { "🔥": fire, "👍": like },
      reactionsTotal: fire + like,
      clicks: offer.length + r.int(0, 2),
      uniqueClickers: new Set(offer.map((c) => c.memberId)).size,
      offerClicks: offer.length,
      registrations: f.registrations,
      ftds: f.ftds,
      deposits: f.deposits,
      depositAmount: Math.round(f.depositAmount * 100) / 100,
    });
  }
  await inBatches(stats, 500, (chunk) => db.postStats.createMany({ data: chunk }));

  // Messages privés : accueil à la demande, message « accepté » à l'entrée.
  const outbound: Prisma.OutboundMessageCreateManyInput[] = [];
  for (const ms of memberships) {
    const v = channelDef[ms.channelKey].vertical;
    const m = memberById.get(ms.memberId)!;
    outbound.push({
      botId: botIdByVertical[v],
      memberId: ms.memberId,
      kind: "WELCOME",
      text: `Bonjour ${m.firstName} ! Votre demande pour ${channelDef[ms.channelKey].title} est bien reçue.`,
      status: "SENT",
      queuedAt: ms.requestedAt,
      sentAt: new Date(ms.requestedAt.getTime() + 2_000),
      telegramMessageId: r.int(100, 99_999),
    });
    if (ms.approvedAt)
      outbound.push({
        botId: botIdByVertical[v],
        memberId: ms.memberId,
        kind: "ACCEPTED",
        text: `C'est fait, ${m.firstName} : vous êtes dans ${channelDef[ms.channelKey].title}.`,
        status: "SENT",
        queuedAt: ms.approvedAt,
        sentAt: new Date(ms.approvedAt.getTime() + 1_500),
        telegramMessageId: r.int(100, 99_999),
      });
  }

  // Envois groupés : brouillon, programmé, envoyé, et un test A/B envoyé.
  const datingTargets = memberships
    .filter((ms) => ms.channelKey === "datingParis" && ms.status === "APPROVED")
    .map((ms) => ms.memberId);
  const sentBroadcastId = newId();
  const sentAt = new Date(dayStart(5).getTime() + 19 * HOUR);
  const outcomes = datingTargets.map((_, i) =>
    i % 29 === 3 ? "FAILED" : i % 23 === 5 ? "BLOCKED" : "SENT",
  );
  const broadcastText =
    "Nouveau : le canal <b>Rencontres Lyon</b> est ouvert. Rejoignez-le en un clic.";
  const broadcastAbId = `demo-ab-${shortId(6)}`;
  const casinoTargets = memberships
    .filter((ms) => ms.channelKey === "casinoVip" && ms.status === "APPROVED")
    .map((ms) => ms.memberId);
  const abSize = Math.min(25, Math.floor(casinoTargets.length / 2));
  const nextDay18 = new Date(dayStart(-2).getTime() + 18 * HOUR);
  await db.broadcast.createMany({
    data: [
      {
        name: `${DEMO_PREFIX}Bonus du week-end`,
        botId: botIdByVertical.CASINO,
        segment: { channelIds: [channelId.casinoVip], membershipStatuses: ["APPROVED"] },
        text: "Ce week-end, bonus doublé sur votre prochain dépôt.\n\n" + RISK,
        status: "DRAFT",
        createdById: users.admin,
        createdAt: new Date(now.getTime() - 3 * HOUR),
      },
      {
        name: `${DEMO_PREFIX}Relance des inactifs (7 jours)`,
        botId: botIdByVertical.SPORTS,
        segment: { channelIds: [channelId.sportsFoot], inactiveDays: 7 },
        text: "Cela fait une semaine ! Le prono du jour vous attend dans le canal.\n\n" + RISK,
        status: "SCHEDULED",
        scheduledAt: nextDay18,
        createdById: users.admin,
        createdAt: new Date(now.getTime() - DAY),
      },
      {
        id: sentBroadcastId,
        name: `${DEMO_PREFIX}Nouveau canal Lyon`,
        botId: botIdByVertical.DATING,
        segment: { channelIds: [channelId.datingParis] },
        text: broadcastText,
        status: "SENT",
        scheduledAt: sentAt,
        startedAt: sentAt,
        finishedAt: new Date(sentAt.getTime() + 4 * MIN),
        targeted: datingTargets.length,
        sent: outcomes.filter((o) => o === "SENT").length,
        failed: outcomes.filter((o) => o === "FAILED").length,
        blocked: outcomes.filter((o) => o === "BLOCKED").length,
        createdById: users.admin,
        createdAt: new Date(sentAt.getTime() - DAY),
      },
      ...(["A", "B"] as const).map((variant, vi) => ({
        name: `${DEMO_PREFIX}Test A/B relance casino — ${variant}`,
        botId: botIdByVertical.CASINO,
        segment: { channelIds: [channelId.casinoVip], membershipStatuses: ["APPROVED"] },
        text:
          variant === "A"
            ? "Votre bonus vous attend : activez-le avant dimanche.\n\n" + RISK
            : "Dernier rappel : 50 tours offerts jusqu'à dimanche minuit.\n\n" + RISK,
        status: "SENT" as const,
        scheduledAt: new Date(dayStart(2).getTime() + 18 * HOUR),
        startedAt: new Date(dayStart(2).getTime() + 18 * HOUR),
        finishedAt: new Date(dayStart(2).getTime() + 18 * HOUR + 2 * MIN),
        targeted: abSize,
        sent: abSize - vi,
        failed: vi,
        abGroupId: broadcastAbId,
        abVariant: variant,
        // Même taille pour A et B : moitié du groupe chacune (l'action réelle enregistre split et 100 − split).
        abSplit: 50,
        createdById: users.admin,
        createdAt: new Date(dayStart(3).getTime()),
      })),
    ],
  });
  datingTargets.forEach((memberId, i) => {
    const status = outcomes[i] as "SENT" | "FAILED" | "BLOCKED";
    outbound.push({
      botId: botIdByVertical.DATING,
      memberId,
      kind: "BROADCAST",
      broadcastId: sentBroadcastId,
      text: broadcastText,
      status,
      error:
        status === "SENT"
          ? null
          : status === "BLOCKED"
            ? "Le membre a bloqué le bot."
            : "Erreur Telegram (démonstration).",
      queuedAt: sentAt,
      sentAt: status === "SENT" ? new Date(sentAt.getTime() + i * 1100) : null,
      telegramMessageId: status === "SENT" ? r.int(100, 99_999) : null,
    });
  });
  await inBatches(outbound, 1000, (chunk) => db.outboundMessage.createMany({ data: chunk }));

  // Relances automatiques (inactives : rien ne part tant que l'équipe ne les allume pas).
  await db.automationRule.createMany({
    data: [
      {
        name: `${DEMO_PREFIX}Relance 24 h après l'entrée`,
        trigger: "JOINED",
        conditions: {},
        actions: [
          { type: "wait", hours: 24 },
          {
            type: "send_message",
            text: "Bonjour {prenom} ! Vous avez rejoint {canal} hier : l'offre du moment vous attend toujours.",
          },
        ],
        isActive: false,
        createdById: users.admin,
        createdAt: new Date(now.getTime() - 9 * DAY),
      },
      {
        name: `${DEMO_PREFIX}Merci après le premier dépôt`,
        trigger: "DEPOSITED",
        conditions: {},
        actions: [
          {
            type: "send_message",
            text: "Merci {prenom} ! Votre dépôt est bien pris en compte. Bonne chance !",
          },
          { type: "tag", tag: "Déposant" },
          { type: "notify_team", text: "Nouveau premier dépôt détecté." },
        ],
        isActive: false,
        createdById: users.admin,
        createdAt: new Date(now.getTime() - 8 * DAY),
      },
    ],
  });

  // Journal des événements (adhésions, clics d'offre ; les joueurs sont plus haut).
  for (const ms of memberships) {
    const base = {
      memberId: ms.memberId,
      channelId: channelId[ms.channelKey],
      botId: botIdByVertical[channelDef[ms.channelKey].vertical],
    };
    events.push({
      ...base,
      type: "membership.requested",
      occurredAt: ms.requestedAt,
      payload: { membershipId: ms.id, inviteLinkId: ms.inviteLinkId, demo: true },
    });
    if (ms.approvedAt)
      events.push({
        ...base,
        type: "membership.approved",
        occurredAt: ms.approvedAt,
        payload: { membershipId: ms.id, demo: true },
      });
    if (ms.joinedAt)
      events.push({
        ...base,
        type: "membership.joined",
        occurredAt: ms.joinedAt,
        payload: { membershipId: ms.id, demo: true },
      });
    if (ms.declinedAt)
      events.push({
        ...base,
        type: "membership.declined",
        occurredAt: ms.declinedAt,
        payload: { membershipId: ms.id, demo: true },
      });
  }
  for (const c of clicks)
    if (c.subId && c.memberId)
      events.push({
        type: "click.offer",
        occurredAt: c.createdAt,
        memberId: c.memberId,
        botId: c.botId ?? null,
        payload: { clickId: c.id, postId: c.postId, subId: c.subId, demo: true },
      });
  for (const p of posts.filter((x) => x.status === "SENT"))
    events.push({
      type: "post.sent",
      occurredAt: p.sentAt as Date,
      channelId: p.channelId,
      botId: p.botId,
      payload: { postId: p.id, demo: true },
    });
  await inBatches(events, 1000, (chunk) => db.event.createMany({ data: chunk }));

  // Phase 11 : règles selon la provenance, sur trois canaux qui reproduisent le cas du client.
  const phase11 = await createPhase11Demo(db, {
    now,
    adminId: users.admin,
    botIdByVertical,
    botUsername,
    members: members.map((m) => ({ id: m.id, firstSeenAt: m.firstSeenAt })),
  });

  // Phase 13 : campagnes Telegram des affiliés Link Affi (deux affiliés, trois campagnes, leurs membres et joueurs).
  const phase13 = await createPhase13Demo(db, {
    now,
    botIdByVertical,
    channelId,
    channelTitle: Object.fromEntries(CHANNELS.map((c) => [c.key, c.title])) as Record<
      ChannelKey,
      string
    >,
    channelVertical: Object.fromEntries(CHANNELS.map((c) => [c.key, c.vertical])) as Record<
      ChannelKey,
      Vertical
    >,
    offerId,
    offerTemplate,
    campaignIdOfChannel: (k) => {
      const i = campaignOfChannel(k);
      return i === null ? null : campaignIds[i]!;
    },
  });

  // Phase 15 : pages d'atterrissage (deux pages, leurs sources, visites, clics, ouvertures de Telegram, demandes).
  const phase15 = await createPhase15Demo(db, {
    now,
    adminId: users.admin,
    botIdByVertical,
    channelId,
    channelTitle: Object.fromEntries(CHANNELS.map((c) => [c.key, c.title])) as Record<
      ChannelKey,
      string
    >,
    channelVertical: Object.fromEntries(CHANNELS.map((c) => [c.key, c.vertical])) as Record<
      ChannelKey,
      Vertical
    >,
    ruleIdOf: (k) => ruleId[k],
    adOf: (campaignIndex, adName) => {
      const a = ads.find((x) => x.campaignIndex === campaignIndex && x.name === adName);
      return a ? { id: a.id, campaignId: campaignIds[campaignIndex]! } : null;
    },
  });

  // Phase 17 : assistant de conversation (bot assistant, persona « Léa », réglage sans clé, six conversations).
  // Personnes : membres de démonstration francophones, entrés dans un canal Rencontres il y a 7 à 59 jours, sans joueur.
  const datingJoined = new Set(
    memberships
      .filter(
        (ms) =>
          (ms.channelKey === "datingParis" || ms.channelKey === "datingLyon") &&
          ms.joinedAt &&
          !ms.leftAt,
      )
      .map((ms) => ms.memberId),
  );
  const withPlayer = new Set(players.map((p) => p.memberId).filter(Boolean));
  const datingCampaign = CAMPAIGNS.findIndex((c) => c.vertical === "DATING");
  const phase17 = await createPhase17Demo(db, {
    now,
    key: ctx.key,
    adminId: users.admin,
    managerId: users.manager,
    offerId: offerId.datingA,
    offerTemplate: offerTemplate.datingA,
    campaignId: datingCampaign === -1 ? null : campaignIds[datingCampaign]!,
    members: members
      .filter(
        (m) =>
          !withPlayer.has(m.id) &&
          now.getTime() - m.firstSeenAt.getTime() > 7 * DAY &&
          now.getTime() - m.firstSeenAt.getTime() < 59 * DAY,
      )
      .map((m) => ({
        id: m.id,
        tgId: m.tgId,
        firstName: m.firstName,
        languageCode: m.languageCode,
        dating: datingJoined.has(m.id),
      })),
  });

  // Étiquettes du registre (ajoutées sans rien retirer) et état de la synchronisation Link Affi (si absent).
  const regValue = (await db.setting.findUnique({ where: { key: "members.tags" } }))?.value;
  const registry = Array.isArray(regValue)
    ? (regValue as Array<{ name?: unknown; color?: unknown }>)
    : [];
  const known = new Set(registry.map((t) => String(t.name ?? "").toLowerCase()));
  const nextRegistry = [
    ...registry,
    ...TAGS.filter((t) => !known.has(t.name.toLowerCase())).map((t) => ({ ...t })),
  ];
  await db.setting.upsert({
    where: { key: "members.tags" },
    create: { key: "members.tags", value: nextRegistry as Prisma.InputJsonValue },
    update: { value: nextRegistry as Prisma.InputJsonValue },
  });
  const syncAt = new Date(now.getTime() - 2 * MIN);
  for (const table of [
    "casinos",
    "campaigns",
    "currency_rates",
    "players",
    "player_events",
    "player_financials",
  ]) {
    const exists = await db.syncState.findUnique({ where: { source: table } });
    if (!exists)
      await db.syncState.create({
        data: { source: table, lastRunAt: syncAt, lastSuccessAt: syncAt, rowsImported: 0 },
      });
  }
  await db.auditLog.create({
    data: {
      userId: users.admin,
      action: "maintenance.demo_seed",
      entityType: "System",
      metadata: {
        members: members.length,
        posts: posts.length,
        players: players.length,
        local: true,
      },
    },
  });

  return {
    channelIds: [...Object.values(channelId), ...phase11.channelIds],
    counts: {
      bots: BOTS.length + 1, // + le bot de l'assistante (phase 17)
      canaux: CHANNELS.length + phase11.channelIds.length,
      campagnes: CAMPAIGNS.length,
      pubs: ads.length,
      "coûts (jours × pubs)": costs.length,
      membres: members.length,
      adhésions: memberships.length,
      "demandes en attente": memberships.filter((m) =>
        ["REQUESTED", "PENDING_GATE", "SCHEDULED"].includes(m.status),
      ).length,
      "messages envoyés": posts.filter((p) => p.status === "SENT").length,
      "messages programmés": posts.filter((p) => p.status === "SCHEDULED").length,
      clics: clicks.length,
      joueurs: players.length,
      "événements joueurs": playerEvents.length,
      "premiers dépôts aujourd'hui": plans.filter((p) => p.ftdAt && p.ftdAt >= todayStart).length,
      "événements du journal": events.length,
      "messages privés": outbound.length,
      "phase 11 : exceptions selon la provenance": phase11.exceptions,
      "phase 11 : liens de partage": phase11.shareLinks,
      "phase 13 : campagnes d'affiliés Link Affi": phase13.campaigns,
      "phase 13 : membres d'affiliés": phase13.members,
      "phase 13 : clics d'offre avec la campagne": phase13.clicks,
      "phase 13 : joueurs d'affiliés": phase13.players,
      "phase 13 : premiers dépôts d'affiliés": phase13.ftds,
      "phase 13 : événements transmis à Link Affi": phase13.linkaffiEvents,
      "phase 11 : demandes avec provenance": phase11.memberships,
      "phase 14 : demandes venues des pubs TikTok (Zone Interdite)": phase11.phase14.requests,
      "phase 14 : encore « Attend les canaux »": phase11.phase14.pending,
      "phase 14 : ont bloqué le bot": phase11.phase14.blocked,
      "phase 14 : messages refusés sans blocage": phase11.phase14.refused,
      "phase 15 : pages d'atterrissage": phase15.pages,
      "phase 15 : sources (liens à coller)": phase15.sources,
      "phase 15 : visites, clics et ouvertures": phase15.events,
      "phase 15 : demandes venues des pages": phase15.memberships,
      "phase 16 : aides « Ouvrir dans le navigateur » affichées": phase15.help,
      "phase 16 : visites sorties de l'appli vers Safari ou Chrome": phase15.escaped,
      "phase 17 : conversations de l'assistante « Léa »": phase17.conversations,
      "phase 17 : messages de conversation": phase17.messages,
      "phase 17 : liens de l'offre envoyés": phase17.offerLinks,
      "phase 17 : coûts de l'IA enregistrés": phase17.usages,
    },
  };
}

// ============================================================
// Phase 11 : règles d'acceptation selon la provenance (cas du client du 11 octobre)
// ============================================================
//
// « Zone Interdite 🔞 » exige « Zone Roulette » et « Tir Cadré », puis 5 minutes ; sauf les personnes venues de
// « Tir Cadré » (son bouton « canal à rejoindre », ou un lien de partage posté dans Tir Cadré) : 1 jour. « Tir Cadré »
// exige « Zone Interdite ». Chaque canal à rejoindre a l'exception de la reprise (`pnpm db:phase11`) : venu du bouton
// « canal à rejoindre » d'un de nos canaux → tout de suite, sans message. Deux liens de partage sur Zone Interdite
// (« Post Tir Cadré » posté dans Tir Cadré, « Story Instagram » avec sa propre exception → 1 heure), une pub TikTok,
// et des demandes sur 30 jours avec la provenance et la règle appliquée enregistrées comme le fait le bot.
// Tirage à part (graine propre) : les données des autres canaux restent exactement les mêmes.

type P11Key = "zone" | "tir" | "roulette";

const P11_CHANNELS: ReadonlyArray<{
  key: P11Key;
  title: string;
  vertical: Vertical;
  chatId: bigint;
}> = [
  {
    key: "zone",
    title: `${DEMO_PREFIX}Zone Interdite 🔞`,
    vertical: "DATING",
    chatId: DEMO_CHAT_IDS[6]!,
  },
  { key: "tir", title: `${DEMO_PREFIX}Tir Cadré`, vertical: "SPORTS", chatId: DEMO_CHAT_IDS[7]! },
  {
    key: "roulette",
    title: `${DEMO_PREFIX}Zone Roulette`,
    vertical: "CASINO",
    chatId: DEMO_CHAT_IDS[8]!,
  },
];

/** Espaces insécables dans les guillemets (comme les libellés enregistrés par l'écran des exceptions). */
function frQuotesDemo(text: string): string {
  return text.replace(/\u00ab /g, "\u00ab\u00a0").replace(/ \u00bb/g, "\u00a0\u00bb");
}

type P11Rule = {
  id: string;
  channel: P11Key;
  scope: "DEFAULT" | "INVITE_LINK" | "SOURCE_CHANNEL" | "SOURCE_KIND";
  label: string | null;
  name: string;
  mode: "IMMEDIATE" | "DELAY" | "MANUAL";
  delaySeconds: number;
  gateMode: "NONE" | "REQUIRED";
  gates: P11Key[];
  sendWelcome: boolean;
};

type P11Link = ProvenanceLink & {
  name: string;
  url: string;
  channel: P11Key;
  /** Nom de la pub (lien d'entrée d'une pub). */
  adName?: string;
};

async function createPhase11Demo(
  db: Db,
  ctx: {
    now: Date;
    adminId: string;
    botIdByVertical: Record<Vertical, string>;
    botUsername: Record<Vertical, string>;
    members: Array<{ id: string; firstSeenAt: Date }>;
  },
): Promise<{
  channelIds: string[];
  exceptions: number;
  shareLinks: number;
  memberships: number;
  phase14: { requests: number; blocked: number; refused: number; pending: number };
}> {
  const { now } = ctx;
  const r = createRandom(SEED + 11);
  const id = {} as Record<P11Key, string>;
  const title = {} as Record<P11Key, string>;
  const botOf = {} as Record<P11Key, string>;
  for (const c of P11_CHANNELS) {
    id[c.key] = stableId(`p11:channel:${c.key}`);
    title[c.key] = c.title;
    botOf[c.key] = ctx.botIdByVertical[c.vertical];
    await db.channel.create({
      data: {
        id: id[c.key],
        telegramChatId: c.chatId,
        title: c.title,
        username: null,
        type: "CHANNEL",
        vertical: c.vertical,
        language: "fr",
        primaryBotId: botOf[c.key],
        isTest: false,
        createdAt: new Date(now.getTime() - 45 * DAY),
      },
    });
    await db.channelBotAdmin.create({
      data: {
        channelId: id[c.key],
        botId: botOf[c.key],
        detectedAt: new Date(now.getTime() - 45 * DAY),
        rights: {
          status: "administrator",
          can_post_messages: true,
          can_edit_messages: true,
          can_delete_messages: true,
          can_invite_users: true,
          can_manage_chat: true,
          can_restrict_members: true,
          can_promote_members: false,
          can_change_info: true,
        },
      },
    });
  }

  // Liens : boutons « canal à rejoindre » (avec demande d'adhésion, phase 11), deux liens de partage, une pub TikTok.
  const link = (
    key: string,
    channel: P11Key,
    data: Omit<P11Link, "id" | "url" | "channel">,
  ): P11Link => ({
    ...data,
    id: stableId(`p11:link:${key}`),
    url: `https://t.me/+DEMO11${key.replace(/[^a-z]/gi, "").slice(0, 12)}${shortId(6)}`,
    channel,
  });
  const L = {
    zoneFromTir: link("zone-from-tir", "zone", {
      kind: "GATE",
      sourceChannelId: id.tir,
      adPlatform: null,
      name: `Canal à rejoindre de ${title.tir}`,
    }),
    tirFromZone: link("tir-from-zone", "tir", {
      kind: "GATE",
      sourceChannelId: id.zone,
      adPlatform: null,
      name: `Canal à rejoindre de ${title.zone}`,
    }),
    rouletteFromZone: link("roulette-from-zone", "roulette", {
      kind: "GATE",
      sourceChannelId: id.zone,
      adPlatform: null,
      name: `Canal à rejoindre de ${title.zone}`,
    }),
    sharePost: link("share-post", "zone", {
      kind: "SHARE",
      sourceChannelId: id.tir,
      adPlatform: null,
      name: "Post Tir Cadré",
    }),
    shareStory: link("share-story", "zone", {
      kind: "SHARE",
      sourceChannelId: null,
      adPlatform: null,
      name: "Story Instagram",
    }),
    tiktok: link("tiktok", "zone", {
      kind: "AD_ENTRY",
      sourceChannelId: null,
      adPlatform: "TIKTOK",
      name: "Zone Interdite — Pub TikTok 1",
      adName: "Pub 1",
    }),
    // Phase 14 : seconde pub TikTok du trafic du 14 octobre (parcours des demandes par pub).
    tiktok2: link("tiktok-2", "zone", {
      kind: "AD_ENTRY",
      sourceChannelId: null,
      adPlatform: "TIKTOK",
      name: "Zone Interdite — Pub TikTok 2",
      adName: "Pub 2",
    }),
  };
  for (const l of Object.values(L))
    await db.inviteLink.create({
      data: {
        id: l.id,
        channelId: id[l.channel],
        botId: botOf[l.channel],
        telegramInviteLink: l.url,
        name: l.name,
        kind: l.kind,
        createsJoinRequest: true,
        sourceChannelId: l.sourceChannelId,
        adPlatform: l.kind === "AD_ENTRY" ? "TIKTOK" : null,
        adName: l.adName ?? null,
        createdById: l.kind === "GATE" ? null : ctx.adminId,
        createdAt: new Date(now.getTime() - (l.id === L.tiktok2.id ? 2 : 40) * DAY),
      },
    });

  // Règles : par défaut, exceptions selon la provenance (libellés comme l'écran les enregistre).
  const gateLabel = frQuotesDemo(GATE_EXCEPTION_LABEL);
  const rules: Record<string, P11Rule> = {
    zoneDefault: {
      id: stableId("p11:rule:zone:default"),
      channel: "zone",
      scope: "DEFAULT",
      label: null,
      name: "Règle du canal",
      mode: "DELAY",
      delaySeconds: 300,
      gateMode: "REQUIRED",
      gates: ["roulette", "tir"],
      sendWelcome: true,
    },
    zoneFromTir: {
      id: stableId("p11:rule:zone:from-tir"),
      channel: "zone",
      scope: "SOURCE_CHANNEL",
      label: frQuotesDemo(`Venu de « ${title.tir} »`),
      name: frQuotesDemo(`Venu de « ${title.tir} »`),
      mode: "DELAY",
      delaySeconds: 86_400,
      gateMode: "NONE",
      gates: [],
      sendWelcome: true,
    },
    zoneStory: {
      id: stableId("p11:rule:zone:story"),
      channel: "zone",
      scope: "INVITE_LINK",
      label: frQuotesDemo(`Venu du lien « ${L.shareStory.name} »`),
      name: frQuotesDemo(`Venu du lien « ${L.shareStory.name} »`),
      mode: "DELAY",
      delaySeconds: 3_600,
      gateMode: "NONE",
      gates: [],
      sendWelcome: true,
    },
    tirDefault: {
      id: stableId("p11:rule:tir:default"),
      channel: "tir",
      scope: "DEFAULT",
      label: null,
      name: "Règle du canal",
      mode: "DELAY",
      delaySeconds: 0,
      gateMode: "REQUIRED",
      gates: ["zone"],
      sendWelcome: true,
    },
    rouletteDefault: {
      id: stableId("p11:rule:roulette:default"),
      channel: "roulette",
      scope: "DEFAULT",
      label: null,
      name: "Règle du canal",
      mode: "IMMEDIATE",
      delaySeconds: 0,
      gateMode: "NONE",
      gates: [],
      sendWelcome: true,
    },
  };
  // Exception de la reprise sur chaque canal à rejoindre : venu du bouton « canal à rejoindre » → tout de suite, sans
  // message (comportement des anciens liens à entrée directe).
  for (const k of ["zone", "tir", "roulette"] as const)
    rules[`${k}Gate`] = {
      id: stableId(`p11:rule:${k}:gate`),
      channel: k,
      scope: "SOURCE_KIND",
      label: gateLabel,
      name: gateLabel,
      mode: "IMMEDIATE",
      delaySeconds: 0,
      gateMode: "NONE",
      gates: [],
      sendWelcome: false,
    };
  for (const rule of Object.values(rules))
    await db.approvalRule.create({
      data: {
        id: rule.id,
        channelId: id[rule.channel],
        name: rule.name,
        label: rule.label,
        isDefault: rule.scope === "DEFAULT",
        scope: rule.scope,
        sourceChannelId: rule.scope === "SOURCE_CHANNEL" ? id.tir : null,
        sourceKind: rule.scope === "SOURCE_KIND" ? "GATE" : null,
        inviteLinkId: rule.scope === "INVITE_LINK" ? L.shareStory.id : null,
        sortOrder: rule.scope === "DEFAULT" ? 0 : 10,
        sendWelcome: rule.sendWelcome,
        sendAcceptedMessage: rule.sendWelcome,
        mode: rule.mode,
        delaySeconds: rule.delaySeconds,
        gateMode: rule.gateMode,
        gateChannelIds: rule.gates.map((g) => id[g]),
        reminderAfterMinutes: rule.gateMode === "REQUIRED" ? [60, 1440] : [],
        maxReminders: rule.gateMode === "REQUIRED" ? 2 : 0,
        expireAfterHours: rule.gateMode === "REQUIRED" ? 72 : null,
        expireAction: "KEEP",
        createdAt: new Date(now.getTime() - 40 * DAY),
      },
    });

  // Demandes : chaque personne suit un parcours réel du flux d'adhésion.
  type Status = "REQUESTED" | "PENDING_GATE" | "SCHEDULED" | "APPROVED" | "LEFT";
  const rows: Prisma.MembershipCreateManyInput[] = [];
  const events: Prisma.EventCreateManyInput[] = [];
  // Messages privés du bot (phase 14 : accueil de chaque demande, rappels, « Canaux rejoints », « Accepté »).
  const outbound: Prisma.OutboundMessageCreateManyInput[] = [];
  let telegramMessageId = 5_000;
  const used = new Set<string>();
  const counters = new Map<
    string,
    { requests: number; approved: number; joined: number; left: number }
  >();
  const pool = ctx.members.slice(40);
  let next = 0;
  const pickMember = (at: Date): string => {
    for (let i = 0; i < pool.length; i++) {
      const m = pool[(next + i) % pool.length]!;
      if (!used.has(m.id) && m.firstSeenAt.getTime() < at.getTime()) {
        used.add(m.id);
        next = (next + i + 1) % pool.length;
        return m.id;
      }
    }
    const m = pool[next++ % pool.length]!;
    return m.id;
  };
  const notFuture = (d: Date) =>
    d.getTime() > now.getTime() - MIN ? new Date(now.getTime() - MIN) : d;

  /**
   * Une demande, enregistrée comme le bot de la phase 11 (provenance, règle appliquée, canaux à rejoindre), avec son
   * message d'accueil envoyé 2 secondes après (sauf règle « sans message ») : le parcours des demandes (phase 14) le
   * retrouve. `extra` : champs propres au trafic de la phase 14 (fenêtre de 5 minutes, rappels, expiration).
   */
  const request = (input: {
    memberId: string;
    channel: P11Key;
    link: P11Link | null;
    rule: P11Rule;
    at: Date;
    status: Status;
    gateSatisfiedAt?: Date | null;
    approvedAt?: Date | null;
    leftAt?: Date | null;
    noGates?: boolean;
    /** Charge de l'événement « canaux rejoints » (phase 14 : `auto`, `trigger`). */
    gateEvent?: Record<string, unknown>;
    extra?: Partial<Prisma.MembershipCreateManyInput>;
  }): { id: string; joinedAt: Date | null; welcomeAt: Date | null } => {
    const provenance = provenanceOfLink(input.link);
    const titles = { [id.tir]: title.tir, [id.zone]: title.zone, [id.roulette]: title.roulette };
    const gates = input.noGates
      ? []
      : input.rule.gates
          .map((g) => id[g])
          .filter((g) => g !== provenance.sourceChannelId && g !== id[input.channel]);
    const gateLink = (g: string) =>
      Object.values(L).find(
        (l) => l.kind === "GATE" && id[l.channel] === g && l.sourceChannelId === id[input.channel],
      );
    const code = `demo11${shortId(6)}`;
    const vertical = P11_CHANNELS.find((c) => c.key === input.channel)!.vertical;
    const approveAt =
      input.status === "SCHEDULED" || input.approvedAt
        ? new Date(
            (input.gateSatisfiedAt ?? input.at).getTime() +
              (input.rule.mode === "IMMEDIATE" ? 0 : input.rule.delaySeconds) * 1000,
          )
        : null;
    const approvedAt = input.approvedAt ?? null;
    const joinedAt = approvedAt ? new Date(approvedAt.getTime() + r.int(3, 90) * 1000) : null;
    const msId = newId();
    rows.push({
      id: msId,
      code,
      memberId: input.memberId,
      channelId: id[input.channel],
      status: input.status,
      inviteLinkId: input.link?.id ?? null,
      approvalRuleId: input.rule.id,
      userChatId: null,
      requestedAt: input.at,
      gateSatisfiedAt: input.gateSatisfiedAt ?? null,
      approveAt,
      approvedAt,
      joinedAt,
      leftAt: input.leftAt ?? null,
      approvedByBotId: approvedAt ? botOf[input.channel] : null,
      source: {
        demo: true,
        inviteLink: input.link
          ? {
              id: input.link.id,
              name: input.link.name,
              kind: input.link.kind,
              campaignId: null,
              adPlatform: input.link.adPlatform,
              adCampaignName: null,
              adName: input.link.adName ?? null,
            }
          : null,
        telegramInviteLink: input.link?.url ?? null,
        rule: {
          id: input.rule.id,
          name: input.rule.name,
          mode: input.rule.mode,
          delaySeconds: input.rule.delaySeconds,
          gateMode: input.rule.gateMode,
        },
        provenance: {
          ...provenance,
          label: provenanceLabel(provenance, titles, input.link?.name ?? null),
        },
        appliedRule: {
          id: input.rule.id,
          scope: input.rule.scope,
          label: input.rule.scope === "DEFAULT" ? null : input.rule.label,
          ...(input.noGates ? { noGates: true } : {}),
        },
        gates: gates.map((g) => ({
          channelId: g,
          title: titles[g],
          url: gateLink(g)?.url ?? `https://t.me/+DEMO11manquant`,
        })),
        gateLinksMissing: [],
        startUrl: `https://t.me/${ctx.botUsername[vertical]}?start=g${code}`,
        botId: botOf[input.channel],
      },
      ...input.extra,
    });
    const base = {
      memberId: input.memberId,
      channelId: id[input.channel],
      botId: botOf[input.channel],
    };
    events.push({
      ...base,
      type: "membership.requested",
      occurredAt: input.at,
      payload: {
        membershipId: msId,
        code,
        status: input.status,
        inviteLinkId: input.link?.id ?? null,
        ruleId: input.rule.id,
        provenance: {
          ...provenance,
          label: provenanceLabel(provenance, titles, input.link?.name ?? null),
        },
        appliedRule: { id: input.rule.id, scope: input.rule.scope, label: input.rule.label },
        demo: true,
      },
    });
    if (input.gateSatisfiedAt)
      events.push({
        ...base,
        type: "membership.gate_satisfied",
        occurredAt: input.gateSatisfiedAt,
        payload: {
          membershipId: msId,
          ...(approveAt ? { approveAt: approveAt.toISOString() } : {}),
          ...input.gateEvent,
          demo: true,
        } as Prisma.InputJsonValue,
      });
    if (approvedAt)
      events.push({
        ...base,
        type: "membership.approved",
        occurredAt: approvedAt,
        payload: { membershipId: msId, demo: true },
      });
    if (joinedAt)
      events.push({
        ...base,
        type: "membership.joined",
        occurredAt: joinedAt,
        payload: { membershipId: msId, demo: true },
      });
    if (input.leftAt)
      events.push({
        ...base,
        type: "membership.left",
        occurredAt: input.leftAt,
        payload: { membershipId: msId, demo: true },
      });
    if (input.link) {
      const c = counters.get(input.link.id) ?? { requests: 0, approved: 0, joined: 0, left: 0 };
      c.requests++;
      if (approvedAt) c.approved++;
      if (joinedAt) c.joined++;
      if (input.leftAt) c.left++;
      counters.set(input.link.id, c);
    }
    // Message d'accueil (accueil complet avec les canaux à rejoindre, sinon court message), comme le bot.
    let welcomeAt: Date | null = null;
    if (input.rule.sendWelcome) {
      welcomeAt = new Date(input.at.getTime() + 2_000);
      outbound.push({
        botId: botOf[input.channel],
        memberId: input.memberId,
        kind: "WELCOME",
        chatId: (input.extra?.userChatId as bigint | null | undefined) ?? null,
        text: gates.length
          ? `Bienvenue ! Pour entrer dans ${title[input.channel]}, rejoins ${gates
              .map((g) => titles[g])
              .join(" et ")}, puis appuie sur « ✅ J'ai rejoint ».`
          : `Ta demande pour ${title[input.channel]} est bien reçue.`,
        buttons: [],
        status: "SENT",
        queuedAt: welcomeAt,
        sentAt: new Date(welcomeAt.getTime() + 1_000),
        telegramMessageId: telegramMessageId++,
      });
    }
    return { id: msId, joinedAt, welcomeAt };
  };
  /** Départ dans les 7 jours (une partie), ou plus tard (rarement), ou jamais. */
  const fate = (joined: Date): { status: Status; leftAt: Date | null } => {
    const x = r.next();
    if (x < 0.14) {
      const at = new Date(joined.getTime() + r.int(2, 6 * 24) * HOUR);
      if (at.getTime() < now.getTime() - MIN) return { status: "LEFT", leftAt: at };
    }
    if (x > 0.95) {
      const at = new Date(joined.getTime() + r.int(9, 20) * DAY);
      if (at.getTime() < now.getTime() - MIN) return { status: "LEFT", leftAt: at };
    }
    return { status: "APPROVED", leftAt: null };
  };
  const at = (daysAgo: number, hoursAgo = 0) =>
    notFuture(new Date(now.getTime() - daysAgo * DAY - hoursAgo * HOUR - r.int(0, 50) * MIN));

  /**
   * Cas du client : demande pour Tir Cadré (qui exige Zone Interdite), clic sur le bouton « Zone Interdite » → demande
   * pour Zone Interdite (venue de Tir Cadré : 1 jour, court message), « ✅ J'ai rejoint » satisfait par cette demande
   * en attente → Tir Cadré accepté tout de suite.
   */
  const fromTir = (memberId: string, t: Date) => {
    const zoneAt = new Date(t.getTime() + r.int(1, 8) * MIN);
    const gateAt = new Date(zoneAt.getTime() + r.int(1, 4) * MIN);
    if (gateAt.getTime() >= now.getTime() - MIN) return;
    request({
      memberId,
      channel: "tir",
      link: null,
      rule: rules.tirDefault!,
      at: t,
      status: "APPROVED",
      gateSatisfiedAt: gateAt,
      approvedAt: gateAt,
    });
    const zoneApprove = new Date(zoneAt.getTime() + DAY);
    if (zoneApprove.getTime() > now.getTime()) {
      request({
        memberId,
        channel: "zone",
        link: L.zoneFromTir,
        rule: rules.zoneFromTir!,
        at: zoneAt,
        status: "SCHEDULED",
      });
      return;
    }
    const f = fate(zoneApprove);
    request({
      memberId,
      channel: "zone",
      link: L.zoneFromTir,
      rule: rules.zoneFromTir!,
      at: zoneAt,
      status: f.status,
      approvedAt: zoneApprove,
      leftAt: f.leftAt,
    });
  };
  /** Demande pour Zone Interdite (pub, lien inconnu) : rejoindre Zone Roulette et Tir Cadré, puis 5 minutes. */
  const viaDefault = (
    memberId: string,
    link: P11Link | null,
    t: Date,
    stage: "pending" | "scheduled" | "done",
  ) => {
    if (stage === "pending") {
      request({
        memberId,
        channel: "zone",
        link,
        rule: rules.zoneDefault!,
        at: t,
        status: "PENDING_GATE",
      });
      return;
    }
    const rouletteAt = new Date(t.getTime() + r.int(1, 6) * MIN);
    const tirAt = new Date(rouletteAt.getTime() + r.int(1, 6) * MIN);
    const gateAt = new Date(tirAt.getTime() + r.int(1, 5) * MIN);
    if (gateAt.getTime() >= now.getTime() - MIN) {
      request({
        memberId,
        channel: "zone",
        link,
        rule: rules.zoneDefault!,
        at: t,
        status: "PENDING_GATE",
      });
      return;
    }
    // Canaux à rejoindre : venus du bouton de Zone Interdite → exception « tout de suite, sans message ».
    request({
      memberId,
      channel: "roulette",
      link: L.rouletteFromZone,
      rule: rules.rouletteGate!,
      at: rouletteAt,
      status: "APPROVED",
      approvedAt: new Date(rouletteAt.getTime() + 15_000),
    });
    request({
      memberId,
      channel: "tir",
      link: L.tirFromZone,
      rule: rules.tirGate!,
      at: tirAt,
      status: "APPROVED",
      approvedAt: new Date(tirAt.getTime() + 15_000),
    });
    const approveAt = new Date(gateAt.getTime() + 300_000);
    if (stage === "scheduled" || approveAt.getTime() > now.getTime()) {
      request({
        memberId,
        channel: "zone",
        link,
        rule: rules.zoneDefault!,
        at: t,
        status: "SCHEDULED",
        gateSatisfiedAt: gateAt,
      });
      return;
    }
    const f = fate(approveAt);
    request({
      memberId,
      channel: "zone",
      link,
      rule: rules.zoneDefault!,
      at: t,
      status: f.status,
      gateSatisfiedAt: gateAt,
      approvedAt: approveAt,
      leftAt: f.leftAt,
    });
  };
  /** Lien de partage : la règle qui s'applique (venu de Tir Cadré → 1 jour ; « Story Instagram » → 1 heure). */
  const viaShare = (memberId: string, l: P11Link, rule: P11Rule, t: Date) => {
    const approve = new Date(t.getTime() + rule.delaySeconds * 1000);
    if (approve.getTime() > now.getTime()) {
      request({ memberId, channel: "zone", link: l, rule, at: t, status: "SCHEDULED" });
      return;
    }
    const f = fate(approve);
    request({
      memberId,
      channel: "zone",
      link: l,
      rule,
      at: t,
      status: f.status,
      approvedAt: approve,
      leftAt: f.leftAt,
    });
  };

  // La personne des captures de la fiche membre (premier dépôt, la plus ancienne) : le cas du client, il y a 2 heures.
  const featured = await db.member.findFirst({
    where: {
      telegramUserId: { gte: DEMO_MEMBER_ID_BASE, lt: DEMO_MEMBER_ID_END },
      anonymizedAt: null,
      players: { some: { ftdAt: { not: null } } },
    },
    orderBy: { firstSeenAt: "asc" },
    select: { id: true },
  });
  if (featured) {
    used.add(featured.id);
    fromTir(featured.id, new Date(now.getTime() - 2 * HOUR));
  }
  for (const d of [27, 24, 21, 19, 16, 14, 12, 10, 8, 6, 5, 3, 2])
    fromTir(pickMember(at(d)), at(d));
  for (const h of [3, 9, 16]) fromTir(pickMember(at(0, h)), at(0, h));
  for (const d of [28, 23, 20, 17, 13, 11, 9, 7, 4, 2, 1])
    viaDefault(pickMember(at(d)), L.tiktok, at(d), "done");
  viaDefault(pickMember(at(0, 1)), L.tiktok, at(0, 1), "pending");
  viaDefault(pickMember(at(0, 5)), L.tiktok, at(0, 5), "pending");
  viaDefault(
    pickMember(new Date(now.getTime() - 20 * MIN)),
    L.tiktok,
    new Date(now.getTime() - 20 * MIN),
    "scheduled",
  );
  for (const d of [26, 18, 12, 6, 3]) viaDefault(pickMember(at(d)), null, at(d), "done");
  viaDefault(pickMember(at(0, 2)), null, at(0, 2), "pending");
  for (const d of [22, 15, 9, 4, 2])
    viaShare(pickMember(at(d)), L.sharePost, rules.zoneFromTir!, at(d));
  viaShare(pickMember(at(0, 6)), L.sharePost, rules.zoneFromTir!, at(0, 6));
  for (const d of [20, 11, 5, 1])
    viaShare(pickMember(at(d)), L.shareStory, rules.zoneStory!, at(d));
  viaShare(
    pickMember(new Date(now.getTime() - 25 * MIN)),
    L.shareStory,
    rules.zoneStory!,
    new Date(now.getTime() - 25 * MIN),
  );

  // ——— Phase 14 : trafic TikTok du 14 au 15 octobre sur Zone Interdite (constat du client) ———
  // Des personnes nouvelles venues de deux pubs TikTok (« Pub 1 », « Pub 2 »), qui n'ont jamais appuyé sur « Démarrer » :
  // l'accueil part dans les 5 minutes de leur demande (fenêtre `user_chat_id`) ; une partie bloque le bot dans les
  // 3 minutes (vrai blocage : mise à jour Telegram) ; d'autres rejoignent un seul des deux canaux, ou les deux
  // (validation automatique, « Canaux rejoints » dans la fenêtre, acceptation 5 minutes après ; avant la mise à jour du
  // 15 octobre, validées par le rattrapage) ; deux appuient sur « ✅ J'ai rejoint » (joignables ensuite). Rappels d'une
  // heure : refusés par Telegram avant la mise à jour (les plus anciens enregistrés comme avant la phase 14 : « bloqué »
  // sans l'erreur exacte ; les suivants « bot can't initiate conversation with a user », pas un blocage), puis plus
  // envoyés aux personnes injoignables (`dm.skipped_unreachable`). Graine propre : le reste ne change pas.
  const r14 = createRandom(SEED + 14);
  const p14Members: Prisma.MemberCreateManyInput[] = [];
  const p14States: Prisma.MemberBotStateCreateManyInput[] = [];
  const p14 = { requests: 0, blocked: 0, refused: 0, pending: 0 };
  const zoneBot = botOf.zone;
  /** Mise à jour du 15 octobre : avant, les rappels partaient et Telegram les refusait ; après, plus d'envoi. */
  const fixAt = new Date(now.getTime() - 8 * HOUR);
  /** Avant la phase 14, un refus était enregistré « bloqué », sans l'erreur exacte de Telegram. */
  const legacyBefore = new Date(now.getTime() - 16 * HOUR);
  const NEVER_STARTED =
    "Le bot ne peut plus écrire à cette personne : elle n'a jamais appuyé sur « Démarrer » et les 5 minutes après sa demande sont passées.";
  type P14Fate = "blocked" | "both" | "pressed" | "one" | "nothing";
  const p14Plan: Array<{ link: P11Link; fate: P14Fate }> = [];
  const p14Mix: Array<[P11Link, Array<[P14Fate, number]>]> = [
    [
      L.tiktok,
      [
        ["blocked", 14],
        ["both", 5],
        ["one", 4],
        ["nothing", 7],
      ],
    ],
    [
      L.tiktok2,
      [
        ["blocked", 1],
        ["both", 4],
        ["pressed", 2],
        ["one", 2],
        ["nothing", 5],
      ],
    ],
  ];
  // Ordre d'arrivée : chaque parcours réparti sur toute la période (petit décalage tiré au sort), pour en retrouver
  // aussi aujourd'hui et dans la dernière heure.
  const p14Order: Array<{ link: P11Link; fate: P14Fate; key: number }> = [];
  for (const [l, fates] of p14Mix)
    for (const [fate, count] of fates)
      for (let i = 0; i < count; i++)
        p14Order.push({ link: l, fate, key: (i + 0.2 + r14.next() * 0.6) / count });
  p14Order.sort((a, b) => a.key - b.key);
  for (const o of p14Order) p14Plan.push({ link: o.link, fate: o.fate });
  const sec = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
  /**
   * Message privé tardif (rappel, « Accepté ») à une personne injoignable : refusé par Telegram avant la mise à jour
   * (ancien ou nouvel enregistrement), plus envoyé après (`dm.skipped_unreachable`). Rien s'il n'est pas encore dû.
   */
  const lateDm = (input: {
    memberId: string;
    membershipId: string;
    kind: "GATE_REMINDER" | "ACCEPTED";
    at: Date;
    text: string;
    blocked: boolean;
  }): "attempted" | "skipped" | "none" => {
    if (input.at.getTime() > now.getTime() - MIN) return "none";
    if (input.at.getTime() >= fixAt.getTime()) {
      events.push({
        type: "dm.skipped_unreachable",
        memberId: input.memberId,
        channelId: id.zone,
        botId: zoneBot,
        occurredAt: input.at,
        payload: {
          membershipId: input.membershipId,
          kind: input.kind,
          reason: input.blocked ? "blocked" : "never_started",
          demo: true,
        },
      });
      return "skipped";
    }
    const omId = newId();
    const legacy = input.at.getTime() < legacyBefore.getTime();
    const error = legacy
      ? "Le destinataire a bloqué le bot ou le chat n'existe plus."
      : input.blocked
        ? "Cette personne a bloqué le bot."
        : NEVER_STARTED;
    outbound.push({
      id: omId,
      botId: zoneBot,
      memberId: input.memberId,
      kind: input.kind,
      text: input.text,
      buttons: [],
      status: legacy || input.blocked ? "BLOCKED" : "FAILED",
      error,
      queuedAt: input.at,
    });
    events.push({
      type: legacy || input.blocked ? "dm.blocked" : "dm.unreachable",
      memberId: input.memberId,
      botId: zoneBot,
      occurredAt: sec(input.at, 1),
      payload: legacy
        ? { outboundMessageId: omId, error, demo: true }
        : {
            outboundMessageId: omId,
            kind: input.kind,
            error,
            telegramError: input.blocked
              ? "403 Forbidden: bot was blocked by the user"
              : "403 Forbidden: bot can't initiate conversation with a user",
            demo: true,
          },
    });
    if (!input.blocked) p14.refused++;
    return "attempted";
  };
  /** Une personne du trafic TikTok : sa demande, ses canaux, son blocage éventuel, les messages du bot. */
  const addP14Person = (l: P11Link, fate: P14Fate, at: Date, k: number) => {
    const tgId = P14_MEMBER_ID_BASE + BigInt(k);
    const memberId = stableId(`p14:member:${k}`);
    const firstName = r14.pick(FIRST_NAMES);
    p14Members.push({
      id: memberId,
      telegramUserId: tgId,
      firstName,
      lastName: r14.chance(0.5) ? `${r14.pick([...LAST_INITIALS])}.` : null,
      username: r14.chance(0.6)
        ? `${firstName
            .toLowerCase()
            .normalize("NFD")
            .replace(/[^a-z]/g, "")}${r14.int(10, 99)}`
        : null,
      languageCode: "fr",
      firstSeenAt: at,
      lastSeenAt: at,
    });
    const welcomeAt = sec(at, 2);
    // Canaux à rejoindre (boutons de l'accueil : demandes acceptées tout de suite, sans message, phase 11).
    const rouletteAt = fate === "blocked" || fate === "nothing" ? null : sec(at, r14.int(40, 110));
    const tirAt = rouletteAt && fate !== "one" ? sec(rouletteAt, r14.int(30, 100)) : null;
    let gateAt: Date | null = null;
    let gateEvent: Record<string, unknown> = {};
    if (tirAt && fate === "pressed") gateAt = sec(tirAt, r14.int(10, 40));
    else if (tirAt && tirAt.getTime() >= fixAt.getTime()) {
      gateAt = sec(tirAt, 1);
      gateEvent = { auto: true, trigger: "join_request" };
    } else if (tirAt) {
      // Canaux rejoints sans « ✅ J'ai rejoint » avant la mise à jour : validées par le rattrapage (`pnpm db:phase14`).
      gateAt = sec(fixAt, 30 + k);
      gateEvent = { auto: true, trigger: "backfill" };
    }
    if (gateAt && gateAt.getTime() > now.getTime() - MIN) gateAt = null;
    const approveAt = gateAt ? sec(gateAt, rules.zoneDefault!.delaySeconds) : null;
    const accepted = approveAt && approveAt.getTime() <= now.getTime() - MIN ? approveAt : null;
    const pending = !gateAt;
    const blockedAt = fate === "blocked" ? sec(welcomeAt, r14.int(25, 170)) : null;
    // Rappels de la règle (60 minutes, puis 1 jour), seulement tant que les canaux ne sont pas rejoints.
    const reminders = [60, 1440]
      .map((m) => sec(at, m * 60))
      .filter(
        (d) => d.getTime() <= now.getTime() - MIN && (!gateAt || gateAt.getTime() > d.getTime()),
      );
    const attempted = reminders.filter((d) => d.getTime() < fixAt.getTime());
    // Une partie des personnes acceptées repart du canal (de 6 heures à 2 jours et demi après).
    const leftAt = accepted && r14.chance(0.15) ? sec(accepted, r14.int(6, 60) * 3600) : null;
    const left = leftAt && leftAt.getTime() <= now.getTime() - MIN ? leftAt : null;
    const ms = request({
      memberId,
      channel: "zone",
      link: l,
      rule: rules.zoneDefault!,
      at,
      status: pending ? "PENDING_GATE" : accepted ? (left ? "LEFT" : "APPROVED") : "SCHEDULED",
      gateSatisfiedAt: gateAt,
      approvedAt: accepted,
      leftAt: left,
      gateEvent,
      extra: {
        userChatId: tgId,
        expiresAt: pending ? new Date(at.getTime() + 72 * HOUR) : null,
        remindersSent: attempted.length,
        lastReminderAt: attempted.at(-1) ?? null,
      },
    });
    p14.requests++;
    if (pending) p14.pending++;
    if (rouletteAt)
      request({
        memberId,
        channel: "roulette",
        link: L.rouletteFromZone,
        rule: rules.rouletteGate!,
        at: rouletteAt,
        status: "APPROVED",
        approvedAt: sec(rouletteAt, 15),
        extra: { userChatId: tgId },
      });
    if (tirAt)
      request({
        memberId,
        channel: "tir",
        link: L.tirFromZone,
        rule: rules.tirGate!,
        at: tirAt,
        status: "APPROVED",
        approvedAt: sec(tirAt, 15),
        extra: { userChatId: tgId },
      });
    if (blockedAt) {
      // Vrai blocage : mise à jour Telegram « bot bloqué » en privé (`my_chat_member`).
      events.push({
        type: "member.blocked",
        memberId,
        botId: zoneBot,
        occurredAt: blockedAt,
        payload: { demo: true },
      });
      p14.blocked++;
    }
    p14States.push({
      memberId,
      botId: zoneBot,
      canDm: fate === "pressed",
      startedAt: fate === "pressed" && gateAt ? gateAt : null,
      blockedAt,
      lastDmAt: welcomeAt,
    });
    for (const reminderAt of reminders)
      lateDm({
        memberId,
        membershipId: ms.id,
        kind: "GATE_REMINDER",
        at: reminderAt,
        text: `Plus qu'une étape pour entrer dans ${title.zone} : rejoins ${title.roulette} et ${title.tir}.`,
        blocked: !!blockedAt,
      });
    if (gateAt) {
      // « Canaux rejoints » : dans les 5 minutes de la demande, ou après « ✅ J'ai rejoint » ; sinon plus d'envoi.
      const inWindow = gateAt.getTime() - at.getTime() < 5 * MIN;
      if (inWindow || fate === "pressed")
        outbound.push({
          botId: zoneBot,
          memberId,
          kind: "GATE_REMINDER",
          chatId: inWindow ? tgId : null,
          text: `C'est bon ${firstName}, tu seras accepté dans ${title.zone} dans 5 minutes.`,
          buttons: [],
          status: "SENT",
          queuedAt: sec(gateAt, 2),
          sentAt: sec(gateAt, 3),
          telegramMessageId: telegramMessageId++,
        });
      else
        events.push({
          type: "dm.skipped_unreachable",
          memberId,
          channelId: id.zone,
          botId: zoneBot,
          occurredAt: gateAt,
          payload: {
            membershipId: ms.id,
            kind: "GATE_SATISFIED",
            reason: "never_started",
            demo: true,
          },
        });
    }
    if (accepted) {
      const acceptedText = `Bienvenue dans ${title.zone} !`;
      if (fate === "pressed")
        outbound.push({
          botId: zoneBot,
          memberId,
          kind: "ACCEPTED",
          text: acceptedText,
          buttons: [],
          status: "SENT",
          queuedAt: sec(accepted, 1),
          sentAt: sec(accepted, 2),
          telegramMessageId: telegramMessageId++,
        });
      else
        lateDm({
          memberId,
          membershipId: ms.id,
          kind: "ACCEPTED",
          at: sec(accepted, 1),
          text: acceptedText,
          blocked: false,
        });
    }
  };
  // Nuit du 14 au 15 octobre : deux pubs, de 19 heures à 12 minutes avant maintenant.
  const p14Span = 19 * HOUR - 12 * MIN;
  p14Plan.forEach(({ link: l, fate }, k) =>
    addP14Person(
      l,
      fate,
      notFuture(
        new Date(
          now.getTime() -
            19 * HOUR +
            Math.round(((k + r14.next() * 0.8) / p14Plan.length) * p14Span),
        ),
      ),
      k,
    ),
  );
  // Semaine de test de la pub 1, de 7 à 2 jours avant : avant la phase 14, seule « ✅ J'ai rejoint » faisait entrer ;
  // les personnes qui n'ont rien fait restent « Attend les canaux » (expiration : laisser en attente).
  const olderMix: Array<[P14Fate, number]> = [
    ["pressed", 20],
    ["blocked", 4],
    ["one", 3],
    ["nothing", 3],
  ];
  const older = olderMix
    .flatMap(([fate, count]) =>
      Array.from({ length: count }, (_, i) => ({
        fate,
        key: (i + 0.2 + r14.next() * 0.6) / count,
      })),
    )
    .sort((a, b) => a.key - b.key);
  older.forEach(({ fate }, i) =>
    addP14Person(
      L.tiktok,
      fate,
      new Date(
        now.getTime() - 7 * DAY + Math.round(((i + r14.next() * 0.8) / older.length) * 5 * DAY),
      ),
      p14Plan.length + i,
    ),
  );

  await inBatches(p14Members, 500, (chunk) => db.member.createMany({ data: chunk }));
  await inBatches(rows, 500, (chunk) => db.membership.createMany({ data: chunk }));
  await inBatches(events, 1000, (chunk) => db.event.createMany({ data: chunk }));
  await inBatches(p14States, 500, (chunk) => db.memberBotState.createMany({ data: chunk }));
  await inBatches(outbound, 1000, (chunk) => db.outboundMessage.createMany({ data: chunk }));
  for (const [linkId, c] of counters)
    await db.inviteLink.update({ where: { id: linkId }, data: c });
  // Dernière activité des membres concernés.
  const lastAt = new Map<string, Date>();
  for (const m of rows) {
    const t = (m.joinedAt ?? m.requestedAt) as Date;
    const prev = lastAt.get(m.memberId);
    if (!prev || prev < t) lastAt.set(m.memberId, t);
  }
  for (const [memberId, t] of lastAt)
    await db.member.updateMany({
      where: { id: memberId, lastSeenAt: { lt: t } },
      data: { lastSeenAt: t },
    });

  return {
    channelIds: P11_CHANNELS.map((c) => id[c.key]),
    exceptions: Object.values(rules).filter((x) => x.scope !== "DEFAULT").length,
    shareLinks: 2,
    memberships: rows.length,
    phase14: p14,
  };
}

// ============================================================
// Phase 13 : campagnes Telegram des affiliés Link Affi (contrat docs/LINKAFFI-PARTENAIRES.md)
// ============================================================
//
// Deux affiliés (Paul Martin, Sarah K.) et trois campagnes Telegram créées « dans Link Affi » (liens LINKAFFI avec
// demande d'adhésion) : Paul sur « Casino VIP » (à vie) et « Pronos Foot » (à vie), Sarah sur « Casino VIP » (30 jours).
// Leurs membres (rattachés, premier affilié gagne), des demandes à tous les statuts, des clics d'offre avec `&tg=`, des
// joueurs avec premiers dépôts (dont aujourd'hui et hier), les événements déjà « transmis à Link Affi » (jamais en
// attente : rien ne part vers Link Affi depuis la base locale), une personne non rattachée (déjà membre d'un autre
// affilié), deux exceptions de règle (« de l'affilié « Paul Martin » », « de n'importe quel affilié Link Affi ») et
// le relevé de la synchro (clics comptés par Link Affi, un écart). Le membre le plus ancien avec un premier dépôt est
// un membre de Paul : c'est la fiche des captures (`/members/:id`). Tirage à part (graine propre).

const P13_AFFILIATES = [
  { id: "demo-aff-paul", name: "Paul Martin" },
  { id: "demo-aff-sarah", name: "Sarah K." },
] as const;

const P13_CAMPAIGNS: ReadonlyArray<{
  key: string;
  name: string;
  affiliate: 0 | 1;
  channel: ChannelKey;
  offer: OfferKey;
  attributionDays: number | null;
  createdDaysAgo: number;
  members: number;
}> = [
  {
    key: "demotgpaul01",
    name: "Paul — Casino VIP",
    affiliate: 0,
    channel: "casinoVip",
    offer: "casinoA",
    attributionDays: null,
    createdDaysAgo: 70,
    members: 22,
  },
  {
    key: "demotgpaul02",
    name: "Paul — Pronos Foot",
    affiliate: 0,
    channel: "sportsFoot",
    offer: "sportsA",
    attributionDays: null,
    createdDaysAgo: 35,
    members: 12,
  },
  {
    key: "demotgsarah1",
    name: "Sarah — Casino VIP 30 jours",
    affiliate: 1,
    channel: "casinoVip",
    offer: "casinoB",
    attributionDays: 30,
    createdDaysAgo: 28,
    members: 14,
  },
];

/** Identifiants Telegram des membres de la phase 13 (dans la plage de démonstration, après ceux des autres). */
const P13_MEMBER_ID_BASE = DEMO_MEMBER_ID_BASE + 600_000n;
/** Personnes du trafic TikTok de la phase 14 (Zone Interdite). */
const P14_MEMBER_ID_BASE = DEMO_MEMBER_ID_BASE + 700_000n;

async function createPhase13Demo(
  db: Db,
  ctx: {
    now: Date;
    botIdByVertical: Record<Vertical, string>;
    channelId: Record<ChannelKey, string>;
    channelTitle: Record<ChannelKey, string>;
    channelVertical: Record<ChannelKey, Vertical>;
    offerId: Record<OfferKey, string>;
    offerTemplate: Record<OfferKey, string>;
    /** Notre campagne du canal (bouton Offre rattaché à la campagne, comme les autres messages de démonstration). */
    campaignIdOfChannel: (k: ChannelKey) => string | null;
  },
): Promise<{
  campaigns: number;
  members: number;
  memberships: number;
  clicks: number;
  players: number;
  ftds: number;
  linkaffiEvents: number;
}> {
  const { now } = ctx;
  const r = createRandom(SEED + 13);
  const notFuture = (d: Date) =>
    d.getTime() > now.getTime() - MIN ? new Date(now.getTime() - MIN) : d;
  const ago = (ms: number) => new Date(now.getTime() - ms);

  // Liens des campagnes Telegram d'affiliés (créés à la demande de Link Affi, avec demande d'adhésion).
  const links = P13_CAMPAIGNS.map((c) => {
    const a = P13_AFFILIATES[c.affiliate];
    return {
      ...c,
      id: stableId(`p13:link:${c.key}`),
      offerLinkId: stableId(`p13:offer-link:${c.key}`),
      affiliateId: a.id,
      affiliateName: a.name,
      url: `https://t.me/+DEMO13${c.key.slice(6)}${shortId(6)}`,
      createdAt: ago(c.createdDaysAgo * DAY),
      botId: ctx.botIdByVertical[ctx.channelVertical[c.channel]],
      counters: { requests: 0, approved: 0, joined: 0, left: 0 },
    };
  });
  for (const l of links) {
    await db.inviteLink.create({
      data: {
        id: l.id,
        channelId: ctx.channelId[l.channel],
        botId: l.botId,
        telegramInviteLink: l.url,
        name: linkaffiInviteLinkName(l.name),
        kind: "LINKAFFI",
        createsJoinRequest: true,
        linkaffiCampaignKey: l.key,
        linkaffiCampaignName: l.name,
        linkaffiAffiliateId: l.affiliateId,
        linkaffiAffiliateName: l.affiliateName,
        attributionDays: l.attributionDays,
        createdById: null,
        createdAt: l.createdAt,
      },
    });
    // Bouton Offre des messages du canal (un identifiant de suivi par membre et par clic).
    await db.trackingLink.create({
      data: {
        id: l.offerLinkId,
        slug: `d13${shortId(7)}`,
        kind: "OFFER",
        destinationTemplate: ctx.offerTemplate[l.offer],
        label: `Bouton Offre · ${ctx.channelTitle[l.channel]}`,
        channelId: ctx.channelId[l.channel],
        campaignId: ctx.campaignIdOfChannel(l.channel),
        affiliateCampaignId: ctx.offerId[l.offer],
        createdAt: l.createdAt,
      },
    });
  }

  // Exceptions de règle selon la provenance (phase 13).
  const exceptions = [
    {
      id: stableId("p13:rule:casinoVip:paul"),
      channel: "casinoVip" as const,
      sourceKind: "LINKAFFI_AFFILIATE" as const,
      linkaffiAffiliateId: P13_AFFILIATES[0].id as string | null,
      label: frQuotesDemo(`Venu de l'affilié « ${P13_AFFILIATES[0].name} »`),
      mode: "IMMEDIATE" as const,
      delaySeconds: 0,
    },
    {
      id: stableId("p13:rule:sportsFoot:any"),
      channel: "sportsFoot" as const,
      sourceKind: "LINKAFFI_ANY" as const,
      linkaffiAffiliateId: null,
      label: "Venu de n'importe quel affilié Link Affi",
      mode: "DELAY" as const,
      delaySeconds: 3_600,
    },
  ];
  for (const e of exceptions)
    await db.approvalRule.create({
      data: {
        id: e.id,
        channelId: ctx.channelId[e.channel],
        name: e.label,
        label: e.label,
        isDefault: false,
        scope: "SOURCE_KIND",
        sourceKind: e.sourceKind,
        linkaffiAffiliateId: e.linkaffiAffiliateId,
        sortOrder: 10,
        sendWelcome: true,
        sendAcceptedMessage: true,
        mode: e.mode,
        delaySeconds: e.delaySeconds,
        gateMode: "NONE",
        gateChannelIds: [],
        reminderAfterMinutes: [],
        maxReminders: 0,
        expireAfterHours: null,
        expireAction: "KEEP",
        createdAt: ago(25 * DAY),
      },
    });
  const ruleOf = (c: ChannelKey) => exceptions.find((e) => e.channel === c)!;

  const members: Prisma.MemberCreateManyInput[] = [];
  const memberships: Prisma.MembershipCreateManyInput[] = [];
  const clicks: Prisma.ClickCreateManyInput[] = [];
  const players: Prisma.PlayerCreateManyInput[] = [];
  const playerEvents: Prisma.PlayerEventCreateManyInput[] = [];
  const events: Prisma.EventCreateManyInput[] = [];
  const linkaffiEvents: Prisma.LinkaffiEventCreateManyInput[] = [];
  let memberIndex = 0;
  let playerIndex = 0;
  let ftds = 0;
  const forcedFtd = { today: false, yesterday: false };

  /** Événement « transmis à Link Affi » (corps exact du contrat, déjà reçu : rien ne repartira). */
  const sent = (input: {
    type: LinkaffiEventType;
    sourceId: string;
    at: Date;
    link: (typeof links)[number];
    member: { id: string; tgId: bigint; firstName: string; username: string | null };
    data?: Record<string, unknown>;
  }) => {
    if (input.at.getTime() > now.getTime() - MIN) return;
    const body = buildLinkaffiEvent({
      type: input.type,
      sourceId: input.sourceId,
      occurredAt: input.at,
      campaignKey: input.link.key,
      channel: {
        id: ctx.channelId[input.link.channel],
        title: ctx.channelTitle[input.link.channel],
      },
      member: {
        telegramUserId: input.member.tgId,
        username: input.member.username,
        firstName: input.member.firstName,
        languageCode: "fr",
      },
      data: input.data,
    });
    linkaffiEvents.push({
      eventId: body.eventId,
      type: input.type,
      occurredAt: input.at,
      campaignKey: input.link.key,
      memberId: input.member.id,
      channelId: ctx.channelId[input.link.channel],
      body: body as unknown as Prisma.InputJsonValue,
      status: "SENT",
      attempts: 1,
      nextAttemptAt: input.at,
      lastStatus: 200,
      sentAt: new Date(input.at.getTime() + 2_000),
      createdAt: input.at,
    });
  };

  for (const l of links) {
    const channelId = ctx.channelId[l.channel];
    const span = Math.max(1, l.createdDaysAgo - 1);
    for (let i = 0; i < l.members; i++) {
      const tgId = P13_MEMBER_ID_BASE + BigInt(memberIndex++);
      const memberId = stableId(`p13:member:${l.key}:${i}`);
      const firstName = r.pick(FIRST_NAMES);
      const username = r.chance(0.7)
        ? `${firstName
            .toLowerCase()
            .normalize("NFD")
            .replace(/[^a-z]/g, "")}${r.int(10, 99)}`
        : null;
      // Le tout premier membre de Paul : le plus ancien des déposants (fiche des captures).
      const featured = l.key === "demotgpaul01" && i === 0;
      const requestedAt = featured
        ? ago(62 * DAY + 3 * HOUR)
        : notFuture(ago(r.next() * span * DAY + r.int(1, 20) * MIN));
      const recent = now.getTime() - requestedAt.getTime() < 2 * DAY;
      const status = featured
        ? "APPROVED"
        : r.weighted<"APPROVED" | "LEFT" | "REQUESTED" | "DECLINED" | "EXPIRED">([
            ["APPROVED", 70],
            ["LEFT", 12],
            [recent ? "REQUESTED" : "APPROVED", 8],
            ["DECLINED", 5],
            ["EXPIRED", 5],
          ]);
      const rule = ruleOf(l.channel);
      const approvedAt =
        status === "APPROVED" || status === "LEFT"
          ? notFuture(new Date(requestedAt.getTime() + (rule.delaySeconds + r.int(2, 40)) * 1000))
          : null;
      const joinedAt = approvedAt
        ? notFuture(new Date(approvedAt.getTime() + r.int(3, 90) * 1000))
        : null;
      const leftAt =
        status === "LEFT" && joinedAt
          ? notFuture(new Date(joinedAt.getTime() + r.int(1, 12) * DAY))
          : null;
      // Refus (par l'équipe) ou expiration (la personne n'a pas fini) : 1 à 72 heures après la demande.
      const closedAt =
        status === "DECLINED" || status === "EXPIRED"
          ? notFuture(new Date(requestedAt.getTime() + r.int(1, 72) * HOUR))
          : null;
      const declinedAt = status === "DECLINED" ? closedAt : null;
      const endsAt = affiliateAttributionEndsAt(requestedAt, l.attributionDays);
      const lastSeenAt = [requestedAt, joinedAt, leftAt]
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0]!;
      members.push({
        id: memberId,
        telegramUserId: tgId,
        firstName,
        lastName: r.chance(0.4) ? `${r.pick(LAST_INITIALS.split(""))}.` : null,
        username,
        languageCode: "fr",
        firstSeenAt: requestedAt,
        lastSeenAt,
        tags: [],
        linkaffiCampaignKey: l.key,
        linkaffiAffiliateId: l.affiliateId,
        affiliateAttributedAt: requestedAt,
        affiliateAttributionEndsAt: endsAt,
        affiliateInviteLinkId: l.id,
      });
      const msId = newId();
      const link = {
        id: l.id,
        kind: "LINKAFFI" as const,
        sourceChannelId: null,
        adPlatform: null,
        linkaffiCampaignKey: l.key,
        linkaffiCampaignName: l.name,
        linkaffiAffiliateId: l.affiliateId,
        linkaffiAffiliateName: l.affiliateName,
      };
      const provenance = provenanceOfLink(link);
      memberships.push({
        id: msId,
        code: shortId(8),
        memberId,
        channelId,
        status,
        inviteLinkId: l.id,
        approvalRuleId: rule.id,
        requestedAt,
        approveAt: approvedAt,
        approvedAt,
        joinedAt,
        leftAt,
        declinedAt,
        expiresAt: status === "EXPIRED" ? closedAt : null,
        approvedByBotId: approvedAt ? l.botId : null,
        source: {
          demo: true,
          provenance: { ...provenance, label: provenanceLabel(provenance, {}, l.name) },
          appliedRule: { id: rule.id, scope: "SOURCE_KIND", label: rule.label },
          telegramInviteLink: l.url,
          botId: l.botId,
        },
      });
      l.counters.requests++;
      if (approvedAt) l.counters.approved++;
      if (joinedAt) l.counters.joined++;
      if (leftAt) l.counters.left++;
      const who = { id: memberId, tgId, firstName, username };
      const base = { memberId, channelId, botId: l.botId };
      events.push({
        ...base,
        type: "membership.requested",
        occurredAt: requestedAt,
        payload: { membershipId: msId, inviteLinkId: l.id, demo: true },
      });
      events.push({
        ...base,
        type: "member.affiliate_attributed",
        occurredAt: requestedAt,
        payload: {
          membershipId: msId,
          inviteLinkId: l.id,
          campaignKey: l.key,
          campaignName: l.name,
          affiliateId: l.affiliateId,
          affiliateName: l.affiliateName,
          stage: "request",
          attributedAt: requestedAt.toISOString(),
          endsAt: endsAt?.toISOString() ?? null,
          demo: true,
        },
      });
      sent({ type: "join_requested", sourceId: msId, at: requestedAt, link: l, member: who });
      if (approvedAt)
        sent({ type: "join_approved", sourceId: msId, at: approvedAt, link: l, member: who });
      if (joinedAt) sent({ type: "joined", sourceId: msId, at: joinedAt, link: l, member: who });
      if (leftAt) sent({ type: "left", sourceId: msId, at: leftAt, link: l, member: who });
      if (status === "DECLINED")
        sent({ type: "join_declined", sourceId: msId, at: closedAt!, link: l, member: who });
      if (status === "EXPIRED")
        sent({ type: "join_expired", sourceId: msId, at: closedAt!, link: l, member: who });

      // Clics d'offre des membres entrés : un identifiant de suivi par clic, et la clé de la campagne (`&tg=`).
      if (!joinedAt || (!featured && !r.chance(0.65))) continue;
      const until = leftAt ?? now;
      const memberClicks: Array<{ id: string; at: Date; subId: string }> = [];
      for (let k = featured ? 2 : r.int(1, 3); k > 0; k--) {
        const at = notFuture(
          new Date(
            joinedAt.getTime() + r.next() * Math.max(HOUR, until.getTime() - joinedAt.getTime()),
          ),
        );
        if (endsAt && at > endsAt) continue;
        const subId = newSubId();
        const id = newId();
        clicks.push({
          id,
          trackingLinkId: l.offerLinkId,
          subId,
          memberId,
          botId: l.botId,
          isBot: false,
          country: "FR",
          destination: withTelegramCampaignParam(
            fillUrlTemplate(ctx.offerTemplate[l.offer], { subid: subId }),
            l.key,
          ),
          linkaffiTelegramCampaignKey: l.key,
          createdAt: at,
        });
        memberClicks.push({ id, at, subId });
        sent({
          type: "offer_clicked",
          sourceId: id,
          at,
          link: l,
          member: who,
          data: { subId, offerCampaignKey: ctx.offerTemplate[l.offer].match(/go\/([^?]+)/)?.[1] },
        });
      }
      memberClicks.sort((a, b) => a.at.getTime() - b.at.getTime());
      const first = memberClicks[0];
      if (!first || (!featured && !r.chance(0.55))) continue;

      // Joueur Link Affi rattaché par son identifiant de suivi ; premier dépôt pour une partie d'entre eux.
      const registeredAt = notFuture(new Date(first.at.getTime() + r.int(5, 180) * MIN));
      let ftdAt: Date | null = null;
      if (featured) ftdAt = notFuture(new Date(registeredAt.getTime() + 3 * HOUR));
      else if (!forcedFtd.today && registeredAt < ago(2 * HOUR)) {
        forcedFtd.today = true;
        ftdAt = notFuture(ago(r.int(20, 90) * MIN));
        if (ftdAt < registeredAt) ftdAt = null;
      } else if (!forcedFtd.yesterday && registeredAt < ago(DAY + 4 * HOUR)) {
        forcedFtd.yesterday = true;
        ftdAt = ago(DAY + r.int(1, 3) * HOUR);
      } else if (r.chance(0.6))
        ftdAt = notFuture(new Date(registeredAt.getTime() + r.int(10, 72 * 60) * MIN));
      if (ftdAt && ftdAt.getTime() >= now.getTime() - MIN) ftdAt = null;
      const playerId = newId();
      const ext = `demo13-${++playerIndex}`;
      const evs: Array<{
        type: Prisma.PlayerEventCreateManyInput["type"];
        amount: number | null;
        at: Date;
      }> = [{ type: "REGISTRATION", amount: null, at: registeredAt }];
      let depositTotal = 0;
      let deposits = 0;
      let ngr = 0;
      let ftdAmount: number | null = null;
      let cpaCreditedAt: Date | null = null;
      if (ftdAt) {
        ftds++;
        ftdAmount = featured ? 100 : r.pick([20, 30, 50, 80, 100, 150]);
        evs.push({ type: "FTD", amount: ftdAmount, at: ftdAt });
        depositTotal += ftdAmount;
        deposits++;
        for (let k = r.int(0, 3); k > 0; k--) {
          const at = new Date(ftdAt.getTime() + r.next() * (now.getTime() - ftdAt.getTime()));
          if (at.getTime() >= now.getTime() - MIN) continue;
          const amount = r.pick([10, 20, 30, 50, 80]);
          evs.push({ type: "DEPOSIT", amount, at });
          depositTotal += amount;
          deposits++;
        }
        for (let k = r.int(1, 4); k > 0; k--) {
          const at = new Date(ftdAt.getTime() + r.next() * (now.getTime() - ftdAt.getTime()));
          if (at.getTime() >= now.getTime() - MIN) continue;
          const amount = r.amount(-20, 60);
          evs.push({ type: "NGR", amount, at });
          ngr += amount;
        }
        const credit = new Date(ftdAt.getTime() + DAY);
        if (credit < now && r.chance(0.7)) {
          cpaCreditedAt = credit;
          evs.push({ type: "CPA", amount: 40, at: credit });
        }
      }
      players.push({
        id: playerId,
        affiliateCampaignId: ctx.offerId[l.offer],
        externalPlayerId: ext,
        subId: first.subId,
        subIdSource: "postback",
        clickId: first.id,
        memberId,
        registeredAt,
        ftdAt,
        ftdAmount,
        depositCount: deposits,
        redepositCount: Math.max(0, deposits - 1),
        depositTotal: Math.round(depositTotal * 100) / 100,
        ngr: Math.round(ngr * 100) / 100,
        currency: "EUR",
        status: "active",
        cpaStatus: cpaCreditedAt ? "approved" : ftdAt ? "none" : null,
        cpaAmount: cpaCreditedAt ? 40 : null,
        cpaCreditedAt,
        lastEventAt: new Date(Math.max(...evs.map((e) => e.at.getTime()))),
        raw: { demo: true },
        createdAt: registeredAt,
      });
      for (const [j, e] of evs.entries())
        playerEvents.push({
          playerId,
          type: e.type,
          amount: e.amount,
          currency: e.amount === null ? null : "EUR",
          occurredAt: e.at,
          externalId: `${ext}-${e.type.toLowerCase()}-${j}`,
          raw: { demo: true },
        });
      events.push({
        type: "player.registered",
        occurredAt: registeredAt,
        memberId,
        payload: { playerId, demo: true },
      });
      if (ftdAt)
        events.push({
          type: "player.ftd",
          occurredAt: ftdAt,
          memberId,
          payload: { playerId, amount: ftdAmount, demo: true },
        });
    }
  }

  // Premier affilié gagne : un membre de Paul (Pronos Foot) demande ensuite « Casino VIP » par le lien de Sarah.
  const sarah = links.find((l) => l.key === "demotgsarah1")!;
  const paulFoot = members.find((m) => m.linkaffiCampaignKey === "demotgpaul02");
  if (paulFoot) {
    const at = notFuture(ago(3 * DAY + 5 * HOUR));
    const msId = newId();
    const approvedAt = new Date(at.getTime() + 20_000);
    const provenance = provenanceOfLink({
      id: sarah.id,
      kind: "LINKAFFI",
      sourceChannelId: null,
      adPlatform: null,
      linkaffiCampaignKey: sarah.key,
      linkaffiCampaignName: sarah.name,
      linkaffiAffiliateId: sarah.affiliateId,
      linkaffiAffiliateName: sarah.affiliateName,
    });
    memberships.push({
      id: msId,
      code: shortId(8),
      memberId: paulFoot.id!,
      channelId: ctx.channelId.casinoVip,
      status: "APPROVED",
      inviteLinkId: sarah.id,
      requestedAt: at,
      approveAt: approvedAt,
      approvedAt,
      joinedAt: new Date(approvedAt.getTime() + 15_000),
      approvedByBotId: sarah.botId,
      source: {
        demo: true,
        provenance: { ...provenance, label: provenanceLabel(provenance, {}, sarah.name) },
        telegramInviteLink: sarah.url,
        botId: sarah.botId,
      },
    });
    sarah.counters.requests++;
    sarah.counters.approved++;
    sarah.counters.joined++;
    events.push({
      memberId: paulFoot.id!,
      channelId: ctx.channelId.casinoVip,
      botId: sarah.botId,
      type: "membership.affiliate_not_attributed",
      occurredAt: at,
      payload: {
        membershipId: msId,
        inviteLinkId: sarah.id,
        campaignKey: sarah.key,
        campaignName: sarah.name,
        affiliateId: sarah.affiliateId,
        affiliateName: sarah.affiliateName,
        stage: "request",
        reason: "already_attributed",
        currentCampaignKey: "demotgpaul02",
        currentAffiliateId: P13_AFFILIATES[0].id,
        demo: true,
      },
    });
  }

  // Un événement abandonné (Link Affi injoignable pendant 24 h) : visible dans l'état de la file des réglages.
  const failedSource = memberships.find((m) => m.status === "DECLINED");
  if (failedSource) {
    const l = links.find((x) => x.id === failedSource.inviteLinkId)!;
    const m = members.find((x) => x.id === failedSource.memberId)!;
    const at = notFuture(ago(4 * DAY));
    const body = buildLinkaffiEvent({
      type: "join_requested",
      sourceId: `${failedSource.id}-relance`,
      occurredAt: at,
      campaignKey: l.key,
      channel: { id: ctx.channelId[l.channel], title: ctx.channelTitle[l.channel] },
      member: {
        telegramUserId: m.telegramUserId as bigint,
        username: (m.username as string | null) ?? null,
        firstName: (m.firstName as string | null) ?? null,
        languageCode: "fr",
      },
    });
    linkaffiEvents.push({
      eventId: body.eventId,
      type: "join_requested",
      occurredAt: at,
      campaignKey: l.key,
      memberId: m.id!,
      channelId: ctx.channelId[l.channel],
      body: body as unknown as Prisma.InputJsonValue,
      status: "FAILED",
      attempts: 13,
      nextAttemptAt: new Date(at.getTime() + DAY),
      lastError: "Link Affi injoignable (délai dépassé)",
      lastStatus: null,
      createdAt: at,
    });
  }

  await inBatches(members, 500, (chunk) => db.member.createMany({ data: chunk }));
  await inBatches(memberships, 500, (chunk) => db.membership.createMany({ data: chunk }));
  await inBatches(clicks, 1000, (chunk) => db.click.createMany({ data: chunk }));
  await inBatches(players, 500, (chunk) => db.player.createMany({ data: chunk }));
  await inBatches(playerEvents, 1000, (chunk) => db.playerEvent.createMany({ data: chunk }));
  await inBatches(events, 1000, (chunk) => db.event.createMany({ data: chunk }));
  await inBatches(linkaffiEvents, 1000, (chunk) => db.linkaffiEvent.createMany({ data: chunk }));
  for (const l of links) await db.inviteLink.update({ where: { id: l.id }, data: l.counters });
  for (const l of links) {
    const n = clicks.filter((c) => c.trackingLinkId === l.offerLinkId).length;
    await db.trackingLink.update({
      where: { id: l.offerLinkId },
      data: { clicks: n, uniqueClicks: n },
    });
  }

  // Relevé de la synchro Link Affi (forme D6) : leurs chiffres, et un écart sur les premiers dépôts de Paul.
  const campaignsSetting: Record<string, unknown> = {};
  const divergences: Array<Record<string, unknown>> = [];
  for (const l of links) {
    const ours = {
      members: members.filter((m) => m.linkaffiCampaignKey === l.key).length,
      registrations: players.filter(
        (p) => clicks.find((c) => c.id === p.clickId)?.linkaffiTelegramCampaignKey === l.key,
      ).length,
      ftds: players.filter(
        (p) =>
          p.ftdAt && clicks.find((c) => c.id === p.clickId)?.linkaffiTelegramCampaignKey === l.key,
      ).length,
    };
    const theirs = {
      ...ours,
      ftds: l.key === "demotgpaul01" ? Math.max(0, ours.ftds - 1) : ours.ftds,
    };
    if (theirs.ftds !== ours.ftds)
      divergences.push({ campaignKey: l.key, field: "ftds", ours: ours.ftds, theirs: theirs.ftds });
    campaignsSetting[l.key] = {
      affiliateId: l.affiliateId,
      affiliateName: l.affiliateName,
      name: l.name,
      inviteLinkId: l.id,
      channelId: ctx.channelId[l.channel],
      isActive: true,
      clicks: l.counters.requests * 3 + r.int(4, 30),
      ...theirs,
    };
  }
  const setting = {
    syncedAt: ago(3 * MIN).toISOString(),
    available: true,
    campaigns: campaignsSetting,
    divergences,
  } as Prisma.InputJsonValue;
  await db.setting.upsert({
    where: { key: "linkaffi.telegramCampaigns" },
    create: { key: "linkaffi.telegramCampaigns", value: setting },
    update: { value: setting },
  });

  return {
    campaigns: links.length,
    members: members.length,
    memberships: memberships.length,
    clicks: clicks.length,
    players: players.length,
    ftds,
    linkaffiEvents: linkaffiEvents.length,
  };
}

// ============================================================
// Phase 15 : pages d'atterrissage (rubrique « Pages »)
// ============================================================
//
// Deux pages : « Casino VIP — TikTok » (Casino VIP ; sources tk01 et tk03 reliées à deux pubs TikTok de la campagne
// « Casino Bienvenue TikTok », exo1 sans pub, et le lien principal) ; « Pronos
// du week-end » (Pronos Foot ; meta1 reliée à une pub Meta, story sans pub). 30 jours de visites (dont des robots,
// jamais comptés), de clics avec la façon d'ouvrir Telegram selon le téléphone, d'ouvertures de l'appli, et des
// demandes d'adhésion par les liens des sources (provenance LANDING enregistrée comme le fait le bot). Une exception
// « la page « Casino VIP — TikTok » » sur Casino VIP (tout de suite, sans canal à rejoindre). Tirage à part (graine
// propre) : les données des autres phases restent exactement les mêmes.
// Phase 16 (sortie de l'appli), sur les `P16_DEMO_DAYS` derniers jours : dans une appli, l'appui montre l'aide
// « Ouvrir dans le navigateur » (CLICK `TG_FRAME` / `TG_NAV` / `INTENT_HELP` puis HELP) ; Telegram s'ouvre rarement depuis
// l'appli ; une partie des personnes rouvre la page dans Safari ou Chrome (ESCAPED, même visite), où l'ouverture
// automatique est tentée (AUTO_OPEN `AUTO_TG` / `AUTO_INTENT`) et Telegram s'ouvre le plus souvent (OPENED) ; Chrome
// sur iPhone la refuse et la personne appuie sur le bouton (CLICK puis OPENED `HTTPS`). Quelques personnes ouvrent la
// page dans le navigateur avant d'appuyer : sortie « sans l'aide » (ESCAPED `TTCLID` / `FBCLID`, nouvelle visite).
// Avant : la façon d'ouvrir de la phase 15 (tirage `TG_SCHEME` / `HTTPS` dans TikTok).

const P15_MEMBER_ID_BASE = DEMO_MEMBER_ID_BASE + 800_000n;

/** Jours de démonstration avec la sortie de l'appli de la phase 16 (les plus récents). */
const P16_DEMO_DAYS = 5;

/** Phase 16 : part des visites rouvertes dans Safari ou Chrome après l'aide (démonstration), par appli et système. */
const P16_ESCAPE_RATE: Record<
  "TIKTOK" | "INSTAGRAM" | "FACEBOOK",
  { IOS: number; ANDROID: number }
> = {
  TIKTOK: { IOS: 0.47, ANDROID: 0.38 },
  INSTAGRAM: { IOS: 0.42, ANDROID: 0.4 },
  FACEBOOK: { IOS: 0.36, ANDROID: 0.34 },
};

const P15_PAGES: ReadonlyArray<{
  key: string;
  channel: ChannelKey;
  slug: string;
  name: string;
  headline: string;
  subtext: string | null;
  footnote: string | null;
  tiktokPixelId: string | null;
  createdDaysAgo: number;
  /** Sources : clé, pub reliée (campagne, nom de la pub), visites par jour (moyenne), navigateur intégré. */
  sources: ReadonlyArray<{
    key: string;
    ad: { campaign: number; name: string } | null;
    perDay: number;
    inApp: "TIKTOK" | "INSTAGRAM" | "FACEBOOK" | null;
  }>;
}> = [
  {
    key: "casino",
    channel: "casinoVip",
    slug: "demo-casino-vip",
    name: "Casino VIP — TikTok",
    headline: "Les meilleurs bonus casino, chaque soir",
    subtext: "Bonus exclusifs et alertes en direct, réservés aux membres.",
    footnote: "Gratuit · 1 clic · via Telegram",
    // Aucun pixel en démonstration : les captures et le contrôle axe ne doivent jamais appeler TikTok ni Meta.
    tiktokPixelId: null,
    createdDaysAgo: 32,
    sources: [
      { key: "", ad: null, perDay: 3, inApp: null },
      { key: "tk01", ad: { campaign: 0, name: "Vidéo bonus" }, perDay: 14, inApp: "TIKTOK" },
      { key: "tk03", ad: { campaign: 0, name: "Carrousel des gains" }, perDay: 9, inApp: "TIKTOK" },
      { key: "exo1", ad: null, perDay: 5, inApp: null },
    ],
  },
  {
    key: "foot",
    channel: "sportsFoot",
    slug: "demo-pronos-foot",
    name: "Pronos du week-end",
    headline: "Nos pronos du week-end, gratuits",
    subtext: null,
    footnote: null,
    tiktokPixelId: null,
    createdDaysAgo: 20,
    sources: [
      { key: "", ad: null, perDay: 2, inApp: null },
      { key: "meta1", ad: { campaign: 1, name: "Ligue 1 · A" }, perDay: 8, inApp: "INSTAGRAM" },
      { key: "story", ad: null, perDay: 4, inApp: "FACEBOOK" },
    ],
  },
];

const P15_UA = {
  IOS_TIKTOK:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store",
  ANDROID_TIKTOK:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 trill_360500 BytedanceWebview/d8a21c6",
  IOS_INSTAGRAM:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 355.0.0.21.108 (iPhone15,2; iOS 18_1; fr_FR)",
  ANDROID_FACEBOOK:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/482.0.0.40.79;]",
  IOS_SAFARI:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  IOS_CHROME:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  ANDROID_CHROME:
    "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  DESKTOP:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  BOT: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
} as const;

async function createPhase15Demo(
  db: Db,
  ctx: {
    now: Date;
    adminId: string;
    botIdByVertical: Record<Vertical, string>;
    channelId: Record<ChannelKey, string>;
    channelTitle: Record<ChannelKey, string>;
    channelVertical: Record<ChannelKey, Vertical>;
    ruleIdOf: (k: ChannelKey) => string;
    adOf: (campaignIndex: number, adName: string) => { id: string; campaignId: string } | null;
  },
): Promise<{
  pages: number;
  sources: number;
  events: number;
  memberships: number;
  help: number;
  escaped: number;
}> {
  const { now } = ctx;
  const r = createRandom(SEED + 15);
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const notFuture = (d: Date) =>
    d.getTime() > now.getTime() - MIN ? new Date(now.getTime() - MIN) : d;
  const PARIS_EVENING = [12, 13, 18, 19, 20, 21, 21, 22, 22, 23];

  const events: Prisma.LandingEventCreateManyInput[] = [];
  const members: Prisma.MemberCreateManyInput[] = [];
  const memberships: Prisma.MembershipCreateManyInput[] = [];
  const journal: Prisma.EventCreateManyInput[] = [];
  let memberIndex = 0;
  let sourceCount = 0;

  // Exception de la page Casino VIP : tout de suite, sans canal à rejoindre (la règle du canal en demande un).
  const casinoPageId = stableId("p15:page:casino");
  const exceptionId = stableId("p15:rule:casinoVip:page");
  const exceptionLabel = frQuotesDemo(`Venu de la page « ${P15_PAGES[0]!.name} »`);
  await db.landingPage.create({
    data: {
      id: casinoPageId,
      slug: P15_PAGES[0]!.slug,
      name: P15_PAGES[0]!.name,
      channelId: ctx.channelId[P15_PAGES[0]!.channel],
      headline: P15_PAGES[0]!.headline,
      subtext: P15_PAGES[0]!.subtext,
      footnote: P15_PAGES[0]!.footnote,
      tiktokPixelId: P15_PAGES[0]!.tiktokPixelId,
      createdById: ctx.adminId,
      createdAt: ago(P15_PAGES[0]!.createdDaysAgo * DAY),
    },
  });
  await db.approvalRule.create({
    data: {
      id: exceptionId,
      channelId: ctx.channelId.casinoVip,
      name: exceptionLabel,
      label: exceptionLabel,
      isDefault: false,
      scope: "SOURCE_KIND",
      sourceKind: "LANDING_PAGE",
      landingPageId: casinoPageId,
      sortOrder: 30,
      sendWelcome: true,
      sendAcceptedMessage: true,
      mode: "DELAY",
      delaySeconds: 120,
      gateMode: "NONE",
      gateChannelIds: [],
      reminderAfterMinutes: [],
      maxReminders: 0,
      expireAfterHours: null,
      expireAction: "KEEP",
      createdAt: ago(30 * DAY),
    },
  });

  for (const page of P15_PAGES) {
    const pageId = stableId(`p15:page:${page.key}`);
    const channelId = ctx.channelId[page.channel];
    const vertical = ctx.channelVertical[page.channel];
    const botId = ctx.botIdByVertical[vertical];
    const createdAt = ago(page.createdDaysAgo * DAY);
    if (pageId !== casinoPageId)
      await db.landingPage.create({
        data: {
          id: pageId,
          slug: page.slug,
          name: page.name,
          channelId,
          headline: page.headline,
          subtext: page.subtext,
          footnote: page.footnote,
          tiktokPixelId: page.tiktokPixelId,
          createdById: ctx.adminId,
          createdAt,
        },
      });
    const rule =
      page.channel === "casinoVip"
        ? { id: exceptionId, scope: "SOURCE_KIND" as const, label: exceptionLabel, delay: 120 }
        : { id: ctx.ruleIdOf(page.channel), scope: "DEFAULT" as const, label: null, delay: 300 };

    for (const src of page.sources) {
      sourceCount++;
      const ad = src.ad ? ctx.adOf(src.ad.campaign, src.ad.name) : null;
      const linkId = stableId(`p15:link:${page.key}:${src.key || "main"}`);
      const linkName = landingInviteLinkName(page.name, src.key);
      const url = `https://t.me/+DEMO15${page.key}${src.key || "main"}${shortId(5)}`;
      const counters = { requests: 0, approved: 0, joined: 0, left: 0 };
      await db.inviteLink.create({
        data: {
          id: linkId,
          channelId,
          botId,
          telegramInviteLink: url,
          name: linkName,
          kind: "LANDING",
          createsJoinRequest: true,
          // Source reliée à une pub : ses demandes comptent aussi pour la pub et sa campagne, figées sur le lien (D9).
          campaignId: ad?.campaignId ?? null,
          landingAdId: ad?.id ?? null,
          landingPageId: pageId,
          landingSource: src.key,
          createdById: ctx.adminId,
          createdAt,
        },
      });
      await db.landingSource.create({
        data: {
          id: stableId(`p15:source:${page.key}:${src.key || "main"}`),
          landingPageId: pageId,
          key: src.key,
          inviteLinkId: linkId,
          adId: ad?.id ?? null,
          createdAt,
        },
      });

      const provenanceLink: ProvenanceLink = {
        id: linkId,
        kind: "LANDING",
        sourceChannelId: null,
        adPlatform: null,
        landingPageId: pageId,
        landingSource: src.key,
      };
      const provenance = provenanceOfLink(provenanceLink);
      const label = frQuotesDemo(
        provenanceLabel(provenance, {}, linkName, { [pageId]: page.name }),
      );

      for (let n = page.createdDaysAgo - 1; n >= 0; n--) {
        // Moins de visites le premier jour et aujourd'hui (journée pas finie), un peu plus le week-end.
        const dayStart = new Date(parisDayStart(now).getTime() - n * DAY);
        const weekend = [0, 6].includes(new Date(dayStart.getTime() + 12 * HOUR).getUTCDay());
        const visits = Math.max(
          0,
          Math.round(
            src.perDay * (0.55 + r.next() * 0.9) * (weekend ? 1.3 : 1) * (n === 0 ? 0.6 : 1),
          ),
        );
        for (let v = 0; v < visits; v++) {
          const at = new Date(
            dayStart.getTime() +
              (r.pick(PARIS_EVENING) - 2) * HOUR +
              r.int(0, 59) * MIN +
              r.int(0, 59) * 1000,
          );
          if (at.getTime() > now.getTime() - 2 * MIN) continue;
          const os = r.weighted<"IOS" | "ANDROID" | "OTHER">([
            ["IOS", 58],
            ["ANDROID", 37],
            ["OTHER", 5],
          ]);
          const inApp = os === "OTHER" ? null : src.inApp;
          const ua =
            os === "OTHER"
              ? P15_UA.DESKTOP
              : inApp === "TIKTOK"
                ? os === "IOS"
                  ? P15_UA.IOS_TIKTOK
                  : P15_UA.ANDROID_TIKTOK
                : inApp === "INSTAGRAM"
                  ? P15_UA.IOS_INSTAGRAM
                  : inApp === "FACEBOOK"
                    ? P15_UA.ANDROID_FACEBOOK
                    : os === "IOS"
                      ? P15_UA.IOS_SAFARI
                      : P15_UA.ANDROID_CHROME;
          const visitId = shortId(16);
          const country = r.weighted<string>([
            ["FR", 78],
            ["BE", 9],
            ["CH", 6],
            ["CA", 4],
            ["LU", 3],
          ]);
          const base = {
            landingPageId: pageId,
            sourceKey: src.key,
            visitId,
            os,
            inApp,
            country,
            ipHash: shortId(24),
            isBot: false,
            ttclid: inApp === "TIKTOK" && r.chance(0.8) ? `E.C.P.${shortId(18)}` : null,
            fbclid:
              inApp === "INSTAGRAM" || inApp === "FACEBOOK" ? `IwZXh0bgNhZW0${shortId(16)}` : null,
            userAgent: ua,
            // Adresse de pub mal recopiée (« tk1 » au lieu de « tk01 ») : servie avec le lien principal, signalée.
            rawSrc: page.key === "casino" && src.key === "" && r.chance(0.3) ? "tk1" : null,
          };
          events.push({ ...base, type: "VIEW", createdAt: at });
          if (!r.chance(os === "OTHER" ? 0.25 : 0.42)) {
            // Phase 16 : quelques personnes ouvrent la page dans Safari ou Chrome AVANT d'appuyer (sans voir l'aide) ;
            // venue d'une pub, la page rouverte est reconnue par l'identifiant de clic (nouvelle visite) : sortie
            // « sans l'aide », comptée dans les sortis mais jamais dans le % sortis ; ouverture automatique.
            if (
              n < P16_DEMO_DAYS &&
              inApp &&
              os !== "OTHER" &&
              (base.ttclid || base.fbclid) &&
              r.chance(0.1)
            ) {
              const outside = {
                ...base,
                visitId: shortId(16),
                inApp: null,
                userAgent: os === "IOS" ? P15_UA.IOS_SAFARI : P15_UA.ANDROID_CHROME,
              };
              const outAt = new Date(at.getTime() + r.int(5, 40) * 1000);
              const auto = os === "IOS" ? "AUTO_TG" : "AUTO_INTENT";
              events.push({ ...outside, type: "VIEW", createdAt: outAt });
              events.push({
                ...outside,
                type: "ESCAPED",
                method: base.ttclid ? "TTCLID" : "FBCLID",
                createdAt: new Date(outAt.getTime() + r.int(5, 60)),
              });
              events.push({
                ...outside,
                type: "AUTO_OPEN",
                method: auto,
                createdAt: new Date(outAt.getTime() + r.int(70, 120)),
              });
              if (r.chance(0.7))
                events.push({
                  ...outside,
                  type: "OPENED",
                  method: auto,
                  createdAt: new Date(outAt.getTime() + r.int(800, 4000)),
                });
            }
            continue;
          }
          const clickAt = new Date(at.getTime() + r.int(2, 25) * 1000);
          let opened = false;
          let openedAt = clickAt;
          if (n < P16_DEMO_DAYS && inApp && os !== "OTHER") {
            // Phase 16, comme le vrai script : aide « Ouvrir dans le navigateur » tout de suite, puis tentative sans quitter
            // la page : applis Meta (Instagram, Facebook) intent:// sur Android et tg:// dans le geste sur iPhone, cadre
            // caché tg:// ailleurs (TikTok, autres applis).
            const meta = inApp === "INSTAGRAM" || inApp === "FACEBOOK";
            const method = meta ? (os === "ANDROID" ? "INTENT_HELP" : "TG_NAV") : "TG_FRAME";
            events.push({ ...base, type: "CLICK", method, createdAt: clickAt });
            events.push({
              ...base,
              type: "HELP",
              method: inApp,
              createdAt: new Date(clickAt.getTime() + r.int(30, 300)),
            });
            if (r.chance(inApp === "TIKTOK" ? 0.03 : os === "IOS" ? 0.18 : 0.3)) {
              opened = true;
              openedAt = new Date(clickAt.getTime() + r.int(300, 1500));
              events.push({ ...base, type: "OPENED", method, createdAt: openedAt });
            } else if (r.chance(P16_ESCAPE_RATE[inApp][os])) {
              // Page rouverte dans Safari ou Chrome (même visite, marqueur `tgo` + `vid`), ouverture automatique.
              // Chrome sur iPhone la refuse (aucun geste) : la personne appuie alors sur le bouton (lien natif).
              const chromeIos = os === "IOS" && r.chance(0.15);
              const outside = {
                ...base,
                inApp: null,
                userAgent: chromeIos
                  ? P15_UA.IOS_CHROME
                  : os === "IOS"
                    ? P15_UA.IOS_SAFARI
                    : P15_UA.ANDROID_CHROME,
              };
              const escapedAt = new Date(clickAt.getTime() + r.int(4, 30) * 1000);
              const auto = os === "IOS" ? "AUTO_TG" : "AUTO_INTENT";
              events.push({ ...outside, type: "ESCAPED", method: "TGO", createdAt: escapedAt });
              events.push({
                ...outside,
                type: "AUTO_OPEN",
                method: auto,
                createdAt: new Date(escapedAt.getTime() + r.int(5, 60)),
              });
              if (!chromeIos && r.chance(os === "IOS" ? 0.86 : 0.8)) {
                opened = true;
                openedAt = new Date(escapedAt.getTime() + r.int(600, 4000));
                events.push({ ...outside, type: "OPENED", method: auto, createdAt: openedAt });
              } else if (r.chance(0.6)) {
                // Telegram ouvert par un appui après la sortie (compté dans « Telegram ouvert après la sortie »).
                const tapAt = new Date(escapedAt.getTime() + r.int(2, 12) * 1000);
                opened = true;
                openedAt = new Date(tapAt.getTime() + r.int(300, 1500));
                events.push({ ...outside, type: "CLICK", method: "HTTPS", createdAt: tapAt });
                events.push({ ...outside, type: "OPENED", method: "HTTPS", createdAt: openedAt });
              }
            }
          } else {
            // Façon d'ouvrir Telegram de la phase 15 : tirage tg:// ou lien https dans TikTok (iPhone et Android),
            // tg:// dans les autres applis sur iPhone, intent:// dans Instagram et Facebook sur Android, lien https
            // ailleurs (et toujours dans Safari, Chrome ou sur ordinateur).
            const method =
              inApp === "TIKTOK" && os !== "OTHER"
                ? r.chance(0.5)
                  ? "TG_SCHEME"
                  : "HTTPS"
                : os === "IOS" && inApp
                  ? "TG_SCHEME"
                  : os === "ANDROID" && inApp
                    ? "INTENT"
                    : "HTTPS";
            events.push({ ...base, type: "CLICK", method, createdAt: clickAt });
            const openRate =
              method === "TG_SCHEME"
                ? os === "IOS"
                  ? 0.81
                  : 0.62
                : method === "INTENT"
                  ? 0.74
                  : 0.55;
            opened = r.chance(openRate);
            if (opened) {
              openedAt = new Date(clickAt.getTime() + r.int(200, 1500));
              events.push({ ...base, type: "OPENED", method, createdAt: openedAt });
            }
          }
          // Demande d'adhésion par le lien de la source (une partie des personnes qui ont ouvert Telegram).
          if (!opened || !r.chance(0.34)) continue;
          const requestedAt = notFuture(new Date(openedAt.getTime() + r.int(4, 40) * 1000));
          const recent = now.getTime() - requestedAt.getTime() < rule.delay * 1000 + 3 * MIN;
          const status = recent
            ? "SCHEDULED"
            : r.weighted<"APPROVED" | "LEFT">([
                ["APPROVED", 88],
                ["LEFT", 12],
              ]);
          const approvedAt =
            status === "SCHEDULED"
              ? null
              : notFuture(new Date(requestedAt.getTime() + (rule.delay + r.int(1, 30)) * 1000));
          const joinedAt = approvedAt
            ? notFuture(new Date(approvedAt.getTime() + r.int(2, 60) * 1000))
            : null;
          const leftAt =
            status === "LEFT" && joinedAt
              ? notFuture(new Date(joinedAt.getTime() + r.int(1, 9) * DAY))
              : null;
          const memberId = stableId(`p15:member:${memberIndex}`);
          const firstName = r.pick(FIRST_NAMES);
          members.push({
            id: memberId,
            telegramUserId: P15_MEMBER_ID_BASE + BigInt(memberIndex++),
            firstName,
            lastName: r.chance(0.4) ? `${r.pick(LAST_INITIALS.split(""))}.` : null,
            username: r.chance(0.6)
              ? `${firstName
                  .toLowerCase()
                  .normalize("NFD")
                  .replace(/[^a-z]/g, "")}${r.int(10, 99)}`
              : null,
            languageCode: "fr",
            firstSeenAt: requestedAt,
            lastSeenAt: leftAt ?? joinedAt ?? requestedAt,
            tags: [],
          });
          const msId = newId();
          memberships.push({
            id: msId,
            code: shortId(8),
            memberId,
            channelId,
            status,
            inviteLinkId: linkId,
            approvalRuleId: rule.id,
            requestedAt,
            approveAt:
              status === "SCHEDULED"
                ? new Date(requestedAt.getTime() + rule.delay * 1000)
                : approvedAt,
            approvedAt,
            joinedAt,
            leftAt,
            approvedByBotId: approvedAt ? botId : null,
            source: {
              demo: true,
              inviteLink: { id: linkId, name: linkName, kind: "LANDING" },
              provenance: { ...provenance, label },
              appliedRule: { id: rule.id, scope: rule.scope, label: rule.label },
              rule: { id: rule.id, mode: "DELAY", delaySeconds: rule.delay, gateMode: "NONE" },
              gates: [],
              telegramInviteLink: url,
              botId,
            },
          });
          counters.requests++;
          if (approvedAt) counters.approved++;
          if (joinedAt) counters.joined++;
          if (leftAt) counters.left++;
          journal.push({
            type: "membership.requested",
            occurredAt: requestedAt,
            memberId,
            channelId,
            botId,
            payload: { membershipId: msId, inviteLinkId: linkId, demo: true },
          });
        }
        // Robots connus (aperçus de liens, vérificateurs des régies) : enregistrés, jamais comptés.
        if (r.chance(0.5))
          events.push({
            landingPageId: pageId,
            sourceKey: src.key,
            visitId: shortId(16),
            type: "VIEW",
            os: "OTHER",
            inApp: null,
            country: "US",
            ipHash: shortId(24),
            isBot: true,
            userAgent: P15_UA.BOT,
            createdAt: new Date(dayStart.getTime() + r.int(1, 10) * HOUR),
          });
      }
      await db.inviteLink.update({ where: { id: linkId }, data: counters });
    }
  }

  const written = events.filter((e) => (e.createdAt as Date).getTime() <= now.getTime() - MIN);
  await inBatches(written, 2000, (chunk) => db.landingEvent.createMany({ data: chunk }));
  await inBatches(members, 500, (chunk) => db.member.createMany({ data: chunk }));
  await inBatches(memberships, 500, (chunk) => db.membership.createMany({ data: chunk }));
  await inBatches(journal, 1000, (chunk) => db.event.createMany({ data: chunk }));
  return {
    pages: P15_PAGES.length,
    sources: sourceCount,
    events: events.length,
    memberships: memberships.length,
    help: written.filter((e) => e.type === "HELP").length,
    escaped: written.filter((e) => e.type === "ESCAPED").length,
  };
}

// ============================================================
// Phase 17 : assistant de conversation (contrat docs/ASSISTANT-CONVERSATION.md)
// ============================================================

// Un 4e bot de démonstration en mode ASSISTANT (univers Rencontres, jeton factice chiffré, administrateur d'AUCUN canal),
// lié à la persona « Léa » (active ; offre « Cœurs à prendre — Inscription gratuite » et campagne « Rencontres Été » ;
// fiche de l'offre courte et vraie ; description du bot qui dit « l'assistante du canal »). Réglage `assistant.venice`
// en « essai par l'équipe » et SANS clé : aucun appel à l'IA n'est possible depuis la base locale. Six conversations
// écrites comme le feraient le webhook, le worker et l'équipe (tutoiement, messages courts, la première réponse de
// l'assistante la présente toujours comme l'assistante du canal) : accueil seul, proposition, lien envoyé et ouvert,
// inscription et premier dépôt, reprise par l'équipe, arrêt par /stop. Passages d'étape, liens de l'offre (un
// identifiant de suivi par envoi), clics, coûts de l'IA (dont trois essais « Tester ») et journal sans aucun texte.
// La personne de la conversation « lien envoyé » est reliée au compte Telegram du manager de démonstration : pendant
// l'essai, c'est la seule à qui l'assistante répond (les autres lignes affichent « Personne ne répond »).
// Aucun tirage au hasard : les données des autres phases restent exactement les mêmes.

export const P17_BOT = {
  name: `${DEMO_PREFIX}Léa · assistante Rencontres`,
  username: "demo_lea_assistante_bot",
  tgId: DEMO_BOT_IDS[3]!,
  vertical: "DATING" as const,
};
export const P17_PERSONA_ID = stableId("persona:lea");
const P17_MODEL = "venice-uncensored-role-play";

/** Persona de démonstration : textes tels que l'équipe les saisirait dans la fiche. */
export const P17_PERSONA = {
  name: "Léa",
  gender: "F",
  personality:
    "Souriante, curieuse et un brin taquine. Elle aime les voyages, les séries et les sorties entre amis. Elle écoute plus qu'elle ne parle et pose une seule question à la fois.",
  tone: "Tutoiement, phrases courtes, un emoji de temps en temps. Jamais lourde ni insistante.",
  languages: ["fr"],
  interests: ["voyages", "séries", "concerts", "cuisine"],
  extraPrompt:
    "Si la personne n'a pas envie de parler de l'appli, n'insiste pas et continue simplement la discussion.",
  offerPitch:
    "Cœurs à prendre est une appli de rencontres. L'inscription est gratuite. On crée son profil en quelques minutes, on ajoute ses photos et ses centres d'intérêt, puis on découvre des profils selon ses critères.",
  offerButtonText: "Découvrir l'app",
  botDescription:
    "Moi c'est Léa, l'assistante du canal Rencontres : une IA, pas une vraie personne. Écris-moi quand tu veux ! /stop pour arrêter, /reset pour tout effacer.",
  botShortDescription: "Léa, l'assistante du canal (une IA)",
} as const;

/**
 * Réglage `assistant.venice` (forme de `packages/chat/src/config.ts`) : essai par l'équipe, SANS clé (aucun appel
 * possible), valeurs par défaut pour le reste, liste des modèles pas encore relue.
 */
export const P17_ASSISTANT_SETTING = {
  apiKeyEncrypted: null,
  activation: "team",
  defaultModel: P17_MODEL,
  fallbackModel: "venice-uncensored-1-2",
  temperature: 0.85,
  maxTokens: 400,
  monthlyCapEur: 30,
  perConversationDailyLimit: 60,
  models: [],
  modelsFetchedAt: null,
  verifiedAt: null,
  lastError: null,
} as const;

type P17Stage =
  "WELCOME" | "CHAT" | "PROPOSAL" | "LINK_SENT" | "FOLLOW_UP" | "CONVERTED" | "CLOSED";
/** Ligne du fil ; `ago` : minutes avant maintenant. */
export type P17Line =
  | { ago: number; kind: "start"; source: string | null }
  | { ago: number; kind: "in"; text: string }
  | { ago: number; kind: "lea"; text: string; offer?: true; followUp?: true }
  | { ago: number; kind: "team"; text: string }
  | { ago: number; kind: "stopDone"; text: string };
export type P17Event = {
  ago: number;
  type: string;
  from?: P17Stage;
  to?: P17Stage;
  payload?: Record<string, unknown>;
};
export type P17Conversation = {
  key: string;
  stage: P17Stage;
  status: "BOT" | "HUMAN" | "CLOSED";
  closedReason?: "STOP";
  lines: P17Line[];
  /** Événements du parcours (sans texte) ; les identifiants des liens sont ajoutés aux `offer_*`. */
  events: P17Event[];
  /** Première ouverture du lien de l'offre et nombre d'ouvertures. */
  opened?: { ago: number; opens: number };
  /** Inscription (et premier dépôt) rattachée au clic ; conversion relevée par le balayage du worker. */
  player?: {
    registeredAgo: number;
    ftdAgo: number | null;
    ftdAmount: number;
    convertedAgo: number;
  };
  takenOverAgo?: number;
  stoppedAgo?: number;
  /** Personne reliée au compte Telegram du manager de démonstration (essai « Seulement l'équipe »). */
  team?: true;
  style: Record<string, string | number>;
  facts: string[];
  followUpCount?: number;
};

const P17_STOP_DONE = "C'est noté, je ne t'écrirai plus. Bonne continuation !";

export const P17_CONVERSATIONS: P17Conversation[] = [
  {
    key: "accueil",
    stage: "WELCOME",
    status: "BOT",
    lines: [
      { ago: 26, kind: "start", source: "tk02" },
      { ago: 25.9, kind: "lea", text: "Salut ! Moi c'est Léa, l'assistante du canal 😉" },
      { ago: 25.8, kind: "lea", text: "Bienvenue par ici ! Qu'est-ce qui t'amène sur le canal ?" },
    ],
    events: [],
    style: { language: "fr" },
    facts: [],
  },
  {
    key: "proposition",
    stage: "PROPOSAL",
    status: "BOT",
    lines: [
      { ago: 300, kind: "start", source: "insta" },
      {
        ago: 299.9,
        kind: "lea",
        text: "Hello ! Moi c'est Léa, l'assistante du canal 😊 Qu'est-ce qui t'amène ?",
      },
      { ago: 290, kind: "in", text: "je viens d'arriver à Paris et je connais pas grand monde" },
      { ago: 289.8, kind: "lea", text: "Bienvenue à Paris alors ! Tu viens d'où à la base ?" },
      { ago: 282, kind: "in", text: "de Nantes. dis moi t'es une vraie personne ?" },
      {
        ago: 281.8,
        kind: "lea",
        text: "Je préfère être franche : je suis une IA, l'assistante virtuelle du canal 🙂",
      },
      {
        ago: 281.6,
        kind: "lea",
        text: "Mais je peux quand même te donner des idées pour rencontrer du monde !",
      },
      { ago: 275, kind: "in", text: "ok merci d'être honnête. tu conseilles quoi ?" },
      {
        ago: 274.8,
        kind: "lea",
        text: "Les afterworks et les cours collectifs, c'est top pour commencer.",
      },
      {
        ago: 274.6,
        kind: "lea",
        text: "Et sinon il y a les applis de rencontres. Tu en as déjà essayé une ?",
      },
      { ago: 268, kind: "in", text: "jamais, ça me fait un peu peur" },
      {
        ago: 267.8,
        kind: "lea",
        text: "Je comprends 😊 Celle que l'équipe recommande, c'est Cœurs à prendre : une appli de rencontres, et l'inscription est gratuite. Ça te dirait d'y jeter un œil ?",
      },
    ],
    events: [
      { ago: 290, type: "stage_changed", from: "WELCOME", to: "CHAT" },
      { ago: 267.8, type: "stage_changed", from: "CHAT", to: "PROPOSAL" },
    ],
    style: {
      length: "short",
      emojis: "none",
      register: "casual",
      language: "fr",
      tone: "shy",
      interest: 6,
    },
    facts: [
      "vient d'arriver à Paris",
      "vient de Nantes",
      "n'a jamais essayé d'appli de rencontres",
    ],
  },
  {
    key: "lien-envoye",
    stage: "LINK_SENT",
    status: "BOT",
    team: true,
    lines: [
      { ago: 1400, kind: "start", source: "tk01" },
      {
        ago: 1399.9,
        kind: "lea",
        text: "Salut, moi c'est Léa, l'assistante du canal 😊 Ravie de te voir ! Tu es du coin ?",
      },
      { ago: 1390, kind: "in", text: "salut Léa ! oui je suis sur Paris" },
      { ago: 1389.8, kind: "lea", text: "Top ! Et tu fais quoi de ton temps libre ?" },
      { ago: 1380, kind: "in", text: "du sport, des concerts, et voyager dès que je peux" },
      {
        ago: 1379.8,
        kind: "lea",
        text: "Les concerts, j'adore l'ambiance ! C'était quoi ton dernier ?",
      },
      { ago: 1370, kind: "in", text: "un festival cet été, c'était génial" },
      {
        ago: 1369.8,
        kind: "lea",
        text: "Ça devait être une super ambiance 🎶 Et côté rencontres, tu as déjà testé une appli ?",
      },
      { ago: 1360, kind: "in", text: "un peu mais j'ai pas trop accroché" },
      {
        ago: 1359.8,
        kind: "lea",
        text: "Je vois. Celle que l'équipe recommande, c'est Cœurs à prendre : l'inscription est gratuite et tu choisis toi-même tes critères.",
      },
      {
        ago: 1359.6,
        kind: "lea",
        text: "Je te laisse le lien ici si tu veux regarder 😉",
        offer: true,
      },
      { ago: 1350, kind: "in", text: "ok je regarde ça ce soir" },
      { ago: 1349.8, kind: "lea", text: "Super ! Tu me diras ce que tu en penses 😊" },
    ],
    events: [
      { ago: 1390, type: "stage_changed", from: "WELCOME", to: "CHAT" },
      { ago: 1359.8, type: "stage_changed", from: "CHAT", to: "PROPOSAL" },
      { ago: 1359.6, type: "stage_changed", from: "PROPOSAL", to: "LINK_SENT" },
      { ago: 1359.6, type: "offer_sent", payload: { offerSends: 1 } },
      { ago: 1290, type: "offer_opened" },
    ],
    opened: { ago: 1290, opens: 2 },
    style: {
      length: "medium",
      emojis: "few",
      register: "casual",
      language: "fr",
      tone: "chatty",
      interest: 8,
    },
    facts: [
      "habite à Paris",
      "aime le sport, les concerts et les voyages",
      "a déjà essayé une appli de rencontres sans accrocher",
    ],
  },
  {
    key: "inscrit",
    stage: "CONVERTED",
    status: "BOT",
    lines: [
      { ago: 7300, kind: "start", source: "meta1" },
      {
        ago: 7299.9,
        kind: "lea",
        text: "Coucou ! Moi c'est Léa, l'assistante du canal 😉 Comment tu vas ?",
      },
      { ago: 7290, kind: "in", text: "ça va et toi ? je cherche quelqu'un de sérieux" },
      {
        ago: 7289.8,
        kind: "lea",
        text: "Ça va bien, merci ! Sérieux, c'est noté 🙂 Tu es de quelle ville ?",
      },
      { ago: 7282, kind: "in", text: "Lyon" },
      {
        ago: 7281.8,
        kind: "lea",
        text: "Lyon, belle ville ! Plutôt un verre en terrasse ou une balade au bord du Rhône ?",
      },
      { ago: 7275, kind: "in", text: "un verre en terrasse c'est parfait" },
      {
        ago: 7274.8,
        kind: "lea",
        text: "Je valide 😄 L'équipe recommande Cœurs à prendre : une appli de rencontres, l'inscription est gratuite.",
      },
      { ago: 7268, kind: "in", text: "ah ouais envoie" },
      {
        ago: 7267.8,
        kind: "lea",
        text: "Voilà le lien 👇 Tu crées ton profil en quelques minutes.",
        offer: true,
      },
      { ago: 7230, kind: "in", text: "c'est bon je me suis inscrit !" },
      {
        ago: 7229.8,
        kind: "lea",
        text: "Génial ! Ajoute de belles photos et tes centres d'intérêt, ça aide vraiment 😊",
      },
      { ago: 7225, kind: "in", text: "merci Léa" },
      { ago: 7224.8, kind: "lea", text: "Avec plaisir ! Bonne chance pour tes rencontres 🍀" },
    ],
    events: [
      { ago: 7290, type: "stage_changed", from: "WELCOME", to: "CHAT" },
      { ago: 7274.8, type: "stage_changed", from: "CHAT", to: "PROPOSAL" },
      { ago: 7267.8, type: "stage_changed", from: "PROPOSAL", to: "LINK_SENT" },
      { ago: 7267.8, type: "offer_sent", payload: { offerSends: 1 } },
      { ago: 7262, type: "offer_opened" },
      { ago: 7234, type: "stage_changed", from: "LINK_SENT", to: "CONVERTED" },
      { ago: 7234, type: "converted" },
    ],
    opened: { ago: 7262, opens: 1 },
    player: { registeredAgo: 7236, ftdAgo: 4300, ftdAmount: 20, convertedAgo: 7234 },
    style: {
      length: "short",
      emojis: "few",
      register: "casual",
      language: "fr",
      tone: "direct",
      interest: 9,
    },
    facts: ["cherche une relation sérieuse", "habite à Lyon", "aime les verres en terrasse"],
  },
  {
    key: "equipe",
    stage: "CHAT",
    status: "HUMAN",
    lines: [
      { ago: 600, kind: "start", source: "tk02" },
      {
        ago: 599.9,
        kind: "lea",
        text: "Salut ! Moi c'est Léa, l'assistante du canal 😊 Qu'est-ce qui t'amène ?",
      },
      { ago: 590, kind: "in", text: "bonjour, je vois pas les messages du canal, c'est normal ?" },
      {
        ago: 589.8,
        kind: "lea",
        text: "Hmm, tu as bien rejoint le canal ? Parfois il suffit de rouvrir Telegram 🙂",
      },
      { ago: 585, kind: "in", text: "oui j'ai demandé à rejoindre mais je vois toujours rien" },
      {
        ago: 581,
        kind: "team",
        text: "Bonjour, ici l'équipe du canal 👋 Je prends le relais : ta demande pour rejoindre le canal était encore en attente, elle vient d'être acceptée. Tu devrais tout voir maintenant !",
      },
      { ago: 570, kind: "in", text: "ah oui ça marche, merci beaucoup !" },
    ],
    events: [
      { ago: 590, type: "stage_changed", from: "WELCOME", to: "CHAT" },
      { ago: 587, type: "taken_over", payload: { fromStatus: "BOT", via: "button" } },
    ],
    takenOverAgo: 587,
    style: { length: "short", emojis: "none", register: "neutral", language: "fr", tone: "direct" },
    facts: ["a demandé à rejoindre le canal"],
  },
  {
    key: "stop",
    stage: "CLOSED",
    status: "CLOSED",
    closedReason: "STOP",
    lines: [
      { ago: 5800, kind: "start", source: null },
      {
        ago: 5799.9,
        kind: "lea",
        text: "Hello ! Moi c'est Léa, l'assistante du canal 😉 Tu cherches quoi par ici ?",
      },
      { ago: 5790, kind: "in", text: "je sais pas trop, je regarde" },
      {
        ago: 5789.8,
        kind: "lea",
        text: "Pas de souci, prends ton temps 🙂 Tu es plutôt sorties ou soirées canapé ?",
      },
      {
        ago: 4349,
        kind: "lea",
        followUp: true,
        text: "Coucou ! Je repasse juste te souhaiter une bonne journée 😊 Si tu as une question sur le canal, je suis là.",
      },
      // /stop (avec la barre oblique) n'est pas gardé dans le fil : seule la réponse fixe l'est.
      { ago: 4200, kind: "stopDone", text: P17_STOP_DONE },
    ],
    events: [
      { ago: 5790, type: "stage_changed", from: "WELCOME", to: "CHAT" },
      { ago: 4349, type: "follow_up_sent", payload: { number: 1 } },
      { ago: 4349, type: "stage_changed", from: "CHAT", to: "FOLLOW_UP" },
      { ago: 4200, type: "stopped" },
      {
        ago: 4200,
        type: "stage_changed",
        from: "FOLLOW_UP",
        to: "CLOSED",
        payload: { reason: "STOP" },
      },
    ],
    stoppedAgo: 4200,
    followUpCount: 1,
    style: {
      length: "short",
      emojis: "none",
      register: "casual",
      language: "fr",
      tone: "dry",
      interest: 2,
    },
    facts: [],
  },
];

/** Prénoms masculins du catalogue : public habituel des canaux Rencontres de démonstration. */
const P17_MEMBER_NAMES = new Set([
  "Lucas",
  "Hugo",
  "Louis",
  "Nathan",
  "Enzo",
  "Théo",
  "Mathis",
  "Tom",
  "Noah",
  "Gabriel",
  "Raphaël",
  "Arthur",
  "Maxime",
  "Antoine",
  "Yanis",
  "Karim",
  "Mehdi",
  "Paul",
]);

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Identifiant de suivi stable (12 caractères base62, comme `newSubId()`), le même à chaque passe. */
export function p17SubId(key: string): string {
  const digest = createHash("sha256").update(`linkaffipro-demo:subid:${key}`).digest();
  let out = "";
  for (let i = 0; i < 12; i++) out += BASE62[digest[i]! % 62];
  return out;
}

/** Nom court du lien Offre d'une persona : même formule que `assistantOfferSlug` du worker (lien réutilisé par lui). */
function p17OfferSlug(personaId: string, affiliateCampaignId: string): string {
  const digest = createHash("sha256")
    .update(`assistant-offer:${personaId}:${affiliateCampaignId}`)
    .digest();
  let out = "";
  for (let i = 0; i < 10; i++) out += BASE62[digest[i]! % 62];
  return out;
}

function p17EscapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Personnes des six conversations : membres francophones d'un canal Rencontres d'abord, puis tout membre francophone,
 * puis n'importe qui (repli) ; ordre stable (identifiant Telegram).
 */
export function pickP17Members<
  T extends { id: string; tgId: bigint; firstName: string; languageCode: string; dating: boolean },
>(candidates: readonly T[], count: number): T[] {
  const sorted = [...candidates].sort((a, b) => (a.tgId < b.tgId ? -1 : a.tgId > b.tgId ? 1 : 0));
  const tiers = [
    (m: T) => m.dating && m.languageCode === "fr" && P17_MEMBER_NAMES.has(m.firstName),
    (m: T) => m.languageCode === "fr" && P17_MEMBER_NAMES.has(m.firstName),
    (m: T) => m.languageCode === "fr",
    () => true,
  ];
  const out: T[] = [];
  for (const keep of tiers)
    for (const m of sorted) {
      if (out.length >= count) return out;
      if (keep(m) && !out.includes(m)) out.push(m);
    }
  return out;
}

async function createPhase17Demo(
  db: Db,
  ctx: {
    now: Date;
    key: string;
    adminId: string;
    managerId: string;
    offerId: string;
    offerTemplate: string;
    campaignId: string | null;
    members: Array<{
      id: string;
      tgId: bigint;
      firstName: string;
      languageCode: string;
      dating: boolean;
    }>;
  },
) {
  const { now } = ctx;
  const ago = (min: number) => new Date(now.getTime() - Math.round(min * MIN));
  const people = pickP17Members(ctx.members, P17_CONVERSATIONS.length);
  if (people.length < P17_CONVERSATIONS.length)
    throw new Error("phase 17 : pas assez de membres de démonstration pour les conversations.");

  // Réglages de l'assistant : essai par l'équipe, sans clé (jamais d'appel à l'IA depuis la base locale).
  await db.setting.upsert({
    where: { key: "assistant.venice" },
    create: {
      key: "assistant.venice",
      value: P17_ASSISTANT_SETTING as unknown as Prisma.InputJsonValue,
    },
    update: { value: P17_ASSISTANT_SETTING as unknown as Prisma.InputJsonValue },
  });

  // Persona « Léa », puis son bot (aucun droit d'administrateur sur un canal).
  const personaCreatedAt = ago(8 * 24 * 60);
  await db.persona.create({
    data: {
      id: P17_PERSONA_ID,
      ...P17_PERSONA,
      languages: [...P17_PERSONA.languages],
      interests: [...P17_PERSONA.interests],
      minExchangesBeforeOffer: 4,
      requireInterest: true,
      maxOfferSends: 2,
      followUpAfterHours: 24,
      followUpsMax: 2,
      affiliateCampaignId: ctx.offerId,
      campaignId: ctx.campaignId,
      isActive: true,
      createdById: ctx.adminId,
      createdAt: personaCreatedAt,
    },
  });
  const botId = stableId("bot:assistant:lea");
  await db.bot.create({
    data: {
      id: botId,
      name: P17_BOT.name,
      username: P17_BOT.username,
      telegramBotId: P17_BOT.tgId,
      tokenEncrypted: encrypt(`${P17_BOT.tgId}:DEMO-ASSISTANT-jeton-factice-hors-service`, ctx.key),
      vertical: P17_BOT.vertical,
      isActive: true,
      webhookSecret: randomToken(16),
      lastWebhookAt: ago(3),
      mode: "ASSISTANT",
      personaId: P17_PERSONA_ID,
      createdAt: personaCreatedAt,
    },
  });

  // Trois essais « Tester » de la fiche de la persona (coût compté, sans conversation).
  const usages: Prisma.AiConversationUsageCreateManyInput[] = [0, 1, 2].map((i) => ({
    id: stableId(`p17:usage:test:${i}`),
    personaId: P17_PERSONA_ID,
    conversationId: null,
    source: null,
    purpose: "TEST",
    model: P17_MODEL,
    inputTokens: 1650 + i * 140,
    outputTokens: 70 + i * 12,
    costEur: (0.0007 + i * 0.0001).toFixed(4),
    ok: true,
    createdAt: ago(8 * 24 * 60 - 20 - i * 6),
  }));

  // Lien Offre de la persona (créé au premier envoi, réutilisé ensuite).
  const offerLinks = P17_CONVERSATIONS.filter((c) =>
    c.lines.some((l) => l.kind === "lea" && l.offer),
  );
  const firstOfferAgo = Math.max(
    ...offerLinks.flatMap((c) =>
      c.lines.filter((l) => l.kind === "lea" && l.offer).map((l) => l.ago),
    ),
  );
  const trackingLinkId = stableId("p17:offer-tracking");
  await db.trackingLink.create({
    data: {
      id: trackingLinkId,
      slug: p17OfferSlug(P17_PERSONA_ID, ctx.offerId),
      kind: "OFFER",
      destinationTemplate: ctx.offerTemplate,
      label: `Assistant « ${P17_PERSONA.name} »`,
      affiliateCampaignId: ctx.offerId,
      campaignId: ctx.campaignId,
      personaId: P17_PERSONA_ID,
      clicks: offerLinks.filter((c) => c.opened).length,
      uniqueClicks: offerLinks.filter((c) => c.opened).length,
      createdAt: ago(firstOfferAgo),
    },
  });

  const states: Prisma.MemberBotStateCreateManyInput[] = [];
  const outbound: Prisma.OutboundMessageCreateManyInput[] = [];
  const messages: Prisma.ConversationMessageCreateManyInput[] = [];
  const convEvents: Prisma.ConversationEventCreateManyInput[] = [];
  const journal: Prisma.EventCreateManyInput[] = [];
  let offerLinkCount = 0;
  let teamTgId: bigint | null = null;

  for (const [ci, c] of P17_CONVERSATIONS.entries()) {
    const person = people[ci]!;
    const convId = stableId(`p17:conversation:${c.key}`);
    const start = c.lines.find((l) => l.kind === "start");
    const source = start && start.kind === "start" ? start.source : null;
    const startedAt = ago(c.lines[0]!.ago);
    if (c.team) teamTgId = person.tgId;
    states.push({
      id: stableId(`p17:state:${c.key}`),
      memberId: person.id,
      botId,
      canDm: true,
      startedAt,
      lastDmAt: ago(
        Math.min(
          ...c.lines
            .filter((l) => l.kind === "lea" || l.kind === "team" || l.kind === "stopDone")
            .map((l) => l.ago),
        ),
      ),
    });
    journal.push({
      type: "member.start",
      occurredAt: startedAt,
      memberId: person.id,
      botId,
      payload: { payload: source, demo: true },
    });

    // Lien de l'offre de cette conversation (un identifiant de suivi par envoi) et son clic à la première ouverture.
    const offerLine = c.lines.find((l) => l.kind === "lea" && l.offer);
    const subId = offerLine ? p17SubId(c.key) : null;
    const clickId = c.opened ? stableId(`p17:click:${c.key}`) : null;
    const offerLinkId = subId ? stableId(`p17:offer-link:${c.key}`) : null;

    // Fil : un tour de l'assistante = ses messages consécutifs ; chaque message reçu est rattaché au tour qui l'a traité.
    let turn = 0;
    let part = 0;
    let tgMessageId = 0;
    let prevKind: P17Line["kind"] | null = null;
    let pendingIn: number[] = [];
    let lastInboundAgo: number | null = null;
    let lastAssistantAgo: number | null = null;
    let memberMessages = 0;
    let assistantTurns = 0;
    let offerSends = 0;
    for (const [li, l] of c.lines.entries()) {
      tgMessageId++;
      const at = ago(l.ago);
      const id = stableId(`p17:message:${c.key}:${li}`);
      if (l.kind === "start" || l.kind === "in") {
        lastInboundAgo = l.ago;
        if (l.kind === "in") memberMessages++;
        messages.push({
          id,
          conversationId: convId,
          direction: "IN",
          author: "MEMBER",
          text: l.kind === "start" ? "/start" : l.text,
          meta:
            l.kind === "start"
              ? { command: "start", ...(l.source ? { source: l.source } : {}) }
              : {},
          telegramMessageId: BigInt(tgMessageId),
          createdAt: at,
        });
        pendingIn.push(messages.length - 1);
      } else if (l.kind === "lea") {
        // Nouveau tour : après un message reçu (ou de l'équipe), ou une relance après un silence.
        if (prevKind !== "lea" || l.followUp) {
          turn++;
          part = 0;
          assistantTurns++;
          const turnId = `p17-${c.key}-${turn}`;
          // Messages reçus traités par ce tour (le webhook les a enregistrés, le worker les a réclamés).
          for (const i of pendingIn)
            messages[i] = {
              ...messages[i]!,
              turnId,
              meta: { ...(messages[i]!.meta as object), turnDone: true },
            };
          pendingIn = [];
          usages.push({
            id: stableId(`p17:usage:${c.key}:${turn}`),
            personaId: P17_PERSONA_ID,
            conversationId: convId,
            source,
            purpose: l.followUp ? "FOLLOW_UP" : "REPLY",
            model: P17_MODEL,
            inputTokens: 1700 + turn * 180,
            outputTokens: 60 + ((turn * 23) % 70),
            costEur: (0.0007 + turn * 0.00012).toFixed(4),
            ok: true,
            createdAt: new Date(at.getTime() - 3_000),
          });
        }
        lastAssistantAgo = l.ago;
        const omId = stableId(`p17:outbound:${c.key}:${li}`);
        const offer = l.offer && subId ? subId : null;
        if (offer) offerSends++;
        outbound.push({
          id: omId,
          botId,
          memberId: person.id,
          kind: "ASSISTANT",
          text: p17EscapeHtml(l.text),
          buttons: offer
            ? [[{ text: P17_PERSONA.offerButtonText, url: `https://go.goolink.eu/a/${offer}` }]]
            : [],
          status: "SENT",
          telegramMessageId: tgMessageId,
          queuedAt: new Date(at.getTime() - 2_000),
          sentAt: at,
        });
        messages.push({
          id,
          conversationId: convId,
          direction: "OUT",
          author: "ASSISTANT",
          text: l.text,
          meta: {
            ...(offer ? { offerSubId: offer } : {}),
            ...(l.followUp ? { followUp: true } : {}),
          },
          telegramMessageId: BigInt(tgMessageId),
          outboundMessageId: omId,
          turnId: `p17-${c.key}-${turn}`,
          partIndex: part++,
          createdAt: at,
        });
      } else if (l.kind === "team") {
        const omId = stableId(`p17:outbound:${c.key}:${li}`);
        outbound.push({
          id: omId,
          botId,
          memberId: person.id,
          kind: "ASSISTANT",
          text: p17EscapeHtml(l.text),
          buttons: [],
          status: "SENT",
          telegramMessageId: tgMessageId,
          queuedAt: new Date(at.getTime() - 2_000),
          sentAt: at,
        });
        messages.push({
          id,
          conversationId: convId,
          direction: "OUT",
          author: "TEAM",
          teamUserId: ctx.adminId,
          text: l.text,
          meta: {},
          telegramMessageId: BigInt(tgMessageId),
          outboundMessageId: omId,
          createdAt: at,
        });
        // Messages reçus pendant la reprise : lus par l'équipe, jamais confiés à l'assistante.
        pendingIn = [];
      } else {
        messages.push({
          id,
          conversationId: convId,
          direction: "OUT",
          author: "SYSTEM",
          text: l.text,
          meta: { fixed: "stopDone" },
          telegramMessageId: BigInt(tgMessageId),
          createdAt: at,
        });
      }
      prevKind = l.kind;
    }

    const nextFollowUpAt =
      c.status === "BOT" &&
      (c.stage === "CHAT" || c.stage === "PROPOSAL" || c.stage === "LINK_SENT") &&
      lastAssistantAgo !== null
        ? new Date(ago(lastAssistantAgo).getTime() + 24 * HOUR)
        : null;
    await db.conversation.create({
      data: {
        id: convId,
        botId,
        memberId: person.id,
        personaId: P17_PERSONA_ID,
        source,
        stage: c.stage,
        status: c.status,
        styleProfile: {
          ...c.style,
          updatedAt: ago(lastAssistantAgo ?? c.lines[0]!.ago).toISOString(),
        },
        facts: c.facts,
        language: "fr",
        stoppedAt: c.stoppedAgo !== undefined ? ago(c.stoppedAgo) : null,
        closedAt: c.status === "CLOSED" && c.stoppedAgo !== undefined ? ago(c.stoppedAgo) : null,
        closedReason: c.closedReason ?? null,
        takenOverById: c.takenOverAgo !== undefined ? ctx.adminId : null,
        takenOverAt: c.takenOverAgo !== undefined ? ago(c.takenOverAgo) : null,
        memberMessages,
        assistantTurns,
        offerSends,
        lastInboundAt: lastInboundAgo !== null ? ago(lastInboundAgo) : null,
        lastAssistantAt: lastAssistantAgo !== null ? ago(lastAssistantAgo) : null,
        followUpCount: c.followUpCount ?? 0,
        nextFollowUpAt: nextFollowUpAt && nextFollowUpAt > now ? nextFollowUpAt : null,
        convertedAt: c.player ? ago(c.player.convertedAgo) : null,
        createdAt: startedAt,
      },
    });

    if (subId && offerLine) {
      offerLinkCount++;
      if (clickId && c.opened) {
        await db.click.create({
          data: {
            id: clickId,
            trackingLinkId,
            subId,
            memberId: person.id,
            botId,
            conversationId: convId,
            userAgent:
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram-iOS",
            country: "FR",
            isBot: false,
            destination: fillUrlTemplate(ctx.offerTemplate, { subid: subId }),
            createdAt: ago(c.opened.ago),
          },
        });
        journal.push({
          type: "click.offer",
          occurredAt: ago(c.opened.ago),
          memberId: person.id,
          botId,
          payload: {
            clickId,
            subId,
            trackingLinkId,
            postId: null,
            conversationId: convId,
            via: "assistant",
            demo: true,
          },
        });
      }
      await db.assistantOfferLink.create({
        data: {
          id: offerLinkId!,
          subId,
          conversationId: convId,
          personaId: P17_PERSONA_ID,
          botId,
          memberId: person.id,
          trackingLinkId,
          source,
          sentAt: ago(offerLine.ago),
          firstOpenedAt: c.opened ? ago(c.opened.ago) : null,
          opens: c.opened?.opens ?? 0,
          clickId,
        },
      });
    }

    // Inscription et premier dépôt rattachés au clic (synchro Link Affi), comme les autres joueurs de démonstration.
    if (c.player && clickId && subId) {
      const playerId = stableId(`p17:player:${c.key}`);
      const ext = `demo-lea-${String(ci + 1).padStart(4, "0")}`;
      const registeredAt = ago(c.player.registeredAgo);
      const ftdAt = c.player.ftdAgo !== null ? ago(c.player.ftdAgo) : null;
      await db.player.create({
        data: {
          id: playerId,
          affiliateCampaignId: ctx.offerId,
          externalPlayerId: ext,
          subId,
          subIdSource: "postback",
          clickId,
          memberId: person.id,
          registeredAt,
          ftdAt,
          ftdAmount: ftdAt ? c.player.ftdAmount : null,
          depositCount: ftdAt ? 1 : 0,
          depositTotal: ftdAt ? c.player.ftdAmount : 0,
          currency: "EUR",
          status: "active",
          lastEventAt: ftdAt ?? registeredAt,
          raw: { demo: true },
          createdAt: registeredAt,
        },
      });
      await db.playerEvent.createMany({
        data: [
          {
            playerId,
            type: "REGISTRATION",
            amount: null,
            currency: null,
            occurredAt: registeredAt,
            externalId: `${ext}-registration-0`,
            raw: { demo: true },
          },
          ...(ftdAt
            ? [
                {
                  playerId,
                  type: "FTD" as const,
                  amount: c.player.ftdAmount,
                  currency: "EUR",
                  occurredAt: ftdAt,
                  externalId: `${ext}-ftd-1`,
                  raw: { demo: true },
                },
              ]
            : []),
        ],
      });
      journal.push({
        type: "player.registered",
        occurredAt: registeredAt,
        memberId: person.id,
        payload: { playerId, demo: true },
      });
      if (ftdAt)
        journal.push({
          type: "player.ftd",
          occurredAt: ftdAt,
          memberId: person.id,
          payload: { playerId, amount: c.player.ftdAmount, demo: true },
        });
    }

    // Parcours (append-only, sans texte) et son double dans le journal (`conversation.<type>`).
    for (const [ei, e] of c.events.entries()) {
      const payload: Record<string, unknown> = { ...(e.payload ?? {}) };
      if (e.type === "offer_sent" && subId) payload.subId = subId;
      if (e.type === "offer_opened" && subId)
        Object.assign(payload, { subId, clickId, offerLinkId });
      if (e.type === "taken_over") payload.teamUserId = ctx.adminId;
      convEvents.push({
        id: stableId(`p17:event:${c.key}:${ei}`),
        conversationId: convId,
        type: e.type,
        fromStage: e.from ?? null,
        toStage: e.to ?? null,
        payload: payload as Prisma.InputJsonValue,
        createdAt: ago(e.ago),
      });
      journal.push({
        type: `conversation.${e.type}`,
        occurredAt: ago(e.ago),
        memberId: person.id,
        botId,
        payload: {
          conversationId: convId,
          ...(e.from ? { fromStage: e.from } : {}),
          ...(e.to ? { toStage: e.to } : {}),
          ...payload,
        } as Prisma.InputJsonValue,
      });
    }
  }

  await db.memberBotState.createMany({ data: states });
  await db.outboundMessage.createMany({ data: outbound });
  await db.conversationMessage.createMany({ data: messages });
  await db.conversationEvent.createMany({ data: convEvents });
  await db.aiConversationUsage.createMany({ data: usages });
  await db.event.createMany({ data: journal });

  // Essai par l'équipe : la personne de la conversation « lien envoyé » est le compte Telegram du manager de
  // démonstration (jamais un compte relié à un vrai Telegram : seulement s'il n'en a pas, ou un de démonstration).
  if (teamTgId !== null) {
    const manager = await db.user.findUnique({
      where: { id: ctx.managerId },
      select: { telegramUserId: true },
    });
    const current = manager?.telegramUserId ?? null;
    if (current === null || isDemoTelegramUserId(current))
      await db.user.update({ where: { id: ctx.managerId }, data: { telegramUserId: teamTgId } });
  }

  return {
    conversations: P17_CONVERSATIONS.length,
    messages: messages.length,
    offerLinks: offerLinkCount,
    usages: usages.length,
  };
}

/** Import par chemin calculé : le paquet db ne dépend ni du worker ni du paquet telegram (qui dépendent de lui). */
async function importSibling<T>(relative: string): Promise<T> {
  return (await import(new URL(relative, import.meta.url).href)) as T;
}

async function main(): Promise<void> {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
  const key = process.env.APP_ENCRYPTION_KEY;
  try {
    parseEncryptionKey(key);
  } catch {
    throw new DemoGuardError(
      "APP_ENCRYPTION_KEY absente ou invalide (.env.local) : nécessaire pour chiffrer les jetons factices des bots.",
    );
  }
  const password = process.env.DEMO_PASSWORD?.trim() || DEFAULT_DEMO_PASSWORD;
  const { prisma } = (await import("../src/client")) as { prisma: PrismaClient };
  const target = checkLocalDatabaseUrl(process.env.DATABASE_URL);
  console.log(`[demo] base locale : ${target.ok ? `${target.host}/${target.database}` : "?"}`);
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const removed = await removeDemo(tx);
        const created = await createDemo(tx, {
          now: new Date(),
          password,
          key: key!,
          r: createRandom(SEED),
        });
        return { removed, created };
      },
      { timeout: 300_000, maxWait: 20_000 },
    );
    const removed = Object.entries(result.removed).filter(([, n]) => n > 0);
    console.log(
      `[demo] ancienne démonstration retirée : ${removed.length ? removed.map(([k, n]) => `${n} ${k}`).join(", ") : "rien"}.`,
    );
    for (const [k, n] of Object.entries(result.created.counts)) console.log(`[demo] ${k} : ${n}`);

    // Séquences de messages privés par défaut des canaux (fonction du paquet telegram, sans appel à Telegram).
    try {
      const seq = await importSibling<{
        ensureDefaultSequences: (id: string) => Promise<{ created: string[] }>;
      }>("../../telegram/src/sequences/ensure.ts");
      let n = 0;
      for (const id of result.created.channelIds)
        n += (await seq.ensureDefaultSequences(id)).created.length;
      console.log(`[demo] séquences par défaut créées : ${n}`);
    } catch (err) {
      console.warn(
        `[demo] séquences par défaut non créées (${err instanceof Error ? err.message : err}).`,
      );
    }

    // Statistiques journalières (recalcul complet) et meilleurs horaires : fonctions du worker, sans Redis.
    try {
      const daily = await importSibling<{
        recomputeDailyStats: (o: { full?: boolean }) => Promise<{ days: number; rows: number }>;
      }>("../../../apps/worker/src/stats/daily.ts");
      const s = await daily.recomputeDailyStats({ full: true });
      console.log(
        `[demo] statistiques journalières recalculées : ${s.days} jour(s), ${s.rows} ligne(s).`,
      );
      const best = await importSibling<{
        recomputeBestHours: (now?: Date) => Promise<{ channels: number; posts: number }>;
      }>("../../../apps/worker/src/stats/best-hours.ts");
      const b = await best.recomputeBestHours(new Date());
      console.log(
        `[demo] meilleurs horaires recalculés : ${b.channels} canal(aux), ${b.posts} message(s).`,
      );
    } catch (err) {
      console.warn(
        `[demo] statistiques NON recalculées (${err instanceof Error ? err.message : err}) : lancez le worker (pnpm dev) ou le bouton « Recalculer » de la page Campagnes.`,
      );
    }
    console.log(
      `[demo] connexion : ${VERIFICATION_EMAIL} (ADMIN) ou ${MANAGER_EMAIL} (MANAGER), mot de passe ${
        process.env.DEMO_PASSWORD?.trim()
          ? "de la variable DEMO_PASSWORD"
          : `« ${DEFAULT_DEMO_PASSWORD} » (local seulement)`
      }.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Exécuté directement (pnpm db:demo) ; importé par les tests sans rien lancer.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[demo] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
