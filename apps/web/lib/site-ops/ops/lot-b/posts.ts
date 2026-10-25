/**
 * Phase 34, lot B — cœurs des messages de canal (Messages : créer, programmer, modifier, annuler, décaler, déplacer,
 * supprimer sur Telegram, retirer, enregistrer comme modèle, offre en lien dans le texte, compte connecté). Appelés par
 * `app/(admin)/messages/actions.ts`, `move-action.ts` et par Kevin : mêmes validations, mêmes textes, même journal
 * (+ `via`). Pour Kevin, un message transféré (`content`, `ForwardedContent`) devient le texte tel quel : HTML Telegram
 * et `<tg-emoji>` gardés, rien n'est réécrit.
 */
import { z } from "zod";
import {
  TELEGRAM_CAPTION_MAX,
  hasCustomEmoji,
  shortId,
  validateTelegramHtml,
} from "@linkaffipro/core";
import { prisma, audit, type Prisma, type PostStatus } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { env } from "@/lib/env";
import { postFormSchema, type PostFormInput } from "@/lib/posts/schema";
import { publishingBotFor } from "@/lib/posts/queries";
import { fromParisLocal, toParisLocalInput } from "@/lib/posts/time";
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
import { existingAssets, forwardedMediaList, mediaSentence, providedAssetIds } from "@/lib/site-ops/forwarded-media";
import { momentLabel, toLocal } from "@/lib/posts/calendar";
import { checkMove, siblingMoves } from "@/lib/posts/move";
import {
  adminOnly,
  fail,
  isNextRedirect,
  ok,
  preview,
  resolveChannelRefs,
  resolveNamed,
  str,
  viaMeta,
  type CoreRun,
  type SiteOpActor,
  type SiteOpResult,
} from "./common";

type Fail = Extract<SiteOpResult, { ok: false }>;

/**
 * Crée ou met à jour les liens traqués des boutons (BUTTON / OFFER) et renvoie les boutons à stocker.
 * `relinked` : un lien Offre déjà enregistré a changé de campagne ou d'offre (recalcul des statistiques à demander).
 * `isTemplate` : un bouton Offre dont la campagne reste à choisir est gardé tel quel, sans lien.
 */
async function materializeButtons(
  rows: PostFormInput["buttons"],
  post: { id: string; channelId: string; isTemplate: boolean },
  userId: string | null,
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
        const existing = b.trackingLinkId ? await prisma.trackingLink.findUnique({ where: { id: b.trackingLinkId } }) : null;
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
        line.push({ text: b.text, type: "BUTTON", url: b.url, trackingLinkId: link.id, slug: link.slug });
        continue;
      }
      if (post.isTemplate && isOfferToChoose(b)) {
        line.push(templateOfferButton(b));
        continue;
      }
      // OFFER : la campagne choisie détermine le lien Link Affi (voir lib/campaigns/offer-button.ts).
      const offer = await materializeOfferButton(b, { channelId: post.channelId, postId: post.id, userId: userId ?? "" });
      relinked ||= offer.relinked;
      line.push(offer.button);
    }
    if (line.length > 0) out.push(line);
  }
  return { buttons: out, relinked };
}

function validateText(input: Pick<PostFormInput, "text" | "mediaAssetIds" | "buttons">, label = "Le message"): string {
  const hasMedia = input.mediaAssetIds.length > 0;
  const r = validateTelegramHtml(input.text, { max: undefined });
  if (!r.ok) throw new Error(r.error);
  if (!hasMedia && r.textLength === 0) throw new Error(`${label} est vide : ajoutez un texte ou un média.`);
  if (hasMedia && r.textLength > TELEGRAM_CAPTION_MAX && input.buttons.length > 0) {
    // Autorisé : le worker envoie le média puis un message texte avec les boutons.
  }
  return r.html;
}

function resolveSchedule(input: PostFormInput): { status: "DRAFT" | "SCHEDULED"; scheduledAt: Date | null } {
  if (input.intent !== "schedule")
    return { status: "DRAFT", scheduledAt: input.scheduledAt ? fromParisLocal(input.scheduledAt) : null };
  const at = input.scheduledAt ? fromParisLocal(input.scheduledAt) : null;
  if (!at) throw new Error("Choisissez une date et une heure pour programmer l'envoi.");
  if (at.getTime() < Date.now() - 60_000) throw new Error("La date choisie est déjà passée : choisissez un moment à venir.");
  return { status: "SCHEDULED", scheduledAt: at };
}

type VersionPlan = { text: string; buttons: PostFormInput["buttons"]; publisher: PostPublisherValue };

/** Emojis animés (phase 12) : texte, boutons et auteur d'une version selon le type du canal. */
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
 * Programmation d'un message publié par le compte connecté : le compte doit pouvoir publier dans chacun de ses canaux.
 * Sinon la phrase du refus (le message est gardé en brouillon), null si tout va bien.
 */
async function accountScheduleRefusal(
  versions: ReadonlyArray<{ channelId: string; publisher: PostPublisherValue }>,
  count = 1,
): Promise<string | null> {
  const ids = [...new Set(versions.filter((v) => v.publisher === "ACCOUNT").map((v) => v.channelId))];
  if (ids.length === 0) return null;
  const [status, channels] = await Promise.all([
    loadPublishStatus(),
    prisma.channel.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }),
  ]);
  const titled = ids.map((id) => ({ id, title: channels.find((c) => c.id === id)?.title ?? "ce canal" }));
  return scheduleRefusal(accountProblemsFor(status, titled), count);
}

/** Retire les messages (et leurs liens traqués tout neufs) créés par une création qui a échoué. */
async function discardCreated(postIds: string[], claimed: string[] = []): Promise<void> {
  try {
    if (claimed.length)
      await prisma.trackingLink.updateMany({ where: { id: { in: claimed } }, data: { postId: null, channelId: null } });
    await prisma.trackingLink.deleteMany({ where: { postId: { in: postIds } } });
    await prisma.post.deleteMany({ where: { id: { in: postIds } } });
  } catch (err) {
    console.error("messages créés non retirés après un échec", err);
  }
}

/** Programmation refusée : aucun de nos bots ne peut publier dans le canal du message (gardé en brouillon). */
const NO_PUBLISHING_BOT =
  "Aucun de nos bots ne peut publier dans ce canal : ses bots administrateurs sont désactivés ou sont des assistants de conversation. Le message est gardé en brouillon. Réactivez un bot dans Réglages → Bots, ou ajoutez un autre de nos bots comme administrateur du canal dans Telegram, puis programmez-le.";

// ─── Phrase de Kevin → champs du formulaire ─────────────────────────────────────────────────────────────────────────

/** Date donnée par Kevin : heure de Paris « AAAA-MM-JJTHH:MM » (comme le formulaire), ou date ISO avec fuseau. */
export function parisLocalOf(raw: unknown): string {
  const s = str(raw).trim();
  if (!s) return "";
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (Number.isFinite(d.getTime())) return toParisLocalInput(d);
  }
  return s.replace(" ", "T");
}

/** Un album Telegram compte 10 médias au plus (le service d'envoi n'en publie pas davantage). */
const POST_MEDIA_MAX = 10;

type ForwardedLike = { html?: unknown; media?: Array<{ kind?: unknown; fileId?: unknown }> };

/**
 * Médias d'un message transféré à Kevin : ceux déjà rangés dans la médiathèque (même identifiant de fichier Telegram).
 * Un média inconnu n'est jamais deviné : Kevin demande de l'envoyer d'abord (médiathèque).
 */
async function mediaOfForwarded(content: ForwardedLike): Promise<{ ok: true; ids: string[] } | { ok: false; result: Fail }> {
  const files = (content.media ?? []).map((m) => str(m.fileId)).filter(Boolean);
  if (files.length === 0) return { ok: true, ids: [] };
  const rows = await prisma.mediaAssetTelegramFile.findMany({
    where: { telegramFileId: { in: files } },
    select: { assetId: true, telegramFileId: true },
  });
  const ids = files.map((f) => rows.find((r) => r.telegramFileId === f)?.assetId ?? null);
  if (ids.some((x) => x === null))
    return {
      ok: false,
      result: fail(
        "La photo ou la vidéo du message transféré n'est pas encore dans la médiathèque : envoie-la-moi d'abord, puis redis-moi de programmer le message.",
        "invalid",
        "content",
      ),
    };
  return { ok: true, ids: ids as string[] };
}

/** Catégorie de message par nom (`category`) → identifiant. */
async function categoryIdOf(raw: unknown): Promise<{ ok: true; id: string | undefined } | { ok: false; result: Fail }> {
  const name = str(raw).trim();
  if (!name) return { ok: true, id: undefined };
  const rows = await prisma.messageCategory.findMany({ select: { id: true, name: true, slug: true } });
  const r = await resolveNamed({ plural: "catégories", one: "la catégorie" }, name, rows.map((c) => ({ id: c.id, name: c.name, extra: [c.slug] })));
  return r.ok ? { ok: true, id: r.id } : r;
}

/**
 * Champs bruts d'un message : ceux du formulaire du site tels quels, complétés pour Kevin (canaux par leurs noms,
 * texte d'un message transféré, date en heure de Paris, catégorie par son nom, intention déduite de la date).
 */
async function rawPostInput(input: Record<string, unknown>, forceIntent?: "draft" | "schedule"): Promise<{ ok: true; raw: Record<string, unknown> } | { ok: false; result: Fail }> {
  const raw: Record<string, unknown> = { ...input };
  if (!Array.isArray(raw.channelIds) || raw.channelIds.length === 0) {
    const ch = await resolveChannelRefs(input, { names: input.channels !== undefined ? "channels" : "channel" });
    if (!ch.ok) return ch;
    raw.channelIds = ch.ids;
  }
  const content = input.content as ForwardedLike | undefined;
  if (content && typeof content === "object") {
    if (raw.text === undefined) raw.text = str(content.html);
    // Médias rangés par le déroulé de Kevin avant l'essai à blanc (`mediaAssetIds`, dans l'ordre) : revérifiés ici ;
    // un album en garde 10 au plus (limite de Telegram), l'aperçu le dit.
    const given = forwardedMediaList(input).length ? providedAssetIds(raw) : [];
    if (given.length) {
      if (!(await existingAssets(given))) return { ok: false, result: fail("Média introuvable dans la médiathèque.", "not_found", "mediaAssetIds") };
      raw.mediaAssetIds = given.slice(0, POST_MEDIA_MAX);
    } else if (raw.mediaAssetIds === undefined) {
      const m = await mediaOfForwarded(content);
      if (!m.ok) return m;
      raw.mediaAssetIds = m.ids;
    }
  }
  delete raw.mediaAssetId;
  if (raw.scheduledAt !== undefined) raw.scheduledAt = parisLocalOf(raw.scheduledAt);
  if (raw.categoryId === undefined && raw.category !== undefined) {
    const c = await categoryIdOf(raw.category);
    if (!c.ok) return c;
    raw.categoryId = c.id;
  }
  if (forceIntent) raw.intent = forceIntent;
  else if (raw.intent === undefined) raw.intent = raw.scheduledAt ? "schedule" : "draft";
  return { ok: true, raw };
}

function formError(error: z.ZodError): Fail {
  return fail(error.issues[0]?.message ?? "Vérifiez le formulaire : une valeur est invalide.", "invalid", "_form");
}

/** Résumé d'un message pour l'aperçu de Kevin. */
function whenText(at: Date | null): string {
  return at ? `le ${momentLabel(toLocal(at))}` : "sans date";
}

// ─── Création ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Création : un Post par canal (liés par duplicatedFromId), brouillon, programmé ou modèle. Test A/B : deux Post par
 * canal. Emojis animés : une version qui en garde est publiée par le compte connecté, sans boutons. Programmer alors
 * que le compte ne peut pas publier : gardés en brouillon, le refus est expliqué (`data.flash.error`).
 * Retour : `data.path` (où le site revient) et `data.flash` (`ok` ou `error`).
 */
async function createPost(input: Record<string, unknown>, actor: SiteOpActor, opts: { dryRun?: boolean }, forceIntent?: "draft" | "schedule"): Promise<SiteOpResult> {
  const prepared = await rawPostInput(input, forceIntent);
  if (!prepared.ok) return prepared.result;
  const parsed = postFormSchema.safeParse(prepared.raw);
  if (!parsed.success) return formError(parsed.error);
  const form = parsed.data;
  const userId = actor.userId;
  // Messages déjà créés : retirés si l'enregistrement échoue en cours de route.
  const created: string[] = [];
  // Liens d'offre du texte rattachés à ces messages : rendus libres (pas supprimés) si l'enregistrement échoue.
  const claimedLinks: string[] = [];
  try {
    const html = validateText(form);
    const isTemplate = form.intent === "template";
    const abEnabled = form.abEnabled && !isTemplate;
    const htmlB = abEnabled
      ? validateText({ text: form.textB, mediaAssetIds: form.mediaAssetIdsB, buttons: form.buttonsB }, "La version B")
      : "";
    const schedule = isTemplate ? { status: "DRAFT" as const, scheduledAt: null } : resolveSchedule(form);
    const choice = form.emojiButtonsChoice ?? null;
    const otherChannelB = abEnabled && form.abMode === "other-channel";
    const chatTypes =
      isTemplate || !(hasCustomEmoji(html) || hasCustomEmoji(htmlB))
        ? new Map<string, string>()
        : await loadChatTypes([...form.channelIds, ...(otherChannelB && form.abChannelId ? [form.abChannelId] : [])]);
    const typeOf = (channelId: string | undefined) => (channelId && chatTypes.get(channelId)) || "CHANNEL";
    const plans = new Map<string, VersionPlan>();
    const planOf = (version: "A" | "B", chatType: string): VersionPlan => {
      const key = `${version}:${chatType}`;
      let plan = plans.get(key);
      if (!plan) {
        plan =
          version === "A"
            ? planVersion({ text: html, buttons: form.buttons, choice, isTemplate, chatType })
            : planVersion({ text: htmlB, buttons: form.buttonsB, choice, isTemplate: false, chatType });
        plans.set(key, plan);
      }
      return plan;
    };
    const targets = form.channelIds.map((channelId) => {
      const typeA = typeOf(channelId);
      const typeB = otherChannelB ? typeOf(form.abChannelId) : typeA;
      return { channelId, a: planOf("A", typeA), b: abEnabled ? planOf("B", typeB) : null };
    });
    // Tous les boutons (A et B) sont vérifiés AVANT de créer le moindre message.
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
    const perChannel = targets.map((t) =>
      planVariants(
        { channelId: t.channelId, text: t.a.text, mediaAssetIds: form.mediaAssetIds, buttons: t.a.buttons },
        {
          abEnabled,
          abMode: form.abMode,
          abChannelId: form.abChannelId,
          abDelayMinutes: form.abDelayMinutes,
          textB: t.b?.text ?? "",
          mediaAssetIdsB: form.mediaAssetIdsB,
          buttonsB: t.b?.buttons ?? [],
        },
      ).map((v) => ({ ...v, publisher: (v.variant === "B" && t.b ? t.b : t.a).publisher })),
    );
    const refusal =
      schedule.status === "SCHEDULED" ? await accountScheduleRefusal(perChannel.flat(), perChannel.flat().length) : null;
    const scheduled = schedule.status === "SCHEDULED" && !refusal;
    if (opts.dryRun) {
      for (const v of perChannel.flat())
        if (!(await publishingBotFor(v.channelId)))
          throw new Error("Un des canaux choisis n'a aucun bot administrateur actif : ajoutez un bot dans Telegram (page Canaux).");
      const titles = await prisma.channel.findMany({ where: { id: { in: form.channelIds } }, select: { id: true, title: true } });
      const names = form.channelIds.map((id) => `« ${titles.find((c) => c.id === id)?.title ?? id} »`).join(", ");
      const what = isTemplate ? "Modèle" : scheduled ? "Message programmé" : "Brouillon";
      const mimes = (await existingAssets(form.mediaAssetIds))?.map((a) => a.mimeType) ?? [];
      const mediaLine = mimes.length
        ? mediaSentence(mimes, Math.max(mimes.length, forwardedMediaList(input).length), `un album en garde ${POST_MEDIA_MAX} au plus`)
        : form.mediaAssetIds.length
          ? ` Avec ${form.mediaAssetIds.length} média${form.mediaAssetIds.length > 1 ? "s" : ""}.`
          : "";
      return {
        ok: true,
        message: `${what} sur ${names} ${whenText(schedule.scheduledAt)}.`,
        preview: {
          summary: `${what} sur ${names} ${whenText(schedule.scheduledAt)}${abEnabled ? " (test A/B)" : ""}.${mediaLine}${refusal ? ` ${refusal}` : ""}`,
          exactText: perChannel[0]?.[0]?.text ?? html,
        },
      };
    }
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
          throw new Error("Un des canaux choisis n'a aucun bot administrateur actif : ajoutez un bot dans Telegram (page Canaux).");
        const channel = isTemplate
          ? await prisma.channel.findUnique({ where: { id: v.channelId }, select: { vertical: true } })
          : null;
        const dupFrom: string | null = firstId ?? form.duplicatedFromId ?? null;
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
            categoryId: form.categoryId ?? null,
            language: form.language,
            text: v.text,
            mediaAssetIds: v.mediaAssetIds,
            buttons: [],
            publisher,
            pinAfterSend: form.pinAfterSend,
            unpinPrevious: form.unpinPrevious,
            deleteAfterMinutes: form.deleteAfterMinutes,
            disableNotification: form.disableNotification,
            protectContent: protectFor(publisher, form.protectContent),
            disableLinkPreview: form.disableLinkPreview,
            isTemplate,
            templateName: isTemplate ? form.templateName || "Modèle sans nom" : null,
            vertical: channel?.vertical ?? null,
            abGroupId,
            abVariant: abGroupId ? v.variant : null,
            createdById: userId,
            updatedById: userId,
            duplicatedFromId: dupFrom,
          },
        });
        created.push(post.id);
        const m = await materializeButtons(v.buttons, { id: post.id, channelId: v.channelId, isTemplate }, userId);
        relinked ||= m.relinked;
        // Offre ajoutée comme lien dans le texte : le lien est rattaché à ce message (copié s'il en a déjà un).
        const linked = await attachTextOfferLinks(
          v.text,
          { id: post.id, channelId: v.channelId },
          { userId: userId ?? "", trackingBaseUrl: env.trackingBaseUrl },
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
            scheduledAt: variantScheduledAt(schedule.scheduledAt, v.offsetMinutes)?.toISOString() ?? null,
            abGroupId,
            abVariant: abGroupId ? v.variant : null,
            publisher,
          },
        });
      }
    }
    // Tous les messages et leurs boutons sont enregistrés : ils peuvent maintenant être programmés.
    if (scheduled) await prisma.post.updateMany({ where: { id: { in: created } }, data: { status: "SCHEDULED" } });
    for (const j of journal)
      await audit({
        userId,
        action: isTemplate ? "post.template_created" : scheduled ? "post.scheduled" : "post.drafted",
        entityType: "Post",
        entityId: j.postId,
        metadata: { ...j.metadata, ...viaMeta(actor) },
      });
    // Emojis animés utilisés : « Récents de l'équipe » dans le sélecteur.
    await markCustomEmojisUsed(stored);
    if (relinked) await refreshCampaignStats();
    if (refusal)
      // Gardés en brouillon : on rouvre le message (un seul) pour corriger, sinon le calendrier.
      return ok(`Gardé en brouillon : ${refusal}`, {
        postIds: created,
        path: created.length === 1 ? `/messages/${created[0]}/edit` : "/messages",
        flash: { error: refusal },
      });
    const msg = isTemplate
      ? "Modèle enregistré."
      : abEnabled
        ? `Test A/B enregistré : ${created.length} messages (${groups.length} test${groups.length > 1 ? "s" : ""}).`
        : schedule.status === "SCHEDULED"
          ? `${created.length} message(s) programmé(s).`
          : `${created.length} brouillon(s) enregistré(s).`;
    const path = groups.length === 1 ? `/messages/ab/${groups[0]}` : created.length === 1 ? `/messages/${created[0]}` : "/messages";
    return ok(msg, { postIds: created, path, flash: { ok: msg } });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    if (created.length) await discardCreated(created, claimedLinks);
    return fail(err instanceof Error ? err.message : "Enregistrement impossible.");
  }
}

/** Cœur du formulaire du site (brouillon, programmé ou modèle selon `intent`). */
export const postCreate: CoreRun = (input, actor, opts = {}) => createPost(input, actor, opts);
/** Kevin : « programme ça sur Zone Interdite demain 20 h » (message transféré). */
export const postSchedule: CoreRun = (input, actor, opts = {}) => createPost(input, actor, opts, "schedule");
/** Kevin : « garde ça en brouillon pour Zone Interdite ». */
export const postDraft: CoreRun = (input, actor, opts = {}) => createPost(input, actor, opts, "draft");

// ─── Message existant ───────────────────────────────────────────────────────────────────────────────────────────────

/** Message par `postId` (site) ou par son code court (`code`, Kevin). */
async function postIdOf(input: Record<string, unknown>): Promise<string> {
  const id = str(input.postId).trim();
  if (id) return id;
  const code = str(input.code).trim();
  if (!code) return "";
  const p = await prisma.post.findFirst({ where: { code }, select: { id: true } });
  return p?.id ?? code;
}

/** Message relu (`findUniqueOrThrow` comme le site) ; introuvable → null. */
async function loadPost(postId: string) {
  try {
    return await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "P2025" || (err as { name?: string } | null)?.name === "NotFoundError") return null;
    throw err;
  }
}

const POST_NOT_FOUND = "Ce message n'existe plus.";

/** Mise à jour d'un brouillon / message programmé (un seul canal). Retour : `data.path` + `data.flash`. */
export const postUpdate: CoreRun = async (input, actor, opts = {}) => {
  const postId = await postIdOf(input);
  if (!postId) return fail(POST_NOT_FOUND, "not_found", "postId");
  // Kevin peut ne donner que ce qui change : le reste vient du message enregistré.
  let base: Record<string, unknown> = {};
  if (input.intent === undefined && input.text === undefined && input.content === undefined) {
    const p = await loadPost(postId);
    if (!p) return fail(POST_NOT_FOUND, "not_found", "postId");
    base = formOfPost(p);
  } else if (input.channelIds === undefined && input.channel === undefined && input.channels === undefined) {
    const p = await loadPost(postId);
    if (p) base = formOfPost(p);
  }
  // Message transféré avec médias : ses médias remplacent ceux du message enregistré (jamais un mélange).
  if (forwardedMediaList(input).length) delete base.mediaAssetIds;
  const prepared = await rawPostInput({ ...base, ...input });
  if (!prepared.ok) return prepared.result;
  const parsed = postFormSchema.safeParse(prepared.raw);
  if (!parsed.success) return formError(parsed.error);
  const form = parsed.data;
  try {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    if (!["DRAFT", "SCHEDULED", "FAILED", "CANCELLED"].includes(post.status)) throw new Error("Ce message ne peut plus être modifié.");
    const html = validateText(form);
    const schedule = post.isTemplate ? { status: "DRAFT" as const, scheduledAt: null } : resolveSchedule(form);
    const channelId = form.channelIds[0] ?? post.channelId;
    // Bot qui publie : le bot actuel s'il peut encore publier dans ce canal, sinon un autre de nos bots normaux.
    const bot = await publishingBotFor(channelId, channelId === post.channelId ? { keep: post.botId } : {});
    const chatType =
      !post.isTemplate && hasCustomEmoji(html) ? ((await loadChatTypes([channelId])).get(channelId) ?? null) : null;
    const plan = planVersion({
      text: html,
      buttons: form.buttons,
      choice: form.emojiButtonsChoice ?? null,
      isTemplate: post.isTemplate,
      chatType,
    });
    // Modèle : un bouton Offre dont la campagne reste à choisir est gardé tel quel.
    await assertButtonRows(rowsToVerify(plan.buttons, post.isTemplate));
    if (opts.dryRun)
      return {
        ok: true,
        message: `Message modifié, ${whenText(schedule.scheduledAt)}.`,
        preview: {
          summary: `Message ${post.code} modifié : ${schedule.status === "SCHEDULED" ? "programmé" : "brouillon"} ${whenText(schedule.scheduledAt)}.${
            forwardedMediaList(input).length
              ? mediaSentence((await existingAssets(form.mediaAssetIds))?.map((a) => a.mimeType) ?? [], forwardedMediaList(input).length, `un album en garde ${POST_MEDIA_MAX} au plus`)
              : ""
          }`,
          exactText: plan.text,
        },
      };
    const { buttons, relinked } = await materializeButtons(plan.buttons, { id: post.id, channelId, isTemplate: post.isTemplate }, actor.userId);
    // Offre ajoutée comme lien dans le texte : rattachée à ce message (copiée si elle appartient à un autre).
    const linked = await attachTextOfferLinks(
      plan.text,
      { id: post.id, channelId },
      { userId: actor.userId ?? "", trackingBaseUrl: env.trackingBaseUrl },
    );
    const text = linked.html;
    const publisher = plan.publisher;
    const refusal =
      schedule.status === "SCHEDULED"
        ? !bot && publisher === "BOT"
          ? NO_PUBLISHING_BOT
          : await accountScheduleRefusal([{ channelId, publisher }])
        : null;
    const status = refusal ? ("DRAFT" as const) : schedule.status;
    await prisma.post.update({
      where: { id: postId },
      data: {
        channelId,
        ...(bot ? { botId: bot.id } : {}),
        status,
        scheduledAt: schedule.scheduledAt,
        categoryId: form.categoryId ?? null,
        language: form.language,
        text,
        mediaAssetIds: form.mediaAssetIds,
        buttons: buttons as unknown as Prisma.InputJsonValue,
        publisher,
        pinAfterSend: form.pinAfterSend,
        unpinPrevious: form.unpinPrevious,
        deleteAfterMinutes: form.deleteAfterMinutes,
        disableNotification: form.disableNotification,
        protectContent: protectFor(publisher, form.protectContent),
        disableLinkPreview: form.disableLinkPreview,
        templateName: post.isTemplate ? form.templateName || post.templateName : post.templateName,
        lastError: null,
        updatedById: actor.userId,
      },
    });
    await audit({
      userId: actor.userId,
      action: "post.updated",
      entityType: "Post",
      entityId: postId,
      metadata: { status, publisher, ...viaMeta(actor) },
    });
    await markCustomEmojisUsed(text);
    // Ancien bouton Offre rattaché à une campagne : statistiques journalières recalculées depuis le début.
    if (relinked) await refreshCampaignStats();
    if (refusal) return ok(`Gardé en brouillon : ${refusal}`, { postId, path: `/messages/${postId}/edit`, flash: { error: refusal } });
    const msg = status === "SCHEDULED" ? "Message programmé." : "Message enregistré.";
    return ok(msg, { postId, path: `/messages/${postId}`, flash: { ok: msg } });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return fail(err instanceof Error ? err.message : "Enregistrement impossible.");
  }
};

/** Formulaire d'un message enregistré (pour compléter une phrase de Kevin). */
function formOfPost(p: {
  channelId: string;
  status: string;
  scheduledAt: Date | null;
  categoryId: string | null;
  language: string;
  text: string;
  mediaAssetIds: unknown;
  buttons: unknown;
  pinAfterSend: boolean;
  unpinPrevious: boolean;
  deleteAfterMinutes: number | null;
  disableNotification: boolean;
  protectContent: boolean;
  disableLinkPreview: boolean;
  templateName: string | null;
}): Record<string, unknown> {
  return {
    channelIds: [p.channelId],
    scheduledAt: p.scheduledAt ? toParisLocalInput(p.scheduledAt) : "",
    categoryId: p.categoryId ?? undefined,
    language: p.language,
    text: p.text,
    mediaAssetIds: Array.isArray(p.mediaAssetIds) ? p.mediaAssetIds : [],
    buttons: Array.isArray(p.buttons) ? p.buttons : [],
    pinAfterSend: p.pinAfterSend,
    unpinPrevious: p.unpinPrevious,
    deleteAfterMinutes: p.deleteAfterMinutes,
    disableNotification: p.disableNotification,
    protectContent: p.protectContent,
    disableLinkPreview: p.disableLinkPreview,
    intent: p.status === "SCHEDULED" ? "schedule" : "draft",
    templateName: p.templateName ?? undefined,
  };
}

/** Annuler un message programmé : il ne partira pas (reste modifiable et reprogrammable). */
export const postCancel: CoreRun = async (input, actor, opts = {}) => {
  const postId = await postIdOf(input);
  const post = postId ? await loadPost(postId) : null;
  if (!post) return fail(POST_NOT_FOUND, "not_found", "postId");
  if (post.status !== "SCHEDULED") return fail("Seul un message programmé peut être annulé.", "conflict");
  if (opts.dryRun) return preview({ summary: `Annuler l'envoi du message ${post.code} ${whenText(post.scheduledAt)}.` });
  await prisma.post.update({ where: { id: postId }, data: { status: "CANCELLED", updatedById: actor.userId } });
  await audit({ userId: actor.userId, action: "post.cancelled", entityType: "Post", entityId: postId, metadata: viaMeta(actor) });
  return ok("Envoi annulé : le message ne partira pas. Il reste modifiable et reprogrammable.", { postId });
};

/** Décale un message programmé de N minutes (positif ou négatif). */
export const postShift: CoreRun = async (input, actor, opts = {}) => {
  const postId = await postIdOf(input);
  const minutes = Number(input.minutes ?? 0);
  const post = postId ? await loadPost(postId) : null;
  if (!post) return fail(POST_NOT_FOUND, "not_found", "postId");
  if (post.status !== "SCHEDULED" || !post.scheduledAt) return fail("Seul un message programmé peut être décalé.", "conflict");
  const at = new Date(post.scheduledAt.getTime() + minutes * 60_000);
  if (at.getTime() < Date.now()) return fail("La nouvelle date serait dans le passé.", "invalid", "minutes");
  if (opts.dryRun) return preview({ summary: `Décaler le message ${post.code} de ${minutes > 0 ? "+" : ""}${minutes} min : ${whenText(at)}.` });
  await prisma.post.update({ where: { id: postId }, data: { scheduledAt: at, updatedById: actor.userId } });
  await audit({
    userId: actor.userId,
    action: "post.shifted",
    entityType: "Post",
    entityId: postId,
    metadata: { minutes, ...viaMeta(actor) },
  });
  return ok(`Message décalé de ${minutes > 0 ? "+" : ""}${minutes} min.`, { postId });
};

/** Supprime le message sur Telegram (via la file) et le marque supprimé. Administrateurs. */
export const postDeleteOnTelegram: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const postId = await postIdOf(input);
  const post = postId ? await loadPost(postId) : null;
  if (!post) return fail(POST_NOT_FOUND, "not_found", "postId");
  if (post.status !== "SENT") return fail("Seul un message déjà envoyé peut être supprimé du canal Telegram.", "conflict");
  if (opts.dryRun)
    return preview({ summary: `Supprimer du canal Telegram le message ${post.code}.`, impact: "Il disparaît du canal ; ses statistiques restent." });
  await enqueue("telegram-send", { type: "delete-post", postId }, { jobId: `delete-post:${postId}:${Date.now()}` });
  await audit({ userId: actor.userId, action: "post.delete_requested", entityType: "Post", entityId: postId, metadata: viaMeta(actor) });
  return ok("Suppression demandée : le message disparaît du canal Telegram dans quelques secondes.", { postId });
};

/** Supprime un brouillon / modèle / message annulé de la plateforme. Administrateurs (`requireAdmin` du site). */
export const postDiscard: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const postId = await postIdOf(input);
  const post = postId ? await loadPost(postId) : null;
  if (!post) return fail(POST_NOT_FOUND, "not_found", "postId");
  if (!["DRAFT", "CANCELLED", "FAILED"].includes(post.status))
    return fail("Seul un brouillon, un modèle ou un message annulé peut être retiré.", "conflict");
  if (opts.dryRun)
    return preview({ summary: post.isTemplate ? `Supprimer le modèle « ${post.templateName ?? post.code} ».` : `Retirer le message ${post.code} de la plateforme.`, impact: "Il ne pourra pas être récupéré." });
  await prisma.post.delete({ where: { id: postId } });
  await audit({ userId: actor.userId, action: "post.discarded", entityType: "Post", entityId: postId, metadata: viaMeta(actor) });
  return ok(post.isTemplate ? "Modèle supprimé." : "Message retiré de la plateforme.", { postId });
};

/** Retire les identifiants de liens traqués (un duplicata doit avoir ses propres liens). */
function stripTrackingIds(buttons: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(buttons)) return [];
  return buttons.map((row) =>
    Array.isArray(row) ? row.map((b) => ({ ...(b as object), trackingLinkId: undefined, slug: undefined })) : [],
  ) as Prisma.InputJsonValue;
}

/** Enregistre un message existant comme modèle. */
export const postSaveAsTemplate: CoreRun = async (input, actor, opts = {}) => {
  const postId = await postIdOf(input);
  const name = str(input.templateName ?? input.name).trim() || "Modèle sans nom";
  const post = postId ? await loadPost(postId) : null;
  if (!post) return fail(POST_NOT_FOUND, "not_found", "postId");
  if (opts.dryRun) return preview({ summary: `Enregistrer le message ${post.code} comme modèle « ${name} ».` });
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
      createdById: actor.userId,
      updatedById: actor.userId,
      duplicatedFromId: post.id,
    },
  });
  await audit({
    userId: actor.userId,
    action: "post.template_created",
    entityType: "Post",
    entityId: tpl.id,
    metadata: { from: postId, name, ...viaMeta(actor) },
  });
  return ok(`Modèle « ${name} » enregistré.`, { postId, templateId: tpl.id });
};

/** Campagne par identifiant ou par son nom (`campaign`, Kevin). */
async function campaignIdOf(input: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; result: Fail }> {
  const id = str(input.campaignId).trim();
  if (id || !input.campaign) return { ok: true, id };
  const rows = await prisma.campaign.findMany({ select: { id: true, name: true } });
  const r = await resolveNamed({ plural: "campagnes", one: "la campagne" }, str(input.campaign), rows);
  return r.ok ? { ok: true, id: r.id } : r;
}

/**
 * « Ajouter l'offre comme lien dans le texte » (message publié par le compte connecté, sans boutons) : crée le lien
 * traqué de l'offre de la campagne et renvoie le lien à ajouter au texte (`data.html`, `data.url`).
 */
export const textOfferLinkCreate: CoreRun = async (input, actor, opts = {}) => {
  const label = str(input.label).trim();
  const camp = await campaignIdOf(input);
  if (!camp.ok) return camp.result;
  if (!camp.id) return fail("Choisissez la campagne de l'offre.", "invalid", "campaignId");
  let affiliateCampaignId = str(input.affiliateCampaignId).trim();
  if (!affiliateCampaignId && input.affiliateCampaignId === undefined) {
    // Kevin : une campagne à une seule offre n'a pas besoin qu'on la nomme.
    const c = await prisma.campaign.findUnique({ where: { id: camp.id }, select: { affiliateCampaignIds: true } });
    const ids = Array.isArray(c?.affiliateCampaignIds) ? (c!.affiliateCampaignIds as unknown[]).map(String) : [];
    if (ids.length === 1) affiliateCampaignId = ids[0]!;
  }
  if (!affiliateCampaignId) return fail("Choisissez l'offre de la campagne.", "invalid", "affiliateCampaignId");
  if (opts.dryRun) return preview({ summary: `Lien d'offre « ${label || "Offre"} » de la campagne à ajouter au texte.` });
  try {
    const link = await createTextOfferLink({
      campaignId: camp.id,
      affiliateCampaignId,
      label,
      userId: actor.userId ?? "",
      trackingBaseUrl: env.trackingBaseUrl,
    });
    await audit({
      userId: actor.userId,
      action: "tracking_link.text_offer_created",
      entityType: "TrackingLink",
      entityId: link.id,
      metadata: { campaignId: camp.id, affiliateCampaignId, slug: link.slug, ...viaMeta(actor) },
    });
    return ok(`Lien d'offre prêt : ${link.url}`, { html: link.html, url: link.url });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Lien impossible à créer : réessayez.", "unavailable");
  }
};

/**
 * « Vérifier » : demande au service d'arrière-plan de relever si le compte Telegram connecté peut publier dans ces
 * canaux (Premium, administrateur avec le droit de publier).
 */
export const accountPublishCheck: CoreRun = async (input, actor, opts = {}) => {
  let ids = Array.isArray(input.channelIds) ? input.channelIds.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0 && (input.channels !== undefined || input.channel !== undefined)) {
    const r = await resolveChannelRefs(input, { names: input.channels !== undefined ? "channels" : "channel" });
    if (!r.ok) return r.result;
    ids = r.ids;
  }
  if (opts.dryRun) return preview({ summary: "Vérifier si le compte Telegram connecté peut publier dans ces canaux." });
  try {
    const r = await requestAccountCheck(ids);
    await audit({
      userId: actor.userId,
      action: "post.account_check_requested",
      entityType: "Channel",
      metadata: { channelIds: r.channelIds, ...viaMeta(actor) },
    });
    return ok("Vérification demandée : le relevé arrive dans quelques secondes.", { requestedAt: r.requestedAt });
  } catch (err) {
    console.error("[messages] vérification du compte Telegram non demandée", err);
    return fail("Le service d'arrière-plan ne répond pas : réessayez dans une minute.", "unavailable");
  }
};

/** Dernier relevé de l'état du compte Telegram connecté (null s'il n'y en a jamais eu). Lecture. */
export const accountPublishStatusRead: CoreRun = async () => {
  const status = await loadPublishStatus();
  return ok(status ? "Dernier relevé du compte Telegram connecté." : "Aucun relevé du compte Telegram pour le moment.", {
    status: status as unknown as Record<string, unknown> | null,
  });
};

// ─── Déplacer (calendrier) ─────────────────────────────────────────────────────────────────────────────────────────

/** Le message a changé entre la lecture et l'écriture (le worker l'a pris pour l'envoyer, ou un autre écran). */
class Conflict extends Error {}

const moveSchema = z.object({ postId: z.string().min(1), scheduledAt: z.string().min(1) });

/**
 * Déplace un brouillon ou un message programmé à une autre date (calendrier ; Kevin : « décale le post de 20 h à
 * 21 h »). Jamais un message parti ni un modèle, jamais dans le passé. Écriture conditionnelle (statut et date
 * inchangés depuis la lecture). Les autres versions d'un test A/B suivent du même écart. Journal `post.moved`.
 * Retour : `data` = { postId, from, to, moved }.
 */
export const postMove: CoreRun = async (input, actor, opts = {}) => {
  const id = await postIdOf(input);
  const parsed = moveSchema.safeParse({ postId: id || input.postId, scheduledAt: input.scheduledAt === undefined ? undefined : parisLocalOf(input.scheduledAt) });
  if (!parsed.success) return fail("Demande invalide : rechargez la page.");
  const { postId, scheduledAt } = parsed.data;
  const now = new Date();

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, status: true, isTemplate: true, scheduledAt: true, abGroupId: true },
  });
  const check = checkMove(post, scheduledAt, now);
  if (!check.ok) return fail(check.error, "conflict");
  const current = post!;
  const at = check.at;
  const from = current.scheduledAt ? toLocal(current.scheduledAt) : null;
  if (current.scheduledAt && current.scheduledAt.getTime() === at.getTime())
    return ok("Le message est déjà à cette heure.", { postId, from, to: toLocal(at), moved: 0 });

  const siblings =
    current.abGroupId && current.scheduledAt
      ? await prisma.post.findMany({
          where: { abGroupId: current.abGroupId, id: { not: postId }, isTemplate: false },
          select: { id: true, status: true, scheduledAt: true },
        })
      : [];
  const delta = current.scheduledAt ? at.getTime() - current.scheduledAt.getTime() : 0;
  const followers = siblingMoves(siblings, delta, now);
  if (!followers.ok) return fail(followers.error, "conflict");
  const to = toLocal(at);
  if (opts.dryRun)
    return preview({ summary: `Déplacer le message au ${momentLabel(to)}${followers.moves.length ? " (l'autre version du test A/B suit)" : ""}.` }, { postId, from, to });

  try {
    await prisma.$transaction(async (tx) => {
      const guard = (gid: string, status: PostStatus, was: Date | null) => ({ id: gid, status, scheduledAt: was, isTemplate: false });
      const main = await tx.post.updateMany({
        where: guard(postId, current.status, current.scheduledAt),
        data: { scheduledAt: at, updatedById: actor.userId },
      });
      if (main.count !== 1) throw new Conflict();
      for (const m of followers.moves) {
        const r = await tx.post.updateMany({
          where: guard(m.id, m.status, m.from),
          data: { scheduledAt: m.to, updatedById: actor.userId },
        });
        if (r.count !== 1) throw new Conflict();
      }
    });
  } catch (err) {
    if (err instanceof Conflict)
      return fail("Ce message vient de changer (il part peut-être en ce moment) : rechargez la page.", "conflict");
    throw err;
  }

  await audit({
    userId: actor.userId,
    action: "post.moved",
    entityType: "Post",
    entityId: postId,
    metadata: {
      from: current.scheduledAt?.toISOString() ?? null,
      to: at.toISOString(),
      abGroupId: current.abGroupId,
      followers: followers.moves.map((m) => m.id),
      ...viaMeta(actor),
    },
  });
  const moved = 1 + followers.moves.length;
  return ok(
    moved > 1
      ? `Test A/B déplacé : ce message part le ${momentLabel(to)}, l'autre version suit du même écart.`
      : `Message déplacé au ${momentLabel(to)}.`,
    { postId, from, to, moved },
  );
};
