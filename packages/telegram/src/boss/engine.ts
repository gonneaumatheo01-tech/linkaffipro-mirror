/**
 * Phase 26 : port du moteur du Boss (chantier B, `packages/agents/src/boss/*`) vu du bot et du worker. Les handlers et
 * la tâche `boss-text` ne dépendent que de ce type : les tests injectent un faux moteur, la production le moteur réel
 * de `@linkaffipro/agents` (`bossFastPath`, `bossAiTurn`, `handleBossCallback`, `rememberBossPendingMessage`,
 * `loadBossLlm`).
 */
import {
  bossAiTurn,
  bossFastPath,
  handleBossCallback,
  isBossCallbackData,
  loadBossLlm,
  rememberBossPendingMessage,
  type BossDeps,
  type BossFastResult,
  type BossLlm,
  type BossReply,
  type BossTeamInput,
  type AdminMessenger,
  type Logger,
} from "@linkaffipro/agents";

export type BossCallbackInput = { data: string; fromTelegramId: bigint; messageId?: number | null };

/** Réponse à un bouton `bsc:` : la réponse habituelle, plus le petit message du bouton et le retrait des boutons. */
export type BossCallbackResult = BossReply & { toast?: string; removeButtons?: boolean };

export type BossEngine = {
  /** Secret → réponse à une question ouverte → OUI / NON / annule → commande exacte (instantané, sans IA). */
  fastPath(deps: BossDeps, input: BossTeamInput): Promise<BossFastResult>;
  /** Interprète IA (worker, tâche `boss-text`) : écrit les `BossTurn` et rend toujours une réponse. */
  aiTurn(deps: BossDeps, input: BossTeamInput): Promise<BossReply>;
  isCallbackData(data: string): boolean;
  callback(deps: BossDeps, input: BossCallbackInput): Promise<BossCallbackResult>;
  rememberPendingMessage(deps: BossDeps, pendingId: string, messageId: number): Promise<void>;
  /** `admin` et `logger` : sans messager, les alertes 80 % / 100 % du plafond de l'IA du Boss ne partent jamais. */
  loadLlm(prisma: unknown, opts?: { admin?: AdminMessenger; logger?: Logger }): Promise<BossLlm | null>;
};

/** Moteur réel (`@linkaffipro/agents`, chantier B). */
export const realBossEngine: BossEngine = {
  fastPath: (deps, input) => bossFastPath(deps, input),
  aiTurn: (deps, input) => bossAiTurn(deps, input),
  isCallbackData: (data) => isBossCallbackData(data),
  callback: (deps, input) => handleBossCallback(deps, input) as Promise<BossCallbackResult>,
  rememberPendingMessage: (deps, pendingId, messageId) => rememberBossPendingMessage(deps, pendingId, messageId),
  loadLlm: (prisma, opts) => loadBossLlm(prisma as Parameters<typeof loadBossLlm>[0], { admin: opts?.admin, logger: opts?.logger }),
};
