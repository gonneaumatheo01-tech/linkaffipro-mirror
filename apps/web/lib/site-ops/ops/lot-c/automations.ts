/**
 * Phase 34, lot C : cœurs de « Membres → Relances automatiques » (`app/(admin)/members/automations/actions.ts`) :
 * enregistrer (éditeur à branches ou ancien formulaire), cartes prêtes à l'emploi, activer / désactiver, dupliquer,
 * supprimer (ADMIN), « Tester sur moi ». Une relance active écrit à des membres : son activation passe par l'aperçu
 * exact du premier message (essai à blanc).
 */
import { revalidatePath } from "next/cache";
import {
  AUTOMATION_TRIGGERS,
  isAutomationTemplateKey,
  validateTelegramHtml,
  type AutomationAction,
  type AutomationTriggerKey,
} from "@linkaffipro/core";
import { prisma, audit, toJsonValue, Prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import type { SiteOpActor } from "@linkaffipro/agents";
import { markCustomEmojisUsed } from "@/lib/custom-emoji/usage";
import {
  buildCardRule,
  CardInputError,
  cardSettingsFromForm,
  defaultCardSettings,
  readCardSettings,
  type CardKey,
} from "@/lib/automations/cards";
import { actionsFromForm, conditionsFromForm } from "@/lib/automations/form";
import { assertRuleOfferButtons } from "@/lib/automations/offer-buttons";
import {
  pendingStepRemap,
  readEditorRule,
  storageFor,
  templateKeyAfterEdit,
} from "@/lib/automations/rule-input";
import {
  ADMIN_ONLY,
  doneTo,
  fail,
  failTo,
  forbidden,
  isPartial,
  preview,
  str,
  toFormData,
  withVia,
  type Core,
  type CoreResult,
} from "./common";
import { channelCandidates, resolveInto, resolveManyInto, ruleCandidates, botCandidates } from "./resolve";

const LIST = "/members/automations";

const message = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

/** Page où revenir après une action : la liste des cartes (`back=list`) ou la fiche de la relance. */
function returnPath(input: Record<string, unknown>, id: string): string {
  return input.back === "list" ? LIST : `${LIST}/${id}`;
}

/**
 * Met à jour une relance et, si une relance à liste perd sa seule attente (`pendingStepRemap`), décale dans la même
 * transaction les membres en attente vers l'étape qui suit : ils reçoivent la suite à l'heure prévue au lieu de rien.
 * Renvoie le nombre d'exécutions décalées.
 */
async function updateRule(
  id: string,
  data: Prisma.AutomationRuleUpdateInput,
  previous: { graph: unknown; actions: unknown },
  next: { graph: unknown; actions: AutomationAction[] },
): Promise<number> {
  const wasList = previous.graph === null || previous.graph === undefined;
  const isList = next.graph === null || next.graph === undefined;
  const remap = wasList && isList ? pendingStepRemap(previous.actions, next.actions) : null;
  const update = prisma.automationRule.update({ where: { id }, data });
  if (!remap) {
    await update;
    return 0;
  }
  const [, moved] = await prisma.$transaction([
    update,
    prisma.automationRun.updateMany({
      where: { ruleId: id, status: "PENDING", step: remap.from },
      data: { step: remap.to },
    }),
  ]);
  return moved.count;
}

/** Textes d'une relance (liste d'actions ou parcours) qui contiennent des emojis animés (phase 12). */
function emojiTexts(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.includes("<tg-emoji")) out.push(value);
  } else if (Array.isArray(value)) for (const v of value) emojiTexts(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value as Record<string, unknown>)) emojiTexts(v, out);
  return out;
}

/** Premier texte envoyé par une relance (liste d'actions ou parcours) : aperçu exact avant activation. */
function firstMessageText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = firstMessageText(v);
      if (t) return t;
    }
    return null;
  }
  const o = value as Record<string, unknown>;
  if (o.type === "send_message" && typeof o.text === "string") return o.text;
  if (o.message && typeof o.message === "object" && typeof (o.message as { text?: unknown }).text === "string")
    return (o.message as { text: string }).text;
  for (const v of Object.values(o)) {
    const t = firstMessageText(v);
    if (t) return t;
  }
  return null;
}

const movedText = (n: number) =>
  n > 0
    ? ` ${n} membre${n > 1 ? "s" : ""} en attente recevr${n > 1 ? "ont" : "a"} le message à l'heure prévue.`
    : "";

/** Relance à liste d'actions envoyée par l'ancien formulaire (champs `a<i>_*`), conservée pour compatibilité. */
function readListRule(fd: FormData) {
  const name = String(fd.get("name") ?? "").trim();
  if (name.length < 2) throw new Error("Donnez un nom à la relance (2 caractères au moins).");
  const trigger = String(fd.get("trigger") ?? "");
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger))
    throw new Error("Choisissez ce qui lance la relance dans la liste.");
  const conditions = conditionsFromForm(fd);
  if (trigger === "INACTIVE" && !conditions.inactiveDays)
    throw new Error("Indiquez après combien de jours sans activité la relance part.");
  const actions = actionsFromForm(fd);
  for (const a of actions) {
    const text = "text" in a ? a.text : undefined;
    if (text) {
      const v = validateTelegramHtml(text);
      if (!v.ok) throw new Error(`Texte à corriger : ${v.error}`);
    }
  }
  return {
    name,
    trigger: trigger as AutomationTriggerKey,
    conditions,
    actions,
    oncePerMember: fd.get("oncePerMember") === "on",
  };
}

/**
 * Enregistre une relance (création si pas de `ruleId`, toujours inactive ; sinon modification). Deux formats :
 * - éditeur à branches : champ `graph` (JSON du parcours, validé par `parseGraph`) + `conditions` (JSON) ;
 * - ancien formulaire à liste : champs `a<i>_*`.
 * Une relance à liste qui reste une simple chaîne reste une liste ; sinon le parcours est enregistré (`graph`) et
 * `actions` reçoit la liste équivalente quand c'est une chaîne (compatibilité). La carte d'origine (`templateKey`) est
 * gardée tant que la relance en a la forme. Mêmes droits qu'avant : ADMIN et MANAGER.
 * `dryRun` : tout est vérifié (parcours, textes, boutons Offre), rien n'est écrit.
 */
async function persistRule(
  fd: FormData,
  actor: SiteOpActor,
  dryRun = false,
): Promise<{ id: string; created: boolean; moved: number; name: string }> {
  const ruleId = String(fd.get("ruleId") ?? "").trim() || null;
  const previous = ruleId
    ? await prisma.automationRule.findUnique({
        where: { id: ruleId },
        select: { id: true, graph: true, actions: true, templateKey: true },
      })
    : null;
  if (ruleId && !previous) throw new Error("Relance introuvable : elle a peut-être été supprimée.");

  let data: {
    name: string;
    trigger: AutomationTriggerKey;
    conditions: Prisma.InputJsonValue;
    actions: Prisma.InputJsonValue;
    graph: Prisma.InputJsonValue | typeof Prisma.DbNull;
    templateKey: string | null;
    oncePerMember: boolean;
  };
  let form: "graph" | "list";
  let savedActions: AutomationAction[];
  if (fd.has("graph")) {
    const r = readEditorRule(fd);
    const stored = storageFor(r.graph, previous);
    const templateKey = templateKeyAfterEdit(previous ? previous.templateKey : r.templateKey, {
      trigger: r.trigger,
      conditions: r.conditions,
      actions: stored.actions,
      graph: stored.graph,
    });
    data = {
      name: r.name,
      trigger: r.trigger,
      conditions: toJsonValue(r.conditions),
      actions: toJsonValue(stored.actions),
      graph: stored.graph ? toJsonValue(stored.graph) : Prisma.DbNull,
      templateKey,
      oncePerMember: r.oncePerMember,
    };
    form = stored.graph ? "graph" : "list";
    savedActions = stored.actions;
    // Boutons « Offre (campagne) » : campagne et offre vérifiées avant toute écriture.
    await assertRuleOfferButtons({ actions: stored.actions, graph: stored.graph ?? r.graph });
  } else {
    const r = readListRule(fd);
    data = {
      name: r.name,
      trigger: r.trigger,
      conditions: toJsonValue(r.conditions),
      actions: toJsonValue(r.actions),
      graph: Prisma.DbNull,
      templateKey: templateKeyAfterEdit(previous?.templateKey, { ...r, graph: null }),
      oncePerMember: r.oncePerMember,
    };
    form = "list";
    savedActions = r.actions;
    await assertRuleOfferButtons({ actions: r.actions, graph: null });
  }
  if (dryRun) return { id: previous?.id ?? "", created: !previous, moved: 0, name: data.name };

  // Emojis animés des messages : « Récents de l'équipe » dans le sélecteur.
  const usedTexts = emojiTexts([data.actions, form === "graph" ? data.graph : null]);
  if (previous) {
    const moved = await updateRule(previous.id, data, previous, {
      graph: form === "graph" ? data.graph : null,
      actions: savedActions,
    });
    await audit({
      userId: actor.userId,
      action: "automation.updated",
      entityType: "AutomationRule",
      entityId: previous.id,
      metadata: withVia(actor, {
        form,
        templateKey: data.templateKey,
        ...(moved ? { pendingMoved: moved } : {}),
      }),
    });
    await markCustomEmojisUsed(usedTexts);
    return { id: previous.id, created: false, moved, name: data.name };
  }
  const rule = await prisma.automationRule.create({
    data: { ...data, isActive: false, createdById: actor.userId },
  });
  await audit({
    userId: actor.userId,
    action: "automation.created",
    entityType: "AutomationRule",
    entityId: rule.id,
    metadata: withVia(actor, { name: data.name, trigger: data.trigger, form, templateKey: data.templateKey }),
  });
  await markCustomEmojisUsed(usedTexts);
  return { id: rule.id, created: true, moved: 0, name: data.name };
}

export const SAVED_NEW = "Relance créée, pour l'instant désactivée. Testez-la sur vous, puis activez-la.";
const SAVED = "Relance enregistrée.";

/** Relance donnée par son nom (Kevin) → `ruleId`. */
async function withRule(input: Record<string, unknown>): Promise<CoreResult | null> {
  const r = await resolveInto(input, "ruleId", "rule", "la relance", ruleCandidates);
  return r.ok ? null : fail(r.error, null, { code: r.code });
}

/**
 * Enregistrement (création si pas de `ruleId`, sinon modification). `onError` : où le site revient en cas d'erreur
 * (création, modification, ou rien pour l'éditeur à branches qui affiche l'erreur sur place).
 */
export function saveRuleCore(mode: "create" | "update" | "editor"): Core {
  return async (raw, actor, opts = {}) => {
    const input = { ...raw };
    const rr = await withRule(input);
    if (rr) return rr;
    if (mode === "create") delete input.ruleId;
    const id = str(input.ruleId);
    const errorPath = mode === "create" ? `${LIST}/new` : mode === "update" ? `${LIST}/${id}/edit` : null;
    let saved: { id: string; created: boolean; moved: number; name: string };
    try {
      saved = await persistRule(toFormData(input), actor, !!opts.dryRun);
    } catch (err) {
      const e = message(err, mode === "create" ? "Création impossible." : "Enregistrement impossible.");
      return errorPath ? failTo(errorPath, e) : fail(e);
    }
    if (opts.dryRun)
      return preview(
        saved.created
          ? `Nouvelle relance « ${saved.name} », créée désactivée.`
          : `Relance « ${saved.name} » modifiée (même interrupteur qu'avant).`,
      );
    revalidatePath(LIST);
    return doneTo(
      `${LIST}/${saved.id}`,
      saved.created ? SAVED_NEW : SAVED + movedText(saved.moved),
      {},
      { ruleId: saved.id },
    );
  };
}

/**
 * Kevin : « change le message de bienvenue », « relance les inscrits sans dépôt après 2 jours » → champs du volet de
 * la carte. Sans `ruleId`, la relance de la carte (même `templateKey`) est reprise si elle existe ; les réglages non
 * dits gardent leur valeur (ou celle par défaut de la carte).
 */
async function cardFormFromWords(input: Record<string, unknown>, key: CardKey): Promise<CoreResult | null> {
  const ch = await resolveManyInto(input, "channelIds", "channels", "le canal", channelCandidates);
  if (!ch.ok) return fail(ch.error, null, { code: ch.code });
  const b = await resolveInto(input, "botId", "bot", "le bot", botCandidates);
  if (!b.ok) return fail(b.error, null, { code: b.code });
  if (!str(input.ruleId)) {
    const existing = await prisma.automationRule.findFirst({
      where: { templateKey: key },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (existing) input.ruleId = existing.id;
  }
  const rule = str(input.ruleId)
    ? await prisma.automationRule.findUnique({
        where: { id: str(input.ruleId) },
        select: { trigger: true, conditions: true, actions: true, graph: true, templateKey: true },
      })
    : null;
  const s = (rule && readCardSettings(key, rule)) || defaultCardSettings(key);
  if (input.text === undefined) input.text = s.message.text;
  if (input.delay === undefined) input.delay = s.hours === null ? "now" : String(s.hours);
  if (typeof input.delay === "number") input.delay = String(input.delay);
  if (input.inactiveDays === undefined && s.inactiveDays !== null) input.inactiveDays = String(s.inactiveDays);
  if (input.level === undefined && s.level) input.level = s.level;
  if (input.channelIds === undefined) input.channelIds = s.channelIds;
  if (input.botId === undefined && s.message.botId) input.botId = s.message.botId;
  if (input.mediaAssetId === undefined && s.message.mediaAssetId) input.mediaAssetId = s.message.mediaAssetId;
  if (input.buttonsJson === undefined && input.buttons === undefined && s.message.buttons?.length)
    input.buttonsJson = JSON.stringify(s.message.buttons.flat());
  return null;
}

/**
 * Enregistre les réglages d'une carte prête à l'emploi (`templateKey`, `ruleId` facultatif) : la première fois, la
 * relance est créée désactivée ; ensuite, seule sa forme change (nom, interrupteur et « une fois par membre »
 * conservés). Erreur de saisie : renvoyée au volet. Succès : retour aux cartes.
 */
export const saveCard: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const key = str(input.templateKey);
  if (!isAutomationTemplateKey(key)) return fail("Relance prête à l'emploi inconnue.", null, { field: "templateKey" });
  if (isPartial(actor)) {
    const r = await cardFormFromWords(input, key);
    if (r) return r;
  }
  const formData = toFormData(input);
  const ruleId = str(input.ruleId).trim() || null;
  let created = false;
  let active = false;
  let moved = 0;
  let newId: string | null = ruleId;
  try {
    const settings = cardSettingsFromForm(key, formData);
    const existing = ruleId
      ? await prisma.automationRule.findUnique({
          where: { id: ruleId },
          select: { id: true, graph: true, actions: true, isActive: true },
        })
      : null;
    if (ruleId && !existing)
      return fail("Relance introuvable : elle a peut-être été supprimée.", null, { code: "not_found" });
    const built = buildCardRule(key, settings, existing);
    // Bouton « Offre (campagne) » : campagne et offre vérifiées avant toute écriture.
    await assertRuleOfferButtons(built);
    if (opts.dryRun) {
      const live = existing?.isActive ?? false;
      return preview(
        `${existing ? "Relance modifiée" : "Relance créée, désactivée"} (« ${built.name} »).${live ? " Elle est active : les prochains membres concernés recevront ce message." : ""}`,
        live ? { exactText: settings.message.text, recipients: null } : {},
      );
    }
    const data = {
      trigger: built.trigger,
      conditions: toJsonValue(built.conditions),
      actions: toJsonValue(built.actions),
      graph: built.graph ? toJsonValue(built.graph) : Prisma.DbNull,
      templateKey: built.templateKey,
    };
    if (existing) {
      active = existing.isActive;
      moved = await updateRule(existing.id, data, existing, built);
      await audit({
        userId: actor.userId,
        action: "automation.updated",
        entityType: "AutomationRule",
        entityId: existing.id,
        metadata: withVia(actor, {
          templateKey: key,
          form: built.graph ? "graph" : "list",
          ...(moved ? { pendingMoved: moved } : {}),
        }),
      });
    } else {
      const rule = await prisma.automationRule.create({
        data: {
          ...data,
          name: built.name,
          isActive: false,
          oncePerMember: true,
          createdById: actor.userId,
        },
      });
      created = true;
      newId = rule.id;
      await audit({
        userId: actor.userId,
        action: "automation.created",
        entityType: "AutomationRule",
        entityId: rule.id,
        metadata: withVia(actor, { name: built.name, trigger: built.trigger, templateKey: key }),
      });
    }
    await markCustomEmojisUsed(emojiTexts([built.actions, built.graph]));
  } catch (err) {
    return fail(err instanceof CardInputError ? err.message : message(err, "Enregistrement impossible."));
  }
  revalidatePath(LIST);
  return doneTo(
    LIST,
    created
      ? "Relance enregistrée, pour l'instant désactivée. Testez-la sur vous, puis activez-la."
      : (active
          ? "Relance enregistrée : les prochains membres concernés recevront cette version."
          : "Relance enregistrée.") + movedText(moved),
    {},
    { ruleId: newId },
    `#carte-${key}`,
  );
};

const ruleNotFound = () => failTo(LIST, "Relance introuvable : elle a peut-être été supprimée.", {}, { code: "not_found" });

/** Relance par son nom, ou la relance d'une carte (`templateKey`, Kevin : « la relance de bienvenue »). */
async function loadRule(input: Record<string, unknown>) {
  const rr = await withRule(input);
  if (rr) return rr;
  if (!str(input.ruleId) && isAutomationTemplateKey(str(input.templateKey))) {
    const r = await prisma.automationRule.findFirst({
      where: { templateKey: str(input.templateKey) },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (r) input.ruleId = r.id;
  }
  const id = str(input.ruleId).trim();
  const rule = id ? await prisma.automationRule.findUniqueOrThrow({ where: { id } }).catch(() => null) : null;
  return rule ?? ruleNotFound();
}

/**
 * Interrupteur Activé / Désactivé (ADMIN et MANAGER). `back=list` : retour aux cartes. Kevin : `active` dit l'état
 * voulu ; activer écrit à des membres → aperçu exact du premier message avant le OUI.
 */
export const toggleRule: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const rule = await loadRule(input);
  if ("ok" in rule) return rule;
  const id = rule.id;
  if (typeof input.active === "boolean" && input.active === rule.isActive)
    return doneTo(returnPath(input, id), `La relance « ${rule.name} » est déjà ${rule.isActive ? "activée" : "désactivée"}.`);
  if (opts.dryRun) {
    if (rule.isActive) return preview(`Relance « ${rule.name} » désactivée : plus aucun membre ne la recevra.`);
    const text = firstMessageText(rule.graph ?? rule.actions);
    return preview(
      `Relance « ${rule.name} » activée : elle partira automatiquement vers les membres concernés (une fois par membre : ${rule.oncePerMember ? "oui" : "non"}). Les repères comme {prenom} sont remplacés pour chaque membre.`,
      { exactText: text, recipients: null },
    );
  }
  await prisma.automationRule.update({ where: { id }, data: { isActive: !rule.isActive } });
  await audit({
    userId: actor.userId,
    action: rule.isActive ? "automation.deactivated" : "automation.activated",
    entityType: "AutomationRule",
    entityId: id,
    metadata: withVia(actor),
  });
  revalidatePath(LIST);
  const key = isAutomationTemplateKey(rule.templateKey) ? `#carte-${rule.templateKey}` : "";
  return doneTo(
    returnPath(input, id),
    rule.isActive
      ? "Relance désactivée : plus aucun membre ne la recevra."
      : "Relance activée : elle partira automatiquement vers les membres concernés.",
    {},
    undefined,
    input.back === "list" ? key : "",
  );
};

export const duplicateRule: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const rule = await loadRule(input);
  if ("ok" in rule) return rule;
  if (opts.dryRun) return preview(`Copie désactivée de la relance « ${rule.name} ».`);
  const copy = await prisma.automationRule.create({
    data: {
      name: `${rule.name} (copie)`,
      trigger: rule.trigger,
      conditions: rule.conditions as object,
      actions: rule.actions as object,
      graph: rule.graph === null ? Prisma.DbNull : (rule.graph as object),
      // La copie est une relance sur mesure : la carte garde sa propre relance.
      templateKey: null,
      oncePerMember: rule.oncePerMember,
      isActive: false,
      createdById: actor.userId,
    },
  });
  await audit({
    userId: actor.userId,
    action: "automation.duplicated",
    entityType: "AutomationRule",
    entityId: copy.id,
    metadata: withVia(actor, { from: rule.id }),
  });
  revalidatePath(LIST);
  return doneTo(`${LIST}/${copy.id}/edit`, "Copie créée, désactivée : adaptez-la puis enregistrez.", {}, {
    ruleId: copy.id,
  });
};

export const deleteRule: Core = async (raw, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY);
  const input = { ...raw };
  const rr = await withRule(input);
  if (rr) return rr;
  const id = str(input.ruleId).trim();
  if (!id) return ruleNotFound();
  if (opts.dryRun) {
    const rule = await prisma.automationRule.findUnique({ where: { id }, select: { name: true, isActive: true } });
    if (!rule) return ruleNotFound();
    return preview(`Suppression de la relance « ${rule.name} »${rule.isActive ? " (active)" : ""}.`, {
      impact: "Elle ne partira plus vers personne ; les messages déjà envoyés restent dans les statistiques.",
    });
  }
  await prisma.automationRule.delete({ where: { id } });
  await audit({
    userId: actor.userId,
    action: "automation.deleted",
    entityType: "AutomationRule",
    entityId: id,
    metadata: withVia(actor),
  });
  revalidatePath(LIST);
  return doneTo(LIST, "Relance supprimée.");
};

/**
 * Exécute la relance pour le membre Telegram de la personne qui demande (site : compte lié à l'utilisateur ; Kevin :
 * son Telegram) — sans étiquette, messages de test ; un parcours à branches passe ses attentes. `back=list` : retour
 * aux cartes, sinon fiche de la relance.
 */
export const testRuleOnMe: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const rr = await withRule(input);
  if (rr) return rr;
  const id = str(input.ruleId).trim();
  if (!id) return ruleNotFound();
  const to = returnPath(input, id);
  let telegramUserId: bigint | null = null;
  if (actor.via === "WEB" && actor.userId) {
    const me = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { telegramUserId: true },
    });
    telegramUserId = me?.telegramUserId ?? null;
  } else if (/^\d+$/.test(str(actor.telegramUserId))) telegramUserId = BigInt(str(actor.telegramUserId));
  if (!telegramUserId)
    return failTo(to, "Liez d'abord votre compte Telegram dans « Mon compte » (menu en haut à droite).");
  const member = await prisma.member.findUnique({
    where: { telegramUserId },
    select: { id: true },
  });
  if (!member)
    return failTo(
      to,
      "Envoyez d'abord /start à l'un de nos bots depuis votre compte Telegram, puis réessayez.",
    );
  if (opts.dryRun) return preview("La relance sera jouée pour vous seul, en messages de test.", { recipients: 1 });
  try {
    await enqueue(
      "automations",
      { type: "test", ruleId: id, memberId: member.id },
      { jobId: `automation-test-${id}-${Date.now()}` },
    );
  } catch (err) {
    return failTo(
      to,
      `Impossible de lancer le test pour le moment (${err instanceof Error ? err.message : "erreur inconnue"}). Réessayez dans une minute.`,
      {},
      { code: "unavailable" },
    );
  }
  await audit({
    userId: actor.userId,
    action: "automation.tested",
    entityType: "AutomationRule",
    entityId: id,
    metadata: withVia(actor),
  });
  // Un parcours à branches passe ses attentes en test ; une liste d'actions les respecte (comportement du moteur).
  const rule = await prisma.automationRule.findUnique({
    where: { id },
    select: { graph: true, actions: true },
  });
  const linearWait =
    !!rule &&
    rule.graph === null &&
    Array.isArray(rule.actions) &&
    rule.actions.some((a) => (a as { type?: unknown } | null)?.type === "wait");
  const where =
    to === LIST
      ? "le détail est dans la fiche de la relance"
      : "le résultat apparaît dans le journal ci-dessous";
  return doneTo(
    to,
    linearWait
      ? `Test lancé : la relance attend le délai prévu avant de vous écrire, comme pour un membre ; ${where}.`
      : `Test lancé : vous recevrez le message sur Telegram dans quelques secondes ; ${where}.`,
  );
};
