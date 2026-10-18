"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit } from "@linkaffipro/db";
import {
  isTransientKeyCheck,
  listVeniceModels,
  selectableModels,
  verifyVeniceKey,
  type AssistantConfig,
} from "@linkaffipro/chat";
import {
  loadAssistantApiKey,
  loadAssistantConfig,
  saveAssistantConfig,
} from "@/lib/assistant/config";
import { requireAdmin } from "@/lib/session";
import {
  assistantSettingsChanged,
  parseAssistantForm,
  parseAssistantKeyField,
} from "./assistant-form";

const PAGE = "/settings/assistant";
const ENTITY = { entityType: "Setting", entityId: "assistant.venice" } as const;

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}

/**
 * Enregistre la clé (vide = inchangée), l'activation, les modèles et les limites. L'activation (« Seulement l'équipe »
 * ou « Tout le monde ») exige une clé. Journal : `assistant.settings_saved` (jamais la clé) et, si elle change,
 * `assistant.activation_changed`.
 */
export async function saveAssistantSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = parseAssistantForm(formData);
  if (!parsed.ok) back({ error: parsed.error });
  const d = parsed.data;
  try {
    const before = await loadAssistantConfig();
    if (d.activation !== "off" && !before.apiKeyEncrypted && !d.apiKey)
      back({
        error: "Collez d'abord la clé Venice : sans clé, l'assistant ne peut répondre à personne.",
      });
    const after = await saveAssistantConfig({
      apiKey: d.apiKey || null,
      activation: d.activation,
      defaultModel: d.defaultModel,
      fallbackModel: d.fallbackModel,
      temperature: d.temperature,
      maxTokens: d.maxTokens,
      monthlyCapEur: d.monthlyCapEur,
      perConversationDailyLimit: d.perConversationDailyLimit,
    });
    await audit({
      userId: admin.id,
      action: "assistant.settings_saved",
      ...ENTITY,
      metadata: {
        keyChanged: Boolean(d.apiKey),
        activation: after.activation,
        defaultModel: after.defaultModel,
        fallbackModel: after.fallbackModel,
        temperature: after.temperature,
        maxTokens: after.maxTokens,
        monthlyCapEur: after.monthlyCapEur,
        perConversationDailyLimit: after.perConversationDailyLimit,
      },
    });
    if (before.activation !== after.activation)
      await audit({
        userId: admin.id,
        action: "assistant.activation_changed",
        ...ENTITY,
        metadata: { from: before.activation, to: after.activation },
      });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({
      error: `Enregistrement impossible : ${err instanceof Error ? err.message : "erreur"}.`,
    });
  }
  revalidatePath(PAGE);
  back({
    ok: d.apiKey
      ? "Réglages enregistrés et clé mise à jour. Cliquez sur « Vérifier » pour la tester."
      : "Réglages enregistrés.",
  });
}

/**
 * « Vérifier » enregistre aussi les autres réglages de la page (activation, modèles, limites) s'ils ont changé et sont
 * valides : l'aide de la page dit de cliquer sur « Vérifier » après avoir collé la clé, jamais un choix ne doit se
 * perdre en silence. Réglages invalides : rien n'en est enregistré et le message le dit. Renvoie la phrase à ajouter.
 */
async function saveOtherSettingsOnVerify(
  adminId: string,
  formData: FormData,
  config: AssistantConfig,
): Promise<{ config: AssistantConfig; note: string | null }> {
  if (!formData.has("activation")) return { config, note: null };
  const parsed = parseAssistantForm(formData);
  if (!parsed.ok)
    return {
      config,
      note: `Vos autres réglages ne sont pas enregistrés (${parsed.error}) : corrigez-les puis cliquez sur « Enregistrer ».`,
    };
  const d = parsed.data;
  if (!assistantSettingsChanged(config, d)) return { config, note: null };
  const after = await saveAssistantConfig({
    activation: d.activation,
    defaultModel: d.defaultModel,
    fallbackModel: d.fallbackModel,
    temperature: d.temperature,
    maxTokens: d.maxTokens,
    monthlyCapEur: d.monthlyCapEur,
    perConversationDailyLimit: d.perConversationDailyLimit,
  });
  await audit({
    userId: adminId,
    action: "assistant.settings_saved",
    ...ENTITY,
    metadata: {
      keyChanged: false,
      via: "verify",
      activation: after.activation,
      defaultModel: after.defaultModel,
      fallbackModel: after.fallbackModel,
      temperature: after.temperature,
      maxTokens: after.maxTokens,
      monthlyCapEur: after.monthlyCapEur,
      perConversationDailyLimit: after.perConversationDailyLimit,
    },
  });
  if (config.activation !== after.activation)
    await audit({
      userId: adminId,
      action: "assistant.activation_changed",
      ...ENTITY,
      metadata: { from: config.activation, to: after.activation, via: "verify" },
    });
  return { config: after, note: "Vos autres réglages sont aussi enregistrés." };
}

/**
 * Vérifie la clé sans dépenser de crédits (solde et limites chez Venice) et relit la liste des modèles (sans clé).
 * Une clé collée dans le champ (pas encore enregistrée) est d'abord enregistrée : c'est elle qui est vérifiée, jamais
 * l'ancienne ; les autres réglages de la page modifiés sont enregistrés avec elle (`saveOtherSettingsOnVerify`).
 * Enregistre `verifiedAt` (clé acceptée) ou `lastError` (vrai refus seulement : clé refusée, solde vide, accès coupé…),
 * la liste des modèles proposables et sa date. Un échec passager ne touche pas à l'état de la clé.
 */
export async function verifyAssistantKeyAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const pasted = parseAssistantKeyField(formData);
  if (!pasted.ok) back({ error: pasted.error });
  let config = await loadAssistantConfig();
  if (pasted.apiKey) {
    config = await saveAssistantConfig({ apiKey: pasted.apiKey });
    await audit({
      userId: admin.id,
      action: "assistant.settings_saved",
      ...ENTITY,
      metadata: { keyChanged: true, via: "verify" },
    });
  }
  const apiKey = pasted.apiKey ?? (await loadAssistantApiKey(config));
  if (!apiKey)
    back({ error: "Collez d'abord la clé Venice dans le champ, puis cliquez sur « Vérifier »." });
  const others = await saveOtherSettingsOnVerify(admin.id, formData, config);
  config = others.config;
  const [result, models] = await Promise.all([
    verifyVeniceKey(apiKey),
    listVeniceModels().catch((err: unknown) => {
      console.error(
        "[assistant] liste des modèles Venice :",
        err instanceof Error ? err.message : err,
      );
      return null;
    }),
  ]);
  const now = new Date().toISOString();
  const offered = models ? selectableModels(models) : null;
  const transient = isTransientKeyCheck(result);
  const keyState = result.ok
    ? { verifiedAt: now, lastError: null }
    : transient
      ? {}
      : { lastError: result.error };
  const patch = { ...keyState, ...(offered ? { models: offered, modelsFetchedAt: now } : {}) };
  if (Object.keys(patch).length) await saveAssistantConfig(patch);
  await audit({
    userId: admin.id,
    action: "assistant.key_verified",
    ...ENTITY,
    metadata: {
      ok: result.ok,
      ...(transient ? { transient: true } : {}),
      keyChanged: Boolean(pasted.apiKey),
      error: result.ok ? null : result.error,
      balanceUsd: result.ok ? (result.balanceUsd ?? null) : null,
      models: offered?.length ?? null,
    },
  });
  revalidatePath(PAGE);
  const parts: string[] = others.note ? [others.note] : [];
  if (offered === null)
    parts.push("La liste des modèles n'a pas pu être relue : réessayez plus tard.");
  else {
    parts.push(
      `${offered.length} modèle${offered.length > 1 ? "s" : ""} proposé${offered.length > 1 ? "s" : ""}.`,
    );
    for (const [label, id] of [
      ["modèle par défaut", config.defaultModel],
      ["modèle de repli", config.fallbackModel],
    ] as const)
      if (!offered.some((m) => m.id === id))
        parts.push(
          `Attention : le ${label} « ${id} » n'est plus proposé par Venice, choisissez-en un autre.`,
        );
  }
  if (result.ok) {
    const balance =
      result.balanceUsd !== undefined
        ? ` (solde : ${result.balanceUsd.toLocaleString("fr-FR", { style: "currency", currency: "USD" })})`
        : "";
    back({ ok: `Clé vérifiée : Venice l'accepte${balance}. ${parts.join(" ")}`.trim() });
  }
  if (transient)
    back({
      error:
        `Vérification impossible pour l'instant (la clé n'est pas en cause). ${result.error} ${parts.join(" ")}`.trim(),
    });
  back({ error: `Vérification refusée. ${result.error} ${parts.join(" ")}`.trim() });
}

/** Retire la clé et désactive l'assistant (il ne répond plus à personne) ; l'historique des coûts reste. */
export async function removeAssistantKeyAction(): Promise<void> {
  const admin = await requireAdmin();
  const before = await loadAssistantConfig();
  await saveAssistantConfig({
    apiKeyEncrypted: null,
    verifiedAt: null,
    lastError: null,
    activation: "off",
  });
  await audit({ userId: admin.id, action: "assistant.key_removed", ...ENTITY });
  if (before.activation !== "off")
    await audit({
      userId: admin.id,
      action: "assistant.activation_changed",
      ...ENTITY,
      metadata: { from: before.activation, to: "off", reason: "key_removed" },
    });
  revalidatePath(PAGE);
  back({ ok: "Clé retirée : l'assistant est désactivé jusqu'à ce qu'une clé soit recollée." });
}
