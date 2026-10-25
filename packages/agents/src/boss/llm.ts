/**
 * IA du Boss (phase 26) : interprète (appel d'outil) et rédacteur (texte court à partir d'un JSON de chiffres), au
 * modèle le moins cher de `@linkaffipro/ai` (`DEFAULT_MODEL`). Clé lue comme Réglages → IA (`readAiApiKey`), jamais
 * journalisée. Coût borné : plafond mensuel `Setting` `boss.budget` (10 € par défaut) vérifié AVANT chaque appel,
 * dépense comptée dans `AgentUsage` (équipe `boss`, poste `llm`), alertes à 80 % et 100 % une fois par mois (mêmes
 * drapeaux que les plafonds des équipes). Au plafond, l'IA est considérée absente : le Boss garde les commandes
 * exactes et le dit. `createFakeBossLlm` : table phrase → appel d'outil (aucun réseau, tests).
 */
import { createAnthropicClient, DEFAULT_MODEL, PLANNER_MODEL, QUALITY_MODEL, type AiClient, type AiToolDef, type AiToolUse } from "@linkaffipro/ai";
import type { Db as PrismaClient } from "@linkaffipro/db";
import { BOSS_BUDGET_SETTING, BOSS_TEAM_KEY, type BossLlm } from "./contract";
import { BOSS_ORDERS_DEFAULT_MONTHLY_CENTS } from "../orders/contract";
import { costCentsOf, readAiApiKey } from "../providers/llm";
import { budgetAlertLevel } from "../orchestrator/budgets";
import { pick, voiceTemplate, type VoiceTable } from "./voice";
import { parisMonth } from "../rules/time";
import { normalizeText } from "../human/answer";
import type { AdminMessenger, Logger } from "../types";

/** Levée quand le plafond mensuel du Boss est atteint (l'appelant répond sans IA). */
export class BossBudgetError extends Error {
  constructor(message = "plafond mensuel de l'IA du Boss atteint") {
    super(message);
    this.name = "BossBudgetError";
  }
}

/** Alertes de plafond de l'IA de Kevin (charte `docs/KEVIN-VOIX.md`). */
export const LLM_VARIANTS = {
  cap100: voiceTemplate([{ spent: "10,02 €", cap: "10,00 €" }], (p: { spent: string; cap: string }) => [
    `⚠️ Mon plafond d'IA est atteint : ${p.spent} pour ${p.cap} ce mois-ci. Je ne suis plus que les commandes simples (écris « aide ») jusqu'au mois prochain, ou jusqu'à ce que tu montes le plafond.`,
    `⚠️ J'ai atteint mon plafond d'IA du mois (${p.spent} pour ${p.cap}). D'ici le mois prochain, ou une hausse du plafond, je ne comprends que les commandes simples.`,
  ]),
  cap80: voiceTemplate([{ spent: "8,50 €", cap: "10,00 €" }], (p: { spent: string; cap: string }) => [
    `Mon IA a déjà coûté ${p.spent} sur les ${p.cap} permis ce mois-ci (80 % du plafond).`,
    `J'ai utilisé 80 % de mon plafond d'IA du mois : ${p.spent} sur ${p.cap}.`,
  ]),
} satisfies VoiceTable;

export const BOSS_INTERPRET_MAX_TOKENS = 1200;
export const BOSS_WRITE_MAX_TOKENS = 700;
/** Phase 33 : planificateur des ordres (Opus 5.5, réflexion comprise dans le plafond de sortie). */
export const BOSS_PLAN_MAX_TOKENS = 8000;

/**
 * Phase 33 — IA du Boss étendue (le type `BossLlm` du contrat est figé) : planificateur des ordres (Opus 5.5, sortie
 * JSON stricte, sans outil ni température, effort « medium ») et rédaction soignée (Sonnet 5.5) pour les réponses
 * des équipes. Absents (ancienne IA injectée) : l'appelant se replie sur `write` ou sur le code.
 */
export type BossLlmExt = BossLlm & {
  plan?(req: { system: string; user: string }): Promise<{ text: string; costCents: number }>;
  writeQuality?(req: { system: string; user: string }): Promise<{ text: string; costCents: number }>;
};

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * Plafond mensuel du Boss en centimes (`{ monthlyCents }`, 3 000 par défaut depuis la phase 33 : le planificateur des
 * ordres compte dans le même budget ; 0 = aucun appel).
 */
export async function bossMonthlyCapCents(prisma: Pick<PrismaClient, "setting">): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: BOSS_BUDGET_SETTING } });
  const v = (row?.value as { monthlyCents?: unknown } | null)?.monthlyCents;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : BOSS_ORDERS_DEFAULT_MONTHLY_CENTS;
}

/** Dépense IA du Boss ce mois-ci (centimes) et nombre d'appels. */
export async function bossMonthSpend(
  prisma: Pick<PrismaClient, "agentUsage">,
  now = new Date(),
): Promise<{ cents: number; calls: number }> {
  const row = await prisma.agentUsage.findUnique({
    where: { teamKey_provider_month: { teamKey: BOSS_TEAM_KEY, provider: "llm", month: parisMonth(now) } },
  });
  return { cents: row?.cents ?? 0, calls: row?.calls ?? 0 };
}

export async function bossBudgetState(
  prisma: Pick<PrismaClient, "setting" | "agentUsage">,
  now = new Date(),
): Promise<{ allowed: boolean; spentCents: number; capCents: number }> {
  const [capCents, spend] = await Promise.all([bossMonthlyCapCents(prisma), bossMonthSpend(prisma, now)]);
  return { allowed: spend.cents < capCents, spentCents: spend.cents, capCents };
}

export type BossLlmOptions = {
  /** Client IA (tests) ; sinon le client Anthropic avec la clé de Réglages → IA. */
  client?: AiClient;
  factory?: (apiKey: string) => AiClient;
  model?: string;
  now?: () => Date;
  /** Messager admin pour les alertes 80 % / 100 %. */
  admin?: AdminMessenger;
  logger?: Logger;
};

/** Compte une dépense du Boss et prévient à 80 % puis à 100 % (une fois par mois chacun). */
export async function recordBossUsage(
  prisma: PrismaClient,
  cents: number,
  opts: { now?: Date; admin?: AdminMessenger; logger?: Logger } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const month = parisMonth(now);
  const add = Math.max(0, Math.round(cents));
  const where = { teamKey_provider_month: { teamKey: BOSS_TEAM_KEY, provider: "llm", month } };
  const row = await prisma.agentUsage.upsert({
    where,
    create: { teamKey: BOSS_TEAM_KEY, provider: "llm", month, cents: add, calls: 1 },
    update: { cents: { increment: add }, calls: { increment: 1 } },
  });
  const cap = await bossMonthlyCapCents(prisma);
  const level = budgetAlertLevel(row.cents, cap, row);
  if (!level) return;
  // Sans messager, l'alerte n'est pas « donnée » : le drapeau reste à poser par un appel qui pourra l'envoyer.
  if (!opts.admin) return;
  const claimed = await prisma.agentUsage.updateMany({
    where: { id: row.id, [level === 100 ? "alerted100" : "alerted80"]: false },
    data: level === 100 ? { alerted100: true, alerted80: true } : { alerted80: true },
  });
  if (claimed.count === 0) return;
  try {
    await prisma.event.create({
      data: {
        type: `agents.budget.alert${level}`,
        occurredAt: now,
        payload: { teamKey: BOSS_TEAM_KEY, provider: "llm", month, cents: row.cents, cap },
      },
    });
  } catch (err) {
    opts.logger?.warn({ err: (err as Error).message }, "[boss] événement d'alerte non écrit");
  }
  const text =
    level === 100
      ? pick(LLM_VARIANTS.cap100({ spent: eur(row.cents), cap: eur(cap) }), "llm.cap100")
      : pick(LLM_VARIANTS.cap80({ spent: eur(row.cents), cap: eur(cap) }), "llm.cap80");
  try {
    await opts.admin?.send(text);
  } catch (err) {
    opts.logger?.warn({ err: (err as Error).message }, "[boss] alerte de plafond non envoyée");
  }
}

/** Interprète et rédacteur au-dessus d'un client IA, avec contrôle du plafond avant chaque appel. */
export function bossLlmFromClient(prisma: PrismaClient, client: AiClient, opts: BossLlmOptions = {}): BossLlmExt {
  const model = opts.model ?? DEFAULT_MODEL;
  const now = () => (opts.now ? opts.now() : new Date());
  const guard = async () => {
    const s = await bossBudgetState(prisma, now());
    if (!s.allowed) throw new BossBudgetError();
  };
  const count = async (cents: number) => {
    try {
      await recordBossUsage(prisma, cents, { now: now(), admin: opts.admin, logger: opts.logger });
    } catch (err) {
      opts.logger?.warn({ err: (err as Error).message }, "[boss] dépense non comptée");
    }
  };
  return {
    async interpret(req) {
      await guard();
      const res = await client.createMessage({
        model,
        maxTokens: BOSS_INTERPRET_MAX_TOKENS,
        system: [{ text: req.system, cache: true }],
        user: req.user,
        tools: req.tools,
      });
      const costCents = costCentsOf(model, res.usage);
      await count(costCents);
      return { toolUse: res.toolUses?.[0] ?? null, text: res.text, costCents };
    },
    async write(req) {
      await guard();
      const res = await client.createMessage({
        model,
        maxTokens: BOSS_WRITE_MAX_TOKENS,
        system: [{ text: req.system, cache: true }],
        user: req.user,
      });
      const costCents = costCentsOf(model, res.usage);
      await count(costCents);
      return { text: res.text, costCents };
    },
    async plan(req) {
      await guard();
      const res = await client.createMessage({
        model: PLANNER_MODEL,
        maxTokens: BOSS_PLAN_MAX_TOKENS,
        effort: "medium",
        system: [{ text: req.system, cache: true }],
        user: req.user,
      });
      const costCents = costCentsOf(PLANNER_MODEL, res.usage);
      await count(costCents);
      return { text: res.text, costCents };
    },
    async writeQuality(req) {
      await guard();
      const res = await client.createMessage({
        model: QUALITY_MODEL,
        maxTokens: BOSS_WRITE_MAX_TOKENS,
        system: [{ text: req.system, cache: true }],
        user: req.user,
      });
      const costCents = costCentsOf(QUALITY_MODEL, res.usage);
      await count(costCents);
      return { text: res.text, costCents };
    },
  };
}

/**
 * IA du Boss si une clé est réglée et le plafond du mois pas atteint ; sinon null (le Boss ne garde que les
 * commandes exactes et le dit).
 */
export async function loadBossLlm(prisma: PrismaClient, opts: BossLlmOptions = {}): Promise<BossLlmExt | null> {
  const state = await bossBudgetState(prisma, opts.now ? opts.now() : new Date());
  if (!state.allowed) return null;
  if (opts.client) return bossLlmFromClient(prisma, opts.client, opts);
  const key = await readAiApiKey(prisma);
  if (!key) return null;
  const client = (opts.factory ?? ((k: string) => createAnthropicClient(k, { timeoutMs: 30_000 })))(key);
  return bossLlmFromClient(prisma, client, opts);
}

// ---------------------------------------------------------------------------------------------------------------
// Fausse IA (tests) : aucune requête réseau.

/** Ligne du message de l'admin dans la demande envoyée à l'interprète (voir `interpret.ts`). */
export const BOSS_MESSAGE_MARK = "MESSAGE DE L'ADMIN :";

/** Message de l'admin extrait de la demande (fausse IA). */
export function bossMessageOf(user: string): string {
  const i = user.lastIndexOf(BOSS_MESSAGE_MARK);
  return (i >= 0 ? user.slice(i + BOSS_MESSAGE_MARK.length) : user).trim();
}

export type FakeBossCall = AiToolUse | null | ((message: string, user: string) => AiToolUse | null);
export type FakeBossTable = ReadonlyArray<readonly [string | RegExp, FakeBossCall]>;

export type FakeBossLlm = BossLlmExt & {
  calls: {
    interpret: { system: string; user: string; tools: AiToolDef[] }[];
    write: { system: string; user: string }[];
    plan: { system: string; user: string }[];
    writeQuality: { system: string; user: string }[];
  };
};

/** Faux planificateur : rend le texte (JSON) du plan pour la demande (`user`), ou un objet sérialisé. */
export type FakePlanner = (message: string, user: string) => string | Record<string, unknown> | null;

/**
 * Fausse IA : table phrase (exacte après normalisation, ou expression) → appel d'outil attendu. Phrase inconnue :
 * aucun outil. `writer` : texte rendu par `write` (par défaut : vide, le code met les chiffres en forme).
 */
export function createFakeBossLlm(
  table: FakeBossTable,
  opts: { writer?: (user: string) => string; costCents?: number; planner?: FakePlanner; quality?: (user: string) => string; planCostCents?: number } = {},
): FakeBossLlm {
  const calls: FakeBossLlm["calls"] = { interpret: [], write: [], plan: [], writeQuality: [] };
  return {
    calls,
    async interpret(req) {
      calls.interpret.push(req);
      const message = bossMessageOf(req.user);
      const n = normalizeText(message);
      for (const [pattern, call] of table) {
        const hit = typeof pattern === "string" ? normalizeText(pattern) === n : pattern.test(message);
        if (!hit) continue;
        const toolUse = typeof call === "function" ? call(message, req.user) : call;
        return { toolUse, text: "", costCents: opts.costCents ?? 0 };
      }
      return { toolUse: null, text: "", costCents: opts.costCents ?? 0 };
    },
    async write(req) {
      calls.write.push(req);
      return { text: opts.writer ? opts.writer(req.user) : "", costCents: opts.costCents ?? 0 };
    },
    async plan(req) {
      calls.plan.push(req);
      const out = opts.planner ? opts.planner(bossMessageOf(req.user), req.user) : null;
      return { text: out === null ? "" : typeof out === "string" ? out : JSON.stringify(out), costCents: opts.planCostCents ?? opts.costCents ?? 0 };
    },
    async writeQuality(req) {
      calls.writeQuality.push(req);
      return { text: opts.quality ? opts.quality(req.user) : opts.writer ? opts.writer(req.user) : "", costCents: opts.costCents ?? 0 };
    },
  };
}
