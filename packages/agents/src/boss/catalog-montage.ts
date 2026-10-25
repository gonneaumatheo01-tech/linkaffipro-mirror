/**
 * Phase 28, chantier E — entrées du catalogue de Kevin pour le montage vidéo (section 9 du prompt) et chemin rapide
 * des réponses au montage (sans IA, dans le webhook) :
 * - `montage_video` (« découpe ça », « fais des shorts », « monte cette vidéo », « fais-moi 10 clips de 15 secondes ») ;
 * - `voir_montage` (« montre-moi les shorts », « le montage en cours ») ;
 * - `modifier_short` (« le short 5 raccourcis de 2 secondes », « ajoute un texte », « change la cam ») ;
 * - `annuler_montage` (« annule le montage en cours ») ;
 * - `montage_status` (« où en est le montage ? ») ;
 * - `envoyer_shorts` (« envoie les 10 validés dans le canal Roulette ») : OUI pour un vrai canal ; seuls les shorts
 *   validés (✅) partent.
 * Droits : lancer, modifier, annuler et envoyer = l'admin seul ; voir et l'état = tout membre présenté
 * (`team/rights.ts`).
 */
import { adminTelegramId, esc } from "../admin/journal";
import { findTestChannel } from "../agents/data";
import { montagePort, type KevinMontageDeps } from "../montage/kevin-port";
import { readMontageState, setMontageAwait } from "../montage/kevin-state";
import { activeJob, latestJob, montageStatus, montageView } from "../montage/kevin-view";
import { answerPlan, indexesIn, parsePlanReply } from "../montage/plan-message";
import {
  answerPreviews,
  answerSubtitle,
  changeShort,
  decideShort,
  FEEDBACK_VARIANTS,
  keepShorts,
  latestJobWithApproved,
  parseDestination,
  parsePreviewReply,
  sendApprovedShorts,
  sendPlanOf,
  understandChange,
} from "../montage/feedback";
import { launchMontage, looksLikeMontageInstructions, montageFromPhrase, montageIntentOf } from "../montage/reception";
import { normalizeText } from "../human/answer";
import type { BossAction, BossDeps, BossReply, BossTeamInput } from "./contract";
import { defineAction } from "./catalog-kit";
import type { BossExecDeps } from "./catalog-read";
import { int, str } from "./params";
import { channelRefs, matchNames, type ChannelRef } from "./resolve";
import { pick, voiceTemplate, type VoiceTable } from "./voice";

export const CATALOG_MONTAGE_VARIANTS = {
  noActive: ["Aucun montage en cours.", "Je n'ai pas de montage en route pour le moment."],
  cancelled: [
    "C'est annulé : le montage s'arrête. Les shorts déjà validés restent dans la médiathèque.",
    "Montage annulé. Ce qui était déjà validé reste dans la médiathèque, le reste est abandonné.",
  ],
  cancelFailed: ["Je n'ai pas réussi à arrêter le montage. Réessaie dans un instant.", "L'arrêt du montage n'est pas passé, réessaie dans un instant."],
  whichShort: ["Quel short ? Donne-moi son numéro, par exemple « le short 5, raccourcis de 2 secondes ».", "Il me faut le numéro du short, par exemple « le 3, cam en bas à gauche »."],
  noSuchShort: voiceTemplate<{ index: number }>([{ index: 14 }], (p) => [`Je n'ai pas de short ${p.index} dans le dernier montage.`, `Le dernier montage n'a pas de short ${p.index}.`]),
} satisfies VoiceTable;

const V = CATALOG_MONTAGE_VARIANTS;

/** Conversation de l'action (privé de l'admin par défaut). */
async function chatKeyOf(deps: BossDeps): Promise<string | null> {
  const c = (deps as BossExecDeps).chat;
  if (c) return c.chatId.toString();
  return (await adminTelegramId(deps))?.toString() ?? null;
}

type Empty = Record<string, never>;

export const montageVideo = defineAction<{ consignes?: string }>({
  key: "montage_video",
  description: "Monter une vidéo envoyée ici en shorts (« découpe ça en shorts de 15 secondes », « fais des shorts pour TikTok avec sous-titres », « cam en haut à droite »)",
  theme: "casino",
  cls: "immediate",
  spec: { consignes: str("Consignes du client telles qu'écrites (durée, format, caméra, sous-titres, texte, nombre)", { optional: true, maxLength: 500 }) },
  async execute(deps, p) {
    const chatId = await chatKeyOf(deps);
    if (!chatId) return { reply: pick(V.noActive, "catalog.montage.none") };
    const text = p.consignes ?? (deps as BossExecDeps).inputText ?? "";
    return { reply: (await montageFromPhrase(deps as KevinMontageDeps, chatId, text, null)).reply };
  },
});

export const voirMontage = defineAction<Empty>({
  key: "voir_montage",
  description: "Montrer les shorts du montage en cours ou du dernier montage, avec leur état (validé, à valider, en fabrication)",
  theme: "casino",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return { reply: (await montageView(deps, await chatKeyOf(deps))).text };
  },
});

export const montageStatusAction = defineAction<Empty>({
  key: "montage_status",
  description: "Dire où en est le montage vidéo (analyse, plan de coupe, fabrication, aperçus, shorts validés)",
  theme: "casino",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return { reply: (await montageStatus(deps, await chatKeyOf(deps))).text };
  },
});

export const modifierShort = defineAction<{ numero?: number; changement: string }>({
  key: "modifier_short",
  description: "Modifier un short déjà monté (« le short 5 raccourcis de 2 secondes », « ajoute le texte “Gros gain” », « cam en bas à gauche », « sans sous-titres »)",
  theme: "casino",
  cls: "immediate",
  spec: {
    numero: int("Numéro du short", 1, 99, true),
    changement: str("Ce qu'il faut changer, tel que dit", { maxLength: 300 }),
  },
  async execute(deps, p) {
    const chatId = await chatKeyOf(deps);
    const d = deps as KevinMontageDeps;
    const index = p.numero ?? indexesIn(normalizeText(p.changement))[0];
    if (!index) return { reply: pick(V.whichShort, "catalog.montage.which", chatId) };
    const job = (await activeJob(deps, chatId)) ?? (await latestJob(deps, chatId));
    const clip = job ? ((await deps.prisma.shortClip.findFirst({ where: { montageJobId: job.id, index } })) as { id: string } | null) : null;
    if (!clip) return { reply: pick(V.noSuchShort({ index }), "catalog.montage.nosuch", chatId) };
    const change = await understandChange(d, p.changement);
    if (!change) return { reply: pick(FEEDBACK_VARIANTS.changeUnknown, "montage.feedback.unknown", chatId) };
    return { reply: await changeShort(d, clip.id, change) };
  },
});

export const annulerMontage = defineAction<Empty>({
  key: "annuler_montage",
  description: "Annuler le montage vidéo en cours (les shorts déjà validés restent)",
  theme: "casino",
  cls: "immediate",
  spec: {},
  async execute(deps, _p, actor) {
    const chatId = await chatKeyOf(deps);
    const job = await activeJob(deps, chatId);
    if (!job) return { reply: pick(V.noActive, "catalog.montage.none", chatId) };
    try {
      await montagePort(deps as KevinMontageDeps).cancelJob(deps, job.id, { userId: actor.userId, via: "TELEGRAM" });
    } catch (err) {
      deps.logger?.error({ err: (err as Error).message }, "[montage] annulation impossible");
      return { reply: pick(V.cancelFailed, "catalog.montage.cancelFailed", chatId) };
    }
    if (chatId) {
      const s = await readMontageState(deps, chatId);
      if (s.await && "jobId" in s.await && s.await.jobId === job.id) await setMontageAwait(deps, chatId, null);
    }
    return { reply: pick(V.cancelled, "catalog.montage.cancelled", chatId) };
  },
});

type SendP = { canal: string; numeros?: string; ecart_minutes?: number; travail?: string };

/** Canal visé (titre ou « canal Test ») : un seul, sinon la réponse à donner. */
async function channelFor(deps: BossDeps, raw: string): Promise<{ ok: true; channel: ChannelRef } | { ok: false; reply: string }> {
  const chatId = await chatKeyOf(deps);
  const cleaned = raw.replace(/^\s*(?:le|la|l'|notre|mon)?\s*(?:canal|chaine|chaîne|groupe)\s+/iu, "").trim() || raw;
  if (/^(?:test|de test)$/i.test(cleaned)) {
    const t = await findTestChannel(deps.prisma);
    if (t) return { ok: true, channel: { id: t.id, name: t.title, vertical: t.vertical, isTest: true, personaName: null, team: null } };
  }
  const refs = await channelRefs(deps);
  const found = matchNames(cleaned, refs.map((c) => ({ ...c, extra: c.personaName ? [c.personaName] : [] })));
  if (!found.length) return { ok: false, reply: pick(FEEDBACK_VARIANTS.noChannel({ name: esc(cleaned.slice(0, 60)) }), "montage.feedback.noChannel", chatId) };
  const exact = found.find((f) => f.name.toLowerCase() === cleaned.toLowerCase());
  if (found.length > 1 && !exact) return { ok: false, reply: pick(FEEDBACK_VARIANTS.manyChannels({ list: esc(found.slice(0, 4).map((f) => f.name).join(", ")) }), "montage.feedback.many", chatId) };
  return { ok: true, channel: exact ?? found[0]! };
}

function numbersOf(p: SendP): number[] | null {
  if (!p.numeros) return null;
  const n = indexesIn(normalizeText(p.numeros));
  return n.length ? n : null;
}

export const envoyerShorts = defineAction<SendP>({
  key: "envoyer_shorts",
  description: "Envoyer les shorts validés du montage dans un canal (« envoie les 10 validés dans le canal Roulette »), un par message",
  theme: "casino",
  cls: "confirm",
  spec: {
    canal: str("Canal visé, tel que dit (« Roulette », « canal Test »)", { maxLength: 100 }),
    numeros: str("Numéros des shorts si le client en cite (« 2 et 5 ») ; absent = tous les validés", { optional: true, maxLength: 100 }),
    ecart_minutes: int("Minutes entre deux shorts (0 = tout de suite ; absent = une heure)", 0, 1440, true),
    travail: str("Laisse vide", { optional: true, maxLength: 40 }),
  },
  async classify(deps, p) {
    const c = await channelFor(deps, p.canal);
    return c.ok && c.channel.isTest ? "immediate" : "confirm";
  },
  async check(deps, p) {
    const chatId = await chatKeyOf(deps);
    const c = await channelFor(deps, p.canal);
    if (!c.ok) return { reply: c.reply };
    const jobId = p.travail ?? (await latestJobWithApproved(deps as KevinMontageDeps, chatId));
    const plan = jobId ? await sendPlanOf(deps as KevinMontageDeps, jobId, numbersOf(p), p.ecart_minutes ?? null, c.channel.isTest) : null;
    if (!plan?.shorts.length) return { reply: pick(FEEDBACK_VARIANTS.nothingToSend, "montage.feedback.nothing", chatId) };
    return null;
  },
  async summarize(deps, p) {
    const chatId = await chatKeyOf(deps);
    const c = await channelFor(deps, p.canal);
    const jobId = p.travail ?? (await latestJobWithApproved(deps as KevinMontageDeps, chatId));
    const plan = jobId && c.ok ? await sendPlanOf(deps as KevinMontageDeps, jobId, numbersOf(p), p.ecart_minutes ?? null, c.channel.isTest) : null;
    return pick(
      FEEDBACK_VARIANTS.sendSummary({ count: plan?.shorts.length ?? 0, channel: c.ok ? c.channel.name : p.canal, when: plan?.when ?? "" }),
      "montage.feedback.sendSummary",
      chatId,
    );
  },
  async execute(deps, p, actor) {
    const chatId = await chatKeyOf(deps);
    const c = await channelFor(deps, p.canal);
    if (!c.ok) return { reply: c.reply };
    const jobId = p.travail ?? (await latestJobWithApproved(deps as KevinMontageDeps, chatId));
    if (!jobId) return { reply: pick(FEEDBACK_VARIANTS.nothingToSend, "montage.feedback.nothing", chatId) };
    const reply = await sendApprovedShorts(deps as KevinMontageDeps, {
      jobId,
      channelId: c.channel.id,
      channelLabel: c.channel.isTest ? "le canal Test" : c.channel.name,
      indexes: numbersOf(p),
      spacingMinutes: p.ecart_minutes ?? null,
      isTest: c.channel.isTest,
      actor: { userId: actor.userId, via: "TELEGRAM" },
    });
    return { reply };
  },
});

export const MONTAGE_ACTIONS: BossAction[] = [montageVideo, voirMontage, montageStatusAction, modifierShort, annulerMontage, envoyerShorts] as unknown as BossAction[];

// ------------------------------------------------------------------------------------------------ chemin rapide

const PLAN_RELATED = /\b(?:\d{1,2}|plan|moment|short|clip|secondes?|garde|enleve|retire|vire|lance|commence|finis?|duree)\b/;

/**
 * Réponses au montage sans IA (webhook) : réponse à un aperçu (« Répondre »), au plan (« ok », « enlève le 3 »), à
 * « ✏️ Modifier » (« raccourcis de 2 secondes »), à un doute de sous-titre (« autre »), à la question de destination
 * (« envoie les validés dans le canal Roulette »), aux aperçus (« ok sauf le 3 ») ; demandes claires (« où en est le
 * montage ? », « annule le montage », « découpe ça en shorts de 15 s »). Admin seulement ; null = pas pour le montage.
 * Une question ouverte plus récente que l'attente du montage garde la priorité (sauf « Répondre » au message).
 */
export async function montageFastPath(
  deps: BossDeps,
  input: BossTeamInput,
  ctx: { otherQuestionAt: number; run: (action: BossAction, params: Record<string, unknown>) => Promise<BossReply> },
): Promise<{ reply: BossReply; actionKey: string } | null> {
  const text = (input.text ?? "").trim();
  if (!text || input.forwarded) return null;
  if (input.speaker && input.speaker.kind === "member") return null;
  if (input.chat && input.chat.type === "group") return null;
  const d = deps as KevinMontageDeps;
  const chatId = input.chat ? input.chat.chatId.toString() : ((await adminTelegramId(deps))?.toString() ?? null);
  if (!chatId) return null;
  const replyTo = input.replyToMessageId ?? null;
  const state = await readMontageState(deps, chatId);
  const a = state.await ?? null;
  const out = (reply: string, actionKey: string) => ({ reply: { reply } as BossReply, actionKey });

  // « Répondre » à l'aperçu d'un short : ce short-là.
  if (replyTo !== null) {
    const clip = (await deps.prisma.shortClip.findFirst({ where: { previewMsgId: BigInt(replyTo) } })) as { id: string; montageJobId: string; index: number } | null;
    if (clip) {
      const r = parsePreviewReply(text);
      if (r && (r.kind === "approveAll" || r.kind === "approve")) return out(await answerPreviews(d, clip.montageJobId, { kind: "approve", indexes: [clip.index] }), "modifier_short");
      if (/^(?:non|refuse|nul|pas bon|a jeter|poubelle)$/.test(normalizeText(text))) return out((await decideShort(d, clip.id, "no")).message, "modifier_short");
      const change = await understandChange(d, text);
      if (change) return out(await changeShort(d, clip.id, change), "modifier_short");
      return out(pick(FEEDBACK_VARIANTS.changeUnknown, "montage.feedback.unknown", chatId), "modifier_short");
    }
    if (!a?.messageIds?.includes(replyTo)) return null;
  }

  const intent = montageIntentOf(text);
  if (intent === "status") return { reply: await ctx.run(montageStatusAction as unknown as BossAction, {}), actionKey: "montage_status" };
  if (intent === "view") return { reply: await ctx.run(voirMontage as unknown as BossAction, {}), actionKey: "voir_montage" };
  if (intent === "cancel") return { reply: await ctx.run(annulerMontage as unknown as BossAction, {}), actionKey: "annuler_montage" };

  const targeted = replyTo !== null && !!a?.messageIds?.includes(replyTo);
  const fresh = !!a && (targeted || new Date(a.at).getTime() > ctx.otherQuestionAt);
  if (a && fresh) {
    switch (a.kind) {
      case "plan": {
        const r = parsePlanReply(text);
        // Une question (« combien en 2026 ? ») n'est jamais prise pour une réponse au plan.
        if (r.kind === "approve" || (PLAN_RELATED.test(normalizeText(text)) && !/\?\s*$/.test(text))) {
          const res = await answerPlan(d, a.jobId, text, { chatId });
          return out(res.reply, "montage_video");
        }
        break;
      }
      case "edit": {
        const pr = parsePreviewReply(text);
        if (pr && pr.kind !== "change" && pr.kind !== "askChange") return out(await answerPreviews(d, a.jobId, pr), "modifier_short");
        if (pr?.kind === "change") return out(await answerPreviews(d, a.jobId, pr), "modifier_short");
        const change = await understandChange(d, text);
        if (change) return out(await changeShort(d, a.clipId, change), "modifier_short");
        if (/\?\s*$/.test(text) || intent === "launch") break;
        return out(pick(FEEDBACK_VARIANTS.changeUnknown, "montage.feedback.unknown", chatId), "modifier_short");
      }
      case "subtitle": {
        if (/\?\s*$/.test(text) || intent) break;
        const r = await answerSubtitle(d, a.clipId, a.index, text);
        return { reply: { reply: r.reply, ...(r.buttons ? { buttons: r.buttons } : {}) }, actionKey: "modifier_short" };
      }
      case "destination": {
        const dest = parseDestination(text);
        if (dest?.kind === "keep") return out(await keepShorts(d, a.jobId), "envoyer_shorts");
        if (dest?.kind === "send")
          return {
            reply: await ctx.run(envoyerShorts as unknown as BossAction, {
              canal: dest.channel,
              ...(dest.indexes ? { numeros: dest.indexes.join(", ") } : {}),
              ...(dest.spacingMinutes !== null ? { ecart_minutes: dest.spacingMinutes } : {}),
              travail: a.jobId,
            }),
            actionKey: "envoyer_shorts",
          };
        const pr = parsePreviewReply(text);
        if (pr && pr.kind === "change") return out(await answerPreviews(d, a.jobId, pr), "modifier_short");
        break;
      }
      case "previews": {
        const pr = parsePreviewReply(text);
        if (pr) return out(await answerPreviews(d, a.jobId, pr), "modifier_short");
        break;
      }
      case "video": {
        if (looksLikeMontageInstructions(text)) {
          const r = await launchMontage(d, { chatId, video: a.video, text, instructionsMsgId: input.messageId });
          return out(r.reply, "montage_video");
        }
        break;
      }
      default:
        break;
    }
  }

  if (intent === "launch") return out((await montageFromPhrase(d, chatId, text, input.messageId)).reply, "montage_video");
  // Une consigne de montage juste après une vidéo (« 15 secondes, cam en haut ») : la vidéo gardée la prend.
  if (looksLikeMontageInstructions(text) && (state.videos ?? []).some((v) => !v.jobId && !v.assetId))
    return out((await montageFromPhrase(d, chatId, text, input.messageId)).reply, "montage_video");
  // « envoie les validés dans le canal Roulette », plus tard.
  const dest = parseDestination(text);
  if (dest?.kind === "send" && /short|valide|clip|montage/.test(normalizeText(text)))
    return {
      reply: await ctx.run(envoyerShorts as unknown as BossAction, {
        canal: dest.channel,
        ...(dest.indexes ? { numeros: dest.indexes.join(", ") } : {}),
        ...(dest.spacingMinutes !== null ? { ecart_minutes: dest.spacingMinutes } : {}),
      }),
      actionKey: "envoyer_shorts",
    };
  return null;
}
