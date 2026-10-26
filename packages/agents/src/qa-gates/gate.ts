/**
 * Phase 30, chantier B — point de passage commun des branchements du QA Global (« dernier verrou »).
 *
 * `qaGate(deps, req)` : accord du client pour ce contenu EXACT (après 3 refus) → passe ; sinon `requireApproval` du
 * moteur (approbation existante pour l'empreinte, ou vérification maintenant, 30 s au plus). Trois issues :
 * - `approved` : le contenu peut sortir ;
 * - `rejected` : bloqué, motifs et corrections pour l'équipe ; `needsHuman` après 3 refus du même contenu ;
 * - `unavailable` : délai dépassé ou erreur du modèle : RIEN ne sort, nouvel essai plus tard (jamais approuvé par défaut).
 * Le journal (`Event` `qa.gate.*`) ne contient jamais le contenu : type, identifiant, équipe, verdict, codes.
 *
 * Après 3 refus, `askQaDecision` pose UNE question au client (file des demandes : une à la fois) avec deux boutons :
 * « Publier quand même » (accord explicite, rangé pour cette empreinte seulement) ou « Non » (laisser tomber). La suite
 * dépend du type de contenu (`registerQaDecisionHandler`).
 */
import { agentEvent, readSetting, writeSetting } from "../admin/journal";
import { QA_DECISION_ACTION, qaDecisionKey } from "./registry";
import { pick } from "../boss/voice";
import { QA_DECISION_BUTTON_YES, QA_GATE_VARIANTS } from "../boss/qa-gate-texts";
import { contentHash, requireApproval } from "../qa/index";
import type { QaContent, QaContentType, QaContext, QaDeps, QaReason, QaResult } from "../qa/contract";
import type { AgentsDeps, TeamKey } from "../types";

export type QaGateRequest = {
  contentType: QaContentType;
  contentId: string;
  teamKey: string;
  content: QaContent;
  context?: QaContext;
  /** Canal concerné (journal). */
  channelId?: string | null;
};

export type QaGateOutcome =
  | { kind: "approved"; checkId: string | null; byClient: boolean; hash: string }
  | { kind: "rejected"; result: QaResult; needsHuman: boolean; hash: string }
  | { kind: "unavailable"; result: QaResult; hash: string };

/** Accord du client après 3 refus : rangé par (type, identifiant), valable pour les empreintes listées seulement. */
export const QA_OVERRIDE_PREFIX = "qa.override.";
export const qaOverrideKey = (contentType: QaContentType, contentId: string) => `${QA_OVERRIDE_PREFIX}${contentType}.${contentId}`;

type OverrideValue = { hashes: string[]; at: string; by: "client" | "client-edit"; userId?: string | null };

function overrideOf(v: unknown): OverrideValue | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const hashes = Array.isArray(o.hashes) ? o.hashes.filter((h): h is string => typeof h === "string") : [];
  return { hashes, at: typeof o.at === "string" ? o.at : "", by: o.by === "client-edit" ? "client-edit" : "client", userId: typeof o.userId === "string" ? o.userId : null };
}

/** Le client a-t-il donné son accord pour ce contenu exact ? */
export async function clientOverride(deps: Pick<AgentsDeps, "prisma">, contentType: QaContentType, contentId: string, hash: string): Promise<boolean> {
  const o = overrideOf(await readSetting(deps, qaOverrideKey(contentType, contentId)));
  return !!o && o.hashes.includes(hash);
}

/** Range l'accord du client (ou un texte écrit par le client lui-même, `client-edit`) pour cette empreinte. */
export async function recordClientOverride(
  deps: Pick<AgentsDeps, "prisma">,
  contentType: QaContentType,
  contentId: string,
  hash: string,
  by: OverrideValue["by"],
  at: Date,
  userId: string | null = null,
): Promise<void> {
  const key = qaOverrideKey(contentType, contentId);
  const prev = overrideOf(await readSetting(deps, key));
  const hashes = [...new Set([...(prev?.hashes ?? []), hash])].slice(-20);
  await writeSetting(deps, key, { hashes, at: at.toISOString(), by, userId });
}

/** Codes des motifs (jamais leur texte) pour le journal. */
export function reasonCodes(reasons: readonly QaReason[]): string[] {
  return [...new Set(reasons.map((r) => r.code))].slice(0, 8);
}

/** Motif court lisible par le client (premier motif critique, sinon le premier). */
export function shortMotif(result: Pick<QaResult, "reasons">, max = 160): string {
  const r = result.reasons.find((x) => x.severity === "critical") ?? result.reasons[0];
  const m = (r?.message ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/u, "");
  return m ? (m.length > max ? `${m.slice(0, max - 1)}…` : m) : "contenu jugé non conforme";
}

/** Motifs et corrections remis à l'équipe (texte simple, pour la rédaction suivante). */
export function correctionLines(result: Pick<QaResult, "reasons" | "corrections">): string[] {
  const out: string[] = [];
  for (const r of result.reasons) if (r.message) out.push(`contrôle qualité global : ${r.message}`.slice(0, 300));
  for (const c of result.corrections) {
    const s = [c.field ? `${c.field} :` : "", c.suggestion || (c.expected ? `attendu ${c.expected}` : "")].filter(Boolean).join(" ");
    if (s) out.push(`à corriger : ${s}`.slice(0, 300));
  }
  return out.slice(0, 8);
}

/**
 * Vérification au point de sortie. Ne lève jamais : une panne du moteur = `unavailable` (rien ne sort).
 */
export async function qaGate(deps: QaDeps, req: QaGateRequest): Promise<QaGateOutcome> {
  const hash = contentHash(req.content);
  const base = { contentType: req.contentType, contentId: req.contentId, teamKey: req.teamKey };
  if (await clientOverride(deps, req.contentType, req.contentId, hash).catch(() => false)) {
    await agentEvent(deps, "qa.gate.client_approved", base, { channelId: req.channelId ?? null });
    return { kind: "approved", checkId: null, byClient: true, hash };
  }
  let result: QaResult;
  try {
    result = await requireApproval(deps, { contentType: req.contentType, contentId: req.contentId, teamKey: req.teamKey, content: req.content, context: req.context });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, ...base }, "[qa] vérification impossible : rien ne sort");
    result = { checkId: "", verdict: "ERROR", reasons: [], corrections: [], durationMs: 0, attempt: 0, approved: false, needsHuman: false };
  }
  if (result.approved && result.verdict === "APPROVED") return { kind: "approved", checkId: result.checkId || null, byClient: false, hash };
  if (result.verdict === "REJECTED") {
    await agentEvent(
      deps,
      "qa.gate.rejected",
      { ...base, checkId: result.checkId, attempt: result.attempt, codes: reasonCodes(result.reasons), needsHuman: result.needsHuman },
      { channelId: req.channelId ?? null },
    );
    return { kind: "rejected", result, needsHuman: result.needsHuman, hash };
  }
  await agentEvent(deps, "qa.gate.blocked", { ...base, checkId: result.checkId || null, verdict: result.verdict }, { channelId: req.channelId ?? null });
  return { kind: "unavailable", result: { ...result, approved: false }, hash };
}

// ------------------------------------------------------------------------------------------------ décision du client

export { QA_DECISION_ACTION, qaDecisionKey, registerQaDecisionHandler, type QaDecisionHandler, type QaDecisionRef } from "./registry";

const TEAM_KEYS = new Set(["dating", "casino", "sports", "algo"]);

/**
 * Après 3 refus : une demande au client (2 boutons). `missionId` : la mission attend la réponse (reprise au choix).
 * Ne lève jamais.
 */
export async function askQaDecision(
  deps: AgentsDeps,
  input: { contentType: QaContentType; contentId: string; teamKey: string; hash: string; label: string; result: Pick<QaResult, "reasons">; missionId?: string | null; extra?: Record<string, unknown> },
): Promise<boolean> {
  try {
    const question = pick(QA_GATE_VARIANTS.decisionQuestion, "qa.decision")
      // Texte brut : la file des demandes l'échappe à l'envoi (`formatQuestion`).
      .replace("{label}", input.label)
      .replace("{motif}", shortMotif(input.result));
    const { askHuman } = await import("../human/requests");
    await askHuman(deps, {
      teamKey: TEAM_KEYS.has(input.teamKey) ? (input.teamKey as TeamKey) : null,
      kind: "CONFIRM",
      key: qaDecisionKey(input.contentType, input.contentId),
      question,
      missionId: input.missionId ?? null,
      onAnswer: {
        action: QA_DECISION_ACTION,
        buttonYes: QA_DECISION_BUTTON_YES,
        contentType: input.contentType,
        contentId: input.contentId,
        teamKey: input.teamKey,
        hash: input.hash,
        extra: input.extra ?? {},
        // Mission en attente : reprise par la file des demandes après la réponse (ou « plus tard ») ; « Non » l'annule
        // d'abord (une mission annulée ne reprend jamais).
      },
    });
    await agentEvent(deps, "qa.human.asked", { contentType: input.contentType, contentId: input.contentId, teamKey: input.teamKey, codes: reasonCodes(input.result.reasons) });
    return true;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, contentId: input.contentId }, "[qa] demande au client non posée");
    return false;
  }
}

