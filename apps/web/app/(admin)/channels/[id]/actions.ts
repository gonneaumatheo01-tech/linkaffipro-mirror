"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SiteOpResult } from "@linkaffipro/agents";
import { requireUser } from "@/lib/session";
import { calendarReturnParams } from "@/lib/channels/return-to";
import { parseRequestFilter } from "@/lib/channels/requests";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import {
  channelBestHoursRecompute,
  channelExceptionDelete,
  channelExceptionMove,
  channelExceptionSave,
  channelExceptionToggle,
  channelExceptionsReorder,
  channelGateLinksCheck,
  channelRequestApprove,
  channelRequestDecline,
  channelRequestsApproveAll,
  channelRuleApplyPending,
  channelRuleSave,
} from "@/lib/site-ops/ops/lot-b/channel-rules";
import { channelRecheckRights } from "@/lib/site-ops/ops/lot-b/channel-settings";

/**
 * Fiche canal : règle par défaut, exceptions selon la provenance, liens des canaux à rejoindre, demandes, meilleurs
 * créneaux, droits des bots. La logique est dans les cœurs partagés avec Kevin
 * (`lib/site-ops/ops/lot-b/channel-rules.ts`, `channel-settings.ts`, phase 34) ; ici : formulaire, retour, rafraîchi.
 */

function back(channelId: string, tab: string, params: Record<string, string>): never {
  redirect(`/channels/${channelId}?${new URLSearchParams({ tab, ...params }).toString()}`);
}

/** `?ok=` (+ `?error=` quand un avertissement accompagne la réussite), ou `?error=`. */
function flash(r: SiteOpResult): Record<string, string> {
  if (!r.ok) return { error: r.error };
  const warning = r.data?.warning ? String(r.data.warning) : "";
  return { ok: r.message, ...(warning ? { error: warning } : {}) };
}

/** Champs communs de la règle par défaut et des exceptions (mêmes noms qu'avant la phase 11, plus `sendWelcome`). */
function ruleInput(formData: FormData) {
  return {
    channelId: formData.get("channelId"),
    mode: formData.get("mode"),
    delayPreset: formData.get("delayPreset") ?? "immediate",
    delayCustomSeconds: formData.get("delayCustomSeconds") || undefined,
    gateMode: formData.get("gateMode"),
    gateChannelIds: formData.getAll("gateChannelIds").map(String),
    reminderAfterMinutes: String(formData.get("reminderAfterMinutes") ?? ""),
    maxReminders: formData.get("maxReminders") ?? 2,
    expireAfterHours: formData.get("expireAfterHours") || undefined,
    expireAction: formData.get("expireAction") ?? "KEEP",
    sendAcceptedMessage: formData.get("sendAcceptedMessage") === "on",
    // Absent (ancien formulaire, autre écran) : le message d'accueil reste envoyé.
    sendWelcome: formData.get("sendWelcome") !== "off",
  };
}

/** Enregistre la règle par défaut du canal (créée si absente). */
export async function saveRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await channelRuleSave(ruleInput(formData), webActorOf(user));
  const channelId = String(formData.get("channelId") ?? "");
  if (r.ok) revalidatePath(`/channels/${channelId}`);
  back(channelId, "rules", flash(r));
}

/**
 * « Leur appliquer la nouvelle règle » (sous « Enregistrer la règle », règle par défaut ou exception, phase 14) :
 * recalcule les demandes en cours qui suivent encore l'ancienne version de la règle. Aucun message n'est envoyé.
 * Journal de l'équipe : `approval_rule.applied_to_pending` { ruleId, count, byStatus }.
 */
export async function applyRuleToPendingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = String(formData.get("channelId") ?? "");
  const ruleId = String(formData.get("ruleId") ?? "");
  if (!channelId) redirect("/channels");
  const r = await channelRuleApplyPending({ channelId, ruleId }, webActorOf(user));
  if (r.ok) revalidatePath(`/channels/${channelId}`);
  back(channelId, "rules", flash(r));
}

/**
 * « Vérifier les liens » (onglet « Qui peut entrer et quand ») : crée tout de suite les liens manquants des canaux à
 * rejoindre avec nos bots, puis revient sur l'onglet avec le résultat. Aucun message n'est envoyé aux membres.
 */
export async function checkGateLinksAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = z.string().min(1).parse(formData.get("channelId"));
  const r = await channelGateLinksCheck({ channelId }, webActorOf(user));
  revalidatePath(`/channels/${channelId}`);
  back(channelId, "rules", flash(r));
}

/** Retour d'une action d'exception appelée depuis l'écran (sans changer de page). */
export type ExceptionActionResult = { ok?: string; error?: string };

/** Retour de « Enregistrer l'exception » quand l'enregistrement est refusé (le volet reste ouvert). */
export type ExceptionFormResult = { error: string } | null;

function actionResult(r: SiteOpResult): ExceptionActionResult {
  return r.ok ? { ok: r.message } : { error: r.error };
}

/**
 * « Enregistrer l'exception » (volet d'une exception) : crée ou modifie une exception selon la provenance.
 * Refus : le message revient dans le volet. Succès : retour sur l'onglet avec la confirmation.
 */
export async function saveExceptionAction(
  _prev: ExceptionFormResult,
  formData: FormData,
): Promise<ExceptionFormResult> {
  const user = await requireUser();
  const r = await channelExceptionSave(
    {
      ...ruleInput(formData),
      ruleId: formData.get("ruleId") || undefined,
      provenance: String(formData.get("provenance") ?? ""),
    },
    webActorOf(user),
  );
  if (!r.ok) return { error: r.error };
  const channelId = String(r.data?.channelId ?? "");
  revalidatePath(`/channels/${channelId}`);
  back(channelId, "rules", flash(r));
}

/** Activer / désactiver une exception (interrupteur de sa ligne). Une exception désactivée ne s'applique plus. */
export async function toggleExceptionAction(formData: FormData): Promise<ExceptionActionResult> {
  const user = await requireUser();
  const r = await channelExceptionToggle(
    { channelId: formData.get("channelId"), ruleId: formData.get("ruleId"), active: formData.get("active") },
    webActorOf(user),
  );
  // Rafraîchi dès que l'interrupteur a changé (même si la vérification des liens qui suit a échoué).
  if (r.ok || r.code === "unavailable") revalidatePath(`/channels/${String(formData.get("channelId") ?? "")}`);
  return actionResult(r);
}

/**
 * Supprimer une exception (administrateurs seulement : un responsable peut la désactiver). Les demandes déjà
 * planifiées gardent leur date d'acceptation ; les prochaines suivent la règle par défaut (ou une autre exception).
 */
export async function deleteExceptionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = String(formData.get("channelId") ?? "");
  const ruleId = String(formData.get("ruleId") ?? "");
  if (!channelId) redirect("/channels");
  const r = await channelExceptionDelete({ channelId, ruleId }, webActorOf(user));
  if (r.ok) revalidatePath(`/channels/${channelId}`);
  back(channelId, "rules", flash(r));
}

/** « Monter » / « Descendre » une exception dans son groupe (accessible au clavier). */
export async function moveExceptionAction(formData: FormData): Promise<ExceptionActionResult> {
  const user = await requireUser();
  const r = await channelExceptionMove(
    {
      channelId: formData.get("channelId"),
      ruleId: formData.get("ruleId"),
      direction: formData.get("direction") === "down" ? "down" : "up",
    },
    webActorOf(user),
  );
  if (r.ok) revalidatePath(`/channels/${String(r.data?.channelId ?? "")}`);
  return actionResult(r);
}

/** Nouvel ordre d'un groupe après un glisser-déposer (la liste complète du groupe, dans l'ordre voulu). */
export async function reorderExceptionsAction(formData: FormData): Promise<ExceptionActionResult> {
  const user = await requireUser();
  const r = await channelExceptionsReorder(
    {
      channelId: String(formData.get("channelId") ?? ""),
      scope: String(formData.get("scope") ?? ""),
      ruleIds: formData.getAll("ruleIds").map(String),
    },
    webActorOf(user),
  );
  if (r.ok) revalidatePath(`/channels/${String(r.data?.channelId ?? "")}`);
  return actionResult(r);
}

export async function approveMembershipAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const membershipId = z.string().min(1).parse(formData.get("membershipId"));
  const channelId = z.string().min(1).parse(formData.get("channelId"));
  const r = await channelRequestApprove({ membershipId, channelId }, webActorOf(user));
  revalidatePath(`/channels/${channelId}`);
  back(channelId, "requests", flash(r));
}

/**
 * « Tout accepter » (onglet Demandes, liste filtrée, phase 14, décision E8) : voir `channelRequestsApproveAll`.
 * Journal de l'équipe : `membership.approve_all` { channelId, filter, count, byStatus, queued }.
 */
export async function approveAllRequestsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = String(formData.get("channelId") ?? "");
  if (!channelId) redirect("/channels");
  const filter = parseRequestFilter(formData.get("filter"));
  const keep: Record<string, string> = filter === "all" ? {} : { status: filter };
  const r = await channelRequestsApproveAll(
    {
      channelId,
      filter: formData.get("filter"),
      asOf: formData.get("asOf"),
      expected: formData.get("expected"),
    },
    webActorOf(user),
  );
  if (!r.ok && r.code === "not_found") redirect("/channels");
  if (r.ok) revalidatePath(`/channels/${channelId}`);
  back(channelId, "requests", { ...keep, ...flash(r) });
}

export async function declineMembershipAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const membershipId = z.string().min(1).parse(formData.get("membershipId"));
  const channelId = z.string().min(1).parse(formData.get("channelId"));
  const r = await channelRequestDecline({ membershipId, channelId }, webActorOf(user));
  revalidatePath(`/channels/${channelId}`);
  back(channelId, "requests", flash(r));
}

/**
 * Retour vers le calendrier des messages du canal, où sont montrés les meilleurs créneaux, avec la semaine et les
 * filtres que l'utilisateur regardait (champs cachés `week`, `day`, `vertical`, `campaignId`, `category`).
 */
function backToCalendar(channelId: string, formData: FormData, params: Record<string, string>): never {
  const keep = calendarReturnParams((name) => formData.get(name));
  redirect(`/messages?${new URLSearchParams({ channelId, ...keep, ...params }).toString()}`);
}

/**
 * Enfile un recalcul immédiat des meilleurs horaires (tous canaux ; tâche `stats` du worker). Le message de
 * confirmation revient sur `/messages?channelId=<id>`.
 */
export async function recomputeBestHoursAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = z.string().min(1).parse(formData.get("channelId"));
  const r = await channelBestHoursRecompute({ channelId }, webActorOf(user));
  if (!r.ok) backToCalendar(channelId, formData, { error: r.error });
  revalidatePath(`/channels/${channelId}`);
  revalidatePath("/messages");
  backToCalendar(channelId, formData, { ok: r.message });
}

/** Re-vérifie les droits de nos bots sur ce canal (bouton de la fiche). Audit `channel.rights_rechecked`. */
export async function recheckRightsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = String(formData.get("channelId") ?? "");
  const tab = String(formData.get("tab") ?? "rules");
  if (!channelId) redirect("/channels");
  const r = await channelRecheckRights({ channelId }, webActorOf(user));
  if (!r.ok) back(channelId, tab, { error: r.error });
  revalidatePath(`/channels/${channelId}`);
  revalidatePath("/channels");
  back(channelId, tab, { ok: r.message });
}
