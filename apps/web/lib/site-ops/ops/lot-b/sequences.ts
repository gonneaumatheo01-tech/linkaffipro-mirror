/**
 * Phase 34, lot B — cœurs de l'onglet « Messages du bot » de la fiche canal (séquences par déclencheur : texte par
 * langue, traductions, langues, activation, média joint, test sur son propre Telegram). Appelés par
 * `app/(admin)/channels/[id]/sequences/actions.ts` et par Kevin. Un formulaire illisible rend `field: "_form"` (le
 * site revient alors à la liste des canaux, comme avant).
 */
import { z } from "zod";
import { validateTelegramHtml } from "@linkaffipro/core";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { enqueueDm } from "@linkaffipro/queue";
import { ensureDefaultSequences, previewText, type SequenceTriggerKey } from "@linkaffipro/telegram";
import { actingStandardBotFor } from "@/lib/channels/acting-bot";
import { markCustomEmojisUsed } from "@/lib/custom-emoji/usage";
import { existingAssets, forwardedMediaList, mediaSentence, providedAssetIds } from "@/lib/site-ops/forwarded-media";
import { SEQUENCE_LANGS } from "@/app/(admin)/channels/[id]/sequences/langs";
import { fail, ok, preview, resolveChannelRef, str, viaMeta, type CoreRun, type SiteOpResult } from "./common";

export const SEQUENCE_TRIGGERS = ["JOIN_REQUEST", "GATE_REMINDER", "GATE_SATISFIED", "APPROVED", "OFFER_REPLY"] as const;

const TRIGGER_LABELS: Record<string, string> = {
  JOIN_REQUEST: "message d'accueil (demande reçue)",
  GATE_REMINDER: "rappel des canaux à rejoindre",
  GATE_SATISFIED: "canaux rejoints",
  APPROVED: "message « accepté »",
  OFFER_REPLY: "réponse à l'offre",
};

/** Déclencheur donné en clair par Kevin (« accueil », « rappel », « accepté », « offre ») ou par sa clé. */
export function triggerKey(raw: unknown): string {
  const s = str(raw).trim();
  if ((SEQUENCE_TRIGGERS as readonly string[]).includes(s)) return s;
  const n = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (/rappel|relance/.test(n)) return "GATE_REMINDER";
  if (/rejoint|satisf/.test(n)) return "GATE_SATISFIED";
  if (/accept|approuv|valid/.test(n)) return "APPROVED";
  if (/offre|offer/.test(n)) return "OFFER_REPLY";
  if (/accueil|bienvenue|demande|welcome|join/.test(n)) return "JOIN_REQUEST";
  return s;
}

/** Langue en clair (« anglais ») ou code (« en »). */
function langKey(raw: unknown): string {
  const s = str(raw).trim().toLowerCase();
  const names: Record<string, string> = {
    francais: "fr",
    français: "fr",
    anglais: "en",
    espagnol: "es",
    portugais: "pt",
    allemand: "de",
    italien: "it",
    arabe: "ar",
    turc: "tr",
    neerlandais: "nl",
    néerlandais: "nl",
    polonais: "pl",
    roumain: "ro",
    russe: "ru",
  };
  return names[s] ?? s;
}

/** Champs communs (canal par id ou par nom, déclencheur et langue en clair). */
async function common(input: Record<string, unknown>): Promise<{ ok: true; fields: Record<string, unknown>; channelName: string } | { ok: false; result: SiteOpResult }> {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return { ok: false, result: ref.result };
  const fields: Record<string, unknown> = { ...input, channelId: ref?.id ?? input.channelId };
  if (input.trigger !== undefined) fields.trigger = triggerKey(input.trigger);
  if (input.lang !== undefined) fields.lang = langKey(input.lang);
  return { ok: true, fields, channelName: ref?.name ?? "" };
}

const unreadable = (): SiteOpResult => fail("Message du bot introuvable : rechargez la page.", "invalid", "_form");

async function stepFor(channelId: string, trigger: SequenceTriggerKey) {
  await ensureDefaultSequences(channelId);
  const seq = await prisma.sequence.findFirst({
    where: { channelId, trigger },
    include: { steps: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!seq) throw new Error("Message du bot introuvable pour ce canal.");
  const step =
    seq.steps[0] ??
    (await prisma.sequenceStep.create({ data: { sequenceId: seq.id, order: 0, texts: {}, buttons: [] } }));
  return {
    seq,
    step,
    texts: (step.texts && typeof step.texts === "object" ? (step.texts as Record<string, string>) : {}) as Record<string, string>,
  };
}

const saveSchema = z.object({
  channelId: z.string().min(1),
  trigger: z.enum(SEQUENCE_TRIGGERS),
  lang: z.string().regex(/^[a-z]{2}$/),
  text: z.string().max(5000),
});

/**
 * Enregistre le texte d'une langue pour un déclencheur. Kevin peut donner un message transféré (`content`) : son HTML
 * Telegram (emojis animés compris) est gardé tel quel.
 */
export const sequenceTextSave: CoreRun = async (input, actor, opts = {}) => {
  const c = await common({ lang: "fr", ...input });
  if (!c.ok) return c.result;
  const content = input.content as { html?: unknown } | undefined;
  const fields: Record<string, unknown> = { ...c.fields };
  if (input.text === undefined && content?.html !== undefined) fields.text = str(content.html);
  // Médias du message transféré (règle 6) : rangés par le déroulé de Kevin avant l'essai à blanc. Un message du bot
  // joint un seul média (le premier ; l'aperçu dit combien sont gardés) ; sans média fourni, refus (jamais perdu en
  // silence).
  const forwardedCount = forwardedMediaList(input).length;
  let media: { id: string; mimeType: string } | null = null;
  if (forwardedCount > 0) {
    const ids = providedAssetIds(input);
    if (ids.length === 0)
      return fail(
        "Le message transféré contient une photo ou une vidéo : ajoutez-la d'abord à la médiathèque, puis redemandez ce message avec ce média.",
        "invalid",
        "mediaAssetId",
      );
    const found = await existingAssets(ids.slice(0, 1));
    if (!found) return fail("Média introuvable.", "not_found", "mediaAssetId");
    media = found[0]!;
  }
  const mediaLine = media ? `,${mediaSentence([media.mimeType], forwardedCount, "un message du bot ne joint qu'un média").replace(/^ Avec/, " avec").replace(/\.$/, "")}` : "";
  const parsed = saveSchema.safeParse({ channelId: fields.channelId, trigger: fields.trigger, lang: fields.lang, text: fields.text });
  if (!parsed.success) return unreadable();
  const { channelId, trigger, lang, text } = parsed.data;
  if (lang === "fr" && !text.trim())
    return fail(
      "Le texte en français est obligatoire : c'est celui que reçoivent les membres dont la langue n'est pas traduite.",
      "invalid",
      "text",
    );
  const v = validateTelegramHtml(text.trim());
  if (!v.ok) return fail(v.error, "invalid", "text");
  if (opts.dryRun)
    return preview({ summary: `Texte ${lang.toUpperCase()} du ${TRIGGER_LABELS[trigger]} de « ${c.channelName || channelId} »${mediaLine} :`, exactText: v.html });
  const { seq, step, texts } = await stepFor(channelId, trigger);
  texts[lang] = v.html;
  await prisma.sequenceStep.update({
    where: { id: step.id },
    data: { texts: texts as unknown as Prisma.InputJsonValue, ...(media ? { mediaAssetId: media.id } : {}) },
  });
  // Emojis animés du texte : « Récents de l'équipe » dans le sélecteur (phase 12).
  await markCustomEmojisUsed(v.html);
  await audit({
    userId: actor.userId,
    action: "sequence.text_saved",
    entityType: "Sequence",
    entityId: seq.id,
    metadata: { trigger, lang, ...(media ? { mediaAssetId: media.id } : {}), ...viaMeta(actor) },
  });
  return ok(`Texte ${lang.toUpperCase()} enregistré${media ? ", avec son média" : ""}.`, { channelId, trigger, lang });
};

const translationsSchema = z.object({
  channelId: z.string().min(1),
  trigger: z.enum(SEQUENCE_TRIGGERS),
  texts: z.partialRecord(z.enum(SEQUENCE_LANGS), z.string().max(5000)),
});

/**
 * Enregistre les traductions proposées par l'assistant IA dans les autres langues d'un déclencheur : ajoute la langue
 * si elle manque, remplace son texte sinon. Tout ou rien : un texte invalide (HTML Telegram) bloque l'enregistrement.
 */
export const sequenceTranslationsSave: CoreRun = async (input, actor, opts = {}) => {
  const c = await common(input);
  if (!c.ok) return c.result;
  const rawTexts = input.texts && typeof input.texts === "object" ? (input.texts as Record<string, unknown>) : input.texts;
  const texts =
    rawTexts && typeof rawTexts === "object"
      ? Object.fromEntries(Object.entries(rawTexts).map(([k, v]) => [langKey(k), v]))
      : rawTexts;
  const parsed = translationsSchema.safeParse({ channelId: c.fields.channelId, trigger: c.fields.trigger, texts });
  if (!parsed.success) return fail("Traductions refusées : langue ou message inconnu.");
  const { channelId, trigger } = parsed.data;
  const entries = Object.entries(parsed.data.texts).filter((e): e is [string, string] => typeof e[1] === "string");
  if (entries.length === 0) return fail("Aucune traduction à enregistrer.");
  const clean: Record<string, string> = {};
  for (const [lang, text] of entries) {
    if (lang === "fr" && !text.trim()) return fail("Le texte en français ne peut pas être vide.");
    const v = validateTelegramHtml(text.trim());
    if (!v.ok) return fail(`Traduction ${lang.toUpperCase()} refusée : ${v.error}`);
    clean[lang] = v.html;
  }
  if (opts.dryRun)
    return preview({ summary: `Traductions ${Object.keys(clean).map((l) => l.toUpperCase()).join(", ")} du ${TRIGGER_LABELS[trigger]}.` });
  try {
    const { seq, step, texts: current } = await stepFor(channelId, trigger);
    const next = { ...current, ...clean };
    await prisma.sequenceStep.update({ where: { id: step.id }, data: { texts: next as unknown as Prisma.InputJsonValue } });
    const saved = Object.keys(clean);
    await markCustomEmojisUsed(Object.values(clean));
    await audit({
      userId: actor.userId,
      action: "sequence.translations_saved",
      entityType: "Sequence",
      entityId: seq.id,
      metadata: { trigger, langs: saved, source: "ai", ...viaMeta(actor) },
    });
    return ok(`Traductions enregistrées : ${saved.map((l) => l.toUpperCase()).join(", ")}.`, { channelId, saved });
  } catch {
    return fail("Message introuvable : rechargez la page et réessayez.", "not_found");
  }
};

/** Ajoute une langue (copie du français comme point de départ). */
export const sequenceLangAdd: CoreRun = async (input, actor, opts = {}) => {
  const c = await common(input);
  if (!c.ok) return c.result;
  const parsed = z
    .object({ channelId: z.string().min(1), trigger: z.enum(SEQUENCE_TRIGGERS), lang: z.enum(SEQUENCE_LANGS) })
    .safeParse({ channelId: c.fields.channelId, trigger: c.fields.trigger, lang: c.fields.lang });
  if (!parsed.success) return unreadable();
  const { channelId, trigger, lang } = parsed.data;
  if (opts.dryRun) return preview({ summary: `Ajout de la langue ${lang.toUpperCase()} au ${TRIGGER_LABELS[trigger]} (copie du français).` });
  const { seq, step, texts } = await stepFor(channelId, trigger);
  if (texts[lang] === undefined) {
    texts[lang] = texts.fr ?? "";
    await prisma.sequenceStep.update({ where: { id: step.id }, data: { texts: texts as unknown as Prisma.InputJsonValue } });
    await audit({
      userId: actor.userId,
      action: "sequence.lang_added",
      entityType: "Sequence",
      entityId: seq.id,
      metadata: { trigger, lang, ...viaMeta(actor) },
    });
  }
  return ok(`Langue ${lang.toUpperCase()} ajoutée : traduisez le texte puis enregistrez.`, { channelId, trigger, lang });
};

/** Retire une langue (jamais le français). */
export const sequenceLangRemove: CoreRun = async (input, actor, opts = {}) => {
  const c = await common(input);
  if (!c.ok) return c.result;
  const parsed = z
    .object({ channelId: z.string().min(1), trigger: z.enum(SEQUENCE_TRIGGERS), lang: z.string().regex(/^[a-z]{2}$/) })
    .safeParse({ channelId: c.fields.channelId, trigger: c.fields.trigger, lang: c.fields.lang });
  if (!parsed.success) return unreadable();
  const { channelId, trigger, lang } = parsed.data;
  if (lang === "fr") return fail("Le français ne peut pas être retiré.", "invalid", "lang");
  if (opts.dryRun) return preview({ summary: `Retirer la langue ${lang.toUpperCase()} du ${TRIGGER_LABELS[trigger]}.` });
  const { seq, step, texts } = await stepFor(channelId, trigger);
  delete texts[lang];
  await prisma.sequenceStep.update({ where: { id: step.id }, data: { texts: texts as unknown as Prisma.InputJsonValue } });
  await audit({
    userId: actor.userId,
    action: "sequence.lang_removed",
    entityType: "Sequence",
    entityId: seq.id,
    metadata: { trigger, lang, ...viaMeta(actor) },
  });
  return ok(`Langue ${lang.toUpperCase()} retirée.`, { channelId, trigger, lang });
};

/**
 * Active ou désactive une séquence (désactivée : le bot utilise son texte intégré par défaut). Le site inverse l'état ;
 * Kevin peut demander un état précis (`active`), rien ne change s'il y est déjà.
 */
export const sequenceToggle: CoreRun = async (input, actor, opts = {}) => {
  const c = await common(input);
  if (!c.ok) return c.result;
  const parsed = z
    .object({ channelId: z.string().min(1), trigger: z.enum(SEQUENCE_TRIGGERS) })
    .safeParse({ channelId: c.fields.channelId, trigger: c.fields.trigger });
  if (!parsed.success) return unreadable();
  const { channelId, trigger } = parsed.data;
  if (opts.dryRun) {
    const seq = await prisma.sequence.findFirst({ where: { channelId, trigger }, select: { isActive: true } });
    const next = input.active === undefined ? !(seq?.isActive ?? true) : input.active === true || input.active === "1";
    return preview({ summary: `${next ? "Activer" : "Désactiver"} le ${TRIGGER_LABELS[trigger]}.` });
  }
  const { seq } = await stepFor(channelId, trigger);
  const next = input.active === undefined ? !seq.isActive : input.active === true || input.active === "1";
  if (next !== seq.isActive) {
    await prisma.sequence.update({ where: { id: seq.id }, data: { isActive: next } });
    await audit({
      userId: actor.userId,
      action: next ? "sequence.activated" : "sequence.deactivated",
      entityType: "Sequence",
      entityId: seq.id,
      metadata: { trigger, ...viaMeta(actor) },
    });
  }
  return ok(
    next ? "Message activé : le bot utilisera votre texte." : "Message désactivé : le bot utilisera son texte intégré par défaut.",
    { channelId, trigger },
  );
};

/** Choisit (ou retire) le média joint aux messages d'un déclencheur. */
export const sequenceMediaSet: CoreRun = async (input, actor, opts = {}) => {
  const c = await common(input);
  if (!c.ok) return c.result;
  const parsed = z
    .object({
      channelId: z.string().min(1),
      trigger: z.enum(SEQUENCE_TRIGGERS),
      mediaAssetId: z.string().max(64).optional().default(""),
    })
    .safeParse({ channelId: c.fields.channelId, trigger: c.fields.trigger, mediaAssetId: c.fields.mediaAssetId ?? undefined });
  if (!parsed.success) return unreadable();
  const { channelId, trigger, mediaAssetId } = parsed.data;
  let id: string | null = null;
  if (mediaAssetId) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId }, select: { id: true } });
    if (!asset) return fail("Média introuvable.", "not_found", "mediaAssetId");
    id = asset.id;
  }
  if (opts.dryRun) return preview({ summary: id ? `Joindre ce média au ${TRIGGER_LABELS[trigger]}.` : `Retirer le média du ${TRIGGER_LABELS[trigger]}.` });
  const { seq, step } = await stepFor(channelId, trigger);
  await prisma.sequenceStep.update({ where: { id: step.id }, data: { mediaAssetId: id } });
  await audit({
    userId: actor.userId,
    action: id ? "sequence.media_set" : "sequence.media_removed",
    entityType: "Sequence",
    entityId: seq.id,
    metadata: { trigger, mediaAssetId: id, ...viaMeta(actor) },
  });
  return ok(id ? "Média joint enregistré." : "Média retiré.", { channelId, trigger });
};

/**
 * Envoie le texte à l'utilisateur lui-même (Telegram lié) via la file, avec des exemples pour les repères. Seul
 * destinataire : la personne qui demande le test.
 */
export const sequenceTestSend: CoreRun = async (input, actor, opts = {}) => {
  const c = await common({ lang: "fr", ...input });
  if (!c.ok) return c.result;
  const parsed = z
    .object({ channelId: z.string().min(1), trigger: z.enum(SEQUENCE_TRIGGERS), lang: z.string().regex(/^[a-z]{2}$/) })
    .safeParse({ channelId: c.fields.channelId, trigger: c.fields.trigger, lang: c.fields.lang });
  if (!parsed.success) return unreadable();
  const { channelId, trigger, lang } = parsed.data;
  // Destinataire : le compte Telegram de la personne qui demande (lié à son compte du site, ou celui qui parle à Kevin).
  const tgRaw = actor.telegramUserId ?? null;
  if (!tgRaw)
    return fail("Liez votre Telegram dans Mon compte (menu en haut à droite) pour recevoir un test.", "invalid", "telegram");
  const telegramUserId = BigInt(tgRaw);
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, title: true } });
  if (!channel) return fail("Ce canal n'existe plus.", "not_found", "_form");
  // Le bot qui parle aux membres de ce canal ; jamais un bot assistant de conversation (phase 17).
  const botId = (await actingStandardBotFor(channelId))?.id ?? null;
  if (!botId) return fail("Aucun de nos bots n'est administrateur de ce canal : ajoutez-en un dans Telegram.", "unavailable");
  const member = await prisma.member.findUnique({
    where: { telegramUserId },
    select: { id: true, botStates: { where: { botId }, select: { canDm: true } } },
  });
  if (!member) return fail("Envoyez d'abord /start au bot de ce canal depuis votre Telegram.", "unavailable");
  if (member.botStates[0] && !member.botStates[0].canDm)
    return fail("Le bot ne peut pas vous écrire : envoyez-lui /start.", "unavailable");
  const { step, texts } = await stepFor(channelId, trigger);
  const template = texts[lang] ?? texts.fr;
  if (!template) return fail("Aucun texte à envoyer.", "invalid", "text");
  // Prénom d'exemple : celui du compte du site (donné par le site, sinon relu).
  const prenom =
    input.prenom !== undefined
      ? str(input.prenom)
      : actor.userId
        ? ((await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name ?? "")
        : "";
  const text = previewText(template, { canal: channel.title, prenom });
  const full = `🧪 Test (${trigger}, ${lang.toUpperCase()})\n\n${text}`;
  if (opts.dryRun) return preview({ summary: "Message de test envoyé sur votre Telegram :", exactText: full, recipients: 1 });
  await enqueueDm({ botId, memberId: member.id, kind: "TEST", text: full, mediaAssetId: step.mediaAssetId ?? null });
  await audit({
    userId: actor.userId,
    action: "sequence.test_sent",
    entityType: "Channel",
    entityId: channelId,
    metadata: { trigger, lang, ...viaMeta(actor) },
  });
  return ok("Message de test envoyé sur votre Telegram (quelques secondes).", { channelId, trigger, lang });
};
