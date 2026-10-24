/**
 * Agent Capture écran (phase 23, équipe Paris) : retrouve le pari retenu sur le site du bookmaker, lit la cote,
 * la compare à la cote retenue (écart toléré de la catégorie), range la capture entourée et pose
 * `BettingPick.screenshotAssetId` + `oddsAtSend` provisoire. Cote bougée ou marché disparu → pari écarté (journalisé,
 * mission annulée sans compter d'échec). Capture impossible → parade : file du Mac si le client l'a choisie, sinon
 * image de repli (TEMPLATE) à faire valider par le client (`payload.capture.mustValidate`).
 */
import { cancelMission } from "../../missions/lifecycle";
import { agentEvent } from "../../admin/journal";
import type { AgentContext, AgentDefinition, AgentResult, Mission } from "../../types";
import type { CaptureRequest, CaptureResult, ScreenshotProvider } from "../../providers/screenshot";
import { captureBlocked, captureParade, captureResultText } from "../../providers/screenshot/errors";
import { formatOddsFr, renderFallbackHtml } from "../../providers/screenshot/template";
import { oddsDriftPct, oddsWithinTolerance } from "../../providers/screenshot/match";
import { localScreenshotProvider } from "../../providers/screenshot/registry";
import type { BrowserScreenshotProvider } from "../../providers/screenshot/provider";
import { createCaptureRequest, readCaptureRequest, type CaptureRequestResult } from "../../providers/screenshot/requests";
import { parseCaptureSettings } from "../../providers/screenshot/settings";
import { storeCapturePng } from "../../providers/screenshot/store";
import { parseSportsSettings } from "../../sports/settings";

/** Relecture d'une capture demandée au worker ou au Mac. */
export const CAPTURE_POLL_MS = 30_000;
/** Une capture « délai dépassé » est retentée une fois, 5 min plus tard, avant l'image de repli. */
export const CAPTURE_RETRY_DELAY_MS = 5 * 60_000;
export const DEFAULT_ODDS_TOLERANCE_PCT = 5;

export type CapturePayload = {
  status: "captured" | "fallback" | "skipped";
  assetId?: string | null;
  readOdds?: number | null;
  expectedOdds?: number;
  driftPct?: number | null;
  pageUrl?: string | null;
  /** Classement de l'échec (fallback / skipped). */
  kind?: string | null;
  reason?: string | null;
  /** Le site bloque le serveur : la chaîne pose la question « adresse IP résidentielle ou Mac ». */
  blocked?: boolean;
  /** Image de repli : toujours validée par le client. */
  mustValidate?: boolean;
  via?: "direct" | "server" | "mac";
};

type PickRow = {
  id: string;
  missionId: string | null;
  categoryId: string;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  marketLabel: string;
  selectionLabel: string;
  line: number | null;
  bookmaker: string;
  odds: number;
  reasoning: unknown;
  screenshotAssetId: string | null;
  oddsAtSend: number | null;
  status: string;
};

async function loadPick(mission: Mission, ctx: AgentContext): Promise<PickRow | null> {
  const id = typeof mission.payload.pickId === "string" ? mission.payload.pickId : null;
  if (id) return (await ctx.prisma.bettingPick.findUnique({ where: { id } })) as PickRow | null;
  return (await ctx.prisma.bettingPick.findFirst({ where: { missionId: mission.id }, orderBy: { createdAt: "desc" } })) as PickRow | null;
}

export function captureRequestOf(pick: PickRow): CaptureRequest {
  const reasoning = (pick.reasoning && typeof pick.reasoning === "object" ? pick.reasoning : {}) as Record<string, unknown>;
  const links = reasoning.bookmakerLinks as Record<string, unknown> | undefined;
  const eventUrl = typeof reasoning.eventUrl === "string" ? reasoning.eventUrl : typeof links?.[pick.bookmaker] === "string" ? (links[pick.bookmaker] as string) : null;
  return {
    bookmaker: pick.bookmaker,
    homeTeam: pick.homeTeam,
    awayTeam: pick.awayTeam,
    kickoffAt: new Date(pick.kickoffAt),
    marketLabel: pick.marketLabel,
    selectionLabel: pick.selectionLabel,
    line: pick.line,
    expectedOdds: pick.odds,
    eventUrl,
  };
}

/** Écart toléré : le plus strict de la catégorie et de l'équipe (même règle que le Contrôle, `withTeamBounds`). */
async function tolerancePct(ctx: AgentContext, categoryId: string): Promise<number> {
  const cat = await ctx.prisma.betCategory.findUnique({ where: { id: categoryId }, select: { maxOddsDriftPct: true } });
  const v = Number(cat?.maxOddsDriftPct);
  const category = Number.isFinite(v) && v >= 0 ? v : DEFAULT_ODDS_TOLERANCE_PCT;
  return Math.min(category, parseSportsSettings(ctx.settings.settings).maxOddsDriftPct);
}

function providerOf(ctx: AgentContext): (ScreenshotProvider & Partial<Pick<BrowserScreenshotProvider, "renderTemplate">>) | null {
  const forced = ctx.providers.screenshot as (ScreenshotProvider & Partial<BrowserScreenshotProvider>) | null | undefined;
  return forced ?? localScreenshotProvider();
}

async function skipPick(mission: Mission, ctx: AgentContext, pick: PickRow, reason: string, capture: CapturePayload): Promise<AgentResult> {
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { status: "SKIPPED", skipReason: reason.slice(0, 300) } });
  await agentEvent(ctx, "agents.sports.pick_skipped", { missionId: mission.id, pickId: pick.id, reason: reason.slice(0, 200), step: "capture" }, { channelId: mission.channelId });
  // Pari écarté : la mission s'arrête là, sans compter d'échec (ce n'est pas une panne).
  await cancelMission(ctx, mission.id, { reason: `pari écarté : ${reason}` });
  return { ok: true, output: { capture: capture as never }, summary: `pari écarté : ${reason}` };
}

async function accept(
  mission: Mission,
  ctx: AgentContext,
  pick: PickRow,
  r: { assetId: string; readOdds: number; pageUrl: string },
  via: CapturePayload["via"],
): Promise<AgentResult> {
  const tol = await tolerancePct(ctx, pick.categoryId);
  const drift = oddsDriftPct(pick.odds, r.readOdds);
  if (!oddsWithinTolerance(pick.odds, r.readOdds, tol)) {
    const reason = `cote bougée chez ${pick.bookmaker} : ${formatOddsFr(pick.odds)} → ${formatOddsFr(r.readOdds)} (${drift.toFixed(1).replace(".", ",")} %, écart toléré ${tol} %)`;
    return skipPick(mission, ctx, pick, reason, { status: "skipped", kind: "odds_moved", reason, readOdds: r.readOdds, expectedOdds: pick.odds, driftPct: drift, assetId: r.assetId, via });
  }
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { screenshotAssetId: r.assetId, oddsAtSend: r.readOdds } });
  await agentEvent(ctx, "agents.sports.captured", { missionId: mission.id, pickId: pick.id, assetId: r.assetId, readOdds: r.readOdds, expectedOdds: pick.odds, via }, { channelId: mission.channelId });
  const capture: CapturePayload = { status: "captured", assetId: r.assetId, readOdds: r.readOdds, expectedOdds: pick.odds, driftPct: drift, pageUrl: r.pageUrl, via };
  return {
    ok: true,
    output: { mediaAssetId: r.assetId, capture: capture as never },
    summary: `capture faite chez ${pick.bookmaker}, cote ${formatOddsFr(r.readOdds)} (retenue ${formatOddsFr(pick.odds)})`,
  };
}

async function fallback(mission: Mission, ctx: AgentContext, pick: PickRow, failure: CaptureResult & { ok: false }, via: CapturePayload["via"]): Promise<AgentResult> {
  const blocked = captureBlocked(failure);
  const reason = captureResultText(failure);
  await agentEvent(
    ctx,
    "agents.sports.capture_failed",
    { missionId: mission.id, pickId: pick.id, kind: failure.kind, message: failure.message.slice(0, 200), blocked, parade: captureParade(failure), via },
    { channelId: mission.channelId },
  );
  const renderer = providerOf(ctx)?.renderTemplate ?? localScreenshotProvider()?.renderTemplate;
  if (!renderer) {
    // Site sans navigateur : le worker fabriquera l'image au passage suivant (étape relue).
    return { ok: false, retryable: false, error: `capture impossible (${reason}) et image de repli impossible ici (pas de navigateur)` };
  }
  const html = renderFallbackHtml({
    homeTeam: pick.homeTeam,
    awayTeam: pick.awayTeam,
    league: pick.league,
    kickoffAt: new Date(pick.kickoffAt),
    marketLabel: pick.marketLabel,
    selectionLabel: pick.selectionLabel,
    line: pick.line,
    odds: pick.odds,
    bookmaker: pick.bookmaker,
  });
  const png = await renderer(html, { width: 1080, height: 1080 });
  const asset = await storeCapturePng(ctx.prisma, { png, bookmaker: pick.bookmaker, salt: `${pick.id}:repli`, origin: "TEMPLATE", width: 1080, height: 1080 });
  // Cote non lue sur le site : pas de `oddsAtSend` (le Contrôle la re-vérifie par le fournisseur de cotes).
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { screenshotAssetId: asset.id } });
  const capture: CapturePayload = { status: "fallback", assetId: asset.id, kind: failure.kind, reason, blocked, mustValidate: true, expectedOdds: pick.odds, via };
  return {
    ok: true,
    output: { mediaAssetId: asset.id, capture: capture as never },
    summary: `capture impossible (${reason}) : image de repli, à valider${blocked ? " ; site bloqué depuis le serveur" : ""}`,
  };
}

/** Résultat brut (direct ou par la file) → issue de l'étape. */
async function settle(mission: Mission, ctx: AgentContext, pick: PickRow, r: CaptureRequestResult, via: CapturePayload["via"]): Promise<AgentResult> {
  if (r.ok) return accept(mission, ctx, pick, r, via);
  if (r.kind === "market_missing")
    return skipPick(mission, ctx, pick, `marché disparu chez ${pick.bookmaker} (${r.message.slice(0, 120)})`, { status: "skipped", kind: r.kind, reason: r.message, via });
  const tries = Number(mission.payload.captureTries ?? 0);
  if (r.kind === "timeout" && tries < 1)
    return { ok: true, wait: { delayMs: CAPTURE_RETRY_DELAY_MS }, output: { captureTries: tries + 1, captureRequestId: null }, summary: `site trop lent, nouvel essai dans 5 min (${r.message.slice(0, 80)})` };
  return fallback(mission, ctx, pick, { ok: false, kind: r.kind, message: r.message }, via);
}

export const agent: AgentDefinition = {
  key: "capture",
  async run(mission, ctx) {
    const pick = await loadPick(mission, ctx);
    if (!pick) return { ok: false, retryable: false, error: "Aucun pari retenu pour cette mission." };
    if (pick.status !== "PROPOSED") return { ok: true, skipped: true, summary: `pari déjà ${pick.status.toLowerCase()}` };
    if (pick.screenshotAssetId)
      return { ok: true, output: { mediaAssetId: pick.screenshotAssetId }, summary: "capture déjà faite" };

    const settings = parseCaptureSettings(ctx.settings.settings);
    const now = ctx.now();

    // Capture déjà demandée au worker ou au Mac : on relit la demande.
    const pendingId = typeof mission.payload.captureRequestId === "string" ? mission.payload.captureRequestId : null;
    if (pendingId) {
      const s = await readCaptureRequest(ctx.prisma, pendingId);
      const via = s?.target ?? "server";
      if (s?.status === "DONE" && s.result) return settle(mission, ctx, pick, s.result, via);
      const age = s ? now.getTime() - new Date(s.createdAt).getTime() : Infinity;
      if (age > settings.waitMinutes * 60_000)
        return fallback(mission, ctx, pick, { ok: false, kind: "timeout", message: via === "mac" ? "capture depuis le Mac pas faite à temps (Mac éteint ?)" : "capture par le serveur pas faite à temps" }, via);
      return { ok: true, wait: { delayMs: CAPTURE_POLL_MS }, summary: via === "mac" ? "capture demandée au Mac, en attente" : "capture en file, en attente" };
    }

    const req = captureRequestOf(pick);
    const forced = ctx.providers.screenshot as ScreenshotProvider | null | undefined;
    const local = settings.mode === "mac" ? null : providerOf(ctx);
    const provider = forced ?? local;
    if (!provider) {
      const target = settings.mode === "mac" ? "mac" : "server";
      const created = await createCaptureRequest(ctx.prisma, { kind: "capture", target, bookmaker: pick.bookmaker, request: req, missionId: mission.id, now });
      return {
        ok: true,
        wait: { delayMs: CAPTURE_POLL_MS },
        output: { captureRequestId: created.id },
        summary: target === "mac" ? "capture demandée au Mac (pnpm agents:capture-runner)" : "capture mise en file pour le worker",
      };
    }
    const result = await provider.capture(req);
    if (result.ok) {
      const asset = await storeCapturePng(ctx.prisma, { png: result.png, bookmaker: pick.bookmaker, salt: `${pick.id}:${now.getTime()}` });
      return settle(mission, ctx, pick, { ok: true, assetId: asset.id, readOdds: result.readOdds, pageUrl: result.pageUrl }, "direct");
    }
    return settle(mission, ctx, pick, result, "direct");
  },
};
