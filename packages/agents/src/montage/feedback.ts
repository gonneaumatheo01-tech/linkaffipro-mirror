/**
 * Phase 28, chantier E — retours du client sur les shorts (section 8 du prompt) :
 * - boutons `msh:<clipId>:ok|edit|no` : ✅ → APPROVED ; ✏️ → Kevin demande quoi changer ; ❌ → REJECTED (archivé) ;
 *   `mst:` (doute de sous-titre : variante choisie ou « autre ») ; `msq:` (contrôle raté : refaire ou montrer) ;
 *   `mvc:` (vidéo seule : montage ou médiathèque) ;
 * - réponses écrites : « ok », « ok sauf le 3 », « le 5, raccourcis de 2 secondes », « refuse le 4 » ; ce qu'il faut
 *   changer (« commence 3 s plus tôt », « cam en bas à gauche », « ajoute le texte "Gros gain" », « sans
 *   sous-titres ») → `redoClip` de la chaîne ;
 * - tout tranché : « 8/10 shorts validés. Tu veux que je les envoie quelque part ? (canal, ou je les garde ici) » ;
 * - envoi des validés dans un canal : un message programmé par short, par l'opération du site « messages.programmer »
 *   (mêmes contrôles que le site) ; SEULS les shorts validés (✅) partent, jamais un autre.
 * `decideShort` : même effet que les boutons ✅ / ❌ (appelé aussi par la page Montage du site).
 */
import type { AiToolDef } from "@linkaffipro/ai";
import { adminTelegramId, agentAudit, esc, nowOf, telegramActorUserId } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import { BOSS_MESSAGE_MARK } from "../boss/llm";
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import { parisParts } from "../rules/time";
import type { AdminButton } from "../types";
import { SHORT_CALLBACK_PREFIX, type PipPosition, type ShortFormat } from "./contract";
import { parseMontageRules } from "./instructions";
import { montagePort, type ClipChange, type KevinMontageDeps } from "./kevin-port";
import { clearMontageAwait, readMontageState, setMontageAwait } from "./kevin-state";
import { durationIn, indexesIn, montageNorm, shiftIn } from "./plan-message";
import { doubtOptions, previewButtons, previewCaption, QC_CALLBACK_PREFIX, SUBTITLE_CALLBACK_PREFIX, subtitleDoubtButtons, subtitleDoubtText } from "./preview";
import { handleVideoChoice, MONTAGE_VIDEO_CHOICE_PREFIX } from "./reception";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

type ChangeSample = { index: number; change: string };

export const FEEDBACK_VARIANTS = {
  approved: voiceTemplate<{ index: number }>([{ index: 3 }], (p) => [`Short ${p.index} validé ✅`, `C'est validé pour le short ${p.index} ✅`, `Short ${p.index} : validé ✅`]),
  approvedMany: voiceTemplate<{ list: string; count: number }>([{ list: "1, 2 et 4", count: 3 }], (p) => [
    `C'est validé pour les shorts ${p.list} ✅`,
    `${plural(p.count, "short validé", "shorts validés")} : ${p.list} ✅`,
  ]),
  rejected: voiceTemplate<{ index: number }>([{ index: 4 }], (p) => [
    `Short ${p.index} refusé, je l'archive. Il ne sera jamais publié.`,
    `Ok, je mets le short ${p.index} de côté. Il ne partira nulle part.`,
  ]),
  rejectedMany: voiceTemplate<{ list: string }>([{ list: "4 et 7" }], (p) => [`Shorts ${p.list} refusés, je les archive.`, `Je mets de côté les shorts ${p.list}, ils ne partiront nulle part.`]),
  askChange: voiceTemplate<{ index: number }>([{ index: 3 }], (p) => [
    `Qu'est-ce que je change sur le short ${p.index} ? Par exemple « raccourcis de 2 secondes », « cam en bas à gauche », « ajoute le texte "Gros gain" » ou « sans sous-titres ».`,
    `Tu veux quoi de différent sur le short ${p.index} ? Dis-moi par exemple « commence 3 s plus tôt », « cam en haut à droite » ou « sans sous-titres ».`,
  ]),
  askChangeSome: voiceTemplate<{ list: string; index: number }>([{ list: "1, 2 et 4", index: 3 }], (p) => [
    `C'est validé pour les shorts ${p.list} ✅ Qu'est-ce que je change sur le ${p.index} ?`,
    `Shorts ${p.list} validés ✅ Et pour le ${p.index}, je change quoi ?`,
  ]),
  redoing: voiceTemplate<ChangeSample>(
    [
      { index: 5, change: "2 s plus court" },
      { index: 3, change: "cam en bas à gauche, sans sous-titres" },
    ],
    (p) => [
      `C'est noté, je refais le short ${p.index} : ${p.change}. Je te renvoie l'aperçu.`,
      `Je refais le short ${p.index} (${p.change}), tu reçois le nouvel aperçu dès qu'il est prêt.`,
      `Ok pour le short ${p.index} : ${p.change}. Nouvel aperçu dans quelques minutes.`,
    ],
  ),
  changeUnknown: [
    "Je n'ai pas compris quoi changer. Dis par exemple « raccourcis de 2 secondes », « commence 3 s plus tôt », « cam en bas à gauche » ou « sans sous-titres ».",
    "Pas sûr de comprendre le changement. Essaie par exemple « rallonge de 2 secondes », « cam en haut à droite » ou « ajoute le texte “Gros gain” ».",
  ],
  notWaiting: voiceTemplate<{ index: number }>([{ index: 3 }], (p) => [
    `Le short ${p.index} n'attend pas de réponse : il est déjà tranché ou pas encore prêt.`,
    `Rien à décider sur le short ${p.index} pour l'instant.`,
  ]),
  noSuchShort: voiceTemplate<{ index: number }>([{ index: 14 }], (p) => [`Je n'ai pas de short ${p.index} dans ce montage.`, `Il n'y a pas de short ${p.index} dans ce montage.`]),
  allDecided: voiceTemplate<{ approved: number; total: number }>(
    [
      { approved: 8, total: 10 },
      { approved: 1, total: 1 },
    ],
    (p) => [
      `${p.approved}/${p.total} shorts validés. Tu veux que je les envoie quelque part ? (canal, ou je les garde ici)`,
      `Tout est tranché : ${p.approved}/${p.total} shorts validés. Je les envoie dans un canal, ou je les garde ici ?`,
    ],
  ),
  noneApproved: voiceTemplate<{ total: number }>([{ total: 10 }], (p) => [
    `Aucun des ${plural(p.total, "short")} n'est validé. Tu veux que je refasse un plan de coupe ? Renvoie-moi la vidéo avec d'autres consignes.`,
    `Rien de validé sur les ${plural(p.total, "short")}. Renvoie-moi la vidéo avec d'autres consignes et je refais un plan.`,
  ]),
  keptHere: voiceTemplate<{ count: number }>([{ count: 8 }], (p) => [
    `Je les garde ici : ${plural(p.count, "short validé", "shorts validés")} dans la médiathèque. Dis-moi quand tu veux les envoyer.`,
    `Ok, les ${plural(p.count, "short")} restent dans la médiathèque. Tu me dis quand les envoyer.`,
  ]),
  subtitleFixed: voiceTemplate<{ index: number }>([{ index: 3 }], (p) => [
    `C'est corrigé ✅ Je finis le short ${p.index} et je te l'envoie.`,
    `Merci, c'est corrigé. Le short ${p.index} repart, je te l'envoie dès qu'il est prêt.`,
  ]),
  subtitleAskText: voiceTemplate<{ index: number }>([{ index: 3 }], (p) => [
    `Écris-moi le bon texte pour ce passage du short ${p.index}.`,
    `Ok, tape-moi le bon texte de ce passage (short ${p.index}).`,
  ]),
  qcRedo: voiceTemplate<{ index: number }>([{ index: 4 }], (p) => [`Je refais le short ${p.index}, tu reçois l'aperçu dès qu'il est prêt.`, `Ok, je relance le short ${p.index}.`]),
  qcShown: voiceTemplate<{ index: number }>([{ index: 4 }], (p) => [
    `Le short ${p.index} tel qu'il est, juste au-dessus. Il ne part nulle part tant que tu ne l'as pas validé.`,
    `Le short ${p.index} comme il est, juste au-dessus. Rien ne part sans ton ✅`,
  ]),
  notYours: ["Ce choix revient à l'admin.", "Seul l'admin décide pour les shorts."],
  buttonGone: ["Ce bouton ne sert plus : le short a déjà été tranché.", "Déjà tranché, ce bouton ne sert plus."],
  failed: ["Ça n'a pas marché de mon côté, réessaie dans un instant.", "Raté, réessaie dans un instant."],
  /** Envoi des shorts validés. */
  sendSummary: voiceTemplate<{ count: number; channel: string; when: string }>(
    [
      { count: 10, channel: "Roulette", when: "un toutes les heures à partir de 20:05" },
      { count: 1, channel: "Casino VIP", when: "à 20:05" },
    ],
    (p) => [
      `J'envoie ${plural(p.count, "short validé", "shorts validés")} dans ${p.channel}, ${p.when} ?`,
      `Je programme ${plural(p.count, "short validé", "shorts validés")} sur ${p.channel}, ${p.when} ?`,
    ],
  ),
  sent: voiceTemplate<{ count: number; channel: string; when: string }>(
    [
      { count: 10, channel: "Roulette", when: "un toutes les heures à partir de 20:05" },
      { count: 1, channel: "le canal Test", when: "à 20:05" },
    ],
    (p) => [`C'est programmé : ${plural(p.count, "short")} dans ${p.channel}, ${p.when} ✅`, `Fait, ${plural(p.count, "short")} part${p.count > 1 ? "ent" : ""} sur ${p.channel}, ${p.when} ✅`],
  ),
  sentPartly: voiceTemplate<{ done: number; count: number; reason: string }>([{ done: 7, count: 10, reason: "Média introuvable dans la médiathèque." }], (p) => [
    `J'en ai programmé ${p.done} sur ${p.count}. Pour les autres, le site répond : ${p.reason}`,
    `${p.done} sur ${p.count} sont programmés. Les autres coincent : ${p.reason}`,
  ]),
  nothingToSend: [
    "Je n'ai aucun short validé à envoyer. Valide-les d'abord avec ✅ sur chaque aperçu.",
    "Rien de validé pour l'instant : appuie sur ✅ sous les aperçus que tu veux garder.",
  ],
  noChannel: voiceTemplate<{ name: string }>([{ name: "Roulette" }], (p) => [`Je ne trouve pas de canal « ${p.name} ». Tu me donnes son nom exact ?`, `Pas de canal « ${p.name} » chez moi. C'est lequel exactement ?`]),
  manyChannels: voiceTemplate<{ list: string }>([{ list: "Roulette VIP, Roulette FR" }], (p) => [`Plusieurs canaux correspondent : ${p.list}. Lequel ?`, `J'en vois plusieurs : ${p.list}. Tu veux lequel ?`]),
  siteDown: [
    "Le site ne répond pas pour programmer les shorts. Réessaie dans quelques minutes.",
    "Je n'arrive pas à joindre le site pour programmer. Tu réessaies dans quelques minutes ?",
  ],
} satisfies VoiceTable;

// ------------------------------------------------------------------------------------------------ règles (pures)

const OK_ONLY = /^(?:ok|okay|oki|go|c'est bon|c bon|parfait|top|nickel|valide|valides|je valide|tout est bon|tous ok|ok pour tous|ok pour tout|ok tous|tout ok|d'accord|ca marche|ca me va|super|👍|✅|ok c'est bon|ok parfait|ok pour moi|valide tout|valide tous|valide les tous|tout valider)$/;

/** Liste « 1, 2 et 4 » (pur). */
export function listLabel(ns: readonly number[]): string {
  const s = [...ns].sort((a, b) => a - b).map(String);
  return s.length <= 1 ? (s[0] ?? "") : `${s.slice(0, -1).join(", ")} et ${s[s.length - 1]}`;
}

const PIP_WORDS: Array<[RegExp, PipPosition]> = [
  [/(?:cam|camera|webcam|visage|face ?cam)\w*\s+(?:en\s+)?haut\s+(?:a\s+)?droite/, "TOP_RIGHT"],
  [/(?:cam|camera|webcam|visage|face ?cam)\w*\s+(?:en\s+)?haut\s+(?:a\s+)?gauche/, "TOP_LEFT"],
  [/(?:cam|camera|webcam|visage|face ?cam)\w*\s+(?:en\s+)?bas\s+(?:a\s+)?droite/, "BOTTOM_RIGHT"],
  [/(?:cam|camera|webcam|visage|face ?cam)\w*\s+(?:en\s+)?bas\s+(?:a\s+)?gauche/, "BOTTOM_LEFT"],
  [/(?:sans|enleve|retire|vire|pas de)\s+(?:la\s+)?(?:cam|camera|webcam|face ?cam)/, "NONE"],
];

/**
 * Ce qu'il faut changer sur un short (pur) : début / fin (« commence 3 s plus tôt », « raccourcis de 2 secondes »),
 * durée (« en 10 secondes »), caméra, format, sous-titres, texte incrusté (« ajoute le texte "Gros gain" », « enlève
 * le texte »), vitesse. Null si rien n'est compris.
 */
export function parseClipChange(raw: string): ClipChange | null {
  const t = montageNorm(raw);
  if (!t) return null;
  const change: ClipChange = { note: raw.trim().slice(0, 500) };
  const shift = shiftIn(t);
  if (shift?.startDeltaMs) change.startDeltaMs = shift.startDeltaMs;
  if (shift?.endDeltaMs) change.endDeltaMs = shift.endDeltaMs;
  if (!shift) {
    const d = durationIn(t);
    if (d !== null && d >= 5 && d <= 90) change.durationSec = d;
  }
  for (const [re, pos] of PIP_WORDS)
    if (re.test(t)) {
      change.pipPosition = pos;
      break;
    }
  if (/(?:sans|enleve|retire|vire|pas de|supprime)\s+(?:les\s+)?sous-?titres?/.test(t)) change.subtitles = false;
  else if (/(?:avec|ajoute|mets?|remets?)\s+(?:les\s+|des\s+)?sous-?titres?/.test(t)) change.subtitles = true;
  if (/(?:enleve|retire|vire|supprime|sans)\s+(?:le\s+)?texte/.test(t)) change.overlayText = null;
  const rules = parseMontageRules(raw);
  if (rules.found.overlayText && /texte|ecri|mets?|ajoute|incruste|titre/.test(t)) change.overlayText = rules.found.overlayText;
  if (rules.found.format && /vertical|horizontal|carre|paysage|portrait|tiktok|reel|9[:/]16|16[:/]9|1[:/]1/.test(t)) change.format = rules.found.format as ShortFormat;
  if (typeof rules.found.speed === "number" && rules.found.speed !== 1 && /vite|lent|vitesse|accelere|ralenti|x\s?\d/.test(t)) change.speed = rules.found.speed;
  const keys = Object.keys(change).filter((k) => k !== "note");
  return keys.length ? change : null;
}

/** Changement en mots (« 2 s plus court, cam en bas à gauche ») (pur). */
export function describeChange(c: ClipChange): string {
  const out: string[] = [];
  if (c.startDeltaMs) out.push(`début ${Math.abs(c.startDeltaMs) / 1000} s plus ${c.startDeltaMs < 0 ? "tôt" : "tard"}`);
  if (c.endDeltaMs) out.push(`${Math.abs(c.endDeltaMs) / 1000} s plus ${c.endDeltaMs < 0 ? "court" : "long"}`);
  if (c.durationSec) out.push(`${c.durationSec} s`);
  const pip: Record<PipPosition, string> = { TOP_RIGHT: "cam en haut à droite", TOP_LEFT: "cam en haut à gauche", BOTTOM_RIGHT: "cam en bas à droite", BOTTOM_LEFT: "cam en bas à gauche", NONE: "sans la cam" };
  if (c.pipPosition) out.push(pip[c.pipPosition]);
  if (c.format) out.push(c.format === "SQUARE_1_1" ? "en carré" : c.format === "HORIZONTAL_16_9" ? "en horizontal" : "en vertical");
  if (c.subtitles === false) out.push("sans sous-titres");
  if (c.subtitles === true) out.push("avec sous-titres");
  if (c.overlayText === null) out.push("sans texte");
  else if (c.overlayText) out.push(`texte « ${c.overlayText} »`);
  if (c.speed) out.push(`vitesse x${String(c.speed).replace(".", ",")}`);
  return out.join(", ") || "comme tu l'as dit";
}

export type PreviewReply =
  | { kind: "approveAll"; except: number[] }
  | { kind: "approve"; indexes: number[] }
  | { kind: "reject"; indexes: number[] }
  | { kind: "change"; index: number; change: ClipChange }
  /** Un numéro sans changement compris (« le 5, fais-le mieux ») : Kevin demande quoi changer. */
  | { kind: "askChange"; index: number };

/** Réponse écrite aux aperçus (pur) : « ok », « ok sauf le 3 », « valide le 2 », « refuse le 4 », « le 5, raccourcis de 2 secondes ». */
export function parsePreviewReply(raw: string): PreviewReply | null {
  const t = montageNorm(raw).replace(/[!.;]+$/g, "").trim();
  if (!t) return null;
  if (OK_ONLY.test(t)) return { kind: "approveAll", except: [] };
  const except = /^(?:ok|c'est bon|parfait|top|valide|tout est bon|tous ok|ok pour tous|tous)\b.*?\b(?:sauf|mais pas|a part|excepte|hors)\b(.*)$/.exec(t);
  if (except) {
    const idx = indexesIn(except[1]!);
    return idx.length ? { kind: "approveAll", except: idx } : null;
  }
  const head = /^(?:valide|valider|garde|ok pour|je garde|je valide)\b(.*)$/.exec(t);
  if (head) {
    const idx = indexesIn(head[1]!);
    if (idx.length) return { kind: "approve", indexes: idx };
  }
  const rej = /^(?:refuse|refuser|jette|jeter|vire|virer|supprime|supprimer|pas|enleve|retire|poubelle|archive)\b(.*)$/.exec(t);
  if (rej) {
    const rest = rej[1]!;
    const change = parseClipChange(rest);
    const idx = indexesIn(rest.replace(/\d+(?:[.,]\d+)?\s*(?:s|sec|secondes?)\b/g, " "));
    if (idx.length && !change) return { kind: "reject", indexes: idx };
  }
  // « le 5, raccourcis de 2 secondes » / « short 3 : cam en bas à gauche ».
  const target = /^(?:le|la|short|clip|pour le|sur le|au)?\s*(?:short|clip|n°|numero)?\s*(\d{1,2})\s*[,:-]?\s*(.+)$/.exec(t);
  if (target) {
    const index = Number(target[1]);
    const rest = target[2]!.trim();
    if (/^(?:ok|c'est bon|valide|parfait|top|nickel)$/.test(rest)) return { kind: "approve", indexes: [index] };
    if (/^(?:non|refuse|pas bon|a jeter|poubelle|nul)$/.test(rest)) return { kind: "reject", indexes: [index] };
    const change = parseClipChange(rest);
    if (change) return { kind: "change", index, change };
    if (/change|modifie|refais|corrige|retouche|ameliore/.test(rest)) return { kind: "askChange", index };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ données

type ClipRow = {
  id: string;
  montageJobId: string;
  index: number;
  status: string;
  assetId: string | null;
  durationMs: number;
  format: string;
  description: string | null;
  compressed: boolean;
  previewMsgId: bigint | number | null;
  subtitlesPending: unknown;
};
type JobRow = { id: string; status: string; chatId: string | null; completedAt: Date | null };

const WAITING = new Set(["PREVIEW_SENT"]);
/** Pas encore tranché par le client (un contrôle raté attend « refaire » ou « laisser tomber »). */
const UNDECIDED = new Set(["PLANNED", "CUTTING", "DRESSING", "QC", "QC_FAILED", "PREVIEW_SENT", "REDO"]);

async function clipOf(deps: KevinMontageDeps, clipId: string): Promise<ClipRow | null> {
  return (await deps.prisma.shortClip.findUnique({ where: { id: clipId } })) as ClipRow | null;
}

async function clipsOf(deps: KevinMontageDeps, jobId: string): Promise<ClipRow[]> {
  return (await deps.prisma.shortClip.findMany({ where: { montageJobId: jobId }, orderBy: { index: "asc" } })) as ClipRow[];
}

async function jobOf(deps: KevinMontageDeps, jobId: string): Promise<JobRow | null> {
  return (await deps.prisma.montageJob.findUnique({ where: { id: jobId } })) as JobRow | null;
}

async function actorOf(deps: KevinMontageDeps, actor?: ActorRef | null): Promise<ActorRef> {
  return actor ?? { userId: await telegramActorUserId(deps).catch(() => null), via: "TELEGRAM" };
}

export type DecideResult = { ok: boolean; message: string; index?: number; jobId?: string };

/**
 * ✅ / ❌ d'un short (même effet que les boutons de l'aperçu ; page Montage du site comprise). Seul un short dont
 * l'aperçu a été envoyé se valide : un short pas encore prêt ne peut jamais être validé (rien ne part sans aperçu).
 */
export async function decideShort(
  deps: KevinMontageDeps,
  clipId: string,
  decision: "ok" | "no",
  actor?: ActorRef | null,
  comment?: string | null,
): Promise<DecideResult> {
  const clip = await clipOf(deps, clipId);
  if (!clip) return { ok: false, message: "Short introuvable." };
  const chatId = (await jobOf(deps, clip.montageJobId))?.chatId ?? null;
  const allowed = decision === "ok" ? WAITING.has(clip.status) && !!clip.assetId : WAITING.has(clip.status) || clip.status === "QC_FAILED";
  if (!allowed) return { ok: false, message: pick(FEEDBACK_VARIANTS.notWaiting({ index: clip.index }), "montage.feedback.notWaiting", chatId), index: clip.index, jobId: clip.montageJobId };
  const r = await montagePort(deps).setClipDecision(deps, clipId, decision === "ok" ? "APPROVED" : "REJECTED", comment ?? null);
  if (!r.ok) return { ok: false, message: esc(r.reason), index: clip.index, jobId: clip.montageJobId };
  const who = await actorOf(deps, actor);
  await agentAudit(deps, {
    userId: who.userId ?? null,
    action: decision === "ok" ? "montage.short.approved" : "montage.short.rejected",
    entityType: "ShortClip",
    entityId: clipId,
    metadata: { via: who.via, jobId: clip.montageJobId, index: clip.index },
  });
  const message =
    decision === "ok"
      ? pick(FEEDBACK_VARIANTS.approved({ index: clip.index }), "montage.feedback.approved", chatId)
      : pick(FEEDBACK_VARIANTS.rejected({ index: clip.index }), "montage.feedback.rejected", chatId);
  return { ok: true, message, index: clip.index, jobId: clip.montageJobId };
}

/**
 * Tout est tranché ? Rend la phrase de bilan (« 8/10 shorts validés. Tu veux que je les envoie quelque part ? ») et
 * attend la destination ; null s'il reste des shorts en cours ou à décider.
 */
export async function settledSummary(deps: KevinMontageDeps, jobId: string): Promise<string | null> {
  const clips = (await clipsOf(deps, jobId)).filter((c) => c.status !== "CANCELLED");
  if (!clips.length || clips.some((c) => UNDECIDED.has(c.status))) return null;
  const job = await jobOf(deps, jobId);
  const chatId = job?.chatId ?? null;
  const approved = clips.filter((c) => c.status === "APPROVED").length;
  if (approved === 0) {
    if (chatId) await clearMontageAwait(deps, chatId);
    return pick(FEEDBACK_VARIANTS.noneApproved({ total: clips.length }), "montage.feedback.none", chatId);
  }
  if (chatId) await setMontageAwait(deps, chatId, { kind: "destination", jobId, at: nowOf(deps).toISOString() });
  return pick(FEEDBACK_VARIANTS.allDecided({ approved, total: clips.length }), "montage.feedback.all", chatId);
}

const withSummary = async (deps: KevinMontageDeps, jobId: string | undefined, text: string): Promise<string> => {
  if (!jobId) return text;
  const s = await settledSummary(deps, jobId);
  return s ? `${text}\n${s}` : text;
};

/** Journal d'une refabrication demandée par le client (toute action d'un utilisateur est dans `AuditLog`). */
async function auditRedo(deps: KevinMontageDeps, who: ActorRef, clip: Pick<ClipRow, "id" | "montageJobId" | "index">, change: string): Promise<void> {
  await agentAudit(deps, {
    userId: who.userId ?? null,
    action: "montage.short.modified",
    entityType: "ShortClip",
    entityId: clip.id,
    metadata: { via: who.via, jobId: clip.montageJobId, index: clip.index, change: change.slice(0, 200) },
  });
}

/** Modification d'un short : la chaîne le refait (`redoClip`). */
export async function changeShort(deps: KevinMontageDeps, clipId: string, change: ClipChange, actor?: ActorRef | null): Promise<string> {
  const clip = await clipOf(deps, clipId);
  const job = clip ? await jobOf(deps, clip.montageJobId) : null;
  const chatId = job?.chatId ?? null;
  if (!clip || !job) return pick(FEEDBACK_VARIANTS.failed, "montage.feedback.failed", chatId);
  if (!["PREVIEW_SENT", "QC_FAILED", "APPROVED", "REJECTED"].includes(clip.status))
    return pick(FEEDBACK_VARIANTS.notWaiting({ index: clip.index }), "montage.feedback.notWaiting", chatId);
  const who = await actorOf(deps, actor);
  const r = await montagePort(deps).redoClip(deps, clipId, change, who);
  if (!r.ok) return esc(r.reason);
  await auditRedo(deps, who, clip, describeChange(change));
  if (chatId) await clearMontageAwait(deps, chatId, (a) => a.kind === "edit" && a.clipId === clipId);
  if (chatId) await setMontageAwait(deps, chatId, { kind: "previews", jobId: job.id, at: nowOf(deps).toISOString() });
  return pick(FEEDBACK_VARIANTS.redoing({ index: clip.index, change: esc(describeChange(change)) }), "montage.feedback.redo", chatId);
}

// ------------------------------------------------------------------------------------------------ Haiku (modification)

export const CHANGE_TOOL: AiToolDef = {
  name: "modifier_short",
  description: "Ce que le client veut changer sur un short déjà monté",
  inputSchema: {
    type: "object",
    properties: {
      debut_secondes: { type: "number", minimum: -30, maximum: 30, description: "Début décalé (négatif = plus tôt)" },
      fin_secondes: { type: "number", minimum: -30, maximum: 30, description: "Fin décalée (négatif = plus tôt, donc plus court)" },
      duree_secondes: { type: "number", minimum: 5, maximum: 90 },
      camera: { type: "string", enum: ["TOP_RIGHT", "TOP_LEFT", "BOTTOM_RIGHT", "BOTTOM_LEFT", "NONE"] },
      format: { type: "string", enum: ["VERTICAL_9_16", "HORIZONTAL_16_9", "SQUARE_1_1"] },
      sous_titres: { type: "boolean" },
      texte: { type: "string", maxLength: 100, description: "Texte à incruster ; vide = retirer le texte" },
      vitesse: { type: "number", minimum: 0.5, maximum: 2 },
    },
    additionalProperties: false,
  },
  strict: false,
};

const CHANGE_SYSTEM_PROMPT = [
  "Tu lis ce qu'un client veut changer sur une courte vidéo (short) déjà montée.",
  "Tu appelles l'outil modifier_short avec les seuls changements demandés. Si la phrase ne demande aucun changement, n'appelle aucun outil.",
].join("\n");

/** Sortie de l'outil → changement validé par le code (pur), ou null. */
export function changeFromTool(input: unknown, note: string): ClipChange | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
  const c: ClipChange = { note: note.slice(0, 500) };
  const s = n(o.debut_secondes, -30, 30);
  const e = n(o.fin_secondes, -30, 30);
  const d = n(o.duree_secondes, 5, 90);
  if (s) c.startDeltaMs = Math.round(s * 1000);
  if (e) c.endDeltaMs = Math.round(e * 1000);
  if (d) c.durationSec = d;
  if (typeof o.camera === "string" && ["TOP_RIGHT", "TOP_LEFT", "BOTTOM_RIGHT", "BOTTOM_LEFT", "NONE"].includes(o.camera)) c.pipPosition = o.camera as PipPosition;
  if (typeof o.format === "string" && ["VERTICAL_9_16", "HORIZONTAL_16_9", "SQUARE_1_1"].includes(o.format)) c.format = o.format as ShortFormat;
  if (typeof o.sous_titres === "boolean") c.subtitles = o.sous_titres;
  if (typeof o.texte === "string") c.overlayText = o.texte.trim() ? o.texte.trim().slice(0, 100) : null;
  const v = n(o.vitesse, 0.5, 2);
  if (v && v !== 1) c.speed = v;
  return Object.keys(c).length > 1 ? c : null;
}

/** Changement compris par les règles, sinon par Haiku (interprète de Kevin), sinon null. */
export async function understandChange(deps: KevinMontageDeps, text: string): Promise<ClipChange | null> {
  const byRules = parseClipChange(text);
  if (byRules) return byRules;
  if (!deps.llm) return null;
  try {
    const r = await deps.llm.interpret({ system: CHANGE_SYSTEM_PROMPT, user: `${BOSS_MESSAGE_MARK}\n${text.slice(0, 500)}`, tools: [CHANGE_TOOL] });
    return r.toolUse?.name === CHANGE_TOOL.name ? changeFromTool(r.toolUse.input, text) : null;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[montage] changement non compris par l'IA");
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ réponses écrites

/** Réponse écrite aux aperçus d'un travail (« ok », « ok sauf le 3 », « le 5, raccourcis de 2 s »), ou null. */
export async function answerPreviews(deps: KevinMontageDeps, jobId: string, reply: PreviewReply, actor?: ActorRef | null): Promise<string> {
  const clips = (await clipsOf(deps, jobId)).filter((c) => c.status !== "CANCELLED");
  const job = await jobOf(deps, jobId);
  const chatId = job?.chatId ?? null;
  const byIndex = new Map(clips.map((c) => [c.index, c]));
  const missing = (ns: readonly number[]) => ns.find((n) => !byIndex.has(n));
  const who = await actorOf(deps, actor);
  if (reply.kind === "approveAll" || reply.kind === "approve") {
    const bad = reply.kind === "approveAll" ? missing(reply.except) : missing(reply.indexes);
    if (bad !== undefined) return pick(FEEDBACK_VARIANTS.noSuchShort({ index: bad }), "montage.feedback.nosuch", chatId);
    const targets =
      reply.kind === "approveAll" ? clips.filter((c) => WAITING.has(c.status) && !reply.except.includes(c.index)) : reply.indexes.map((n) => byIndex.get(n)!).filter((c) => WAITING.has(c.status));
    const done: number[] = [];
    for (const c of targets) if ((await decideShort(deps, c.id, "ok", who)).ok) done.push(c.index);
    const askFor = reply.kind === "approveAll" ? reply.except.find((n) => UNDECIDED.has(byIndex.get(n)!.status)) : undefined;
    if (askFor !== undefined) {
      const c = byIndex.get(askFor)!;
      if (chatId) await setMontageAwait(deps, chatId, { kind: "edit", clipId: c.id, jobId, at: nowOf(deps).toISOString() });
      return done.length
        ? pick(FEEDBACK_VARIANTS.askChangeSome({ list: listLabel(done), index: askFor }), "montage.feedback.askSome", chatId)
        : pick(FEEDBACK_VARIANTS.askChange({ index: askFor }), "montage.feedback.ask", chatId);
    }
    if (!done.length) {
      const first = reply.kind === "approve" ? reply.indexes[0]! : (clips[0]?.index ?? 1);
      return pick(FEEDBACK_VARIANTS.notWaiting({ index: first }), "montage.feedback.notWaiting", chatId);
    }
    const text =
      done.length === 1
        ? pick(FEEDBACK_VARIANTS.approved({ index: done[0]! }), "montage.feedback.approved", chatId)
        : pick(FEEDBACK_VARIANTS.approvedMany({ list: listLabel(done), count: done.length }), "montage.feedback.approvedMany", chatId);
    return withSummary(deps, jobId, text);
  }
  if (reply.kind === "reject") {
    const bad = missing(reply.indexes);
    if (bad !== undefined) return pick(FEEDBACK_VARIANTS.noSuchShort({ index: bad }), "montage.feedback.nosuch", chatId);
    const done: number[] = [];
    for (const n of reply.indexes) if ((await decideShort(deps, byIndex.get(n)!.id, "no", who)).ok) done.push(n);
    if (!done.length) return pick(FEEDBACK_VARIANTS.notWaiting({ index: reply.indexes[0]! }), "montage.feedback.notWaiting", chatId);
    const text =
      done.length === 1
        ? pick(FEEDBACK_VARIANTS.rejected({ index: done[0]! }), "montage.feedback.rejected", chatId)
        : pick(FEEDBACK_VARIANTS.rejectedMany({ list: listLabel(done) }), "montage.feedback.rejectedMany", chatId);
    return withSummary(deps, jobId, text);
  }
  const c = byIndex.get(reply.index);
  if (!c) return pick(FEEDBACK_VARIANTS.noSuchShort({ index: reply.index }), "montage.feedback.nosuch", chatId);
  if (reply.kind === "askChange") {
    if (chatId) await setMontageAwait(deps, chatId, { kind: "edit", clipId: c.id, jobId, at: nowOf(deps).toISOString() });
    return pick(FEEDBACK_VARIANTS.askChange({ index: c.index }), "montage.feedback.ask", chatId);
  }
  return changeShort(deps, c.id, reply.change, who);
}

// ------------------------------------------------------------------------------------------------ boutons

export function isMontageCallbackData(data: string): boolean {
  return data.startsWith(SHORT_CALLBACK_PREFIX) || data.startsWith(SUBTITLE_CALLBACK_PREFIX) || data.startsWith(QC_CALLBACK_PREFIX) || data.startsWith(MONTAGE_VIDEO_CHOICE_PREFIX);
}

export type MontageCallbackResult = {
  handled: boolean;
  toast?: string;
  reply?: string;
  buttons?: AdminButton[][];
  removeButtons?: boolean;
  /** Short à montrer (« me le montrer » après un contrôle raté) : envoyé par le bot de Kevin, sans ré-envoi du fichier. */
  video?: { assetId: string; caption: string; buttons: AdminButton[][]; clipId: string };
};

const TOAST = { ok: "Validé ✅", no: "Refusé", edit: "Je t'écoute", done: "C'est noté" } as const;

/** Bouton du montage : seul l'admin est écouté. Ne lève jamais. */
export async function handleMontageCallback(
  deps: KevinMontageDeps,
  input: { data: string; fromTelegramId: bigint | number | string; chatId?: string | null; messageId?: number | null },
): Promise<MontageCallbackResult> {
  if (!isMontageCallbackData(input.data)) return { handled: false };
  const admin = await adminTelegramId(deps);
  const fallbackChat = input.chatId ?? (admin ? admin.toString() : null);
  if (!admin || String(admin) !== String(input.fromTelegramId)) return { handled: true, toast: pick(FEEDBACK_VARIANTS.notYours, "montage.feedback.notYours", fallbackChat) };
  try {
    const data = input.data;
    if (data.startsWith(MONTAGE_VIDEO_CHOICE_PREFIX)) {
      const m = /^mvc:(\d{1,12}):([ml])$/.exec(data);
      if (!m || !fallbackChat) return { handled: true, removeButtons: true };
      return { handled: true, toast: TOAST.done, removeButtons: true, reply: await handleVideoChoice(deps, fallbackChat, Number(m[1]), m[2] as "m" | "l") };
    }
    if (data.startsWith(SHORT_CALLBACK_PREFIX)) {
      const m = /^msh:([A-Za-z0-9_-]{1,40}):(ok|edit|no)$/.exec(data);
      if (!m) return { handled: true, removeButtons: true };
      const clipId = m[1]!;
      const clip = await clipOf(deps, clipId);
      if (!clip) return { handled: true, removeButtons: true, reply: pick(FEEDBACK_VARIANTS.buttonGone, "montage.feedback.gone", fallbackChat) };
      const chatId = (await jobOf(deps, clip.montageJobId))?.chatId ?? fallbackChat;
      if (m[2] === "edit") {
        if (!["PREVIEW_SENT", "QC_FAILED", "APPROVED", "REJECTED"].includes(clip.status))
          return { handled: true, reply: pick(FEEDBACK_VARIANTS.notWaiting({ index: clip.index }), "montage.feedback.notWaiting", chatId) };
        if (chatId) await setMontageAwait(deps, chatId, { kind: "edit", clipId, jobId: clip.montageJobId, at: nowOf(deps).toISOString() });
        return { handled: true, toast: TOAST.edit, reply: pick(FEEDBACK_VARIANTS.askChange({ index: clip.index }), "montage.feedback.ask", chatId) };
      }
      // ✅ / ❌ sous l'aperçu d'une ANCIENNE version (short refait depuis) : jamais une décision sur une version que ce
      // message ne montre pas.
      if (typeof input.messageId === "number" && clip.previewMsgId != null && Number(clip.previewMsgId) !== input.messageId)
        return { handled: true, removeButtons: true, reply: pick(FEEDBACK_VARIANTS.buttonGone, "montage.feedback.gone", chatId) };
      const r = await decideShort(deps, clipId, m[2] === "ok" ? "ok" : "no");
      if (!r.ok) return { handled: true, removeButtons: true, reply: r.message };
      return { handled: true, toast: m[2] === "ok" ? TOAST.ok : TOAST.no, removeButtons: true, reply: await withSummary(deps, r.jobId, r.message) };
    }
    if (data.startsWith(SUBTITLE_CALLBACK_PREFIX)) {
      const m = /^mst:([A-Za-z0-9_-]{1,40}):(\d{1,3}):(\d|x)$/.exec(data);
      if (!m) return { handled: true, removeButtons: true };
      const clip = await clipOf(deps, m[1]!);
      if (!clip) return { handled: true, removeButtons: true, reply: pick(FEEDBACK_VARIANTS.buttonGone, "montage.feedback.gone", fallbackChat) };
      const chatId = (await jobOf(deps, clip.montageJobId))?.chatId ?? fallbackChat;
      const passage = Number(m[2]);
      const pending = pendingDoubts(clip.subtitlesPending);
      const doubt = pending.find((u) => u.index === passage);
      if (!doubt) return { handled: true, removeButtons: true, reply: pick(FEEDBACK_VARIANTS.buttonGone, "montage.feedback.gone", chatId) };
      if (m[3] === "x") {
        if (chatId) await setMontageAwait(deps, chatId, { kind: "subtitle", clipId: clip.id, jobId: clip.montageJobId, index: passage, atMs: doubt.atMs, at: nowOf(deps).toISOString() });
        return { handled: true, toast: TOAST.edit, removeButtons: true, reply: pick(FEEDBACK_VARIANTS.subtitleAskText({ index: clip.index }), "montage.feedback.subAsk", chatId) };
      }
      const options = doubtChoices(doubt);
      const chosen = options[Number(m[3])];
      if (!chosen) return { handled: true, removeButtons: true };
      return { handled: true, toast: TOAST.done, removeButtons: true, ...(await answerSubtitle(deps, clip.id, passage, chosen)) };
    }
    const m = /^msq:([A-Za-z0-9_-]{1,40}):(redo|keep|drop)$/.exec(data);
    if (!m) return { handled: true, removeButtons: true };
    const clip = await clipOf(deps, m[1]!);
    if (!clip || clip.status !== "QC_FAILED") return { handled: true, removeButtons: true, reply: pick(FEEDBACK_VARIANTS.buttonGone, "montage.feedback.gone", fallbackChat) };
    const chatId = (await jobOf(deps, clip.montageJobId))?.chatId ?? fallbackChat;
    if (m[2] === "redo") {
      const who = await actorOf(deps);
      const r = await montagePort(deps).redoClip(deps, clip.id, { note: "refaire après le contrôle qualité" }, who);
      if (!r.ok) return { handled: true, removeButtons: true, reply: esc(r.reason) };
      await auditRedo(deps, who, clip, "refaire après le contrôle qualité");
      return { handled: true, toast: TOAST.done, removeButtons: true, reply: pick(FEEDBACK_VARIANTS.qcRedo({ index: clip.index }), "montage.feedback.qcRedo", chatId) };
    }
    if (m[2] === "drop") {
      const r = await decideShort(deps, clip.id, "no");
      return { handled: true, toast: TOAST.no, removeButtons: true, reply: await withSummary(deps, r.jobId, r.message) };
    }
    // « Me le montrer » : l'aperçu part avec ses boutons ; le short reste à valider (✅), jamais publié sans.
    if (!clip.assetId) return { handled: true, removeButtons: true, reply: pick(FEEDBACK_VARIANTS.failed, "montage.feedback.failed", chatId) };
    await deps.prisma.shortClip.updateMany({ where: { id: clip.id, status: "QC_FAILED" }, data: { status: "PREVIEW_SENT" } });
    const total = (await clipsOf(deps, clip.montageJobId)).filter((c) => c.status !== "CANCELLED").length;
    const asset = (await deps.prisma.mediaAsset.findUnique({ where: { id: clip.assetId } })) as { size: number } | null;
    const caption = previewCaption(
      { index: clip.index, total, durationMs: clip.durationMs, format: clip.format, sizeBytes: asset?.size ?? 0, description: clip.description, compressed: clip.compressed },
      chatId,
    );
    if (chatId) await setMontageAwait(deps, chatId, { kind: "previews", jobId: clip.montageJobId, at: nowOf(deps).toISOString() });
    return {
      handled: true,
      toast: TOAST.done,
      removeButtons: true,
      reply: pick(FEEDBACK_VARIANTS.qcShown({ index: clip.index }), "montage.feedback.qcShown", chatId),
      video: { assetId: clip.assetId, caption, buttons: previewButtons(clip.id), clipId: clip.id },
    };
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[montage] bouton");
    return { handled: true, toast: pick(FEEDBACK_VARIANTS.failed, "montage.feedback.failed", fallbackChat) };
  }
}

// ------------------------------------------------------------------------------------------------ sous-titres

export type PendingDoubt = { index: number; atMs: number; text: string; alternatives: string[] };

/** Passages incertains gardés sur le short (`subtitlesPending`) : liste, ou `{ uncertain: [...] }` (pur). */
export function pendingDoubts(raw: unknown): PendingDoubt[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { uncertain?: unknown }).uncertain) ? (raw as { uncertain: unknown[] }).uncertain : [];
  const out: PendingDoubt[] = [];
  for (const u of list) {
    if (!u || typeof u !== "object") continue;
    const o = u as Record<string, unknown>;
    if (typeof o.index !== "number" || typeof o.text !== "string") continue;
    out.push({ index: o.index, atMs: typeof o.atMs === "number" ? o.atMs : 0, text: o.text, alternatives: Array.isArray(o.alternatives) ? o.alternatives.filter((a): a is string => typeof a === "string") : [] });
  }
  return out;
}

/** Choix proposés en boutons (mêmes que la question). */
export function doubtChoices(u: Pick<PendingDoubt, "text" | "alternatives">): string[] {
  const out: string[] = [];
  for (const a of [...u.alternatives, u.text]) {
    const t = a.replace(/\s+/g, " ").trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 4);
}

/**
 * Réponse du client à un doute : le passage est corrigé (`resolveSubtitleDoubt` de la chaîne) ; s'il reste des passages
 * incertains, la question suivante part (une à la fois) ; sinon le short repart.
 */
export async function answerSubtitle(
  deps: KevinMontageDeps,
  clipId: string,
  passage: number,
  text: string,
  actor?: ActorRef | null,
): Promise<{ reply: string; buttons?: AdminButton[][] }> {
  const clip = await clipOf(deps, clipId);
  const chatId = clip ? ((await jobOf(deps, clip.montageJobId))?.chatId ?? null) : null;
  if (!clip) return { reply: pick(FEEDBACK_VARIANTS.failed, "montage.feedback.failed", chatId) };
  const who = await actorOf(deps, actor);
  const r = await montagePort(deps).resolveSubtitleDoubt(deps, clipId, { index: passage, text: text.replace(/\s+/g, " ").trim().slice(0, 300) }, who);
  if (chatId) await clearMontageAwait(deps, chatId, (a) => a.kind === "subtitle" && a.clipId === clipId);
  if (!r.ok) return { reply: esc(r.reason) };
  await agentAudit(deps, {
    userId: who.userId ?? null,
    action: "montage.subtitle.answered",
    entityType: "ShortClip",
    entityId: clipId,
    metadata: { via: who.via, jobId: clip.montageJobId, index: clip.index, passage, done: r.done },
  });
  const next = r.done ? undefined : r.remaining[0];
  if (next) {
    const options = doubtOptions(next);
    return {
      reply: subtitleDoubtText({ atMs: next.atMs, text: next.text, alternatives: options }, clip.index, chatId),
      buttons: subtitleDoubtButtons(clip.id, next.index, options),
    };
  }
  return { reply: pick(FEEDBACK_VARIANTS.subtitleFixed({ index: clip.index }), "montage.feedback.subFixed", chatId) };
}

// ------------------------------------------------------------------------------------------------ destination

export type DestinationReply = { kind: "keep" } | { kind: "send"; channel: string; indexes: number[] | null; spacingMinutes: number | null };

/**
 * Où envoyer les shorts validés (pur) : « garde-les » ; « envoie les 10 validés dans le canal Roulette », « poste le 2
 * et le 5 sur Casino VIP toutes les 30 min », « mets-les dans Roulette maintenant ». Null sinon.
 */
export function parseDestination(raw: string): DestinationReply | null {
  const t = montageNorm(raw).replace(/[!.;]+$/g, "").trim();
  if (!t) return null;
  if (/^(?:garde|gardes|garde-les|garde les|laisse|laisse-les|laisse les|non|ici|je les prendrai|je les prends|pas besoin|rien|nulle part|garde-les ici|garde les ici)\b/.test(t)) return { kind: "keep" };
  const m = /^(?:envoie|envoies|envoyer|poste|postes|poster|publie|publies|publier|mets|met|mettre|balance|programme|programmer)(?:-les| les| le| la)?\b(.*?)\b(?:dans|sur)\s+(?:le canal|la chaine|le groupe|canal)?\s*(.+)$/.exec(t);
  if (!m) return null;
  let channel = m[2]!.trim();
  let spacing: number | null = null;
  const every = /\s*(?:,\s*)?(?:un |une )?(?:toutes les|tous les|chaque)\s+(\d+)\s*(min|minutes?|h|heures?)\s*$/.exec(channel);
  if (every) {
    spacing = Number(every[1]) * (/^h/.test(every[2]!) ? 60 : 1);
    channel = channel.slice(0, every.index).trim();
  }
  const now = /\s*(?:,\s*)?(?:maintenant|tout de suite|direct|d'un coup|en meme temps)\s*$/.exec(channel);
  if (now) {
    spacing = 0;
    channel = channel.slice(0, now.index).trim();
  }
  channel = channel.replace(/^(?:l'|le |la )/, "").trim();
  if (!channel) return null;
  const what = m[1]!;
  const all = /valides?|tous|toutes|les \d+|^\s*$|-les|^ les\b/.test(what) || !/\d/.test(what);
  const indexes = all ? null : indexesIn(what);
  return { kind: "send", channel, indexes: indexes && indexes.length ? indexes : null, spacingMinutes: spacing };
}

/** Écart par défaut entre deux shorts envoyés dans un vrai canal (jamais tout d'un coup sans le demander). */
export const DEFAULT_SPACING_MINUTES = 60;
/** Premier envoi : dans 5 minutes au moins (le temps de dire NON). */
export const FIRST_SEND_DELAY_MS = 5 * 60_000;

/** « 20:05 » heure de Paris (pur). */
export function hhmmParis(at: Date): string {
  const p = parisParts(at);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** « 2026-10-25T20:05 » heure de Paris (format du site). */
export function parisLocalInput(at: Date): string {
  const p = parisParts(at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Horaires d'envoi (pur) : à partir de `start`, un toutes les `spacing` minutes (0 = deux minutes d'écart). */
export function sendTimes(start: Date, count: number, spacingMinutes: number): Date[] {
  const step = Math.max(2, spacingMinutes) * 60_000;
  return Array.from({ length: count }, (_, i) => new Date(start.getTime() + i * step));
}

export function whenLabel(times: readonly Date[], spacingMinutes: number): string {
  if (!times.length) return "";
  if (times.length === 1) return `à ${hhmmParis(times[0]!)}`;
  if (spacingMinutes <= 2) return `à partir de ${hhmmParis(times[0]!)}, deux minutes d'écart`;
  const every = spacingMinutes % 60 === 0 ? `${spacingMinutes / 60 === 1 ? "heures" : `${spacingMinutes / 60} heures`}` : `${spacingMinutes} min`;
  return `un toutes les ${every} à partir de ${hhmmParis(times[0]!)}`;
}

/** Shorts validés d'un travail (avec leur média), dans l'ordre ; `indexes` : seulement ceux-là. RIEN d'autre ne part. */
export async function approvedShorts(deps: KevinMontageDeps, jobId: string, indexes: number[] | null): Promise<Array<{ id: string; index: number; assetId: string }>> {
  return (await clipsOf(deps, jobId))
    .filter((c) => c.status === "APPROVED" && !!c.assetId && (!indexes || indexes.includes(c.index)))
    .map((c) => ({ id: c.id, index: c.index, assetId: c.assetId! }));
}

/** Plan d'envoi (sans rien écrire) : shorts validés, horaires, libellé. */
export async function sendPlanOf(deps: KevinMontageDeps, jobId: string, indexes: number[] | null, spacingMinutes: number | null, isTest: boolean) {
  const shorts = await approvedShorts(deps, jobId, indexes);
  const spacing = spacingMinutes ?? (isTest ? 0 : DEFAULT_SPACING_MINUTES);
  const start = new Date(nowOf(deps).getTime() + (isTest ? 60_000 : FIRST_SEND_DELAY_MS));
  const times = sendTimes(start, shorts.length, spacing);
  return { shorts, times, spacing, when: whenLabel(times, spacing) };
}

/**
 * Envoi des shorts VALIDÉS dans un canal : un message programmé par short (vidéo seule), par l'opération du site
 * « messages.programmer » (même cœur que le bouton du site : bot du canal, contrôles, journal). Rend la réponse.
 */
export async function sendApprovedShorts(
  deps: KevinMontageDeps,
  input: { jobId: string; channelId: string; channelLabel: string; indexes: number[] | null; spacingMinutes: number | null; isTest: boolean; actor?: ActorRef | null },
): Promise<string> {
  const job = await jobOf(deps, input.jobId);
  const chatId = job?.chatId ?? null;
  const plan = await sendPlanOf(deps, input.jobId, input.indexes, input.spacingMinutes, input.isTest);
  if (!plan.shorts.length) return pick(FEEDBACK_VARIANTS.nothingToSend, "montage.feedback.nothing", chatId);
  if (!deps.siteOps) return pick(FEEDBACK_VARIANTS.siteDown, "montage.feedback.siteDown", chatId);
  const who = await actorOf(deps, input.actor);
  const admin = await adminTelegramId(deps);
  let done = 0;
  let lastError: string | null = null;
  for (let i = 0; i < plan.shorts.length; i++) {
    const s = plan.shorts[i]!;
    try {
      const r = await deps.siteOps({
        op: "messages.programmer",
        input: { channelIds: [input.channelId], text: "", mediaAssetIds: [s.assetId], scheduledAt: parisLocalInput(plan.times[i]!) },
        actor: { userId: who.userId ?? null, role: "ADMIN", via: "TELEGRAM", telegramUserId: admin ? admin.toString() : null },
      });
      if (r.ok) done++;
      else lastError = r.error;
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message }, "[montage] short non programmé");
      lastError = null;
    }
  }
  if (done === 0 && lastError === null) return pick(FEEDBACK_VARIANTS.siteDown, "montage.feedback.siteDown", chatId);
  if (chatId) await clearMontageAwait(deps, chatId, (a) => a.kind === "destination");
  await agentAudit(deps, { userId: who.userId ?? null, action: "montage.shorts.sent", entityType: "MontageJob", entityId: input.jobId, metadata: { channelId: input.channelId, count: done } });
  if (done < plan.shorts.length) return pick(FEEDBACK_VARIANTS.sentPartly({ done, count: plan.shorts.length, reason: esc(lastError ?? "le site ne répond pas.") }), "montage.feedback.partly", chatId);
  return pick(FEEDBACK_VARIANTS.sent({ count: done, channel: esc(input.channelLabel), when: plan.when }), "montage.feedback.sent", chatId);
}

/** Garde les shorts ici (médiathèque) : rien n'est envoyé. */
export async function keepShorts(deps: KevinMontageDeps, jobId: string): Promise<string> {
  const job = await jobOf(deps, jobId);
  const chatId = job?.chatId ?? null;
  const count = (await approvedShorts(deps, jobId, null)).length;
  if (chatId) await clearMontageAwait(deps, chatId, (a) => a.kind === "destination");
  return pick(FEEDBACK_VARIANTS.keptHere({ count }), "montage.feedback.kept", chatId);
}

/** Travail le plus récent de la conversation qui a des shorts validés, ou null. */
export async function latestJobWithApproved(deps: KevinMontageDeps, chatId: string | null): Promise<string | null> {
  const s = chatId ? await readMontageState(deps, chatId) : {};
  if (s.await && "jobId" in s.await) return s.await.jobId;
  const jobs = (await deps.prisma.montageJob.findMany({ where: chatId ? { chatId } : {}, orderBy: { createdAt: "desc" }, take: 5 })) as JobRow[];
  for (const j of jobs) if ((await approvedShorts(deps, j.id, null)).length) return j.id;
  return null;
}

