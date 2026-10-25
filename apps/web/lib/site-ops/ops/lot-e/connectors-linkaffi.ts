/**
 * Phase 34, lot E — cœurs de Réglages → Connexions (Link Affi : synchronisation, seuils du niveau de dépense, taux de
 * change ; « Campagnes Telegram des affiliés » de la phase 13). Appelés par `app/(admin)/settings/connectors/actions.ts`,
 * `affiliates-actions.ts` et par Kevin. Administrateurs seulement.
 * La clé et le secret générés ne reviennent que dans `data.value` (jamais dans le message, l'aperçu ni le journal) :
 * Kevin ne les montre qu'en privé.
 */
import { z } from "zod";
import { DEFAULT_SPEND_THRESHOLDS, parseSpendThresholds } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import {
  generateLinkaffiApiKey,
  generateLinkaffiWebhookSecret,
  linkaffiTestPrerequisites,
  parseEventsUrl,
  runLinkaffiTestEvent,
  saveLinkaffiEventsUrl,
} from "@/lib/integrations/linkaffi/settings";
import { LINKAFFI_PROVIDER } from "@/lib/integrations/linkaffi/auth";
import { adminOnly, fail, needUser, ok, preview, str, viaMeta, type CoreRun } from "./common";

/** Texte de refus de la sous-section « Campagnes Telegram des affiliés ». */
export const AFFILIATES_ADMIN_ONLY = "Réservé aux administrateurs.";

/** Enfile un passage de synchronisation Link Affi (incrémental ou complet). */
export const linkaffiSyncNow: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const full = input.full === true || input.full === "1";
  if (opts.dryRun) return preview({ summary: full ? "Resynchronisation complète de Link Affi (plusieurs minutes)." : "Synchronisation de Link Affi maintenant." });
  try {
    await enqueue("sync-linkaffi", { type: "tick", full }, { jobId: `sync-linkaffi:manual:${Date.now()}` });
    await audit({ userId: actor.userId, action: full ? "linkaffi.sync_full_requested" : "linkaffi.sync_requested", metadata: viaMeta(actor) });
  } catch (err) {
    return fail(
      `Impossible de lancer la synchronisation pour le moment (${err instanceof Error ? err.message : "erreur"}). Réessayez dans une minute.`,
      "unavailable",
    );
  }
  return ok(
    full
      ? "Resynchronisation complète lancée : comptez plusieurs minutes, puis rechargez la page."
      : "Synchronisation lancée : rechargez la page dans une minute.",
  );
};

const thresholdsSchema = z.object({
  vip: z.coerce.number().min(0).max(1_000_000),
  regularDeposits: z.coerce.number().int().min(1).max(1000),
});

/** Seuils du niveau de dépense (Setting `spend.thresholds`). Kevin peut n'en donner qu'un : l'autre est gardé. */
export const spendThresholdsSave: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const current =
    input.vip === undefined || input.regularDeposits === undefined
      ? parseSpendThresholds((await prisma.setting.findUnique({ where: { key: "spend.thresholds" } }))?.value ?? DEFAULT_SPEND_THRESHOLDS)
      : null;
  const parsed = thresholdsSchema.safeParse({
    vip: input.vip === undefined ? current!.vip : input.vip,
    regularDeposits: input.regularDeposits === undefined ? current!.regularDeposits : input.regularDeposits,
  });
  if (!parsed.success)
    return fail(
      "Seuils invalides : le seuil VIP doit être un montant positif et le nombre de dépôts un entier d'au moins 1.",
    );
  if (opts.dryRun)
    return preview({ summary: `Niveau de dépense : VIP à partir de ${parsed.data.vip} € déposés, régulier à partir de ${parsed.data.regularDeposits} dépôts.` });
  await prisma.setting.upsert({
    where: { key: "spend.thresholds" },
    create: { key: "spend.thresholds", value: parsed.data },
    update: { value: parsed.data },
  });
  await audit({ userId: actor.userId, action: "settings.spend_thresholds", metadata: { ...parsed.data, ...viaMeta(actor) } });
  return ok("Seuils enregistrés.", parsed.data);
};

/** Texte « USD=1.08, GBP=0.85 » depuis un objet donné par Kevin ({ USD: 1.08 }). */
function ratesText(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw))
    return Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => `${k}=${str(v)}`)
      .join(", ");
  return str(raw);
}

/** Taux de change saisis (« USD=1.08, GBP=0.85 » : unités pour 1 €), prioritaires sur ceux de Link Affi. Vide = effacés. */
export const ratesSave: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const raw = ratesText(input.rates);
  const rates: Record<string, number> = {};
  for (const part of raw.split(/[,;\n]+/)) {
    const [k, v] = part.split("=").map((x) => x?.trim());
    if (!k) continue;
    const rate = Number((v ?? "").replace(",", "."));
    if (!/^[A-Za-z]{3}$/.test(k) || !Number.isFinite(rate) || rate <= 0)
      return fail(`Taux illisible : « ${part.trim()} » (attendu : USD=1.08).`, "invalid", "rates");
    rates[k.toUpperCase()] = rate;
  }
  const done = Object.keys(rates).length
    ? `Taux enregistrés : ${Object.entries(rates)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}.`
    : "Taux saisis effacés : les taux Link Affi s'appliquent.";
  if (opts.dryRun) return preview({ summary: done.replace(/^Taux enregistrés/, "Taux à enregistrer").replace(/^Taux saisis effacés/, "Taux saisis à effacer") });
  await prisma.setting.upsert({ where: { key: "currency.rates.manual" }, create: { key: "currency.rates.manual", value: rates }, update: { value: rates } });
  await audit({ userId: actor.userId, action: "settings.currency_rates_updated", metadata: { rates, ...viaMeta(actor) } });
  return ok(done, { rates });
};

// ---------------------------------------------------------------------------- Campagnes Telegram des affiliés

/** Nouvelle clé de connexion pour Link Affi : l'ancienne ne marche plus. La clé est dans `data.value` (une fois). */
export const linkaffiKeyGenerate: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor, AFFILIATES_ADMIN_ONLY) ?? needUser(actor);
  if (denied) return denied;
  if (opts.dryRun) {
    const row = await prisma.integrationKey.findUnique({ where: { provider: LINKAFFI_PROVIDER }, select: { apiKeyHash: true } });
    return preview({
      summary: "Nouvelle clé de connexion pour Link Affi (montrée une seule fois, en privé).",
      impact: row?.apiKeyHash ? "L'ancienne clé cesse aussitôt de fonctionner : il faudra coller la nouvelle dans Link Affi." : null,
    });
  }
  const r = await generateLinkaffiApiKey(actor.userId!, viaMeta(actor));
  return ok(
    r.regenerated
      ? "Nouvelle clé générée : l'ancienne ne fonctionne plus. Copiez-la dans Link Affi (elle ne sera plus montrée)."
      : "Clé générée : copiez-la dans Link Affi (elle ne sera plus montrée).",
    { value: r.value, regenerated: r.regenerated },
  );
};

/** Nouveau secret de signature des événements. Le secret est dans `data.value` (une fois). */
export const linkaffiSecretGenerate: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor, AFFILIATES_ADMIN_ONLY) ?? needUser(actor);
  if (denied) return denied;
  if (opts.dryRun) {
    const row = await prisma.integrationKey.findUnique({ where: { provider: LINKAFFI_PROVIDER }, select: { webhookSecretEncrypted: true } });
    return preview({
      summary: "Nouveau secret de signature des événements envoyés à Link Affi (montré une seule fois, en privé).",
      impact: row?.webhookSecretEncrypted ? "L'ancien secret est remplacé pour les prochains envois : il faudra coller le nouveau dans Link Affi." : null,
    });
  }
  const r = await generateLinkaffiWebhookSecret(actor.userId!, viaMeta(actor));
  return ok(
    r.regenerated
      ? "Nouveau secret généré : il remplace l'ancien pour les prochains envois. Copiez-le dans Link Affi (il ne sera plus montré)."
      : "Secret généré : copiez-le dans Link Affi (il ne sera plus montré).",
    { value: r.value, regenerated: r.regenerated },
  );
};

/** Adresse de la fonction Link Affi `telegram-events` (vide = adresse d'origine). */
export const linkaffiEventsUrlSave: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor, AFFILIATES_ADMIN_ONLY) ?? needUser(actor);
  if (denied) return denied;
  const raw = input.eventsUrl ?? "";
  if (opts.dryRun) {
    const parsed = parseEventsUrl(raw, { production: process.env.NODE_ENV === "production" });
    if ("error" in parsed) return fail(parsed.error, "invalid", "eventsUrl");
    return preview({ summary: parsed.url ? `Les événements partiront vers ${parsed.url}.` : "Retour à l'adresse d'origine de Link Affi." });
  }
  const r = await saveLinkaffiEventsUrl(actor.userId!, raw, viaMeta(actor));
  if (!r.ok) return fail(r.error, "invalid", "eventsUrl");
  return ok(
    r.isDefault ? "Adresse d'origine de Link Affi enregistrée." : "Adresse enregistrée : les prochains événements partiront vers elle.",
    { url: r.url, isDefault: r.isDefault },
  );
};

/** Envoie un événement de test signé à Link Affi (seule écriture permise vers Link Affi). */
export const linkaffiTestEvent: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor, AFFILIATES_ADMIN_ONLY) ?? needUser(actor);
  if (denied) return denied;
  if (opts.dryRun) {
    const pre = await linkaffiTestPrerequisites();
    if (!pre.ok) return fail(pre.error, "conflict");
    return preview({ summary: "J'envoie un événement de test signé à Link Affi pour vérifier la connexion." });
  }
  const r = await runLinkaffiTestEvent(actor.userId!, { auditMeta: viaMeta(actor) });
  if (!r.ok) return fail(r.error, "conflict");
  return ok(r.message, { outcome: r.outcome, status: r.status });
};
