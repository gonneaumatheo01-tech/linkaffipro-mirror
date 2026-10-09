"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeSegment, parseSegment, shortId, validateTelegramHtml, type Segment } from "@linkaffipro/core";
import { prisma, audit, toJsonValue, type Prisma } from "@linkaffipro/db";
import { enqueue, enqueueDm } from "@linkaffipro/queue";
import { offerDeepLink } from "@linkaffipro/telegram";
import { env } from "@/lib/env";
import { fromParisLocal } from "@/lib/posts/time";
import type { PostButtonRow } from "@/lib/posts/buttons";
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
  const ab = parseAbForm(formData);
  let htmlB = "";
  if (ab.enabled) {
    if (!ab.textB) back("/broadcasts/new", { error: "Test A/B : le texte de la variante B est vide." });
    const vb = validateTelegramHtml(ab.textB);
    if (!vb.ok) back("/broadcasts/new", { error: `Texte de la variante B invalide : ${vb.error}` });
    htmlB = vb.html;
  }
  let scheduledAt: Date | null = null;
  if (d.intent === "schedule") {
    scheduledAt = d.scheduledAt ? fromParisLocal(d.scheduledAt) : null;
    if (!scheduledAt || scheduledAt.getTime() < Date.now() - 60_000) back("/broadcasts/new", { error: "Choisissez une date et une heure dans le futur." });
  }
  const bot = await prisma.bot.findUnique({ where: { id: d.botId } });
  if (!bot || !bot.isActive) back("/broadcasts/new", { error: "Bot introuvable ou inactif." });
  const status = d.intent === "now" ? "SENDING" : d.intent === "schedule" ? "SCHEDULED" : "DRAFT";
  const abGroupId = ab.enabled ? shortId(10) : null;
  const created: string[] = [];
  try {
    // Chaque variante d'un test A/B est un envoi à part entière (même segment, même groupe, part propre).
    const variants: Array<{ suffix: string; text: string; buttons: PostButtonRow[]; mediaAssetId: string | null; variant: string | null; split: number | null }> = ab.enabled
      ? [
          { suffix: " — A", text: v.html, buttons: d.buttons as PostButtonRow[], mediaAssetId: d.mediaAssetId ?? null, variant: "A", split: ab.split },
          { suffix: " — B", text: htmlB, buttons: (Array.isArray(ab.buttonsB) ? ab.buttonsB : []) as PostButtonRow[], mediaAssetId: ab.mediaAssetIdB ?? null, variant: "B", split: 100 - ab.split },
        ]
      : [{ suffix: "", text: v.html, buttons: d.buttons as PostButtonRow[], mediaAssetId: d.mediaAssetId ?? null, variant: null, split: null }];
    for (const variant of variants) {
      const b = await prisma.broadcast.create({
        data: { name: `${d.name}${variant.suffix}`, botId: d.botId, segment: toJsonValue(d.segment), text: variant.text, mediaAssetId: variant.mediaAssetId, status: "DRAFT", createdById: user.id, abGroupId, abVariant: variant.variant, abSplit: variant.split },
        select: { id: true },
      });
      created.push(b.id);
      const buttons = await materializeButtons(variant.buttons, { id: b.id, botId: d.botId, text: variant.text, segment: d.segment }, user.id);
      await prisma.broadcast.update({ where: { id: b.id }, data: { buttons: toJsonValue(buttons), status, scheduledAt, startedAt: d.intent === "now" ? new Date() : null } });
      if (d.intent === "now") await enqueue("scheduler", { type: "broadcast", broadcastId: b.id }, { jobId: `broadcast-${b.id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } });
      await audit({ userId: user.id, action: "broadcast.created", entityType: "Broadcast", entityId: b.id, metadata: { name: d.name, intent: d.intent, segment: describeSegment(d.segment), abGroupId, abVariant: variant.variant, abSplit: variant.split } });
    }
  } catch (err) {
    if (isRedirect(err)) throw err;
    if (created.length) await prisma.broadcast.deleteMany({ where: { id: { in: created } } }).catch(() => undefined);
    back("/broadcasts/new", { error: err instanceof Error ? err.message : "Création impossible." });
  }
  revalidatePath("/broadcasts");
  const okMsg = d.intent === "now" ? "Envoi lancé." : d.intent === "schedule" ? "Envoi programmé." : "Brouillon enregistré.";
  if (abGroupId) back(`/broadcasts/ab/${abGroupId}`, { ok: `Test A/B créé (${ab.enabled ? ab.split : 50} % / ${ab.enabled ? 100 - ab.split : 50} %). ${okMsg}` });
  back(`/broadcasts/${created[0]}`, { ok: okMsg });
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
  if (!cmp) back("/broadcasts", { error: "Test A/B introuvable." });
  if (cmp.rest) back(`/broadcasts/ab/${groupId}`, { error: "L'envoi au reste a déjà été créé." });
  const winner = pickWinner(cmp.variants);
  if (winner.status !== "winner") back(`/broadcasts/ab/${groupId}`, { error: "Pas encore de gagnant significatif : attendez au moins 30 envois par variante et un écart de taux de clic." });
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
    // Nouveaux liens traqués et nouveau message conteneur pour l'envoi au reste : les clics de la gagnante restent comptés à part.
    const fresh = (Array.isArray(b.buttons) ? (b.buttons as PostButtonRow[]) : []).map((row) => row.map(({ trackingLinkId: _t, slug: _s, ...x }) => x));
    const buttons = await materializeButtons(fresh, { id: rest.id, botId: b.botId, text: b.text, segment: parseSegment(b.segment) }, user.id);
    await prisma.broadcast.update({ where: { id: rest.id }, data: { buttons: toJsonValue(buttons), status: "SENDING", startedAt: new Date() } });
  } catch (err) {
    if (isRedirect(err)) throw err;
    await prisma.broadcast.delete({ where: { id: rest.id } }).catch(() => undefined);
    back(`/broadcasts/ab/${groupId}`, { error: err instanceof Error ? err.message : "Envoi au reste impossible." });
  }
  await enqueue("scheduler", { type: "broadcast", broadcastId: rest.id }, { jobId: `broadcast-${rest.id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } });
  await audit({ userId: user.id, action: "broadcast.ab_winner_sent", entityType: "Broadcast", entityId: rest.id, metadata: { groupId, winner: winner.variant, ctr: winner.ctr } });
  revalidatePath("/broadcasts");
  back(`/broadcasts/ab/${groupId}`, { ok: `Variante ${winner.variant} envoyée au reste du segment.` });
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
  await enqueueDm({ botId: b.botId, memberId: member.id, kind: "TEST", text: b.text, buttons, mediaAssetId: b.mediaAssetId ?? null });
  await audit({ userId: user.id, action: "broadcast.test_sent", entityType: "Broadcast", entityId: id });
  back(`/broadcasts/${id}`, { ok: "Message de test envoyé sur votre Telegram." });
}

export async function deleteDraftAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("broadcastId"));
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
  if (b.status !== "DRAFT" && b.status !== "CANCELLED") back(`/broadcasts/${id}`, { error: "Seuls les brouillons et les envois annulés peuvent être retirés." });
  await prisma.outboundMessage.updateMany({ where: { broadcastId: id }, data: { broadcastId: null } });
  await prisma.broadcast.delete({ where: { id } });
  await audit({ userId: user.id, action: "broadcast.deleted", entityType: "Broadcast", entityId: id, metadata: { name: b.name } });
  revalidatePath("/broadcasts");
  back("/broadcasts", { ok: "Envoi retiré." });
}
