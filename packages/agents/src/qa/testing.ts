/**
 * Phase 30 — fausse IA du QA (tests, aucun réseau) : réponses scriptées dans l'ordre (la dernière se répète), ou
 * fonction `respond`. Chaque réponse peut être un verdict (objet → JSON), un texte brut, une erreur à lever, ou un
 * réglage fin (`delayMs`, `model`, `stopReason`, `costCents`). Les demandes reçues sont gardées dans `calls`.
 */
import { QaModelUnavailableError } from "@linkaffipro/ai";
import { QA_MODEL, type QaCorrection, type QaLlm, type QaReason } from "./contract";

export type FakeQaVerdict = { verdict: "APPROVED" | "REJECTED"; reasons?: QaReason[]; corrections?: QaCorrection[] };
export type FakeQaStep =
  | FakeQaVerdict
  | string
  | Error
  | { raw?: string; verdict?: FakeQaVerdict; delayMs?: number; model?: string; stopReason?: string | null; costCents?: number; error?: Error };

export type FakeQaCall = Parameters<QaLlm["check"]>[0];

export type FakeQaLlm = QaLlm & { calls: FakeQaCall[]; fake: true };

const isVerdict = (s: unknown): s is FakeQaVerdict => !!s && typeof s === "object" && "verdict" in s && typeof (s as FakeQaVerdict).verdict === "string";

export function createFakeQaLlm(opts: { responses?: FakeQaStep[]; respond?: (req: FakeQaCall, index: number) => FakeQaStep; costCents?: number } = {}): FakeQaLlm {
  const calls: FakeQaCall[] = [];
  const list = opts.responses ?? [{ verdict: "APPROVED", reasons: [], corrections: [] }];
  return {
    fake: true,
    calls,
    async check(req) {
      const i = calls.length;
      calls.push(req);
      const step: FakeQaStep = opts.respond ? opts.respond(req, i) : (list[i] ?? list[list.length - 1]!);
      if (step instanceof Error) throw step;
      let raw: string;
      let delayMs = 0;
      let model: string = QA_MODEL;
      let stopReason: string | null = "end_turn";
      let costCents = opts.costCents ?? 1;
      if (typeof step === "string") raw = step;
      else if (isVerdict(step)) raw = JSON.stringify({ reasons: [], corrections: [], ...step });
      else {
        if (step.error) throw step.error;
        raw = step.raw ?? JSON.stringify({ reasons: [], corrections: [], ...(step.verdict ?? { verdict: "APPROVED" }) });
        delayMs = step.delayMs ?? 0;
        if (step.model) model = step.model;
        if (step.stopReason !== undefined) stopReason = step.stopReason;
        if (step.costCents !== undefined) costCents = step.costCents;
      }
      if (delayMs > 0)
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delayMs);
          req.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new QaModelUnavailableError("aborted", "Vérification interrompue (délai dépassé)."));
          });
        });
      return { text: raw, stopReason, model, costCents };
    },
  };
}

/** Erreur « modèle indisponible » prête à l'emploi (quota, 5xx…). */
export function qaUnavailable(kind: "network" | "quota" | "server" = "server"): QaModelUnavailableError {
  return new QaModelUnavailableError(kind, "Fable 5.1 indisponible (simulé).");
}
