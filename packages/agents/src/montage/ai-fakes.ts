/**
 * Phase 28, chantier C : faux pour les tests de l'IA du montage (aucun réseau) : IA à réponses scriptées, transcription
 * scriptée, base minimale (`Setting`, `AgentUsage`) et fichiers en mémoire. Utilisables par les autres chantiers.
 */
import type { AgentsPrisma, LlmProvider, LlmRequest } from "../types";
import type { MontageAiDeps, SttClient, SttRequest } from "./ai";

export type ScriptedReply = string | Error | ((req: LlmRequest) => string);

/** IA scriptée : une réponse par appel (la dernière se répète), coût fixe, appels gardés. */
export function createFakeMontageLlm(replies: ScriptedReply[], costCents = 1): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (r === undefined) throw new Error("aucune réponse scriptée");
      if (r instanceof Error) throw r;
      return { text: typeof r === "function" ? r(req) : r, costCents };
    },
  };
}

/** Transcription scriptée : une réponse brute par appel (la dernière se répète). */
export function createFakeStt(replies: unknown[]): SttClient & { calls: SttRequest[] } {
  const calls: SttRequest[] = [];
  return {
    calls,
    async transcribe(req) {
      calls.push(req);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

type UsageRow = { teamKey: string; provider: string; month: string; cents: number; calls: number };

/** Base minimale : réglages et dépenses en mémoire. */
export function createFakeMontagePrisma(settings: Record<string, unknown> = {}, usage: UsageRow[] = []) {
  const rows = usage.map((r) => ({ ...r }));
  const prisma = {
    setting: {
      async findUnique({ where }: { where: { key: string } }) {
        return where.key in settings ? { key: where.key, value: settings[where.key] } : null;
      },
    },
    agentUsage: {
      async findMany({ where }: { where: { teamKey: string; month: string } }) {
        return rows.filter((r) => r.teamKey === where.teamKey && r.month === where.month);
      },
      async upsert(a: {
        where: { teamKey_provider_month: { teamKey: string; provider: string; month: string } };
        create: UsageRow;
        update: { cents: { increment: number } };
      }) {
        const k = a.where.teamKey_provider_month;
        const row = rows.find((r) => r.teamKey === k.teamKey && r.provider === k.provider && r.month === k.month);
        if (row) {
          row.cents += a.update.cents.increment;
          row.calls += 1;
          return row;
        }
        rows.push({ ...a.create });
        return a.create;
      },
    },
  };
  return { prisma: prisma as unknown as AgentsPrisma, usage: rows };
}

/** Dépendances complètes de test : base en mémoire, fichiers en mémoire, aucune file. */
export function fakeMontageAiDeps(o: {
  llm?: LlmProvider | null;
  stt?: SttClient | null;
  files?: Record<string, Uint8Array>;
  settings?: Record<string, unknown>;
  usage?: UsageRow[];
  now?: Date;
}): MontageAiDeps & { usage: UsageRow[] } {
  const { prisma, usage } = createFakeMontagePrisma(o.settings, o.usage);
  const files = o.files ?? {};
  return {
    prisma,
    usage,
    now: () => o.now ?? new Date("2026-10-25T10:00:00Z"),
    enqueue: { async orchestrator() {}, async step() {} },
    montageLlm: o.llm ?? null,
    stt: o.stt ?? null,
    async readFile(path) {
      const f = files[path];
      if (!f) throw new Error(`fichier absent : ${path}`);
      return f;
    },
  };
}
