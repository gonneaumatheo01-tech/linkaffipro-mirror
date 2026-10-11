"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  AUTOMATION_TRIGGERS,
  isAutomationTemplateKey,
  validateTelegramHtml,
  type AutomationAction,
  type AutomationTriggerKey,
} from "@linkaffipro/core";
import { prisma, audit, toJsonValue, Prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { requireAdmin, requireUser, type CurrentUser } from "@/lib/session";
import { buildCardRule, CardInputError, cardSettingsFromForm } from "@/lib/automations/cards";
import { actionsFromForm, conditionsFromForm } from "@/lib/automations/form";
import { assertRuleOfferButtons } from "@/lib/automations/offer-buttons";
import {
  pendingStepRemap,
  readEditorRule,
  storageFor,
  templateKeyAfterEdit,
} from "@/lib/automations/rule-input";

/** Retour d'une action appelée depuis un écran client : l'erreur s'affiche sur place (le succès redirige). */
export type SaveResult = { ok: false; error: string };

const LIST = "/members/automations";

function back(path: string, params: Record<string, string>, hash = ""): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}${hash}`);
}
const isRedirect = (err: unknown) =>
  (err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT");
const message = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

/** Page où revenir après une action : la liste des cartes (`back=list`) ou la fiche de la relance. */
function returnPath(fd: FormData, id: string): string {
  return fd.get("back") === "list" ? LIST : `${LIST}/${id}`;
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
 */
async function persistRule(
  fd: FormData,
  user: CurrentUser,
): Promise<{ id: string; created: boolean; moved: number }> {
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

  if (previous) {
    const moved = await updateRule(previous.id, data, previous, {
      graph: form === "graph" ? data.graph : null,
      actions: savedActions,
    });
    await audit({
      userId: user.id,
      action: "automation.updated",
      entityType: "AutomationRule",
      entityId: previous.id,
      metadata: { form, templateKey: data.templateKey, ...(moved ? { pendingMoved: moved } : {}) },
    });
    return { id: previous.id, created: false, moved };
  }
  const rule = await prisma.automationRule.create({
    data: { ...data, isActive: false, createdById: user.id },
  });
  await audit({
    userId: user.id,
    action: "automation.created",
    entityType: "AutomationRule",
    entityId: rule.id,
    metadata: { name: data.name, trigger: data.trigger, form, templateKey: data.templateKey },
  });
  return { id: rule.id, created: true, moved: 0 };
}

const SAVED_NEW = "Relance créée, pour l'instant désactivée. Testez-la sur vous, puis activez-la.";
const SAVED = "Relance enregistrée.";

/** Création depuis un formulaire (redirige ; en cas d'erreur, revient sur la création avec le message). */
export async function createRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  formData.delete("ruleId");
  let id = "";
  try {
    id = (await persistRule(formData, user)).id;
  } catch (err) {
    if (isRedirect(err)) throw err;
    back(`${LIST}/new`, { error: message(err, "Création impossible.") });
  }
  revalidatePath(LIST);
  back(`${LIST}/${id}`, { ok: SAVED_NEW });
}

/** Modification depuis un formulaire (redirige ; en cas d'erreur, revient sur la modification avec le message). */
export async function updateRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("ruleId"));
  let moved = 0;
  try {
    moved = (await persistRule(formData, user)).moved;
  } catch (err) {
    if (isRedirect(err)) throw err;
    back(`${LIST}/${id}/edit`, { error: message(err, "Enregistrement impossible.") });
  }
  revalidatePath(LIST);
  back(`${LIST}/${id}`, { ok: SAVED + movedText(moved) });
}

/**
 * Enregistrement depuis l'éditeur à branches (création ou modification) : en cas d'erreur, renvoie le message sans
 * quitter l'éditeur (rien n'est perdu) ; en cas de succès, ouvre la fiche de la relance.
 */
export async function saveRuleAction(formData: FormData): Promise<SaveResult> {
  const user = await requireUser();
  let saved: { id: string; created: boolean; moved: number };
  try {
    saved = await persistRule(formData, user);
  } catch (err) {
    if (isRedirect(err)) throw err;
    return { ok: false, error: message(err, "Enregistrement impossible.") };
  }
  revalidatePath(LIST);
  back(`${LIST}/${saved.id}`, { ok: saved.created ? SAVED_NEW : SAVED + movedText(saved.moved) });
}

/**
 * Enregistre les réglages d'une carte prête à l'emploi (`templateKey`, `ruleId` facultatif) : la première fois, la
 * relance est créée désactivée ; ensuite, seule sa forme change (nom, interrupteur et « une fois par membre »
 * conservés). Erreur de saisie : renvoyée au volet. Succès : retour aux cartes.
 */
export async function saveCardAction(formData: FormData): Promise<SaveResult> {
  const user = await requireUser();
  const key = String(formData.get("templateKey") ?? "");
  if (!isAutomationTemplateKey(key))
    return { ok: false, error: "Relance prête à l'emploi inconnue." };
  const ruleId = String(formData.get("ruleId") ?? "").trim() || null;
  let created = false;
  let active = false;
  let moved = 0;
  try {
    const settings = cardSettingsFromForm(key, formData);
    const existing = ruleId
      ? await prisma.automationRule.findUnique({
          where: { id: ruleId },
          select: { id: true, graph: true, actions: true, isActive: true },
        })
      : null;
    if (ruleId && !existing)
      return { ok: false, error: "Relance introuvable : elle a peut-être été supprimée." };
    const built = buildCardRule(key, settings, existing);
    // Bouton « Offre (campagne) » : campagne et offre vérifiées avant toute écriture.
    await assertRuleOfferButtons(built);
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
        userId: user.id,
        action: "automation.updated",
        entityType: "AutomationRule",
        entityId: existing.id,
        metadata: {
          templateKey: key,
          form: built.graph ? "graph" : "list",
          ...(moved ? { pendingMoved: moved } : {}),
        },
      });
    } else {
      const rule = await prisma.automationRule.create({
        data: {
          ...data,
          name: built.name,
          isActive: false,
          oncePerMember: true,
          createdById: user.id,
        },
      });
      created = true;
      await audit({
        userId: user.id,
        action: "automation.created",
        entityType: "AutomationRule",
        entityId: rule.id,
        metadata: { name: built.name, trigger: built.trigger, templateKey: key },
      });
    }
  } catch (err) {
    if (isRedirect(err)) throw err;
    return {
      ok: false,
      error:
        err instanceof CardInputError ? err.message : message(err, "Enregistrement impossible."),
    };
  }
  revalidatePath(LIST);
  back(
    LIST,
    {
      ok: created
        ? "Relance enregistrée, pour l'instant désactivée. Testez-la sur vous, puis activez-la."
        : (active
            ? "Relance enregistrée : les prochains membres concernés recevront cette version."
            : "Relance enregistrée.") + movedText(moved),
    },
    `#carte-${key}`,
  );
}

/** Interrupteur Activé / Désactivé (ADMIN et MANAGER). `back=list` : retour aux cartes. */
export async function toggleRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("ruleId"));
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id } });
  await prisma.automationRule.update({ where: { id }, data: { isActive: !rule.isActive } });
  await audit({
    userId: user.id,
    action: rule.isActive ? "automation.deactivated" : "automation.activated",
    entityType: "AutomationRule",
    entityId: id,
  });
  revalidatePath(LIST);
  const key = isAutomationTemplateKey(rule.templateKey) ? `#carte-${rule.templateKey}` : "";
  back(
    returnPath(formData, id),
    {
      ok: rule.isActive
        ? "Relance désactivée : plus aucun membre ne la recevra."
        : "Relance activée : elle partira automatiquement vers les membres concernés.",
    },
    formData.get("back") === "list" ? key : "",
  );
}

export async function duplicateRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("ruleId"));
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id } });
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
      createdById: user.id,
    },
  });
  await audit({
    userId: user.id,
    action: "automation.duplicated",
    entityType: "AutomationRule",
    entityId: copy.id,
    metadata: { from: id },
  });
  revalidatePath(LIST);
  back(`${LIST}/${copy.id}/edit`, {
    ok: "Copie créée, désactivée : adaptez-la puis enregistrez.",
  });
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("ruleId"));
  await prisma.automationRule.delete({ where: { id } });
  await audit({
    userId: admin.id,
    action: "automation.deleted",
    entityType: "AutomationRule",
    entityId: id,
  });
  revalidatePath(LIST);
  back(LIST, { ok: "Relance supprimée." });
}

/**
 * Exécute la relance pour le membre Telegram lié à l'utilisateur connecté (sans étiquette, messages de test ; un
 * parcours à branches passe ses attentes). `back=list` : retour aux cartes, sinon fiche de la relance.
 */
export async function testRuleOnMeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("ruleId"));
  const to = returnPath(formData, id);
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { telegramUserId: true },
  });
  if (!me?.telegramUserId)
    back(to, {
      error: "Liez d'abord votre compte Telegram dans « Mon compte » (menu en haut à droite).",
    });
  const member = await prisma.member.findUnique({
    where: { telegramUserId: me.telegramUserId },
    select: { id: true },
  });
  if (!member)
    back(to, {
      error:
        "Envoyez d'abord /start à l'un de nos bots depuis votre compte Telegram, puis réessayez.",
    });
  try {
    await enqueue(
      "automations",
      { type: "test", ruleId: id, memberId: member.id },
      { jobId: `automation-test-${id}-${Date.now()}` },
    );
  } catch (err) {
    back(to, {
      error: `Impossible de lancer le test pour le moment (${err instanceof Error ? err.message : "erreur inconnue"}). Réessayez dans une minute.`,
    });
  }
  await audit({
    userId: user.id,
    action: "automation.tested",
    entityType: "AutomationRule",
    entityId: id,
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
  back(to, {
    ok: linearWait
      ? `Test lancé : la relance attend le délai prévu avant de vous écrire, comme pour un membre ; ${where}.`
      : `Test lancé : vous recevrez le message sur Telegram dans quelques secondes ; ${where}.`,
  });
}
