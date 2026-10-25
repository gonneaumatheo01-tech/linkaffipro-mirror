/**
 * Phase 28, chantier E — messages de Kevin pendant la fabrication (sections 6 à 8 du prompt), purs sauf la rotation
 * des variantes :
 * - aperçu d'un short : légende « Short 3/12 — 15s — vertical 9:16 — 18,4 Mo » + description + boutons
 *   `msh:<clipId>:ok|edit|no` (✅ Valider | ✏️ Modifier | ❌ Refuser) ; short compressé → Kevin le dit ;
 * - doute de sous-titre : « J'ai un doute sur le sous-titre à 0:08 du short 3 : "martingale" ou "martindale" ? »,
 *   un bouton par variante + « autre » (`mst:<clipId>:<passage>:<choix>|x`) ;
 * - contrôle qualité raté : phrase simple + « Refaire » / « Laisser tomber » (`msq:<clipId>:redo|drop` ; « Me le
 *   montrer » `keep` si le short existe malgré tout) : RIEN n'est publié sans ✅ ;
 * - échec du montage : phrase simple, jamais une erreur technique brute.
 */
import { esc } from "../admin/journal";
import type { AdminButton } from "../types";
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import { SHORT_CALLBACK_PREFIX, type QcReport, type ShortFormat } from "./contract";
import { clockOf, formatLabel, sizeLabel } from "./plan-message";

/** Boutons d'un doute de sous-titre et d'un contrôle qualité raté. */
export const SUBTITLE_CALLBACK_PREFIX = "mst:";
export const QC_CALLBACK_PREFIX = "msq:";

/** Libellés des boutons (pas des phrases de Kevin). */
export const PREVIEW_BUTTONS = { ok: "✅ Valider", edit: "✏️ Modifier", no: "❌ Refuser", other: "✏️ Autre", redo: "🔁 Refaire", keep: "👀 Me le montrer", drop: "🗑 Laisser tomber" } as const;

type CaptionSample = { index: number; total: number; seconds: number; format: string; size: string; description: string };

export const PREVIEW_VARIANTS = {
  /** Légende de l'aperçu (vidéo envoyée par Kevin). */
  caption: voiceTemplate<CaptionSample>(
    [
      { index: 3, total: 12, seconds: 15, format: "vertical 9:16", size: "18,4 Mo", description: "Gros gain à la roulette" },
      { index: 1, total: 1, seconds: 12, format: "carré 1:1", size: "9,1 Mo", description: "Réaction au jackpot" },
    ],
    (p) => [`Short ${p.index}/${p.total} — ${p.seconds}s — ${p.format} — ${p.size}\n${p.description}`],
  ),
  /** Ajout à la légende d'un short compressé. */
  compressed: [
    "Je l'ai compressé pour passer sous 50 Mo. L'original reste sur la page Montage du site.",
    "Compressé pour passer sous 50 Mo, l'original est sur la page Montage du site.",
  ],
  /** Aperçu sans vidéo (envoi impossible) : mêmes boutons. */
  noVideo: voiceTemplate<{ index: number }>([{ index: 3 }], (p) => [
    `Je n'arrive pas à t'envoyer la vidéo du short ${p.index} ici. Regarde-la sur la page Montage du site, puis réponds avec les boutons.`,
    `La vidéo du short ${p.index} ne passe pas dans Telegram. Elle est sur la page Montage du site : regarde-la puis choisis ci-dessous.`,
  ]),
  /** Doute sur un sous-titre (une question à la fois). */
  subtitleDoubt: voiceTemplate<{ at: string; index: number; options: string }>(
    [
      { at: "0:08", index: 3, options: "« martingale » ou « martindale »" },
      { at: "0:12", index: 1, options: "« 200 € » ou « 2 000 € »" },
    ],
    (p) => [
      `J'ai un doute sur le sous-titre à ${p.at} du short ${p.index} : ${p.options} ? Écoute et dis-moi.`,
      `Un mot me fait douter à ${p.at} du short ${p.index} : ${p.options} ? Choisis ou écris-moi le bon.`,
    ],
  ),
  /** Doute sans proposition : le passage tel que compris. */
  subtitleDoubtOne: voiceTemplate<{ at: string; index: number; text: string }>([{ at: "0:08", index: 3, text: "« la martingale ça marche »" }], (p) => [
    `J'ai un doute sur le sous-titre à ${p.at} du short ${p.index} : j'ai compris ${p.text}. C'est bon, ou tu me l'écris ?`,
    `Pas sûr du sous-titre à ${p.at} du short ${p.index} : j'entends ${p.text}. Je garde, ou tu me donnes le bon texte ?`,
  ]),
  /** Contrôle qualité raté. */
  qcFailed: voiceTemplate<{ index: number; problems: string }>(
    [
      { index: 4, problems: "3,2 s de noir au début" },
      { index: 2, problems: "il dure 19 s au lieu de 15 s, et le son est coupé" },
    ],
    (p) => [
      `Le short ${p.index} ne passe pas mon contrôle : ${p.problems}. Je le refais, ou on laisse tomber celui-là ?`,
      `Souci sur le short ${p.index} : ${p.problems}. Je le refais, ou on le laisse de côté ?`,
    ],
  ),
  /** Échec de tout le montage. */
  failed: voiceTemplate<{ reason: string }>([{ reason: "la vidéo est illisible" }, { reason: "le serveur a calé trois fois de suite" }], (p) => [
    `Le montage n'a pas pu aller au bout : ${p.reason}. Tu me renvoies la vidéo ?`,
    `Je n'ai pas réussi ce montage : ${p.reason}. Renvoie-moi la vidéo et je réessaie.`,
  ]),
  /** Échec d'un seul short. */
  failedClip: voiceTemplate<{ index: number; reason: string }>([{ index: 5, reason: "le serveur a calé trois fois de suite" }], (p) => [
    `Le short ${p.index} n'a pas pu être fait : ${p.reason}. Les autres continuent.`,
    `Je laisse tomber le short ${p.index} : ${p.reason}. Je continue avec les autres.`,
  ]),
  /** Raison générique (erreur technique jamais montrée). */
  genericReason: ["un souci technique de mon côté", "un problème technique chez moi"],
} satisfies VoiceTable;

/** Boutons d'un aperçu : ✅ Valider | ✏️ Modifier | ❌ Refuser. */
export function previewButtons(clipId: string): AdminButton[][] {
  return [
    [
      { text: PREVIEW_BUTTONS.ok, callbackData: `${SHORT_CALLBACK_PREFIX}${clipId}:ok` },
      { text: PREVIEW_BUTTONS.edit, callbackData: `${SHORT_CALLBACK_PREFIX}${clipId}:edit` },
      { text: PREVIEW_BUTTONS.no, callbackData: `${SHORT_CALLBACK_PREFIX}${clipId}:no` },
    ],
  ];
}

export type PreviewInfo = {
  index: number;
  total: number;
  durationMs: number;
  format: ShortFormat | string;
  sizeBytes: number;
  description: string | null;
  compressed: boolean;
};

/** Légende de l'aperçu (HTML échappé ; 1 024 caractères au plus, la limite d'une légende Telegram). */
export function previewCaption(p: PreviewInfo, chatId?: string | bigint | null): string {
  const description = esc((p.description ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "Moment retenu");
  const base = pick(
    PREVIEW_VARIANTS.caption({ index: p.index, total: p.total, seconds: Math.round(p.durationMs / 1000), format: formatLabel(p.format), size: sizeLabel(p.sizeBytes), description }),
    "montage.preview.caption",
    chatId ?? null,
  );
  const text = p.compressed ? `${base}\n${pick(PREVIEW_VARIANTS.compressed, "montage.preview.compressed", chatId ?? null)}` : base;
  return text.slice(0, 1024);
}

/** Boutons d'un doute : une variante par bouton (4 au plus) + « Autre » (texte libre). */
export function subtitleDoubtButtons(clipId: string, passage: number, alternatives: readonly string[]): AdminButton[][] {
  const rows: AdminButton[][] = alternatives.slice(0, 4).map((a, i) => [{ text: a.length > 40 ? `${a.slice(0, 39)}…` : a, callbackData: `${SUBTITLE_CALLBACK_PREFIX}${clipId}:${passage}:${i}` }]);
  rows.push([{ text: PREVIEW_BUTTONS.other, callbackData: `${SUBTITLE_CALLBACK_PREFIX}${clipId}:${passage}:x` }]);
  return rows;
}

/** Question sur un passage incertain (pur sauf la rotation). */
export function subtitleDoubtText(u: { atMs: number; text: string; alternatives: readonly string[] }, clipIndex: number, chatId?: string | bigint | null): string {
  const at = clockOf(u.atMs);
  const alts = u.alternatives.filter((a) => a.trim()).slice(0, 4);
  if (alts.length >= 2) {
    const quoted = alts.map((a) => `« ${esc(a)} »`);
    const options = `${quoted.slice(0, -1).join(", ")} ou ${quoted[quoted.length - 1]}`;
    return pick(PREVIEW_VARIANTS.subtitleDoubt({ at, index: clipIndex, options }), "montage.preview.doubt", chatId ?? null);
  }
  return pick(PREVIEW_VARIANTS.subtitleDoubtOne({ at, index: clipIndex, text: `« ${esc(alts[0] ?? u.text)} »` }), "montage.preview.doubt.one", chatId ?? null);
}

/** Variantes proposées pour un passage : celles de la vérification, sinon le texte compris (pur). */
export function doubtOptions(u: { text: string; alternatives: readonly string[] }): string[] {
  const out: string[] = [];
  for (const a of [...u.alternatives, u.text]) {
    const t = a.replace(/\s+/g, " ").trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 4);
}

/** « Refaire » et, si le short existe, « Me le montrer » (sinon « Laisser tomber ») : jamais publié sans ✅. */
export function qcButtons(clipId: string, canShow = false): AdminButton[][] {
  return [
    [
      { text: PREVIEW_BUTTONS.redo, callbackData: `${QC_CALLBACK_PREFIX}${clipId}:redo` },
      canShow
        ? { text: PREVIEW_BUTTONS.keep, callbackData: `${QC_CALLBACK_PREFIX}${clipId}:keep` }
        : { text: PREVIEW_BUTTONS.drop, callbackData: `${QC_CALLBACK_PREFIX}${clipId}:drop` },
    ],
  ];
}

/** Problèmes du contrôle en une phrase (« 3,2 s de noir au début, et le son est coupé ») (pur). */
export function qcProblemsText(report: Pick<QcReport, "problems">): string {
  const list = report.problems.map((p) => p.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim()).filter(Boolean).slice(0, 3);
  if (!list.length) return "il ne ressemble pas à ce qui était prévu";
  const lower = list.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toLowerCase() + p.slice(1)));
  return lower.length === 1 ? lower[0]! : `${lower.slice(0, -1).join(", ")}, et ${lower[lower.length - 1]}`;
}

export function qcFailedText(clipIndex: number, report: Pick<QcReport, "problems">, chatId?: string | bigint | null): string {
  return pick(PREVIEW_VARIANTS.qcFailed({ index: clipIndex, problems: esc(qcProblemsText(report)) }), "montage.preview.qc", chatId ?? null);
}

/**
 * Raison d'un échec en français simple (pur) : les raisons déjà écrites pour le client (refus de la chaîne :
 * « la vidéo est illisible ») passent ; une erreur technique (pile, code, nom de fichier, mot anglais) devient
 * « un souci technique de mon côté ».
 */
export function friendlyReason(reason: string | null | undefined, chatId?: string | bigint | null): string {
  const r = (reason ?? "").replace(/\s+/g, " ").trim();
  const technical =
    !r ||
    r.length > 160 ||
    /(?:error|errno|enoent|eacces|exception|timeout|timed out|ffmpeg|ffprobe|stack|undefined|null|prisma|redis|bullmq|sigkill|oom|\bat\s+\S+\.\w+:\d+|[\\/][\w.-]+[\\/]|\{|\}|=>)/i.test(r);
  if (technical) return pick(PREVIEW_VARIANTS.genericReason, "montage.preview.generic", chatId ?? null);
  const clean = r.replace(/[.\s]+$/, "");
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}

export function failedText(reason: string | null | undefined, chatId?: string | bigint | null, clipIndex?: number | null): string {
  const why = esc(friendlyReason(reason, chatId));
  if (typeof clipIndex === "number") return pick(PREVIEW_VARIANTS.failedClip({ index: clipIndex, reason: why }), "montage.preview.failed.clip", chatId ?? null);
  return pick(PREVIEW_VARIANTS.failed({ reason: why }), "montage.preview.failed", chatId ?? null);
}
