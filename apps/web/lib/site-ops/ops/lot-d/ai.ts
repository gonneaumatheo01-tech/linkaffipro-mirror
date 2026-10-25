/**
 * Phase 34, lot D — cœurs de Réglages → IA (`/settings/ai`, ADMIN) : clé Anthropic (chiffrée, jamais renvoyée ni
 * journalisée), modèles, plafond mensuel, limite par utilisateur, mentions des risques ; vérification de la clé ;
 * retrait de la clé. Kevin : la clé ne passe que par un secret (privé, message effacé, jamais à l'IA).
 */
import { z } from "zod";
import { audit } from "@linkaffipro/db";
import { AI_MODEL_IDS, verifyApiKey, type AiModelId } from "@linkaffipro/ai";
import { loadAiApiKey, loadAiConfig, saveAiConfig } from "@/lib/ai/config";
import { adminOnly, fail, formOf, ok, preview, str, type CoreRun, type Fail } from "./kit";

const schema = z.object({
  apiKey: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(v), "La clé Anthropic commence par « sk-ant- » : collez-la entièrement, sans espace.")
    .optional(),
  defaultModel: z.enum(AI_MODEL_IDS as [AiModelId, ...AiModelId[]]),
  qualityModel: z.enum(AI_MODEL_IDS as [AiModelId, ...AiModelId[]]),
  monthlyCapEur: z.coerce.number().min(0, "Le plafond doit être un nombre positif.").max(100_000),
  perUserDailyLimit: z.coerce.number().int("La limite est un nombre entier.").min(1, "La limite est d'au moins 1 par jour.").max(10_000),
  riskCasino: z.string().trim().min(10, "La mention casino doit faire au moins 10 caractères.").max(300),
  riskSports: z.string().trim().min(10, "La mention paris sportifs doit faire au moins 10 caractères.").max(300),
});

/** Enregistre la clé (vide = inchangée), les modèles, le plafond, la limite et les mentions des risques. */
export const runSaveAiSettings: CoreRun = async (fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const parsed = schema.safeParse({
    apiKey: fd.get("apiKey") || undefined,
    defaultModel: fd.get("defaultModel"),
    qualityModel: fd.get("qualityModel"),
    monthlyCapEur: fd.get("monthlyCapEur"),
    perUserDailyLimit: fd.get("perUserDailyLimit"),
    riskCasino: fd.get("riskCasino"),
    riskSports: fd.get("riskSports"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Valeurs invalides.");
  const d = parsed.data;
  if (opts.dryRun)
    return preview(
      `Assistant d'écriture : modèle ${d.defaultModel} (qualité ${d.qualityModel}), plafond ${d.monthlyCapEur} € par mois, ${d.perUserDailyLimit} suggestions par jour et par personne${d.apiKey ? ", nouvelle clé" : ""}.`,
    );
  try {
    await saveAiConfig({
      apiKey: d.apiKey || null,
      defaultModel: d.defaultModel,
      qualityModel: d.qualityModel,
      monthlyCapEur: d.monthlyCapEur,
      perUserDailyLimit: d.perUserDailyLimit,
      riskNotice: { casino: d.riskCasino, sports: d.riskSports },
    });
    await audit({
      userId: actor.userId,
      action: "ai.settings_saved",
      entityType: "Setting",
      entityId: "ai.config",
      metadata: {
        keyChanged: Boolean(d.apiKey),
        defaultModel: d.defaultModel,
        qualityModel: d.qualityModel,
        monthlyCapEur: d.monthlyCapEur,
        perUserDailyLimit: d.perUserDailyLimit,
        via: actor.via,
      },
    });
  } catch (err) {
    return fail(`Enregistrement impossible : ${err instanceof Error ? err.message : "erreur"}.`, "unavailable");
  }
  return ok(d.apiKey ? "Réglages enregistrés et clé mise à jour. Cliquez sur « Vérifier » pour la tester." : "Réglages enregistrés.");
};

/** Teste la clé enregistrée par un appel minimal (5 jetons) au modèle par défaut. */
export const runVerifyAiKey: CoreRun = async (_fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const config = await loadAiConfig();
  const apiKey = await loadAiApiKey(config);
  if (!apiKey) return fail("Collez d'abord la clé API, puis enregistrez.", "unavailable");
  if (opts.dryRun) return preview(`Vérification de la clé Anthropic (5 jetons au modèle ${config.defaultModel}).`);
  const result = await verifyApiKey(apiKey, config.defaultModel);
  await saveAiConfig(result.ok ? { verifiedAt: new Date().toISOString(), lastError: null } : { lastError: result.error });
  await audit({
    userId: actor.userId,
    action: "ai.key_verified",
    entityType: "Setting",
    entityId: "ai.config",
    metadata: { ok: result.ok, model: config.defaultModel, error: result.ok ? null : result.error, via: actor.via },
  });
  if (result.ok) return ok("Clé vérifiée : Anthropic a répondu. L'assistant est prêt sur toutes les pages de rédaction.");
  return fail(`Vérification refusée. ${result.error}`, "conflict");
};

/** Retire la clé : l'assistant redevient indisponible (les suggestions passées restent dans l'historique). */
export const runRemoveAiKey: CoreRun = async (_fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  if (opts.dryRun)
    return preview("Retrait de la clé Anthropic.", { impact: "L'assistant d'écriture est désactivé jusqu'à une nouvelle clé ; l'historique reste." });
  await saveAiConfig({ apiKeyEncrypted: null, verifiedAt: null, lastError: null });
  await audit({ userId: actor.userId, action: "ai.key_removed", entityType: "Setting", entityId: "ai.config", metadata: { via: actor.via } });
  return ok("Clé retirée. L'assistant est désactivé jusqu'à ce qu'une clé soit recollée.");
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

/**
 * Réglages IA par Kevin : on part des réglages enregistrés et on ne change que ce qu'il donne. La clé (`apiKey`)
 * n'arrive que par l'opération secrète (`reglages.ia_cle`), jamais dans les paramètres ordinaires.
 */
export async function kevinAiForm(input: Record<string, unknown>, withKey: boolean): Promise<{ ok: true; fd: FormData } | { ok: false; result: Fail }> {
  const cur = await loadAiConfig();
  return {
    ok: true,
    fd: formOf({
      apiKey: withKey ? str(input.apiKey) : undefined,
      defaultModel: input.defaultModel ?? cur.defaultModel,
      qualityModel: input.qualityModel ?? cur.qualityModel,
      monthlyCapEur: input.monthlyCapEur ?? cur.monthlyCapEur,
      perUserDailyLimit: input.perUserDailyLimit ?? cur.perUserDailyLimit,
      riskCasino: input.riskCasino ?? cur.riskNotice.casino,
      riskSports: input.riskSports ?? cur.riskNotice.sports,
    }),
  };
}
