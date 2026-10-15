/**
 * Validation automatique des canaux obligatoires côté worker (phase 14, décision E3).
 * - Filet toutes les 2 minutes (`gate-sweep`) : demandes en attente des canaux de moins de 7 jours ; nos données
 *   d'abord, `getChatMember` seulement si besoin, au plus 30 appels par bot et par passage (jamais vérifiées d'abord,
 *   puis les moins récemment vérifiées ; 429 : ce bot s'arrête jusqu'à la fin de l'attente `retry_after` imposée par
 *   Telegram, même sur les passages suivants), une même demande revue par Telegram de moins en moins souvent avec l'âge.
 * - Rattrapage unique (`gate-backfill`, ou `pnpm db:phase14`) : même vérification sur toutes les demandes en attente ;
 *   fait automatiquement au premier passage du filet si la marque `phase14.gateBackfill` manque.
 * La logique est dans @linkaffipro/telegram (auto-gate.ts) ; ici l'API des bots du worker et son journal.
 */
import { prisma } from "@linkaffipro/db";
import {
  GATE_BACKFILL_KEY,
  runGateBackfillOnce,
  runGateSweepWithDb,
  type GateBackfillResult,
  type GateSweepReport,
} from "@linkaffipro/telegram";
import { logger } from "../logger";
import { apiForBot } from "./telegram-actions";

/** Âge maximal des demandes revues par le filet. */
export const GATE_SWEEP_MAX_AGE_MS = 7 * 24 * 3600_000;
/** Appels `getChatMember` au plus par bot et par passage du filet. */
export const GATE_SWEEP_BUDGET_PER_BOT = 30;

/** Dernière vérification par Telegram de chaque demande (mémoire du processus, perdue au redémarrage : sans risque). */
const lastApiCheck = new Map<string, number>();
/**
 * Heure de reprise des appels `getChatMember` de chaque bot après un 429 (`retry_after` de Telegram), gardée d'un
 * passage à l'autre : le filet ne rappelle jamais Telegram avec ce bot avant (le même bot accepte les demandes et écrit
 * aux membres).
 */
const botPauses = new Map<string, number>();

/** Oublie la mémoire du filet (tests). */
export function resetGateSweepMemory(): void {
  lastApiCheck.clear();
  botPauses.clear();
}

/** Bots du filet en pause après un 429 (heure de reprise), pour les tests et l'état du système. */
export function gateSweepBotPauses(): ReadonlyMap<string, number> {
  return botPauses;
}

/** API d'un de nos bots actifs par le cache du worker (null : bot inconnu ou inactif). */
async function workerApiFor(botId: string) {
  const bot = await prisma.bot.findFirst({
    where: { id: botId, isActive: true },
    select: { id: true, tokenEncrypted: true },
  });
  return bot ? apiForBot(bot) : null;
}

const warn = (message: string, details: Record<string, unknown>) => logger.warn(details, message);

/** Rattrapage unique des demandes en attente des canaux (idempotent, marque `phase14.gateBackfill`). */
export async function runGateBackfill(
  opts: { now?: Date; force?: boolean } = {},
): Promise<GateBackfillResult> {
  const r = await runGateBackfillOnce({
    ...opts,
    by: "worker",
    apiFor: workerApiFor,
    warn,
    botPauses,
  });
  if (!r.alreadyDone)
    logger.info(
      {
        checked: r.checked,
        satisfied: r.satisfied,
        stillPending: r.stillPending,
        deferred: r.deferred,
      },
      "rattrapage des demandes en attente des canaux",
    );
  return r;
}

/** Passage du filet (toutes les 2 minutes) ; le premier fait le rattrapage unique s'il n'a pas encore eu lieu. */
export async function runGateSweep(
  now = new Date(),
): Promise<GateSweepReport | { backfill: GateBackfillResult }> {
  const marker = await prisma.setting.findUnique({
    where: { key: GATE_BACKFILL_KEY },
    select: { key: true },
  });
  if (!marker) return { backfill: await runGateBackfill({ now }) };
  const report = await runGateSweepWithDb({
    now,
    maxAgeMs: GATE_SWEEP_MAX_AGE_MS,
    budgetPerBot: GATE_SWEEP_BUDGET_PER_BOT,
    trigger: "sweep",
    lastApiCheck,
    botPauses,
    apiFor: workerApiFor,
    warn,
  });
  if (report.satisfied.length > 0 || report.errors > 0)
    logger.info(
      {
        checked: report.checked,
        satisfied: report.satisfied.length,
        deferred: report.deferred,
        apiCalls: report.apiCalls,
        errors: report.errors,
      },
      "demandes en attente des canaux revérifiées",
    );
  return report;
}
