"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeSegment, shortId, validateTelegramHtml, type Segment } from "@linkaffipro/core";
import { prisma, audit, toJsonValue } from "@linkaffipro/db";
import { enqueue, enqueueDm } from "@linkaffipro/queue";
import { offerDeepLink } from "@linkaffipro/telegram";
import { env } from "@/lib/env";
import { fromParisLocal } from "@/lib/posts/time";
import type { PostButtonRow } from "@/lib/posts/buttons";
import { parseBroadcastForm } from "@/lib/broadcasts/schema";
import { requireUser } from "@/lib/session";

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
 */
async function materializeButtons(rows: PostButtonRow[], b: { id: string; botId: string; text: string; segment: Segment }, userId: string): Promise<PostButtonRow[]> {
  const hasOffer = rows.some((r) => r.some((x) => x.type === "OFFER"));
  const hasTracked = rows.some((r) => r.some((x) => x.type !== "URL"));
  let container: { id: string; channelId: string } | null = null;
  if (hasTracked) {
    container = await prisma.post.findFirst({ where: { templateName: `broadcast:${b.id}` }, select: { id: true, channelId: true } });
    if (!container) {
      const channelId = b.segment.channelIds?.[0] ?? (await prisma.channel.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
      if (!channelId) throw new Error("Aucun canal actif : impossible de créer des boutons traqués.");
      container = await prisma.post.create({
        data: { code: shortId(8), channelId, botId: b.botId, status: "SENT", sentAt: new Date(), text: b.text, templateName: `broadcast:${b.id}`, createdById: userId },
        select: { id: true, channelId: true },
      });
    }
  }
  const out: PostButtonRow[] = [];
  for (const row of rows) {
    const line: PostButtonRow = [];
    for (const x of row) {
      if (x.type === "URL") {
        if (!x.url || !/^https?:\/\//i.test(x.url)) throw new Error(`Bouton « ${x.text} » : l'URL doit commencer par https://.`);
        line.push({ text: x.text, type: "URL", url: x.url });
        continue;
      }
      if (x.type === "BUTTON") {
        if (!x.url || !/^https?:\/\//i.test(x.url)) throw new Error(`Bouton « ${x.text} » : l'URL doit commencer par https://.`);
        const link = x.trackingLinkId
          ? await prisma.trackingLink.update({ where: { id: x.trackingLinkId }, data: { destinationTemplate: x.url, label: x.text, isActive: true } })
          : await prisma.trackingLink.create({ data: { slug: shortId(8), kind: "BUTTON", destinationTemplate: x.url, label: `${x.text} (envoi groupé)`, channelId: container!.channelId, postId: container!.id, createdById: userId } });
        line.push({ text: x.text, type: "BUTTON", url: x.url, trackingLinkId: link.id, slug: link.slug });
        continue;
      }
      if (!x.affiliateCampaignId) throw new Error(`Bouton « ${x.text} » : choisissez une campagne Link Affi.`);
      const campaign = await prisma.affiliateCampaign.findUnique({ where: { id: x.affiliateCampaignId } });
      if (!campaign || !campaign.isActive) throw new Error(`Bouton « ${x.text} » : campagne Link Affi introuvable ou inactive.`);
      const link = x.trackingLinkId
        ? await prisma.trackingLink.update({ where: { id: x.trackingLinkId }, data: { destinationTemplate: campaign.trackingUrlTemplate, affiliateCampaignId: campaign.id, label: x.text, isActive: true } })
        : await prisma.trackingLink.create({ data: { slug: shortId(8), kind: "OFFER", destinationTemplate: campaign.trackingUrlTemplate, label: `${x.text} (envoi groupé)`, channelId: container!.channelId, postId: container!.id, affiliateCampaignId: campaign.id, createdById: userId } });
      line.push({ text: x.text, type: "OFFER", trackingLinkId: link.id, slug: link.slug, affiliateCampaignId: campaign.id });
    }
    if (line.length > 0) out.push(line);
  }
  if (hasOffer && container) await prisma.post.update({ where: { id: container.id }, data: { buttons: toJsonValue(out) } });
  return out;
}

/** Lignes `{ text, url }` pour un message de test (même résolution que le worker). */
async function resolveForDm(rows: PostButtonRow[], botUsername: string, broadcastId: string): Promise<Array<Array<{ text: string; url: string }>>> {
  const container = await prisma.post.findFirst({ where: { templateName: `broadcast:${broadcastId}` }, select: { code: true } });
  const base = env.trackingBaseUrl;
  return rows
    .map((row) =>
      row
        .map((x) => {
          if (x.type === "URL") return { text: x.text, url: x.url ?? "" };
          if (x.type === "BUTTON") return { text: x.text, url: x.slug ? `${base}/${x.slug}` : "" };
          return { text: x.text, url: x.slug ? offerDeepLink(botUsername, x.slug, container?.code ?? "") : "" };
        })
        .filter((x) => /^https?:\/\//.test(x.url)),
    )
    .filter((r) => r.length > 0);
}

export async function createBroadcastAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = parseBroadcastForm(formData);
  if (!parsed.success) back("/broadcasts/new", { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." });
  const d = parsed.data;
  const v = validateTelegramHtml(d.text);
  if (!v.ok) back("/broadcasts/new", { error: `Texte invalide : ${v.error}` });
  let scheduledAt: Date | null = null;
  if (d.intent === "schedule") {
    scheduledAt = d.scheduledAt ? fromParisLocal(d.scheduledAt) : null;
    if (!scheduledAt || scheduledAt.getTime() < Date.now() - 60_000) back("/broadcasts/new", { error: "Choisissez une date et une heure dans le futur." });
  }
  const bot = await prisma.bot.findUnique({ where: { id: d.botId } });
  if (!bot || !bot.isActive) back("/broadcasts/new", { error: "Bot introuvable ou inactif." });
  let id = "";
  try {
    const b = await prisma.broadcast.create({
      data: { name: d.name, botId: d.botId, segment: toJsonValue(d.segment), text: v.html, mediaAssetId: d.mediaAssetId ?? null, status: "DRAFT", createdById: user.id },
      select: { id: true },
    });
    id = b.id;
    const buttons = await materializeButtons(d.buttons as PostButtonRow[], { id: b.id, botId: d.botId, text: v.html, segment: d.segment }, user.id);
    const status = d.intent === "now" ? "SENDING" : d.intent === "schedule" ? "SCHEDULED" : "DRAFT";
    await prisma.broadcast.update({ where: { id: b.id }, data: { buttons: toJsonValue(buttons), status, scheduledAt, startedAt: d.intent === "now" ? new Date() : null } });
    if (d.intent === "now") await enqueue("scheduler", { type: "broadcast", broadcastId: b.id }, { jobId: `broadcast-${b.id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } });
    await audit({ userId: user.id, action: "broadcast.created", entityType: "Broadcast", entityId: b.id, metadata: { name: d.name, intent: d.intent, segment: describeSegment(d.segment) } });
  } catch (err) {
    if (isRedirect(err)) throw err;
    if (id) await prisma.broadcast.delete({ where: { id } }).catch(() => undefined);
    back("/broadcasts/new", { error: err instanceof Error ? err.message : "Création impossible." });
  }
  revalidatePath("/broadcasts");
  back(`/broadcasts/${id}`, { ok: d.intent === "now" ? "Envoi lancé." : d.intent === "schedule" ? "Envoi programmé." : "Brouillon enregistré." });
}

export async function sendNowAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
  if (b.status !== "DRAFT" && b.status !== "SCHEDULED") back(`/broadcasts/${id}`, { error: "Cet envoi ne peut plus être lancé." });
  await prisma.broadcast.update({ where: { id }, data: { status: "SENDING", startedAt: new Date(), scheduledAt: null } });
  await enqueue("scheduler", { type: "broadcast", broadcastId: id }, { jobId: `broadcast-${id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } });
  await audit({ userId: user.id, action: "broadcast.sent_now", entityType: "Broadcast", entityId: id });
  revalidatePath("/broadcasts");
  back(`/broadcasts/${id}`, { ok: "Envoi lancé : les messages partent dans les limites Telegram." });
}

export async function scheduleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const at = fromParisLocal(String(formData.get("scheduledAt") ?? ""));
  if (!at || at.getTime() < Date.now() - 60_000) back(`/broadcasts/${id}`, { error: "Choisissez une date et une heure dans le futur." });
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
  if (b.status !== "DRAFT" && b.status !== "SCHEDULED") back(`/broadcasts/${id}`, { error: "Cet envoi ne peut plus être programmé." });
  await prisma.broadcast.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: at } });
  await audit({ userId: user.id, action: "broadcast.scheduled", entityType: "Broadcast", entityId: id, metadata: { scheduledAt: at.toISOString() } });
  back(`/broadcasts/${id}`, { ok: "Envoi programmé." });
}

export async function cancelBroadcastAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
  if (b.status === "SENT" || b.status === "CANCELLED") back(`/broadcasts/${id}`, { error: "Cet envoi est déjà terminé." });
  const r = await prisma.outboundMessage.updateMany({ where: { broadcastId: id, status: "QUEUED" }, data: { status: "FAILED", error: "Annulé" } });
  await prisma.broadcast.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date(), failed: { increment: r.count } } });
  await audit({ userId: user.id, action: "broadcast.cancelled", entityType: "Broadcast", entityId: id, metadata: { remaining: r.count } });
  revalidatePath("/broadcasts");
  back(`/broadcasts/${id}`, { ok: `Envoi annulé (${r.count} message(s) non envoyé(s)).` });
}

export async function testToMeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id }, include: { bot: true } });
  if (!user.telegramUserId) back(`/broadcasts/${id}`, { error: "Liez d'abord votre Telegram dans Mon compte." });
  const member = await prisma.member.findUnique({ where: { telegramUserId: user.telegramUserId }, include: { botStates: { where: { botId: b.botId } } } });
  if (!member || !member.botStates[0]?.canDm) back(`/broadcasts/${id}`, { error: `Envoyez d'abord /start à @${b.bot.username} depuis votre Telegram.` });
  const buttons = await resolveForDm((b.buttons as PostButtonRow[]) ?? [], b.bot.username, b.id);
  await enqueueDm({ botId: b.botId, memberId: member.id, kind: "TEST", text: b.text, buttons });
  await audit({ userId: user.id, action: "broadcast.test_sent", entityType: "Broadcast", entityId: id });
  back(`/broadcasts/${id}`, { ok: "Message de test envoyé sur votre Telegram." });
}

export async function deleteDraftAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
  if (b.status !== "DRAFT" && b.status !== "CANCELLED") back(`/broadcasts/${id}`, { error: "Seuls les brouillons et les envois annulés peuvent être retirés." });
  await prisma.outboundMessage.updateMany({ where: { broadcastId: id }, data: { broadcastId: null } });
  await prisma.broadcast.delete({ where: { id } });
  await audit({ userId: user.id, action: "broadcast.deleted", entityType: "Broadcast", entityId: id, metadata: { name: b.name } });
  revalidatePath("/broadcasts");
  back("/broadcasts", { ok: "Envoi retiré." });
}
