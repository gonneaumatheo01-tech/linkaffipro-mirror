/**
 * Phase 34, lot D — cœurs de Réglages → IA de conversation (`/settings/assistant`, ADMIN) : clé Venice (chiffrée,
 * jamais renvoyée ni journalisée), activation, modèles, limites ; vérification de la clé (sans dépense) ; retrait de
 * la clé (l'assistant ne répond plus à personne). Kevin : la clé ne passe que par un secret (privé, message effacé).
 *
 * Journal : `assistant.settings_saved`, `assistant.activation_changed`, `assistant.key_verified`,
 * `assistant.key_removed`, métadonnée `via` (« WEB » / « TELEGRAM »). Exception gardée du site : les réglages
 * enregistrés par le bouton « Vérifier » portaient déjà `via: "verify"` ; ils le gardent depuis le site, et portent
 * `via: "TELEGRAM", step: "verify"` quand Kevin vérifie.
 */
import { audit } from "@linkaffipro/db";
import { isTransientKeyCheck, listVeniceModels, selectableModels, verifyVeniceKey, type AssistantConfig } from "@linkaffipro/chat";
import { loadAssistantApiKey, loadAssistantConfig, saveAssistantConfig } from "@/lib/assistant/config";
import {
  assistantSettingsChanged,
  parseAssistantForm,
  parseAssistantKeyField,
} from "@/app/(admin)/settings/assistant/assistant-form";
import { adminOnly, fail, formOf, ok, preview, str, type CoreRun, type Fail, type SiteOpActor } from "./kit";

const ENTITY = { entityType: "Setting", entityId: "assistant.venice" } as const;

/** Métadonnée des écritures faites par « Vérifier » (voir l'en-tête). */
const verifyVia = (actor: SiteOpActor) => (actor.via === "TELEGRAM" ? { via: "TELEGRAM", step: "verify" } : { via: "verify" });

/**
 * Enregistre la clé (vide = inchangée), l'activation, les modèles et les limites. L'activation (« Seulement l'équipe »
 * ou « Tout le monde ») exige une clé.
 */
export const runSaveAssistantSettings: CoreRun = async (fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const parsed = parseAssistantForm(fd);
  if (!parsed.ok) return fail(parsed.error);
  const d = parsed.data;
  try {
    const before = await loadAssistantConfig();
    if (d.activation !== "off" && !before.apiKeyEncrypted && !d.apiKey)
      return fail("Collez d'abord la clé Venice : sans clé, l'assistant ne peut répondre à personne.", "unavailable");
    if (opts.dryRun) {
      const who = { off: "personne", team: "l'équipe seulement", all: "tout le monde" }[d.activation] ?? d.activation;
      return preview(
        `Assistant de conversation : répond à ${who}, modèle ${d.defaultModel} (repli ${d.fallbackModel}), plafond ${d.monthlyCapEur} € par mois, ${d.perConversationDailyLimit} réponses par jour et par conversation${d.apiKey ? ", nouvelle clé" : ""}.`,
      );
    }
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
      userId: actor.userId,
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
        via: actor.via,
      },
    });
    if (before.activation !== after.activation)
      await audit({
        userId: actor.userId,
        action: "assistant.activation_changed",
        ...ENTITY,
        metadata: { from: before.activation, to: after.activation, via: actor.via },
      });
  } catch (err) {
    return fail(`Enregistrement impossible : ${err instanceof Error ? err.message : "erreur"}.`, "unavailable");
  }
  return ok(
    d.apiKey ? "Réglages enregistrés et clé mise à jour. Cliquez sur « Vérifier » pour la tester." : "Réglages enregistrés.",
  );
};

/**
 * « Vérifier » enregistre aussi les autres réglages de la page (activation, modèles, limites) s'ils ont changé et sont
 * valides : jamais un choix ne doit se perdre en silence. Réglages invalides : rien n'en est enregistré et le message
 * le dit. Renvoie la phrase à ajouter.
 */
async function saveOtherSettingsOnVerify(
  actor: SiteOpActor,
  fd: FormData,
  config: AssistantConfig,
): Promise<{ config: AssistantConfig; note: string | null }> {
  if (!fd.has("activation")) return { config, note: null };
  const parsed = parseAssistantForm(fd);
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
    userId: actor.userId,
    action: "assistant.settings_saved",
    ...ENTITY,
    metadata: {
      keyChanged: false,
      ...verifyVia(actor),
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
      userId: actor.userId,
      action: "assistant.activation_changed",
      ...ENTITY,
      metadata: { from: config.activation, to: after.activation, ...verifyVia(actor) },
    });
  return { config: after, note: "Vos autres réglages sont aussi enregistrés." };
}

/**
 * Vérifie la clé sans dépenser de crédits (solde et limites chez Venice) et relit la liste des modèles (sans clé).
 * Une clé collée (pas encore enregistrée) est d'abord enregistrée : c'est elle qui est vérifiée, jamais l'ancienne ;
 * les autres réglages modifiés sont enregistrés avec elle. Enregistre `verifiedAt` (clé acceptée) ou `lastError`
 * (vrai refus seulement), la liste des modèles proposables et sa date. Un échec passager ne touche pas à la clé.
 */
export const runVerifyAssistantKey: CoreRun = async (fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const pasted = parseAssistantKeyField(fd);
  if (!pasted.ok) return fail(pasted.error, "invalid", "apiKey");
  let config = await loadAssistantConfig();
  if (opts.dryRun) {
    if (!pasted.apiKey && !config.apiKeyEncrypted)
      return fail("Collez d'abord la clé Venice dans le champ, puis cliquez sur « Vérifier ».", "unavailable");
    return preview(`Vérification de la clé Venice${pasted.apiKey ? " collée (enregistrée d'abord, chiffrée)" : ""}, sans dépense.`);
  }
  if (pasted.apiKey) {
    config = await saveAssistantConfig({ apiKey: pasted.apiKey });
    await audit({
      userId: actor.userId,
      action: "assistant.settings_saved",
      ...ENTITY,
      metadata: { keyChanged: true, ...verifyVia(actor) },
    });
  }
  const apiKey = pasted.apiKey ?? (await loadAssistantApiKey(config));
  if (!apiKey) return fail("Collez d'abord la clé Venice dans le champ, puis cliquez sur « Vérifier ».", "unavailable");
  const others = await saveOtherSettingsOnVerify(actor, fd, config);
  config = others.config;
  const [result, models] = await Promise.all([
    verifyVeniceKey(apiKey),
    listVeniceModels().catch((err: unknown) => {
      console.error("[assistant] liste des modèles Venice :", err instanceof Error ? err.message : err);
      return null;
    }),
  ]);
  const now = new Date().toISOString();
  const offered = models ? selectableModels(models) : null;
  const transient = isTransientKeyCheck(result);
  const keyState = result.ok ? { verifiedAt: now, lastError: null } : transient ? {} : { lastError: result.error };
  const patch = { ...keyState, ...(offered ? { models: offered, modelsFetchedAt: now } : {}) };
  if (Object.keys(patch).length) await saveAssistantConfig(patch);
  await audit({
    userId: actor.userId,
    action: "assistant.key_verified",
    ...ENTITY,
    metadata: {
      ok: result.ok,
      ...(transient ? { transient: true } : {}),
      keyChanged: Boolean(pasted.apiKey),
      error: result.ok ? null : result.error,
      balanceUsd: result.ok ? (result.balanceUsd ?? null) : null,
      models: offered?.length ?? null,
      via: actor.via,
    },
  });
  const parts: string[] = others.note ? [others.note] : [];
  if (offered === null) parts.push("La liste des modèles n'a pas pu être relue : réessayez plus tard.");
  else {
    parts.push(`${offered.length} modèle${offered.length > 1 ? "s" : ""} proposé${offered.length > 1 ? "s" : ""}.`);
    for (const [label, id] of [
      ["modèle par défaut", config.defaultModel],
      ["modèle de repli", config.fallbackModel],
    ] as const)
      if (!offered.some((m) => m.id === id))
        parts.push(`Attention : le ${label} « ${id} » n'est plus proposé par Venice, choisissez-en un autre.`);
  }
  if (result.ok) {
    const balance =
      result.balanceUsd !== undefined
        ? ` (solde : ${result.balanceUsd.toLocaleString("fr-FR", { style: "currency", currency: "USD" })})`
        : "";
    return ok(`Clé vérifiée : Venice l'accepte${balance}. ${parts.join(" ")}`.trim());
  }
  if (transient)
    return fail(`Vérification impossible pour l'instant (la clé n'est pas en cause). ${result.error} ${parts.join(" ")}`.trim(), "unavailable");
  return fail(`Vérification refusée. ${result.error} ${parts.join(" ")}`.trim(), "conflict");
};

/** Retire la clé et désactive l'assistant (il ne répond plus à personne) ; l'historique des coûts reste. */
export const runRemoveAssistantKey: CoreRun = async (_fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const before = await loadAssistantConfig();
  if (opts.dryRun)
    return preview("Retrait de la clé Venice.", {
      impact: `L'assistant de conversation est désactivé${before.activation !== "off" ? " (il répondait encore)" : ""} ; l'historique des coûts reste.`,
    });
  await saveAssistantConfig({ apiKeyEncrypted: null, verifiedAt: null, lastError: null, activation: "off" });
  await audit({ userId: actor.userId, action: "assistant.key_removed", ...ENTITY, metadata: { via: actor.via } });
  if (before.activation !== "off")
    await audit({
      userId: actor.userId,
      action: "assistant.activation_changed",
      ...ENTITY,
      metadata: { from: before.activation, to: "off", reason: "key_removed", via: actor.via },
    });
  return ok("Clé retirée : l'assistant est désactivé jusqu'à ce qu'une clé soit recollée.");
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

const ACTIVATIONS: Record<string, string> = {
  off: "off",
  personne: "off",
  desactive: "off",
  désactivé: "off",
  team: "team",
  equipe: "team",
  équipe: "team",
  "l'équipe": "team",
  all: "all",
  tous: "all",
  "tout le monde": "all",
};

/** Réglages de l'assistant par Kevin : valeurs enregistrées gardées ; la clé n'arrive que par l'opération secrète. */
export async function kevinAssistantForm(input: Record<string, unknown>, withKey: boolean): Promise<{ ok: true; fd: FormData } | { ok: false; result: Fail }> {
  const cur = await loadAssistantConfig();
  const act = input.activation !== undefined ? (ACTIVATIONS[str(input.activation).trim().toLowerCase()] ?? str(input.activation)) : cur.activation;
  return {
    ok: true,
    fd: formOf({
      apiKey: withKey ? str(input.apiKey) : undefined,
      activation: act,
      defaultModel: input.defaultModel ?? cur.defaultModel,
      fallbackModel: input.fallbackModel ?? cur.fallbackModel,
      temperature: input.temperature ?? cur.temperature,
      maxTokens: input.maxTokens ?? cur.maxTokens,
      monthlyCapEur: input.monthlyCapEur ?? cur.monthlyCapEur,
      perConversationDailyLimit: input.perConversationDailyLimit ?? cur.perConversationDailyLimit,
    }),
  };
}
