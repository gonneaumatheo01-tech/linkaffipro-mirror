/**
 * Entrées du catalogue de Kevin pour mettre une persona à la place de la personne d'une vidéo reçue (moteur dans
 * `video-ia-run.ts`) et chemin rapide de la demande (sans IA, dans le webhook) :
 * - `remplacer_personne` (« mets Léa à la place de la personne dans cette vidéo ») : à confirmer par OUI (dépense de
 *   l'équipe Rencontres) ; contrôles AVANT la question (vidéo, durée, photo de référence, clé, plafond) ;
 * - `remplacement_status` (« où en est le remplacement ? ») ;
 * - `annuler_remplacement` (« annule le remplacement »).
 * Droits : lancer et annuler = l'admin seul (`team/rights.ts`) ; l'état = tout membre présenté.
 */
import { adminTelegramId } from "../admin/journal";
import { normalizeText } from "../human/answer";
import { latestFreeVideo } from "../montage/kevin-state";
import type { BossAction, BossDeps, BossReply, BossTeamInput } from "./contract";
import { defineAction } from "./catalog-kit";
import type { BossExecDeps } from "./catalog-read";
import { str } from "./params";
import { personaRefs } from "./resolve";
import { cancelReplace, prepareReplace, queueReplace, replaceStatus, replaceSummary, type VideoIaDeps } from "./video-ia-run";
import { videoIaIntentOf } from "./video-ia-intent";
import { VIDEO_IA_VARIANTS as V } from "./video-ia-texts";
import { pick } from "./voice";

/** Conversation de l'action (privé de l'admin par défaut). */
async function chatKeyOf(deps: BossDeps): Promise<string | null> {
  const c = (deps as BossExecDeps).chat;
  if (c) return c.chatId.toString();
  return (await adminTelegramId(deps))?.toString() ?? null;
}

type ReplaceP = { persona?: string };
type Empty = Record<string, never>;

export const remplacerPersonne = defineAction<ReplaceP>({
  key: "remplacer_personne",
  description:
    "Mettre une persona à la place de la personne dans une vidéo envoyée ici (« mets Léa à la place de la personne dans cette vidéo », « remplace la fille par Léa ») ; 15 secondes au plus, la vidéo revient ici, rien n'est publié",
  theme: "rencontres",
  cls: "confirm",
  spec: { persona: str("Nom de la persona à mettre dans la vidéo, tel que dit (« Léa »)", { optional: true, maxLength: 80 }) },
  async check(deps, p) {
    const chatId = await chatKeyOf(deps);
    if (!chatId) return { reply: pick(V.noVideo, "video-ia.noVideo") };
    const r = await prepareReplace(deps as VideoIaDeps, chatId, p.persona, p as Record<string, unknown>);
    return r.ok ? null : r.reply;
  },
  async summarize(deps, p) {
    const chatId = (await chatKeyOf(deps)) ?? "";
    const r = await prepareReplace(deps as VideoIaDeps, chatId, p.persona, p as Record<string, unknown>);
    return r.ok ? replaceSummary(r, chatId) : (r.reply.reply ?? "");
  },
  async execute(deps, p) {
    const chatId = await chatKeyOf(deps);
    if (!chatId) return { reply: pick(V.noVideo, "video-ia.noVideo") };
    // Revérifié après le OUI : la vidéo, le plafond ou la persona ont pu changer.
    const r = await prepareReplace(deps as VideoIaDeps, chatId, p.persona, p as Record<string, unknown>);
    if (!r.ok) return r.reply;
    return { reply: await queueReplace(deps as VideoIaDeps, chatId, r) };
  },
});

export const remplacementStatus = defineAction<Empty>({
  key: "remplacement_status",
  description: "Dire où en est le remplacement d'une personne par une persona dans une vidéo",
  theme: "rencontres",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const chatId = await chatKeyOf(deps);
    if (!chatId) return { reply: pick(V.none, "video-ia.none") };
    return { reply: await replaceStatus(deps as VideoIaDeps, chatId) };
  },
});

export const annulerRemplacement = defineAction<Empty>({
  key: "annuler_remplacement",
  description: "Arrêter le remplacement en cours d'une personne par une persona dans une vidéo",
  theme: "rencontres",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const chatId = await chatKeyOf(deps);
    if (!chatId) return { reply: pick(V.none, "video-ia.none") };
    return { reply: await cancelReplace(deps as VideoIaDeps, chatId) };
  },
});

export const VIDEO_IA_ACTIONS: BossAction[] = [remplacerPersonne, remplacementStatus, annulerRemplacement] as unknown as BossAction[];

/** Persona nommée dans la phrase (une seule), sinon undefined (Kevin demandera laquelle). */
async function personaNamed(deps: BossDeps, text: string): Promise<string | undefined> {
  const refs = await personaRefs(deps);
  const t = normalizeText(text);
  const hits = refs.filter((p) => new RegExp(`(?:^|[^\\p{L}])${normalizeText(p.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^\\p{L}]|$)`, "u").test(t));
  return hits.length === 1 ? hits[0]!.name : undefined;
}

/**
 * Chemin rapide (sans IA, admin en privé) : la demande de remplacement quand une vidéo vient d'arriver (sinon
 * l'interprète s'en charge et dira d'envoyer la vidéo), l'état et l'annulation. Passe AVANT le montage : « mets Léa à
 * la place de la personne dans cette vidéo de 15 secondes » n'est pas une consigne de montage.
 */
export async function videoIaFastPath(
  deps: BossDeps,
  input: BossTeamInput,
  ctx: { run: (action: BossAction, params: Record<string, unknown>) => Promise<BossReply> },
): Promise<{ reply: BossReply; actionKey: string } | null> {
  const text = (input.text ?? "").trim();
  if (!text || input.forwarded) return null;
  if (input.speaker && input.speaker.kind === "member") return null;
  if (input.chat && input.chat.type === "group") return null;
  const intent = videoIaIntentOf(text);
  if (!intent) return null;
  if (intent === "status") return { reply: await ctx.run(remplacementStatus as unknown as BossAction, {}), actionKey: "remplacement_status" };
  if (intent === "cancel") return { reply: await ctx.run(annulerRemplacement as unknown as BossAction, {}), actionKey: "annuler_remplacement" };
  const chatId = input.chat ? input.chat.chatId.toString() : ((await adminTelegramId(deps))?.toString() ?? null);
  if (!chatId || !(await latestFreeVideo(deps, chatId))) return null;
  const persona = await personaNamed(deps, text);
  return { reply: await ctx.run(remplacerPersonne as unknown as BossAction, persona ? { persona } : {}), actionKey: "remplacer_personne" };
}
