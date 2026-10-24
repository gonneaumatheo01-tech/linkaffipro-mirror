/**
 * Phase 27, chantier B : forme des posts (pur). Longueur en caractères visibles (médiane, 1er et 3e quartiles),
 * lignes (médiane), emojis par post (moyenne), majuscules (moyenne des parts, en %), posts avec question (%), mélange
 * des médias (%), liens et boutons (% des posts), hashtags et mentions par post (moyenne).
 */
import type { Measure, ReferenceMediaKind } from "../contract";
import { mean, median, pct, quantile, roundTo } from "./stats";
import type { AnalysisPost } from "./types";

export const MEDIA_LABELS: Record<ReferenceMediaKind, string> = {
  text: "texte seul",
  photo: "photo",
  video: "vidéo",
  poll: "sondage",
  document: "document",
  other: "autre",
};

const round0 = (v: number | null) => (v === null ? null : Math.round(v));
const round1 = (v: number | null) => (v === null ? null : roundTo(v, 1));

export function formMeasures(posts: readonly AnalysisPost[]): Measure[] {
  const n = posts.length;
  const lengths = posts.map((p) => p.length);
  const count = (f: (p: AnalysisPost) => boolean) => posts.filter(f).length;
  const out: Measure[] = [
    { key: "lengthMedian", label: "Longueur médiane", value: round0(median(lengths)), unit: "caractères", sampleSize: n },
    { key: "lengthQ1", label: "Longueur, 1er quartile", value: round0(quantile(lengths, 0.25)), unit: "caractères", sampleSize: n },
    { key: "lengthQ3", label: "Longueur, 3e quartile", value: round0(quantile(lengths, 0.75)), unit: "caractères", sampleSize: n },
    { key: "linesMedian", label: "Lignes par post (médiane)", value: round1(median(posts.map((p) => p.lines))), unit: "lignes", sampleSize: n },
    { key: "emojisPerPost", label: "Emojis par post (moyenne)", value: round1(mean(posts.map((p) => p.emojiCount))), unit: "emojis", sampleSize: n },
    { key: "capsShare", label: "Lettres en majuscules (moyenne)", value: n ? Math.round(mean(posts.map((p) => p.capsRatio))! * 100) : null, unit: "%", sampleSize: n },
    { key: "questionShare", label: "Posts avec une question", value: n ? pct(count((p) => p.questions > 0), n) : null, unit: "%", sampleSize: n },
  ];
  const kinds: ReferenceMediaKind[] = ["text", "photo", "video", "poll", "document", "other"];
  for (const k of kinds) {
    const c = count((p) => p.mediaKind === k);
    // Texte, photo, vidéo, sondage toujours affichés ; document et autre seulement s'il y en a.
    if (c === 0 && (k === "document" || k === "other")) continue;
    out.push({ key: `media.${k}`, label: `Posts ${MEDIA_LABELS[k]}`, value: n ? pct(c, n) : null, unit: "%", sampleSize: n });
  }
  out.push(
    { key: "linkShare", label: "Posts avec un lien", value: n ? pct(count((p) => p.hasLink), n) : null, unit: "%", sampleSize: n },
    { key: "buttonShare", label: "Posts avec un bouton", value: n ? pct(count((p) => p.hasButton), n) : null, unit: "%", sampleSize: n },
    { key: "hashtagsPerPost", label: "Hashtags par post (moyenne)", value: round1(mean(posts.map((p) => p.hashtags))), unit: "hashtags", sampleSize: n },
    { key: "mentionsPerPost", label: "Mentions @ par post (moyenne)", value: round1(mean(posts.map((p) => p.mentions))), unit: "mentions", sampleSize: n },
  );
  return out;
}
