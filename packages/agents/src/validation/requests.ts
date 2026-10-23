/**
 * Validations humaines (CONTRAT, propriétaire : chantier B « dialogue admin »). Signatures figées : le moteur
 * (chantier A) appelle `requestValidation`, le site (chantier C) `decideValidation`.
 */
import * as lifecycle from "../missions/lifecycle";
import { TEAM_LABELS, isTeamKey, type AdminButton, type AgentsDeps, type TeamKey } from "../types";
import { agentAudit, agentEvent, esc, nowOf } from "../admin/journal";

export type RequestValidationInput = {
  missionId: string;
  teamKey: TeamKey;
  previewText: string;
  mediaAssetId?: string | null;
  reason: string;
  /** Nom du canal réellement visé (affiché dans l'aperçu). */
  channelTitle?: string | null;
};

/** Au-delà, l'aperçu est raccourci (texte brut) pour tenir dans un message Telegram. */
const PREVIEW_MAX = 3000;

export function validationButtons(validationId: string): AdminButton[][] {
  return [
    [
      { text: "✅ Publier", callbackData: `agv:${validationId}:ok` },
      { text: "✏️ Corriger", callbackData: `agv:${validationId}:edit` },
      { text: "❌ Refuser", callbackData: `agv:${validationId}:no` },
    ],
  ];
}

/** Aperçu envoyé à l'admin (HTML Telegram) : équipe, canal, motif, texte du post, comment répondre. */
export function validationPreviewHtml(v: {
  number: number;
  teamKey: string;
  previewText: string;
  reason: string;
  channelTitle?: string | null;
}): string {
  const team = isTeamKey(v.teamKey) ? TEAM_LABELS[v.teamKey] : v.teamKey;
  // Texte du post déjà en HTML Telegram ; trop long, il est raccourci et échappé (jamais de balise coupée).
  const body =
    v.previewText.length > PREVIEW_MAX ? esc(`${v.previewText.slice(0, PREVIEW_MAX)}…`) : v.previewText || "<i>(sans texte)</i>";
  return [
    `🔎 <b>À valider n°${v.number}</b> · équipe ${esc(team)}`,
    v.channelTitle ? `Canal : ${esc(v.channelTitle)}` : null,
    `Motif : ${esc(v.reason)}`,
    "",
    body,
    "",
    `Appuie sur un bouton, ou réponds « ok ${v.number} » / « non ${v.number} ».`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** Crée l'`AgentValidation`, passe la mission en WAITING_VALIDATION et envoie l'aperçu (✅ / ✏️ / ❌) à l'admin. */
export async function requestValidation(
  deps: AgentsDeps,
  input: RequestValidationInput,
): Promise<{ validationId: string; number: number }> {
  // Étape rejouée : la validation en attente de la mission sert, rien n'est renvoyé.
  const existing = await deps.prisma.agentValidation.findFirst({
    where: { missionId: input.missionId, status: "PENDING" },
  });
  if (existing) return { validationId: existing.id, number: existing.number };

  const validation = await deps.prisma.agentValidation.create({
    data: {
      missionId: input.missionId,
      teamKey: input.teamKey,
      previewText: input.previewText,
      mediaAssetId: input.mediaAssetId ?? null,
      reason: input.reason,
      // Horloge injectée : les délais de 24 h / 72 h se comptent depuis ce moment.
      createdAt: nowOf(deps),
    },
  });
  await deps.prisma.agentMission.update({
    where: { id: input.missionId },
    data: { status: "WAITING_VALIDATION", validationId: validation.id, lastActivityAt: nowOf(deps) },
  });
  await agentEvent(deps, "agents.validation.requested", {
    validationId: validation.id,
    number: validation.number,
    missionId: input.missionId,
    teamKey: input.teamKey,
    reason: input.reason,
  });

  if (deps.admin) {
    try {
      const sent = await deps.admin.send(validationPreviewHtml({ ...input, number: validation.number }), {
        buttons: validationButtons(validation.id),
        mediaAssetId: input.mediaAssetId ?? null,
      });
      if (sent)
        await deps.prisma.agentValidation.update({
          where: { id: validation.id },
          data: { telegramMessageId: sent.messageId },
        });
    } catch (err) {
      // L'aperçu reste visible et décidable sur le site.
      deps.logger?.warn({ err: (err as Error).message, validationId: validation.id }, "[agents] aperçu non envoyé");
    }
  }
  return { validationId: validation.id, number: validation.number };
}

export type DecideValidationInput = {
  /** Identifiant ou numéro court. */
  validationId?: string;
  number?: number;
  decision: "approve" | "edit" | "reject";
  /** Texte corrigé (décision « edit » depuis le site, ou message suivant de l'admin sur Telegram). */
  editedText?: string;
  rejectReason?: string | null;
  via: "SITE" | "TELEGRAM";
  byUserId?: string | null;
};

export type DecideValidationResult = { ok: true; message: string } | { ok: false; message: string };

const STATUS_DONE_LABEL: Record<string, string> = {
  APPROVED: "déjà validé",
  REJECTED: "déjà refusé",
  EDITED: "déjà corrigé",
  EXPIRED: "expiré",
};

/** Décision (Publier / Corriger / Refuser) : met à jour la validation, l'`AuditLog`, puis reprend ou annule la mission. */
export async function decideValidation(
  deps: AgentsDeps,
  input: DecideValidationInput,
): Promise<DecideValidationResult> {
  const where = input.validationId ? { id: input.validationId } : input.number !== undefined ? { number: input.number } : null;
  if (!where) return { ok: false, message: "Validation introuvable." };
  const v = await deps.prisma.agentValidation.findUnique({ where });
  if (!v) return { ok: false, message: input.number !== undefined ? `Aucune validation n°${input.number}.` : "Validation introuvable." };
  const now = nowOf(deps);
  const label = `n°${v.number}`;
  const auditBase = { userId: input.byUserId ?? null, entityType: "AgentValidation", entityId: v.id };

  if (v.status !== "PENDING") {
    // « non 12 <motif> » juste après ❌ : le motif est ajouté, sans autre effet.
    if (input.decision === "reject" && v.status === "REJECTED" && input.rejectReason && !v.rejectReason) {
      await deps.prisma.agentValidation.update({ where: { id: v.id }, data: { rejectReason: input.rejectReason } });
      await agentAudit(deps, { ...auditBase, action: "agents.validation.reject_reason", metadata: { number: v.number, reason: input.rejectReason, via: input.via } });
      return { ok: true, message: `Motif noté pour ${label} 👍` };
    }
    return { ok: false, message: `Post ${label} ${STATUS_DONE_LABEL[v.status] ?? "déjà traité"} : rien de plus à faire.` };
  }

  if (input.decision === "edit" && !input.editedText?.trim()) {
    if (input.via === "SITE") return { ok: false, message: "Le texte corrigé est vide." };
    // Une seule correction attendue à la fois : le prochain message texte de l'admin sera le nouveau texte.
    await deps.prisma.agentValidation.updateMany({
      where: { status: "PENDING", awaitingEditAt: { not: null } },
      data: { awaitingEditAt: null },
    });
    await deps.prisma.agentValidation.update({ where: { id: v.id }, data: { awaitingEditAt: now } });
    await agentEvent(deps, "agents.validation.edit_requested", { validationId: v.id, number: v.number });
    return { ok: true, message: `✏️ Envoie-moi le nouveau texte du post ${label} en un seul message (ou « annule »).` };
  }

  const decided = {
    decidedById: input.byUserId ?? null,
    decidedVia: input.via,
    decidedAt: now,
    awaitingEditAt: null,
  };
  const status = input.decision === "approve" ? "APPROVED" : input.decision === "edit" ? "EDITED" : "REJECTED";
  const extra =
    input.decision === "edit"
      ? { editedText: input.editedText!.trim() }
      : input.decision === "reject"
        ? { rejectReason: input.rejectReason?.trim() || null }
        : {};
  // Garde contre le double clic : seule la première décision passe.
  const claimed = await deps.prisma.agentValidation.updateMany({
    where: { id: v.id, status: "PENDING" },
    data: { status, ...decided, ...extra },
  });
  if (claimed.count === 0) return { ok: false, message: `Post ${label} déjà traité : rien de plus à faire.` };

  const action = `agents.validation.${status.toLowerCase()}`;
  await agentAudit(deps, {
    ...auditBase,
    action,
    metadata: {
      number: v.number,
      missionId: v.missionId,
      teamKey: v.teamKey,
      via: input.via,
      ...(input.decision === "reject" ? { reason: input.rejectReason?.trim() || null } : {}),
    },
  });
  await agentEvent(deps, action, {
    validationId: v.id,
    number: v.number,
    missionId: v.missionId,
    via: input.via,
    ...(input.decision === "reject" ? { reason: input.rejectReason?.trim() || null } : {}),
  });

  try {
    if (input.decision === "reject") {
      await lifecycle.cancelMission(deps, v.missionId, {
        reason: `refusé par l'admin${input.rejectReason?.trim() ? ` : ${input.rejectReason.trim()}` : ""}`,
      });
      return { ok: true, message: `Post ${label} refusé ❌ : mission annulée. Motif possible : « non ${v.number} <motif> ».` };
    }
    const mission = await deps.prisma.agentMission.findUnique({ where: { id: v.missionId } });
    const payload = (mission?.payload && typeof mission.payload === "object" ? mission.payload : {}) as Record<string, unknown>;
    if (input.decision === "edit") {
      // Texte de l'admin : il repasse au Contrôle qualité (règles du code), la validation humaine est acquise.
      await deps.prisma.agentMission.update({
        where: { id: v.missionId },
        data: { payload: { ...payload, text: input.editedText!.trim(), approved: true, humanEdited: true } },
      });
      await lifecycle.continueMission(deps, v.missionId, { fromAgent: "controle", reason: "texte corrigé par l'admin" });
      return { ok: true, message: `Texte du post ${label} remplacé ✏️ : il repasse au contrôle qualité.` };
    }
    await deps.prisma.agentMission.update({
      where: { id: v.missionId },
      data: { payload: { ...payload, approved: true } },
    });
    await lifecycle.continueMission(deps, v.missionId, { reason: "validation accordée" });
    return { ok: true, message: `Post ${label} validé ✅ : il part à son heure.` };
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message, missionId: v.missionId }, "[agents] suite de la validation impossible");
    return { ok: true, message: `Décision notée pour ${label} ; la mission reprendra au prochain passage du Grand Chef.` };
  }
}
