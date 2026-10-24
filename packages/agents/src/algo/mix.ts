/**
 * Mélange EFFECTIF d'un canal pour l'équipe Algorithme (règle pure) : celui que le Chef de l'équipe applique vraiment.
 * La base garde `{ video: 0, photo: 0, text: 1 }` pour un plan jamais réglé : pour le Casino c'est « non réglé »
 * (2 vidéos / 1 image / 1 texte, `casinoMix`), pour les Rencontres un mélange vide vaut 1 / 2 / 1.
 */
import { casinoMix } from "../casino/format";
import { DATING_DEFAULT_MIX } from "../chiefs/dating-format";
import type { Mix } from "../agents/mediatheque/pick";

/** Une proposition (ou un test A/B) ne déplace jamais le mélange de plus de 10 points d'un coup. */
export const MAX_MIX_POINTS_PER_PROPOSAL = 10;

function parse(v: unknown): Mix | null {
  const r = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
  const m = { video: n(r.video), photo: n(r.photo), text: n(r.text) };
  return m.video + m.photo + m.text > 0 ? m : null;
}

export function effectiveMix(teamKey: string, raw: unknown): Mix {
  const m = parse(raw);
  if (teamKey === "casino") return { ...casinoMix(m) };
  if (teamKey === "dating") return m ?? { ...DATING_DEFAULT_MIX };
  return m ?? { video: 0, photo: 0, text: 1 };
}
