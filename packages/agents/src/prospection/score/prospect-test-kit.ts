/**
 * Phase 31, chantier C — outils des tests de l'Évaluateur et du Pipeline (base en mémoire, messager admin simulé,
 * faux QA qui approuve, horloge réglable). Jamais importé par le code de production.
 */
import { vi } from "vitest";
import { createTestKit } from "../../human/test-kit";
import type { QaDeps } from "../../qa/contract";
import type { LlmProvider } from "../../types";
import type { ProspectionDeps, ProspectionQueueJob } from "../contract";
import { sampleProspect } from "../pipeline/cards";
import type { ProspectRow } from "./store";

export function createProspectKit(start = new Date("2026-10-26T08:00:00Z")) {
  const kit = createTestKit(start);
  const jobs: ProspectionQueueJob[] = [];
  const deps = kit.deps as unknown as ProspectionDeps & QaDeps & { prospectionLlm?: LlmProvider | null; monthlyBudgetCents?: number };
  deps.prospection = { enqueue: vi.fn(async (job: ProspectionQueueJob) => void jobs.push(job)) };
  const now = () => deps.now!();
  return {
    ...kit,
    deps,
    jobs,
    now,
    async prospect(over: Partial<ProspectRow> & Record<string, unknown> = {}): Promise<ProspectRow> {
      const { id: _id, ...base } = sampleProspect();
      void _id;
      const username = (over.username as string | undefined) ?? `canal_${Math.random().toString(36).slice(2, 8)}`;
      const row = await kit.prisma.prospect.create({
        data: { ...base, username, channelUrl: `https://t.me/${username}`, title: username, ...over } as never,
      });
      return row as unknown as ProspectRow;
    },
    async offer(over: Record<string, unknown> = {}) {
      return kit.prisma.affiliateOffer.create({ data: { brand: "Winamax", vertical: "SPORTS", countries: ["FR", "BE"], dealTypes: { cpa: 100 }, isActive: true, ...over } as never }) as unknown as Promise<{ id: string }>;
    },
    async row(id: string): Promise<ProspectRow> {
      return (await kit.prisma.prospect.findUnique({ where: { id } })) as unknown as ProspectRow;
    },
    events(type?: string) {
      return kit.tables("prospectEvent").filter((e) => !type || e.type === type);
    },
  };
}

/** Fausse IA : réponses dans l'ordre (la dernière se répète), coût fixe. */
export function fakeLlm(texts: string[], costCents = 12) {
  const calls: Array<{ model: string; system: string; user: string }> = [];
  const llm: LlmProvider & { calls: typeof calls } = {
    calls,
    async complete(req) {
      calls.push({ model: req.model, system: req.system, user: req.user });
      return { text: texts[Math.min(calls.length - 1, texts.length - 1)] ?? "", costCents };
    },
  };
  return llm;
}
