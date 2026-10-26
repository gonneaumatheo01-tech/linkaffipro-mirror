/**
 * Phase 27, chantier C — propositions tirées d'un canal d'inspiration pour un canal du client (règle 5). Chaque
 * proposition est une `Recommendation` (`source = inspiration`, `referenceChannelId`, `target = CHANNEL_PLAN`), avec
 * pour preuves les chiffres du canal de référence ET ceux du canal du client ; rien n'est appliqué ici. Toujours dans les
 * BORNES de l'équipe Algorithme (fonctions de `agents/synthese` et `algo/*`, revérifiées à l'application) :
 * - fenêtre horaire autour de leurs heures de pointe, dans les heures autorisées du canal (`windowAround`) ;
 * - posts par jour vers leur rythme, 2 de plus ou de moins au plus, jamais au-dessus du maximum fixé ;
 * - mélange : 20 points par semaine au plus (deux pas de 10, la borne par proposition), le reste la semaine suivante ;
 * - longueur cible et fréquence des appels à l'offre : consignes « ce qui marche ici » du canal (`styleNotes`) ;
 * - profil de style pour la Rédaction (`styleProfileId`) ;
 * - série pari → résultat : l'équipe Paris sportifs range les résultats et fait le bilan mais ne publie pas de post de
 *   résultat → « je ne sais pas encore faire ça » (`recordBossUnmet`).
 * 3 à 6 propositions numérotées au plus.
 */
import { esc, nowOf } from "../admin/journal";
import { allowedHoursFor, loadAlgoTeam } from "../algo/settings";
import { effectiveMix, MAX_MIX_POINTS_PER_PROPOSAL } from "../algo/mix";
import { parisWeekStart, weekStartDate } from "../algo/week";
import { mixShares, mixShiftPoints } from "../agents/synthese/bounds";
import { windowAround } from "../agents/synthese/proposals";
import { shiftMix, type Mix } from "../agents/experimentation/variants";
import { recordBossUnmet } from "../boss/unmet";
import { hhmmToMinutes } from "../rules/time";
import type { AgentsDeps } from "../types";
import { INSPIRATION_LIMITS, type ChannelComparison, type InspirationAnalysis, type InspirationGap } from "./contract";
import { fr, mediaShares, numberOf } from "./kevin";
import { analyzeReference, compareWithChannel } from "./kevin-ports";
import { loadReferenceRow, referenceLabel } from "./kevin-refs";
import { checkRecommendations, type RecLike } from "../qa-gates/recommendations";

export const INSPIRATION_SOURCE = "inspiration";
export const MAX_PROPOSALS = 6;
/** Pas maximal du quota proposé (posts par jour, en plus ou en moins). */
export const MAX_QUOTA_STEP = 2;
/** Écart minimal (points) d'un format avant de proposer de bouger le mélange. */
export const MIN_MIX_GAP_POINTS = 10;
/** Écart relatif minimal de longueur médiane avant de proposer une longueur cible. */
export const MIN_LENGTH_GAP = 0.3;
/** Écart minimal (points) d'appels à l'offre avant de proposer une fréquence. */
export const MIN_OFFER_GAP_POINTS = 15;
/** L'équipe Paris sportifs ne publie pas encore de post « résultat » après un pari (règle de la phase 23). */
export const SPORTS_RESULT_POSTS_SUPPORTED = false;
/** Repères des lignes ajoutées aux consignes du canal (remplacées, jamais doublées). */
export const STYLE_NOTE_TAGS = { length: "[Inspiration · longueur]", offer: "[Inspiration · offre]" } as const;

type PlanRow = { channelId: string; teamKey: string; mix: unknown; windowStart: string; windowEnd: string; postsPerDay: number; minSpacingMinutes: number; styleNotes: string | null; styleProfileId?: string | null };

export type ProposalKind = "window" | "postsPerDay" | "mix" | "length" | "offer" | "style";

/** Une proposition numérotée (peut porter deux recommandations : le mélange en deux pas de 10 points). */
export type InspirationProposal = {
  number: number;
  kind: ProposalKind;
  label: string;
  /** Preuve : leurs chiffres et les nôtres. */
  proof: string;
  /** Ce que ça change. */
  change: string;
  recommendationIds: string[];
};

export type ProposalsResult =
  | { ok: true; referenceChannelId: string; channelId: string; channelTitle: string; proposals: InspirationProposal[]; notes: string[] }
  | { ok: false; message: string };

/** Ligne de consigne marquée remplacée dans les consignes du canal (pur). */
export function mergeTaggedLine(current: string | null, tag: string, line: string | null): string | null {
  const kept = (current ?? "")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith(tag));
  const next = line ? [...kept, `${tag} ${line}`] : kept;
  const text = next.join("\n").slice(0, 600).trim();
  return text || null;
}

/**
 * Fenêtre proposée (pur) : couvre leurs heures de pointe (de la première à la dernière tranche, + 30 min), assez large
 * pour le quota et l'espacement du plan, ramenée dans les heures autorisées.
 */
export function proposedWindow(
  peakSlots: readonly string[],
  plan: Pick<PlanRow, "postsPerDay" | "minSpacingMinutes">,
  allowed: { start: string; end: string },
): { windowStart: string; windowEnd: string } | null {
  const mins = peakSlots.map((s) => hhmmToMinutes(s)).filter((m): m is number => m !== null);
  if (!mins.length) return null;
  const lo = Math.floor(Math.min(...mins) / 60);
  const hi = Math.ceil((Math.max(...mins) + 30) / 60);
  const need = Math.ceil((plan.postsPerDay * plan.minSpacingMinutes) / 60) + 1;
  const len = Math.max(need, hi - lo, 2);
  const center = (lo + hi) / 2 - 0.5;
  return windowAround(center, len, allowed);
}

/** Parts (%) de leurs médias ramenées aux trois formats du mélange (sondages et documents comptés en texte) (pur). */
export function theirMixShares(a: InspirationAnalysis): Mix {
  const s = { video: 0, photo: 0, text: 0 };
  for (const m of mediaShares(a)) {
    if (m.kind === "video") s.video += m.share;
    else if (m.kind === "photo") s.photo += m.share;
    else s.text += m.share;
  }
  const t = s.video + s.photo + s.text || 1;
  return { video: (s.video / t) * 100, photo: (s.photo / t) * 100, text: (s.text / t) * 100 };
}

/**
 * Pas du mélange pour une semaine (pur) : vers le format le plus en retard chez nous ; au plus `weeklyRoom` points cette
 * semaine, en pas de 10 points (borne par proposition). Rend les mélanges successifs et le reste pour la semaine
 * suivante, ou null sans écart net.
 */
export function mixSteps(
  current: Mix,
  theirs: Mix,
  weeklyRoom: number,
  step = MAX_MIX_POINTS_PER_PROPOSAL,
): { toward: keyof Mix; gap: number; points: number; steps: Mix[]; remaining: number } | null {
  const ours = mixShares(current);
  const keys: (keyof Mix)[] = ["video", "photo", "text"];
  const best = keys.map((k) => ({ k, gap: theirs[k] - ours[k] })).sort((a, b) => b.gap - a.gap)[0]!;
  if (best.gap < MIN_MIX_GAP_POINTS) return null;
  const points = Math.max(0, Math.min(best.gap, weeklyRoom));
  if (points < 1) return null;
  const steps: Mix[] = [];
  let mix = current;
  let left = points;
  while (left > 0.5) {
    const d = Math.min(step, left);
    mix = shiftMix(mix, best.k, d);
    steps.push(mix);
    left -= d;
  }
  return { toward: best.k, gap: Math.round(best.gap), points: Math.round(points), steps, remaining: Math.max(0, Math.round(best.gap - points)) };
}

function gapOf(c: ChannelComparison | null, key: string): InspirationGap | undefined {
  return c?.gaps.find((g) => g.key === key);
}

function numOf(g: InspirationGap | undefined, side: "theirs" | "ours"): number | null {
  const v = g?.[side];
  return typeof v === "number" ? v : null;
}

const MIX_WORDS: Record<keyof Mix, string> = { video: "vidéos", photo: "photos", text: "textes" };
const pts = (m: Mix) => {
  const s = mixShares(m);
  return `vidéo ${fr(Math.round(s.video))} %, photo ${fr(Math.round(s.photo))} %, texte ${fr(Math.round(s.text))} %`;
};

/** Mélange du début de semaine (avant les mélanges appliqués cette semaine), comme la borne de l'équipe Algorithme. */
async function weekBase(deps: AgentsDeps, plan: PlanRow): Promise<Mix> {
  const first = (await deps.prisma.recommendation.findFirst({
    where: { target: "CHANNEL_PLAN", targetId: plan.channelId, field: "mix", status: "APPLIED", appliedAt: { gte: weekStartDate(nowOf(deps)) } },
    orderBy: { appliedAt: "asc" },
  })) as { before: unknown } | null;
  return effectiveMix(plan.teamKey, first ? first.before : plan.mix);
}

type Draft = { kind: ProposalKind; label: string; proof: string; change: string; recs: { field: string; before: unknown; after: unknown; evidence: Record<string, unknown>; size: "SMALL" | "BIG"; expectedGain: string }[] };

/** Propositions (brouillons, pur hors lecture de la base) d'une référence pour un canal. */
async function drafts(deps: AgentsDeps, refLabel: string, a: InspirationAnalysis, c: ChannelComparison | null, plan: PlanRow, styleProfileId: string | null): Promise<{ drafts: Draft[]; notes: string[] }> {
  const { settings } = await loadAlgoTeam(deps.prisma);
  const out: Draft[] = [];
  const notes: string[] = [];
  const ourSample = c?.ourSampleSize ?? 0;
  const base = { refSample: a.sampleSize, ourSample };

  // Fenêtre horaire.
  const win = proposedWindow(a.peakSlots, plan, allowedHoursFor(settings, plan.channelId));
  if (win && (win.windowStart !== plan.windowStart || win.windowEnd !== plan.windowEnd)) {
    const share = numberOf(a, "peakShare");
    const ours = gapOf(c, "peakSlots")?.ours;
    out.push({
      kind: "window",
      label: `Fenêtre horaire ${win.windowStart}-${win.windowEnd} (au lieu de ${plan.windowStart}-${plan.windowEnd})`,
      proof: `eux : pointe à ${a.peakSlots.join(", ")}${share !== null ? ` (${fr(share)} % de leurs posts)` : ""} ; nous : ${typeof ours === "string" && ours ? `pointe à ${ours}` : `fenêtre ${plan.windowStart}-${plan.windowEnd}`}`,
      change: `les posts partent entre ${win.windowStart} et ${win.windowEnd}`,
      recs: [
        {
          field: "window",
          before: { windowStart: plan.windowStart, windowEnd: plan.windowEnd },
          after: win,
          evidence: { ...base, theirs: { peakSlots: a.peakSlots, peakShare: share }, ours: { window: `${plan.windowStart}-${plan.windowEnd}`, peakSlots: ours ?? null } },
          size: "SMALL",
          expectedGain: `Publier aux heures où @ref publie le plus (${a.peakSlots.join(", ")}).`.replace("@ref", refLabel),
        },
      ],
    });
  }

  // Posts par jour.
  const theirsPerDay = numberOf(a, "postsPerDay");
  if (theirsPerDay !== null) {
    const target = Math.max(1, Math.min(settings.maxPostsPerDay, Math.round(theirsPerDay)));
    const next = Math.max(plan.postsPerDay - MAX_QUOTA_STEP, Math.min(plan.postsPerDay + MAX_QUOTA_STEP, target));
    const measured = numOf(gapOf(c, "postsPerDay"), "ours");
    const rel = Math.abs(theirsPerDay - plan.postsPerDay) / Math.max(theirsPerDay, plan.postsPerDay, 1);
    if (next !== plan.postsPerDay && rel >= 0.3)
      out.push({
        kind: "postsPerDay",
        label: `${next} posts par jour (au lieu de ${plan.postsPerDay})`,
        proof: `eux : ${fr(theirsPerDay)} posts par jour ; nous : ${plan.postsPerDay} prévus${measured !== null ? `, ${fr(measured)} publiés par jour sur 28 jours` : ""}`,
        change: `${next} posts par jour sur ce canal${target !== next ? ` (pas de ${MAX_QUOTA_STEP} au plus : je reproposerai la suite)` : ""}`,
        recs: [
          {
            field: "postsPerDay",
            before: plan.postsPerDay,
            after: next,
            evidence: { ...base, theirs: { postsPerDay: theirsPerDay }, ours: { planned: plan.postsPerDay, measured } },
            size: "BIG",
            expectedGain: `Se rapprocher du rythme de ${refLabel} (${fr(theirsPerDay)} posts par jour).`,
          },
        ],
      });
  }

  // Mélange : 20 points par semaine au plus.
  const current = effectiveMix(plan.teamKey, plan.mix);
  const weekly = Math.min(settings.maxMixShiftPoints, INSPIRATION_LIMITS.maxMixShiftPerWeek);
  const used = mixShiftPoints(await weekBase(deps, plan), current);
  const steps = mixSteps(current, theirMixShares(a), Math.max(0, weekly - used));
  if (steps) {
    const final = steps.steps.at(-1)!;
    const theirs = theirMixShares(a);
    out.push({
      kind: "mix",
      label: `Plus de ${MIX_WORDS[steps.toward]} : +${steps.points} points cette semaine`,
      proof: `eux : ${pts(theirs)} ; nous : ${pts(current)}`,
      change: `mélange ${pts(final)}${steps.remaining > 0 ? ` (les ${steps.remaining} points restants la semaine prochaine : 20 au plus par semaine)` : ""}`,
      recs: steps.steps.map((m, i) => ({
        field: "mix",
        before: i === 0 ? current : steps.steps[i - 1],
        after: m,
        evidence: { ...base, theirs: { mix: theirs }, ours: { mix: mixShares(current) }, toward: steps.toward, gapPoints: steps.gap, weekPoints: steps.points, remainingPoints: steps.remaining, step: i + 1, steps: steps.steps.length },
        size: "SMALL" as const,
        expectedGain: `Mélange plus proche de ${refLabel}.`,
      })),
    });
  }

  // Longueur cible.
  const len = numberOf(a, "lengthMedian");
  const q1 = numberOf(a, "lengthQ1");
  const q3 = numberOf(a, "lengthQ3");
  const ourLen = numOf(gapOf(c, "lengthMedian"), "ours");
  if (len !== null && ourLen !== null && Math.abs(len - ourLen) / Math.max(len, ourLen, 1) >= MIN_LENGTH_GAP) {
    const line = `Longueur visée : ${q1 !== null && q3 !== null ? `${fr(q1)} à ${fr(q3)}` : `environ ${fr(len)}`} caractères.`;
    out.push({
      kind: "length",
      label: `Textes de ${q1 !== null && q3 !== null ? `${fr(q1)} à ${fr(q3)}` : `${fr(len)}`} caractères`,
      proof: `eux : ${fr(len)} caractères en médiane ; nous : ${fr(ourLen)}`,
      change: "la Rédaction vise cette longueur",
      recs: [{ field: "styleNotes", before: plan.styleNotes, after: mergeTaggedLine(plan.styleNotes, STYLE_NOTE_TAGS.length, line), evidence: { ...base, theirs: { lengthMedian: len, lengthQ1: q1, lengthQ3: q3 }, ours: { lengthMedian: ourLen }, tag: STYLE_NOTE_TAGS.length, line }, size: "SMALL", expectedGain: line }],
    });
  }

  // Fréquence des appels à l'offre.
  const offerKey = numberOf(a, "vipCallShare") !== null ? "vipCallShare" : "buttonShare";
  const theirOffer = numberOf(a, offerKey);
  const ourOffer = numOf(gapOf(c, offerKey), "ours");
  if (theirOffer !== null && theirOffer > 0 && ourOffer !== null && Math.abs(theirOffer - ourOffer) >= MIN_OFFER_GAP_POINTS) {
    const every = Math.max(1, Math.round(100 / theirOffer));
    const line = `Appel à l'offre : environ 1 post sur ${every}.`;
    out.push({
      kind: "offer",
      label: `Appel à l'offre dans 1 post sur ${every}`,
      proof: `eux : ${fr(theirOffer)} % de leurs posts ; nous : ${fr(ourOffer)} %`,
      change: "la Rédaction place l'appel à l'offre à ce rythme",
      recs: [{ field: "styleNotes", before: plan.styleNotes, after: mergeTaggedLine(plan.styleNotes, STYLE_NOTE_TAGS.offer, line), evidence: { ...base, theirs: { [offerKey]: theirOffer }, ours: { [offerKey]: ourOffer }, every, tag: STYLE_NOTE_TAGS.offer, line }, size: "SMALL", expectedGain: line }],
    });
  }

  // Profil de style pour la Rédaction.
  if (styleProfileId && plan.styleProfileId !== styleProfileId)
    out.push({
      kind: "style",
      label: `Écrire à la façon de ${refLabel} (profil de style)`,
      proof: `profil tiré de ${a.sampleSize} posts lus ; règles et exemples écrits à neuf, jamais copiés`,
      change: "la Rédaction reçoit ce profil comme consigne pour ce canal",
      recs: [{ field: "styleProfileId", before: plan.styleProfileId ?? null, after: styleProfileId, evidence: { ...base, styleProfileId }, size: "SMALL", expectedGain: `Ton et structure inspirés de ${refLabel}, sans copie.` }],
    });

  // Série pari → résultat.
  const series = numberOf(a, "betSeries");
  if (a.universe === "sports" && series !== null && series > 0 && !SPORTS_RESULT_POSTS_SUPPORTED) {
    notes.push(`Série pari → résultat (${fr(series)} chez eux) : je ne sais pas encore faire ça, c'est noté.`);
    await recordBossUnmet(deps, "série pari → résultat (post de résultat après un pari, vu sur un canal d'inspiration)");
  }
  if (a.flagged.length) notes.push(`Je ne reprends pas : ${a.flagged[0]!.slice(0, 120)}${a.flagged.length > 1 ? ` (et ${a.flagged.length - 1} autre${a.flagged.length > 2 ? "s" : ""})` : ""}.`);
  return { drafts: out.slice(0, MAX_PROPOSALS), notes };
}

/**
 * Propositions d'une référence pour un canal du client : recommandations écrites (les anciennes encore proposées pour
 * ce couple sont closes), numérotées. Rien n'est appliqué.
 */
export async function inspirationProposals(deps: AgentsDeps, referenceChannelId: string, channelId: string): Promise<ProposalsResult> {
  const ref = await loadReferenceRow(deps, referenceChannelId);
  if (!ref) return { ok: false, message: "Je ne trouve plus ce canal d'inspiration." };
  const channel = (await deps.prisma.channel.findUnique({ where: { id: channelId } })) as { id: string; title: string } | null;
  if (!channel) return { ok: false, message: "Je ne trouve pas ce canal." };
  const plan = (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId } })) as PlanRow | null;
  if (!plan) return { ok: false, message: `${channel.title} n'a pas encore de plan d'agents : je n'ai aucun réglage à proposer.` };
  const analysis = await analyzeReference(deps, ref.id);
  if ("tooFew" in analysis)
    return { ok: false, message: `J'ai ${analysis.count} posts de ${referenceLabel(ref)}, il m'en faut ${INSPIRATION_LIMITS.minPostsForAnalysis} pour proposer quelque chose.` };
  const comparison = await compareWithChannel(deps, analysis, channelId).catch(() => null);
  const profile = (await deps.prisma.styleProfile.findFirst({ where: { referenceChannelId: ref.id }, orderBy: { version: "desc" } })) as { id: string } | null;
  const { drafts: list, notes } = await drafts(deps, referenceLabel(ref), analysis, comparison, plan, profile?.id ?? null);

  // Les anciennes propositions de cette référence pour ce canal, jamais appliquées : remplacées.
  await deps.prisma.recommendation.updateMany({
    where: { source: INSPIRATION_SOURCE, referenceChannelId: ref.id, targetId: channelId, status: "PROPOSED" },
    data: { status: "REJECTED", rejectedAt: nowOf(deps) },
  });
  const weekStart = parisWeekStart(nowOf(deps));
  const proposals: InspirationProposal[] = [];
  for (const [i, d] of list.entries()) {
    const ids: string[] = [];
    for (const r of d.recs) {
      const row = await deps.prisma.recommendation.create({
        data: {
          teamKey: plan.teamKey,
          target: "CHANNEL_PLAN",
          targetId: channelId,
          field: r.field,
          before: r.before === null || r.before === undefined ? undefined : JSON.parse(JSON.stringify(r.before)),
          after: JSON.parse(JSON.stringify(r.after ?? null)),
          evidence: JSON.parse(JSON.stringify({ agent: "inspiration", kind: d.kind, number: i + 1, referenceChannelId: ref.id, ...r.evidence })),
          expectedGain: r.expectedGain.slice(0, 300),
          size: r.size,
          status: "PROPOSED",
          weekStart,
          source: INSPIRATION_SOURCE,
          referenceChannelId: ref.id,
        },
      });
      ids.push(row.id);
    }
    proposals.push({ number: i + 1, kind: d.kind, label: d.label, proof: d.proof, change: d.change, recommendationIds: ids });
  }
  // Phase 30 : vérifiées par le QA Global avant d'être montrées ; seules les propositions approuvées sont listées.
  const created = (await deps.prisma.recommendation.findMany({ where: { id: { in: proposals.flatMap((p) => p.recommendationIds) } } })) as RecLike[];
  const qa = await checkRecommendations(deps, created, 20);
  const okIds = new Set(qa.approved.map((r) => r.id));
  const shown = proposals.filter((p) => p.recommendationIds.every((id) => okIds.has(id)));
  const inReview = proposals.filter((p) => !shown.includes(p) && !p.recommendationIds.some((id) => qa.rejected.includes(id))).length;
  const refused = proposals.length - shown.length - inReview;
  if (inReview) notes.push(`${inReview} proposition${inReview > 1 ? "s" : ""} encore en vérification par le contrôle qualité.`);
  if (refused) notes.push(`${refused} proposition${refused > 1 ? "s" : ""} écartée${refused > 1 ? "s" : ""} par le contrôle qualité.`);
  return { ok: true, referenceChannelId: ref.id, channelId, channelTitle: channel.title, proposals: shown, notes };
}

/** Texte des propositions numérotées, prêt pour Kevin (HTML échappé). */
export function proposalsText(refLabel: string, r: Extract<ProposalsResult, { ok: true }>): string {
  if (!r.proposals.length)
    return [`Rien à changer sur ${esc(r.channelTitle)} d'après ${esc(refLabel)} : ses réglages sont déjà proches.`, ...r.notes.map(esc)].join("\n");
  return [
    `💡 Mes propositions pour ${esc(r.channelTitle)}, d'après ${esc(refLabel)} :`,
    ...r.proposals.map((p) => `${p.number}. ${esc(p.label)}\n   preuve : ${esc(p.proof)}\n   ça change : ${esc(p.change)}`),
    ...r.notes.map(esc),
    "Réponds avec les numéros à appliquer (par exemple « 1 3 », ou « tout ») ; rien ne change sans ta réponse.",
  ].join("\n");
}
