/**
 * Synchro des campagnes Telegram des affiliés Link Affi (phase 13, D6) : LECTURE SEULE de `stats-api`, toutes les
 * 10 minutes (à la fin d'un passage de la synchro générale), puis comparaison avec nos chiffres. Résultat dans le
 * `Setting` « linkaffi.telegramCampaigns » (forme `TelegramCampaignsState`, règles dans
 * packages/linkaffi/src/sync/telegram.ts).
 *
 * Tant que Link Affi n'expose pas ses données Telegram : `available: false`, aucune erreur, aucune alerte (rien
 * n'est écrit dans `SyncState`, que lit l'alerte `sync_failed`). Le jour où elles apparaissent, tout se branche seul.
 *
 * Ce que Link Affi expose (noms annoncés par le prompt Lovable, colonnes cherchées parmi plusieurs noms probables) :
 * - campagnes Telegram : table `telegram_campaigns`, sinon lignes Telegram de `campaigns` ;
 * - membres : table `telegram_members` (une ligne par membre et par campagne) ;
 * - inscriptions / premiers dépôts crédités : colonne `tg` des joueurs (copie gardée dans `Player.raw` par la synchro
 *   des joueurs), sinon joueurs liés aux membres de `telegram_members` ;
 * - clics : compteur de la campagne, sinon nombre de lignes de `clicks` de la campagne (une requête par campagne).
 * Les lignes de membres ne sont jamais gardées : seulement des nombres.
 */
import { Prisma, prisma } from "@linkaffipro/db";
import {
  LINKAFFI_TELEGRAM_TABLES,
  LinkAffiError,
  TELEGRAM_CAMPAIGNS_SETTING_KEY,
  TELEGRAM_COLUMNS,
  buildTelegramCampaignsState,
  clickCountTargets,
  countTheirPlayers,
  mapTelegramCampaigns,
  parseTelegramCampaignsState,
  summarizeTelegramMembers,
  telegramCampaignLookup,
  telegramCampaignsStateAfterError,
  telegramSyncDue,
  type LaCampaign,
  type LaTelegramCampaign,
  type LinkAffiClient,
  type OurTelegramFigures,
  type OurTelegramLink,
  type TelegramCampaignLookup,
  type TelegramCampaignsState,
  type TelegramPlayerRow,
  type TelegramSources,
  type TheirPlayerFigures,
} from "@linkaffipro/linkaffi";
import { logger } from "../logger";

type Db = typeof prisma;
type Client = Pick<LinkAffiClient, "listTables" | "getPage" | "getAll" | "count">;

/** Nom à passer dans `tables` d'une tâche `sync-linkaffi` pour ne lancer que cette lecture. */
export const TELEGRAM_SYNC_NAME = "telegram";

export type TelegramSyncOutcome = {
  available: boolean;
  campaigns: number;
  divergences: number;
  error: string | null;
};

/** Raison lisible d'un échec (jamais de clé ni d'adresse complète). */
export function telegramSyncErrorText(err: unknown): string {
  if (err instanceof LinkAffiError) {
    if (err.status === 401 || err.status === 403)
      return "Link Affi refuse la lecture : vérifier les clés de lecture de Link Affi.";
    if (err.status === null || err.status === 429 || err.status >= 500)
      return "Link Affi ne répond pas pour l'instant : nouvel essai dans 10 minutes.";
    return "Réponse inattendue de Link Affi : nouvel essai dans 10 minutes.";
  }
  return "Lecture impossible pour l'instant : nouvel essai dans 10 minutes.";
}

async function readPrevious(db: Db): Promise<TelegramCampaignsState | null> {
  const row = await db.setting.findUnique({
    where: { key: TELEGRAM_CAMPAIGNS_SETTING_KEY },
    select: { value: true },
  });
  return parseTelegramCampaignsState(row?.value);
}

async function writeState(db: Db, state: TelegramCampaignsState): Promise<void> {
  const value = state as unknown as Prisma.InputJsonValue;
  await db.setting.upsert({
    where: { key: TELEGRAM_CAMPAIGNS_SETTING_KEY },
    create: { key: TELEGRAM_CAMPAIGNS_SETTING_KEY, value },
    update: { value },
  });
}

/** Lecture due (toutes les 10 minutes, tout de suite en resynchro complète). Ne lève jamais : en cas de doute, oui. */
export async function telegramCampaignsDue(db: Db, now: Date, full = false): Promise<boolean> {
  if (full) return true;
  try {
    return telegramSyncDue(await readPrevious(db), now);
  } catch {
    return true;
  }
}

/** Table absente : 404 ou 400 de `stats-api` (une table inconnue n'est pas une panne). */
function isMissingTable(err: unknown): boolean {
  return err instanceof LinkAffiError && (err.status === 404 || err.status === 400);
}

/**
 * Présence des tables Telegram : liste des tables de `stats-api` (une requête) ; si cette liste est illisible, chaque
 * table est sondée (une ligne). Une panne (réseau, 5xx, accès refusé) remonte : l'essai est en échec.
 */
async function tablePresence(client: Client): Promise<(table: string) => Promise<boolean>> {
  let listed: Set<string> | null = null;
  try {
    listed = new Set(await client.listTables());
  } catch (err) {
    if (
      !(err instanceof LinkAffiError) ||
      err.retryable ||
      err.status === 401 ||
      err.status === 403
    )
      throw err;
  }
  const cache = new Map<string, boolean>();
  return async (table) => {
    if (listed) return listed.has(table);
    const hit = cache.get(table);
    if (hit !== undefined) return hit;
    let present: boolean;
    try {
      await client.getPage(table, { limit: 1 });
      present = true;
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      present = false;
    }
    cache.set(table, present);
    return present;
  };
}

async function readAll(client: Client, table: string): Promise<Record<string, unknown>[] | null> {
  try {
    return await client.getAll(table);
  } catch (err) {
    // Listée mais illisible (droits, table en cours de création chez Link Affi) : chiffre inconnu, pas une panne.
    if (isMissingTable(err)) return null;
    throw err;
  }
}

async function ourLinks(db: Db): Promise<OurTelegramLink[]> {
  const links = await db.inviteLink.findMany({
    where: { kind: "LINKAFFI", linkaffiCampaignKey: { not: null } },
    select: {
      id: true,
      channelId: true,
      isActive: true,
      linkaffiCampaignKey: true,
      linkaffiCampaignName: true,
      linkaffiAffiliateId: true,
      linkaffiAffiliateName: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return links.map((l) => ({
    key: l.linkaffiCampaignKey!,
    inviteLinkId: l.id,
    channelId: l.channelId,
    isActive: l.isActive,
    name: l.linkaffiCampaignName,
    affiliateId: l.linkaffiAffiliateId,
    affiliateName: l.linkaffiAffiliateName,
  }));
}

/**
 * Nos chiffres par clé : membres rattachés (`Member.linkaffiCampaignKey`, anonymisés compris : Link Affi les garde),
 * et nos joueurs dont le clic d'offre portait la campagne (`Click.linkaffiTelegramCampaignKey`, ce que Link Affi
 * doit créditer avec `tg`).
 */
export async function ourTelegramFigures(
  db: Db,
  keys: readonly string[],
): Promise<Map<string, OurTelegramFigures>> {
  const out = new Map<string, OurTelegramFigures>();
  if (keys.length === 0) return out;
  const get = (k: string) => {
    let f = out.get(k);
    if (!f) out.set(k, (f = { members: 0, registrations: 0, ftds: 0 }));
    return f;
  };
  const [members, players] = await Promise.all([
    db.member.groupBy({
      by: ["linkaffiCampaignKey"],
      where: { linkaffiCampaignKey: { in: [...keys] } },
      _count: { _all: true },
    }),
    db.player.findMany({
      where: { click: { linkaffiTelegramCampaignKey: { in: [...keys] } } },
      select: { ftdAt: true, click: { select: { linkaffiTelegramCampaignKey: true } } },
    }),
  ]);
  for (const m of members)
    if (m.linkaffiCampaignKey) get(m.linkaffiCampaignKey).members = m._count._all;
  for (const p of players) {
    const key = p.click?.linkaffiTelegramCampaignKey;
    if (!key) continue;
    const f = get(key);
    f.registrations++;
    if (p.ftdAt) f.ftds++;
  }
  return out;
}

/**
 * Joueurs Link Affi (copie `Player.raw`) qui portent une colonne `tg`, ou rangés sous une campagne Telegram.
 * Toute la table est parcourue côté base (quelques milliers de lignes, toutes les 10 minutes).
 */
async function playerAttributionRows(
  db: Db,
  telegramCampaignIds: readonly string[],
): Promise<TelegramPlayerRow[]> {
  const cols = [...TELEGRAM_COLUMNS.player];
  const ref = Prisma.join(
    cols.map((c) => Prisma.sql`NULLIF(p."raw"->>${c}, '')`),
    ", ",
  );
  const rows = await db.$queryRaw<
    Array<{ ref: string | null; campaign_id: string | null; has_column: boolean; ftd: boolean }>
  >`
    SELECT COALESCE(${ref}) AS ref,
           p."raw"->>'campaign_id' AS campaign_id,
           (jsonb_typeof(p."raw") = 'object' AND p."raw" ?| ${cols}::text[]) AS has_column,
           (p."ftdAt" IS NOT NULL) AS ftd
    FROM "Player" p
    WHERE jsonb_typeof(p."raw") = 'object'
      AND (p."raw" ?| ${cols}::text[] OR p."raw"->>'campaign_id' = ANY(${[...telegramCampaignIds]}::text[]))`;
  return rows.map((r) => ({
    ref: r.ref,
    campaignId: r.campaign_id,
    hasColumn: r.has_column === true,
    ftd: r.ftd === true,
  }));
}

/** Repli : joueurs Link Affi liés aux membres (`telegram_members.player_id`), retrouvés dans notre copie. */
async function linkedPlayerFigures(
  db: Db,
  byKey: Map<string, { members: number; playerIds: Set<string> }>,
): Promise<TheirPlayerFigures> {
  const all = [...new Set([...byKey.values()].flatMap((v) => [...v.playerIds]))];
  const ftd = new Set<string>();
  if (all.length > 0) {
    const rows = await db.$queryRaw<Array<{ la_id: string }>>`
      SELECT p."raw"->>'id' AS la_id FROM "Player" p
      WHERE jsonb_typeof(p."raw") = 'object' AND p."raw"->>'id' = ANY(${all}::text[]) AND p."ftdAt" IS NOT NULL`;
    for (const r of rows) ftd.add(r.la_id);
  }
  const out: TheirPlayerFigures = new Map();
  for (const [key, v] of byKey) {
    if (v.playerIds.size === 0) continue;
    out.set(key, {
      registrations: v.playerIds.size,
      ftds: [...v.playerIds].filter((id) => ftd.has(id)).length,
    });
  }
  return out;
}

/**
 * Clics par campagne : compteur de la ligne Link Affi, sinon nombre de lignes de `clicks` de la campagne (au plus
 * `TELEGRAM_CLICK_COUNTS_PER_PASS` comptages par passage, les plus anciens d'abord ; les autres gardent leur chiffre).
 * Un comptage en échec arrête les comptages du passage sans faire échouer la lecture.
 */
async function clickFigures(
  client: Client,
  campaigns: readonly LaTelegramCampaign[],
  previous: TelegramCampaignsState | null,
  now: Date,
): Promise<{
  clicks: Map<string, { clicks: number | null; checkedAt: string | null }>;
  source: TelegramSources["clicks"];
}> {
  const out = new Map<string, { clicks: number | null; checkedAt: string | null }>();
  let source: TelegramSources["clicks"] = null;
  for (const c of campaigns) {
    if (c.clicks !== null) {
      out.set(c.key, { clicks: c.clicks, checkedAt: now.toISOString() });
      source = "campaigns";
    } else {
      const prev = previous?.campaigns[c.key];
      out.set(c.key, { clicks: prev?.clicks ?? null, checkedAt: prev?.clicksCheckedAt ?? null });
    }
  }
  for (const c of clickCountTargets(campaigns, previous)) {
    try {
      const n = await client.count("clicks", { eq: { campaign_id: c.clicksCampaignId! } });
      out.set(c.key, { clicks: n, checkedAt: now.toISOString() });
      source ??= "clicks";
    } catch (err) {
      logger.warn(
        { campaignKey: c.key, err: (err as Error).message },
        "campagnes Telegram Link Affi : comptage des clics interrompu",
      );
      break;
    }
  }
  if (!source && [...out.values()].some((v) => v.clicks !== null)) source = "clicks";
  return { clicks: out, source };
}

/** Lecture complète (lève en cas de panne de Link Affi : l'appelant garde alors la lecture précédente). */
async function readAndCompare(
  db: Db,
  client: Client,
  now: Date,
  previous: TelegramCampaignsState | null,
  campaignRows: readonly LaCampaign[] | null,
): Promise<TelegramCampaignsState> {
  const has = await tablePresence(client);

  // 1. Campagnes Telegram : table dédiée, sinon lignes Telegram de `campaigns` (déjà lues par ce passage si possible).
  let linkaffiCampaigns: LaTelegramCampaign[] = [];
  let campaignsSource: TelegramSources["campaigns"] = null;
  const dedicated = (await has(LINKAFFI_TELEGRAM_TABLES.campaigns))
    ? await readAll(client, LINKAFFI_TELEGRAM_TABLES.campaigns)
    : null;
  if (dedicated) {
    linkaffiCampaigns = mapTelegramCampaigns(dedicated, "telegram_campaigns");
    campaignsSource = "telegram_campaigns";
  } else {
    const rows = campaignRows ?? (await client.getAll<LaCampaign>("campaigns"));
    linkaffiCampaigns = mapTelegramCampaigns(rows as Record<string, unknown>[], "campaigns");
    if (linkaffiCampaigns.length > 0) campaignsSource = "campaigns";
  }

  // 2. Nos liens d'invitation d'affiliés, et la table de correspondance clé / identifiant Link Affi.
  const links = await ourLinks(db);
  const lookup: TelegramCampaignLookup = telegramCampaignLookup(
    linkaffiCampaigns,
    links.map((l) => l.key),
  );

  // 3. Membres chez Link Affi.
  const memberRows = (await has(LINKAFFI_TELEGRAM_TABLES.members))
    ? await readAll(client, LINKAFFI_TELEGRAM_TABLES.members)
    : null;
  const members = memberRows ? summarizeTelegramMembers(memberRows, lookup) : null;

  // 4. Inscriptions et premiers dépôts crédités par Link Affi.
  const telegramIds = [...lookup.keyById.keys()];
  const attribution = countTheirPlayers(await playerAttributionRows(db, telegramIds), lookup);
  let theirPlayers: TheirPlayerFigures | null = null;
  let registrationsSource: TelegramSources["registrations"] = null;
  if (attribution.exposed) {
    theirPlayers = attribution.byKey;
    registrationsSource = "players";
  } else if (members?.hasPlayerColumn) {
    theirPlayers = await linkedPlayerFigures(db, members.byKey);
    registrationsSource = "telegram_members";
  }

  // 5. Clics (lus chez Link Affi seulement : le lien de l'affilié ne passe jamais par nous).
  const clicks = await clickFigures(client, linkaffiCampaigns, previous, now);

  // 6. Nos chiffres, sur toutes les clés vues des deux côtés.
  const keys = new Set<string>(lookup.keys);
  for (const k of members?.byKey.keys() ?? []) keys.add(k);
  for (const k of theirPlayers?.keys() ?? []) keys.add(k);
  const ours = await ourTelegramFigures(db, [...keys]);

  return buildTelegramCampaignsState({
    now,
    sources: {
      campaigns: campaignsSource,
      members: members !== null,
      registrations: registrationsSource,
      clicks: clicks.source,
    },
    linkaffiCampaigns,
    ourLinks: links,
    theirMembers: members
      ? new Map([...members.byKey].map(([k, v]) => [k, v.members] as const))
      : null,
    theirPlayers,
    clicks: clicks.clicks,
    ours,
  });
}

/**
 * Une lecture des campagnes Telegram et l'écriture du `Setting`. Ne lève jamais : en cas de panne, la lecture
 * précédente est gardée avec la raison (`error`), et un nouvel essai a lieu 10 minutes plus tard.
 * `campaignRows` : lignes de `campaigns` lues par le même passage (évite une requête), null s'il ne les a pas lues.
 */
export async function syncTelegramCampaigns(opts: {
  db?: Db;
  client: Client;
  now?: () => Date;
  campaignRows?: readonly LaCampaign[] | null;
}): Promise<TelegramSyncOutcome> {
  const db = opts.db ?? prisma;
  const now = (opts.now ?? (() => new Date()))();
  let previous: TelegramCampaignsState | null = null;
  try {
    previous = await readPrevious(db);
    const state = await readAndCompare(db, opts.client, now, previous, opts.campaignRows ?? null);
    await writeState(db, state);
    logger.info(
      {
        available: state.available,
        sources: state.sources,
        campaigns: Object.keys(state.campaigns).length,
        divergences: state.divergences.length,
      },
      "campagnes Telegram Link Affi relues",
    );
    return {
      available: state.available,
      campaigns: Object.keys(state.campaigns).length,
      divergences: state.divergences.length,
      error: null,
    };
  } catch (err) {
    const error = telegramSyncErrorText(err);
    logger.warn(
      { err: (err as Error)?.message ?? String(err) },
      "campagnes Telegram Link Affi : lecture en échec (lecture précédente gardée)",
    );
    const state = telegramCampaignsStateAfterError(previous, now, error);
    await writeState(db, state).catch((e: Error) =>
      logger.error({ err: e.message }, "campagnes Telegram Link Affi : écriture impossible"),
    );
    return {
      available: state.available,
      campaigns: Object.keys(state.campaigns).length,
      divergences: state.divergences.length,
      error,
    };
  }
}
