/**
 * Paris par capture (28 octobre 2026, décision du client) : les sites des bookmakers (Celsius, Sportaza, Bet Portal)
 * ne se lisent pas depuis le serveur (contrôle anti-robot, jamais contourné). L'équipe choisit le pari sur les
 * statistiques (`stats-select.ts`), puis Kevin demande à l'équipe humaine la capture de ce pari sur le site et la cote
 * exacte ; le post part avec cette capture et cette cote.
 *
 * Déroulé (agent Capture, `humanOddsCaptureStep`) :
 * 1. demande MEDIA `sports.human-odds.<pari>` par la file des questions (une à la fois), échéance = coup d'envoi − délai
 *    minimal − 10 min (`onAnswer.deadline`) ; mission en attente de l'humain, l'étape Capture est rejouée à la réponse ;
 * 2. réception (`receiveHumanOddsInput`, Telegram) : la photo est rangée (SCREENSHOT, origine HUMAN_SITE) ; la cote est
 *    lue dans la légende ou le message (« 1,85 ») ; hors de la fourchette de la catégorie → redemandée une fois, puis
 *    pari écarté ; capture ET cote reçues → demande close, la mission reprend ; « pas dispo » → pari écarté ;
 * 3. étape Capture rejouée : cote et capture posées sur le pari (`odds`, `oddsAtSend`, `oddsLevel = human`), suite
 *    habituelle (Rédaction, Contrôle, Publication) sans relecture de la cote (elle vient de l'équipe) ;
 * 4. « plus tard », échéance dépassée ou pari introuvable → pari écarté, jamais publié sans capture ni cote.
 * Jamais de mise, jamais de dépôt : l'équipe regarde le site, le code ne s'y connecte pas.
 */
import { createHash } from "node:crypto";
import { agentEvent, nowOf } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import { askHuman, onAnswerOf, sendNextHumanRequest } from "../human/requests";
import { respondToRequest, skipRequest, type HumanRequestRow } from "../human/respond";
import { isSkipText } from "../human/answer";
import { cancelMission } from "../missions/lifecycle";
import { PUBLISH_MARGIN_MINUTES } from "../rules/bets";
import type { AgentContext, AgentResult, AgentsDeps, Mission } from "../types";
import { loadCategory, type PickRow } from "./data";
import { kickoffLabel } from "./format";
import { leagueLabel } from "./labels";
import {
  HUMAN_ODDS_DONE,
  HUMAN_ODDS_KEY_PREFIX,
  HUMAN_ODDS_UNAVAILABLE,
  ODDS_LEVEL_HUMAN,
  ODDS_LEVEL_HUMAN_PENDING,
  frOddsText,
  humanOddsKey,
  parseHumanOddsText,
  pickIdOfHumanOddsKey,
} from "./human-odds-text";

/** Marge avant l'échéance : le temps de valider et de publier après la réponse. */
export const HUMAN_ODDS_DEADLINE_MARGIN_MIN = 10;

export type HumanOddsState = {
  assetId?: string;
  odds?: number;
  unavailable?: boolean;
  reason?: string;
  outOfRange?: number;
};

export function humanOddsStateOf(onAnswer: unknown): HumanOddsState {
  const s = onAnswerOf(onAnswer).humanOdds;
  if (!s || typeof s !== "object") return {};
  const o = s as Record<string, unknown>;
  return {
    ...(typeof o.assetId === "string" ? { assetId: o.assetId } : {}),
    ...(typeof o.odds === "number" ? { odds: o.odds } : {}),
    ...(o.unavailable === true ? { unavailable: true } : {}),
    ...(typeof o.reason === "string" ? { reason: o.reason } : {}),
    ...(typeof o.outOfRange === "number" ? { outOfRange: o.outOfRange } : {}),
  };
}

/** Échéance de la réponse (pur) : coup d'envoi − délai minimal − marge de publication − 10 min. */
export function humanOddsDeadline(kickoffAt: Date, minMinutesBeforeKickoff: number): Date {
  return new Date(kickoffAt.getTime() - (minMinutesBeforeKickoff + PUBLISH_MARGIN_MINUTES + HUMAN_ODDS_DEADLINE_MARGIN_MIN) * 60_000);
}

const HOUR_FMT = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const hourLabel = (d: Date) => HOUR_FMT.format(d).replace(":", " h ");

/** Question posée à l'équipe (pur, voix de Kevin, 5 lignes). */
export function humanOddsQuestion(i: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  marketLabel: string;
  selectionLabel: string;
  site: string;
  deadline: Date;
}): string {
  return [
    `Pari à préparer : ${i.homeTeam} – ${i.awayTeam} (${leagueLabel(i.league)}), ${kickoffLabel(i.kickoffAt)}.`,
    `${i.marketLabel} : ${i.selectionLabel}, sur ${i.site}.`,
    `Envoie-moi la capture de ce pari sur ${i.site}, avec la cote exacte en légende (ex. 1,85).`,
    `Pas proposé sur le site ? Réponds « pas dispo ». Sans réponse avant ${hourLabel(i.deadline)}, je laisse tomber ce pari.`,
  ].join("\n");
}

type CaptureOutput = {
  status: "captured";
  assetId: string;
  readOdds: number;
  expectedOdds: number;
  driftPct: number;
  pageUrl: null;
  via: "human";
};

async function skipHumanPick(ctx: AgentContext, mission: Mission, pick: PickRow, reason: string): Promise<AgentResult> {
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { status: "SKIPPED", skipReason: reason.slice(0, 300) } });
  await agentEvent(ctx, "agents.sports.pick_skipped", { missionId: mission.id, pickId: pick.id, reason: reason.slice(0, 200), step: "capture", via: "human" }, { channelId: mission.channelId });
  await cancelMission(ctx, mission.id, { reason: `pari écarté : ${reason}` });
  return { ok: true, output: { capture: { status: "skipped", reason, via: "human" } as never }, summary: `pari écarté : ${reason}` };
}

/** Étape Capture d'un pari dont l'équipe envoie la capture et la cote (voir l'en-tête). */
export async function humanOddsCaptureStep(mission: Mission, ctx: AgentContext, pick: PickRow, site: string): Promise<AgentResult> {
  const key = humanOddsKey(pick.id);
  const req = (await ctx.prisma.humanRequest.findFirst({ where: { key }, orderBy: { createdAt: "desc" } })) as (HumanRequestRow & { onAnswer: unknown }) | null;
  const state = humanOddsStateOf(req?.onAnswer);
  if (req?.status === "ANSWERED") {
    if (state.unavailable) return skipHumanPick(ctx, mission, pick, state.reason ?? `pari pas proposé chez ${site} (réponse de l'équipe)`);
    if (state.assetId && typeof state.odds === "number") {
      const odds = state.odds;
      await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { screenshotAssetId: state.assetId, odds, oddsAtSend: odds, oddsLevel: ODDS_LEVEL_HUMAN } });
      await agentEvent(ctx, "agents.sports.captured", { missionId: mission.id, pickId: pick.id, assetId: state.assetId, readOdds: odds, via: "human" }, { channelId: mission.channelId });
      const capture: CaptureOutput = { status: "captured", assetId: state.assetId, readOdds: odds, expectedOdds: odds, driftPct: 0, pageUrl: null, via: "human" };
      return {
        ok: true,
        output: { mediaAssetId: state.assetId, screenshotAssetId: state.assetId, capture: capture as never },
        summary: `capture et cote ${frOddsText(odds)} envoyées par l'équipe (${site})`,
      };
    }
  }
  if (req && (req.status === "SKIPPED" || req.status === "EXPIRED")) return skipHumanPick(ctx, mission, pick, "pas de capture ni de cote reçues à temps");

  const category = await loadCategory(ctx.prisma, pick.categoryId);
  const deadline = humanOddsDeadline(pick.kickoffAt, category?.minMinutesBeforeKickoff ?? 30);
  if (nowOf(ctx).getTime() >= deadline.getTime()) {
    if (req && (req.status === "QUEUED" || req.status === "PENDING")) await closeHumanOddsRequest(ctx, req.id, "EXPIRED");
    return skipHumanPick(ctx, mission, pick, "coup d'envoi trop proche : plus le temps d'attendre la capture");
  }
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { oddsLevel: ODDS_LEVEL_HUMAN_PENDING } });
  const asked = await askHuman(ctx, {
    teamKey: "sports",
    kind: "MEDIA",
    key,
    question: humanOddsQuestion({ ...pick, site, deadline }),
    expected: { count: 1, tags: [], ...(mission.channelId ? { channelId: mission.channelId } : {}) },
    missionId: mission.id,
    onAnswer: { deadline: deadline.toISOString(), pickId: pick.id, site, minOdds: category?.minOdds ?? null, maxOdds: category?.maxOdds ?? null },
  });
  await agentEvent(ctx, "agents.sports.human_odds_asked", { missionId: mission.id, pickId: pick.id, requestId: asked.requestId, sent: asked.sent, site }, { channelId: mission.channelId });
  // Mission en attente de l'humain (posée par `askHuman`) : l'étape Capture est rejouée à la réponse ou à l'échéance.
  return { ok: true, goTo: "capture", output: { humanOddsRequestId: asked.requestId }, summary: `capture et cote demandées à l'équipe (${site})` };
}

/** Ferme une demande « capture et cote » ouverte (échéance, pari écarté) et envoie la question suivante. */
export async function closeHumanOddsRequest(deps: AgentsDeps, requestId: string, status: "EXPIRED" | "SKIPPED"): Promise<boolean> {
  const done = await deps.prisma.humanRequest.updateMany({ where: { id: requestId, status: { in: ["QUEUED", "PENDING"] } }, data: { status, answeredAt: nowOf(deps) } });
  if (done.count === 0) return false;
  await agentEvent(deps, status === "EXPIRED" ? "agents.request.expired" : "agents.request.skipped", { requestId, via: "deadline" });
  await sendNextHumanRequest(deps).catch(() => null);
  return true;
}

/** Capture de l'équipe rangée dans la médiathèque (SCREENSHOT, origine HUMAN_SITE), propre au pari. */
export async function storeHumanScreenshot(
  deps: Pick<AgentsDeps, "prisma">,
  pick: { id: string; bookmaker: string },
  image: { bytes: Uint8Array; mimeType: string; width?: number | null; height?: number | null },
): Promise<string> {
  const sha256 = createHash("sha256").update(image.bytes).update(`capture-equipe:${pick.id}`).digest("hex");
  const existing = await deps.prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
  if (existing) return existing.id;
  const ext = /png/i.test(image.mimeType) ? "png" : /webp/i.test(image.mimeType) ? "webp" : "jpg";
  const a = await deps.prisma.mediaAsset.create({
    data: {
      filename: `capture-${pick.bookmaker}-${pick.id}.${ext}`,
      mimeType: image.mimeType || "image/jpeg",
      size: image.bytes.length,
      sha256,
      bytes: Buffer.from(image.bytes),
      width: image.width ?? null,
      height: image.height ?? null,
      teamKey: "sports",
      kind: "SCREENSHOT",
      origin: "HUMAN_SITE",
      tags: ["screenshot", pick.bookmaker, "capture-equipe"],
    },
    select: { id: true },
  });
  return a.id;
}

export type HumanOddsInput = {
  text?: string | null;
  image?: { bytes: Uint8Array; mimeType: string; width?: number | null; height?: number | null } | null;
  actor: ActorRef;
};

export type HumanOddsReceive = { handled: boolean; reply?: string; closed?: boolean };

/** Demande « capture et cote » posée en ce moment (la question affichée), sinon null. */
export async function currentHumanOddsRequest(deps: Pick<AgentsDeps, "prisma">): Promise<(HumanRequestRow & { onAnswer: unknown }) | null> {
  return (await deps.prisma.humanRequest.findFirst({
    where: { key: { startsWith: HUMAN_ODDS_KEY_PREFIX }, status: "PENDING" },
    orderBy: { askedAt: "asc" },
  })) as (HumanRequestRow & { onAnswer: unknown }) | null;
}

async function saveState(deps: Pick<AgentsDeps, "prisma">, req: { id: string; onAnswer: unknown }, state: HumanOddsState): Promise<void> {
  const onAnswer = { ...onAnswerOf(req.onAnswer), humanOdds: state };
  await deps.prisma.humanRequest.update({ where: { id: req.id }, data: { onAnswer: JSON.parse(JSON.stringify(onAnswer)) } });
  req.onAnswer = onAnswer;
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * Message de l'équipe pendant qu'une demande « capture et cote » est posée : photo (avec ou sans légende), cote écrite,
 * « pas dispo », « plus tard ». `handled: false` : le message n'est pas pour cette demande (le chemin habituel continue).
 * La question suivante part après la réponse de Kevin (l'appelant appelle `sendNextHumanRequest` si `closed`).
 */
export async function receiveHumanOddsInput(deps: AgentsDeps, input: HumanOddsInput): Promise<HumanOddsReceive> {
  const req = await currentHumanOddsRequest(deps);
  if (!req) return { handled: false };
  const text = (input.text ?? "").trim();
  const parsed = parseHumanOddsText(text);
  if (!input.image && !parsed && !isSkipText(text)) return { handled: false };

  const pickId = pickIdOfHumanOddsKey(req.key);
  const pick = pickId ? ((await deps.prisma.bettingPick.findUnique({ where: { id: pickId } })) as PickRow | null) : null;
  const meta = onAnswerOf(req.onAnswer);
  const site = typeof meta.site === "string" ? meta.site : (pick?.bookmaker ?? "le site");
  if (!pick || pick.status !== "PROPOSED") {
    await closeHumanOddsRequest(deps, req.id, "SKIPPED");
    return { handled: true, closed: true, reply: "Ce pari n'est plus à préparer, je l'ai retiré de la liste." };
  }
  if (!input.image && isSkipText(text)) {
    await skipRequest(deps, req, input.actor, { deferNext: true });
    return { handled: true, closed: true, reply: "D'accord, je laisse tomber ce pari." };
  }
  const state = humanOddsStateOf(req.onAnswer);
  if (parsed?.kind === "unavailable") {
    await saveState(deps, req, { ...state, unavailable: true, reason: `pari pas proposé chez ${site} (réponse de l'équipe)` });
    await respondToRequest(deps, req, HUMAN_ODDS_UNAVAILABLE, input.actor, { deferNext: true });
    return { handled: true, closed: true, reply: `Noté, pas proposé chez ${site} : je laisse tomber ce pari.` };
  }
  if (input.image) state.assetId = await storeHumanScreenshot(deps, pick, input.image);
  if (parsed?.kind === "odds") {
    const min = num(meta.minOdds, 1.01);
    const max = num(meta.maxOdds, 100);
    if (parsed.odds < min || parsed.odds > max) {
      const range = `${frOddsText(min)} à ${frOddsText(max)}`;
      if ((state.outOfRange ?? 0) >= 1) {
        await saveState(deps, req, { ...state, unavailable: true, reason: `cote ${frOddsText(parsed.odds)} hors de la fourchette (${range})` });
        await respondToRequest(deps, req, HUMAN_ODDS_UNAVAILABLE, input.actor, { deferNext: true });
        return { handled: true, closed: true, reply: `La cote ${frOddsText(parsed.odds)} reste hors de la fourchette (${range}) : je laisse tomber ce pari.` };
      }
      await saveState(deps, req, { ...state, outOfRange: 1 });
      return {
        handled: true,
        reply: `La cote ${frOddsText(parsed.odds)} sort de la fourchette de la catégorie (${range}). Vérifie-la et renvoie la bonne cote, ou réponds « pas dispo ».`,
      };
    }
    state.odds = parsed.odds;
  }
  await saveState(deps, req, state);
  if (state.assetId && typeof state.odds === "number") {
    const r = await respondToRequest(deps, req, HUMAN_ODDS_DONE, input.actor, { deferNext: true });
    if (!r.ok) return { handled: true, reply: r.message };
    await agentEvent(deps, "agents.sports.human_odds_received", { requestId: req.id, pickId: pick.id, odds: state.odds });
    return { handled: true, closed: true, reply: `Reçu : capture et cote ${frOddsText(state.odds)}. Je prépare le post.` };
  }
  if (state.assetId) return { handled: true, reply: `Capture reçue. Quelle est la cote exacte affichée sur ${site} ? (ex. 1,85)` };
  return { handled: true, reply: `Cote notée : ${frOddsText(state.odds!)}. Envoie-moi maintenant la capture du pari sur ${site}.` };
}

