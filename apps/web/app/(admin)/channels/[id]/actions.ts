"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { approveNow, declineNow } from "@/lib/approval/telegram";

function back(channelId: string, tab: string, params: Record<string, string>): never {
  redirect(`/channels/${channelId}?${new URLSearchParams({ tab, ...params }).toString()}`);
}

const DELAY_PRESETS: Record<string, number> = {
  immediate: 0,
  "1m": 60,
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
};
const RULE_FIELD_HINTS: Record<string, string> = {
  delayCustomSeconds: "un nombre de secondes entre 0 et 2 592 000 (30 jours)",
  maxReminders: "un nombre entre 0 et 10",
  expireAfterHours: "un nombre d'heures entre 0 et 1 440 (60 jours)",
  reminderAfterMinutes: "des minutes séparées par des virgules (ex. 60, 1440)",
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
});

/** Enregistre la règle par défaut du canal (créée si absente). */
export async function saveRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ruleSchema.safeParse({
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
  });
  if (!parsed.success) {
    const channelId = String(formData.get("channelId") ?? "");
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    back(channelId, "rules", {
      error: RULE_FIELD_LABELS[field]
        ? `Vérifiez le champ « ${RULE_FIELD_LABELS[field]} » : ${RULE_FIELD_HINTS[field] ?? "valeur invalide"}.`
        : "Vérifiez les champs de la règle : une valeur est invalide.",
    });
  }
  const d = parsed.data;
  const delaySeconds =
    d.delayPreset === "custom" ? (d.delayCustomSeconds ?? 0) : (DELAY_PRESETS[d.delayPreset] ?? 0);
  const reminders = d.reminderAfterMinutes
    .split(/[,\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const gateChannelIds = d.gateChannelIds.filter((id) => id !== d.channelId);
  const data = {
    name: "Règle par défaut",
    isDefault: true,
    mode: d.mode,
    delaySeconds,
    gateMode: gateChannelIds.length === 0 ? ("NONE" as const) : d.gateMode,
    gateChannelIds,
    reminderAfterMinutes: reminders,
    maxReminders: d.maxReminders,
    expireAfterHours: d.expireAfterHours && d.expireAfterHours > 0 ? d.expireAfterHours : null,
    expireAction: d.expireAction,
    sendAcceptedMessage: d.sendAcceptedMessage,
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
    },
  });
  revalidatePath(`/channels/${d.channelId}`);
  back(d.channelId, "rules", {
    ok: "Règle d'adhésion enregistrée : elle s'applique aux prochaines demandes.",
  });
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
