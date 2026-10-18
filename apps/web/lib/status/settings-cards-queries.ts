/**
 * Lecture des données des pastilles de Réglages (lib/status/settings-cards.ts). Seuls les blocs demandés sont lus
 * (un MANAGER ne voit que Bots, IA et Journal) ; chaque bloc tolère une panne (`null` : pas de pastille plutôt
 * qu'une page en erreur). Règles reprises telles quelles : tuiles d'État du système (`getHealthInput`, connexion des
 * bots vérifiée auprès de Telegram en 5 s au plus, comme la page Bots), invitations en attente comme Réglages →
 * Équipe (non acceptées, non expirées), clé IA de `loadAiConfig`, IA de conversation de `loadAssistantConfig`,
 * registre des étiquettes `getTagRegistry`.
 */
import { prisma } from "@linkaffipro/db";
import { loadAiConfig } from "@/lib/ai/config";
import { loadAssistantConfig } from "@/lib/assistant/config";
import { getTagRegistry } from "@/lib/members/tags";
import type { BotHealth } from "./health";
import { botStatuses, getHealthInput, type HealthInput } from "./queries";
import { NO_STATE_INPUT, type SettingsStateInput, type SettingsStateKey } from "./settings-cards";

/** Lectures remplaçables dans les tests (Telegram, Redis). */
export type SettingsStateLoaders = {
  health: (now: Date) => Promise<HealthInput>;
  bots: () => Promise<BotHealth[]>;
};

function safe<T>(p: Promise<T>, label: string): Promise<T | null> {
  return p.catch((err: unknown) => {
    console.error(`[réglages] ${label} :`, err instanceof Error ? err.message : err);
    return null;
  });
}

const skip = Promise.resolve(null);

export async function loadSettingsStateInput(
  keys: ReadonlySet<SettingsStateKey>,
  now = new Date(),
  loaders: Partial<SettingsStateLoaders> = {},
): Promise<SettingsStateInput> {
  const need = (...k: SettingsStateKey[]) => k.some((x) => keys.has(x));
  const loadHealth = loaders.health ?? getHealthInput;
  const loadBots = loaders.bots ?? botStatuses;
  // Les bots de la carte Bots sont ceux des tuiles quand celles-ci sont lues (une seule vérification Telegram).
  const healthP: Promise<HealthInput | null> = need("status")
    ? safe(loadHealth(now), "état du système")
    : skip;
  const botsP: Promise<readonly BotHealth[] | null> = need("bots")
    ? need("status")
      ? healthP.then((h) => h?.bots ?? null)
      : safe(loadBots(), "bots")
    : skip;
  const [
    health,
    bots,
    sync,
    connections,
    telegram,
    team,
    openAlerts,
    ai,
    assistant,
    categories,
    tags,
    postbacks,
  ] = await Promise.all([
    healthP,
    botsP,
    need("linkaffi")
      ? safe(
          prisma.syncState.findMany({ select: { lastSuccessAt: true, lastError: true } }),
          "synchro Link Affi",
        )
      : skip,
    need("meta", "tiktok")
      ? safe(
          prisma.adAccountConnection
            .groupBy({ by: ["platform", "status"], _count: { _all: true } })
            .then((rows) =>
              rows.map((r) => ({ platform: r.platform, status: r.status, count: r._count._all })),
            ),
          "comptes publicitaires",
        )
      : skip,
    need("telegram")
      ? safe(
          prisma.telegramUserSession
            .findUnique({ where: { id: "main" }, select: { status: true } })
            .then((s) => ({ status: s?.status ?? null })),
          "compte Telegram",
        )
      : skip,
    need("team")
      ? safe(
          Promise.all([
            prisma.user.count({ where: { isActive: true } }),
            prisma.invitation.count({ where: { acceptedAt: null, expiresAt: { gt: now } } }),
          ]).then(([users, pendingInvitations]) => ({ users, pendingInvitations })),
          "équipe",
        )
      : skip,
    need("alerts") ? safe(prisma.alert.count({ where: { resolvedAt: null } }), "alertes") : skip,
    need("ai")
      ? safe(
          loadAiConfig().then((c) => ({
            hasKey: Boolean(c.apiKeyEncrypted),
            lastError: c.lastError,
          })),
          "IA",
        )
      : skip,
    need("assistant")
      ? safe(
          loadAssistantConfig().then((c) => ({
            hasKey: Boolean(c.apiKeyEncrypted),
            lastError: c.lastError,
            verifiedAt: c.verifiedAt,
            activation: c.activation,
          })),
          "IA de conversation",
        )
      : skip,
    need("categories")
      ? safe(prisma.messageCategory.count({ where: { isActive: true } }), "catégories")
      : skip,
    need("tags")
      ? safe(
          getTagRegistry().then((t) => t.length),
          "étiquettes",
        )
      : skip,
    need("postbacks")
      ? safe(prisma.postbackEndpoint.count({ where: { isActive: true } }), "retours du casino")
      : skip,
  ]);
  return {
    ...NO_STATE_INPUT,
    health,
    sync,
    connections,
    telegram,
    bots,
    team,
    openAlerts,
    ai,
    assistant,
    categories,
    tags,
    postbacks,
  };
}
