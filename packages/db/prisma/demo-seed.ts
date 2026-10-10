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
  encrypt,
  fillUrlTemplate,
  newSubId,
  parseEncryptionKey,
  randomToken,
  shortId,
} from "@linkaffipro/core";
import type { Prisma, PrismaClient } from "@prisma/client";

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
const DEMO_BOT_IDS = [9_900_000_001n, 9_900_000_002n, 9_900_000_003n];
const DEMO_CHAT_IDS = [1n, 2n, 3n, 4n, 5n, 6n].map((n) => -1_009_900_000_000n - n);
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
          { username: { in: BOTS.map((b) => b.username) } },
        ],
      },
      select: { id: true },
    })
  ).map((b) => b.id);
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
  count(
    "programmes",
    await db.affiliateProgram.deleteMany({ where: { id: { in: programs.map((p) => p.id) } } }),
  );
  count("campagnes", await db.campaign.deleteMany({ where: { id: { in: campaigns } } }));
  count("messages", await db.post.deleteMany({ where: { id: { in: posts } } }));
  count("liens d'invitation", await db.inviteLink.deleteMany({ where: { id: { in: invites } } }));
  count("canaux", await db.channel.deleteMany({ where: { id: { in: channels } } }));
  count("membres", await db.member.deleteMany({ where: { id: { in: members } } }));
  count(
    "relances automatiques",
    await db.automationRule.deleteMany({ where: { name: { startsWith: DEMO_PREFIX } } }),
  );
  count("bots", await db.bot.deleteMany({ where: { id: { in: bots } } }));
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
        abSplit: 20,
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
    channelIds: Object.values(channelId),
    counts: {
      bots: BOTS.length,
      canaux: CHANNELS.length,
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
    },
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
