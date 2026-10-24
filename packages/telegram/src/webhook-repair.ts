/**
 * Phase 26 : contrôle et réparation automatique des connexions Telegram (webhooks), tâche `maintenance`
 * `webhook-repair` du worker toutes les 10 minutes. Pour chaque bot actif (bots fantômes des comptes réels ignorés) :
 * `getWebhookInfo` ; adresse différente de la nôtre, aucune adresse, 403 récent (< 1 h : secret différent) ou messages /
 * boutons non transmis → webhook reposé avec le secret de la base (`setWebhookForBot`), événement
 * `telegram.webhook_repaired`. Résultat du dernier contrôle dans `Setting` `telegram.webhookCheck` (État du système).
 * Jamais hors production (`webhookRepairRefusal` : un worker de développement ne repointe pas les bots vers sa machine).
 */
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import {
  isGhostBotUsername,
  webhookProblems,
  webhookProblemText,
  webhookRepairRefusal,
  type WebhookInfoLike,
  type WebhookProblem,
} from "./webhook-health";

export const WEBHOOK_CHECK_SETTING = "telegram.webhookCheck";
export const WEBHOOK_REPAIRED_EVENT = "telegram.webhook_repaired";

export type WebhookRepairBot = { id: string; username: string };

export type WebhookRepairDeps = {
  listBots(): Promise<WebhookRepairBot[]>;
  getInfo(botId: string): Promise<WebhookInfoLike>;
  /** Repose le webhook (secret de la base) et rend le nouvel état. */
  repair(botId: string): Promise<WebhookInfoLike>;
  expectedUrl(botId: string): string;
  recordRepaired(bot: WebhookRepairBot, payload: Record<string, unknown>): Promise<void>;
  saveCheck(check: WebhookCheck): Promise<void>;
  /** Dernier contrôle enregistré (dates des dernières réparations par bot). Absent : aucune. */
  previousCheck?(): Promise<WebhookCheck | null>;
  now?: () => Date;
};

export type WebhookBotCheck = {
  botId: string;
  username: string;
  ok: boolean;
  problems: WebhookProblem[];
  repaired: boolean;
  pending?: number;
  /** Erreur de lecture ou de réparation (texte de Telegram, jamais un jeton). */
  error?: string;
  /** Cause en français. */
  cause?: string;
  /**
   * Dernière réparation réussie de ce bot (ISO), reportée d'un contrôle à l'autre : une erreur 403 de Telegram
   * antérieure ou égale ne relance pas de réparation (Telegram garde l'ancienne erreur après la pose).
   */
  repairedAt?: string;
};

export type WebhookCheck = { at: string; skipped?: string; bots: WebhookBotCheck[] };

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

export async function runWebhookRepair(deps: WebhookRepairDeps): Promise<WebhookCheck> {
  const now = deps.now?.() ?? new Date();
  const bots = (await deps.listBots()).filter((b) => !isGhostBotUsername(b.username));
  const previous = deps.previousCheck ? await deps.previousCheck().catch(() => null) : null;
  const lastRepair = new Map<string, string>();
  for (const b of previous?.bots ?? []) if (typeof b.repairedAt === "string") lastRepair.set(b.botId, b.repairedAt);
  const out: WebhookBotCheck[] = [];
  for (const bot of bots) {
    const prevRepairedAt = lastRepair.get(bot.id);
    const keep = prevRepairedAt ? { repairedAt: prevRepairedAt } : {};
    let info: WebhookInfoLike;
    try {
      info = await deps.getInfo(bot.id);
    } catch (err) {
      out.push({ botId: bot.id, username: bot.username, ok: false, problems: [], repaired: false, error: errText(err), cause: "lecture impossible chez Telegram (jeton refusé ou réseau)", ...keep });
      continue;
    }
    const lastRepairAt = prevRepairedAt && !Number.isNaN(Date.parse(prevRepairedAt)) ? new Date(prevRepairedAt) : null;
    const problems = webhookProblems(info, deps.expectedUrl(bot.id), now, { lastRepairAt });
    if (problems.length === 0) {
      out.push({ botId: bot.id, username: bot.username, ok: true, problems, repaired: false, pending: info.pending_update_count ?? 0, ...keep });
      continue;
    }
    const cause = problems.map(webhookProblemText).join(" ; ");
    try {
      const after = await deps.repair(bot.id);
      await deps.recordRepaired(bot, {
        problems,
        previousUrlMatches: info.url === deps.expectedUrl(bot.id),
        lastErrorMessage: info.last_error_message ?? null,
        pending: after.pending_update_count ?? 0,
      });
      out.push({ botId: bot.id, username: bot.username, ok: true, problems, repaired: true, pending: after.pending_update_count ?? 0, cause, repairedAt: now.toISOString() });
    } catch (err) {
      out.push({ botId: bot.id, username: bot.username, ok: false, problems, repaired: false, error: errText(err), cause, ...keep });
    }
  }
  const check: WebhookCheck = { at: now.toISOString(), bots: out };
  await deps.saveCheck(check);
  return check;
}

/** Lecture tolérante du dernier contrôle (`Setting` `telegram.webhookCheck`). */
export function parseWebhookCheck(value: unknown): WebhookCheck | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<WebhookCheck>;
  if (typeof v.at !== "string" || !Array.isArray(v.bots)) return null;
  return { at: v.at, ...(typeof v.skipped === "string" ? { skipped: v.skipped } : {}), bots: v.bots as WebhookBotCheck[] };
}

/** Version branchée sur la base et l'API Telegram réelles (worker). */
export async function runWebhookRepairWithDb(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<WebhookCheck> {
  const save = async (check: WebhookCheck) => {
    await prisma.setting.upsert({
      where: { key: WEBHOOK_CHECK_SETTING },
      create: { key: WEBHOOK_CHECK_SETTING, value: toJsonValue(check) },
      update: { value: toJsonValue(check) },
    });
  };
  const refusal = webhookRepairRefusal(env);
  if (refusal) return { at: new Date().toISOString(), skipped: refusal, bots: [] };
  const { getWebhookInfoForBot, setWebhookForBot, webhookUrlFor } = await import("./service");
  return runWebhookRepair({
    async listBots() {
      return prisma.bot.findMany({
        // Contrôle de TOUS nos bots actifs, Boss compris ; jamais un bot fantôme (faux jeton).
        where: { isActive: true, userbotAccounts: { none: {} } },
        select: { id: true, username: true },
        orderBy: { createdAt: "asc" },
      });
    },
    getInfo: (botId) => getWebhookInfoForBot(botId),
    repair: (botId) => setWebhookForBot(botId),
    expectedUrl: (botId) => webhookUrlFor(botId, env.APP_BASE_URL),
    async recordRepaired(bot, payload) {
      await recordEvent({ type: WEBHOOK_REPAIRED_EVENT, botId: bot.id, payload: toJsonValue({ username: bot.username, ...payload }) });
    },
    saveCheck: save,
    async previousCheck() {
      const row = await prisma.setting.findUnique({ where: { key: WEBHOOK_CHECK_SETTING } });
      return parseWebhookCheck(row?.value);
    },
  });
}
