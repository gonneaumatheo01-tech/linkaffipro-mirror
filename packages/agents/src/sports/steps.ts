/**
 * Étapes de la chaîne Paris (phase 23), appelées par les agents partagés quand la mission est de l'équipe sports :
 * - Rédaction : image (capture de l'agent Capture, capture directe ou repli) + texte écrit par le code ;
 * - Contrôle : règles de contenu (mots interdits du pari), coup d'envoi, cote RE-VÉRIFIÉE chez le fournisseur
 *   (écart toléré de la catégorie), doublon 48 h, image présente ; validations imposées puis niveau d'autonomie ;
 * - Publication : immédiate (`scheduledAt` = maintenant), simulation → canal Test, jamais à moins de N minutes du coup
 *   d'envoi ; cote relue si la validation a pris du temps.
 * Mission sans pari (`noPick`) : étapes sautées.
 */
import { createAgentPost, type PrismaClient } from "@linkaffipro/db";
import { TELEGRAM_CAPTION_MAX } from "@linkaffipro/core";
import { checkContent } from "../rules/content";
import { checkOddsDrift, findSelection, isDuplicatePick, kickoffCheck, oddsInRange } from "../rules/bets";
import { autonomyDecision, sportsAlwaysValidateReason } from "../orchestrator/autonomy";
import { freshMarkets } from "../providers/odds-batch";
import { OddsQuotaError } from "../providers/odds-quota";
import { resolveOddsProvider } from "../providers/odds-registry";
import { findTestChannel, loadChannel } from "../agents/data";
import { simulationHeader } from "../agents/publication/header";
import type { AgentContext, AgentResult, Mission } from "../types";
import { loadCategory, loadMissionPick, noveltyOf, recentPickKeys, type BetCategoryInfo, type PickRow } from "./data";
import { betPostText } from "./format";
import { ensurePickImage } from "./pick-image";
import { parseSportsSettings, withTeamBounds, type SportsSettings } from "./settings";
import { skipPick } from "./skip";
import type { PickReasoning } from "../agents/cotes/select";

type Loaded = { pick: PickRow; category: BetCategoryInfo; s: SportsSettings };

async function load(mission: Mission, ctx: AgentContext): Promise<Loaded | AgentResult> {
  if (mission.payload.noPick === true) return { ok: true, skipped: true, summary: "aucun pari retenu" };
  const pick = await loadMissionPick(ctx.prisma, mission);
  if (!pick) return { ok: false, error: "Pari de la mission introuvable.", retryable: false };
  const category = await loadCategory(ctx.prisma, pick.categoryId);
  if (!category) return { ok: false, error: "Catégorie du pari introuvable.", retryable: false };
  const s = parseSportsSettings(ctx.settings.settings);
  return { pick, category: withTeamBounds(category, s), s };
}

const isResult = (x: Loaded | AgentResult): x is AgentResult => "ok" in x;

export async function sportsRedaction(mission: Mission, ctx: AgentContext): Promise<AgentResult> {
  const l = await load(mission, ctx);
  if (isResult(l)) return l;
  const { pick, category, s } = l;
  const image = await ensurePickImage(ctx, mission, pick);
  // Le site bloque le serveur (agent Capture) : parade demandée au client, une seule fois.
  if ((mission.payload.capture as { blocked?: unknown } | undefined)?.blocked === true) await askWorkaroundOnce(ctx);
  // Cote lue sur le site du bookmaker au moment de la capture : écartée si elle a bougé.
  if (image.kind === "screenshot" && image.readOdds !== null) {
    const check = checkOddsDrift(pick.odds, image.readOdds, category.maxOddsDriftPct);
    if (!check.ok) return skipPick(ctx, mission, pick, `sur le site : ${check.reason}`, { code: check.code, oddsAtSend: image.readOdds });
  }
  const text = betPostText({ ...pick, reasoning: pick.reasoning as Partial<PickReasoning>, disclaimer: s.disclaimer });
  return {
    ok: true,
    output: { text, format: "photo", mediaAssetId: image.assetId, screenshotAssetId: image.assetId, fallbackImage: image.kind === "fallback", ...(image.kind === "fallback" ? { captureError: image.reason } : {}) },
    summary: `${pick.homeTeam} – ${pick.awayTeam}, ${pick.selectionLabel} à ${pick.odds}${image.kind === "fallback" ? ", image de repli" : ", capture jointe"}`,
  };
}

/** Cote actuelle chez le bookmaker du pari (relue sans cache). */
async function currentOdds(mission: Mission, ctx: AgentContext, pick: PickRow, s: SportsSettings): Promise<{ odds: number | null } | { error: string }> {
  const source = (pick.reasoning as { source?: string } | null)?.source === "fake" || mission.payload.oddsSource === "fake" ? "fake" : "live";
  const resolved = await resolveOddsProvider(ctx, { source, maxCalls: s.maxApiCallsPerMonth, fakeShiftMs: (pick.reasoning as { fakeShiftMs?: number } | null)?.fakeShiftMs ?? null });
  if (!resolved) return { error: "aucune clé de cotes pour re-vérifier la cote" };
  try {
    const list = await freshMarkets(resolved.provider, pick.eventId, [pick.marketId]);
    return { odds: findSelection(list, pick.marketId, pick.line)?.byBookmaker[pick.bookmaker] ?? null };
  } catch (err) {
    if (err instanceof OddsQuotaError) return { error: err.message };
    throw err;
  }
}

export async function sportsControl(mission: Mission, ctx: AgentContext): Promise<AgentResult> {
  const l = await load(mission, ctx);
  if (isResult(l)) return l;
  const { pick, category, s } = l;
  const p = mission.payload;
  const now = ctx.now();
  const ko = kickoffCheck(pick.kickoffAt, now, category.minMinutesBeforeKickoff);
  if (!ko.ok) return skipPick(ctx, mission, pick, ko.reason);
  if (isDuplicatePick(pick, await recentPickKeys(ctx.prisma, now, pick.id), now)) return skipPick(ctx, mission, pick, "pari identique publié dans les 48 h");
  const cur = await currentOdds(mission, ctx, pick, s);
  if ("error" in cur) return { ok: false, error: cur.error, retryable: false };
  const drift = checkOddsDrift(pick.odds, cur.odds, category.maxOddsDriftPct);
  if (!drift.ok) return skipPick(ctx, mission, pick, drift.reason, { code: drift.code, oddsAtSend: drift.current });
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { oddsAtSend: drift.current } });

  const problems = checkContent(p.text ?? "", {
    maxLength: Math.min(ctx.settings.maxTextLength, TELEGRAM_CAPTION_MAX),
    forbiddenWords: [...new Set([...ctx.settings.forbiddenWords, ...s.forbiddenWords])],
  }).problems.map((x) => x.message);
  const asset = p.mediaAssetId ? await ctx.prisma.mediaAsset.findUnique({ where: { id: p.mediaAssetId }, select: { id: true, origin: true } }) : null;
  if (!asset) problems.push("image du pari absente");
  // Texte écrit par le code : une règle non respectée ne se « refait » pas, elle part en validation (texte corrigé).
  const novelty = mission.isTest ? { newLeague: false, newMarket: false } : await noveltyOf(ctx.prisma, pick);
  const always = sportsAlwaysValidateReason({
    ...novelty,
    league: pick.league,
    market: pick.marketLabel,
    oddsOutOfRange: !oddsInRange(drift.current, category),
    fallbackImage: !asset || asset.origin === "TEMPLATE",
    fallbackReason: typeof p.captureError === "string" ? p.captureError : null,
  });
  const checked = { controlCheckedAt: now.toISOString(), oddsAtControl: drift.current };
  if (problems.length)
    return { ok: true, output: { ...checked, verdict: "validate", reasons: problems }, needsValidation: { reason: `à corriger : ${problems.join(" ; ")}` }, summary: `validation demandée : ${problems.join(" ; ")}` };
  // Validation déjà accordée (texte corrigé par l'admin qui repasse ici) : rien de plus à demander.
  if (p.approved === true)
    return { ok: true, output: { ...checked, verdict: "publish", reasons: [] }, summary: `cote vérifiée ${drift.current} (${drift.driftPct} %), validée par le client` };
  const d = autonomyDecision(ctx.settings.autonomyLevel, { alwaysValidate: always, newCategory: novelty.newMarket });
  if (d.validate)
    return { ok: true, output: { ...checked, verdict: "validate", reasons: [d.reason ?? ""] }, needsValidation: { reason: d.reason ?? "validation" }, summary: `validation demandée : ${d.reason}` };
  return { ok: true, output: { ...checked, verdict: "publish", reasons: [] }, summary: `bon pour publication, cote vérifiée ${drift.current} (${drift.driftPct} %)` };
}

export async function sportsPublication(mission: Mission, ctx: AgentContext): Promise<AgentResult> {
  if (mission.payload.noPick === true) return { ok: true, skipped: true, summary: "aucun pari retenu" };
  if (mission.postId) {
    const existing = await ctx.prisma.post.findUnique({ where: { id: mission.postId }, select: { id: true } });
    if (existing) return { ok: true, summary: `déjà publié (${existing.id})` };
  }
  const l = await load(mission, ctx);
  if (isResult(l)) return l;
  const { pick, category, s } = l;
  const p = mission.payload;
  const now = ctx.now();
  const ko = kickoffCheck(pick.kickoffAt, now, category.minMinutesBeforeKickoff);
  if (!ko.ok) return skipPick(ctx, mission, pick, `au moment de publier : ${ko.reason}`);
  let oddsAtSend = typeof p.oddsAtControl === "number" ? p.oddsAtControl : pick.oddsAtSend;
  const checkedAt = typeof p.controlCheckedAt === "string" ? new Date(p.controlCheckedAt).getTime() : 0;
  // Validation longue : la cote est relue avant l'envoi (jamais une vieille cote).
  if (!oddsAtSend || now.getTime() - checkedAt > s.recheckAfterMinutes * 60_000) {
    const cur = await currentOdds(mission, ctx, pick, s);
    if ("error" in cur) return { ok: false, error: cur.error, retryable: false };
    const drift = checkOddsDrift(pick.odds, cur.odds, category.maxOddsDriftPct);
    if (!drift.ok) return skipPick(ctx, mission, pick, `au moment de publier : ${drift.reason}`, { code: drift.code, oddsAtSend: drift.current });
    oddsAtSend = drift.current;
  }
  const text = p.text;
  if (!text) return { ok: false, error: "Aucun texte à publier.", retryable: false };
  const simulation = ctx.settings.simulation || mission.isTest;
  const targetIds = Array.isArray(p.targetChannelIds) ? (p.targetChannelIds as string[]) : mission.channelId ? [mission.channelId] : [];
  const targets = (await Promise.all(targetIds.map((id) => loadChannel(ctx.prisma, id)))).filter((c): c is NonNullable<typeof c> => !!c);
  if (!targets.length) return { ok: false, error: "Aucun canal de destination.", retryable: false };
  const test = simulation ? await findTestChannel(ctx.prisma) : null;
  if (simulation && !test) return { ok: false, error: "Simulation : aucun canal Test actif (cochez « canal de test » sur un canal).", retryable: false };
  // Simulation : un seul message sur le canal Test, l'en-tête nomme les vrais canaux.
  const sends = simulation
    ? [{ channelId: test!.id, language: targets[0]!.language, text: `${simulationHeader("sports", targets.map((t) => t.title).join(", "))}\n${text}` }]
    : targets.map((t) => ({ channelId: t.id, language: t.language, text }));
  const media = typeof p.mediaAssetId === "string" ? [p.mediaAssetId] : [];
  const offer = category.campaignId ? { campaignId: category.campaignId, buttonText: s.offerButtonText, labelSuffix: simulation ? " (agents, simulation)" : " (agents)" } : null;

  const res = await (ctx.prisma as PrismaClient).$transaction(async (tx) => {
    const fresh = await tx.agentMission.findUnique({ where: { id: mission.id }, select: { postId: true } });
    if (fresh?.postId) return { postId: fresh.postId, created: 0 };
    const ids: string[] = [];
    for (const x of sends) {
      const post = await createAgentPost(tx, { channelId: x.channelId, text: x.text, scheduledAt: now, mediaAssetIds: media, agentMissionId: mission.id, language: x.language, offer });
      ids.push(post.postId);
    }
    await tx.agentMission.update({ where: { id: mission.id }, data: { postId: ids[0]!, scheduledFor: now } });
    await tx.bettingPick.update({ where: { id: pick.id }, data: { status: "PUBLISHED", postId: ids[0]!, oddsAtSend } });
    return { postId: ids[0]!, created: ids.length };
  });
  return {
    ok: true,
    output: { slot: now.toISOString(), postId: res.postId, publishChannelId: sends[0]!.channelId, simulation },
    summary: res.created ? `publié tout de suite sur ${simulation ? "le canal Test (simulation)" : `${res.created} canal${res.created > 1 ? "aux" : ""}`}, cote ${oddsAtSend}` : `déjà publié (${res.postId})`,
  };
}

async function askWorkaroundOnce(ctx: AgentContext): Promise<void> {
  // Import différé : `setup` enregistre ses réponses auprès de `human/respond`, qui dépend du moteur (cycle d'imports).
  const { askCaptureWorkaround, SPORTS_WORKAROUND_REQUEST_KEY } = await import("./setup");
  if (await ctx.prisma.humanRequest.findFirst({ where: { key: SPORTS_WORKAROUND_REQUEST_KEY }, select: { id: true } })) return;
  try {
    await askCaptureWorkaround(ctx);
  } catch (err) {
    ctx.logger?.warn({ err: (err as Error).message }, "[agents] question de parade non posée");
  }
}
