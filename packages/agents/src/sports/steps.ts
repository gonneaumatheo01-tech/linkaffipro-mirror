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
import { checkOddsDrift, findSelection, isDuplicatePick, kickoffCheck, oddsInRange, PUBLISH_MARGIN_MINUTES } from "../rules/bets";
import { autonomyDecision, sportsAlwaysValidateReason } from "../orchestrator/autonomy";
import { freshMarkets } from "../providers/odds-batch";
import { OddsQuotaError } from "../providers/odds-quota";
import { resolveOddsProvider } from "../providers/odds-registry";
import { findTestChannel, loadChannel } from "../agents/data";
import { simulationHeader } from "../agents/publication/header";
import type { AgentContext, AgentResult, Mission } from "../types";
import { loadCategory, loadMissionPick, noveltyOf, recentPickKeys, type BetCategoryInfo, type PickRow } from "./data";
import { betPostText } from "./format";
import { frOdds } from "./labels";
import { ensurePickImage } from "./pick-image";
import { parseSportsSettings, withTeamBounds, type SportsSettings } from "./settings";
import { skipPick } from "./skip";
import type { PickReasoning } from "../agents/cotes/select";
import { isDirectPick, verifyDirectOdds } from "./direct-odds";
import { BOOKMAKER_LIMITS } from "../bookmakers/contract";
import { isHumanOddsPick, ODDS_LEVEL_HUMAN } from "./human-odds-text";

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
  // Cote affichée = cote constatée sur le site (capture), sinon la dernière cote vérifiée, sinon la cote retenue.
  const textOdds = (image.kind === "screenshot" ? image.readOdds : null) ?? pick.oddsAtSend ?? pick.odds;
  const text = writeText(pick, s, textOdds);
  return {
    ok: true,
    output: {
      text,
      textOdds,
      format: "photo",
      mediaAssetId: image.assetId,
      screenshotAssetId: image.assetId,
      fallbackImage: image.kind === "fallback",
      ...(image.kind === "fallback" ? { captureError: image.reason } : {}),
    },
    summary: `${pick.homeTeam} – ${pick.awayTeam}, ${pick.selectionLabel} à ${textOdds}${image.kind === "fallback" ? ", image de repli" : ", capture jointe"}`,
  };
}

function writeText(pick: PickRow, s: SportsSettings, odds: number): string {
  return betPostText({ ...pick, odds, reasoning: pick.reasoning as Partial<PickReasoning>, disclaimer: s.disclaimer });
}

const sameOdds = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/**
 * Texte remis à la cote vérifiée (règle : la cote publiée est celle relue chez le bookmaker). Texte écrit par le code
 * → réécrit ; texte corrigé par le client → seule la cote affichée est remplacée. `changed` = faux si rien à faire.
 */
export function textWithOdds(p: Record<string, unknown>, pick: PickRow, s: SportsSettings, odds: number): { text: string; changed: boolean } {
  const current = typeof p.text === "string" ? p.text : "";
  const shown = typeof p.textOdds === "number" ? p.textOdds : pick.odds;
  if (current && sameOdds(shown, odds)) return { text: current, changed: false };
  if (!current || current === writeText(pick, s, shown)) return { text: writeText(pick, s, odds), changed: true };
  return { text: current.split(frOdds(shown)).join(frOdds(odds)), changed: true };
}

function contentProblems(ctx: AgentContext, s: SportsSettings, text: string): string[] {
  return checkContent(text, {
    maxLength: Math.min(ctx.settings.maxTextLength, TELEGRAM_CAPTION_MAX),
    forbiddenWords: [...new Set([...ctx.settings.forbiddenWords, ...s.forbiddenWords])],
  }).problems.map((x) => x.message);
}

/** Pari de test (faux fournisseur) : jamais lu sur un vrai site. */
function isFakePick(mission: Mission, pick: PickRow): boolean {
  return (pick.reasoning as { source?: string } | null)?.source === "fake" || mission.payload.oddsSource === "fake";
}

/**
 * Cote actuelle chez le bookmaker du pari (relue sans cache). Clé absente ou plafond d'appels atteint : `skip` (le pari
 * est écarté, la mission annulée SANS compter d'échec : ce n'est pas une panne, l'équipe ne se met pas en pause).
 */
async function currentOdds(mission: Mission, ctx: AgentContext, pick: PickRow, s: SportsSettings): Promise<{ odds: number | null } | { skip: string }> {
  const source = (pick.reasoning as { source?: string } | null)?.source === "fake" || mission.payload.oddsSource === "fake" ? "fake" : "live";
  const resolved = await resolveOddsProvider(ctx, { source, maxCalls: s.maxApiCallsPerMonth, fakeShiftMs: (pick.reasoning as { fakeShiftMs?: number } | null)?.fakeShiftMs ?? null });
  if (!resolved) return { skip: "clé de cotes absente" };
  try {
    const list = await freshMarkets(resolved.provider, pick.eventId, [pick.marketId]);
    return { odds: findSelection(list, pick.marketId, pick.line)?.byBookmaker[pick.bookmaker] ?? null };
  } catch (err) {
    if (err instanceof OddsQuotaError) return { skip: "plafond d'appels atteint" };
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
  let drift: { current: number; driftPct: number };
  if (isHumanOddsPick(pick)) {
    // 28 octobre 2026 : cote donnée par l'équipe avec sa capture (site illisible) : jamais relue, jamais estimée.
    const odds = pick.oddsLevel === ODDS_LEVEL_HUMAN ? (pick.oddsAtSend ?? pick.odds) : null;
    if (odds === null) return skipPick(ctx, mission, pick, "cote de l'équipe absente : le pari ne part pas sans elle");
    drift = { current: odds, driftPct: 0 };
  } else if (isDirectPick(pick) && !isFakePick(mission, pick)) {
    // Phase 35 : cote lue sur le site du client → double lecture (deux chemins, identiques, à moins de 3 min).
    const v = await verifyDirectOdds(mission, ctx, pick, category, "controle");
    if (!("ok" in v)) return v.result;
    drift = { current: v.odds, driftPct: v.driftPct };
  } else {
    const cur = await currentOdds(mission, ctx, pick, s);
    if ("skip" in cur) return skipPick(ctx, mission, pick, cur.skip);
    const d = checkOddsDrift(pick.odds, cur.odds, category.maxOddsDriftPct);
    if (!d.ok) return skipPick(ctx, mission, pick, d.reason, { code: d.code, oddsAtSend: d.current });
    drift = d;
    await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { oddsAtSend: drift.current } });
  }
  // Cote relue différente de celle du texte : texte remis à la cote vérifiée, puis contrôlé (jamais une vieille cote).
  const fresh = textWithOdds(p, pick, s, drift.current);
  const rewritten = fresh.changed ? { text: fresh.text, textOdds: drift.current } : {};

  const problems = contentProblems(ctx, s, fresh.text);
  const asset = p.mediaAssetId ? await ctx.prisma.mediaAsset.findUnique({ where: { id: p.mediaAssetId }, select: { id: true, origin: true } }) : null;
  if (!asset) problems.push("image du pari absente");
  // Texte écrit par le code : une règle non respectée ne se « refait » pas, elle part en validation (texte corrigé).
  const novelty = mission.isTest ? { newLeague: false, newMarket: false } : await noveltyOf(ctx.prisma, pick);
  const always = sportsAlwaysValidateReason({
    ...novelty,
    league: pick.league,
    market: pick.marketLabel,
    oddsOutOfRange: !oddsInRange(drift.current, category),
    // L'agent Capture peut aussi exiger une validation (capture douteuse) sans passer par l'image de repli.
    fallbackImage:
      !asset ||
      asset.origin === "TEMPLATE" ||
      (typeof p.capture === "object" && p.capture !== null && (p.capture as { mustValidate?: unknown }).mustValidate === true),
    fallbackReason: typeof p.captureError === "string" ? p.captureError : null,
  });
  const checked = { controlCheckedAt: now.toISOString(), oddsAtControl: drift.current, ...rewritten };
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
  // Marge : le post part par le scheduler dans les instants qui suivent, jamais sous le délai minimal.
  const ko = kickoffCheck(pick.kickoffAt, now, category.minMinutesBeforeKickoff + PUBLISH_MARGIN_MINUTES);
  if (!ko.ok) return skipPick(ctx, mission, pick, `au moment de publier : ${ko.reason}`);
  let oddsAtSend = typeof p.oddsAtControl === "number" ? p.oddsAtControl : pick.oddsAtSend;
  const checkedAt = typeof p.controlCheckedAt === "string" ? new Date(p.controlCheckedAt).getTime() : 0;
  if (isHumanOddsPick(pick)) {
    // Cote de l'équipe (capture jointe) : publiée telle quelle, jamais remplacée par une estimation.
    if (pick.oddsLevel !== ODDS_LEVEL_HUMAN) return skipPick(ctx, mission, pick, "au moment de publier : cote de l'équipe absente");
    oddsAtSend = pick.oddsAtSend ?? pick.odds;
  } else if (isDirectPick(pick) && !isFakePick(mission, pick)) {
    // Phase 35 : la double lecture du Contrôle doit avoir moins de 3 minutes au moment de publier, sinon elle est
    // refaite (jamais une cote publiée sur une seule lecture ni sur une lecture trop ancienne).
    if (!oddsAtSend || now.getTime() - checkedAt > BOOKMAKER_LIMITS.doubleReadWindowMs) {
      const v = await verifyDirectOdds(mission, ctx, pick, category, "publication");
      if (!("ok" in v)) return v.result;
      oddsAtSend = v.odds;
    }
  } else if (!oddsAtSend || now.getTime() - checkedAt > s.recheckAfterMinutes * 60_000) {
    // Validation longue : la cote est relue avant l'envoi (jamais une vieille cote).
    const cur = await currentOdds(mission, ctx, pick, s);
    if ("skip" in cur) return skipPick(ctx, mission, pick, `au moment de publier : ${cur.skip}`);
    const drift = checkOddsDrift(pick.odds, cur.odds, category.maxOddsDriftPct);
    if (!drift.ok) return skipPick(ctx, mission, pick, `au moment de publier : ${drift.reason}`, { code: drift.code, oddsAtSend: drift.current });
    oddsAtSend = drift.current;
  }
  if (!p.text) return { ok: false, error: "Aucun texte à publier.", retryable: false };
  // Texte remis à la cote vérifiée si elle a bougé depuis la rédaction, puis recontrôlé.
  const fresh = textWithOdds(p, pick, s, oddsAtSend);
  const text = fresh.text;
  if (fresh.changed) {
    const problems = contentProblems(ctx, s, text);
    if (problems.length) return skipPick(ctx, mission, pick, `au moment de publier : texte non conforme après mise à jour de la cote (${problems.join(" ; ")})`);
  }
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
