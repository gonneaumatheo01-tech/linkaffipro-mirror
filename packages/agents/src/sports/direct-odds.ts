/**
 * Phase 35 : vérification d'un pari choisi sur les cotes d'un site du client (`BettingPick.siteKey`), au Contrôle
 * qualité et juste avant la publication :
 * - double lecture (`readOddsTwice`) : deux chemins indépendants, à moins de 3 min, identiques ; sinon la mission
 *   attend l'humain (`WAITING_HUMAN`, la capture jointe à l'événement) et Kevin le dit (crochet `onBookmakerEvent`) ;
 * - sélection absente du site par les deux chemins : pari écarté (comme un marché disparu) ;
 * - écart entre la cote choisie et la cote vérifiée au-delà de `maxOddsDriftPct` : la sélection est REFAITE (deux
 *   fois au plus, ensuite pari écarté) ;
 * - capture dont la cote affichée n'est pas exactement la cote vérifiée : capture refaite (deux fois au plus) ;
 * - sinon `oddsAtSend`, `oddsReadIds` (les deux lectures) et `oddsLevel` (« api+dom », « dom+image ») sont posés.
 * Les bookmakers couverts par SportsGameOdds ne passent jamais ici (comportement de la phase 23 inchangé).
 */
import { agentEvent } from "../admin/journal";
import { readOddsTwice, type OddsTwiceResult } from "../bookmakers/read";
import { emitHook, type BookmakerReadDeps } from "../bookmakers/read/deps";
import { sameOddsExact } from "../bookmakers/read/odds-format";
import { checkOddsDrift } from "../rules/bets";
import type { AgentContext, AgentResult, Mission } from "../types";
import type { BetCategoryInfo, PickRow } from "./data";
import { skipPick } from "./skip";

/** Sélections refaites au plus pour une même mission (cote qui bouge sans cesse : pari écarté). */
export const MAX_RESELECTIONS = 2;
export const MAX_RECAPTURES = 2;

export type DirectOddsOk = { ok: true; odds: number; driftPct: number; readIds: [string, string]; levels: string };

export function isDirectPick(pick: Pick<PickRow, "siteKey">): pick is PickRow & { siteKey: string } {
  return typeof pick.siteKey === "string" && pick.siteKey !== "";
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Mission en attente de l'humain : la double lecture n'a pas pu valider la cote. Reprise : nouveau contrôle. */
async function holdForHuman(ctx: AgentContext, mission: Mission, pick: PickRow & { siteKey: string }, r: Extract<OddsTwiceResult, { ok: false }>, step: "controle" | "publication"): Promise<AgentResult> {
  const now = ctx.now();
  await ctx.prisma.agentMission.updateMany({ where: { id: mission.id, status: { in: ["RUNNING", "PENDING"] } }, data: { status: "WAITING_HUMAN", lastActivityAt: now } });
  const captureAssetId = typeof mission.payload.mediaAssetId === "string" ? mission.payload.mediaAssetId : null;
  await agentEvent(ctx, "agents.sports.odds_unverified", { missionId: mission.id, pickId: pick.id, siteKey: pick.siteKey, code: r.code, reason: r.reason.slice(0, 200), reads: r.reads.length, step }, { channelId: mission.channelId });
  await emitHook(ctx as BookmakerReadDeps, { type: "double_read_failed", siteKey: pick.siteKey, missionId: mission.id, pickId: pick.id, reason: r.reason, captureAssetId, reads: r.reads });
  return {
    ok: true,
    goTo: "controle",
    output: { oddsCheck: { ok: false, code: r.code, reason: r.reason.slice(0, 300), at: now.toISOString() } as never, controlCheckedAt: null, oddsAtControl: null },
    summary: `cote non vérifiée deux fois (${r.reason.slice(0, 120)}) : en attente d'un humain`,
  };
}

/** Cote changée au-delà de la tolérance : pari écarté et sélection refaite dans la même mission. */
export const reselectPick = (ctx: AgentContext, mission: Mission, pick: PickRow, reason: string, current: number) => reselect(ctx, mission, pick, reason, current);

async function reselect(ctx: AgentContext, mission: Mission, pick: PickRow, reason: string, current: number): Promise<AgentResult> {
  const n = num(mission.payload.reselections);
  if (n >= MAX_RESELECTIONS) return skipPick(ctx, mission, pick, `${reason} (sélection déjà refaite ${n} fois)`, { code: "drift", oddsAtSend: current });
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { status: "SKIPPED", skipReason: "odds_moved", oddsAtSend: current } });
  await agentEvent(ctx, "agents.sports.reselect", { missionId: mission.id, pickId: pick.id, reason: reason.slice(0, 200), reselections: n + 1 }, { channelId: mission.channelId });
  return {
    ok: true,
    goTo: "cotes",
    output: {
      pickId: null,
      mediaAssetId: null,
      screenshotAssetId: null,
      capture: null,
      captureRequestId: null,
      captureTries: 0,
      recaptures: 0,
      text: "",
      textOdds: null,
      controlCheckedAt: null,
      oddsAtControl: null,
      noPick: false,
      reselections: n + 1,
    } as never,
    summary: `cote changée (${reason}) : sélection refaite`,
  };
}

/** La cote de la capture n'est pas la cote vérifiée : capture refaite. */
async function recapture(ctx: AgentContext, mission: Mission, pick: PickRow, shown: number, verified: number): Promise<AgentResult | null> {
  const n = num(mission.payload.recaptures);
  if (n >= MAX_RECAPTURES) return null;
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { screenshotAssetId: null } });
  await agentEvent(ctx, "agents.sports.recapture", { missionId: mission.id, pickId: pick.id, shown, verified }, { channelId: mission.channelId });
  return {
    ok: true,
    goTo: "capture",
    output: { mediaAssetId: null, screenshotAssetId: null, capture: null, captureRequestId: null, captureTries: 0, recaptures: n + 1 } as never,
    summary: `capture à refaire : elle affiche ${shown}, la cote vérifiée est ${verified}`,
  };
}

/**
 * Vérifie la cote d'un pari lu sur un site du client. Rend la cote vérifiée, ou l'issue de l'étape (attente humaine,
 * sélection refaite, capture refaite, pari écarté).
 */
export async function verifyDirectOdds(
  mission: Mission,
  ctx: AgentContext,
  pick: PickRow & { siteKey: string },
  category: Pick<BetCategoryInfo, "maxOddsDriftPct">,
  step: "controle" | "publication",
): Promise<DirectOddsOk | { result: AgentResult }> {
  const r = await readOddsTwice(ctx as BookmakerReadDeps, pick.siteKey, { siteEventId: pick.siteEventId ?? "", marketKey: pick.marketId, selectionKey: pick.marketId, line: pick.line });
  if (!r.ok) {
    if (r.code === "missing") return { result: await skipPick(ctx, mission, pick, `${step === "publication" ? "au moment de publier : " : ""}sélection disparue chez le bookmaker (${r.reason.slice(0, 120)})`, { code: "market_missing" }) };
    if (r.code === "busy") return { result: { ok: true, wait: { delayMs: 60_000 }, summary: `cote à relire dans une minute (${r.reason.slice(0, 120)})` } };
    if (r.code === "night") return { result: await skipPick(ctx, mission, pick, `lecture de la cote impossible la nuit (${r.reason.slice(0, 80)})`) };
    return { result: await holdForHuman(ctx, mission, pick, r, step) };
  }
  const drift = checkOddsDrift(pick.odds, r.odds, category.maxOddsDriftPct);
  if (!drift.ok) {
    if (drift.code === "drift") return { result: await reselect(ctx, mission, pick, drift.reason, r.odds) };
    return { result: await skipPick(ctx, mission, pick, drift.reason, { code: drift.code }) };
  }
  // La capture doit afficher EXACTEMENT la cote vérifiée (image de repli : validée par le client, pas de cote lue).
  const cap = mission.payload.capture as { status?: unknown; readOdds?: unknown } | null | undefined;
  if (cap && cap.status === "captured" && typeof cap.readOdds === "number" && !sameOddsExact(cap.readOdds, r.odds)) {
    const redo = await recapture(ctx, mission, pick, cap.readOdds, r.odds);
    if (redo) return { result: redo };
    return { result: await holdForHuman(ctx, mission, pick, { ok: false, code: "mismatch", reason: `la capture affiche ${cap.readOdds}, la cote vérifiée est ${r.odds}`, reads: [] }, step) };
  }
  const levels = r.levels.join("+");
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { oddsAtSend: r.odds, oddsReadIds: r.readIds as never, oddsLevel: levels } });
  return { ok: true, odds: r.odds, driftPct: drift.driftPct, readIds: r.readIds, levels };
}
