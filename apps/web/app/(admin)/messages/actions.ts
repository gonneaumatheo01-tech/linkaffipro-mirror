"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TELEGRAM_CAPTION_MAX, shortId, validateTelegramHtml } from "@linkaffipro/core";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { requireAdmin, requireUser } from "@/lib/session";
import { parsePostForm, type PostFormInput } from "@/lib/posts/schema";
import { publishingBotFor } from "@/lib/posts/queries";
import { fromParisLocal } from "@/lib/posts/time";
import type { PostButtonRow } from "@/lib/posts/buttons";

function back(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}
function isRedirect(err: unknown): boolean {
  return (
    typeof (err as { digest?: string })?.digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

/** Crée ou met à jour les liens traqués des boutons (BUTTON / OFFER) et renvoie les boutons à stocker. */
async function materializeButtons(
  rows: PostFormInput["buttons"],
  post: { id: string; channelId: string },
  userId: string,
): Promise<PostButtonRow[]> {
  const out: PostButtonRow[] = [];
  for (const row of rows) {
    const line: PostButtonRow = [];
    for (const b of row) {
      if (b.type === "URL") {
        if (!b.url || !/^https?:\/\//i.test(b.url))
          throw new Error(`Bouton « ${b.text} » : l'adresse doit commencer par https://.`);
        line.push({ text: b.text, type: "URL", url: b.url });
        continue;
      }
      if (b.type === "BUTTON") {
        if (!b.url || !/^https?:\/\//i.test(b.url))
          throw new Error(`Bouton « ${b.text} » : l'adresse doit commencer par https://.`);
        const existing = b.trackingLinkId
          ? await prisma.trackingLink.findUnique({ where: { id: b.trackingLinkId } })
          : null;
        const link = existing
          ? await prisma.trackingLink.update({
              where: { id: existing.id },
              data: { destinationTemplate: b.url, label: b.text, isActive: true },
            })
          : await prisma.trackingLink.create({
              data: {
                slug: shortId(8),
                kind: "BUTTON",
                destinationTemplate: b.url,
                label: b.text,
                channelId: post.channelId,
                postId: post.id,
                createdById: userId,
              },
            });
        line.push({
          text: b.text,
          type: "BUTTON",
          url: b.url,
          trackingLinkId: link.id,
          slug: link.slug,
        });
        continue;
      }
      // OFFER
      if (!b.affiliateCampaignId)
        throw new Error(`Bouton « ${b.text} » : choisissez une campagne Link Affi.`);
      const campaign = await prisma.affiliateCampaign.findUnique({
        where: { id: b.affiliateCampaignId },
      });
      if (!campaign || !campaign.isActive)
        throw new Error(`Bouton « ${b.text} » : campagne Link Affi introuvable ou inactive.`);
      const existing = b.trackingLinkId
        ? await prisma.trackingLink.findUnique({ where: { id: b.trackingLinkId } })
        : null;
      const link = existing
        ? await prisma.trackingLink.update({
            where: { id: existing.id },
            data: {
              destinationTemplate: campaign.trackingUrlTemplate,
              affiliateCampaignId: campaign.id,
              label: b.text,
              isActive: true,
            },
          })
        : await prisma.trackingLink.create({
            data: {
              slug: shortId(8),
              kind: "OFFER",
              destinationTemplate: campaign.trackingUrlTemplate,
              label: b.text,
              channelId: post.channelId,
              postId: post.id,
              affiliateCampaignId: campaign.id,
              createdById: userId,
            },
          });
      line.push({
        text: b.text,
        type: "OFFER",
        trackingLinkId: link.id,
        slug: link.slug,
        affiliateCampaignId: campaign.id,
      });
    }
    if (line.length > 0) out.push(line);
  }
  return out;
}

function validateText(input: PostFormInput): string {
  const hasMedia = input.mediaAssetIds.length > 0;
  const r = validateTelegramHtml(input.text, {
    max: hasMedia && input.mediaAssetIds.length === 1 ? undefined : undefined,
  });
  if (!r.ok) throw new Error(r.error);
  if (!hasMedia && r.textLength === 0)
    throw new Error("Le message est vide : ajoutez un texte ou un média.");
  if (hasMedia && r.textLength > TELEGRAM_CAPTION_MAX && input.buttons.length > 0) {
    // Autorisé : le worker envoie le média puis un message texte avec les boutons.
  }
  return r.html;
}

function resolveSchedule(input: PostFormInput): {
  status: "DRAFT" | "SCHEDULED";
  scheduledAt: Date | null;
} {
  if (input.intent !== "schedule")
    return {
      status: "DRAFT",
      scheduledAt: input.scheduledAt ? fromParisLocal(input.scheduledAt) : null,
    };
  const at = input.scheduledAt ? fromParisLocal(input.scheduledAt) : null;
  if (!at) throw new Error("Choisissez une date et une heure pour programmer l'envoi.");
  if (at.getTime() < Date.now() - 60_000)
    throw new Error("La date choisie est déjà passée : choisissez un moment à venir.");
  return { status: "SCHEDULED", scheduledAt: at };
}

/** Création : un Post par canal (liés par duplicatedFromId), brouillon, programmé ou modèle. */
export async function createPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = parsePostForm(formData);
  if (!parsed.success)
    back("/messages/new", {
      error: parsed.error.issues[0]?.message ?? "Vérifiez le formulaire : une valeur est invalide.",
    });
  const input = parsed.data;
  try {
    const html = validateText(input);
    const schedule =
      input.intent === "template"
        ? { status: "DRAFT" as const, scheduledAt: null }
        : resolveSchedule(input);
    let firstId: string | null = null;
    const created: string[] = [];
    for (const channelId of input.channelIds) {
      const bot = await publishingBotFor(channelId);
      if (!bot)
        throw new Error(
          "Un des canaux choisis n'a aucun bot administrateur actif : ajoutez un bot dans Telegram (page Canaux).",
        );
      const dupFrom: string | null = firstId ?? input.duplicatedFromId ?? null;
      const post: { id: string } = await prisma.post.create({
        select: { id: true },
        data: {
          code: shortId(8),
          channelId,
          botId: bot.id,
          status: schedule.status,
          scheduledAt: schedule.scheduledAt,
          categoryId: input.categoryId ?? null,
          language: input.language,
          text: html,
          mediaAssetIds: input.mediaAssetIds,
          buttons: [],
          pinAfterSend: input.pinAfterSend,
          unpinPrevious: input.unpinPrevious,
          deleteAfterMinutes: input.deleteAfterMinutes,
          disableNotification: input.disableNotification,
          protectContent: input.protectContent,
          disableLinkPreview: input.disableLinkPreview,
          isTemplate: input.intent === "template",
          templateName:
            input.intent === "template" ? input.templateName || "Modèle sans nom" : null,
          createdById: user.id,
          updatedById: user.id,
          duplicatedFromId: dupFrom,
        },
      });
      const buttons = await materializeButtons(input.buttons, { id: post.id, channelId }, user.id);
      await prisma.post.update({
        where: { id: post.id },
        data: { buttons: buttons as unknown as Prisma.InputJsonValue },
      });
      firstId ??= post.id;
      created.push(post.id);
      await audit({
        userId: user.id,
        action:
          input.intent === "template"
            ? "post.template_created"
            : schedule.status === "SCHEDULED"
              ? "post.scheduled"
              : "post.drafted",
        entityType: "Post",
        entityId: post.id,
        metadata: { channelId, scheduledAt: schedule.scheduledAt?.toISOString() ?? null },
      });
    }
    revalidatePath("/messages");
    const msg =
      input.intent === "template"
        ? "Modèle enregistré."
        : schedule.status === "SCHEDULED"
          ? `${created.length} message(s) programmé(s).`
          : `${created.length} brouillon(s) enregistré(s).`;
    back(created.length === 1 ? `/messages/${created[0]}` : "/messages", { ok: msg });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back("/messages/new", {
      error: err instanceof Error ? err.message : "Enregistrement impossible.",
    });
  }
}

/** Mise à jour d'un brouillon / message programmé (un seul canal). */
export async function updatePostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const parsed = parsePostForm(formData);
  if (!parsed.success)
    back(`/messages/${postId}/edit`, {
      error: parsed.error.issues[0]?.message ?? "Vérifiez le formulaire : une valeur est invalide.",
    });
  const input = parsed.data;
  try {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    if (!["DRAFT", "SCHEDULED", "FAILED", "CANCELLED"].includes(post.status))
      throw new Error("Ce message ne peut plus être modifié.");
    const html = validateText(input);
    const schedule = post.isTemplate
      ? { status: "DRAFT" as const, scheduledAt: null }
      : resolveSchedule(input);
    const channelId = input.channelIds[0] ?? post.channelId;
    const bot = channelId !== post.channelId ? await publishingBotFor(channelId) : null;
    const buttons = await materializeButtons(input.buttons, { id: post.id, channelId }, user.id);
    await prisma.post.update({
      where: { id: postId },
      data: {
        channelId,
        ...(bot ? { botId: bot.id } : {}),
        status: schedule.status,
        scheduledAt: schedule.scheduledAt,
        categoryId: input.categoryId ?? null,
        language: input.language,
        text: html,
        mediaAssetIds: input.mediaAssetIds,
        buttons: buttons as unknown as Prisma.InputJsonValue,
        pinAfterSend: input.pinAfterSend,
        unpinPrevious: input.unpinPrevious,
        deleteAfterMinutes: input.deleteAfterMinutes,
        disableNotification: input.disableNotification,
        protectContent: input.protectContent,
        disableLinkPreview: input.disableLinkPreview,
        templateName: post.isTemplate ? input.templateName || post.templateName : post.templateName,
        lastError: null,
        updatedById: user.id,
      },
    });
    await audit({
      userId: user.id,
      action: "post.updated",
      entityType: "Post",
      entityId: postId,
      metadata: { status: schedule.status },
    });
    revalidatePath("/messages");
    back(`/messages/${postId}`, {
      ok: schedule.status === "SCHEDULED" ? "Message programmé." : "Message enregistré.",
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back(`/messages/${postId}/edit`, {
      error: err instanceof Error ? err.message : "Enregistrement impossible.",
    });
  }
}

export async function cancelPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  if (post.status !== "SCHEDULED")
    back(`/messages/${postId}`, { error: "Seul un message programmé peut être annulé." });
  await prisma.post.update({
    where: { id: postId },
    data: { status: "CANCELLED", updatedById: user.id },
  });
  await audit({ userId: user.id, action: "post.cancelled", entityType: "Post", entityId: postId });
  revalidatePath("/messages");
  back(`/messages/${postId}`, {
    ok: "Envoi annulé : le message ne partira pas. Il reste modifiable et reprogrammable.",
  });
}

/** Décale un message programmé de N minutes (positif ou négatif). */
export async function shiftPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const minutes = Number(formData.get("minutes") ?? 0);
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  if (post.status !== "SCHEDULED" || !post.scheduledAt)
    back(`/messages/${postId}`, { error: "Seul un message programmé peut être décalé." });
  const at = new Date(post.scheduledAt.getTime() + minutes * 60_000);
  if (at.getTime() < Date.now())
    back(`/messages/${postId}`, { error: "La nouvelle date serait dans le passé." });
  await prisma.post.update({
    where: { id: postId },
    data: { scheduledAt: at, updatedById: user.id },
  });
  await audit({
    userId: user.id,
    action: "post.shifted",
    entityType: "Post",
    entityId: postId,
    metadata: { minutes },
  });
  revalidatePath("/messages");
  back(`/messages/${postId}`, { ok: `Message décalé de ${minutes > 0 ? "+" : ""}${minutes} min.` });
}

/** Supprime le message sur Telegram (via la file) et le marque supprimé. */
export async function deleteOnTelegramAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  if (post.status !== "SENT")
    back(`/messages/${postId}`, {
      error: "Seul un message déjà envoyé peut être supprimé du canal Telegram.",
    });
  await enqueue(
    "telegram-send",
    { type: "delete-post", postId },
    { jobId: `delete-post:${postId}:${Date.now()}` },
  );
  await audit({
    userId: user.id,
    action: "post.delete_requested",
    entityType: "Post",
    entityId: postId,
  });
  back(`/messages/${postId}`, {
    ok: "Suppression demandée : le message disparaît du canal Telegram dans quelques secondes.",
  });
}

/** Supprime un brouillon / modèle / message annulé de la plateforme (ADMIN et MANAGER : ce n'est pas une suppression de données tierces). */
export async function discardPostAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  if (!["DRAFT", "CANCELLED", "FAILED"].includes(post.status))
    back(`/messages/${postId}`, {
      error: "Seul un brouillon, un modèle ou un message annulé peut être retiré.",
    });
  await prisma.post.delete({ where: { id: postId } });
  await audit({ userId: user.id, action: "post.discarded", entityType: "Post", entityId: postId });
  revalidatePath("/messages");
  back("/messages", {
    ok: post.isTemplate ? "Modèle supprimé." : "Message retiré de la plateforme.",
  });
}

/** Enregistre un message existant comme modèle. */
export async function saveAsTemplateAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const name = String(formData.get("templateName") ?? "").trim() || "Modèle sans nom";
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  const tpl = await prisma.post.create({
    data: {
      code: shortId(8),
      channelId: post.channelId,
      botId: post.botId,
      status: "DRAFT",
      categoryId: post.categoryId,
      language: post.language,
      text: post.text,
      mediaAssetIds: post.mediaAssetIds as Prisma.InputJsonValue,
      buttons: stripTrackingIds(post.buttons),
      pinAfterSend: post.pinAfterSend,
      unpinPrevious: post.unpinPrevious,
      deleteAfterMinutes: post.deleteAfterMinutes,
      disableNotification: post.disableNotification,
      protectContent: post.protectContent,
      disableLinkPreview: post.disableLinkPreview,
      isTemplate: true,
      templateName: name,
      createdById: user.id,
      updatedById: user.id,
      duplicatedFromId: post.id,
    },
  });
  await audit({
    userId: user.id,
    action: "post.template_created",
    entityType: "Post",
    entityId: tpl.id,
    metadata: { from: postId, name },
  });
  back(`/messages/${postId}`, { ok: `Modèle « ${name} » enregistré.` });
}

/** Retire les identifiants de liens traqués (un duplicata doit avoir ses propres liens). */
function stripTrackingIds(buttons: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(buttons)) return [];
  return buttons.map((row) =>
    Array.isArray(row)
      ? row.map((b) => ({ ...(b as object), trackingLinkId: undefined, slug: undefined }))
      : [],
  ) as Prisma.InputJsonValue;
}
