/**
 * Phase 26 : port du moteur du Boss (chantier B, `packages/agents/src/boss/*`) vu du bot et du worker. Les handlers et
 * la tâche `boss-text` ne dépendent que de ce type : les tests injectent un faux moteur, la production le moteur réel
 * de `@linkaffipro/agents` (`bossFastPath`, `bossAiTurn`, `handleBossCallback`, `rememberBossPendingMessage`,
 * `loadBossLlm`), lu au premier appel.
 */
import {
  BOSS_CALLBACK_PREFIX,
  type BossDeps,
  type BossFastResult,
  type BossInput,
  type BossLlm,
  type BossReply,
} from "@linkaffipro/agents";

export type BossCallbackInput = { data: string; fromTelegramId: bigint; messageId?: number | null };

/** Réponse à un bouton `bsc:` : la réponse habituelle, plus le petit message du bouton et le retrait des boutons. */
export type BossCallbackResult = BossReply & { toast?: string; removeButtons?: boolean };

export type BossEngine = {
  /** Secret → réponse à une question ouverte → OUI / NON / annule → commande exacte (instantané, sans IA). */
  fastPath(deps: BossDeps, input: BossInput): Promise<BossFastResult>;
  /** Interprète IA (worker, tâche `boss-text`) : écrit les `BossTurn` et rend toujours une réponse. */
  aiTurn(deps: BossDeps, input: BossInput): Promise<BossReply>;
  isCallbackData(data: string): boolean;
  callback(deps: BossDeps, input: BossCallbackInput): Promise<BossCallbackResult>;
  rememberPendingMessage(deps: BossDeps, pendingId: string, messageId: number): Promise<void>;
  loadLlm(prisma: unknown): Promise<BossLlm | null>;
};

type AgentsBossExports = {
  bossFastPath?: (deps: BossDeps, input: BossInput) => Promise<BossFastResult>;
  bossAiTurn?: (deps: BossDeps, input: BossInput) => Promise<BossReply>;
  handleBossCallback?: (deps: BossDeps, input: BossCallbackInput) => Promise<BossCallbackResult>;
  isBossCallbackData?: (data: string) => boolean;
  rememberBossPendingMessage?: (deps: BossDeps, pendingId: string, messageId: number) => Promise<void>;
  loadBossLlm?: (prisma: never) => Promise<BossLlm | null>;
};

let loaded: AgentsBossExports | null = null;

async function agentsExports(): Promise<AgentsBossExports> {
  loaded ??= (await import("@linkaffipro/agents")) as unknown as AgentsBossExports;
  return loaded;
}

function need<K extends keyof AgentsBossExports>(mod: AgentsBossExports, key: K): NonNullable<AgentsBossExports[K]> {
  const fn = mod[key];
  if (typeof fn !== "function") throw new Error(`moteur du Boss indisponible (${String(key)})`);
  return fn as NonNullable<AgentsBossExports[K]>;
}

/** Moteur réel (`@linkaffipro/agents`). */
export const realBossEngine: BossEngine = {
  async fastPath(deps, input) {
    return need(await agentsExports(), "bossFastPath")(deps, input);
  },
  async aiTurn(deps, input) {
    return need(await agentsExports(), "bossAiTurn")(deps, input);
  },
  isCallbackData(data) {
    const fn = loaded?.isBossCallbackData;
    return typeof fn === "function" ? fn(data) : data.startsWith(BOSS_CALLBACK_PREFIX);
  },
  async callback(deps, input) {
    return need(await agentsExports(), "handleBossCallback")(deps, input);
  },
  async rememberPendingMessage(deps, pendingId, messageId) {
    return need(await agentsExports(), "rememberBossPendingMessage")(deps, pendingId, messageId);
  },
  async loadLlm(prisma) {
    return need(await agentsExports(), "loadBossLlm")(prisma as never);
  },
};
