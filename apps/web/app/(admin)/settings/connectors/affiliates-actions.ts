"use server";

import { revalidatePath } from "next/cache";
import {
  generateLinkaffiApiKey,
  generateLinkaffiWebhookSecret,
  runLinkaffiTestEvent,
  saveLinkaffiEventsUrl,
} from "@/lib/integrations/linkaffi/settings";
import type { LinkaffiTestOutcome } from "@/lib/integrations/linkaffi/test-event";
import type { EventsUrlFieldState } from "./_affilies/events-url-field";
import { ForbiddenError, requireAdmin, type CurrentUser } from "@/lib/session";

/**
 * Actions de la sous-section « Campagnes Telegram des affiliés » (Réglages → Connexions, phase 13), ADMIN seulement.
 * La clé et le secret générés reviennent UNE fois dans la réponse de l'action (état du formulaire dans le navigateur) :
 * jamais dans l'adresse, jamais dans la page rechargée (qui ne montre que leur début).
 */

const PAGE = "/settings/connectors";
const ADMIN_ONLY = "Réservé aux administrateurs.";

async function admin(): Promise<CurrentUser | null> {
  try {
    return await requireAdmin();
  } catch (err) {
    if (err instanceof ForbiddenError) return null;
    throw err;
  }
}

/** Résultat de « Générer » : la valeur à copier (une seule fois), ou une erreur. */
export type GenerateState = { value?: string; regenerated?: boolean; error?: string } | null;

export async function generateLinkaffiKeyAction(
  _prev: GenerateState,
  _formData: FormData,
): Promise<GenerateState> {
  const user = await admin();
  if (!user) return { error: ADMIN_ONLY };
  const r = await generateLinkaffiApiKey(user.id);
  revalidatePath(PAGE);
  return { value: r.value, regenerated: r.regenerated };
}

export async function generateLinkaffiSecretAction(
  _prev: GenerateState,
  _formData: FormData,
): Promise<GenerateState> {
  const user = await admin();
  if (!user) return { error: ADMIN_ONLY };
  const r = await generateLinkaffiWebhookSecret(user.id);
  revalidatePath(PAGE);
  return { value: r.value, regenerated: r.regenerated };
}

/** Résultat de l'enregistrement de l'adresse ; en cas d'erreur, la saisie revient pour rester dans le champ. */
export type EventsUrlState = EventsUrlFieldState;

export async function saveLinkaffiEventsUrlAction(
  prev: EventsUrlState,
  formData: FormData,
): Promise<EventsUrlState> {
  const user = await admin();
  if (!user) return { error: ADMIN_ONLY };
  const raw = formData.get("eventsUrl");
  const r = await saveLinkaffiEventsUrl(user.id, raw);
  if (!r.ok)
    return {
      error: r.error,
      value: typeof raw === "string" ? raw.slice(0, 600) : "",
      attempt: (prev?.attempt ?? 0) + 1,
    };
  revalidatePath(PAGE);
  return {
    ok: r.isDefault
      ? "Adresse d'origine de Link Affi enregistrée."
      : "Adresse enregistrée : les prochains événements partiront vers elle.",
  };
}

export type TestEventState = {
  outcome?: LinkaffiTestOutcome;
  message?: string;
  error?: string;
} | null;

export async function sendLinkaffiTestEventAction(
  _prev: TestEventState,
  _formData: FormData,
): Promise<TestEventState> {
  const user = await admin();
  if (!user) return { error: ADMIN_ONLY };
  const r = await runLinkaffiTestEvent(user.id);
  if (!r.ok) return { error: r.error };
  return { outcome: r.outcome, message: r.message };
}
