"use server";

import { SEQUENCE_LANGS } from "./langs";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateTelegramHtml } from "@linkaffipro/core";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { enqueueDm } from "@linkaffipro/queue";
import {
  ensureDefaultSequences,
  previewText,
  type SequenceTriggerKey,
} from "@linkaffipro/telegram";
import { requireUser } from "@/lib/session";

const TRIGGERS = [
  "JOIN_REQUEST",
  "GATE_REMINDER",
  "GATE_SATISFIED",
  "APPROVED",
  "OFFER_REPLY",
] as const;

function back(channelId: string, params: Record<string, string>): never {
  redirect(
    `/channels/${channelId}?${new URLSearchParams({ tab: "sequences", ...params }).toString()}`,
  );
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

async function stepFor(channelId: string, trigger: SequenceTriggerKey) {
  await ensureDefaultSequences(channelId);
  const seq = await prisma.sequence.findFirst({
    where: { channelId, trigger },
    include: { steps: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!seq) throw new Error("Séquence introuvable.");
  const step =
    seq.steps[0] ??
    (await prisma.sequenceStep.create({
      data: { sequenceId: seq.id, order: 0, texts: {}, buttons: [] },
    }));
  return {
    seq,
    step,
    texts: (step.texts && typeof step.texts === "object"
      ? (step.texts as Record<string, string>)
      : {}) as Record<string, string>,
  };
}

const saveSchema = z.object({
  channelId: z.string().min(1),
  trigger: z.enum(TRIGGERS),
  lang: z.string().regex(/^[a-z]{2}$/),
  text: z.string().max(5000),
});

/** Enregistre le texte d'une langue pour un déclencheur. */
export async function saveSequenceTextAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger, lang, text } = parsed.data;
  if (lang === "fr" && !text.trim())
    back(channelId, {
      error:
        "Le texte en français est obligatoire : c'est celui que reçoivent les membres dont la langue n'est pas traduite.",
      ...where(formData, trigger, lang),
    });
  const v = validateTelegramHtml(text.trim());
  if (!v.ok) back(channelId, { error: v.error, ...where(formData, trigger, lang) });
  const { seq, step, texts } = await stepFor(channelId, trigger);
  texts[lang] = v.html;
  await prisma.sequenceStep.update({
    where: { id: step.id },
    data: { texts: texts as unknown as Prisma.InputJsonValue },
  });
  await audit({
    userId: user.id,
    action: "sequence.text_saved",
    entityType: "Sequence",
    entityId: seq.id,
    metadata: { trigger, lang },
  });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, {
    ok: `Texte ${lang.toUpperCase()} enregistré.`,
    ...where(formData, trigger, lang),
  });
}

const translationsSchema = z.object({
  channelId: z.string().min(1),
  trigger: z.enum(TRIGGERS),
  texts: z.partialRecord(z.enum(SEQUENCE_LANGS), z.string().max(5000)),
});

/**
 * Enregistre les traductions proposées par l'assistant IA (« Traduire dans les langues du bot ») dans les autres
 * langues d'un déclencheur : ajoute la langue si elle manque, remplace son texte sinon. Tout ou rien : un texte
 * invalide (HTML Telegram) bloque l'enregistrement. Appelée depuis le navigateur : renvoie un résultat, pas de redirection.
 */
export async function saveSequenceTranslationsAction(input: {
  channelId: string;
  trigger: SequenceTriggerKey;
  texts: Partial<Record<string, string>>;
}): Promise<{ ok: true; saved: string[] } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = translationsSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Traductions refusées : langue ou message inconnu." };
  const { channelId, trigger } = parsed.data;
  const entries = Object.entries(parsed.data.texts).filter(
    (e): e is [string, string] => typeof e[1] === "string",
  );
  if (entries.length === 0) return { ok: false, error: "Aucune traduction à enregistrer." };
  const clean: Record<string, string> = {};
  for (const [lang, text] of entries) {
    if (lang === "fr" && !text.trim())
      return { ok: false, error: "Le texte en français ne peut pas être vide." };
    const v = validateTelegramHtml(text.trim());
    if (!v.ok) return { ok: false, error: `Traduction ${lang.toUpperCase()} refusée : ${v.error}` };
    clean[lang] = v.html;
  }
  try {
    const { seq, step, texts } = await stepFor(channelId, trigger);
    const next = { ...texts, ...clean };
    await prisma.sequenceStep.update({
      where: { id: step.id },
      data: { texts: next as unknown as Prisma.InputJsonValue },
    });
    const saved = Object.keys(clean);
    await audit({
      userId: user.id,
      action: "sequence.translations_saved",
      entityType: "Sequence",
      entityId: seq.id,
      metadata: { trigger, langs: saved, source: "ai" },
    });
    revalidatePath(`/channels/${channelId}`);
    return { ok: true, saved };
  } catch {
    return { ok: false, error: "Message introuvable : rechargez la page et réessayez." };
  }
}

/** Ajoute une langue (copie du français comme point de départ). */
export async function addSequenceLangAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z
    .object({
      channelId: z.string().min(1),
      trigger: z.enum(TRIGGERS),
      lang: z.enum(SEQUENCE_LANGS),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger, lang } = parsed.data;
  const { seq, step, texts } = await stepFor(channelId, trigger);
  if (texts[lang] === undefined) {
    texts[lang] = texts.fr ?? "";
    await prisma.sequenceStep.update({
      where: { id: step.id },
      data: { texts: texts as unknown as Prisma.InputJsonValue },
    });
    await audit({
      userId: user.id,
      action: "sequence.lang_added",
      entityType: "Sequence",
      entityId: seq.id,
      metadata: { trigger, lang },
    });
  }
  revalidatePath(`/channels/${channelId}`);
  back(channelId, {
    ok: `Langue ${lang.toUpperCase()} ajoutée : traduisez le texte puis enregistrez.`,
    open: trigger,
    ...(lang !== "fr" ? { lang } : {}),
  });
}

/** Retire une langue (jamais le français). */
export async function removeSequenceLangAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z
    .object({
      channelId: z.string().min(1),
      trigger: z.enum(TRIGGERS),
      lang: z.string().regex(/^[a-z]{2}$/),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger, lang } = parsed.data;
  if (lang === "fr") back(channelId, { error: "Le français ne peut pas être retiré." });
  const { seq, step, texts } = await stepFor(channelId, trigger);
  delete texts[lang];
  await prisma.sequenceStep.update({
    where: { id: step.id },
    data: { texts: texts as unknown as Prisma.InputJsonValue },
  });
  await audit({
    userId: user.id,
    action: "sequence.lang_removed",
    entityType: "Sequence",
    entityId: seq.id,
    metadata: { trigger, lang },
  });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: `Langue ${lang.toUpperCase()} retirée.`, open: trigger });
}

/** Active ou désactive une séquence (désactivée : le bot utilise son texte intégré par défaut). */
export async function toggleSequenceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z
    .object({ channelId: z.string().min(1), trigger: z.enum(TRIGGERS) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger } = parsed.data;
  const { seq } = await stepFor(channelId, trigger);
  await prisma.sequence.update({ where: { id: seq.id }, data: { isActive: !seq.isActive } });
  await audit({
    userId: user.id,
    action: seq.isActive ? "sequence.deactivated" : "sequence.activated",
    entityType: "Sequence",
    entityId: seq.id,
    metadata: { trigger },
  });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, {
    ok: seq.isActive
      ? "Message désactivé : le bot utilisera son texte intégré par défaut."
      : "Message activé : le bot utilisera votre texte.",
    ...where(formData, trigger),
  });
}

/** Choisit (ou retire) le média joint aux messages d'un déclencheur. */
export async function setSequenceMediaAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z
    .object({
      channelId: z.string().min(1),
      trigger: z.enum(TRIGGERS),
      mediaAssetId: z.string().max(64).optional().default(""),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger, mediaAssetId } = parsed.data;
  const { seq, step } = await stepFor(channelId, trigger);
  let id: string | null = null;
  if (mediaAssetId) {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: mediaAssetId },
      select: { id: true },
    });
    if (!asset) back(channelId, { error: "Média introuvable.", open: trigger });
    id = asset.id;
  }
  await prisma.sequenceStep.update({ where: { id: step.id }, data: { mediaAssetId: id } });
  await audit({
    userId: user.id,
    action: id ? "sequence.media_set" : "sequence.media_removed",
    entityType: "Sequence",
    entityId: seq.id,
    metadata: { trigger, mediaAssetId: id },
  });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: id ? "Média joint enregistré." : "Média retiré.", open: trigger });
}

/** Envoie le texte à l'utilisateur connecté (Telegram lié) via la file, avec des exemples pour les placeholders. */
export async function sendSequenceTestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z
    .object({
      channelId: z.string().min(1),
      trigger: z.enum(TRIGGERS),
      lang: z.string().regex(/^[a-z]{2}$/),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger, lang } = parsed.data;
  if (!user.telegramUserId)
    back(channelId, {
      error: "Liez votre Telegram dans Mon compte (menu en haut à droite) pour recevoir un test.",
      ...where(formData, trigger, lang),
    });
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { botAdmins: { where: { revokedAt: null }, select: { botId: true } } },
  });
  if (!channel) redirect("/channels");
  const botId = channel.primaryBotId ?? channel.botAdmins[0]?.botId ?? null;
  if (!botId)
    back(channelId, {
      error: "Aucun de nos bots n'est administrateur de ce canal : ajoutez-en un dans Telegram.",
      ...where(formData, trigger, lang),
    });
  const member = await prisma.member.findUnique({
    where: { telegramUserId: user.telegramUserId },
    select: { id: true, botStates: { where: { botId }, select: { canDm: true } } },
  });
  if (!member)
    back(channelId, {
      error: "Envoyez d'abord /start au bot de ce canal depuis votre Telegram.",
      ...where(formData, trigger, lang),
    });
  if (member.botStates[0] && !member.botStates[0].canDm)
    back(channelId, {
      error: "Le bot ne peut pas vous écrire : envoyez-lui /start.",
      ...where(formData, trigger, lang),
    });
  const { step, texts } = await stepFor(channelId, trigger);
  const template = texts[lang] ?? texts.fr;
  if (!template)
    back(channelId, { error: "Aucun texte à envoyer.", ...where(formData, trigger, lang) });
  const text = previewText(template, { canal: channel.title, prenom: user.name });
  await enqueueDm({
    botId,
    memberId: member.id,
    kind: "TEST",
    text: `🧪 Test (${trigger}, ${lang.toUpperCase()})\n\n${text}`,
    mediaAssetId: step.mediaAssetId ?? null,
  });
  await audit({
    userId: user.id,
    action: "sequence.test_sent",
    entityType: "Channel",
    entityId: channelId,
    metadata: { trigger, lang },
  });
  back(channelId, {
    ok: "Message de test envoyé sur votre Telegram (quelques secondes).",
    ...where(formData, trigger, lang),
  });
}
