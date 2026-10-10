"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  describeSegment,
  parseSegment,
  shortId,
  validateTelegramHtml,
  type Segment,
} from "@linkaffipro/core";
import { prisma, audit, toJsonValue, type Prisma } from "@linkaffipro/db";
import { enqueue, enqueueDm } from "@linkaffipro/queue";
import { offerDeepLink } from "@linkaffipro/telegram";
import { env } from "@/lib/env";
import { fromParisLocal } from "@/lib/posts/time";
import { buttonUrlError, type PostButtonRow } from "@/lib/posts/buttons";
import { assertButtonRows, materializeOfferButton } from "@/lib/campaigns/offer-button";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";
import { parseBroadcastForm } from "@/lib/broadcasts/schema";
import { loadAbComparison } from "@/lib/broadcasts/ab-queries";
import { parseAbForm, pickWinner } from "@/lib/broadcasts/ab";
import { requireAdmin, requireUser } from "@/lib/session";

function back(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}
function isRedirect(err: unknown): boolean {
  return (err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT") ?? false;
}

/**
 * Matérialise les boutons : URL directe ; BUTTON → TrackingLink kind BUTTON ; OFFER → TrackingLink kind OFFER.
 * Les boutons Offre exigent un message « conteneur » (Post SENT, templateName `broadcast:<id>`) qui porte le
 * `code` du lien profond `/start o<slug>_<code>` et reçoit les statistiques de clics : un envoi groupé n'a pas
 * de Post propre, et le handler d'offres exige un code.
 * `copy` : copie faite par le serveur (envoi au reste d'un test A/B) : de nouveaux liens sont toujours créés, les
 * liens d'origine restent intacts, et un bouton Offre est repris tel quel (voir lib/campaigns/offer-button.ts).
 * `relinked` : un lien Offre déjà enregistré a changé de campagne ou d'offre (recalcul des statistiques à demander).
 */
async function materializeButtons(
  rows: PostButtonRow[],
  b: { id: string; botId: string; text: string; segment: Segment },
  userId: string,
  opts: { copy?: boolean } = {},
): Promise<{ buttons: PostButtonRow[]; relinked: boolean }> {
  const hasOffer = rows.some((r) => r.some((x) => x.type === "OFFER"));
  const hasTracked = rows.some((r) => r.some((x) => x.type !== "URL"));
  let container: { id: string; channelId: string } | null = null;
  if (hasTracked) {
    container = await prisma.post.findFirst({
      where: { templateName: `broadcast:${b.id}` },
      select: { id: true, channelId: true },
    });
    if (!container) {
      const channelId =
        b.segment.channelIds?.[0] ??
        (
          await prisma.channel.findFirst({
            where: { isActive: true },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          })
        )?.id;
      if (!channelId)
        throw new Error("Aucun canal actif : impossible de créer des boutons traqués.");
      container = await prisma.post.create({
        data: {
          code: shortId(8),
          channelId,
          botId: b.botId,
          status: "SENT",
          sentAt: new Date(),
          text: b.text,
          templateName: `broadcast:${b.id}`,
          createdById: userId,
        },
        select: { id: true, channelId: true },
      });
    }
  }
  const out: PostButtonRow[] = [];
  let relinked = false;
  for (const row of rows) {
    const line: PostButtonRow = [];
    for (const x of row) {
      const urlError = buttonUrlError(x);
      if (urlError) throw new Error(urlError);
      if (x.type === "URL") {
        line.push({ text: x.text, type: "URL", url: x.url });
        continue;
      }
      if (x.type === "BUTTON") {
        const link =
          x.trackingLinkId && !opts.copy
            ? await prisma.trackingLink.update({
                where: { id: x.trackingLinkId },
                data: { destinationTemplate: x.url, label: x.text, isActive: true },
              })
            : await prisma.trackingLink.create({
                data: {
                  slug: shortId(8),
                  kind: "BUTTON",
                  // Adresse vérifiée plus haut (buttonUrlError).
                  destinationTemplate: x.url!,
                  label: `${x.text} (envoi groupé)`,
                  channelId: container!.channelId,
                  postId: container!.id,
                  createdById: userId,
                },
              });
        line.push({
          text: x.text,
          type: "BUTTON",
          url: x.url,
          trackingLinkId: link.id,
          slug: link.slug,
        });
        continue;
      }
      // OFFER : la campagne choisie détermine le lien Link Affi (voir lib/campaigns/offer-button.ts).
      const offer = await materializeOfferButton(x, {
        channelId: container!.channelId,
        postId: container!.id,
        userId,
        labelSuffix: " (envoi groupé)",
        copy: opts.copy,
      });
      relinked ||= offer.relinked;
      line.push(offer.button);
    }
    if (line.length > 0) out.push(line);
  }
  if (hasOffer && container)
    await prisma.post.update({ where: { id: container.id }, data: { buttons: toJsonValue(out) } });
  return { buttons: out, relinked };
}

/** Retire les envois (et leurs messages conteneurs, avec leurs liens tout neufs) d'une création qui a échoué. */
async function discardBroadcasts(ids: string[]): Promise<void> {
  try {
    const containers = await prisma.post.findMany({
      where: { templateName: { in: ids.map((id) => `broadcast:${id}`) } },
      select: { id: true },
    });
    const postIds = containers.map((c) => c.id);
    if (postIds.length) {
      await prisma.trackingLink.deleteMany({ where: { postId: { in: postIds } } });
      await prisma.post.deleteMany({ where: { id: { in: postIds } } });
    }
    await prisma.broadcast.deleteMany({ where: { id: { in: ids } } });
  } catch (err) {
    console.error("envois créés non retirés après un échec", err);
  }
}

/** Lignes `{ text, url }` pour un message de test (même résolution que le worker). */
async function resolveForDm(
  rows: PostButtonRow[],
  botUsername: string,
  broadcastId: string,
): Promise<Array<Array<{ text: string; url: string }>>> {
  const container = await prisma.post.findFirst({
    where: { templateName: `broadcast:${broadcastId}` },
    select: { code: true },
  });
  const base = env.trackingBaseUrl;
  return rows
    .map((row) =>
      row
        .map((x) => {
          if (x.type === "URL") return { text: x.text, url: x.url ?? "" };
          if (x.type === "BUTTON") return { text: x.text, url: x.slug ? `${base}/${x.slug}` : "" };
          return {
            text: x.text,
            url: x.slug ? offerDeepLink(botUsername, x.slug, container?.code ?? "") : "",
          };
        })
        .filter((x) => /^https?:\/\//.test(x.url)),
    )
    .filter((r) => r.length > 0);
}

export async function createBroadcastAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = parseBroadcastForm(formData);
  if (!parsed.success)
    back("/members/broadcasts/new", {
      error: parsed.error.issues[0]?.message ?? "Formulaire invalide.",
    });
  const d = parsed.data;
  const v = validateTelegramHtml(d.text);
  if (!v.ok) back("/members/broadcasts/new", { error: `Texte invalide : ${v.error}` });
  const ab = parseAbForm(formData);
  let htmlB = "";
  if (ab.enabled) {
    if (!ab.textB)
      back("/members/broadcasts/new", { error: "Test A/B : le texte de la version B est vide." });
    const vb = validateTelegramHtml(ab.textB);
    if (!vb.ok)
      back("/members/broadcasts/new", { error: `Texte de la version B invalide : ${vb.error}` });
    htmlB = vb.html;
  }
  let scheduledAt: Date | null = null;
  if (d.intent === "schedule") {
    scheduledAt = d.scheduledAt ? fromParisLocal(d.scheduledAt) : null;
    if (!scheduledAt || scheduledAt.getTime() < Date.now() - 60_000)
      back("/members/broadcasts/new", { error: "Choisissez une date et une heure dans le futur." });
  }
  const bot = await prisma.bot.findUnique({ where: { id: d.botId } });
  if (!bot || !bot.isActive)
    back("/members/broadcasts/new", { error: "Ce bot est introuvable ou désactivé." });
  const status = d.intent === "now" ? "SENDING" : d.intent === "schedule" ? "SCHEDULED" : "DRAFT";
  const abGroupId = ab.enabled ? shortId(10) : null;
  const created: string[] = [];
  let relinked = false;
  try {
    // Chaque variante d'un test A/B est un envoi à part entière (même segment, même groupe, part propre).
    const variants: Array<{
      suffix: string;
      text: string;
      buttons: PostButtonRow[];
      mediaAssetId: string | null;
      variant: string | null;
      split: number | null;
    }> = ab.enabled
      ? [
          {
            suffix: " — A",
            text: v.html,
            buttons: d.buttons as PostButtonRow[],
            mediaAssetId: d.mediaAssetId ?? null,
            variant: "A",
            split: ab.split,
          },
          {
            suffix: " — B",
            text: htmlB,
            buttons: (Array.isArray(ab.buttonsB) ? ab.buttonsB : []) as PostButtonRow[],
            mediaAssetId: ab.mediaAssetIdB ?? null,
            variant: "B",
            split: 100 - ab.split,
          },
        ]
      : [
          {
            suffix: "",
            text: v.html,
            buttons: d.buttons as PostButtonRow[],
            mediaAssetId: d.mediaAssetId ?? null,
            variant: null,
            split: null,
          },
        ];
    // Tous les boutons sont vérifiés avant de créer le moindre envoi (aucun envoi programmé sans ses boutons).
    for (const variant of variants) await assertButtonRows(variant.buttons);
    for (const variant of variants) {
      const b = await prisma.broadcast.create({
        data: {
          name: `${d.name}${variant.suffix}`,
          botId: d.botId,
          segment: toJsonValue(d.segment),
          text: variant.text,
          mediaAssetId: variant.mediaAssetId,
          status: "DRAFT",
          createdById: user.id,
          abGroupId,
          abVariant: variant.variant,
          abSplit: variant.split,
        },
        select: { id: true },
      });
      created.push(b.id);
      const m = await materializeButtons(
        variant.buttons,
        { id: b.id, botId: d.botId, text: variant.text, segment: d.segment },
        user.id,
      );
      relinked ||= m.relinked;
      const buttons = m.buttons;
      await prisma.broadcast.update({
        where: { id: b.id },
        data: {
          buttons: toJsonValue(buttons),
          status,
          scheduledAt,
          startedAt: d.intent === "now" ? new Date() : null,
        },
      });
      if (d.intent === "now")
        await enqueue(
          "scheduler",
          { type: "broadcast", broadcastId: b.id },
          {
            jobId: `broadcast-${b.id}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          },
        );
      await audit({
        userId: user.id,
        action: "broadcast.created",
        entityType: "Broadcast",
        entityId: b.id,
        metadata: {
          name: d.name,
          intent: d.intent,
          segment: describeSegment(d.segment),
          abGroupId,
          abVariant: variant.variant,
          abSplit: variant.split,
        },
      });
    }
  } catch (err) {
    if (isRedirect(err)) throw err;
    if (created.length) await discardBroadcasts(created);
    back("/members/broadcasts/new", {
      error: err instanceof Error ? err.message : "Création impossible.",
    });
  }
  if (relinked) await refreshCampaignStats();
  revalidatePath("/members/broadcasts");
  const okMsg =
    d.intent === "now"
      ? "Envoi lancé."
      : d.intent === "schedule"
        ? "Envoi programmé."
        : "Brouillon enregistré.";
  if (abGroupId)
    back(`/members/broadcasts/ab/${abGroupId}`, {
      ok: `Test A/B créé (${ab.enabled ? ab.split : 50} % / ${ab.enabled ? 100 - ab.split : 50} %). ${okMsg}`,
    });
  back(`/members/broadcasts/${created[0]}`, { ok: okMsg });
}

/**
 * Envoie la variante gagnante d'un test A/B aux membres du segment pas encore servis :
 * nouvel envoi du même groupe avec `abVariant = REST`, que le worker développe en excluant
 * tous les destinataires déjà touchés par le test.
 */
export async function sendWinnerToRestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const groupId = z.string().min(1).parse(formData.get("groupId"));
  const cmp = await loadAbComparison(groupId);
  if (!cmp) back("/members/broadcasts", { error: "Test A/B introuvable." });
  if (cmp.rest)
    back(`/members/broadcasts/ab/${groupId}`, { error: "L'envoi au reste a déjà été créé." });
  const winner = pickWinner(cmp.variants);
  if (winner.status !== "winner")
    back(`/members/broadcasts/ab/${groupId}`, {
      error:
        "Pas encore de gagnante : attendez au moins 30 envois par version et un écart de taux de clic.",
    });
  const src = cmp.variants.find((x) => x.variant === winner.variant)!;
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id: src.id } });
  const rest = await prisma.broadcast.create({
    data: {
      name: b.name.replace(/ — [AB]$/, "") + ` — reste (gagnante ${winner.variant})`,
      botId: b.botId,
      segment: b.segment as Prisma.InputJsonValue,
      text: b.text,
      buttons: b.buttons as Prisma.InputJsonValue,
      mediaAssetId: b.mediaAssetId,
      status: "DRAFT",
      createdById: user.id,
      abGroupId: groupId,
      abVariant: "REST",
      abSplit: null,
    },
    select: { id: true },
  });
  try {
    // Nouveaux liens traqués et nouveau message conteneur pour l'envoi au reste : les clics de la gagnante restent
    // comptés à part. Copie faite par le serveur : les boutons de la gagnante sont repris tels quels (un ancien bouton
    // Offre sans campagne reste valable, une offre retirée de la campagne est remplacée comme le fait le bot).
    const source = Array.isArray(b.buttons) ? (b.buttons as PostButtonRow[]) : [];
    const { buttons } = await materializeButtons(
      source,
      { id: rest.id, botId: b.botId, text: b.text, segment: parseSegment(b.segment) },
      user.id,
      { copy: true },
    );
    await prisma.broadcast.update({
      where: { id: rest.id },
      data: { buttons: toJsonValue(buttons), status: "SENDING", startedAt: new Date() },
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    await discardBroadcasts([rest.id]);
    back(`/members/broadcasts/ab/${groupId}`, {
      error: err instanceof Error ? err.message : "Envoi au reste impossible.",
    });
  }
  await enqueue(
    "scheduler",
    { type: "broadcast", broadcastId: rest.id },
    { jobId: `broadcast-${rest.id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  );
  await audit({
    userId: user.id,
    action: "broadcast.ab_winner_sent",
    entityType: "Broadcast",
    entityId: rest.id,
    metadata: { groupId, winner: winner.variant, ctr: winner.ctr },
  });
  revalidatePath("/members/broadcasts");
  back(`/members/broadcasts/ab/${groupId}`, {
    ok: `Version ${winner.variant} envoyée au reste du segment.`,
  });
}

export async function sendNowAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
  if (b.status !== "DRAFT" && b.status !== "SCHEDULED")
    back(`/members/broadcasts/${id}`, {
      error: "Cet envoi est déjà parti ou annulé : il ne peut plus être lancé.",
    });
  await prisma.broadcast.update({
    where: { id },
    data: { status: "SENDING", startedAt: new Date(), scheduledAt: null },
  });
  await enqueue(
    "scheduler",
    { type: "broadcast", broadcastId: id },
    { jobId: `broadcast-${id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  );
  await audit({
    userId: user.id,
    action: "broadcast.sent_now",
    entityType: "Broadcast",
    entityId: id,
  });
  revalidatePath("/members/broadcasts");
  back(`/members/broadcasts/${id}`, {
    ok: "Envoi lancé : les messages partent progressivement, dans les limites imposées par Telegram.",
  });
}

export async function scheduleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const at = fromParisLocal(String(formData.get("scheduledAt") ?? ""));
  if (!at || at.getTime() < Date.now() - 60_000)
    back(`/members/broadcasts/${id}`, { error: "Choisissez une date et une heure dans le futur." });
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
  if (b.status !== "DRAFT" && b.status !== "SCHEDULED")
    back(`/members/broadcasts/${id}`, {
      error: "Cet envoi est déjà parti ou annulé : il ne peut plus être programmé.",
    });
  await prisma.broadcast.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: at } });
  await audit({
    userId: user.id,
    action: "broadcast.scheduled",
    entityType: "Broadcast",
    entityId: id,
    metadata: { scheduledAt: at.toISOString() },
  });
  back(`/members/broadcasts/${id}`, { ok: "Envoi programmé." });
}

export async function cancelBroadcastAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
  if (b.status === "SENT" || b.status === "CANCELLED")
    back(`/members/broadcasts/${id}`, { error: "Cet envoi est déjà terminé." });
  const r = await prisma.outboundMessage.updateMany({
    where: { broadcastId: id, status: "QUEUED" },
    data: { status: "FAILED", error: "Annulé" },
  });
  await prisma.broadcast.update({
    where: { id },
    data: { status: "CANCELLED", finishedAt: new Date(), failed: { increment: r.count } },
  });
  await audit({
    userId: user.id,
    action: "broadcast.cancelled",
    entityType: "Broadcast",
    entityId: id,
    metadata: { remaining: r.count },
  });
  revalidatePath("/members/broadcasts");
  back(`/members/broadcasts/${id}`, { ok: `Envoi annulé (${r.count} message(s) non envoyé(s)).` });
}

export async function testToMeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id }, include: { bot: true } });
  if (!user.telegramUserId)
    back(`/members/broadcasts/${id}`, {
      error: "Liez d'abord votre compte Telegram dans « Mon compte » (menu en haut à droite).",
    });
  const member = await prisma.member.findUnique({
    where: { telegramUserId: user.telegramUserId },
    include: { botStates: { where: { botId: b.botId } } },
  });
  if (!member || !member.botStates[0]?.canDm)
    back(`/members/broadcasts/${id}`, {
      error: `Envoyez d'abord /start à @${b.bot.username} depuis votre Telegram.`,
    });
  const buttons = await resolveForDm((b.buttons as PostButtonRow[]) ?? [], b.bot.username, b.id);
  await enqueueDm({
    botId: b.botId,
    memberId: member.id,
    kind: "TEST",
    text: b.text,
    buttons,
    mediaAssetId: b.mediaAssetId ?? null,
  });
  await audit({
    userId: user.id,
    action: "broadcast.test_sent",
    entityType: "Broadcast",
    entityId: id,
  });
  back(`/members/broadcasts/${id}`, {
    ok: "Message de test envoyé sur votre Telegram (quelques secondes).",
  });
}

export async function deleteDraftAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
  if (b.status !== "DRAFT" && b.status !== "CANCELLED")
    back(`/members/broadcasts/${id}`, {
      error: "Seuls les brouillons et les envois annulés peuvent être supprimés.",
    });
  await prisma.outboundMessage.updateMany({
    where: { broadcastId: id },
    data: { broadcastId: null },
  });
  await prisma.broadcast.delete({ where: { id } });
  await audit({
    userId: user.id,
    action: "broadcast.deleted",
    entityType: "Broadcast",
    entityId: id,
    metadata: { name: b.name },
  });
  revalidatePath("/members/broadcasts");
  back("/members/broadcasts", { ok: "Envoi supprimé." });
}
