/**
 * Réglages de la capture dans `AgentTeamConfig.settings.sports` (équipe Paris sportifs, sans migration) :
 * - `captureMode` : `server` (défaut, navigateur du worker, proxy s'il est réglé) ou `mac` (capture faite par
 *   `pnpm agents:capture-runner` sur le Mac du client) ;
 * - `bookmakerSites.<clé>` : corrections de l'adaptateur (adresse, domaines, sélecteurs) sans redéploiement ;
 * - `captureWaitMinutes` : attente maximale d'une capture demandée au Mac (20 min par défaut) avant l'image de repli.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";

export type CaptureMode = "server" | "mac";

export type CaptureSettings = {
  mode: CaptureMode;
  bookmakerSites: Record<string, unknown>;
  waitMinutes: number;
};

export const DEFAULT_CAPTURE_WAIT_MINUTES = 20;

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Pur : réglages de capture depuis `AgentTeamConfig.settings` de l'équipe Paris (ou `TeamSettings.settings`). */
export function parseCaptureSettings(teamSettings: unknown): CaptureSettings {
  const sports = record(record(teamSettings).sports);
  const wait = Number(sports.captureWaitMinutes);
  return {
    mode: sports.captureMode === "mac" ? "mac" : "server",
    bookmakerSites: record(sports.bookmakerSites),
    waitMinutes: Number.isFinite(wait) && wait >= 2 && wait <= 240 ? wait : DEFAULT_CAPTURE_WAIT_MINUTES,
  };
}

export async function loadCaptureSettings(prisma: PrismaClient): Promise<CaptureSettings> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "sports" } });
  return parseCaptureSettings(row?.settings);
}

/** Bascule serveur / Mac (réponse du client à « adresse IP résidentielle ou Mac ») ; autres réglages conservés. */
export async function setCaptureMode(prisma: PrismaClient, mode: CaptureMode): Promise<void> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "sports" } });
  if (!row) return;
  const settings = { ...record(row.settings) };
  settings.sports = { ...record(settings.sports), captureMode: mode };
  await prisma.agentTeamConfig.update({ where: { teamKey: "sports" }, data: { settings: settings as never } });
}
