"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SiteOpResult } from "@linkaffipro/agents";
import type { SequenceTriggerKey } from "@linkaffipro/telegram";
import { requireUser } from "@/lib/session";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import {
  sequenceLangAdd,
  sequenceLangRemove,
  sequenceMediaSet,
  sequenceTestSend,
  sequenceTextSave,
  sequenceToggle,
  sequenceTranslationsSave,
} from "@/lib/site-ops/ops/lot-b/sequences";

/**
 * Onglet « Messages du bot » de la fiche canal. La logique est dans les cœurs partagés avec Kevin
 * (`lib/site-ops/ops/lot-b/sequences.ts`, phase 34) ; ici : formulaire, retour sur la carte, rafraîchi.
 */

function back(channelId: string, params: Record<string, string>): never {
  redirect(`/channels/${channelId}?${new URLSearchParams({ tab: "sequences", ...params }).toString()}`);
}

/**
 * Paramètres de retour vers la carte du message : `open` (carte en modification) sauf si l'action vient de l'aperçu
 * (`mode=view`), et `lang` (onglet de langue à rouvrir).
 */
function where(formData: FormData, trigger: string, lang?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (formData.get("mode") !== "view") out.open = trigger;
  if (lang && lang !== "fr") out.lang = lang;
  return out;
}

/** Formulaire illisible : retour à la liste des canaux (comme avant). */
function unreadable(r: SiteOpResult): void {
  if (!r.ok && r.field === "_form") redirect("/channels");
}

function fields(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData);
}

/** Enregistre le texte d'une langue pour un déclencheur. */
export async function saveSequenceTextAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await sequenceTextSave({ ...fields(formData), lang: formData.get("lang") }, webActorOf(user));
  unreadable(r);
  const channelId = String(formData.get("channelId"));
  const trigger = String(formData.get("trigger"));
  const lang = String(formData.get("lang"));
  if (!r.ok) back(channelId, { error: r.error, ...where(formData, trigger, lang) });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: r.message, ...where(formData, trigger, lang) });
}

/**
 * Enregistre les traductions proposées par l'assistant IA (« Traduire dans les langues du bot ») dans les autres
 * langues d'un déclencheur. Tout ou rien. Appelée depuis le navigateur : renvoie un résultat, pas de redirection.
 */
export async function saveSequenceTranslationsAction(input: {
  channelId: string;
  trigger: SequenceTriggerKey;
  texts: Partial<Record<string, string>>;
}): Promise<{ ok: true; saved: string[] } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await sequenceTranslationsSave(
    { channelId: input?.channelId, trigger: input?.trigger, texts: input?.texts },
    webActorOf(user),
  );
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`/channels/${String(r.data?.channelId ?? "")}`);
  return { ok: true, saved: (r.data?.saved as string[]) ?? [] };
}

/** Ajoute une langue (copie du français comme point de départ). */
export async function addSequenceLangAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await sequenceLangAdd(fields(formData), webActorOf(user));
  unreadable(r);
  if (!r.ok) redirect("/channels");
  const { channelId, trigger, lang } = r.data as { channelId: string; trigger: string; lang: string };
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: r.message, open: trigger, ...(lang !== "fr" ? { lang } : {}) });
}

/** Retire une langue (jamais le français). */
export async function removeSequenceLangAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await sequenceLangRemove(fields(formData), webActorOf(user));
  unreadable(r);
  const channelId = String(formData.get("channelId"));
  if (!r.ok) back(channelId, { error: r.error });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: r.message, open: String(formData.get("trigger")) });
}

/** Active ou désactive une séquence (désactivée : le bot utilise son texte intégré par défaut). */
export async function toggleSequenceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await sequenceToggle(fields(formData), webActorOf(user));
  unreadable(r);
  if (!r.ok) redirect("/channels");
  const { channelId, trigger } = r.data as { channelId: string; trigger: string };
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: r.message, ...where(formData, trigger) });
}

/** Choisit (ou retire) le média joint aux messages d'un déclencheur. */
export async function setSequenceMediaAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await sequenceMediaSet(fields(formData), webActorOf(user));
  unreadable(r);
  const channelId = String(formData.get("channelId"));
  const trigger = String(formData.get("trigger"));
  if (!r.ok) back(channelId, { error: r.error, open: trigger });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: r.message, open: trigger });
}

/** Envoie le texte à l'utilisateur connecté (Telegram lié) via la file, avec des exemples pour les placeholders. */
export async function sendSequenceTestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await sequenceTestSend({ ...fields(formData), lang: formData.get("lang"), prenom: user.name }, {
    ...webActorOf(user),
    telegramUserId: user.telegramUserId ? user.telegramUserId.toString() : null,
  });
  unreadable(r);
  const channelId = String(formData.get("channelId"));
  const trigger = String(formData.get("trigger"));
  const lang = String(formData.get("lang"));
  if (!r.ok) back(channelId, { error: r.error, ...where(formData, trigger, lang) });
  back(channelId, { ok: r.message, ...where(formData, trigger, lang) });
}
