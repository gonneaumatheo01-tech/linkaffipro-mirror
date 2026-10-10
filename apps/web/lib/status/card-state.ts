/**
 * Briques communes aux pastilles de Réglages (settings-cards.ts) et aux tuiles d'État du système (health.ts) :
 * type de pastille, pluriel français, état de la synchro Link Affi. Fichier à part pour que les deux modules
 * s'importent sans boucle (settings-cards.ts reprend les tuiles de health.ts).
 */
import type { PillTone } from "@/components/admin/status-pill";
import { fmtRelative } from "@/lib/format";

/** Pastille d'une carte : nuance, texte court, précision au survol facultative. */
export type CardState = { tone: PillTone; label: string; title?: string };

/** Au-delà, la synchro Link Affi (toutes les 2 minutes) est en retard. */
export const LINKAFFI_STALE_MS = 15 * 60_000;

/** « 1 compte », « 3 comptes » (le pluriel est passé en entier : « 2 alertes ouvertes »). */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? many : one}`;
}

/** Link Affi : en échec, pas encore synchronisé, en retard ou « synchronisé il y a 2 min ». */
export function linkAffiState(
  sync: ReadonlyArray<{ lastSuccessAt: Date | null; lastError: string | null }> | null,
  now: Date,
): CardState | undefined {
  if (!sync) return undefined;
  if (sync.length === 0) return { tone: "muted", label: "Pas encore synchronisé" };
  const failing = sync.filter((s) => s.lastError).length;
  if (failing > 0)
    return {
      tone: "danger",
      label: "Synchro en échec",
      title:
        failing === 1 ? "1 donnée Link Affi en erreur" : `${failing} données Link Affi en erreur`,
    };
  const last = sync.reduce<Date | null>(
    (acc, s) => (s.lastSuccessAt && (!acc || s.lastSuccessAt > acc) ? s.lastSuccessAt : acc),
    null,
  );
  if (!last) return { tone: "muted", label: "Pas encore synchronisé" };
  const label = `Synchronisé ${fmtRelative(last, now)}`;
  return now.getTime() - last.getTime() > LINKAFFI_STALE_MS
    ? { tone: "warning", label, title: "La synchro passe normalement toutes les 2 minutes." }
    : { tone: "success", label };
}
