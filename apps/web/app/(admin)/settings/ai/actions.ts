"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@linkaffipro/db";
import { AI_MODEL_IDS, verifyApiKey, type AiModelId } from "@linkaffipro/ai";
import { loadAiApiKey, loadAiConfig, saveAiConfig } from "@/lib/ai/config";
import { requireAdmin } from "@/lib/session";

const PAGE = "/settings/ai";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}

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
export async function saveAiSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = schema.safeParse({
    apiKey: formData.get("apiKey") || undefined,
    defaultModel: formData.get("defaultModel"),
    qualityModel: formData.get("qualityModel"),
    monthlyCapEur: formData.get("monthlyCapEur"),
    perUserDailyLimit: formData.get("perUserDailyLimit"),
    riskCasino: formData.get("riskCasino"),
    riskSports: formData.get("riskSports"),
  });
  if (!parsed.success) back({ error: parsed.error.issues[0]?.message ?? "Valeurs invalides." });
  const d = parsed.data;
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
      userId: admin.id,
      action: "ai.settings_saved",
      entityType: "Setting",
      entityId: "ai.config",
      metadata: { keyChanged: Boolean(d.apiKey), defaultModel: d.defaultModel, qualityModel: d.qualityModel, monthlyCapEur: d.monthlyCapEur, perUserDailyLimit: d.perUserDailyLimit },
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({ error: `Enregistrement impossible : ${err instanceof Error ? err.message : "erreur"}.` });
  }
  revalidatePath(PAGE);
  back({ ok: d.apiKey ? "Réglages enregistrés et clé mise à jour. Cliquez sur « Vérifier » pour la tester." : "Réglages enregistrés." });
}

/** Teste la clé enregistrée par un appel minimal (5 jetons) au modèle par défaut. */
export async function verifyAiKeyAction(): Promise<void> {
  const admin = await requireAdmin();
  const config = await loadAiConfig();
  const apiKey = await loadAiApiKey(config);
  if (!apiKey) back({ error: "Collez d'abord la clé API, puis enregistrez." });
  const result = await verifyApiKey(apiKey, config.defaultModel);
  await saveAiConfig(result.ok ? { verifiedAt: new Date().toISOString(), lastError: null } : { lastError: result.error });
  await audit({ userId: admin.id, action: "ai.key_verified", entityType: "Setting", entityId: "ai.config", metadata: { ok: result.ok, model: config.defaultModel, error: result.ok ? null : result.error } });
  revalidatePath(PAGE);
  if (result.ok) back({ ok: "Clé vérifiée : Anthropic a répondu. L'assistant est prêt sur toutes les pages de rédaction." });
  back({ error: `Vérification refusée. ${result.error}` });
}

/** Retire la clé : l'assistant redevient indisponible (les suggestions passées restent dans l'historique). */
export async function removeAiKeyAction(): Promise<void> {
  const admin = await requireAdmin();
  await saveAiConfig({ apiKeyEncrypted: null, verifiedAt: null, lastError: null });
  await audit({ userId: admin.id, action: "ai.key_removed", entityType: "Setting", entityId: "ai.config" });
  revalidatePath(PAGE);
  back({ ok: "Clé retirée. L'assistant est désactivé jusqu'à ce qu'une clé soit recollée." });
}
