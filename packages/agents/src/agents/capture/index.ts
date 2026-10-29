/**
 * Agent Capture (équipe Paris) : depuis le 28 octobre 2026, plus aucune capture automatique des sites des bookmakers
 * (lecture des sites retirée, décision du client). Pari choisi sur statistiques → l'équipe envoie la capture et la cote
 * exacte par Kevin (`sports/human-odds.ts`). Autre pari (cotes SportsGameOdds) : rien à capturer ici, la Rédaction pose
 * l'image de repli (origine TEMPLATE), TOUJOURS validée par le client.
 */
import type { AgentDefinition, Mission, AgentContext } from "../../types";
import type { PickRow as FullPickRow } from "../../sports/data";
import { humanOddsCaptureStep } from "../../sports/human-odds";
import { isHumanOddsPick } from "../../sports/human-odds-text";

export type CapturePayload = {
  status: "captured" | "fallback" | "skipped";
  assetId?: string | null;
  readOdds?: number | null;
  expectedOdds?: number;
  reason?: string | null;
  /** Image de repli : toujours validée par le client. */
  mustValidate?: boolean;
  via?: "human";
};

type PickRow = {
  id: string;
  bookmaker: string;
  reasoning: unknown;
  screenshotAssetId: string | null;
  status: string;
  oddsLevel?: string | null;
};

async function loadPick(mission: Mission, ctx: AgentContext): Promise<PickRow | null> {
  const id = typeof mission.payload.pickId === "string" ? mission.payload.pickId : null;
  if (id) return (await ctx.prisma.bettingPick.findUnique({ where: { id } })) as PickRow | null;
  return (await ctx.prisma.bettingPick.findFirst({ where: { missionId: mission.id }, orderBy: { createdAt: "desc" } })) as PickRow | null;
}

export const agent: AgentDefinition = {
  key: "capture",
  async run(mission, ctx) {
    const pick = await loadPick(mission, ctx);
    if (!pick) return { ok: false, retryable: false, error: "Aucun pari retenu pour cette mission." };
    if (pick.status !== "PROPOSED") return { ok: true, skipped: true, summary: `pari déjà ${pick.status.toLowerCase()}` };
    if (pick.screenshotAssetId) return { ok: true, output: { mediaAssetId: pick.screenshotAssetId }, summary: "capture déjà faite" };
    // Pari choisi sur statistiques : l'équipe envoie la capture et la cote (Kevin).
    if (isHumanOddsPick(pick)) {
      const r = (pick.reasoning ?? {}) as { targetLabel?: unknown };
      const site = typeof r.targetLabel === "string" && r.targetLabel ? r.targetLabel : pick.bookmaker;
      return humanOddsCaptureStep(mission, ctx, pick as unknown as FullPickRow, site);
    }
    return { ok: true, skipped: true, summary: "pas de capture automatique : image de repli, à valider" };
  },
};
