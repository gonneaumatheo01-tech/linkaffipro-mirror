/**
 * Phase 28, chantier E — réception d'une vidéo par Kevin (section 3 du prompt). Admin en privé seulement (le bot ne
 * passe ici que la conversation du dialogue admin ; un membre ou un inconnu n'arrive jamais jusqu'ici).
 *
 * - vidéo (`video`, `document` vidéo, vidéo transférée) : métadonnées gardées 30 min (`kevin-state.ts`) ; RIEN n'est
 *   téléchargé ici (la chaîne télécharge dans le worker) ;
 * - instructions : la légende écrite par l'admin, la phrase envoyée juste avant (gardée par le chemin rapide,
 *   `rememberMontagePhrase`) ou juste après (`montagePhraseAfterVideo`), un vocal transcrit (même chemin qu'un texte) ;
 *   comprises par `parseMontageInstructions` (chantier C) ;
 * - montage lancé : `createLongVideoAsset` puis `createMontageJob` (chantier D), « J'ai reçu ta vidéo (47 min, 1080p).
 *   Je l'analyse et je te propose un plan de coupe. » ;
 * - vidéo sans aucune phrase : « Je la monte ou je la garde ? » avec 2 boutons (`mvc:`), posée par le bot quelques
 *   secondes plus tard (une phrase qui arrive juste après la rend inutile) ;
 * - plus de 2 Go, plus de 3 h, format inconnu : refus clair ;
 * - vidéo TRANSFÉRÉE sans phrase de montage : gardée (une phrase après peut la monter), mais rien n'est lancé (elle
 *   sert peut-être au contenu d'un post, phase 34).
 */
import { looksLikeReplaceRequest } from "../boss/video-ia-intent";
import { esc, telegramActorUserId } from "../admin/journal";
import type { AdminButton } from "../types";
import { hasLibraryKeyword } from "../library/tags";
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import { MONTAGE_LIMITS } from "./contract";
import { parseMontageRules } from "./instructions";
import { montagePort, type KevinMontageDeps } from "./kevin-port";
import { clearMontageAwait, latestFreeVideo, markVideo, readMontageState, rememberVideo, setMontageAwait, type ReceivedVideo } from "./kevin-state";
import { durationLabel, instructionsSummary, montageNorm, resolutionLabel } from "./plan-message";

/** Boutons de la question « montage ou médiathèque ? » : `mvc:<messageId>:m|l`. */
export const MONTAGE_VIDEO_CHOICE_PREFIX = "mvc:";

/** Types de vidéo acceptés (ffmpeg les lit tous). */
export const MONTAGE_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/x-matroska", "video/webm", "video/x-msvideo", "video/x-m4v", "video/mpeg", "video/mp2t"]);

type DurationSample = { duration: string; resolution: string };

export const RECEPTION_VARIANTS = {
  /** Vidéo reçue, montage lancé. */
  received: voiceTemplate<DurationSample & { summary: string }>(
    [
      { duration: "47 min", resolution: "1080p", summary: "shorts de 15 s, vertical 9:16, cam en haut à droite, sous-titres" },
      { duration: "1 h 05", resolution: "4K", summary: "shorts de 15 s, vertical 9:16, sous-titres" },
    ],
    (p) => [
      `J'ai reçu ta vidéo (${p.duration}, ${p.resolution}). Je l'analyse et je te propose un plan de coupe.\nJe pars sur : ${p.summary}.`,
      `Vidéo bien reçue (${p.duration}, ${p.resolution}). Je la regarde et je reviens vers toi avec un plan de coupe.\nConsignes : ${p.summary}.`,
      `C'est reçu (${p.duration}, ${p.resolution}). Je l'analyse, tu auras un plan de coupe à valider.\nJe pars sur : ${p.summary}.`,
    ],
  ),
  /** Même chose quand la durée ou la qualité ne sont pas connues. */
  receivedPlain: voiceTemplate<{ summary: string }>([{ summary: "shorts de 15 s, vertical 9:16, sous-titres" }], (p) => [
    `J'ai reçu ta vidéo. Je l'analyse et je te propose un plan de coupe.\nJe pars sur : ${p.summary}.`,
    `Vidéo bien reçue. Je la regarde et je reviens vers toi avec un plan de coupe.\nConsignes : ${p.summary}.`,
  ]),
  /** Vidéo seule : montage ou médiathèque ? */
  whatToDo: voiceTemplate<DurationSample>([{ duration: "47 min", resolution: "1080p" }], (p) => [
    `J'ai ta vidéo (${p.duration}, ${p.resolution}). Je la découpe en shorts, ou je la garde dans la médiathèque ?`,
    `Bien reçu ta vidéo (${p.duration}, ${p.resolution}). Tu veux que je la monte en shorts, ou je la range ?`,
    `Vidéo reçue (${p.duration}, ${p.resolution}). Je t'en fais des shorts, ou je la garde de côté ?`,
  ]),
  whatToDoPlain: [
    "J'ai ta vidéo. Je la découpe en shorts, ou je la garde dans la médiathèque ?",
    "Bien reçu ta vidéo. Tu veux que je la monte en shorts, ou je la range ?",
  ],
  /** Demande de montage sans vidéo : Kevin attend le fichier. */
  sendVideo: [
    "Ok, envoie-moi la vidéo et je lance le montage.",
    "Ça marche. Envoie-moi la vidéo ici, je m'en occupe dès qu'elle arrive.",
    "Je suis prêt : envoie-moi la vidéo et je te propose un plan de coupe.",
  ],
  /** Vidéo trop lourde. */
  tooBig: voiceTemplate<{ size: string }>([{ size: "2,4 Go" }], (p) => [
    `Ta vidéo fait ${p.size} : je prends 2 Go au plus. Coupe-la en deux et renvoie-moi les morceaux.`,
    `Trop lourde pour moi (${p.size}, 2 Go au plus). Tu me l'envoies en deux morceaux ?`,
  ]),
  /** Vidéo trop longue. */
  tooLong: voiceTemplate<{ duration: string }>([{ duration: "3 h 20" }], (p) => [
    `Ta vidéo dure ${p.duration} : je prends 3 h au plus. Coupe-la en deux et renvoie-moi les morceaux.`,
    `Trop longue pour moi (${p.duration}, 3 h au plus). Tu me l'envoies en deux morceaux ?`,
  ]),
  /** Vidéo trop courte pour en tirer un short. */
  tooShort: [
    "Cette vidéo est trop courte pour en faire des shorts (5 secondes au moins). Envoie-moi la vidéo complète.",
    "Elle est trop courte pour un short, il me faut au moins 5 secondes. Tu m'envoies la vidéo complète ?",
  ],
  /** Format inconnu. */
  unknownFormat: [
    "Je ne sais pas lire ce format de vidéo. Envoie-la en MP4 ou en MOV, ça passera.",
    "Ce format de vidéo, je ne le lis pas. Renvoie-la en MP4 ou en MOV.",
  ],
  /** Source refusée par la chaîne (texte de la chaîne, déjà en français simple). */
  refused: voiceTemplate<{ reason: string }>([{ reason: "Je n'ai pas trouvé le fichier de la vidéo : renvoie-la." }], (p) => [p.reason]),
  /** Lancement impossible (la chaîne ne répond pas). */
  launchFailed: [
    "Je n'ai pas réussi à lancer le montage de mon côté. Renvoie-moi la vidéo dans quelques minutes.",
    "Le montage ne démarre pas pour l'instant. Tu me renvoies la vidéo dans quelques minutes ?",
  ],
  /** Bouton « Médiathèque » : vidéo gardée. */
  kept: [
    "C'est gardé dans la médiathèque ✅ Pour la ranger par thème, renvoie-la avec des mots-clés en légende, par exemple #casino #roulette.",
    "Je la garde dans la médiathèque ✅ Si tu veux un thème, renvoie-la avec des mots-clés comme #casino #roulette.",
  ],
  /** Bouton appuyé sur une vidéo déjà montée ou rangée, ou trop ancienne. */
  choiceGone: [
    "Cette vidéo n'attend plus rien de moi : elle est déjà montée, rangée ou trop ancienne. Renvoie-la si besoin.",
    "Je n'ai plus cette vidéo en attente. Renvoie-la si tu veux que je m'en occupe.",
  ],
} satisfies VoiceTable;

/** Libellés courts des boutons (pas des phrases de Kevin). */
export const VIDEO_CHOICE_BUTTONS = { montage: "✂️ Faire des shorts", library: "🗂 La garder" } as const;

// ------------------------------------------------------------------------------------------------ règles (pures)

const LAUNCH_WORDS =
  /(?:^|[^\p{L}])(?:decoupe\w*|decouper|coupe[sz]? (?:ca|la|cette|ma)|monte[sz]? (?:ca|la|cette|ma|moi)|monter (?:ca|la|cette|ma)|fai[st]?(?:-moi| moi)? (?:des|\d+|un|une|quelques|plein de|[a-z]+) (?:shorts?|clips?|reels?|tiktoks?|extraits?|courts?|petites? videos?)|en (?:shorts?|clips?|reels?|tiktoks?)|des shorts|montage de (?:ca|la|cette|ma)|(?:lance|fais|fait) (?:le |un )?montage|fais-en des|fais en des|transforme[sz]? (?:ca|la|cette) en)(?:[^\p{L}]|$)/u;

const STATUS_WORDS = /(?:ou en est|ou en sont|ca avance|avancement|status|statut|etat) (?:le |du |des |de mon )?(?:montage|shorts?|clips?)|(?:montage|shorts?) (?:ca )?(?:avance|en sont|ca donne)|ou en est le montage/;
const VIEW_WORDS = /(?:montre|montrer|voir|vois|affiche|afficher|liste|lister|donne)(?:-moi| moi)? (?:les |le |mes |mon )?(?:shorts?|montage|plan de coupe|plan du montage|clips du montage)/;
const CANCEL_WORDS = /(?:annule|annuler|arrete|arreter|stoppe|stopper|stop|laisse tomber|abandonne)(?:-le| le| la| ce| mon| les)? (?:montage|shorts?|decoupe)/;

export type MontageIntent = "launch" | "status" | "view" | "cancel";

/**
 * Que demande la phrase pour le montage (pur) ? `status` (« où en est le montage ? »), `view` (« montre-moi les
 * shorts »), `cancel` (« annule le montage »), `launch` (« découpe ça en shorts de 15 s », « fais-moi 10 clips de 15
 * secondes », « monte cette vidéo »), sinon null.
 */
export function montageIntentOf(text: string): MontageIntent | null {
  const t = montageNorm(text);
  if (!t) return null;
  if (CANCEL_WORDS.test(t)) return "cancel";
  if (STATUS_WORDS.test(t)) return "status";
  if (VIEW_WORDS.test(t)) return "view";
  if (LAUNCH_WORDS.test(t)) return "launch";
  return null;
}

/**
 * La phrase est-elle une consigne de montage (pur) ? Une demande de lancement, ou une consigne que seul le montage
 * comprend (« 15 secondes, cam en haut », « vertical pour TikTok avec sous-titres »). Les mots-clés de la médiathèque
 * seuls (« #casino #roulette ») n'en sont pas.
 */
export function looksLikeMontageInstructions(text: string): boolean {
  if (!text.trim()) return false;
  const intent = montageIntentOf(text);
  if (intent === "launch") return true;
  if (intent) return false;
  const r = parseMontageRules(text);
  const f = r.found;
  return f.durationTarget !== undefined || (f.pipPosition !== undefined && f.pipPosition !== "NONE") || f.count !== undefined || (f.format !== undefined && /tiktok|reel|short|vertical|carre|horizontal|sous-?titre/.test(montageNorm(text)));
}

export type VideoMessage = {
  messageId: number;
  fileId: string;
  fileUniqueId: string;
  sizeBytes: number | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  fileName: string | null;
  /** Message `document` (vidéo envoyée comme fichier). */
  asDocument: boolean;
};

export type VideoRefusal = "unknownFormat" | "tooBig" | "tooLong" | "tooShort";

/** Vidéo refusée avant tout enregistrement (pur) : format inconnu, plus de 2 Go, plus de 3 h, moins de 5 s. */
export function videoRefusalOf(v: Pick<VideoMessage, "mimeType" | "sizeBytes" | "durationSec" | "asDocument" | "fileName">): VideoRefusal | null {
  const mime = (v.mimeType ?? "").toLowerCase().split(";")[0]!.trim();
  const ext = /\.([a-z0-9]{2,5})$/i.exec(v.fileName ?? "")?.[1]?.toLowerCase();
  const knownExt = !!ext && ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mpg", "mpeg", "ts"].includes(ext);
  if (mime ? !MONTAGE_VIDEO_MIMES.has(mime) && !(v.asDocument && knownExt) : v.asDocument && !knownExt) return "unknownFormat";
  if (typeof v.sizeBytes === "number" && v.sizeBytes > MONTAGE_LIMITS.maxSourceBytes) return "tooBig";
  if (typeof v.durationSec === "number" && v.durationSec * 1000 > MONTAGE_LIMITS.maxSourceDurationMs) return "tooLong";
  if (typeof v.durationSec === "number" && v.durationSec > 0 && v.durationSec < MONTAGE_LIMITS.minShortSec) return "tooShort";
  return null;
}

function goLabel(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} Go`;
}

/** Texte du refus (voix de Kevin). */
export function refusalText(reason: VideoRefusal, v: Pick<VideoMessage, "sizeBytes" | "durationSec">, chatId: string | null): string {
  if (reason === "tooBig") return pick(RECEPTION_VARIANTS.tooBig({ size: goLabel(v.sizeBytes ?? 0) }), "montage.reception.tooBig", chatId);
  if (reason === "tooLong") return pick(RECEPTION_VARIANTS.tooLong({ duration: durationLabel(v.durationSec) ?? "plus de 3 h" }), "montage.reception.tooLong", chatId);
  if (reason === "tooShort") return pick(RECEPTION_VARIANTS.tooShort, "montage.reception.tooShort", chatId);
  return pick(RECEPTION_VARIANTS.unknownFormat, "montage.reception.format", chatId);
}

export function videoChoiceButtons(messageId: number): AdminButton[][] {
  return [
    [
      { text: VIDEO_CHOICE_BUTTONS.montage, callbackData: `${MONTAGE_VIDEO_CHOICE_PREFIX}${messageId}:m` },
      { text: VIDEO_CHOICE_BUTTONS.library, callbackData: `${MONTAGE_VIDEO_CHOICE_PREFIX}${messageId}:l` },
    ],
  ];
}

// ------------------------------------------------------------------------------------------------ réception

export type ReceiveVideoInput = {
  chatId: string;
  video: VideoMessage;
  botId: string | null;
  /** Transférée (d'un canal, d'une personne) : jamais un montage sans phrase de l'admin. */
  forwarded: boolean;
  /** Légende ÉCRITE par l'admin (null pour une vidéo transférée : la légende vient d'ailleurs). */
  caption: string | null;
};

export type ReceiveVideoResult =
  /** Kevin répond tout de suite (montage lancé, refus). */
  | { action: "reply"; reply: string; buttons?: AdminButton[][]; jobId?: string }
  /** Question « montage ou médiathèque ? » à poser dans quelques secondes (`montageVideoQuestion`). */
  | { action: "ask"; messageId: number }
  /** Pas pour le montage : le chemin d'avant continue (médiathèque à mots-clés, contenu transféré). */
  | { action: "pass" }
  /**
   * Légende qui demande autre chose sur cette vidéo (« mets Léa à la place de la personne ») : vidéo gardée, la légende
   * part comme un message de l'admin (chemin rapide de Kevin).
   */
  | { action: "text"; text: string };

function receivedOf(input: ReceiveVideoInput, receivedAt: Date): ReceivedVideo {
  const v = input.video;
  return {
    messageId: v.messageId,
    fileId: v.fileId,
    fileUniqueId: v.fileUniqueId,
    sizeBytes: v.sizeBytes,
    durationSec: v.durationSec,
    width: v.width,
    height: v.height,
    mimeType: v.mimeType ?? "video/mp4",
    fileName: v.fileName,
    botId: input.botId,
    forwarded: input.forwarded,
    receivedAt: receivedAt.toISOString(),
  };
}

/** Une phrase de montage arrivée avant la vidéo (2 minutes au plus), ou null. */
async function pendingPhrase(deps: KevinMontageDeps, chatId: string): Promise<{ text: string; messageId: number } | null> {
  const a = (await readMontageState(deps, chatId)).await;
  return a?.kind === "phrase" ? { text: a.text, messageId: a.messageId } : null;
}

/** Vidéo reçue en privé de l'admin (voir l'en-tête). Ne télécharge rien ; ne lève jamais. */
export async function receiveMontageVideo(deps: KevinMontageDeps, input: ReceiveVideoInput): Promise<ReceiveVideoResult> {
  const chatId = input.chatId;
  try {
    const refusal = videoRefusalOf(input.video);
    const caption = input.forwarded ? null : (input.caption?.trim() || null);
    // Personne à remplacer par une persona (`boss/video-ia-run.ts`) : la durée se juge là-bas (15 s au plus).
    if (caption && looksLikeReplaceRequest(caption) && (!refusal || refusal === "tooShort")) {
      await rememberVideo(deps, chatId, receivedOf(input, nowOf(deps)));
      return { action: "text", text: caption };
    }
    const phrase = await pendingPhrase(deps, chatId);
    const request = caption && looksLikeMontageInstructions(caption) ? caption : phrase && !caption ? phrase.text : null;
    // Transférée sans phrase de montage, ou légende à mots-clés de la médiathèque : le chemin d'avant (une vidéo
    // transférée reste gardée : « découpe ça » juste après la retrouve).
    if (!request && (input.forwarded || (caption && hasLibraryKeyword(caption)))) {
      if (!refusal) await rememberVideo(deps, chatId, receivedOf(input, nowOf(deps)));
      return { action: "pass" };
    }
    if (refusal) return { action: "reply", reply: refusalText(refusal, input.video, chatId) };
    const video = receivedOf(input, nowOf(deps));
    await rememberVideo(deps, chatId, video);
    if (request)
      return { action: "reply", ...(await launchMontage(deps, { chatId, video, text: request, instructionsMsgId: caption ? video.messageId : phrase?.messageId || video.messageId })) };
    // Vidéo seule (ou légende qui ne parle pas de montage) : question dans quelques secondes.
    await setMontageAwait(deps, chatId, { kind: "video", video, asked: false, at: nowOf(deps).toISOString() });
    return { action: "ask", messageId: video.messageId };
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[montage] vidéo reçue non traitée");
    return { action: "reply", reply: pick(RECEPTION_VARIANTS.launchFailed, "montage.reception.failed", chatId) };
  }
}

function nowOf(deps: KevinMontageDeps): Date {
  return deps.now ? deps.now() : new Date();
}

/**
 * Question « je la monte ou je la garde ? » (2 boutons), posée quelques secondes après la vidéo ; null si une phrase
 * l'a rendue inutile entre-temps (montage lancé, vidéo rangée).
 */
export async function montageVideoQuestion(deps: KevinMontageDeps, chatId: string, messageId: number): Promise<{ reply: string; buttons: AdminButton[][] } | null> {
  const s = await readMontageState(deps, chatId);
  const v = (s.videos ?? []).find((x) => x.messageId === messageId);
  if (!v || v.jobId || v.assetId) return null;
  if (s.await?.kind === "video" && s.await.video.messageId === messageId) await setMontageAwait(deps, chatId, { ...s.await, asked: true });
  const duration = durationLabel(v.durationSec);
  const resolution = resolutionLabel(v.width, v.height);
  const reply =
    duration && resolution
      ? pick(RECEPTION_VARIANTS.whatToDo({ duration, resolution }), "montage.reception.what", chatId)
      : pick(RECEPTION_VARIANTS.whatToDoPlain, "montage.reception.what.plain", chatId);
  return { reply, buttons: videoChoiceButtons(messageId) };
}

export type LaunchInput = { chatId: string; video: ReceivedVideo; text: string; instructionsMsgId: number | null };

/**
 * Lance le montage d'une vidéo reçue : source enregistrée (`createLongVideoAsset`), instructions comprises
 * (`parseMontageInstructions`), travail créé (`createMontageJob`). Rend la réponse de Kevin.
 */
export async function launchMontage(deps: KevinMontageDeps, input: LaunchInput): Promise<{ reply: string; jobId?: string }> {
  const port = montagePort(deps);
  const chatId = input.chatId;
  const v = input.video;
  const refusal = port.sourceRefusal({ sizeBytes: v.sizeBytes, durationMs: typeof v.durationSec === "number" ? v.durationSec * 1000 : null });
  if (refusal) return { reply: pick(RECEPTION_VARIANTS.refused({ reason: esc(refusal) }), "montage.reception.refused", chatId) };
  try {
    const createdById = await telegramActorUserId(deps).catch(() => null);
    const asset = await port.createLongVideoAsset(deps, {
      chatId,
      messageId: v.messageId,
      fileId: v.fileId,
      fileUniqueId: v.fileUniqueId,
      fileName: v.fileName,
      mimeType: v.mimeType,
      sizeBytes: v.sizeBytes,
      durationSec: v.durationSec,
      width: v.width,
      height: v.height,
      createdById,
      botId: v.botId,
    });
    if (!asset.ok) return { reply: pick(RECEPTION_VARIANTS.refused({ reason: esc(asset.reason) }), "montage.reception.refused", chatId) };
    const instructions = await port.parseInstructions(deps, input.text);
    const job = await port.createMontageJob(deps, { sourceAssetId: asset.assetId, instructions, chatId, instructionsMsgId: input.instructionsMsgId, createdById });
    await markVideo(deps, chatId, v.messageId, { jobId: job.id });
    await clearMontageAwait(deps, chatId, (a) => a.kind === "phrase" || (a.kind === "video" && a.video.messageId === v.messageId));
    const summary = esc(instructionsSummary(instructions));
    const duration = durationLabel(v.durationSec);
    const resolution = resolutionLabel(v.width, v.height);
    const reply =
      duration && resolution
        ? pick(RECEPTION_VARIANTS.received({ duration, resolution, summary }), "montage.reception.received", chatId)
        : pick(RECEPTION_VARIANTS.receivedPlain({ summary }), "montage.reception.received.plain", chatId);
    return { reply, jobId: job.id };
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[montage] lancement impossible");
    return { reply: pick(RECEPTION_VARIANTS.launchFailed, "montage.reception.failed", chatId) };
  }
}

/**
 * Phrase de montage de l'admin (« découpe ça en shorts de 15 secondes ») : une vidéo reçue juste avant (30 min, pas
 * encore utilisée) est montée ; sinon la phrase est gardée 2 minutes pour la vidéo qui arrive (« envoie-moi la
 * vidéo »). Rend la réponse.
 */
export async function montageFromPhrase(deps: KevinMontageDeps, chatId: string, text: string, messageId: number | null): Promise<{ reply: string; jobId?: string }> {
  const video = await latestFreeVideo(deps, chatId);
  if (video) return launchMontage(deps, { chatId, video, text, instructionsMsgId: messageId });
  await setMontageAwait(deps, chatId, { kind: "phrase", text: text.slice(0, 1000), messageId: messageId ?? 0, at: nowOf(deps).toISOString() });
  return { reply: pick(RECEPTION_VARIANTS.sendVideo, "montage.reception.send", chatId) };
}

/** Bouton `mvc:` (montage ou médiathèque) : rend la réponse de Kevin. */
export async function handleVideoChoice(deps: KevinMontageDeps, chatId: string, messageId: number, choice: "m" | "l"): Promise<string> {
  const s = await readMontageState(deps, chatId);
  const v = (s.videos ?? []).find((x) => x.messageId === messageId);
  if (!v || v.jobId || v.assetId) return pick(RECEPTION_VARIANTS.choiceGone, "montage.reception.gone", chatId);
  if (choice === "m") return (await launchMontage(deps, { chatId, video: v, text: "", instructionsMsgId: messageId })).reply;
  const createdById = await telegramActorUserId(deps).catch(() => null);
  const asset = await montagePort(deps).createLongVideoAsset(deps, {
    chatId,
    messageId: v.messageId,
    fileId: v.fileId,
    fileUniqueId: v.fileUniqueId,
    fileName: v.fileName,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    durationSec: v.durationSec,
    width: v.width,
    height: v.height,
    createdById,
    botId: v.botId,
  });
  if (!asset.ok) return pick(RECEPTION_VARIANTS.refused({ reason: esc(asset.reason) }), "montage.reception.refused", chatId);
  await markVideo(deps, chatId, messageId, { assetId: asset.assetId });
  return pick(RECEPTION_VARIANTS.kept, "montage.reception.kept", chatId);
}
