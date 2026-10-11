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
import { planVariants, variantScheduledAt } from "@/lib/posts/ab";
import { buttonUrlError, type PostButtonRow } from "@/lib/posts/buttons";
import { assertButtonRows, materializeOfferButton } from "@/lib/campaigns/offer-button";
import { isOfferToChoose, rowsToVerify, templateOfferButton } from "@/lib/posts/offer-buttons";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";

function back(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}
function isRedirect(err: unknown): boolean {
  return (
    typeof (err as { digest?: string })?.digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

/**
 * Crée ou met à jour les liens traqués des boutons (BUTTON / OFFER) et renvoie les boutons à stocker.
 * `relinked` : un lien Offre déjà enregistré a changé de campagne ou d'offre (recalcul des statistiques à demander).
 * `isTemplate` : un bouton Offre dont la campagne reste à choisir est gardé tel quel, sans lien (voir
 * `lib/posts/offer-buttons.ts`) ; la campagne se choisit en utilisant le modèle.
 */
async function materializeButtons(
  rows: PostFormInput["buttons"],
  post: { id: string; channelId: string; isTemplate: boolean },
  userId: string,
): Promise<{ buttons: PostButtonRow[]; relinked: boolean }> {
  const out: PostButtonRow[] = [];
  let relinked = false;
  for (const row of rows) {
    const line: PostButtonRow = [];
    for (const b of row) {
      const urlError = buttonUrlError(b);
      if (urlError) throw new Error(urlError);
      if (b.type === "URL") {
        line.push({ text: b.text, type: "URL", url: b.url });
        continue;
      }
      if (b.type === "BUTTON") {
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
                // Adresse vérifiée plus haut (buttonUrlError).
                destinationTemplate: b.url!,
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
      if (post.isTemplate && isOfferToChoose(b)) {
        line.push(templateOfferButton(b));
        continue;
      }
      // OFFER : la campagne choisie détermine le lien Link Affi (voir lib/campaigns/offer-button.ts).
      const offer = await materializeOfferButton(b, {
        channelId: post.channelId,
        postId: post.id,
        userId,
      });
      relinked ||= offer.relinked;
      line.push(offer.button);
    }
    if (line.length > 0) out.push(line);
  }
  return { buttons: out, relinked };
}

function validateText(
  input: Pick<PostFormInput, "text" | "mediaAssetIds" | "buttons">,
  label = "Le message",
): string {
  const hasMedia = input.mediaAssetIds.length > 0;
  const r = validateTelegramHtml(input.text, {
    max: hasMedia && input.mediaAssetIds.length === 1 ? undefined : undefined,
  });
  if (!r.ok) throw new Error(r.error);
  if (!hasMedia && r.textLength === 0)
    throw new Error(`${label} est vide : ajoutez un texte ou un média.`);
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

/**
 * Création : un Post par canal (liés par duplicatedFromId), brouillon, programmé ou modèle.
 * Test A/B (pas pour un modèle) : pour chaque canal coché, deux Post (A puis B) avec le même `abGroupId` ;
 * B part 30 minutes après A dans le même canal, ou à la même heure dans l'autre canal choisi.
 */
export async function createPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = parsePostForm(formData);
  if (!parsed.success)
    back("/messages/new", {
      error: parsed.error.issues[0]?.message ?? "Vérifiez le formulaire : une valeur est invalide.",
    });
  const input = parsed.data;
  // Messages déjà créés par cette action : retirés si l'enregistrement échoue en cours de route.
  const created: string[] = [];
  try {
    const html = validateText(input);
    const isTemplate = input.intent === "template";
    const abEnabled = input.abEnabled && !isTemplate;
    const htmlB = abEnabled
      ? validateText(
          { text: input.textB, mediaAssetIds: input.mediaAssetIdsB, buttons: input.buttonsB },
          "La version B",
        )
      : "";
    const schedule = isTemplate
      ? { status: "DRAFT" as const, scheduledAt: null }
      : resolveSchedule(input);
    // Tous les boutons (A et B) sont vérifiés AVANT de créer le moindre message : un bouton refusé ne laisse jamais
    // un message programmé en base, qui partirait sans ses boutons. Modèle : un bouton Offre sans campagne est gardé.
    await assertButtonRows(rowsToVerify(input.buttons, isTemplate));
    if (abEnabled) await assertButtonRows(input.buttonsB);
    let firstId: string | null = null;
    let relinked = false;
    const groups: string[] = [];
    const journal: Array<{ postId: string; metadata: Record<string, string | null> }> = [];
    for (const channelId of input.channelIds) {
      const variants = planVariants(
        { channelId, text: html, mediaAssetIds: input.mediaAssetIds, buttons: input.buttons },
        {
          abEnabled,
          abMode: input.abMode,
          abChannelId: input.abChannelId,
          abDelayMinutes: input.abDelayMinutes,
          textB: htmlB,
          mediaAssetIdsB: input.mediaAssetIdsB,
          buttonsB: input.buttonsB,
        },
      );
      const abGroupId = variants.length > 1 ? shortId(10) : null;
      if (abGroupId) groups.push(abGroupId);
      for (const v of variants) {
        const bot = await publishingBotFor(v.channelId);
        if (!bot)
          throw new Error(
            "Un des canaux choisis n'a aucun bot administrateur actif : ajoutez un bot dans Telegram (page Canaux).",
          );
        const channel = isTemplate
          ? await prisma.channel.findUnique({
              where: { id: v.channelId },
              select: { vertical: true },
            })
          : null;
        const dupFrom: string | null = firstId ?? input.duplicatedFromId ?? null;
        // Créé en brouillon : il ne devient « programmé » qu'une fois ses boutons enregistrés (voir plus bas).
        const post: { id: string } = await prisma.post.create({
          select: { id: true },
          data: {
            code: shortId(8),
            channelId: v.channelId,
            botId: bot.id,
            status: "DRAFT",
            scheduledAt: variantScheduledAt(schedule.scheduledAt, v.offsetMinutes),
            categoryId: input.categoryId ?? null,
            language: input.language,
            text: v.text,
            mediaAssetIds: v.mediaAssetIds,
            buttons: [],
            pinAfterSend: input.pinAfterSend,
            unpinPrevious: input.unpinPrevious,
            deleteAfterMinutes: input.deleteAfterMinutes,
            disableNotification: input.disableNotification,
            protectContent: input.protectContent,
            disableLinkPreview: input.disableLinkPreview,
            isTemplate,
            templateName: isTemplate ? input.templateName || "Modèle sans nom" : null,
            vertical: channel?.vertical ?? null,
            abGroupId,
            abVariant: abGroupId ? v.variant : null,
            createdById: user.id,
            updatedById: user.id,
            duplicatedFromId: dupFrom,
          },
        });
        created.push(post.id);
        const m = await materializeButtons(
          v.buttons,
          { id: post.id, channelId: v.channelId, isTemplate },
          user.id,
        );
        relinked ||= m.relinked;
        await prisma.post.update({
          where: { id: post.id },
          data: { buttons: m.buttons as unknown as Prisma.InputJsonValue },
        });
        firstId ??= post.id;
        journal.push({
          postId: post.id,
          metadata: {
            channelId: v.channelId,
            scheduledAt:
              variantScheduledAt(schedule.scheduledAt, v.offsetMinutes)?.toISOString() ?? null,
            abGroupId,
            abVariant: abGroupId ? v.variant : null,
          },
        });
      }
    }
    // Tous les messages et leurs boutons sont enregistrés : ils peuvent maintenant être programmés.
    if (schedule.status === "SCHEDULED")
      await prisma.post.updateMany({
        where: { id: { in: created } },
        data: { status: "SCHEDULED" },
      });
    for (const j of journal)
      await audit({
        userId: user.id,
        action: isTemplate
          ? "post.template_created"
          : schedule.status === "SCHEDULED"
            ? "post.scheduled"
            : "post.drafted",
        entityType: "Post",
        entityId: j.postId,
        metadata: j.metadata,
      });
    if (relinked) await refreshCampaignStats();
    revalidatePath("/messages");
    const msg = isTemplate
      ? "Modèle enregistré."
      : abEnabled
        ? `Test A/B enregistré : ${created.length} messages (${groups.length} test${groups.length > 1 ? "s" : ""}).`
        : schedule.status === "SCHEDULED"
          ? `${created.length} message(s) programmé(s).`
          : `${created.length} brouillon(s) enregistré(s).`;
    if (groups.length === 1) back(`/messages/ab/${groups[0]}`, { ok: msg });
    back(created.length === 1 ? `/messages/${created[0]}` : "/messages", { ok: msg });
  } catch (err) {
    if (isRedirect(err)) throw err;
    if (created.length) await discardCreated(created);
    // Copie d'un message ou d'un modèle : on revient sur la copie (contenu rechargé) plutôt qu'un formulaire vide.
    back("/messages/new", {
      ...(input.duplicatedFromId ? { from: input.duplicatedFromId } : {}),
      error: err instanceof Error ? err.message : "Enregistrement impossible.",
    });
  }
}

/** Retire les messages (et leurs liens traqués tout neufs) créés par une création qui a échoué. */
async function discardCreated(postIds: string[]): Promise<void> {
  try {
    await prisma.trackingLink.deleteMany({ where: { postId: { in: postIds } } });
    await prisma.post.deleteMany({ where: { id: { in: postIds } } });
  } catch (err) {
    console.error("messages créés non retirés après un échec", err);
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
    // Modèle : un bouton Offre dont la campagne reste à choisir est gardé tel quel (modèles fournis compris).
    await assertButtonRows(rowsToVerify(input.buttons, post.isTemplate));
    const { buttons, relinked } = await materializeButtons(
      input.buttons,
      { id: post.id, channelId, isTemplate: post.isTemplate },
      user.id,
    );
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
    // Ancien bouton Offre rattaché à une campagne (ou passé d'une campagne à une autre) : ses clics passés changent
    // de campagne, les statistiques journalières sont recalculées depuis le début.
    if (relinked) await refreshCampaignStats();
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
