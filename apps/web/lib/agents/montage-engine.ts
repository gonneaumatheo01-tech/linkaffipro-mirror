/**
 * Fonctions de l'équipe Montage (phase 28) appelées par le site, chargées à la demande et tolérantes : la page marche
 * avant comme après la livraison de la chaîne (chantier D) et de Kevin (chantier E). Une fonction absente vaut
 * `undefined` ; les boutons répondent alors « pas encore disponible » et la lecture d'un short renvoie vers Telegram.
 *
 * - `decideShort(deps, clipId, "ok" | "no", actor, comment?)` (Kevin) : MÊME effet que les boutons ✅ / ❌ de l'aperçu ;
 * - `redoClip(deps, clipId, change)` (chaîne) : modification demandée (« raccourcis de 2 secondes »), short refait ;
 * - `cancelJob(deps, jobId, actor)` (chaîne) : montage annulé, shorts pas encore faits abandonnés ;
 * - `resolveAssetBytes(deps, assetId)` (chaîne) : octets d'un média gardé dans Telegram.
 */
import type { ActorRef, AgentsDeps } from "@linkaffipro/agents";

export type MontageEngine = {
  decideShort?: (deps: AgentsDeps, clipId: string, decision: "ok" | "no", actor: ActorRef, comment?: string | null) => Promise<unknown>;
  redoClip?: (deps: AgentsDeps, clipId: string, change: string, actor?: ActorRef) => Promise<unknown>;
  cancelJob?: (deps: AgentsDeps, jobId: string, actor?: ActorRef) => Promise<unknown>;
  resolveAssetBytes?: (deps: AgentsDeps, assetId: string) => Promise<unknown>;
};

const NAMES = ["decideShort", "redoClip", "cancelJob", "resolveAssetBytes"] as const;

export async function loadMontageEngine(): Promise<MontageEngine> {
  const mod = (await import("@linkaffipro/agents")) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const n of NAMES) if (typeof mod[n] === "function") out[n] = mod[n];
  return out as MontageEngine;
}

/**
 * Octets rendus par `resolveAssetBytes`, quelle que soit leur forme (tableau d'octets, `{ bytes }`, `{ buffer }`), ou
 * `"too_big"` quand le fichier dépasse ce qu'un bot peut récupérer, ou null.
 */
export function bytesOf(r: unknown): Uint8Array | "too_big" | null {
  if (r instanceof Uint8Array) return r;
  if (r instanceof ArrayBuffer) return new Uint8Array(r);
  if (typeof r === "object" && r !== null) {
    const o = r as Record<string, unknown>;
    if (o.tooBig === true || o.code === "too_big" || o.error === "too_big") return "too_big";
    for (const k of ["bytes", "buffer", "data"]) {
      const v = o[k];
      if (v instanceof Uint8Array) return v;
      if (v instanceof ArrayBuffer) return new Uint8Array(v);
    }
  }
  return null;
}
