/**
 * Orchestrateur de la synchro des comptes publicitaires connectés (Meta, TikTok).
 * - `tick` (toutes les heures) : une tâche par connexion active, mode choisi par `modeFor`.
 * - `connection` : jetons déchiffrés, renouvelés si besoin, rapport journalier par tranches, application aux campagnes (onglet Pubs),
 *   journal `ConnectorSyncRun`, état de la connexion (erreur lisible, « à reconnecter » si le jeton est refusé).
 * - `rates` : taux de change importés de Link Affi (`currency_rates`, lecture seule) dans `Setting` `currency.rates.imported`.
 * Après une synchro qui a remplacé des coûts CSV / saisis par ceux de l'API, ou une passe longue (28 ou 90 jours), les
 * statistiques journalières de la fenêtre sont recalculées (le recalcul horaire ne couvre que 3 jours).
 */
import { prisma } from "@linkaffipro/db";
import { decrypt, encrypt } from "@linkaffipro/core";
import { enqueue } from "@linkaffipro/queue";
import { LinkAffiClient } from "@linkaffipro/linkaffi";
import {
  describeConnectorError,
  isConnectorError,
  mergeRates,
  metaProvider,
  parseRates,
  tiktokProvider,
  type AdsProvider,
  type AppCredentials,
  type Rates,
  type TokenSet,
} from "@linkaffipro/connectors";
import { logger } from "../logger";
import { applyInsights } from "./apply";
import {
  modeFor,
  needsRefresh,
  nextFullSync,
  splitRange,
  windowDays,
  windowFor,
  type SyncMode,
} from "./plan";

export const PROVIDERS: Record<"META" | "TIKTOK", AdsProvider> = {
  META: metaProvider,
  TIKTOK: tiktokProvider,
};
/** Tranche maximale par requête (TikTok : 30 jours avec `stat_time_day` ; Meta tolère plus, même découpe par simplicité). */
const MAX_DAYS_PER_CALL = 30;

export async function tickAdsSync(now = new Date()): Promise<{ enqueued: number }> {
  const connections = await prisma.adAccountConnection.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, backfilledAt: true, nextFullSyncAt: true },
  });
  let enqueued = 0;
  for (const c of connections) {
    const mode = modeFor(c, now);
    await enqueue(
      "sync-ads",
      { type: "connection", connectionId: c.id, mode },
      { jobId: `sync-ads-${c.id}-${mode}-${now.toISOString().slice(0, 13)}` },
    );
    enqueued++;
  }
  return { enqueued };
}

export async function loadAppCredentials(
  platform: "META" | "TIKTOK",
): Promise<AppCredentials | null> {
  const app = await prisma.connectorApp.findUnique({ where: { platform } });
  if (!app) return null;
  return {
    clientId: app.clientId,
    secret: decrypt(app.secretEncrypted),
    extra: (app.extra ?? {}) as Record<string, unknown>,
  };
}

export async function loadRates(): Promise<Rates> {
  const [imported, manual] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "currency.rates.imported" } }),
    prisma.setting.findUnique({ where: { key: "currency.rates.manual" } }),
  ]);
  return mergeRates(parseRates(imported?.value), parseRates(manual?.value));
}

export async function syncConnection(
  connectionId: string,
  requestedMode?: SyncMode,
  now = new Date(),
): Promise<{ ok: boolean; rows: number; error?: string }> {
  const conn = await prisma.adAccountConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.status === "DISABLED")
    return { ok: false, rows: 0, error: "connexion absente ou désactivée" };
  if (conn.platform === "OTHER") return { ok: false, rows: 0, error: "plateforme sans connecteur" };
  const provider = PROVIDERS[conn.platform];
  const app = await loadAppCredentials(conn.platform);
  if (!app) {
    await prisma.adAccountConnection.update({
      where: { id: conn.id },
      data: {
        lastError: "Identifiants d'application absents (Réglages → Connexions → Meta ou TikTok).",
      },
    });
    return { ok: false, rows: 0, error: "application non configurée" };
  }
  const mode = requestedMode ?? modeFor(conn, now);
  const range = windowFor(mode, now);
  const run = await prisma.connectorSyncRun.create({
    data: {
      connectionId: conn.id,
      dateFrom: new Date(`${range.from}T00:00:00Z`),
      dateTo: new Date(`${range.to}T00:00:00Z`),
    },
    select: { id: true },
  });
  let tokens: TokenSet = {
    accessToken: decrypt(conn.tokenEncrypted),
    refreshToken: conn.refreshTokenEncrypted ? decrypt(conn.refreshTokenEncrypted) : null,
    expiresAt: conn.tokenExpiresAt,
    scopes: conn.scopes,
  };
  const sandbox = Boolean((app.extra as { sandbox?: boolean } | undefined)?.sandbox);
  try {
    if (needsRefresh(tokens.expiresAt, now)) {
      const refreshed = await provider.refresh(app, tokens, { sandbox, now });
      if (refreshed) {
        tokens = refreshed;
        await prisma.adAccountConnection.update({
          where: { id: conn.id },
          data: {
            tokenEncrypted: encrypt(refreshed.accessToken),
            refreshTokenEncrypted: refreshed.refreshToken
              ? encrypt(refreshed.refreshToken)
              : conn.refreshTokenEncrypted,
            tokenExpiresAt: refreshed.expiresAt ?? null,
          },
        });
      }
    }
    const rates = await loadRates();
    let total = 0;
    const report = {
      written: 0,
      skipped: 0,
      linked: 0,
      adopted: 0,
      replacedCosts: 0,
      created: { campaigns: 0, adSets: 0, ads: 0 },
      unknownCurrencies: [] as string[],
    };
    for (const chunk of splitRange(range, MAX_DAYS_PER_CALL)) {
      const rows = await provider.fetchDailyInsights(
        app,
        tokens,
        { externalId: conn.externalId, currency: conn.currency },
        chunk,
        { sandbox, now },
      );
      const r = await applyInsights(
        { id: conn.id, platform: conn.platform, currency: conn.currency, name: conn.name },
        rows,
        rates,
      );
      total += rows.length;
      report.written += r.written;
      report.skipped += r.skipped;
      report.linked += r.linked;
      report.adopted += r.adopted;
      report.replacedCosts += r.replacedCosts;
      report.created.campaigns += r.created.campaigns;
      report.created.adSets += r.created.adSets;
      report.created.ads += r.created.ads;
      for (const c of r.unknownCurrencies)
        if (!report.unknownCurrencies.includes(c)) report.unknownCurrencies.push(c);
    }
    const warn = report.unknownCurrencies.length
      ? `Devise sans taux : ${report.unknownCurrencies.join(", ")} (${report.skipped} lignes ignorées ; saisissez un taux dans Réglages → Connexions).`
      : null;
    await prisma.connectorSyncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), rows: report.written, status: "ok", error: warn },
    });
    await prisma.adAccountConnection.update({
      where: { id: conn.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncRows: report.written,
        lastError: warn,
        backfilledAt: mode === "backfill" ? new Date() : conn.backfilledAt,
        nextFullSyncAt:
          mode === "full" || mode === "backfill" ? nextFullSync(now) : conn.nextFullSyncAt,
      },
    });
    logger.info(
      { connection: conn.name, platform: conn.platform, mode, rows: total, ...report },
      "synchro des pubs terminée",
    );
    if (report.replacedCosts > 0 || (mode !== "recent" && report.written > 0))
      await enqueue(
        "stats",
        { type: "daily", days: windowDays(mode) },
        { jobId: `stats-daily-ads-${conn.id}-${now.toISOString().slice(0, 13)}` },
      ).catch((err: Error) =>
        logger.warn(
          { err: err.message },
          "recalcul des statistiques après la synchro non programmé",
        ),
      );
    return { ok: true, rows: report.written };
  } catch (err) {
    const message = describeConnectorError(err);
    const auth = isConnectorError(err) && (err.kind === "auth" || err.kind === "permission");
    await prisma.connectorSyncRun
      .update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: "error", error: message },
      })
      .catch(() => undefined);
    await prisma.adAccountConnection
      .update({
        where: { id: conn.id },
        data: { lastError: message, status: auth ? "NEEDS_RECONNECT" : conn.status },
      })
      .catch(() => undefined);
    logger.error(
      {
        connection: conn.name,
        platform: conn.platform,
        mode,
        err: message,
        kind: isConnectorError(err) ? err.kind : "other",
      },
      "synchro des pubs en échec",
    );
    // Limite de débit : on laisse BullMQ réessayer plus tard ; jeton refusé : pas de nouvel essai (reconnexion humaine).
    if (isConnectorError(err) && err.kind === "rate_limit") throw err;
    return { ok: false, rows: 0, error: message };
  }
}

/** Taux de change depuis Link Affi (table `currency_rates`, lecture seule) ; silencieux si l'API n'est pas configurée. */
export async function syncRates(
  client: Pick<LinkAffiClient, "getPage"> = new LinkAffiClient(),
): Promise<{ count: number }> {
  if (!process.env.LINKAFFI_API_URL) return { count: 0 };
  const page = await client.getPage("currency_rates", { limit: 200 });
  const rates = parseRates(page.rows.map((r) => ({ currency: r.currency, rate: r.rate })));
  const count = Object.keys(rates).length;
  if (count > 0)
    await prisma.setting.upsert({
      where: { key: "currency.rates.imported" },
      create: {
        key: "currency.rates.imported",
        value: { ...rates, _updatedAt: new Date().toISOString() },
      },
      update: { value: { ...rates, _updatedAt: new Date().toISOString() } },
    });
  return { count };
}
