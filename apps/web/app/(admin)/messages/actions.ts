"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  TELEGRAM_CAPTION_MAX,
  hasCustomEmoji,
  shortId,
  validateTelegramHtml,
  type MtprotoPublishStatus,
} from "@linkaffipro/core";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { requireAdmin, requireUser } from "@/lib/session";
import { env } from "@/lib/env";
import { parsePostForm, type PostFormInput } from "@/lib/posts/schema";
import { publishingBotFor } from "@/lib/posts/queries";
import { fromParisLocal } from "@/lib/posts/time";
import { planVariants, variantScheduledAt } from "@/lib/posts/ab";
import { buttonUrlError, type PostButtonRow } from "@/lib/posts/buttons";
import { assertButtonRows, materializeOfferButton } from "@/lib/campaigns/offer-button";
import { isOfferToChoose, rowsToVerify, templateOfferButton } from "@/lib/posts/offer-buttons";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";
import {
  accountProblemsFor,
  planPostVersion,
  scheduleRefusal,
  type EmojiButtonsChoice,
  type PostPublisherValue,
} from "@/lib/posts/publisher";
import { loadChatTypes, loadPublishStatus, requestAccountCheck } from "@/lib/posts/account-publish";
import { attachTextOfferLinks, createTextOfferLink } from "@/lib/posts/offer-link-db";
import { markCustomEmojisUsed } from "@/lib/custom-emoji/usage";

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

type VersionPlan = {
  text: string;
  buttons: PostFormInput["buttons"];
  publisher: PostPublisherValue;
};

/**
 * Emojis animés (phase 12) : texte, boutons et auteur d'une version (`planPostVersion`) selon le type du canal (un
 * groupe ou un supergroupe reçoit les emojis animés du bot, avec ses boutons). Lève le refus lisible quand un message
 * de canal a des emojis animés et des boutons sans que l'équipe ait choisi.
 */
function planVersion(input: {
  text: string;
  buttons: PostFormInput["buttons"];
  choice: EmojiButtonsChoice | null;
  isTemplate: boolean;
  chatType?: string | null;
}): VersionPlan {
  const plan = planPostVersion(input);
  if (!plan.ok) throw new Error(plan.error);
  return { text: plan.text, buttons: plan.buttons, publisher: plan.publisher };
}

/** Telegram réserve la protection d'un message aux bots : jamais enregistrée pour un message publié par le compte. */
function protectFor(publisher: PostPublisherValue, requested: boolean): boolean {
  return publisher === "ACCOUNT" ? false : requested;
}

/**
 * Programmation d'un message publié par le compte connecté : le compte doit pouvoir publier dans chacun de ses canaux
 * (connecté, Premium, administrateur avec le droit de publier, d'après le dernier relevé). Sinon la phrase du refus
 * (le message est gardé en brouillon), null si tout va bien. Les messages publiés par le bot (groupes compris) ne sont
 * pas concernés.
 */
async function accountScheduleRefusal(
  versions: ReadonlyArray<{ channelId: string; publisher: PostPublisherValue }>,
  count = 1,
): Promise<string | null> {
  const ids = [
    ...new Set(versions.filter((v) => v.publisher === "ACCOUNT").map((v) => v.channelId)),
  ];
  if (ids.length === 0) return null;
  const [status, channels] = await Promise.all([
    loadPublishStatus(),
    prisma.channel.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }),
  ]);
  const titled = ids.map((id) => ({
    id,
    title: channels.find((c) => c.id === id)?.title ?? "ce canal",
  }));
  return scheduleRefusal(accountProblemsFor(status, titled), count);
}

/**
 * Création : un Post par canal (liés par duplicatedFromId), brouillon, programmé ou modèle.
 * Test A/B (pas pour un modèle) : pour chaque canal coché, deux Post (A puis B) avec le même `abGroupId` ;
 * B part 30 minutes après A dans le même canal, ou à la même heure dans l'autre canal choisi.
 * Emojis animés (phase 12) : une version qui en garde est publiée par le compte Telegram connecté, sans boutons ; avec
 * des boutons, le choix « emojis » / « boutons » est exigé. Programmer alors que le compte ne peut pas publier dans un
 * des canaux : les messages sont gardés en brouillon (rien n'est perdu) et le refus est expliqué.
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
  // Liens d'offre du texte rattachés à ces messages : rendus libres (pas supprimés) si l'enregistrement échoue.
  const claimedLinks: string[] = [];
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
    // Emojis animés : qui publie chaque version, avec quel texte et quels boutons, selon le type de chaque canal (canal :
    // compte connecté sans boutons, ou bot avec les emojis normaux si l'équipe garde les boutons ; groupe : le bot, tout
    // gardé ; un modèle garde tout tel quel). Une version par type de canal, prévue avant la moindre écriture.
    const choice = input.emojiButtonsChoice ?? null;
    const otherChannelB = abEnabled && input.abMode === "other-channel";
    const chatTypes =
      isTemplate || !(hasCustomEmoji(html) || hasCustomEmoji(htmlB))
        ? new Map<string, string>()
        : await loadChatTypes([
            ...input.channelIds,
            ...(otherChannelB && input.abChannelId ? [input.abChannelId] : []),
          ]);
    const typeOf = (channelId: string | undefined) =>
      (channelId && chatTypes.get(channelId)) || "CHANNEL";
    const plans = new Map<string, VersionPlan>();
    const planOf = (version: "A" | "B", chatType: string): VersionPlan => {
      const key = `${version}:${chatType}`;
      let plan = plans.get(key);
      if (!plan) {
        plan =
          version === "A"
            ? planVersion({ text: html, buttons: input.buttons, choice, isTemplate, chatType })
            : planVersion({
                text: htmlB,
                buttons: input.buttonsB,
                choice,
                isTemplate: false,
                chatType,
              });
        plans.set(key, plan);
      }
      return plan;
    };
    const targets = input.channelIds.map((channelId) => {
      const typeA = typeOf(channelId);
      const typeB = otherChannelB ? typeOf(input.abChannelId) : typeA;
      return { channelId, a: planOf("A", typeA), b: abEnabled ? planOf("B", typeB) : null };
    });
    // Tous les boutons (A et B) sont vérifiés AVANT de créer le moindre message : un bouton refusé ne laisse jamais
    // un message programmé en base, qui partirait sans ses boutons. Modèle : un bouton Offre sans campagne est gardé.
    const verified = new Set<string>();
    for (const t of targets)
      for (const [plan, template] of [
        [t.a, isTemplate],
        [t.b, false],
      ] as const) {
        if (!plan) continue;
        const rows = rowsToVerify(plan.buttons, template);
        const key = JSON.stringify(rows);
        if (verified.has(key)) continue;
        verified.add(key);
        await assertButtonRows(rows);
      }
    // Toutes les versions de tous les canaux, prévues avant la moindre écriture.
    const perChannel = targets.map((t) =>
      planVariants(
        {
          channelId: t.channelId,
          text: t.a.text,
          mediaAssetIds: input.mediaAssetIds,
          buttons: t.a.buttons,
        },
        {
          abEnabled,
          abMode: input.abMode,
          abChannelId: input.abChannelId,
          abDelayMinutes: input.abDelayMinutes,
          textB: t.b?.text ?? "",
          mediaAssetIdsB: input.mediaAssetIdsB,
          buttonsB: t.b?.buttons ?? [],
        },
      ).map((v) => ({ ...v, publisher: (v.variant === "B" && t.b ? t.b : t.a).publisher })),
    );
    const refusal =
      schedule.status === "SCHEDULED"
        ? await accountScheduleRefusal(perChannel.flat(), perChannel.flat().length)
        : null;
    const scheduled = schedule.status === "SCHEDULED" && !refusal;
    let firstId: string | null = null;
    let relinked = false;
    const groups: string[] = [];
    const stored: string[] = [];
    const journal: Array<{ postId: string; metadata: Record<string, string | null> }> = [];
    for (const variants of perChannel) {
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
        const publisher = v.publisher;
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
            publisher,
            pinAfterSend: input.pinAfterSend,
            unpinPrevious: input.unpinPrevious,
            deleteAfterMinutes: input.deleteAfterMinutes,
            disableNotification: input.disableNotification,
            protectContent: protectFor(publisher, input.protectContent),
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
        // Offre ajoutée comme lien dans le texte : le lien est rattaché à ce message (copié s'il en a déjà un).
        const linked = await attachTextOfferLinks(
          v.text,
          { id: post.id, channelId: v.channelId },
          { userId: user.id, trackingBaseUrl: env.trackingBaseUrl },
        );
        stored.push(linked.html);
        claimedLinks.push(...linked.claimed);
        await prisma.post.update({
          where: { id: post.id },
          data: {
            buttons: m.buttons as unknown as Prisma.InputJsonValue,
            ...(linked.html !== v.text ? { text: linked.html } : {}),
          },
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
            publisher,
          },
        });
      }
    }
    // Tous les messages et leurs boutons sont enregistrés : ils peuvent maintenant être programmés.
    if (scheduled)
      await prisma.post.updateMany({
        where: { id: { in: created } },
        data: { status: "SCHEDULED" },
      });
    for (const j of journal)
      await audit({
        userId: user.id,
        action: isTemplate
          ? "post.template_created"
          : scheduled
            ? "post.scheduled"
            : "post.drafted",
        entityType: "Post",
        entityId: j.postId,
        metadata: j.metadata,
      });
    // Emojis animés utilisés : « Récents de l'équipe » dans le sélecteur.
    await markCustomEmojisUsed(stored);
    if (refusal) {
      if (relinked) await refreshCampaignStats();
      revalidatePath("/messages");
      // Gardés en brouillon : on rouvre le message (un seul) pour corriger, sinon le calendrier.
      back(created.length === 1 ? `/messages/${created[0]}/edit` : "/messages", {
        error: refusal,
      });
    }
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
    if (created.length) await discardCreated(created, claimedLinks);
    // Copie d'un message ou d'un modèle : on revient sur la copie (contenu rechargé) plutôt qu'un formulaire vide.
    back("/messages/new", {
      ...(input.duplicatedFromId ? { from: input.duplicatedFromId } : {}),
      error: err instanceof Error ? err.message : "Enregistrement impossible.",
    });
  }
}

/**
 * Retire les messages (et leurs liens traqués tout neufs) créés par une création qui a échoué. Les liens d'offre du texte
 * créés avant l'enregistrement (`claimed`) sont seulement détachés : le texte de l'équipe les contient toujours.
 */
async function discardCreated(postIds: string[], claimed: string[] = []): Promise<void> {
  try {
    if (claimed.length)
      await prisma.trackingLink.updateMany({
        where: { id: { in: claimed } },
        data: { postId: null, channelId: null },
      });
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
    // Emojis animés : publié par le compte connecté (boutons retirés) ou par le bot (emojis remplacés si l'équipe garde
    // les boutons) dans un canal ; par le bot, tout gardé, dans un groupe ; un modèle garde tout tel quel.
    const chatType =
      !post.isTemplate && hasCustomEmoji(html)
        ? ((await loadChatTypes([channelId])).get(channelId) ?? null)
        : null;
    const plan = planVersion({
      text: html,
      buttons: input.buttons,
      choice: input.emojiButtonsChoice ?? null,
      isTemplate: post.isTemplate,
      chatType,
    });
    // Modèle : un bouton Offre dont la campagne reste à choisir est gardé tel quel (modèles fournis compris).
    await assertButtonRows(rowsToVerify(plan.buttons, post.isTemplate));
    const { buttons, relinked } = await materializeButtons(
      plan.buttons,
      { id: post.id, channelId, isTemplate: post.isTemplate },
      user.id,
    );
    // Offre ajoutée comme lien dans le texte : rattachée à ce message (copiée si elle appartient à un autre).
    const linked = await attachTextOfferLinks(
      plan.text,
      { id: post.id, channelId },
      { userId: user.id, trackingBaseUrl: env.trackingBaseUrl },
    );
    const text = linked.html;
    const publisher = plan.publisher;
    // Programmer un message publié par le compte qui ne peut pas (encore) publier dans ce canal : gardé en brouillon.
    const refusal =
      schedule.status === "SCHEDULED"
        ? await accountScheduleRefusal([{ channelId, publisher }])
        : null;
    const status = refusal ? ("DRAFT" as const) : schedule.status;
    await prisma.post.update({
      where: { id: postId },
      data: {
        channelId,
        ...(bot ? { botId: bot.id } : {}),
        status,
        scheduledAt: schedule.scheduledAt,
        categoryId: input.categoryId ?? null,
        language: input.language,
        text,
        mediaAssetIds: input.mediaAssetIds,
        buttons: buttons as unknown as Prisma.InputJsonValue,
        publisher,
        pinAfterSend: input.pinAfterSend,
        unpinPrevious: input.unpinPrevious,
        deleteAfterMinutes: input.deleteAfterMinutes,
        disableNotification: input.disableNotification,
        protectContent: protectFor(publisher, input.protectContent),
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
      metadata: { status, publisher },
    });
    await markCustomEmojisUsed(text);
    // Ancien bouton Offre rattaché à une campagne (ou passé d'une campagne à une autre) : ses clics passés changent
    // de campagne, les statistiques journalières sont recalculées depuis le début.
    if (relinked) await refreshCampaignStats();
    revalidatePath("/messages");
    if (refusal) back(`/messages/${postId}/edit`, { error: refusal });
    back(`/messages/${postId}`, {
      ok: status === "SCHEDULED" ? "Message programmé." : "Message enregistré.",
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

/**
 * « Ajouter l'offre comme lien dans le texte » (message publié par le compte Telegram connecté, sans boutons) : crée le
 * lien traqué de l'offre de la campagne (clics comptés, sans identifiant de suivi par membre) et renvoie le lien à
 * ajouter au texte. Appelée depuis le formulaire : renvoie un résultat, jamais de redirection (le texte reste à l'écran).
 */
export async function createTextOfferLinkAction(input: {
  campaignId?: string;
  affiliateCampaignId?: string;
  label: string;
}): Promise<{ ok: true; html: string; url: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const label = String(input?.label ?? "").trim();
  if (!input?.campaignId) return { ok: false, error: "Choisissez la campagne de l'offre." };
  if (!input.affiliateCampaignId) return { ok: false, error: "Choisissez l'offre de la campagne." };
  try {
    const link = await createTextOfferLink({
      campaignId: input.campaignId,
      affiliateCampaignId: input.affiliateCampaignId,
      label,
      userId: user.id,
      trackingBaseUrl: env.trackingBaseUrl,
    });
    await audit({
      userId: user.id,
      action: "tracking_link.text_offer_created",
      entityType: "TrackingLink",
      entityId: link.id,
      metadata: {
        campaignId: input.campaignId,
        affiliateCampaignId: input.affiliateCampaignId,
        slug: link.slug,
      },
    });
    return { ok: true, html: link.html, url: link.url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Lien impossible à créer : réessayez.",
    };
  }
}

/**
 * « Vérifier » : demande au service d'arrière-plan de relever si le compte Telegram connecté peut publier dans ces
 * canaux (Premium, administrateur avec le droit de publier). Le formulaire attend ensuite le relevé
 * (`accountPublishStatusAction`), sans recharger la page.
 */
export async function checkAccountPublishAction(
  channelIds: string[],
): Promise<{ ok: true; requestedAt: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const ids = Array.isArray(channelIds) ? channelIds.filter((id) => typeof id === "string") : [];
  try {
    const r = await requestAccountCheck(ids);
    await audit({
      userId: user.id,
      action: "post.account_check_requested",
      entityType: "Channel",
      metadata: { channelIds: r.channelIds },
    });
    return { ok: true, requestedAt: r.requestedAt };
  } catch (err) {
    console.error("[messages] vérification du compte Telegram non demandée", err);
    return {
      ok: false,
      error: "Le service d'arrière-plan ne répond pas : réessayez dans une minute.",
    };
  }
}

/** Dernier relevé de l'état du compte Telegram connecté (null s'il n'y en a jamais eu). */
export async function accountPublishStatusAction(): Promise<MtprotoPublishStatus | null> {
  await requireUser();
  return loadPublishStatus();
}
