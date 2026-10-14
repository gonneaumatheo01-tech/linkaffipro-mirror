/**
 * Campagnes Telegram des affiliés Link Affi (phase 13, contrat docs/LINKAFFI-PARTENAIRES.md, version 2) : lecture
 * prudente de ce que Link Affi expose dans `stats-api` (prompt Lovable § 6 : tables `telegram_members` et
 * `telegram_member_events`, campagnes de type Telegram, attribution `tg` sur les clics et les joueurs) et comparaison
 * avec nos chiffres. LECTURE SEULE.
 *
 * Link Affi construit sa partie en parallèle : les noms de colonnes ne sont pas encore connus. Chaque valeur est donc
 * cherchée parmi plusieurs noms probables (`TELEGRAM_COLUMNS`, premier nom présent et non vide) ; une table ou une
 * colonne absente donne « inconnu » (null), jamais une erreur. Le jour où Link Affi les expose, tout se branche seul.
 *
 * Résultat : `Setting` « linkaffi.telegramCampaigns » (`TelegramCampaignsState`), lu par la vue interne des affiliés
 * (clics) et par Réglages → Connexions (écarts). Aucune donnée personnelle n'y est gardée : seulement des nombres.
 */
import type { LaCampaign } from "./types";

export const TELEGRAM_CAMPAIGNS_SETTING_KEY = "linkaffi.telegramCampaigns";

/** Tables Telegram annoncées par le prompt Lovable (§ 3 et § 6). `telegram_campaigns` : variante possible. */
export const LINKAFFI_TELEGRAM_TABLES = {
  members: "telegram_members",
  memberEvents: "telegram_member_events",
  campaigns: "telegram_campaigns",
} as const;

/** Intervalle entre deux lectures Telegram (la synchro générale passe toutes les 2 minutes). */
export const TELEGRAM_SYNC_INTERVAL_MS = 10 * 60_000;

/**
 * Comptages de clics demandés à Link Affi par passage (une requête par campagne, une par seconde au plus) : au-delà,
 * les campagnes relues le moins récemment passent d'abord, les autres gardent leur dernier chiffre.
 */
export const TELEGRAM_CLICK_COUNTS_PER_PASS = 30;

/**
 * Noms de colonnes probables, du plus au moins probable. Mapping documenté dans docs/DECISIONS-TECH.md (phase 13, D6).
 */
export const TELEGRAM_COLUMNS = {
  campaign: {
    /** Type d'une ligne de `campaigns` : une valeur qui contient « telegram » désigne une campagne Telegram. */
    type: ["type", "campaign_type", "destination_type", "link_type", "kind", "destination"],
    key: ["campaign_key", "telegram_campaign_key", "key"],
    name: ["name", "campaign_name", "title"],
    affiliateId: ["affiliate_id"],
    affiliateName: ["affiliate_name"],
    /** Identifiant de notre lien d'invitation (`inviteLinkId` rendu par `POST /invite-links`). */
    inviteLinkId: [
      "invite_link_id",
      "telegram_invite_link_id",
      "platform_invite_link_id",
      "linkaffipro_invite_link_id",
    ],
    /** Identifiant de notre canal (`channelId` envoyé à `POST /invite-links`). */
    channelId: [
      "telegram_channel_id",
      "platform_channel_id",
      "linkaffipro_channel_id",
      "channel_id",
    ],
    isActive: ["is_active", "active", "enabled"],
    status: ["status"],
    /** Compteur de clics porté par la campagne, si Link Affi en ajoute un. */
    clicks: ["clicks", "clicks_count", "click_count", "total_clicks"],
  },
  members: {
    key: ["campaign_key", "telegram_campaign_key", "tg_campaign_key", "tg"],
    campaignId: ["telegram_campaign_id", "campaign_id"],
    user: ["telegram_user_id", "member_telegram_user_id", "user_id"],
    /** Joueur Link Affi lié au membre (`players.id`), s'il existe. */
    player: ["player_id", "linked_player_id"],
  },
  /** Attribution `tg` portée par un joueur Link Affi (clé ou identifiant de la campagne Telegram). */
  player: [
    "tg",
    "tg_campaign_key",
    "telegram_campaign_key",
    "tg_key",
    "telegram_campaign_id",
    "tg_campaign_id",
  ],
} as const;

/** Noms de colonnes de `campaigns` qui, seuls, suffisent à reconnaître une campagne Telegram (jamais `channel_id`). */
const TELEGRAM_ONLY_CAMPAIGN_COLUMNS = [
  ...TELEGRAM_COLUMNS.campaign.inviteLinkId,
  "telegram_channel_id",
  "platform_channel_id",
  "linkaffipro_channel_id",
] as const;

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

/** Nombre lisible (nombre ou texte numérique), sinon null. Local : `mapping.ts` importe ce module. */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "bigint") return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Première valeur non vide parmi des noms de colonnes probables. */
export function pickColumn(row: Row, columns: readonly string[]): unknown {
  for (const c of columns) {
    const v = row[c];
    if (v === null || v === undefined || v === "") continue;
    return v;
  }
  return null;
}

/** La ligne porte-t-elle au moins une de ces colonnes (même vide) ? */
export function hasAnyColumn(row: Row, columns: readonly string[]): boolean {
  return columns.some((c) => Object.prototype.hasOwnProperty.call(row, c));
}

/**
 * Ligne de `campaigns` qui décrit une campagne Telegram d'affilié (et non une offre vers un casino) : type qui contient
 * « telegram », ou identifiant de notre lien d'invitation / de notre canal. Une telle ligne n'est jamais une offre.
 */
export function isTelegramCampaignRow(row: LaCampaign | Row): boolean {
  const r = row as Row;
  for (const c of TELEGRAM_COLUMNS.campaign.type) {
    const v = r[c];
    if (typeof v === "string" && /telegram/i.test(v)) return true;
  }
  return TELEGRAM_ONLY_CAMPAIGN_COLUMNS.some((c) => str(r[c]) !== null);
}

export type TelegramCampaignSource = "telegram_campaigns" | "campaigns";

/** Campagne Telegram telle que Link Affi la décrit. */
export type LaTelegramCampaign = {
  key: string;
  /** Identifiant Link Affi de la campagne (ligne lue). */
  linkaffiId: string | null;
  /** Identifiant de campagne porté par les clics de son lien (`clicks.campaign_id`). */
  clicksCampaignId: string | null;
  name: string | null;
  affiliateId: string | null;
  affiliateName: string | null;
  inviteLinkId: string | null;
  channelId: string | null;
  isActive: boolean | null;
  /** Compteur de clics porté par la ligne, s'il existe. */
  clicks: number | null;
};

function activeFrom(row: Row): boolean | null {
  const b = pickColumn(row, TELEGRAM_COLUMNS.campaign.isActive);
  if (typeof b === "boolean") return b;
  if (b === "true" || b === 1) return true;
  if (b === "false" || b === 0) return false;
  const status = str(pickColumn(row, TELEGRAM_COLUMNS.campaign.status))?.toLowerCase();
  if (!status) return null;
  if (["active", "enabled", "live", "running", "actif"].includes(status)) return true;
  if (
    [
      "inactive",
      "disabled",
      "paused",
      "archived",
      "deleted",
      "revoked",
      "stopped",
      "inactif",
    ].includes(status)
  )
    return false;
  return null;
}

/**
 * Ligne de campagne Telegram → `LaTelegramCampaign`. Sans clé lisible : ignorée. Depuis `telegram_campaigns`, les clics
 * du lien portent `campaign_id` (ligne `campaigns` du lien) s'il existe, sinon l'identifiant de la ligne.
 */
export function mapTelegramCampaign(
  row: Row,
  source: TelegramCampaignSource,
): LaTelegramCampaign | null {
  const key = str(pickColumn(row, TELEGRAM_COLUMNS.campaign.key));
  if (!key || !KEY_RE.test(key)) return null;
  const linkaffiId = str(row.id);
  const clicks = toNumber(pickColumn(row, TELEGRAM_COLUMNS.campaign.clicks));
  return {
    key,
    linkaffiId,
    clicksCampaignId:
      source === "telegram_campaigns" ? (str(row.campaign_id) ?? linkaffiId) : linkaffiId,
    name: str(pickColumn(row, TELEGRAM_COLUMNS.campaign.name)),
    affiliateId: str(pickColumn(row, TELEGRAM_COLUMNS.campaign.affiliateId)),
    affiliateName: str(pickColumn(row, TELEGRAM_COLUMNS.campaign.affiliateName)),
    inviteLinkId: str(pickColumn(row, TELEGRAM_COLUMNS.campaign.inviteLinkId)),
    channelId: str(pickColumn(row, TELEGRAM_COLUMNS.campaign.channelId)),
    isActive: activeFrom(row),
    clicks: clicks === null ? null : Math.max(0, Math.trunc(clicks)),
  };
}

/** Lignes d'une source → campagnes Telegram, une par clé (la dernière lue l'emporte). */
export function mapTelegramCampaigns(
  rows: readonly Row[],
  source: TelegramCampaignSource,
): LaTelegramCampaign[] {
  const byKey = new Map<string, LaTelegramCampaign>();
  for (const row of rows) {
    if (source === "campaigns" && !isTelegramCampaignRow(row)) continue;
    const c = mapTelegramCampaign(row, source);
    if (c) byKey.set(c.key, c);
  }
  return [...byKey.values()];
}

/** Clés connues et identifiants Link Affi → clé, pour relire une référence `tg` (clé ou identifiant). */
export type TelegramCampaignLookup = { keys: Set<string>; keyById: Map<string, string> };

export function telegramCampaignLookup(
  campaigns: readonly LaTelegramCampaign[],
  ourKeys: Iterable<string>,
): TelegramCampaignLookup {
  const keys = new Set<string>(ourKeys);
  const keyById = new Map<string, string>();
  for (const c of campaigns) {
    keys.add(c.key);
    if (c.linkaffiId) keyById.set(c.linkaffiId, c.key);
    if (c.clicksCampaignId) keyById.set(c.clicksCampaignId, c.key);
  }
  return { keys, keyById };
}

/**
 * Référence de campagne Telegram (clé, ou identifiant Link Affi) → clé. Une clé inconnue mais bien formée est gardée
 * telle quelle (Link Affi crédite une campagne que nous ne connaissons pas : écart à montrer) ; un identifiant inconnu
 * (forme uuid) ne peut pas être relu.
 */
export function resolveTelegramCampaignRef(
  ref: unknown,
  lookup: TelegramCampaignLookup,
): string | null {
  const s = str(ref);
  if (!s) return null;
  const byId = lookup.keyById.get(s);
  if (byId) return byId;
  if (lookup.keys.has(s)) return s;
  if (UUID_RE.test(s) || !KEY_RE.test(s)) return null;
  return s;
}

/** Résumé de `telegram_members` par clé de campagne (membres distincts et joueurs Link Affi liés). */
export type TelegramMembersSummary = {
  byKey: Map<string, { members: number; playerIds: Set<string> }>;
  /** Les lignes portent-elles une colonne « joueur lié » ? */
  hasPlayerColumn: boolean;
  /** Lignes dont la campagne n'a pas pu être relue. */
  unresolved: number;
};

export function summarizeTelegramMembers(
  rows: readonly Row[],
  lookup: TelegramCampaignLookup,
): TelegramMembersSummary {
  const users = new Map<string, Set<string>>();
  const players = new Map<string, Set<string>>();
  let hasPlayerColumn = false;
  let unresolved = 0;
  rows.forEach((row, i) => {
    if (hasAnyColumn(row, TELEGRAM_COLUMNS.members.player)) hasPlayerColumn = true;
    const key =
      resolveTelegramCampaignRef(pickColumn(row, TELEGRAM_COLUMNS.members.key), lookup) ??
      resolveTelegramCampaignRef(pickColumn(row, TELEGRAM_COLUMNS.members.campaignId), lookup);
    if (!key) {
      unresolved++;
      return;
    }
    // Une ligne par membre et par campagne : un membre sans identifiant lisible compte pour sa ligne.
    const user = str(pickColumn(row, TELEGRAM_COLUMNS.members.user)) ?? `row:${i}`;
    if (!users.has(key)) users.set(key, new Set());
    users.get(key)!.add(user);
    const player = str(pickColumn(row, TELEGRAM_COLUMNS.members.player));
    if (!players.has(key)) players.set(key, new Set());
    if (player) players.get(key)!.add(player);
  });
  const byKey = new Map<string, { members: number; playerIds: Set<string> }>();
  for (const [key, set] of users)
    byKey.set(key, { members: set.size, playerIds: players.get(key) ?? new Set() });
  return { byKey, hasPlayerColumn, unresolved };
}

/** Joueur Link Affi (copie gardée dans `Player.raw`) vu sous l'angle de l'attribution `tg`. */
export type TelegramPlayerRow = {
  /** Valeur de la première colonne `tg` non vide (clé ou identifiant de campagne Telegram). */
  ref: string | null;
  /** `players.campaign_id` (une campagne Telegram, si Link Affi y range le joueur crédité). */
  campaignId: string | null;
  /** La ligne porte au moins une colonne `tg` (même vide). */
  hasColumn: boolean;
  ftd: boolean;
};

export type TheirPlayerFigures = Map<string, { registrations: number; ftds: number }>;

/**
 * Inscriptions et premiers dépôts crédités par Link Affi à chaque campagne Telegram (attribution `tg` du joueur, ou
 * joueur rangé sous la campagne Telegram elle-même). `exposed` : Link Affi montre cette attribution (au moins un joueur
 * porte une colonne `tg`, ou un joueur est rangé sous une campagne Telegram).
 */
export function countTheirPlayers(
  rows: readonly TelegramPlayerRow[],
  lookup: TelegramCampaignLookup,
): { exposed: boolean; byKey: TheirPlayerFigures } {
  const byKey: TheirPlayerFigures = new Map();
  let exposed = false;
  for (const r of rows) {
    if (r.hasColumn) exposed = true;
    const viaCampaign = r.campaignId ? (lookup.keyById.get(r.campaignId) ?? null) : null;
    if (viaCampaign) exposed = true;
    const key = resolveTelegramCampaignRef(r.ref, lookup) ?? viaCampaign;
    if (!key) continue;
    const f = byKey.get(key) ?? { registrations: 0, ftds: 0 };
    f.registrations++;
    if (r.ftd) f.ftds++;
    byKey.set(key, f);
  }
  return { exposed, byKey };
}

/** Nos chiffres d'une campagne Telegram d'affilié. */
export type OurTelegramFigures = {
  /** Membres rattachés à la campagne (`Member.linkaffiCampaignKey`). */
  members: number;
  /** Nos joueurs dont le clic d'offre portait la campagne (`Click.linkaffiTelegramCampaignKey`). */
  registrations: number;
  /** … dont le premier dépôt est fait (`Player.ftdAt`). */
  ftds: number;
};

export type TelegramFigureField = "members" | "registrations" | "ftds";
export const TELEGRAM_FIGURE_FIELDS: readonly TelegramFigureField[] = [
  "members",
  "registrations",
  "ftds",
];

/**
 * Tolérance des écarts (documentée dans docs/DECISIONS-TECH.md) : un écart n'est montré que s'il dépasse
 * max(minimum, 5 % du plus grand des deux chiffres, arrondi en dessous).
 * - Membres : minimum 2 (un événement part dans la minute, Link Affi est relu toutes les 10 minutes).
 * - Inscriptions, premiers dépôts : minimum 0 (les deux côtés se lisent sur la même copie des joueurs : tout écart
 *   sous 20 compte).
 */
export const TELEGRAM_TOLERANCE: Record<TelegramFigureField, { min: number; ratio: number }> = {
  members: { min: 2, ratio: 0.05 },
  registrations: { min: 0, ratio: 0.05 },
  ftds: { min: 0, ratio: 0.05 },
};

export function telegramTolerance(
  field: TelegramFigureField,
  ours: number,
  theirs: number,
): number {
  const t = TELEGRAM_TOLERANCE[field];
  return Math.max(t.min, Math.floor(t.ratio * Math.max(Math.abs(ours), Math.abs(theirs))));
}

export function isTelegramDivergence(
  field: TelegramFigureField,
  ours: number,
  theirs: number,
): boolean {
  return Math.abs(ours - theirs) > telegramTolerance(field, ours, theirs);
}

/** Où Link Affi donne chaque chiffre (null = pas encore exposé). */
export type TelegramSources = {
  campaigns: TelegramCampaignSource | null;
  /** `telegram_members` lisible. */
  members: boolean;
  /** Inscriptions et premiers dépôts : attribution `tg` des joueurs, ou joueurs liés aux membres (repli). */
  registrations: "players" | "telegram_members" | null;
  /** Clics : compteur de la campagne, ou comptage de la table `clicks`. */
  clicks: "campaigns" | "clicks" | null;
};

/**
 * Une campagne Telegram d'affilié dans le `Setting` : chiffres de LINK AFFI (null = inconnu), identité (Link Affi
 * d'abord, sinon notre lien), et nos propres chiffres dans `ours`.
 */
export type TelegramCampaignEntry = {
  affiliateId: string | null;
  affiliateName: string | null;
  name: string | null;
  inviteLinkId: string | null;
  channelId: string | null;
  isActive: boolean | null;
  clicks: number | null;
  registrations: number | null;
  ftds: number | null;
  members: number | null;
  ours: OurTelegramFigures;
  /** Campagne vue chez Link Affi / lien d'invitation chez nous. */
  linkaffi: boolean;
  platform: boolean;
  /** Dernier comptage des clics (ISO), pour relire d'abord les plus anciens. */
  clicksCheckedAt: string | null;
};

export type TelegramDivergence = {
  campaignKey: string;
  field: TelegramFigureField;
  ours: number;
  theirs: number;
};

export type TelegramCampaignsState = {
  version: 1;
  /** Dernière lecture réussie (ISO) ; null tant qu'aucune n'a réussi. */
  syncedAt: string | null;
  /** Dernier essai (ISO), réussi ou non : sert à espacer les lectures. */
  checkedAt: string | null;
  /** Link Affi expose-t-il déjà ses données Telegram ? */
  available: boolean;
  /** Dernier essai en échec : raison en français simple (les chiffres précédents sont gardés). */
  error: string | null;
  sources: TelegramSources;
  campaigns: Record<string, TelegramCampaignEntry>;
  divergences: TelegramDivergence[];
};

const NO_SOURCES: TelegramSources = {
  campaigns: null,
  members: false,
  registrations: null,
  clicks: null,
};

/** Notre lien d'invitation LINKAFFI (le plus récent par clé, actif d'abord). */
export type OurTelegramLink = {
  key: string;
  inviteLinkId: string;
  channelId: string;
  isActive: boolean;
  name: string | null;
  affiliateId: string | null;
  affiliateName: string | null;
};

/** Un lien par clé : le lien actif le plus récent, sinon le plus récent (liste reçue du plus ancien au plus récent). */
export function ourLinksByKey(links: readonly OurTelegramLink[]): Map<string, OurTelegramLink> {
  const out = new Map<string, OurTelegramLink>();
  for (const l of links) {
    const prev = out.get(l.key);
    if (!prev || l.isActive || !prev.isActive) out.set(l.key, l);
  }
  return out;
}

export type TelegramBuildInput = {
  now: Date;
  sources: TelegramSources;
  linkaffiCampaigns: readonly LaTelegramCampaign[];
  ourLinks: readonly OurTelegramLink[];
  /** Membres par clé chez Link Affi ; null = inconnu. */
  theirMembers: Map<string, number> | null;
  /** Inscriptions / premiers dépôts par clé chez Link Affi ; null = inconnu. */
  theirPlayers: TheirPlayerFigures | null;
  /** Clics par clé (null = inconnu) et date du comptage. */
  clicks: Map<string, { clicks: number | null; checkedAt: string | null }>;
  ours: Map<string, OurTelegramFigures>;
};

const ZERO: OurTelegramFigures = { members: 0, registrations: 0, ftds: 0 };

/** Assemble le `Setting` d'une lecture réussie : campagnes (union Link Affi + nos liens + clés vues) et écarts. */
export function buildTelegramCampaignsState(input: TelegramBuildInput): TelegramCampaignsState {
  const la = new Map(input.linkaffiCampaigns.map((c) => [c.key, c]));
  const ours = ourLinksByKey(input.ourLinks);
  const keys = new Set<string>([...la.keys(), ...ours.keys()]);
  for (const k of input.theirMembers?.keys() ?? []) keys.add(k);
  for (const k of input.theirPlayers?.keys() ?? []) keys.add(k);
  const campaigns: Record<string, TelegramCampaignEntry> = {};
  const divergences: TelegramDivergence[] = [];
  for (const key of [...keys].sort()) {
    const l = la.get(key);
    const o = ours.get(key);
    // Link Affi expose l'attribution des joueurs : une campagne sans joueur crédité vaut 0, pas « inconnu ».
    const players = input.theirPlayers
      ? (input.theirPlayers.get(key) ?? { registrations: 0, ftds: 0 })
      : null;
    const click = input.clicks.get(key);
    const entry: TelegramCampaignEntry = {
      affiliateId: l?.affiliateId ?? o?.affiliateId ?? null,
      affiliateName: l?.affiliateName ?? o?.affiliateName ?? null,
      name: l?.name ?? o?.name ?? null,
      inviteLinkId: l?.inviteLinkId ?? o?.inviteLinkId ?? null,
      channelId: l?.channelId ?? o?.channelId ?? null,
      isActive: l?.isActive ?? o?.isActive ?? null,
      clicks: click?.clicks ?? null,
      registrations: players?.registrations ?? null,
      ftds: players?.ftds ?? null,
      members: input.theirMembers ? (input.theirMembers.get(key) ?? 0) : null,
      ours: input.ours.get(key) ?? { ...ZERO },
      linkaffi: Boolean(l),
      platform: Boolean(o),
      clicksCheckedAt: click?.checkedAt ?? null,
    };
    campaigns[key] = entry;
    for (const field of TELEGRAM_FIGURE_FIELDS) {
      const theirs = entry[field];
      if (theirs === null) continue;
      const mine = entry.ours[field];
      if (isTelegramDivergence(field, mine, theirs))
        divergences.push({ campaignKey: key, field, ours: mine, theirs });
    }
  }
  divergences.sort(
    (a, b) =>
      Math.abs(b.ours - b.theirs) - Math.abs(a.ours - a.theirs) ||
      a.campaignKey.localeCompare(b.campaignKey) ||
      TELEGRAM_FIGURE_FIELDS.indexOf(a.field) - TELEGRAM_FIGURE_FIELDS.indexOf(b.field),
  );
  const s = input.sources;
  return {
    version: 1,
    syncedAt: input.now.toISOString(),
    checkedAt: input.now.toISOString(),
    available: s.campaigns !== null || s.members || s.registrations !== null,
    error: null,
    sources: s,
    campaigns,
    divergences,
  };
}

/** Essai en échec : les chiffres de la dernière lecture réussie sont gardés, avec la raison et la date de l'essai. */
export function telegramCampaignsStateAfterError(
  previous: TelegramCampaignsState | null,
  now: Date,
  error: string,
): TelegramCampaignsState {
  return {
    version: 1,
    syncedAt: previous?.syncedAt ?? null,
    checkedAt: now.toISOString(),
    available: previous?.available ?? false,
    error,
    sources: previous?.sources ?? { ...NO_SOURCES },
    campaigns: previous?.campaigns ?? {},
    divergences: previous?.divergences ?? [],
  };
}

/** Lecture due : jamais essayée, dernier essai il y a 10 minutes ou plus (ou dans le futur), ou resynchro complète. */
export function telegramSyncDue(
  previous: Pick<TelegramCampaignsState, "checkedAt"> | null,
  now: Date,
  full = false,
): boolean {
  if (full || !previous?.checkedAt) return true;
  const at = Date.parse(previous.checkedAt);
  if (!Number.isFinite(at)) return true;
  const age = now.getTime() - at;
  return age < 0 || age >= TELEGRAM_SYNC_INTERVAL_MS;
}

/**
 * Campagnes dont les clics sont à compter dans la table `clicks` ce passage : sans compteur sur la ligne, avec un
 * identifiant de clics connu ; les moins récemment comptées d'abord ; au plus `limit`.
 */
export function clickCountTargets(
  campaigns: readonly LaTelegramCampaign[],
  previous: TelegramCampaignsState | null,
  limit = TELEGRAM_CLICK_COUNTS_PER_PASS,
): LaTelegramCampaign[] {
  const checked = (key: string) => {
    const at = previous?.campaigns[key]?.clicksCheckedAt;
    const t = at ? Date.parse(at) : Number.NaN;
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  return campaigns
    .filter((c) => c.clicks === null && c.clicksCampaignId)
    .sort((a, b) => checked(a.key) - checked(b.key) || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, limit));
}

// ---------- Lecture prudente du Setting (worker et site) ----------

const obj = (v: unknown): Row | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const isoOrNull = (v: unknown): string | null =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
const textOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

function parseSources(v: unknown): TelegramSources {
  const o = obj(v);
  if (!o) return { ...NO_SOURCES };
  const campaigns =
    o.campaigns === "telegram_campaigns" || o.campaigns === "campaigns" ? o.campaigns : null;
  const registrations =
    o.registrations === "players" || o.registrations === "telegram_members"
      ? o.registrations
      : null;
  const clicks = o.clicks === "campaigns" || o.clicks === "clicks" ? o.clicks : null;
  return { campaigns, members: o.members === true, registrations, clicks };
}

function parseEntry(v: unknown): TelegramCampaignEntry | null {
  const o = obj(v);
  if (!o) return null;
  const ours = obj(o.ours);
  const figures = [o.clicks, o.registrations, o.ftds, o.members].map(numOrNull);
  return {
    affiliateId: textOrNull(o.affiliateId),
    affiliateName: textOrNull(o.affiliateName),
    name: textOrNull(o.name),
    inviteLinkId: textOrNull(o.inviteLinkId),
    channelId: textOrNull(o.channelId),
    isActive: boolOrNull(o.isActive),
    clicks: numOrNull(o.clicks),
    registrations: numOrNull(o.registrations),
    ftds: numOrNull(o.ftds),
    members: numOrNull(o.members),
    ours: {
      members: numOrNull(ours?.members) ?? 0,
      registrations: numOrNull(ours?.registrations) ?? 0,
      ftds: numOrNull(ours?.ftds) ?? 0,
    },
    // Forme minimale (sans repères) : vue chez Link Affi s'il en donne un chiffre ; de chez nous si elle a un lien.
    linkaffi: typeof o.linkaffi === "boolean" ? o.linkaffi : figures.some((n) => n !== null),
    platform: typeof o.platform === "boolean" ? o.platform : textOrNull(o.inviteLinkId) !== null,
    clicksCheckedAt: isoOrNull(o.clicksCheckedAt),
  };
}

/**
 * Sources absentes (forme minimale) : déduites des chiffres présents, pour ne pas annoncer « Link Affi ne donne pas
 * encore » un chiffre qui est là.
 */
function inferSources(campaigns: Record<string, TelegramCampaignEntry>): TelegramSources {
  const all = Object.values(campaigns);
  return {
    campaigns: all.some((c) => c.linkaffi) ? "telegram_campaigns" : null,
    members: all.some((c) => c.members !== null),
    registrations: all.some((c) => c.registrations !== null || c.ftds !== null) ? "players" : null,
    clicks: all.some((c) => c.clicks !== null) ? "campaigns" : null,
  };
}

/**
 * Lecture tolérante du `Setting` : une forme inattendue (ou absente) donne null, un champ illisible sa valeur « vide ».
 * Accepte aussi la forme minimale du cahier des charges (`{ syncedAt, available, campaigns, divergences }`) : sources
 * et repères (`platform`, `linkaffi`) absents sont alors déduits des chiffres et des liens.
 */
export function parseTelegramCampaignsState(value: unknown): TelegramCampaignsState | null {
  const root = obj(value);
  if (!root) return null;
  const campaigns: Record<string, TelegramCampaignEntry> = {};
  for (const [key, v] of Object.entries(obj(root.campaigns) ?? {})) {
    const e = parseEntry(v);
    if (e && KEY_RE.test(key)) campaigns[key] = e;
  }
  const divergences: TelegramDivergence[] = [];
  for (const d of Array.isArray(root.divergences) ? root.divergences : []) {
    const o = obj(d);
    const field = o?.field;
    const campaignKey = textOrNull(o?.campaignKey);
    const ours = numOrNull(o?.ours);
    const theirs = numOrNull(o?.theirs);
    if (
      !campaignKey ||
      (field !== "members" && field !== "registrations" && field !== "ftds") ||
      ours === null ||
      theirs === null
    )
      continue;
    divergences.push({ campaignKey, field, ours, theirs });
  }
  const syncedAt = isoOrNull(root.syncedAt);
  return {
    version: 1,
    syncedAt,
    checkedAt: isoOrNull(root.checkedAt) ?? syncedAt,
    available: root.available === true,
    error: textOrNull(root.error),
    sources: obj(root.sources) ? parseSources(root.sources) : inferSources(campaigns),
    campaigns,
    divergences,
  };
}
