/**
 * Phase 30 — `pnpm qa:diag` : la clé IA de la plateforme (`Setting` `ai.config`, chiffrée) donne-t-elle accès à
 * `claude-fable-5-1` ? Un appel test réel (court), sa latence, une réponse JSON lisible, le réglage `qa.enabled`, la
 * dépense du mois face au plafond. Tableau en français ; `ok` = tout est prêt (code 0), sinon code 1.
 * L'appel test est compté dans la dépense du QA (`AgentUsage` équipe `qa`).
 */
import type { Db } from "@linkaffipro/db";
import { createQaClient } from "@linkaffipro/ai";
import { readAiApiKey } from "../providers/llm";
import { isQaModel } from "./codes";
import { QA_MODEL, type QaLlm } from "./contract";
import { parseQaOutput, qaMonthSpent, readQaSettings, recordQaUsage } from "./qa-global";
import { buildQaUserMessage, QA_SYSTEM_PROMPT } from "./qa-system-prompt";

export type QaDiagRow = { label: string; ok: boolean; detail: string };
export type QaDiagResult = { ok: boolean; rows: QaDiagRow[]; latencyMs: number | null };

export type QaDiagDeps = {
  prisma: Db | null;
  /** Client du QA (tests : faux) ; sinon `createQaClient` avec la clé lue. */
  makeClient?: (apiKey: string) => QaLlm;
  now?: () => Date;
  timeoutMs?: number;
};

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export async function runQaDiag(deps: QaDiagDeps): Promise<QaDiagResult> {
  const rows: QaDiagRow[] = [];
  let latencyMs: number | null = null;
  if (!deps.prisma) {
    rows.push({ label: "Base de données", ok: false, detail: "DATABASE_URL absente : lance la commande dans le conteneur (railway ssh --service web -- pnpm qa:diag)." });
    return { ok: false, rows, latencyMs };
  }
  const prisma = deps.prisma;
  const agentsDeps = { prisma, enqueue: { orchestrator: async () => undefined, step: async () => undefined }, ...(deps.now ? { now: deps.now } : {}) };

  let settings;
  try {
    settings = await readQaSettings(agentsDeps);
    rows.push({ label: "Base de données", ok: true, detail: "lue" });
  } catch (err) {
    rows.push({ label: "Base de données", ok: false, detail: `illisible : ${(err as Error).message.slice(0, 120)}` });
    return { ok: false, rows, latencyMs };
  }
  rows.push({ label: "Contrôle qualité activé (qa.enabled)", ok: settings.enabled, detail: settings.enabled ? "oui" : "non : toutes les sorties sont bloquées" });
  rows.push({ label: "Modèle du contrôle", ok: true, detail: `${QA_MODEL} (aucun repli)` });

  const key = await readAiApiKey(prisma).catch(() => null);
  rows.push({ label: "Clé Anthropic (Réglages → IA)", ok: Boolean(key), detail: key ? "présente et lisible" : "absente ou illisible (APP_ENCRYPTION_KEY ?)" });

  if (key) {
    const client = deps.makeClient ? deps.makeClient(key) : createQaClient({ apiKey: key });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? settings.timeoutMs);
    const t0 = Date.now();
    try {
      const res = await client.check({
        system: QA_SYSTEM_PROMPT,
        user: buildQaUserMessage({
          contentType: "POST",
          teamKey: "diag",
          content: { text: "Nouveau post ce soir à 20 h : les meilleurs moments de la semaine, en vidéo." },
          context: {},
          codeFindings: [],
        }),
        effort: "low",
        maxTokens: 2000,
        signal: ctrl.signal,
      });
      latencyMs = Date.now() - t0;
      await recordQaUsage(agentsDeps, res.costCents, 1);
      const sameModel = isQaModel(res.model);
      rows.push({ label: `Accès à ${QA_MODEL}`, ok: sameModel, detail: sameModel ? "oui" : `réponse d'un autre modèle (${res.model}) : refusée` });
      rows.push({ label: "Latence de l'appel test", ok: latencyMs <= settings.timeoutMs, detail: `${(latencyMs / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s (délai ${Math.round(settings.timeoutMs / 1000)} s)` });
      const parsed = res.stopReason === "refusal" ? null : parseQaOutput(res.text);
      rows.push({
        label: "Réponse JSON du contrôle",
        ok: parsed !== null,
        detail: parsed ? `lisible (verdict ${parsed.verdict === "APPROVED" ? "approuvé" : "refusé"})` : res.stopReason === "refusal" ? "bloquée par le modèle" : "illisible",
      });
      rows.push({ label: "Coût de l'appel test", ok: true, detail: eur(res.costCents) });
    } catch (err) {
      latencyMs = Date.now() - t0;
      rows.push({ label: `Accès à ${QA_MODEL}`, ok: false, detail: ctrl.signal.aborted ? "délai dépassé" : (err as Error).message.slice(0, 200) });
    } finally {
      clearTimeout(timer);
    }
  }

  const spent = await qaMonthSpent(agentsDeps).catch(() => 0);
  const cap = settings.monthlyBudgetCents;
  rows.push({ label: "Dépense du mois / plafond", ok: spent < cap, detail: `${eur(spent)} / ${eur(cap)}${spent >= cap ? " : plafond atteint, sorties bloquées" : ""}` });
  return { ok: rows.every((r) => r.ok), rows, latencyMs };
}

export function formatQaDiag(r: QaDiagResult): string {
  const width = Math.max(...r.rows.map((x) => x.label.length), 10);
  const lines = ["Contrôle qualité global (QA) — diagnostic", ""];
  for (const row of r.rows) lines.push(`${row.ok ? "OK  " : "NON "} ${row.label.padEnd(width)}  ${row.detail}`);
  lines.push("", r.ok ? "Tout est prêt." : "Au moins un point bloque : voir les lignes NON.");
  return lines.join("\n");
}
