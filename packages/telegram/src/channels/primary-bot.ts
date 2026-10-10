/**
 * Choix du bot principal d'un canal créé automatiquement, et comparaison des droits d'administrateur.
 * Fonctions pures (testées) ; l'accès base est dans `prisma-deps.ts`.
 */

type BotLite = { id: string; vertical: string };

export type PrimaryBotChoice = {
  botId: string;
  reason: "same_vertical" | "detector_admin" | "first_admin" | "detector";
};

/**
 * Bot principal d'un canal qui n'en a pas encore, par ordre de préférence :
 * 1. un bot administrateur du même univers que le canal (si l'univers est déjà connu) ;
 * 2. le bot qui a détecté le canal, s'il en est administrateur ;
 * 3. le premier bot administrateur (le plus ancien) ;
 * 4. le bot qui a détecté le canal (le canal attend qu'on l'ajoute comme administrateur) ;
 * sinon aucun.
 */
export function choosePrimaryBot(input: {
  channelVertical: string | null;
  detector: BotLite | null;
  admins: BotLite[];
}): PrimaryBotChoice | null {
  const { channelVertical, detector, admins } = input;
  if (channelVertical) {
    const same = admins.find((a) => a.vertical === channelVertical);
    if (same) return { botId: same.id, reason: "same_vertical" };
  }
  if (detector && admins.some((a) => a.id === detector.id))
    return { botId: detector.id, reason: "detector_admin" };
  const first = admins[0];
  if (first) return { botId: first.id, reason: "first_admin" };
  if (detector) return { botId: detector.id, reason: "detector" };
  return null;
}

function normalize(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // `false` et absent reviennent au même (Telegram omet parfois les droits facultatifs).
    if (v === undefined || v === null || v === false) continue;
    out[k] = v;
  }
  return out;
}

/** Les droits enregistrés (JSON en base) sont-ils identiques aux droits lus chez Telegram ? (ordre des clés indifférent) */
export function sameRights(stored: unknown, current: unknown): boolean {
  const a = normalize(stored);
  const b = normalize(current);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}
