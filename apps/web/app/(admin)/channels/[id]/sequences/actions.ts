"use server";

import { SEQUENCE_LANGS } from "./langs";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateTelegramHtml } from "@linkaffipro/core";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { enqueueDm } from "@linkaffipro/queue";
import { ensureDefaultSequences, previewText, type SequenceTriggerKey } from "@linkaffipro/telegram";
import { requireUser } from "@/lib/session";

const TRIGGERS = ["JOIN_REQUEST", "GATE_REMINDER", "GATE_SATISFIED", "APPROVED", "OFFER_REPLY"] as const;

function back(channelId: string, params: Record<string, string>): never {
  redirect(`/channels/${channelId}?${new URLSearchParams({ tab: "sequences", ...params }).toString()}`);
}

async function stepFor(channelId: string, trigger: SequenceTriggerKey) {
  await ensureDefaultSequences(channelId);
  const seq = await prisma.sequence.findFirst({ where: { channelId, trigger }, include: { steps: { orderBy: { order: "asc" }, take: 1 } } });
  if (!seq) throw new Error("Séquence introuvable.");
  const step = seq.steps[0] ?? (await prisma.sequenceStep.create({ data: { sequenceId: seq.id, order: 0, texts: {}, buttons: [] } }));
  return { seq, step, texts: (step.texts && typeof step.texts === "object" ? (step.texts as Record<string, string>) : {}) as Record<string, string> };
}

const saveSchema = z.object({ channelId: z.string().min(1), trigger: z.enum(TRIGGERS), lang: z.string().regex(/^[a-z]{2}$/), text: z.string().max(5000) });

/** Enregistre le texte d'une langue pour un déclencheur. */
export async function saveSequenceTextAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger, lang, text } = parsed.data;
  if (lang === "fr" && !text.trim()) back(channelId, { error: "Le texte en français est obligatoire." });
  const v = validateTelegramHtml(text.trim());
  if (!v.ok) back(channelId, { error: v.error });
  const { seq, step, texts } = await stepFor(channelId, trigger);
  texts[lang] = v.html;
  await prisma.sequenceStep.update({ where: { id: step.id }, data: { texts: texts as unknown as Prisma.InputJsonValue } });
  await audit({ userId: user.id, action: "sequence.text_saved", entityType: "Sequence", entityId: seq.id, metadata: { trigger, lang } });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: `Texte ${lang.toUpperCase()} enregistré (${trigger}).`, open: trigger });
}

/** Ajoute une langue (copie du français comme point de départ). */
export async function addSequenceLangAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ channelId: z.string().min(1), trigger: z.enum(TRIGGERS), lang: z.enum(SEQUENCE_LANGS) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger, lang } = parsed.data;
  const { seq, step, texts } = await stepFor(channelId, trigger);
  if (texts[lang] === undefined) {
    texts[lang] = texts.fr ?? "";
    await prisma.sequenceStep.update({ where: { id: step.id }, data: { texts: texts as unknown as Prisma.InputJsonValue } });
    await audit({ userId: user.id, action: "sequence.lang_added", entityType: "Sequence", entityId: seq.id, metadata: { trigger, lang } });
  }
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: `Langue ${lang.toUpperCase()} ajoutée : traduisez le texte puis enregistrez.`, open: trigger });
}

/** Retire une langue (jamais le français). */
export async function removeSequenceLangAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ channelId: z.string().min(1), trigger: z.enum(TRIGGERS), lang: z.string().regex(/^[a-z]{2}$/) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger, lang } = parsed.data;
  if (lang === "fr") back(channelId, { error: "Le français ne peut pas être retiré." });
  const { seq, step, texts } = await stepFor(channelId, trigger);
  delete texts[lang];
  await prisma.sequenceStep.update({ where: { id: step.id }, data: { texts: texts as unknown as Prisma.InputJsonValue } });
  await audit({ userId: user.id, action: "sequence.lang_removed", entityType: "Sequence", entityId: seq.id, metadata: { trigger, lang } });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: `Langue ${lang.toUpperCase()} retirée.`, open: trigger });
}

/** Active ou désactive une séquence (désactivée : le bot utilise son texte intégré par défaut). */
export async function toggleSequenceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ channelId: z.string().min(1), trigger: z.enum(TRIGGERS) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger } = parsed.data;
  const { seq } = await stepFor(channelId, trigger);
  await prisma.sequence.update({ where: { id: seq.id }, data: { isActive: !seq.isActive } });
  await audit({ userId: user.id, action: seq.isActive ? "sequence.deactivated" : "sequence.activated", entityType: "Sequence", entityId: seq.id, metadata: { trigger } });
  revalidatePath(`/channels/${channelId}`);
  back(channelId, { ok: seq.isActive ? "Séquence désactivée : le bot utilisera son texte intégré." : "Séquence activée.", open: trigger });
}

/** Envoie le texte à l'utilisateur connecté (Telegram lié) via la file, avec des exemples pour les placeholders. */
export async function sendSequenceTestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ channelId: z.string().min(1), trigger: z.enum(TRIGGERS), lang: z.string().regex(/^[a-z]{2}$/) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/channels");
  const { channelId, trigger, lang } = parsed.data;
  if (!user.telegramUserId) back(channelId, { error: "Liez votre Telegram dans Mon compte (menu en haut à droite) pour recevoir un test.", open: trigger });
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, include: { botAdmins: { where: { revokedAt: null }, select: { botId: true } } } });
  if (!channel) redirect("/channels");
  const botId = channel.primaryBotId ?? channel.botAdmins[0]?.botId ?? null;
  if (!botId) back(channelId, { error: "Aucun bot administrateur sur ce canal.", open: trigger });
  const member = await prisma.member.findUnique({ where: { telegramUserId: user.telegramUserId }, select: { id: true, botStates: { where: { botId }, select: { canDm: true } } } });
  if (!member) back(channelId, { error: "Envoyez d'abord /start au bot de ce canal depuis votre Telegram.", open: trigger });
  if (member.botStates[0] && !member.botStates[0].canDm) back(channelId, { error: "Le bot ne peut pas vous écrire : envoyez-lui /start.", open: trigger });
  const { texts } = await stepFor(channelId, trigger);
  const template = texts[lang] ?? texts.fr;
  if (!template) back(channelId, { error: "Aucun texte à envoyer.", open: trigger });
  const text = previewText(template, { canal: channel.title, prenom: user.name });
  await enqueueDm({ botId, memberId: member.id, kind: "TEST", text: `🧪 Test (${trigger}, ${lang.toUpperCase()})\n\n${text}` });
  await audit({ userId: user.id, action: "sequence.test_sent", entityType: "Channel", entityId: channelId, metadata: { trigger, lang } });
  back(channelId, { ok: "Message de test envoyé sur votre Telegram (quelques secondes).", open: trigger });
}
