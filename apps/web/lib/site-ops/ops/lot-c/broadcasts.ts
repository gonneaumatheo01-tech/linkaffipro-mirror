/**
 * Phase 34, lot C : cœurs de « Membres → Écrire à un groupe » (`app/(admin)/members/broadcasts/actions.ts`).
 * Site : formulaire en 3 étapes ; Kevin : phrase + message transféré (texte HTML et emojis animés gardés tels quels).
 * Tout envoi à des membres passe par un essai à blanc qui rend le texte EXACT tel qu'il partira (`{prenom}` remplacé
 * pour un vrai destinataire) et le nombre réel de destinataires joignables ; rien n'est écrit ni mis en file.
 */
import { revalidatePath } from "next/cache";
import {
  describeSegment,
  fillPlaceholders,
  parseSegment,
  shortId,
  validateTelegramHtml,
  type Segment,
} from "@linkaffipro/core";
import { prisma, audit, toJsonValue, type Prisma } from "@linkaffipro/db";
import { enqueue, enqueueDm } from "@linkaffipro/queue";
import { offerDeepLink } from "@linkaffipro/telegram";
import type { ForwardedContent, SiteOpActor } from "@linkaffipro/agents";
import { env } from "@/lib/env";
import { fromParisLocal } from "@/lib/posts/time";
import { buttonUrlError, type PostButtonRow } from "@/lib/posts/buttons";
import { assertButtonRows, materializeOfferButton } from "@/lib/campaigns/offer-button";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";
import { GROUP_MESSAGE_LINK_SUFFIX } from "@/lib/links/label";
import { parseBroadcastForm } from "@/lib/broadcasts/schema";
import { loadAbComparison } from "@/lib/broadcasts/ab-queries";
import { parseAbForm, pickWinner } from "@/lib/broadcasts/ab";
import { markCustomEmojisUsed } from "@/lib/custom-emoji/usage";
import { existingAssets, forwardedMediaList, mediaSentence, providedAssetIds } from "@/lib/site-ops/forwarded-media";
import {
  ADMIN_ONLY,
  doneTo,
  fail,
  failTo,
  forbidden,
  isPartial,
  preview,
  str,
  toFormData,
  withVia,
  type Back,
  type Core,
  type CoreResult,
} from "./common";
import {
  botCandidates,
  broadcastCandidates,
  campaignCandidates,
  channelCandidates,
  resolveInto,
  resolveManyInto,
} from "./resolve";

const NEW = "/members/broadcasts/new";
const LIST = "/members/broadcasts";
const PAGE = (id: string) => `${LIST}/${id}`;
const AB = (groupId: string) => `${LIST}/ab/${groupId}`;

/** Refus d'un bot en mode assistant de conversation (phase 17) : il ne répond qu'aux personnes qui lui parlent. */
export const ASSISTANT_BOT_ERROR =
  "Ce bot est un assistant de conversation : il n'écrit pas à un groupe. Choisissez un autre bot.";
/** Phase 26 : le Boss ne parle qu'à l'admin, jamais aux membres. */
export const BOSS_BOT_ERROR =
  "Ce bot sert seulement à parler avec l'administrateur : choisissez un bot de canal.";

/**
 * Un envoi existant ne part jamais par un bot passé en mode assistant de conversation depuis sa création (phase 17).
 * Le service d'arrière-plan l'annule aussi ; ici, le refus est rendu tout de suite.
 */
async function refuseAssistantBot(botId: string): Promise<string | null> {
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { mode: true, role: true } });
  if (bot && bot.role === "ADMIN") return BOSS_BOT_ERROR;
  if (bot && bot.mode !== "STANDARD") return ASSISTANT_BOT_ERROR;
  return null;
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
  userId: string | null,
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
                  label: `${x.text}${GROUP_MESSAGE_LINK_SUFFIX}`,
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
        labelSuffix: GROUP_MESSAGE_LINK_SUFFIX,
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

/**
 * Aperçu exact d'un envoi : texte tel qu'il partira pour un vrai destinataire (`{prenom}`, `{bot}` remplacés comme
 * le fait le service d'envoi, `apps/worker/src/broadcasts/personalize.ts`) et nombre réel de membres joignables.
 */
export async function sendPreview(
  segment: Segment,
  botId: string,
  text: string,
): Promise<{ exactText: string; recipients: number; botName: string }> {
  const [{ countTargets }, { buildMemberWhere, withReachableBy }] = await Promise.all([
    import("@/lib/broadcasts/queries"),
    import("@linkaffipro/core"),
  ]);
  const where = withReachableBy(buildMemberWhere(segment), botId) as Prisma.MemberWhereInput;
  const [recipients, example, bot] = await Promise.all([
    countTargets(segment, botId),
    prisma.member.findFirst({ where, orderBy: { id: "asc" }, select: { firstName: true } }),
    prisma.bot.findUnique({ where: { id: botId }, select: { name: true } }),
  ]);
  const botName = bot?.name ?? "";
  return {
    exactText: fillPlaceholders(text, { prenom: example?.firstName ?? "", bot: botName }),
    recipients,
    botName,
  };
}

/**
 * Destinataires EXACTS de l'envoi « au reste » d'un test A/B : même règle que le service d'envoi
 * (`apps/worker/src/broadcasts/expand.ts` + `ab.ts`) : membres joignables du segment (niveaux de dépense compris), moins
 * tous ceux qui ont déjà reçu un message d'un envoi du groupe — et non « joignables − envois du test », qui retire deux
 * fois un membre servi puis devenu injoignable.
 */
async function countRestTargets(segment: Segment, botId: string, groupId: string): Promise<number> {
  const { aggregatePlayers, buildMemberWhere, computeSpendLevel, matchesSpendLevels, parseSpendThresholds, withReachableBy } =
    await import("@linkaffipro/core");
  const where: Prisma.MemberWhereInput = {
    AND: [
      withReachableBy(buildMemberWhere(segment), botId) as Prisma.MemberWhereInput,
      { outboundMessages: { none: { broadcast: { abGroupId: groupId } } } },
    ],
  };
  if (!segment.spendLevels) return prisma.member.count({ where });
  const thresholds = parseSpendThresholds(
    (await prisma.setting.findUnique({ where: { key: "spend.thresholds" } }).catch(() => null))?.value,
  );
  let cursor: string | undefined;
  let n = 0;
  for (;;) {
    const rows = await prisma.member.findMany({
      where,
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, players: { select: { registeredAt: true, depositCount: true, depositTotal: true } } },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    for (const m of rows) {
      const players = m.players.map((p) => ({
        registeredAt: p.registeredAt,
        depositCount: p.depositCount,
        depositTotal: Number(p.depositTotal),
      }));
      if (matchesSpendLevels(computeSpendLevel(aggregatePlayers(players), thresholds), segment)) n++;
    }
    if (rows.length < 1000) break;
  }
  return n;
}

function buttonsLine(rows: PostButtonRow[]): string {
  const labels = rows.flat().map((b) => `« ${b.text} »`);
  return labels.length ? ` Boutons : ${labels.join(", ")}.` : "";
}

/**
 * Kevin : « envoie ce message à tous les membres de Zone Interdite demain 20 h » → champs du formulaire. Le message
 * transféré devient le texte (HTML et emojis animés gardés tels quels, jamais réécrits) ; canaux, campagnes et bot par
 * leur nom ; bot du canal par défaut ; intention déduite de l'heure.
 */
async function formFromWords(raw: Record<string, unknown>): Promise<Record<string, unknown> | CoreResult> {
  const input: Record<string, unknown> = { ...raw };
  // Déroulé de Kevin : le message transféré arrive dans `content` (contrat de la phase 34) ; `forwarded` reste accepté.
  const fwd = (input.content ?? input.forwarded) as ForwardedContent | undefined;
  if (fwd && typeof fwd === "object" && typeof fwd.html === "string") {
    if (!str(input.text)) input.text = fwd.html;
    if (Array.isArray(fwd.media) && fwd.media.length > 0) {
      // Médias rangés par le déroulé de Kevin avant l'essai à blanc : un envoi n'en joint qu'un, le premier.
      const ids = providedAssetIds(input);
      if (ids.length === 0)
        return fail(
          "Le message transféré contient une photo ou une vidéo : ajoutez-la d'abord à la médiathèque, puis redemandez l'envoi avec ce média.",
          null,
          { field: "mediaAssetId" },
        );
      input.mediaAssetId = ids[0];
    }
  }
  delete input.forwarded;
  delete input.content;
  delete input.mediaAssetIds;
  for (const [idKey, nameKey, what, cands] of [
    ["channelIds", "channels", "le canal", channelCandidates],
    ["campaignIds", "campaigns", "la campagne", campaignCandidates],
  ] as const) {
    const r = await resolveManyInto(input, idKey, nameKey, what, cands);
    if (!r.ok) return fail(r.error, null, { code: r.code, field: nameKey });
    delete input[nameKey];
  }
  const b = await resolveInto(input, "botId", "bot", "le bot", botCandidates);
  if (!b.ok) return fail(b.error, null, { code: b.code, field: "bot" });
  delete input.bot;
  if (!str(input.botId)) {
    const firstChannel = Array.isArray(input.channelIds) ? str(input.channelIds[0]) : str(input.channelIds);
    if (firstChannel) {
      const ch = await prisma.channel.findUnique({
        where: { id: firstChannel },
        select: { primaryBotId: true },
      });
      if (ch?.primaryBotId) input.botId = ch.primaryBotId;
    }
  }
  if (!str(input.intent)) input.intent = str(input.scheduledAt) ? "schedule" : "now";
  if (!str(input.name)) {
    const d = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" });
    input.name = `Envoi du ${d} (Kevin)`;
  }
  if (Array.isArray(input.buttons)) input.buttons = JSON.stringify(input.buttons);
  return input;
}

type Created = {
  /** Envois créés : un seul, ou les versions A puis B d'un test A/B. */
  ids: string[];
  abGroupId: string | null;
  /** Part de la version A (test A/B seulement). */
  split: number | null;
  okMsg: string;
};

/**
 * Crée l'envoi (ou les deux versions d'un test A/B) : toutes les vérifications (texte, date, bot, boutons) se font
 * ici, et une erreur renvoie au formulaire avec son message. `forceDraft` : « Envoyer un test à moi ».
 */
async function createBroadcasts(
  raw: Record<string, unknown>,
  actor: SiteOpActor,
  opts: { dryRun?: boolean; forceDraft?: boolean },
): Promise<{ ok: true; created: Created } | CoreResult> {
  let input = raw;
  // Médias du message transféré (Kevin) : combien il en portait, pour dire « 1 photo sur 3 gardée » dans l'aperçu.
  const forwardedMediaCount = isPartial(actor) ? forwardedMediaList(raw).length : 0;
  if (isPartial(actor)) {
    const r = await formFromWords(raw);
    if ("ok" in r && typeof r.ok === "boolean") return r as CoreResult;
    input = r;
  }
  if (opts.forceDraft) input = { ...input, intent: "draft" };
  const formData = toFormData(input);
  const parsed = parseBroadcastForm(formData);
  if (!parsed.success)
    return failTo(NEW, parsed.error.issues[0]?.message ?? "Formulaire invalide.", {}, {
      field: String(parsed.error.issues[0]?.path?.[0] ?? "") || null,
    });
  const d = parsed.data;
  const v = validateTelegramHtml(d.text);
  if (!v.ok) return failTo(NEW, `Texte invalide : ${v.error}`, {}, { field: "text" });
  const ab = parseAbForm(formData);
  let htmlB = "";
  if (ab.enabled) {
    if (!ab.textB) return failTo(NEW, "Test A/B : le texte de la version B est vide.", {}, { field: "textB" });
    const vb = validateTelegramHtml(ab.textB);
    if (!vb.ok) return failTo(NEW, `Texte de la version B invalide : ${vb.error}`, {}, { field: "textB" });
    htmlB = vb.html;
  }
  let scheduledAt: Date | null = null;
  if (d.intent === "schedule") {
    scheduledAt = d.scheduledAt ? fromParisLocal(d.scheduledAt) : null;
    if (!scheduledAt || scheduledAt.getTime() < Date.now() - 60_000)
      return failTo(NEW, "Choisissez une date et une heure dans le futur.", {}, { field: "scheduledAt" });
  }
  const bot = await prisma.bot.findUnique({
    where: { id: d.botId },
    select: { isActive: true, mode: true, role: true },
  });
  if (!bot || !bot.isActive) return failTo(NEW, "Ce bot est introuvable ou désactivé.", {}, { field: "botId" });
  if (bot.role === "ADMIN") return failTo(NEW, BOSS_BOT_ERROR, {}, { field: "botId" });
  // Jamais un bot assistant de conversation (phase 17) : le formulaire ne le propose pas, refusé ici aussi.
  if (bot.mode !== "STANDARD") return failTo(NEW, ASSISTANT_BOT_ERROR, {}, { field: "botId" });
  const status = d.intent === "now" ? "SENDING" : d.intent === "schedule" ? "SCHEDULED" : "DRAFT";
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
  // Média joint : il doit exister (un identifiant donné par Kevin est revérifié ici).
  const joined = [...new Set(variants.map((x) => x.mediaAssetId).filter((x): x is string => !!x))];
  const assets = await existingAssets(joined);
  if (!assets) return failTo(NEW, "Média introuvable dans la médiathèque.", {}, { code: "not_found", field: "mediaAssetId" });
  const firstMedia = assets.find((a) => a.id === variants[0]!.mediaAssetId) ?? null;
  if (opts.dryRun) {
    try {
      for (const variant of variants) await assertButtonRows(variant.buttons);
      for (const variant of variants)
        for (const row of variant.buttons)
          for (const x of row) {
            const urlError = buttonUrlError(x);
            if (urlError) throw new Error(urlError);
          }
    } catch (err) {
      return failTo(NEW, err instanceof Error ? err.message : "Création impossible.");
    }
    const p = await sendPreview(d.segment, d.botId, variants[0]!.text);
    const when =
      d.intent === "now"
        ? "Envoi tout de suite"
        : d.intent === "schedule"
          ? `Envoi programmé le ${scheduledAt!.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" })}`
          : "Brouillon (rien ne part)";
    const pB = ab.enabled ? await sendPreview(d.segment, d.botId, htmlB) : null;
    return {
      ok: true,
      message: `${when} par ${p.botName || "le bot"} à ${p.recipients} membre(s) joignable(s) : ${describeSegment(d.segment)}.`,
      preview: {
        summary: `${when}, « ${d.name} », par ${p.botName || "le bot"} : ${describeSegment(d.segment)}.${ab.enabled ? ` Test A/B ${ab.split} % / ${100 - ab.split} %.` : ""}${firstMedia ? mediaSentence([firstMedia.mimeType], Math.max(1, forwardedMediaCount), "un envoi ne joint qu'un média") : ""}${buttonsLine(variants[0]!.buttons)}`,
        exactText: p.exactText,
        recipients: p.recipients,
      },
      ...(pB ? { data: { exactTextB: pB.exactText } } : {}),
    };
  }
  const abGroupId = ab.enabled ? shortId(10) : null;
  const created: string[] = [];
  let relinked = false;
  try {
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
          createdById: actor.userId,
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
        actor.userId,
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
        userId: actor.userId,
        action: "broadcast.created",
        entityType: "Broadcast",
        entityId: b.id,
        metadata: withVia(actor, {
          name: d.name,
          intent: d.intent,
          segment: describeSegment(d.segment),
          abGroupId,
          abVariant: variant.variant,
          abSplit: variant.split,
        }),
      });
    }
    // Emojis animés des textes : « Récents de l'équipe » dans le sélecteur (phase 12).
    await markCustomEmojisUsed(variants.map((v) => v.text));
  } catch (err) {
    if (created.length) await discardBroadcasts(created);
    return failTo(NEW, err instanceof Error ? err.message : "Création impossible.");
  }
  if (relinked) await refreshCampaignStats();
  revalidatePath(LIST);
  const okMsg =
    d.intent === "now"
      ? "Envoi lancé."
      : d.intent === "schedule"
        ? "Envoi programmé."
        : "Brouillon enregistré.";
  return { ok: true, created: { ids: created, abGroupId, split: ab.enabled ? ab.split : null, okMsg } };
}

export const createBroadcast: Core = async (input, actor, opts = {}) => {
  const r = await createBroadcasts(input, actor, { dryRun: opts.dryRun });
  if (!("created" in r)) return r;
  const c = r.created;
  if (c.abGroupId)
    return doneTo(
      AB(c.abGroupId),
      `Test A/B créé (${c.split ?? 50} % / ${100 - (c.split ?? 50)} %). ${c.okMsg}`,
      {},
      { broadcastIds: c.ids, abGroupId: c.abGroupId },
    );
  return doneTo(PAGE(c.ids[0]!), c.okMsg, {}, { broadcastIds: c.ids });
};

/** Destinataire du test : le compte Telegram de la personne qui demande (site : compte lié ; Kevin : son Telegram). */
function testTarget(actor: SiteOpActor): bigint | null {
  const id = str(actor.telegramUserId);
  return /^\d+$/.test(id) ? BigInt(id) : null;
}

/**
 * Envoie un envoi en message de test (kind TEST) au compte Telegram de la personne, rien qu'à elle, personnalisé
 * comme pour un destinataire ({prenom}, {bot}). Renvoie la raison si le test ne peut pas partir, sinon null.
 */
async function sendTestTo(actor: SiteOpActor, id: string, dryRun = false): Promise<string | null> {
  const b = await prisma.broadcast
    .findUniqueOrThrow({ where: { id }, include: { bot: true } })
    .catch(() => null);
  if (!b) return "Envoi introuvable.";
  if (b.bot.role === "ADMIN") return BOSS_BOT_ERROR;
  if (b.bot.mode !== "STANDARD") return ASSISTANT_BOT_ERROR;
  const tg = testTarget(actor);
  if (!tg) return "Liez d'abord votre compte Telegram dans « Mon compte » (menu en haut à droite).";
  const member = await prisma.member.findUnique({
    where: { telegramUserId: tg },
    include: { botStates: { where: { botId: b.botId } } },
  });
  if (!member || !member.botStates[0]?.canDm)
    return `Envoyez d'abord /start à @${b.bot.username} depuis votre Telegram.`;
  if (dryRun) return null;
  const buttons = await resolveForDm((b.buttons as PostButtonRow[]) ?? [], b.bot.username, b.id);
  await enqueueDm({
    botId: b.botId,
    memberId: member.id,
    kind: "TEST",
    // Personnalisé comme l'envoi réel (apps/worker/src/broadcasts/personalize.ts) : {prenom} → prénom de l'utilisateur
    // (vide s'il n'en a pas), {bot} → nom du bot ; valeurs échappées, autres mots entre accolades tels quels.
    text: fillPlaceholders(b.text, { prenom: member.firstName ?? "", bot: b.bot.name }),
    buttons,
    mediaAssetId: b.mediaAssetId ?? null,
  });
  await audit({
    userId: actor.userId,
    action: "broadcast.test_sent",
    entityType: "Broadcast",
    entityId: id,
    metadata: withVia(actor),
  });
  return null;
}

/**
 * « Envoyer un test à moi » depuis l'assistant : enregistre d'abord l'envoi en brouillon (mêmes vérifications que
 * la création), puis l'envoie en test sur le Telegram de la personne (les deux versions d'un test A/B). Rien ne part
 * vers les membres. Si le test ne peut pas partir, le brouillon reste enregistré et la raison s'affiche.
 */
export const createAndTest: Core = async (input, actor, opts = {}) => {
  const r = await createBroadcasts(input, actor, { dryRun: opts.dryRun, forceDraft: true });
  if (!("created" in r)) {
    if (r.ok && r.preview)
      return preview(`Brouillon enregistré, puis message de test envoyé à vous seul. ${r.preview.summary}`, {
        exactText: r.preview.exactText,
        recipients: 1,
      });
    return r;
  }
  const c = r.created;
  const target = c.abGroupId ? AB(c.abGroupId) : PAGE(c.ids[0]!);
  let error: string | null = null;
  for (const id of c.ids) {
    error = await sendTestTo(actor, id);
    if (error) break;
  }
  if (error) {
    const e = `Le test n'est pas parti. ${error}`;
    const back: Back = { path: target, params: { ok: "Brouillon enregistré.", error: e } };
    return { ok: true, message: `Brouillon enregistré. ${e}`, data: { broadcastIds: c.ids }, back };
  }
  return doneTo(
    target,
    c.ids.length > 1
      ? "Brouillon enregistré. Les deux versions vous ont été envoyées en test sur Telegram (quelques secondes)."
      : "Brouillon enregistré. Message de test envoyé sur votre Telegram (quelques secondes).",
    {},
    { broadcastIds: c.ids },
  );
};

/** Envoi donné par son nom (Kevin) → `broadcastId`. */
async function withBroadcast(input: Record<string, unknown>): Promise<CoreResult | null> {
  const r = await resolveInto(input, "broadcastId", "broadcast", "l'envoi", broadcastCandidates);
  return r.ok ? null : fail(r.error, null, { code: r.code });
}

const notFound = () => failTo(LIST, "Envoi introuvable.", {}, { code: "not_found" });

/**
 * Envoie la variante gagnante d'un test A/B aux membres du groupe pas encore servis :
 * nouvel envoi du même groupe avec `abVariant = REST`, que le worker développe en excluant
 * tous les destinataires déjà touchés par le test.
 */
export const sendWinnerToRest: Core = async (input, actor, opts = {}) => {
  let groupId = str(input.groupId).trim();
  if (!groupId && str(input.broadcastId || input.broadcast)) {
    const i = { ...input };
    const r = await withBroadcast(i);
    if (r) return r;
    const b = await prisma.broadcast
      .findUniqueOrThrow({ where: { id: str(i.broadcastId) }, select: { abGroupId: true } })
      .catch(() => null);
    groupId = b?.abGroupId ?? "";
  }
  if (!groupId) return failTo(LIST, "Test A/B introuvable.", {}, { code: "not_found" });
  const cmp = await loadAbComparison(groupId);
  if (!cmp) return failTo(LIST, "Test A/B introuvable.", {}, { code: "not_found" });
  if (cmp.rest) return failTo(AB(groupId), "L'envoi au reste a déjà été créé.", {}, { code: "conflict" });
  const winner = pickWinner(cmp.variants);
  if (winner.status !== "winner")
    return failTo(
      AB(groupId),
      "Pas encore de gagnante : attendez au moins 30 envois par version et un écart de taux de clic.",
    );
  const src = cmp.variants.find((x) => x.variant === winner.variant)!;
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id: src.id } });
  const refused = await refuseAssistantBot(b.botId);
  if (refused) return failTo(AB(groupId), refused);
  if (opts.dryRun) {
    // Le reste du groupe : membres du segment pas encore touchés par le test (même règle que le worker).
    const segment = parseSegment(b.segment);
    const [p, recipients] = await Promise.all([
      sendPreview(segment, b.botId, b.text),
      countRestTargets(segment, b.botId, groupId),
    ]);
    return preview(
      `Version ${winner.variant} (gagnante) envoyée au reste du groupe : ${recipients} membre(s).`,
      { exactText: p.exactText, recipients },
    );
  }
  const rest = await prisma.broadcast.create({
    data: {
      name: b.name.replace(/ — [AB]$/, "") + ` — reste (gagnante ${winner.variant})`,
      botId: b.botId,
      segment: b.segment as Prisma.InputJsonValue,
      text: b.text,
      buttons: b.buttons as Prisma.InputJsonValue,
      mediaAssetId: b.mediaAssetId,
      status: "DRAFT",
      createdById: actor.userId,
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
      actor.userId,
      { copy: true },
    );
    await prisma.broadcast.update({
      where: { id: rest.id },
      data: { buttons: toJsonValue(buttons), status: "SENDING", startedAt: new Date() },
    });
  } catch (err) {
    await discardBroadcasts([rest.id]);
    return failTo(AB(groupId), err instanceof Error ? err.message : "Envoi au reste impossible.");
  }
  await enqueue(
    "scheduler",
    { type: "broadcast", broadcastId: rest.id },
    { jobId: `broadcast-${rest.id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  );
  await audit({
    userId: actor.userId,
    action: "broadcast.ab_winner_sent",
    entityType: "Broadcast",
    entityId: rest.id,
    metadata: withVia(actor, { groupId, winner: winner.variant, ctr: winner.ctr }),
  });
  revalidatePath(LIST);
  return doneTo(AB(groupId), `Version ${winner.variant} envoyée au reste du groupe.`, {}, {
    broadcastId: rest.id,
  });
};

async function loadBroadcast(raw: Record<string, unknown>) {
  const input = { ...raw };
  const r = await withBroadcast(input);
  if (r) return r;
  const id = str(input.broadcastId).trim();
  const b = id ? await prisma.broadcast.findUniqueOrThrow({ where: { id } }).catch(() => null) : null;
  if (!b) return notFound();
  return { b, input };
}

export const sendNow: Core = async (raw, actor, opts = {}) => {
  const l = await loadBroadcast(raw);
  if (!("b" in l)) return l;
  const { b } = l;
  const id = b.id;
  if (b.status !== "DRAFT" && b.status !== "SCHEDULED")
    return failTo(PAGE(id), "Cet envoi est déjà parti ou annulé : il ne peut plus être lancé.", {}, {
      code: "conflict",
    });
  const refused = await refuseAssistantBot(b.botId);
  if (refused) return failTo(PAGE(id), refused);
  if (opts.dryRun) {
    const p = await sendPreview(parseSegment(b.segment), b.botId, b.text);
    return preview(`Envoi « ${b.name} » lancé tout de suite par ${p.botName || "le bot"} : ${describeSegment(parseSegment(b.segment))}.${buttonsLine((b.buttons as PostButtonRow[]) ?? [])}`, {
      exactText: p.exactText,
      recipients: p.recipients,
    });
  }
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
    userId: actor.userId,
    action: "broadcast.sent_now",
    entityType: "Broadcast",
    entityId: id,
    metadata: withVia(actor),
  });
  revalidatePath(LIST);
  return doneTo(
    PAGE(id),
    "Envoi lancé : les messages partent progressivement, dans les limites imposées par Telegram.",
  );
};

export const schedule: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const r0 = await withBroadcast(input);
  if (r0) return r0;
  const id = str(input.broadcastId).trim();
  if (!id) return notFound();
  const at = fromParisLocal(str(input.scheduledAt));
  if (!at || at.getTime() < Date.now() - 60_000)
    return failTo(PAGE(id), "Choisissez une date et une heure dans le futur.", {}, { field: "scheduledAt" });
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } }).catch(() => null);
  if (!b) return notFound();
  if (b.status !== "DRAFT" && b.status !== "SCHEDULED")
    return failTo(PAGE(id), "Cet envoi est déjà parti ou annulé : il ne peut plus être programmé.", {}, {
      code: "conflict",
    });
  const refused = await refuseAssistantBot(b.botId);
  if (refused) return failTo(PAGE(id), refused);
  if (opts.dryRun) {
    const p = await sendPreview(parseSegment(b.segment), b.botId, b.text);
    return preview(
      `Envoi « ${b.name} » programmé le ${at.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" })} : ${describeSegment(parseSegment(b.segment))}.`,
      { exactText: p.exactText, recipients: p.recipients },
    );
  }
  await prisma.broadcast.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: at } });
  await audit({
    userId: actor.userId,
    action: "broadcast.scheduled",
    entityType: "Broadcast",
    entityId: id,
    metadata: withVia(actor, { scheduledAt: at.toISOString() }),
  });
  return doneTo(PAGE(id), "Envoi programmé.");
};

export const cancelBroadcast: Core = async (raw, actor, opts = {}) => {
  const l = await loadBroadcast(raw);
  if (!("b" in l)) return l;
  const { b } = l;
  const id = b.id;
  if (b.status === "SENT" || b.status === "CANCELLED")
    return failTo(PAGE(id), "Cet envoi est déjà terminé.", {}, { code: "conflict" });
  if (opts.dryRun) {
    const remaining = await prisma.outboundMessage.count({ where: { broadcastId: id, status: "QUEUED" } });
    return preview(`Envoi « ${b.name} » annulé : ${remaining} message(s) encore en attente ne partiront pas.`);
  }
  const r = await prisma.outboundMessage.updateMany({
    where: { broadcastId: id, status: "QUEUED" },
    data: { status: "FAILED", error: "Annulé" },
  });
  await prisma.broadcast.update({
    where: { id },
    data: { status: "CANCELLED", finishedAt: new Date(), failed: { increment: r.count } },
  });
  await audit({
    userId: actor.userId,
    action: "broadcast.cancelled",
    entityType: "Broadcast",
    entityId: id,
    metadata: withVia(actor, { remaining: r.count }),
  });
  revalidatePath(LIST);
  return doneTo(PAGE(id), `Envoi annulé (${r.count} message(s) non envoyé(s)).`);
};

export const testToMe: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const r0 = await withBroadcast(input);
  if (r0) return r0;
  const id = str(input.broadcastId).trim();
  if (!id) return notFound();
  const error = await sendTestTo(actor, id, !!opts.dryRun);
  if (error) return failTo(PAGE(id), error);
  if (opts.dryRun) return preview("Message de test envoyé à vous seul, sur votre Telegram.", { recipients: 1 });
  return doneTo(PAGE(id), "Message de test envoyé sur votre Telegram (quelques secondes).");
};

export const deleteDraft: Core = async (raw, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY);
  const l = await loadBroadcast(raw);
  if (!("b" in l)) return l;
  const { b } = l;
  const id = b.id;
  if (b.status !== "DRAFT" && b.status !== "CANCELLED")
    return failTo(PAGE(id), "Seuls les brouillons et les envois annulés peuvent être supprimés.", {}, {
      code: "conflict",
    });
  if (opts.dryRun)
    return preview(`Suppression de l'envoi « ${b.name} ».`, {
      impact: "L'envoi disparaît de la liste ; les messages déjà partis restent comptés dans les statistiques.",
    });
  await prisma.outboundMessage.updateMany({
    where: { broadcastId: id },
    data: { broadcastId: null },
  });
  await prisma.broadcast.delete({ where: { id } });
  await audit({
    userId: actor.userId,
    action: "broadcast.deleted",
    entityType: "Broadcast",
    entityId: id,
    metadata: withVia(actor, { name: b.name }),
  });
  revalidatePath(LIST);
  return doneTo(LIST, "Envoi supprimé.");
};

