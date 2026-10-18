/**
 * Lecture du formulaire de Réglages → IA de conversation (pur, testé dans assistant-view.test.ts) : bornes du contrat
 * (docs/ASSISTANT-CONVERSATION.md § 2), messages d'erreur en français simple. Séparé de actions.ts (un fichier
 * « use server » n'exporte que des actions).
 */
import { z } from "zod";
import {
  ASSISTANT_ACTIVATIONS,
  ASSISTANT_LIMITS,
  type AssistantActivation,
} from "@linkaffipro/chat";

/** Nombre saisi (virgule ou point) ; champ vide = manquant. */
function numberField(label: string, { min, max }: { min: number; max: number }, integer = false) {
  const base = z.number({ error: `${label} : saisissez un nombre.` });
  const bounded = (integer ? base.int(`${label} : saisissez un nombre entier.`) : base)
    .min(min, `${label} : au moins ${String(min).replace(".", ",")}.`)
    .max(max, `${label} : au plus ${String(max).replace(".", ",")}.`);
  return z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const t = v.trim().replace(",", ".");
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : v;
  }, bounded);
}

const modelField = (label: string) =>
  z
    .string({ error: `${label} : choisissez un modèle.` })
    .trim()
    .min(1, `${label} : choisissez un modèle.`)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, `${label} : nom de modèle invalide.`);

const apiKeyField = z
  .string()
  .trim()
  .max(300, "La clé Venice semble trop longue : collez-la seule, sans autre texte.")
  .refine((v) => !v || /^\S{16,}$/.test(v), "Collez la clé Venice entièrement, sans espace.")
  .optional();

export const assistantFormSchema = z.object({
  apiKey: apiKeyField,
  activation: z.enum(
    ASSISTANT_ACTIVATIONS as unknown as [AssistantActivation, ...AssistantActivation[]],
    {
      error: "Choisissez à qui l'assistant répond.",
    },
  ),
  defaultModel: modelField("Modèle par défaut"),
  fallbackModel: modelField("Modèle de repli"),
  temperature: numberField("Créativité des réponses", ASSISTANT_LIMITS.temperature),
  maxTokens: numberField("Longueur maximale des réponses", ASSISTANT_LIMITS.maxTokens, true),
  monthlyCapEur: numberField("Plafond mensuel", ASSISTANT_LIMITS.monthlyCapEur),
  perConversationDailyLimit: numberField(
    "Réponses par jour et par conversation",
    ASSISTANT_LIMITS.perConversationDailyLimit,
    true,
  ),
});

export type AssistantForm = z.infer<typeof assistantFormSchema>;

/** Lit le formulaire ; la clé vide reste inchangée (`apiKey` absente). */
export function parseAssistantForm(
  formData: FormData,
): { ok: true; data: AssistantForm } | { ok: false; error: string } {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const parsed = assistantFormSchema.safeParse({
    apiKey: get("apiKey") || undefined,
    activation: get("activation"),
    defaultModel: get("defaultModel"),
    fallbackModel: get("fallbackModel"),
    temperature: get("temperature"),
    maxTokens: get("maxTokens"),
    monthlyCapEur: get("monthlyCapEur"),
    perConversationDailyLimit: get("perConversationDailyLimit"),
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeurs invalides." };
  return { ok: true, data: parsed.data };
}

/**
 * Clé collée dans le champ, seule (bouton « Vérifier », qui ne valide pas le reste du formulaire) : null si le champ
 * est vide (la clé enregistrée est alors vérifiée).
 */
export function parseAssistantKeyField(
  formData: FormData | null | undefined,
): { ok: true; apiKey: string | null } | { ok: false; error: string } {
  const raw = formData?.get("apiKey");
  const parsed = apiKeyField.safeParse(typeof raw === "string" && raw.trim() ? raw : undefined);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Clé Venice invalide." };
  return { ok: true, apiKey: parsed.data || null };
}

/** Réglages de la page (hors clé) différents de ceux enregistrés ? */
export function assistantSettingsChanged(
  saved: {
    activation: string;
    defaultModel: string;
    fallbackModel: string;
    temperature: number;
    maxTokens: number;
    monthlyCapEur: number;
    perConversationDailyLimit: number;
  },
  form: AssistantForm,
): boolean {
  return (
    saved.activation !== form.activation ||
    saved.defaultModel !== form.defaultModel ||
    saved.fallbackModel !== form.fallbackModel ||
    saved.temperature !== form.temperature ||
    saved.maxTokens !== form.maxTokens ||
    saved.monthlyCapEur !== form.monthlyCapEur ||
    saved.perConversationDailyLimit !== form.perConversationDailyLimit
  );
}
