/**
 * Phase 34, lot E — cœurs de Réglages → Alertes (alertes ouvertes, seuils et interrupteurs, conservation des données,
 * purge, vérification immédiate). Appelés par `app/(admin)/settings/alerts/actions.ts` et par Kevin. Administrateurs
 * seulement. Seuils de dépense existants : « dépense sans inscription » (une pub qui a coûté plus de X € sur 24 h sans
 * aucune inscription, `spendNoConversionEur`) ; il n'y a pas de seuil « dépense pub totale par jour » sur cette page.
 */
import { z } from "zod";
import { ALERT_KIND_LABELS, SWITCHABLE_ALERT_KINDS, parseAlertSwitches, type AlertSwitches } from "@linkaffipro/core";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import {
  ALERT_THRESHOLDS_KEY,
  alertSettingsValue,
  parseThresholds,
  thresholdsSavedMessage,
} from "@/app/(admin)/settings/alerts/thresholds";
import { adminOnly, fail, ok, preview, str, viaMeta, type CoreRun } from "./common";

/** Marque une alerte comme résolue. */
export const alertResolve: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const id = str(input.alertId).trim();
  if (!id) return fail("Alerte introuvable.", "not_found", "alertId");
  if (opts.dryRun) {
    const a = await prisma.alert.findUnique({ where: { id }, select: { id: true } });
    if (!a) return fail("Alerte introuvable.", "not_found");
    return preview({ summary: "L'alerte sera marquée comme résolue." });
  }
  await prisma.alert.update({ where: { id }, data: { resolvedAt: new Date() } });
  await audit({ userId: actor.userId, action: "alert.resolved", entityType: "Alert", entityId: id, metadata: viaMeta(actor) });
  return ok("Alerte marquée comme résolue.", { alertId: id });
};

/** Lecture : alertes ouvertes (pour que Kevin propose laquelle résoudre). */
export const alertsOpen: CoreRun = async (_input, actor) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const rows = await prisma.alert.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, kind: true, message: true, createdAt: true },
  });
  return ok(rows.length ? `${rows.length} alerte${rows.length > 1 ? "s" : ""} ouverte${rows.length > 1 ? "s" : ""}.` : "Aucune alerte ouverte.", {
    alerts: rows.map((r) => ({ id: r.id, kind: r.kind, message: r.message, createdAt: r.createdAt.toISOString() })),
  });
};

/** Enregistre la durée de conservation des données personnelles (mois, 6 à 120). */
export const retentionSave: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const parsed = z.coerce.number().int().min(6).max(120).safeParse(input.months);
  if (!parsed.success) return fail("La durée de conservation doit être un nombre de mois entre 6 et 120.", "invalid", "months");
  if (opts.dryRun) {
    const cur = await prisma.setting.findUnique({ where: { key: "retention.months" } });
    const before = typeof cur?.value === "number" ? cur.value : 24;
    return preview({
      summary: `Durée de conservation : ${parsed.data} mois (aujourd'hui ${before}).`,
      impact:
        parsed.data < before
          ? `À la prochaine purge de nuit, les membres inactifs depuis plus de ${parsed.data} mois seront anonymisés.`
          : null,
    });
  }
  await prisma.setting.upsert({
    where: { key: "retention.months" },
    create: { key: "retention.months", value: parsed.data },
    update: { value: parsed.data },
  });
  await audit({ userId: actor.userId, action: "settings.retention_changed", metadata: { months: parsed.data, ...viaMeta(actor) } });
  return ok(`Durée de conservation enregistrée : ${parsed.data} mois.`, { months: parsed.data });
};

const thresholdsSchema = z.object({
  registrationsDropPct: z.coerce.number().int().min(1).max(100),
  spendNoConversionEur: z.coerce.number().min(0).max(1_000_000),
  channelLeakPct: z.coerce.number().int().min(1).max(100),
});

/**
 * Interrupteurs : objet complet du formulaire du site (`enabled`), ou partiel pour Kevin (`{ spend_no_conversion: true }`)
 * fusionné avec l'état actuel.
 */
function switchesOf(raw: unknown, current: AlertSwitches): AlertSwitches {
  const out = { ...current };
  if (raw && typeof raw === "object" && !Array.isArray(raw))
    for (const kind of SWITCHABLE_ALERT_KINDS) {
      const v = (raw as Record<string, unknown>)[kind];
      if (typeof v === "boolean") out[kind] = v;
    }
  return out;
}

/**
 * Seuils et interrupteurs « Alerte activée » des alertes sur les chiffres, dans le même réglage sans perdre ses autres
 * clés. Kevin peut ne donner qu'un seuil : les autres gardent leur valeur actuelle.
 */
export const alertThresholdsSave: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const previous = await prisma.setting.findUnique({ where: { key: ALERT_THRESHOLDS_KEY } });
  const current = parseThresholds(previous?.value);
  const pick = (k: keyof typeof current) => (input[k] === undefined ? current[k] : input[k]);
  const parsed = thresholdsSchema.safeParse({
    registrationsDropPct: pick("registrationsDropPct"),
    spendNoConversionEur: str(pick("spendNoConversionEur")).replace(",", "."),
    channelLeakPct: pick("channelLeakPct"),
  });
  if (!parsed.success)
    return fail("Seuils invalides : les pourcentages vont de 1 à 100 et la dépense est un montant positif en euros.");
  const thresholds = parseThresholds(parsed.data);
  const enabled = switchesOf(input.enabled, parseAlertSwitches(previous?.value));
  if (opts.dryRun) {
    const changed = SWITCHABLE_ALERT_KINDS.filter((k) => enabled[k] !== parseAlertSwitches(previous?.value)[k]).map(
      (k) => `« ${ALERT_KIND_LABELS[k]} » ${enabled[k] ? "activée" : "désactivée"}`,
    );
    return preview({
      summary: `Alertes : chute des inscriptions ${thresholds.registrationsDropPct} %, dépense sans inscription ${thresholds.spendNoConversionEur} €, départs ${thresholds.channelLeakPct} %.${changed.length ? ` ${changed.join(", ")}.` : ""}`,
    });
  }
  const value = alertSettingsValue(previous?.value, thresholds, enabled);
  await prisma.setting.upsert({
    where: { key: ALERT_THRESHOLDS_KEY },
    create: { key: ALERT_THRESHOLDS_KEY, value: value as Prisma.InputJsonObject },
    update: { value: value as Prisma.InputJsonObject },
  });
  await audit({
    userId: actor.userId,
    action: "settings.alert_thresholds_updated",
    metadata: { ...thresholds, enabled, ...viaMeta(actor) },
  });
  return ok(thresholdsSavedMessage(thresholds, enabled), { ...thresholds, enabled });
};

/** Lance la purge de rétention maintenant (tâche du worker) : anonymise ce qui dépasse la durée de conservation. */
export const purgeNow: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  if (opts.dryRun) {
    const cur = await prisma.setting.findUnique({ where: { key: "retention.months" } });
    const months = typeof cur?.value === "number" ? cur.value : 24;
    return preview({
      summary: "Purge des données personnelles maintenant.",
      impact: `Les membres inactifs depuis plus de ${months} mois sont anonymisés et les anciens événements effacés (les statistiques restent).`,
    });
  }
  try {
    await enqueue("maintenance", { type: "purge" }, { jobId: `maintenance-purge-manual-${Date.now()}` });
    await audit({ userId: actor.userId, action: "maintenance.purge_requested", metadata: viaMeta(actor) });
  } catch (err) {
    return fail(
      `Impossible de lancer la purge pour le moment (${err instanceof Error ? err.message : "erreur"}). Réessayez dans une minute.`,
      "unavailable",
    );
  }
  return ok("Purge lancée : le résultat apparaîtra ici et dans le Journal (action maintenance.purge) dans quelques minutes.");
};

/** Lance un passage d'alertes maintenant. */
export const alertsCheckNow: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  if (opts.dryRun) return preview({ summary: "Je vérifie les alertes maintenant." });
  try {
    await enqueue("maintenance", { type: "alerts" }, { jobId: `maintenance-alerts-manual-${Date.now()}` });
    await audit({ userId: actor.userId, action: "maintenance.alerts_requested", metadata: viaMeta(actor) });
  } catch (err) {
    return fail(
      `Impossible de lancer la vérification pour le moment (${err instanceof Error ? err.message : "erreur"}). Réessayez dans une minute.`,
      "unavailable",
    );
  }
  return ok("Vérification lancée : rechargez la page dans une minute.");
};
