"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { ACTIVE_CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { enqueue } from "@linkaffipro/queue";
import { requireUser } from "@/lib/session";
import { recheckChannelRights } from "@linkaffipro/telegram";
import { approveNow, declineNow } from "@/lib/approval/telegram";
import {
  conditionText,
  duplicateMessage,
  exceptionGateChannelIds,
  exceptionRuleLabel,
  findDuplicate,
  isValidLevelOrder,
  moveWithinLevel,
  placementOrder,
  sameTarget,
  sortOrderUpdates,
  targetOfKey,
  type ExceptionScope,
  type ExceptionTarget,
} from "@/lib/channels/exceptions";
import { affiliateLabel, campaignLabel } from "@/lib/affiliates/scope";
import { gateCheckFlash, alignGate } from "@/lib/channels/gate-links";
import { verifyChannelGateLinks } from "@/lib/channels/rule-gate-links";
import { calendarReturnParams } from "@/lib/channels/return-to";
import { rightsMessage } from "@/lib/channels/rights-message";
import {
  appliedMessage,
  applyRuleToPending,
  pendingFlash,
  pendingSummaryForRule,
} from "@/lib/channels/pending-rule";
import {
  APPROVE_ALL_LIST_CHANGED,
  approveAllDone,
  approveAllListGrew,
  approveAllMark,
  approveJobId,
  parseApproveAllForm,
  requestFilterStatuses,
} from "@/lib/channels/requests";

function back(channelId: string, tab: string, params: Record<string, string>): never {
  redirect(`/channels/${channelId}?${new URLSearchParams({ tab, ...params }).toString()}`);
}

/** Délais proposés par l'écran (clé → secondes) ; « custom » : `delayCustomSeconds`. */
const DELAY_PRESETS: Record<string, number> = {
  immediate: 0,
  "1m": 60,
  "5m": 300,
  "10m": 600,
  "1h": 3600,
  "1d": 86400,
  "2d": 172800,
};

/** Libellés français des champs de la règle (messages d'erreur lisibles). */
const RULE_FIELD_LABELS: Record<string, string> = {
  mode: "Mode",
  delayCustomSeconds: "Délai personnalisé",
  gateMode: "Exigence",
  reminderAfterMinutes: "Rappels",
  maxReminders: "Nombre maximal de rappels",
  expireAfterHours: "Expiration",
  expireAction: "À l'expiration",
  provenance: "Si la personne vient",
};
const RULE_FIELD_HINTS: Record<string, string> = {
  delayCustomSeconds: "un nombre de secondes entre 0 et 2 592 000 (30 jours)",
  maxReminders: "un nombre entre 0 et 10",
  expireAfterHours: "un nombre d'heures entre 0 et 1 440 (60 jours)",
  reminderAfterMinutes: "des minutes séparées par des virgules (ex. 60, 1440)",
  provenance: "choisissez d'où vient la personne",
};

const ruleSchema = z.object({
  channelId: z.string().min(1),
  mode: z.enum(["IMMEDIATE", "DELAY", "MANUAL"]),
  delayPreset: z.string(),
  delayCustomSeconds: z.coerce
    .number()
    .int()
    .min(0)
    .max(30 * 86400)
    .optional(),
  gateMode: z.enum(["NONE", "REQUIRED", "SOFT"]),
  gateChannelIds: z.array(z.string()),
  reminderAfterMinutes: z.string(),
  maxReminders: z.coerce.number().int().min(0).max(10),
  expireAfterHours: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .optional(),
  expireAction: z.enum(["DECLINE", "APPROVE", "KEEP"]),
  sendAcceptedMessage: z.boolean(),
  sendWelcome: z.boolean(),
});

const exceptionSchema = ruleSchema.extend({
  ruleId: z.string().min(1).optional(),
  provenance: z.string().min(1),
});

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

/** Message d'erreur lisible pour le premier champ refusé. */
function fieldError(error: z.ZodError): string {
  const field = String(error.issues[0]?.path[0] ?? "");
  return RULE_FIELD_LABELS[field]
    ? `Vérifiez le champ « ${RULE_FIELD_LABELS[field]} » : ${RULE_FIELD_HINTS[field] ?? "valeur invalide"}.`
    : "Vérifiez les champs de la règle : une valeur est invalide.";
}

type RuleFields = z.infer<typeof ruleSchema>;

/**
 * Réglages enregistrés d'une règle (par défaut ou exception) : le délai choisi est TOUJOURS enregistré, y compris
 * « puis accepter » après les canaux à rejoindre (le délai part du moment où tous sont rejoints : vu par le bot, ou
 * au clic sur « ✅ J'ai rejoint ») ; l'exigence suit
 * les canaux choisis (aucun canal → aucune ; des canaux sans exigence → obligatoires).
 */
function ruleData(d: RuleFields, gateIds: readonly string[]) {
  const delaySeconds =
    d.delayPreset === "custom" ? (d.delayCustomSeconds ?? 0) : (DELAY_PRESETS[d.delayPreset] ?? 0);
  const reminders = d.reminderAfterMinutes
    .split(/[,\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const { gateMode, gateChannelIds } = alignGate(d.gateMode, gateIds, d.channelId);
  return {
    mode: d.mode,
    delaySeconds,
    gateMode,
    gateChannelIds,
    reminderAfterMinutes: reminders,
    maxReminders: d.maxReminders,
    expireAfterHours: d.expireAfterHours && d.expireAfterHours > 0 ? d.expireAfterHours : null,
    expireAction: d.expireAction,
    sendAcceptedMessage: d.sendAcceptedMessage,
    sendWelcome: d.sendWelcome,
  };
}

/** Enregistre la règle par défaut du canal (créée si absente). */
export async function saveRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ruleSchema.safeParse(ruleInput(formData));
  if (!parsed.success)
    back(String(formData.get("channelId") ?? ""), "rules", { error: fieldError(parsed.error) });
  const d = parsed.data;
  const rule0 = ruleData(d, d.gateChannelIds);
  const { delaySeconds, gateChannelIds } = rule0;
  const data = {
    ...rule0,
    name: "Règle par défaut",
    isDefault: true,
    scope: "DEFAULT" as const,
    isActive: true,
  };
  const existing = await prisma.approvalRule.findFirst({
    where: { channelId: d.channelId, isDefault: true },
  });
  const rule = existing
    ? await prisma.approvalRule.update({ where: { id: existing.id }, data })
    : await prisma.approvalRule.create({ data: { ...data, channelId: d.channelId } });
  await audit({
    userId: user.id,
    action: existing ? "approval_rule.updated" : "approval_rule.created",
    entityType: "ApprovalRule",
    entityId: rule.id,
    metadata: {
      channelId: d.channelId,
      mode: d.mode,
      delaySeconds,
      gateMode: data.gateMode,
      gateChannelIds,
      sendWelcome: d.sendWelcome,
    },
  });
  // Liens des canaux à rejoindre créés et vérifiés tout de suite : le canal en cause et la solution sont affichés.
  const saved = "Règle d'adhésion enregistrée : elle s'applique aux prochaines demandes.";
  const flash = gateChannelIds.length > 0 ? await checkGateLinks(d.channelId, user.id) : {};
  const pending = await pendingNote(d.channelId, rule.id, "default");
  revalidatePath(`/channels/${d.channelId}`);
  back(d.channelId, "rules", {
    ok: [saved, pending, flash.ok].filter(Boolean).join(" "),
    ...(flash.error ? { error: flash.error } : {}),
  });
}

/**
 * Demandes en cours qui suivent encore l'ancienne version de la règle (phrase ajoutée à la confirmation, vide sinon).
 * Une panne de lecture ne bloque jamais l'enregistrement de la règle.
 */
async function pendingNote(
  channelId: string,
  ruleId: string,
  where: "default" | "exception",
): Promise<string> {
  try {
    const s = await pendingSummaryForRule(channelId, ruleId);
    return pendingFlash(s?.count ?? 0, where);
  } catch (err) {
    console.warn("[canaux] demandes en attente de l'ancienne règle illisibles", {
      channelId,
      ruleId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}

/**
 * « Leur appliquer la nouvelle règle » (sous « Enregistrer la règle », règle par défaut ou exception, phase 14) :
 * recalcule les demandes en cours qui suivent encore l'ancienne version de la règle, comme si elles arrivaient
 * maintenant, avec leur date d'origine pour le délai (`applyRuleToPending`). Aucun message n'est envoyé. Journal de
 * l'équipe : `approval_rule.applied_to_pending` { ruleId, count, byStatus }.
 */
export async function applyRuleToPendingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = String(formData.get("channelId") ?? "");
  const ruleId = String(formData.get("ruleId") ?? "");
  if (!channelId) redirect("/channels");
  if (!ruleId) back(channelId, "rules", { error: "Règle introuvable : rechargez la page." });
  const r = await applyRuleToPending({ channelId, ruleId, userId: user.id });
  if (r.status === "not_found")
    back(channelId, "rules", { error: "Cette règle n'existe plus : rechargez la page." });
  if (r.status === "inactive")
    back(channelId, "rules", {
      error:
        "Cette exception est désactivée : activez-la d'abord, ou laissez ces demandes suivre leur règle actuelle.",
    });
  await audit({
    userId: user.id,
    action: "approval_rule.applied_to_pending",
    entityType: "ApprovalRule",
    entityId: ruleId,
    metadata: {
      channelId,
      ruleId,
      count: r.count,
      byStatus: r.byStatus,
      acceptNow: r.acceptNow,
      gateSatisfied: r.gateSatisfied,
      skipped: r.skipped,
      kept: r.kept ?? 0,
    },
  });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, "rules", { ok: appliedMessage(r) });
}

/**
 * Crée et vérifie les liens des canaux à rejoindre de toutes les règles actives du canal (règle par défaut et
 * exceptions) ; une panne (réseau, Telegram) devient un message, jamais une erreur.
 */
async function checkGateLinks(
  channelId: string,
  userId: string,
): Promise<{ ok?: string; error?: string }> {
  try {
    const { results, solutionBot } = await verifyChannelGateLinks(channelId, { userId });
    return gateCheckFlash(results, solutionBot);
  } catch (err) {
    console.warn("[canaux] vérification des liens impossible", {
      channelId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      error:
        "Vérification des liens impossible pour le moment : réessayez « Vérifier les liens » dans une minute.",
    };
  }
}

/**
 * « Vérifier les liens » (onglet « Qui peut entrer et quand », règle par défaut ou exception) : crée tout de suite les
 * liens manquants des canaux à rejoindre avec nos bots, puis revient sur l'onglet avec le résultat. Aucun message
 * n'est envoyé aux membres.
 */
export async function checkGateLinksAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = z.string().min(1).parse(formData.get("channelId"));
  const flash = await checkGateLinks(channelId, user.id);
  await audit({
    userId: user.id,
    action: "channel.gate_links_checked",
    entityType: "Channel",
    entityId: channelId,
    metadata: { ok: !flash.error },
  });
  revalidatePath(`/channels/${channelId}`);
  const params: Record<string, string> = {};
  if (flash.ok) params.ok = flash.ok;
  if (flash.error) params.error = flash.error;
  if (!flash.ok && !flash.error) params.ok = "Aucun canal à rejoindre dans les règles de ce canal.";
  back(channelId, "rules", params);
}

/** Exceptions selon la provenance d'un canal : règles qui ne sont pas la règle par défaut. */
const EXCEPTION_WHERE = {
  isDefault: false,
  scope: { not: "DEFAULT" },
} satisfies Prisma.ApprovalRuleWhereInput;

/** Retour d'une action d'exception appelée depuis l'écran (sans changer de page). */
export type ExceptionActionResult = { ok?: string; error?: string };

/** Retour de « Enregistrer l'exception » quand l'enregistrement est refusé (le volet reste ouvert). */
export type ExceptionFormResult = { error: string } | null;

/** Instantané d'une exception pour le journal de l'équipe. */
function exceptionMetadata(
  r: {
    channelId: string;
    scope: string;
    sourceChannelId: string | null;
    sourceKind: string | null;
    inviteLinkId: string | null;
    linkaffiAffiliateId?: string | null;
    landingPageId?: string | null;
    label: string | null;
    isActive: boolean;
  },
  extra: Record<string, unknown> = {},
): Prisma.InputJsonObject {
  return {
    channelId: r.channelId,
    scope: r.scope,
    sourceChannelId: r.sourceChannelId,
    sourceKind: r.sourceKind,
    inviteLinkId: r.inviteLinkId,
    ...(r.linkaffiAffiliateId ? { linkaffiAffiliateId: r.linkaffiAffiliateId } : {}),
    ...(r.landingPageId ? { landingPageId: r.landingPageId } : {}),
    label: r.label,
    isActive: r.isActive,
    ...extra,
  } as Prisma.InputJsonObject;
}

/** Numérote 10, 20, 30… les exceptions d'un groupe dans l'ordre donné (seulement celles qui changent). */
async function renumber(
  tx: Prisma.TransactionClient,
  orderedIds: readonly string[],
  current: Readonly<Record<string, number>>,
): Promise<void> {
  for (const u of sortOrderUpdates(orderedIds, current))
    await tx.approvalRule.update({ where: { id: u.id }, data: { sortOrder: u.sortOrder } });
}

/** Erreur de contrainte d'unicité Prisma (un lien précis n'a qu'une règle). */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

/**
 * « Enregistrer l'exception » (volet d'une exception) : crée ou modifie une exception selon la provenance. Validation
 * de tous les champs, une seule exception par provenance, libellé « Venu … » recalculé, place dans son groupe
 * (`placeNewRule`, numéros 10, 20, 30…), journal de l'équipe, liens des canaux à rejoindre vérifiés tout de suite.
 * Refus : le message revient dans le volet. Succès : retour sur l'onglet avec la confirmation.
 */
export async function saveExceptionAction(
  _prev: ExceptionFormResult,
  formData: FormData,
): Promise<ExceptionFormResult> {
  const user = await requireUser();
  const parsed = exceptionSchema.safeParse({
    ...ruleInput(formData),
    ruleId: formData.get("ruleId") || undefined,
    provenance: String(formData.get("provenance") ?? ""),
  });
  if (!parsed.success) return { error: fieldError(parsed.error) };
  const d = parsed.data;
  const target = targetOfKey(d.provenance);
  if (!target) return { error: "Choisissez d'où vient la personne." };
  const channel = await prisma.channel.findUnique({
    where: { id: d.channelId },
    select: { id: true },
  });
  if (!channel) return { error: "Ce canal n'existe plus : revenez à la liste des canaux." };
  const siblings = await prisma.approvalRule.findMany({
    where: { channelId: d.channelId, ...EXCEPTION_WHERE },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const existing = d.ruleId ? siblings.find((r) => r.id === d.ruleId) : undefined;
  if (d.ruleId && !existing) return { error: "Cette exception n'existe plus : rechargez la page." };

  const names: TargetNames = {
    titles: {},
    linkNames: {},
    affiliateNames: {},
    affiliateLinks: {},
    landingPageNames: {},
  };
  const problem = await checkTarget(target, d.channelId, existing?.inviteLinkId ?? null, names);
  if (problem) return { error: problem };
  if (findDuplicate(siblings, target, existing?.id))
    return { error: duplicateMessage(target, names) };
  if (target.inviteLinkId) {
    const other = await prisma.approvalRule.findFirst({
      where: {
        inviteLinkId: target.inviteLinkId,
        ...(existing ? { NOT: { id: existing.id } } : {}),
      },
      select: { id: true },
    });
    if (other) return { error: duplicateMessage(target, names) };
  }

  const fields = ruleData(d, exceptionGateChannelIds(target, d.gateChannelIds, d.channelId));
  const label = exceptionRuleLabel(target, names);
  const data = {
    ...fields,
    name: label,
    label,
    isDefault: false,
    scope: target.scope,
    inviteLinkId: target.inviteLinkId,
    sourceChannelId: target.sourceChannelId,
    sourceKind: target.sourceKind,
    // Affilié Link Affi précis (phase 13) ; vidé pour toute autre provenance.
    linkaffiAffiliateId: target.linkaffiAffiliateId,
    // Page d'atterrissage précise (phase 15) ; vidée pour toute autre provenance.
    landingPageId: target.landingPageId,
  };
  let saved;
  try {
    saved = await prisma.$transaction(async (tx) => {
      const rule = existing
        ? await tx.approvalRule.update({ where: { id: existing.id }, data })
        : await tx.approvalRule.create({
            data: { ...data, channelId: d.channelId, isActive: true, sortOrder: 0 },
          });
      // Nouvelle exception, ou provenance changée : placée juste avant celle qui la masquerait, sinon à la fin.
      if (!existing || !sameTarget(existing, target)) {
        const level = siblings.filter((r) => r.scope === target.scope && r.id !== rule.id);
        const current = Object.fromEntries([...level, rule].map((r) => [r.id, r.sortOrder]));
        await renumber(tx, placementOrder(level, rule), current);
      }
      return rule;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: duplicateMessage(target, names) };
    throw err;
  }
  await audit({
    userId: user.id,
    action: existing ? "approval_rule.exception_updated" : "approval_rule.exception_created",
    entityType: "ApprovalRule",
    entityId: saved.id,
    metadata: exceptionMetadata(saved, {
      mode: fields.mode,
      delaySeconds: fields.delaySeconds,
      gateMode: fields.gateMode,
      gateChannelIds: fields.gateChannelIds,
      sendWelcome: fields.sendWelcome,
    }),
  });
  const ok = `Exception enregistrée pour les personnes venues ${conditionText(target, names)} : elle s'applique aux prochaines demandes.`;
  const flash =
    saved.isActive && fields.gateChannelIds.length > 0
      ? await checkGateLinks(d.channelId, user.id)
      : {};
  const pending =
    existing && saved.isActive ? await pendingNote(d.channelId, saved.id, "exception") : "";
  revalidatePath(`/channels/${d.channelId}`);
  back(d.channelId, "rules", {
    ok: [ok, pending, flash.ok].filter(Boolean).join(" "),
    ...(flash.error ? { error: flash.error } : {}),
  });
}

/** Noms remplis par `checkTarget` pour le libellé et les messages de l'exception. */
type TargetNames = {
  titles: Record<string, string>;
  linkNames: Record<string, string>;
  affiliateNames: Record<string, string>;
  affiliateLinks: Record<string, { campaignName: string; affiliateName: string }>;
  landingPageNames: Record<string, string>;
};

/** La cible existe-t-elle et appartient-elle bien à ce canal ? Remplit les noms utiles au libellé ; message sinon. */
async function checkTarget(
  target: ExceptionTarget,
  channelId: string,
  currentLinkId: string | null,
  names: TargetNames,
): Promise<string | null> {
  if (target.scope === "SOURCE_KIND" && target.sourceKind === "LINKAFFI_AFFILIATE") {
    // Un affilié précis : connu par au moins une campagne Telegram d'affilié (lien LINKAFFI), la plus récente nomme.
    const link = await prisma.inviteLink.findFirst({
      where: { kind: "LINKAFFI", linkaffiAffiliateId: target.linkaffiAffiliateId },
      orderBy: { createdAt: "desc" },
      select: { linkaffiAffiliateId: true, linkaffiAffiliateName: true },
    });
    if (!link) return "Cet affilié n'est plus connu : choisissez une autre provenance.";
    names.affiliateNames[target.linkaffiAffiliateId!] = affiliateLabel(
      link.linkaffiAffiliateId,
      link.linkaffiAffiliateName,
    );
  }
  if (target.scope === "SOURCE_KIND" && target.sourceKind === "LANDING_PAGE") {
    // Une page d'atterrissage précise (phase 15) : une page de ce canal.
    const page = await prisma.landingPage.findFirst({
      where: { id: target.landingPageId!, channelId },
      select: { id: true, name: true },
    });
    if (!page) return "Cette page d'atterrissage n'existe plus : choisissez une autre provenance.";
    names.landingPageNames[page.id] = page.name;
  }
  if (target.scope === "SOURCE_CHANNEL") {
    if (target.sourceChannelId === channelId)
      return "Choisissez un autre canal que celui-ci : la personne vient d'ailleurs.";
    const ch = await prisma.channel.findUnique({
      where: { id: target.sourceChannelId! },
      select: { id: true, title: true },
    });
    if (!ch) return "Ce canal n'existe plus : choisissez une autre provenance.";
    names.titles[ch.id] = ch.title;
  }
  if (target.scope === "INVITE_LINK") {
    const link = await prisma.inviteLink.findFirst({
      where: { id: target.inviteLinkId!, channelId },
      select: {
        id: true,
        name: true,
        kind: true,
        linkaffiCampaignKey: true,
        linkaffiCampaignName: true,
        linkaffiAffiliateId: true,
        linkaffiAffiliateName: true,
      },
    });
    if (!link) return "Ce lien n'existe plus : choisissez une autre provenance.";
    // Lien de partage, ou campagne Telegram d'affilié Link Affi de ce canal (phase 13).
    if (link.kind !== "SHARE" && link.kind !== "LINKAFFI" && link.id !== currentLinkId)
      return "Choisissez un lien de partage ou une campagne d'affilié de ce canal.";
    names.linkNames[link.id] = link.name;
    if (link.kind === "LINKAFFI" && link.linkaffiCampaignKey)
      names.affiliateLinks[link.id] = {
        campaignName: campaignLabel({
          campaignName: link.linkaffiCampaignName,
          campaignKey: link.linkaffiCampaignKey,
        }),
        affiliateName: affiliateLabel(link.linkaffiAffiliateId, link.linkaffiAffiliateName),
      };
  }
  return null;
}

/** Une exception du canal (règle qui n'est pas la règle par défaut), ou null. */
async function findException(channelId: string, ruleId: string) {
  return prisma.approvalRule.findFirst({ where: { id: ruleId, channelId, ...EXCEPTION_WHERE } });
}

const idsSchema = z.object({ channelId: z.string().min(1), ruleId: z.string().min(1) });

/** Activer / désactiver une exception (interrupteur de sa ligne). Une exception désactivée ne s'applique plus. */
export async function toggleExceptionAction(formData: FormData): Promise<ExceptionActionResult> {
  const user = await requireUser();
  const parsed = idsSchema.safeParse({
    channelId: formData.get("channelId"),
    ruleId: formData.get("ruleId"),
  });
  if (!parsed.success) return { error: "Exception introuvable : rechargez la page." };
  const { channelId, ruleId } = parsed.data;
  const active = formData.get("active") === "1";
  const rule = await findException(channelId, ruleId);
  if (!rule) return { error: "Cette exception n'existe plus : rechargez la page." };
  const saved = await prisma.approvalRule.update({
    where: { id: rule.id },
    data: { isActive: active },
  });
  await audit({
    userId: user.id,
    action: "approval_rule.exception_updated",
    entityType: "ApprovalRule",
    entityId: rule.id,
    metadata: exceptionMetadata(saved, { change: active ? "activated" : "deactivated" }),
  });
  const gates = Array.isArray(saved.gateChannelIds) && saved.gateChannelIds.length > 0;
  const flash = active && gates ? await checkGateLinks(channelId, user.id) : {};
  revalidatePath(`/channels/${channelId}`);
  if (flash.error) return { error: flash.error };
  return {
    ok: active
      ? "Exception activée : elle s'applique aux prochaines demandes."
      : "Exception désactivée : ces personnes suivent la règle par défaut (ou une autre exception).",
  };
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
  if (user.role !== "ADMIN")
    back(channelId, "rules", {
      error:
        "Seul un administrateur peut supprimer une exception. Vous pouvez la désactiver avec son interrupteur.",
    });
  const rule = ruleId ? await findException(channelId, ruleId) : null;
  if (!rule) back(channelId, "rules", { error: "Cette exception n'existe plus." });
  await prisma.$transaction(async (tx) => {
    await tx.approvalRule.delete({ where: { id: rule.id } });
    const level = await tx.approvalRule.findMany({
      where: { channelId, ...EXCEPTION_WHERE, scope: rule.scope },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, sortOrder: true },
    });
    await renumber(
      tx,
      level.map((r) => r.id),
      Object.fromEntries(level.map((r) => [r.id, r.sortOrder])),
    );
  });
  await audit({
    userId: user.id,
    action: "approval_rule.exception_deleted",
    entityType: "ApprovalRule",
    entityId: rule.id,
    metadata: exceptionMetadata(rule, {
      mode: rule.mode,
      delaySeconds: rule.delaySeconds,
      gateMode: rule.gateMode,
      gateChannelIds: rule.gateChannelIds,
      sendWelcome: rule.sendWelcome,
    }),
  });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, "rules", {
    ok: "Exception supprimée : les prochaines demandes suivent la règle par défaut (ou une autre exception).",
  });
}

/** Enregistre le nouvel ordre d'un groupe d'exceptions et le note au journal de l'équipe. */
async function saveLevelOrder(
  userId: string,
  channelId: string,
  scope: ExceptionScope,
  orderedIds: readonly string[],
  current: Readonly<Record<string, number>>,
  extra: Record<string, unknown>,
): Promise<void> {
  await prisma.$transaction(async (tx) => renumber(tx, orderedIds, current));
  await audit({
    userId,
    action: "approval_rule.exceptions_reordered",
    entityType: "Channel",
    entityId: channelId,
    metadata: { channelId, scope, order: [...orderedIds], ...extra } as Prisma.InputJsonObject,
  });
  revalidatePath(`/channels/${channelId}`);
}

/** « Monter » / « Descendre » une exception dans son groupe (accessible au clavier). */
export async function moveExceptionAction(formData: FormData): Promise<ExceptionActionResult> {
  const user = await requireUser();
  const parsed = idsSchema.safeParse({
    channelId: formData.get("channelId"),
    ruleId: formData.get("ruleId"),
  });
  const dir = formData.get("direction") === "down" ? "down" : "up";
  if (!parsed.success) return { error: "Exception introuvable : rechargez la page." };
  const { channelId, ruleId } = parsed.data;
  const siblings = await prisma.approvalRule.findMany({
    where: { channelId, ...EXCEPTION_WHERE },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const rule = siblings.find((r) => r.id === ruleId);
  if (!rule) return { error: "Cette exception n'existe plus : rechargez la page." };
  const order = moveWithinLevel(siblings, ruleId, dir);
  if (!order)
    return {
      error:
        dir === "up"
          ? "Cette exception est déjà la première de son groupe."
          : "Cette exception est déjà la dernière de son groupe.",
    };
  await saveLevelOrder(
    user.id,
    channelId,
    rule.scope as ExceptionScope,
    order,
    Object.fromEntries(siblings.map((r) => [r.id, r.sortOrder])),
    { movedId: ruleId, direction: dir },
  );
  return {
    ok: dir === "up" ? "Exception montée d'un cran." : "Exception descendue d'un cran.",
  };
}

/** Nouvel ordre d'un groupe après un glisser-déposer (la liste complète du groupe, dans l'ordre voulu). */
export async function reorderExceptionsAction(formData: FormData): Promise<ExceptionActionResult> {
  const user = await requireUser();
  const channelId = String(formData.get("channelId") ?? "");
  const scope = String(formData.get("scope") ?? "") as ExceptionScope;
  const ids = formData.getAll("ruleIds").map(String);
  if (!channelId || !["INVITE_LINK", "SOURCE_CHANNEL", "SOURCE_KIND"].includes(scope))
    return { error: "Ordre illisible : rechargez la page." };
  const siblings = await prisma.approvalRule.findMany({
    where: { channelId, ...EXCEPTION_WHERE },
    select: { id: true, scope: true, sortOrder: true },
  });
  if (!isValidLevelOrder(siblings, scope, ids))
    return {
      error: "Les exceptions ont changé entre-temps : rechargez la page, puis recommencez.",
    };
  await saveLevelOrder(
    user.id,
    channelId,
    scope,
    ids,
    Object.fromEntries(siblings.map((r) => [r.id, r.sortOrder])),
    { via: "drag" },
  );
  return { ok: "Ordre des exceptions enregistré." };
}

export async function approveMembershipAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const membershipId = z.string().min(1).parse(formData.get("membershipId"));
  const channelId = z.string().min(1).parse(formData.get("channelId"));
  const r = await approveNow(membershipId, user.id);
  await audit({
    userId: user.id,
    action: "membership.approve_now",
    entityType: "Membership",
    entityId: membershipId,
    metadata: { ok: r.ok },
  });
  revalidatePath(`/channels/${channelId}`);
  back(
    channelId,
    "requests",
    r.ok ? { ok: "Demande acceptée : le membre entre dans le canal." } : { error: r.error },
  );
}

/** Tâches d'acceptation ajoutées à la file en même temps (« Tout accepter »). */
const APPROVE_ALL_ENQUEUE_CHUNK = 50;

/**
 * « Tout accepter » (onglet Demandes, liste filtrée, phase 14, décision E8) : les demandes de la liste affichée
 * (filtre, faites avant l'affichage `asOf`, jamais plus que le nombre annoncé `expected`) sont acceptées par la file
 * telegram-send, une tâche `approve` par demande, au rythme permis par Telegram, avec l'utilisateur pour le journal.
 * Avant d'enfiler, chaque demande passe « en file d'acceptation » en une seule écriture : programmée à l'heure de
 * secours (dans 10 minutes, `approveAllMark`), sans expiration, avec la marque `source.approveAll` (la carte dit
 * « Acceptation en cours », « Leur appliquer la nouvelle règle » ne la touche pas). La tâche accepte d'abord ; si elle
 * n'aboutit pas (aucun bot administrateur à ce moment-là, trois refus de Telegram, ancien service d'arrière-plan
 * pendant un déploiement), le passage des 20 secondes l'accepte à l'heure de secours : jamais de demande bloquée.
 * Identifiant de tâche propre à l'affichage (`approve:<id>:<asOf>`) : un double envoi du formulaire n'en crée qu'une,
 * un nouveau clic en crée une nouvelle (la file ignorerait sinon un identifiant qu'elle garde encore). Si la file est
 * indisponible pour une demande, elle est programmée pour maintenant. Message « Accepté » seulement si le bot peut
 * encore écrire à la personne (worker). Responsable autorisé (ce n'est pas une suppression).
 * Journal de l'équipe : `membership.approve_all` { channelId, filter, count, byStatus, queued }.
 */
export async function approveAllRequestsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = String(formData.get("channelId") ?? "");
  if (!channelId) redirect("/channels");
  const now = new Date();
  const { filter, asOf, expected } = parseApproveAllForm((name) => formData.get(name), now);
  const keep: Record<string, string> = filter === "all" ? {} : { status: filter };
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      isActive: true,
      // Un bot qui peut accepter : actif et normal, jamais un assistant de conversation (phase 17).
      botAdmins: {
        where: { revokedAt: null, bot: ACTIVE_CHANNEL_BOT_WHERE },
        select: { botId: true },
        take: 1,
      },
    },
  });
  if (!channel) redirect("/channels");
  if (!channel.isActive)
    back(channelId, "requests", {
      ...keep,
      error:
        "Ce canal est désactivé : réactivez-le dans « Réglages du canal » pour que les demandes soient acceptées.",
    });
  if (channel.botAdmins.length === 0)
    back(channelId, "requests", {
      ...keep,
      error:
        "Aucun de nos bots n'est administrateur de ce canal : les demandes ne peuvent pas être acceptées.",
    });
  const statuses = requestFilterStatuses(filter);
  const rows = await prisma.membership.findMany({
    where: { channelId, status: { in: statuses }, requestedAt: { lte: asOf } },
    orderBy: { requestedAt: "asc" },
    select: { id: true, status: true },
  });
  if (approveAllListGrew(rows.length, expected))
    back(channelId, "requests", { ...keep, error: APPROVE_ALL_LIST_CHANGED });
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const ids = rows.map((r) => r.id);
  // En file d'acceptation, en une seule écriture : heure de secours, sans expiration, marque « Tout accepter » ;
  // seulement si elle est encore dans le filtre (acceptée ou refusée entre-temps : pas touchée, pas de tâche).
  const mark = approveAllMark(now, user.id);
  const queuedIds = ids.length ? await markForApproval(ids, statuses, mark) : [];
  const res = { count: queuedIds.length };
  const notQueued: string[] = [];
  for (let i = 0; i < queuedIds.length; i += APPROVE_ALL_ENQUEUE_CHUNK) {
    const chunk = queuedIds.slice(i, i + APPROVE_ALL_ENQUEUE_CHUNK);
    const results = await Promise.allSettled(
      chunk.map((membershipId) =>
        enqueue(
          "telegram-send",
          { type: "approve", membershipId, byUserId: user.id },
          { jobId: approveJobId(membershipId, asOf) },
        ),
      ),
    );
    results.forEach((r, j) => {
      if (r.status === "rejected") notQueued.push(chunk[j]!);
    });
  }
  // File indisponible : acceptation par le passage des 20 secondes (programmée pour maintenant, marque gardée).
  if (notQueued.length)
    await prisma.membership.updateMany({
      where: { id: { in: notQueued }, status: "SCHEDULED" },
      data: { approveAt: now },
    });
  await audit({
    userId: user.id,
    action: "membership.approve_all",
    entityType: "Channel",
    entityId: channelId,
    metadata: {
      channelId,
      filter,
      count: res.count,
      byStatus,
      queued: queuedIds.length - notQueued.length,
      asOf: asOf.toISOString(),
      membershipIds: ids.slice(0, 500),
    },
  });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, "requests", { ...keep, ok: approveAllDone(res.count) });
}

/**
 * Met en file d'acceptation les demandes encore dans le filtre (une seule requête, atomique) : programmées à l'heure de
 * secours de la marque, sans expiration, marque `source.approveAll` ajoutée à leur source. Renvoie les demandes
 * modifiées (les autres ont changé entre-temps : aucune tâche pour elles). Heures écrites en UTC comme Prisma.
 */
async function markForApproval(
  ids: string[],
  statuses: string[],
  mark: ReturnType<typeof approveAllMark>,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Membership"
    SET status = 'SCHEDULED',
        "approveAt" = (${mark.fallbackAt}::timestamptz AT TIME ZONE 'UTC'),
        "expiresAt" = NULL,
        source = (CASE WHEN jsonb_typeof(source) = 'object' THEN source ELSE '{}'::jsonb END)
          || jsonb_build_object('approveAll', ${JSON.stringify(mark)}::jsonb),
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE id = ANY(${ids}::text[]) AND status::text = ANY(${statuses}::text[])
    RETURNING id`;
  const updated = new Set(rows.map((r) => r.id));
  // Ordre de la liste (les plus anciennes d'abord).
  return ids.filter((id) => updated.has(id));
}

export async function declineMembershipAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const membershipId = z.string().min(1).parse(formData.get("membershipId"));
  const channelId = z.string().min(1).parse(formData.get("channelId"));
  const r = await declineNow(membershipId, user.id);
  await audit({
    userId: user.id,
    action: "membership.decline",
    entityType: "Membership",
    entityId: membershipId,
    metadata: { ok: r.ok },
  });
  revalidatePath(`/channels/${channelId}`);
  back(
    channelId,
    "requests",
    r.ok ? { ok: "Demande refusée : le membre devra redemander l'accès." } : { error: r.error },
  );
}

/**
 * Retour vers le calendrier des messages du canal, où sont montrés les meilleurs créneaux, avec la semaine et les
 * filtres que l'utilisateur regardait (champs cachés `week`, `day`, `vertical`, `campaignId`, `category`).
 */
function backToCalendar(
  channelId: string,
  formData: FormData,
  params: Record<string, string>,
): never {
  const keep = calendarReturnParams((name) => formData.get(name));
  redirect(`/messages?${new URLSearchParams({ channelId, ...keep, ...params }).toString()}`);
}

/**
 * Enfile un recalcul immédiat des meilleurs horaires (tous canaux ; tâche `stats` du worker). Les meilleurs créneaux
 * sont montrés dans le calendrier des messages (l'onglet « Meilleurs horaires » de la fiche canal est retiré) : le
 * message de confirmation revient sur `/messages?channelId=<id>`.
 */
export async function recomputeBestHoursAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = z.string().min(1).parse(formData.get("channelId"));
  try {
    await enqueue(
      "stats",
      { type: "best-hours" },
      { jobId: `best-hours:${Math.floor(Date.now() / 60_000)}` },
    );
  } catch {
    backToCalendar(channelId, formData, {
      error:
        "Recalcul impossible pour l'instant (file d'attente indisponible). Réessayez dans une minute.",
    });
  }
  await audit({
    userId: user.id,
    action: "stats.best_hours_requested",
    entityType: "Channel",
    entityId: channelId,
  });
  revalidatePath(`/channels/${channelId}`);
  revalidatePath("/messages");
  backToCalendar(channelId, formData, {
    ok: "Recalcul des meilleurs créneaux lancé : rechargez cette page dans une minute pour les voir à jour.",
  });
}

/** Re-vérifie les droits de nos bots sur ce canal (bouton de la fiche). Audit `channel.rights_rechecked`. */
export async function recheckRightsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = String(formData.get("channelId") ?? "");
  const tab = String(formData.get("tab") ?? "rules");
  if (!channelId) redirect("/channels");
  let message = "";
  try {
    message = rightsMessage(await recheckChannelRights(channelId, { userId: user.id }));
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
    back(channelId, tab, {
      error: `Vérification impossible : ${err instanceof Error ? err.message : "erreur inconnue"}`,
    });
  }
  revalidatePath(`/channels/${channelId}`);
  revalidatePath("/channels");
  back(channelId, tab, { ok: message });
}
