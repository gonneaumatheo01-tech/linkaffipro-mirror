/**
 * Phase 34, lot B — cœurs de l'onglet « Qui peut entrer et quand » et de l'onglet Demandes de la fiche canal : règle par
 * défaut, exceptions selon la provenance (phase 11), liens des canaux à rejoindre, demandes (accepter, refuser, tout
 * accepter), meilleurs créneaux. Appelés par `app/(admin)/channels/[id]/actions.ts` et par Kevin : mêmes validations,
 * mêmes textes, même journal (+ `via`). Le site garde ses redirections ; un succès accompagné d'un avertissement rend
 * `data.warning` (affiché en `?error=` à côté de `?ok=`).
 */
import { z } from "zod";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { ACTIVE_CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { enqueue } from "@linkaffipro/queue";
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
import { appliedMessage, applyRuleToPending, pendingFlash, pendingSummaryForRule } from "@/lib/channels/pending-rule";
import {
  APPROVE_ALL_LIST_CHANGED,
  approveAllDone,
  approveAllListGrew,
  approveAllMark,
  approveJobId,
  parseApproveAllForm,
  requestFilterStatuses,
} from "@/lib/channels/requests";
import {
  fail,
  ok,
  preview,
  resolveChannelRef,
  resolveChannelRefs,
  resolveNamed,
  str,
  viaMeta,
  type CoreRun,
  type SiteOpActor,
  type SiteOpResult,
} from "./common";

type Fail = Extract<SiteOpResult, { ok: false }>;

/** Délais proposés par l'écran (clé → secondes) ; « custom » : `delayCustomSeconds`. */
export const DELAY_PRESETS: Record<string, number> = {
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

/** Message d'erreur lisible pour le premier champ refusé. */
function fieldError(error: z.ZodError): Fail {
  const field = String(error.issues[0]?.path[0] ?? "");
  return fail(
    RULE_FIELD_LABELS[field]
      ? `Vérifiez le champ « ${RULE_FIELD_LABELS[field]} » : ${RULE_FIELD_HINTS[field] ?? "valeur invalide"}.`
      : "Vérifiez les champs de la règle : une valeur est invalide.",
    "invalid",
    field || null,
  );
}

type RuleFields = z.infer<typeof ruleSchema>;

/** Champs d'une règle : le site les envoie tous ; Kevin seulement ceux qu'il change (les autres : règle actuelle). */
const RULE_KEYS = [
  "mode",
  "delayPreset",
  "delayCustomSeconds",
  "gateMode",
  "gateChannelIds",
  "reminderAfterMinutes",
  "maxReminders",
  "expireAfterHours",
  "expireAction",
  "sendAcceptedMessage",
  "sendWelcome",
] as const;

type StoredRule = {
  mode: string;
  delaySeconds: number;
  gateMode: string;
  gateChannelIds: unknown;
  reminderAfterMinutes: unknown;
  maxReminders: number;
  expireAfterHours: number | null;
  expireAction: string;
  sendAcceptedMessage: boolean;
  sendWelcome: boolean;
};

/** Valeurs actuelles d'une règle dans la forme du formulaire (pour compléter une phrase de Kevin). */
function formOfRule(r: StoredRule | null): Record<string, unknown> {
  if (!r)
    return {
      mode: "IMMEDIATE",
      delayPreset: "immediate",
      gateMode: "NONE",
      gateChannelIds: [],
      reminderAfterMinutes: "",
      maxReminders: 2,
      expireAction: "KEEP",
      sendAcceptedMessage: false,
      sendWelcome: true,
    };
  const preset = Object.entries(DELAY_PRESETS).find(([, s]) => s === r.delaySeconds)?.[0];
  return {
    mode: r.mode,
    delayPreset: preset ?? "custom",
    delayCustomSeconds: preset ? undefined : r.delaySeconds,
    gateMode: r.gateMode,
    gateChannelIds: Array.isArray(r.gateChannelIds) ? r.gateChannelIds.map(String) : [],
    reminderAfterMinutes: Array.isArray(r.reminderAfterMinutes) ? r.reminderAfterMinutes.join(", ") : "",
    maxReminders: r.maxReminders,
    expireAfterHours: r.expireAfterHours ?? undefined,
    expireAction: r.expireAction,
    sendAcceptedMessage: r.sendAcceptedMessage,
    sendWelcome: r.sendWelcome,
  };
}

/** Délai donné en clair par Kevin (`delaySeconds`) → préréglage de l'écran ou « custom ». */
function withDelaySeconds(fields: Record<string, unknown>, input: Record<string, unknown>): void {
  if (input.delaySeconds === undefined || "delayPreset" in input) return;
  const s = Number(input.delaySeconds);
  const preset = Object.entries(DELAY_PRESETS).find(([, v]) => v === s)?.[0];
  fields.delayPreset = preset ?? "custom";
  fields.delayCustomSeconds = preset ? undefined : input.delaySeconds;
  if (fields.mode === undefined && !("mode" in input)) fields.mode = s > 0 ? "DELAY" : "IMMEDIATE";
}

/**
 * Champs bruts de la règle : ceux donnés (clé présente, même vide : cas du site), sinon ceux de la règle actuelle.
 * Les canaux à rejoindre peuvent venir par leurs noms (`gateChannels`, Kevin).
 */
async function ruleFieldsOf(
  input: Record<string, unknown>,
  channelId: string,
  current: StoredRule | null,
): Promise<{ ok: true; fields: Record<string, unknown> } | { ok: false; result: Fail }> {
  const base = formOfRule(current);
  const fields: Record<string, unknown> = { channelId };
  for (const k of RULE_KEYS) fields[k] = k in input ? input[k] : base[k];
  withDelaySeconds(fields, input);
  if (!("gateChannelIds" in input) && input.gateChannels !== undefined) {
    const g = await resolveChannelRefs({ channels: input.gateChannels });
    if (!g.ok) return { ok: false, result: g.result };
    fields.gateChannelIds = g.ids;
    if (!("gateMode" in input) && g.ids.length > 0 && fields.gateMode === "NONE") fields.gateMode = "REQUIRED";
  }
  if (Array.isArray(fields.reminderAfterMinutes)) fields.reminderAfterMinutes = fields.reminderAfterMinutes.join(", ");
  fields.reminderAfterMinutes = str(fields.reminderAfterMinutes ?? "");
  fields.gateChannelIds = Array.isArray(fields.gateChannelIds) ? fields.gateChannelIds.map(String) : [];
  return { ok: true, fields };
}

/**
 * Réglages enregistrés d'une règle (par défaut ou exception) : le délai choisi est TOUJOURS enregistré, y compris
 * « puis accepter » après les canaux à rejoindre ; l'exigence suit les canaux choisis.
 */
function ruleData(d: RuleFields, gateIds: readonly string[]) {
  const delaySeconds = d.delayPreset === "custom" ? (d.delayCustomSeconds ?? 0) : (DELAY_PRESETS[d.delayPreset] ?? 0);
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

/** Résumé d'une règle pour l'essai à blanc de Kevin. */
function ruleSummary(f: ReturnType<typeof ruleData>): string {
  const when =
    f.mode === "MANUAL"
      ? "validation à la main"
      : f.delaySeconds > 0
        ? `acceptée après ${f.delaySeconds >= 3600 ? `${Math.round(f.delaySeconds / 3600)} h` : `${Math.round(f.delaySeconds / 60)} min`}`
        : "acceptée tout de suite";
  const gates = f.gateChannelIds.length
    ? `, ${f.gateChannelIds.length} canal${f.gateChannelIds.length > 1 ? "aux" : ""} à rejoindre${f.gateMode === "SOFT" ? " (conseillés)" : ""}`
    : "";
  return `${when}${gates}${f.sendWelcome ? "" : ", sans message d'accueil"}`;
}

/** Canal de la demande (identifiant du site, ou nom donné à Kevin). */
async function channelOf(input: Record<string, unknown>): Promise<{ ok: true; id: string; name: string } | { ok: false; result: Fail }> {
  const ref = await resolveChannelRef(input);
  if (!ref) return { ok: false, result: fail("Canal introuvable : rechargez la page.", "invalid", "channel") };
  return ref;
}

/** Enregistre la règle par défaut du canal (créée si absente). */
export const channelRuleSave: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  const channelId = ref?.id ?? str(input.channelId);
  const existing = channelId
    ? await prisma.approvalRule.findFirst({ where: { channelId, isDefault: true } })
    : null;
  const raw = await ruleFieldsOf(input, channelId, existing);
  if (!raw.ok) return raw.result;
  const parsed = ruleSchema.safeParse(raw.fields);
  if (!parsed.success) return fieldError(parsed.error);
  const d = parsed.data;
  const rule0 = ruleData(d, d.gateChannelIds);
  const { delaySeconds, gateChannelIds } = rule0;
  if (opts.dryRun) return preview({ summary: `Règle par défaut de « ${ref?.name ?? channelId} » : ${ruleSummary(rule0)}.` });
  const data = { ...rule0, name: "Règle par défaut", isDefault: true, scope: "DEFAULT" as const, isActive: true };
  const rule = existing
    ? await prisma.approvalRule.update({ where: { id: existing.id }, data })
    : await prisma.approvalRule.create({ data: { ...data, channelId: d.channelId } });
  await audit({
    userId: actor.userId,
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
      ...viaMeta(actor),
    },
  });
  // Liens des canaux à rejoindre créés et vérifiés tout de suite : le canal en cause et la solution sont affichés.
  const saved = "Règle d'adhésion enregistrée : elle s'applique aux prochaines demandes.";
  const flash = gateChannelIds.length > 0 ? await checkGateLinks(d.channelId, actor.userId) : {};
  const pending = await pendingNote(d.channelId, rule.id, "default");
  return ok([saved, pending, flash.ok].filter(Boolean).join(" "), {
    channelId: d.channelId,
    ruleId: rule.id,
    ...(flash.error ? { warning: flash.error } : {}),
  });
};

/**
 * Demandes en cours qui suivent encore l'ancienne version de la règle (phrase ajoutée à la confirmation, vide sinon).
 * Une panne de lecture ne bloque jamais l'enregistrement de la règle.
 */
async function pendingNote(channelId: string, ruleId: string, where: "default" | "exception"): Promise<string> {
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

/** Règle désignée : `ruleId` (site), sinon la règle par défaut du canal (Kevin : « applique la règle à Zone »). */
async function ruleIdOf(input: Record<string, unknown>, channelId: string): Promise<string> {
  const id = str(input.ruleId);
  if (id || input.ruleId !== undefined) return id;
  const r = await prisma.approvalRule.findFirst({ where: { channelId, isDefault: true }, select: { id: true } });
  return r?.id ?? "";
}

/**
 * « Leur appliquer la nouvelle règle » : recalcule les demandes en cours qui suivent encore l'ancienne version de la
 * règle, comme si elles arrivaient maintenant (`applyRuleToPending`). Aucun message n'est envoyé.
 */
export const channelRuleApplyPending: CoreRun = async (input, actor, opts = {}) => {
  const ch = await channelOf(input);
  if (!ch.ok) return ch.result;
  const channelId = ch.id;
  const ruleId = await ruleIdOf(input, channelId);
  if (!ruleId) return fail("Règle introuvable : rechargez la page.", "not_found", "ruleId");
  if (opts.dryRun) {
    const s = await pendingSummaryForRule(channelId, ruleId).catch(() => null);
    if (!s) return fail("Cette règle n'existe plus : rechargez la page.", "not_found", "ruleId");
    return preview({ summary: `${s.count} demande${s.count > 1 ? "s" : ""} en cours de « ${ch.name} » suivr${s.count > 1 ? "ont" : "a"} la nouvelle règle. Aucun message n'est envoyé.` });
  }
  const r = await applyRuleToPending({ channelId, ruleId, userId: actor.userId ?? "" });
  if (r.status === "not_found") return fail("Cette règle n'existe plus : rechargez la page.", "not_found", "ruleId");
  if (r.status === "inactive")
    return fail(
      "Cette exception est désactivée : activez-la d'abord, ou laissez ces demandes suivre leur règle actuelle.",
      "conflict",
    );
  await audit({
    userId: actor.userId,
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
      ...viaMeta(actor),
    },
  });
  return ok(appliedMessage(r), { channelId, count: r.count });
};

/**
 * Crée et vérifie les liens des canaux à rejoindre de toutes les règles actives du canal ; une panne (réseau, Telegram)
 * devient un message, jamais une erreur.
 */
async function checkGateLinks(channelId: string, userId: string | null): Promise<{ ok?: string; error?: string }> {
  try {
    const { results, solutionBot } = await verifyChannelGateLinks(channelId, { userId });
    return gateCheckFlash(results, solutionBot);
  } catch (err) {
    console.warn("[canaux] vérification des liens impossible", {
      channelId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      error: "Vérification des liens impossible pour le moment : réessayez « Vérifier les liens » dans une minute.",
    };
  }
}

/** « Vérifier les liens » : crée tout de suite les liens manquants des canaux à rejoindre. Aucun message aux membres. */
export const channelGateLinksCheck: CoreRun = async (input, actor, opts = {}) => {
  const ch = await channelOf(input);
  if (!ch.ok) return ch.result;
  const channelId = ch.id;
  if (opts.dryRun) return preview({ summary: `Vérification et création des liens des canaux à rejoindre de « ${ch.name} ».` });
  const flash = await checkGateLinks(channelId, actor.userId);
  await audit({
    userId: actor.userId,
    action: "channel.gate_links_checked",
    entityType: "Channel",
    entityId: channelId,
    metadata: { ok: !flash.error, ...viaMeta(actor) },
  });
  if (flash.error && !flash.ok) return { ok: false, code: "unavailable", error: flash.error };
  return ok(flash.ok ?? "Aucun canal à rejoindre dans les règles de ce canal.", {
    channelId,
    ...(flash.error ? { warning: flash.error } : {}),
  });
};

/** Exceptions selon la provenance d'un canal : règles qui ne sont pas la règle par défaut. */
const EXCEPTION_WHERE = {
  isDefault: false,
  scope: { not: "DEFAULT" },
} satisfies Prisma.ApprovalRuleWhereInput;

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
  actor: SiteOpActor,
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
    ...viaMeta(actor),
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

/** Provenance donnée à Kevin par le nom d'un canal d'origine (`sourceChannel`) → clé du menu (`channel:<id>`). */
async function provenanceOf(input: Record<string, unknown>): Promise<{ ok: true; key: string } | { ok: false; result: Fail }> {
  if (str(input.provenance)) return { ok: true, key: str(input.provenance) };
  if (input.sourceChannel !== undefined) {
    const r = await resolveChannelRef({ channel: input.sourceChannel });
    if (r && !r.ok) return { ok: false, result: r.result };
    if (r) return { ok: true, key: `channel:${r.id}` };
  }
  if (str(input.sourceKind)) return { ok: true, key: `kind:${str(input.sourceKind)}` };
  return { ok: true, key: "" };
}

/**
 * « Enregistrer l'exception » : crée ou modifie une exception selon la provenance. Validation de tous les champs, une
 * seule exception par provenance, libellé « Venu … » recalculé, place dans son groupe, journal de l'équipe, liens des
 * canaux à rejoindre vérifiés tout de suite.
 */
export const channelExceptionSave: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  const channelId = ref?.id ?? str(input.channelId);
  const prov = await provenanceOf(input);
  if (!prov.ok) return prov.result;
  const ruleIdRaw = input.ruleId ? str(input.ruleId) : undefined;
  const current = ruleIdRaw && channelId
    ? await prisma.approvalRule.findFirst({ where: { id: ruleIdRaw, channelId, ...EXCEPTION_WHERE } })
    : null;
  const raw = await ruleFieldsOf(input, channelId, current);
  if (!raw.ok) return raw.result;
  const parsed = exceptionSchema.safeParse({ ...raw.fields, ruleId: ruleIdRaw, provenance: prov.key });
  if (!parsed.success) return fieldError(parsed.error);
  const d = parsed.data;
  const target = targetOfKey(d.provenance);
  if (!target) return fail("Choisissez d'où vient la personne.", "invalid", "provenance");
  const channel = await prisma.channel.findUnique({ where: { id: d.channelId }, select: { id: true } });
  if (!channel) return fail("Ce canal n'existe plus : revenez à la liste des canaux.", "not_found");
  const siblings = await prisma.approvalRule.findMany({
    where: { channelId: d.channelId, ...EXCEPTION_WHERE },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const existing = d.ruleId ? siblings.find((r) => r.id === d.ruleId) : undefined;
  if (d.ruleId && !existing) return fail("Cette exception n'existe plus : rechargez la page.", "not_found", "ruleId");

  const names: TargetNames = { titles: {}, linkNames: {}, affiliateNames: {}, affiliateLinks: {}, landingPageNames: {} };
  const problem = await checkTarget(target, d.channelId, existing?.inviteLinkId ?? null, names);
  if (problem) return fail(problem, "invalid", "provenance");
  if (findDuplicate(siblings, target, existing?.id)) return fail(duplicateMessage(target, names), "conflict", "provenance");
  if (target.inviteLinkId) {
    const other = await prisma.approvalRule.findFirst({
      where: { inviteLinkId: target.inviteLinkId, ...(existing ? { NOT: { id: existing.id } } : {}) },
      select: { id: true },
    });
    if (other) return fail(duplicateMessage(target, names), "conflict", "provenance");
  }

  const fields = ruleData(d, exceptionGateChannelIds(target, d.gateChannelIds, d.channelId));
  if (opts.dryRun)
    return preview({ summary: `Exception pour les personnes venues ${conditionText(target, names)} : ${ruleSummary(fields)}.` });
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
        : await tx.approvalRule.create({ data: { ...data, channelId: d.channelId, isActive: true, sortOrder: 0 } });
      // Nouvelle exception, ou provenance changée : placée juste avant celle qui la masquerait, sinon à la fin.
      if (!existing || !sameTarget(existing, target)) {
        const level = siblings.filter((r) => r.scope === target.scope && r.id !== rule.id);
        const current = Object.fromEntries([...level, rule].map((r) => [r.id, r.sortOrder]));
        await renumber(tx, placementOrder(level, rule), current);
      }
      return rule;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return fail(duplicateMessage(target, names), "conflict", "provenance");
    throw err;
  }
  await audit({
    userId: actor.userId,
    action: existing ? "approval_rule.exception_updated" : "approval_rule.exception_created",
    entityType: "ApprovalRule",
    entityId: saved.id,
    metadata: exceptionMetadata(saved, actor, {
      mode: fields.mode,
      delaySeconds: fields.delaySeconds,
      gateMode: fields.gateMode,
      gateChannelIds: fields.gateChannelIds,
      sendWelcome: fields.sendWelcome,
    }),
  });
  const okText = `Exception enregistrée pour les personnes venues ${conditionText(target, names)} : elle s'applique aux prochaines demandes.`;
  const flash = saved.isActive && fields.gateChannelIds.length > 0 ? await checkGateLinks(d.channelId, actor.userId) : {};
  const pending = existing && saved.isActive ? await pendingNote(d.channelId, saved.id, "exception") : "";
  return ok([okText, pending, flash.ok].filter(Boolean).join(" "), {
    channelId: d.channelId,
    ruleId: saved.id,
    ...(flash.error ? { warning: flash.error } : {}),
  });
};

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
    names.affiliateNames[target.linkaffiAffiliateId!] = affiliateLabel(link.linkaffiAffiliateId, link.linkaffiAffiliateName);
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
    if (target.sourceChannelId === channelId) return "Choisissez un autre canal que celui-ci : la personne vient d'ailleurs.";
    const ch = await prisma.channel.findUnique({ where: { id: target.sourceChannelId! }, select: { id: true, title: true } });
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
        campaignName: campaignLabel({ campaignName: link.linkaffiCampaignName, campaignKey: link.linkaffiCampaignKey }),
        affiliateName: affiliateLabel(link.linkaffiAffiliateId, link.linkaffiAffiliateName),
      };
  }
  return null;
}

/** Une exception du canal (règle qui n'est pas la règle par défaut), ou null. */
async function findException(channelId: string, ruleId: string) {
  return prisma.approvalRule.findFirst({ where: { id: ruleId, channelId, ...EXCEPTION_WHERE } });
}

/** Exception désignée par `ruleId` (site) ou par son libellé (« Venu de Tir Cadré », Kevin). */
async function exceptionIdOf(input: Record<string, unknown>, channelId: string): Promise<{ ok: true; id: string } | { ok: false; result: Fail }> {
  const id = str(input.ruleId);
  if (id || !input.exception) return { ok: true, id };
  const raw = str(input.exception).trim();
  const rows = await prisma.approvalRule.findMany({ where: { channelId, ...EXCEPTION_WHERE }, select: { id: true, label: true, name: true } });
  const r = await resolveNamed({ plural: "exceptions", one: "l'exception" }, raw, rows.map((x) => ({ id: x.id, name: x.label ?? x.name })));
  return r.ok ? { ok: true, id: r.id } : r;
}

const idsSchema = z.object({ channelId: z.string().min(1), ruleId: z.string().min(1) });

/** Activer / désactiver une exception. Une exception désactivée ne s'applique plus. */
export const channelExceptionToggle: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  const ex = await exceptionIdOf(input, ref?.id ?? "");
  if (!ex.ok) return ex.result;
  const parsed = idsSchema.safeParse({ channelId: ref?.id ?? input.channelId, ruleId: ex.id });
  if (!parsed.success) return fail("Exception introuvable : rechargez la page.", "not_found");
  const { channelId, ruleId } = parsed.data;
  const active = input.active === true || input.active === "1";
  const rule = await findException(channelId, ruleId);
  if (!rule) return fail("Cette exception n'existe plus : rechargez la page.", "not_found");
  if (opts.dryRun) return preview({ summary: `${active ? "Activer" : "Désactiver"} l'exception « ${rule.label ?? rule.name} ».` });
  const saved = await prisma.approvalRule.update({ where: { id: rule.id }, data: { isActive: active } });
  await audit({
    userId: actor.userId,
    action: "approval_rule.exception_updated",
    entityType: "ApprovalRule",
    entityId: rule.id,
    metadata: exceptionMetadata(saved, actor, { change: active ? "activated" : "deactivated" }),
  });
  const gates = Array.isArray(saved.gateChannelIds) && saved.gateChannelIds.length > 0;
  const flash = active && gates ? await checkGateLinks(channelId, actor.userId) : {};
  if (flash.error) return { ok: false, code: "unavailable", error: flash.error };
  return ok(
    active
      ? "Exception activée : elle s'applique aux prochaines demandes."
      : "Exception désactivée : ces personnes suivent la règle par défaut (ou une autre exception).",
    { channelId },
  );
};

export const EXCEPTION_DELETE_ADMIN_ONLY =
  "Seul un administrateur peut supprimer une exception. Vous pouvez la désactiver avec son interrupteur.";

/**
 * Supprimer une exception (administrateurs seulement : un responsable peut la désactiver). Les demandes déjà
 * planifiées gardent leur date d'acceptation ; les prochaines suivent la règle par défaut (ou une autre exception).
 */
export const channelExceptionDelete: CoreRun = async (input, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return fail(EXCEPTION_DELETE_ADMIN_ONLY, "forbidden");
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  const channelId = ref?.id ?? "";
  const ex = await exceptionIdOf(input, channelId);
  if (!ex.ok) return ex.result;
  const rule = ex.id ? await findException(channelId, ex.id) : null;
  if (!rule) return fail("Cette exception n'existe plus.", "not_found");
  if (opts.dryRun)
    return preview({
      summary: `Supprimer l'exception « ${rule.label ?? rule.name} ».`,
      impact: "Les demandes déjà planifiées gardent leur date ; les prochaines suivent la règle par défaut (ou une autre exception).",
    });
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
    userId: actor.userId,
    action: "approval_rule.exception_deleted",
    entityType: "ApprovalRule",
    entityId: rule.id,
    metadata: exceptionMetadata(rule, actor, {
      mode: rule.mode,
      delaySeconds: rule.delaySeconds,
      gateMode: rule.gateMode,
      gateChannelIds: rule.gateChannelIds,
      sendWelcome: rule.sendWelcome,
    }),
  });
  return ok("Exception supprimée : les prochaines demandes suivent la règle par défaut (ou une autre exception).", { channelId });
};

/** Enregistre le nouvel ordre d'un groupe d'exceptions et le note au journal de l'équipe. */
async function saveLevelOrder(
  actor: SiteOpActor,
  channelId: string,
  scope: ExceptionScope,
  orderedIds: readonly string[],
  current: Readonly<Record<string, number>>,
  extra: Record<string, unknown>,
): Promise<void> {
  await prisma.$transaction(async (tx) => renumber(tx, orderedIds, current));
  await audit({
    userId: actor.userId,
    action: "approval_rule.exceptions_reordered",
    entityType: "Channel",
    entityId: channelId,
    // Glisser-déposer du site : `via: "drag"` comme avant (voir `channelExceptionsReorder`).
    metadata: { channelId, scope, order: [...orderedIds], ...viaMeta(actor), ...extra } as Prisma.InputJsonObject,
  });
}

/** « Monter » / « Descendre » une exception dans son groupe. */
export const channelExceptionMove: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  const ex = await exceptionIdOf(input, ref?.id ?? "");
  if (!ex.ok) return ex.result;
  const parsed = idsSchema.safeParse({ channelId: ref?.id ?? input.channelId, ruleId: ex.id });
  const dir = input.direction === "down" ? "down" : "up";
  if (!parsed.success) return fail("Exception introuvable : rechargez la page.", "not_found");
  const { channelId, ruleId } = parsed.data;
  const siblings = await prisma.approvalRule.findMany({
    where: { channelId, ...EXCEPTION_WHERE },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const rule = siblings.find((r) => r.id === ruleId);
  if (!rule) return fail("Cette exception n'existe plus : rechargez la page.", "not_found");
  const order = moveWithinLevel(siblings, ruleId, dir);
  if (!order)
    return fail(
      dir === "up" ? "Cette exception est déjà la première de son groupe." : "Cette exception est déjà la dernière de son groupe.",
      "conflict",
    );
  if (opts.dryRun) return preview({ summary: `${dir === "up" ? "Monter" : "Descendre"} l'exception « ${rule.label ?? rule.name} » d'un cran.` });
  await saveLevelOrder(
    actor,
    channelId,
    rule.scope as ExceptionScope,
    order,
    Object.fromEntries(siblings.map((r) => [r.id, r.sortOrder])),
    { movedId: ruleId, direction: dir },
  );
  return ok(dir === "up" ? "Exception montée d'un cran." : "Exception descendue d'un cran.", { channelId });
};

/** Nouvel ordre d'un groupe après un glisser-déposer (la liste complète du groupe, dans l'ordre voulu). */
export const channelExceptionsReorder: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  const channelId = ref?.id ?? "";
  const scope = str(input.scope) as ExceptionScope;
  const ids = Array.isArray(input.ruleIds) ? input.ruleIds.map(String) : [];
  if (!channelId || !["INVITE_LINK", "SOURCE_CHANNEL", "SOURCE_KIND"].includes(scope))
    return fail("Ordre illisible : rechargez la page.");
  const siblings = await prisma.approvalRule.findMany({
    where: { channelId, ...EXCEPTION_WHERE },
    select: { id: true, scope: true, sortOrder: true },
  });
  if (!isValidLevelOrder(siblings, scope, ids))
    return fail("Les exceptions ont changé entre-temps : rechargez la page, puis recommencez.", "conflict");
  if (opts.dryRun) return preview({ summary: `Nouvel ordre de ${ids.length} exception${ids.length > 1 ? "s" : ""}.` });
  // Site : glisser-déposer (`via: "drag"`, journal identique à avant) ; Kevin : `via: "TELEGRAM"`.
  await saveLevelOrder(
    actor,
    channelId,
    scope,
    ids,
    Object.fromEntries(siblings.map((r) => [r.id, r.sortOrder])),
    actor.via === "WEB" ? { via: "drag" } : {},
  );
  return ok("Ordre des exceptions enregistré.", { channelId });
};

/** Demande désignée par `membershipId` (site) ou par le @nom / le prénom de la personne dans ce canal (Kevin). */
async function membershipIdOf(input: Record<string, unknown>, channelId: string): Promise<{ ok: true; id: string; who: string } | { ok: false; result: Fail }> {
  const id = str(input.membershipId);
  if (id) return { ok: true, id, who: id };
  const raw = str(input.member).trim().replace(/^@/, "");
  if (!raw) return { ok: false, result: fail("Quelle demande ? Donnez le @nom ou le prénom de la personne.", "invalid", "member") };
  const rows = await prisma.membership.findMany({
    where: { channelId, status: { in: requestFilterStatuses("all") } },
    select: { id: true, member: { select: { username: true, firstName: true, lastName: true } } },
    take: 500,
  });
  const r = await resolveNamed(
    { plural: "demandes", one: "de demande pour" },
    raw,
    rows.map((m) => ({
      id: m.id,
      name: [m.member.firstName, m.member.lastName].filter(Boolean).join(" ") || m.member.username || m.id,
      extra: m.member.username ? [m.member.username] : [],
    })),
  );
  return r.ok ? { ok: true, id: r.id, who: r.name } : r;
}

/** Accepter une demande tout de suite (bouton de l'onglet Demandes). */
export const channelRequestApprove: CoreRun = async (input, actor, opts = {}) => {
  const ch = await channelOf(input);
  if (!ch.ok) return ch.result;
  const m = await membershipIdOf(input, ch.id);
  if (!m.ok) return m.result;
  if (opts.dryRun) return preview({ summary: `Accepter tout de suite la demande de ${m.who} dans « ${ch.name} ».` });
  const r = await approveNow(m.id, actor.userId ?? "");
  await audit({
    userId: actor.userId,
    action: "membership.approve_now",
    entityType: "Membership",
    entityId: m.id,
    metadata: { ok: r.ok, ...viaMeta(actor) },
  });
  return r.ok ? ok("Demande acceptée : le membre entre dans le canal.", { channelId: ch.id }) : fail(r.error, "unavailable");
};

/** Refuser une demande (bouton de l'onglet Demandes). */
export const channelRequestDecline: CoreRun = async (input, actor, opts = {}) => {
  const ch = await channelOf(input);
  if (!ch.ok) return ch.result;
  const m = await membershipIdOf(input, ch.id);
  if (!m.ok) return m.result;
  if (opts.dryRun) return preview({ summary: `Refuser la demande de ${m.who} dans « ${ch.name} ».` });
  const r = await declineNow(m.id, actor.userId ?? "");
  await audit({
    userId: actor.userId,
    action: "membership.decline",
    entityType: "Membership",
    entityId: m.id,
    metadata: { ok: r.ok, ...viaMeta(actor) },
  });
  return r.ok ? ok("Demande refusée : le membre devra redemander l'accès.", { channelId: ch.id }) : fail(r.error, "unavailable");
};

/** Tâches d'acceptation ajoutées à la file en même temps (« Tout accepter »). */
const APPROVE_ALL_ENQUEUE_CHUNK = 50;

/**
 * « Tout accepter » (onglet Demandes, liste filtrée, phase 14) : les demandes de la liste (filtre, faites avant
 * l'affichage `asOf`, jamais plus que le nombre annoncé `expected`) sont acceptées par la file telegram-send, une
 * tâche `approve` par demande. Avant d'enfiler, chaque demande passe « en file d'acceptation » (heure de secours dans
 * 10 minutes, sans expiration, marque `source.approveAll`). Kevin : `asOf` = maintenant, `expected` = le nombre
 * annoncé dans son aperçu.
 */
export const channelRequestsApproveAll: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  const channelId = ref?.id ?? "";
  if (!channelId) return fail("Canal introuvable.", "not_found");
  const now = new Date();
  const get = (name: string) => (input[name] === undefined || input[name] === null ? null : String(input[name]));
  const { filter, asOf, expected } = parseApproveAllForm(get, now);
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      title: true,
      isActive: true,
      // Un bot qui peut accepter : actif et normal, jamais un assistant de conversation (phase 17).
      botAdmins: { where: { revokedAt: null, bot: ACTIVE_CHANNEL_BOT_WHERE }, select: { botId: true }, take: 1 },
    },
  });
  if (!channel) return fail("Canal introuvable.", "not_found");
  if (!channel.isActive)
    return fail("Ce canal est désactivé : réactivez-le dans « Réglages du canal » pour que les demandes soient acceptées.", "conflict");
  if (channel.botAdmins.length === 0)
    return fail("Aucun de nos bots n'est administrateur de ce canal : les demandes ne peuvent pas être acceptées.", "unavailable");
  const statuses = requestFilterStatuses(filter);
  const rows = await prisma.membership.findMany({
    where: { channelId, status: { in: statuses }, requestedAt: { lte: asOf } },
    orderBy: { requestedAt: "asc" },
    select: { id: true, status: true },
  });
  if (approveAllListGrew(rows.length, expected)) return fail(APPROVE_ALL_LIST_CHANGED, "conflict");
  if (opts.dryRun)
    return {
      ok: true,
      message: `Accepter ${rows.length} demande${rows.length > 1 ? "s" : ""} en attente dans « ${channel.title} ».`,
      preview: { summary: `Accepter ${rows.length} demande${rows.length > 1 ? "s" : ""} en attente dans « ${channel.title} ».`, recipients: rows.length },
      data: { expected: rows.length, asOf: now.toISOString(), filter },
    };
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const ids = rows.map((r) => r.id);
  // En file d'acceptation, en une seule écriture : heure de secours, sans expiration, marque « Tout accepter » ;
  // seulement si elle est encore dans le filtre (acceptée ou refusée entre-temps : pas touchée, pas de tâche).
  const mark = approveAllMark(now, actor.userId ?? "");
  const queuedIds = ids.length ? await markForApproval(ids, statuses, mark) : [];
  const notQueued: string[] = [];
  for (let i = 0; i < queuedIds.length; i += APPROVE_ALL_ENQUEUE_CHUNK) {
    const chunk = queuedIds.slice(i, i + APPROVE_ALL_ENQUEUE_CHUNK);
    const results = await Promise.allSettled(
      chunk.map((membershipId) =>
        enqueue(
          "telegram-send",
          { type: "approve", membershipId, byUserId: actor.userId ?? undefined },
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
    await prisma.membership.updateMany({ where: { id: { in: notQueued }, status: "SCHEDULED" }, data: { approveAt: now } });
  await audit({
    userId: actor.userId,
    action: "membership.approve_all",
    entityType: "Channel",
    entityId: channelId,
    metadata: {
      channelId,
      filter,
      count: queuedIds.length,
      byStatus,
      queued: queuedIds.length - notQueued.length,
      asOf: asOf.toISOString(),
      membershipIds: ids.slice(0, 500),
      ...viaMeta(actor),
    },
  });
  return ok(approveAllDone(queuedIds.length), { channelId, count: queuedIds.length, filter });
};

/**
 * Met en file d'acceptation les demandes encore dans le filtre (une seule requête, atomique). Renvoie les demandes
 * modifiées (les autres ont changé entre-temps : aucune tâche pour elles). Heures écrites en UTC comme Prisma.
 */
async function markForApproval(ids: string[], statuses: string[], mark: ReturnType<typeof approveAllMark>): Promise<string[]> {
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

/**
 * Enfile un recalcul immédiat des meilleurs horaires (tous canaux ; tâche `stats` du worker). Les meilleurs créneaux
 * sont montrés dans le calendrier des messages.
 */
export const channelBestHoursRecompute: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  const channelId = ref?.id ?? "";
  if (opts.dryRun) return preview({ summary: "Recalcul des meilleurs créneaux de publication (tous les canaux)." });
  try {
    await enqueue("stats", { type: "best-hours" }, { jobId: `best-hours:${Math.floor(Date.now() / 60_000)}` });
  } catch {
    return fail("Recalcul impossible pour l'instant (file d'attente indisponible). Réessayez dans une minute.", "unavailable");
  }
  await audit({
    userId: actor.userId,
    action: "stats.best_hours_requested",
    entityType: "Channel",
    entityId: channelId,
    metadata: viaMeta(actor),
  });
  return ok("Recalcul des meilleurs créneaux lancé : rechargez cette page dans une minute pour les voir à jour.", { channelId });
};
