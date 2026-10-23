/** En-tête des posts publiés en simulation sur le canal Test (règle pure). */
import { escapeHtml } from "@linkaffipro/core";
import { TEAM_LABELS, type TeamKey } from "../../types";

export function simulationHeader(teamKey: TeamKey, realChannelTitle: string): string {
  return `[SIMULATION équipe ${TEAM_LABELS[teamKey]} → ${escapeHtml(realChannelTitle)}]`;
}

export function withSimulationHeader(teamKey: TeamKey, realChannelTitle: string, text: string): string {
  return `${simulationHeader(teamKey, realChannelTitle)}\n${text}`;
}
