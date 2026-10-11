/**
 * Libellés en français des éléments techniques montrés dans Réglages → Connexions et Réglages → État du système :
 * données lues chez Link Affi, files de tâches du service d'arrière-plan, types d'alerte. Le nom technique reste
 * visible dans le détail (volet ou bloc « Avancé ») ; un nom inconnu garde un libellé lisible.
 */

// Dictionnaires partagés avec le worker (alertes et rapports Telegram) : `packages/core/src/team-labels.ts`.
export {
  ALERT_KIND_LABELS,
  LINKAFFI_TABLE_LABELS,
  QUEUE_LABELS,
  alertKindLabel,
  linkAffiTableLabel,
  queueLabel,
} from "@linkaffipro/core";

/** Taille d'un fichier en français (« 12,4 Mo », « 512 Ko », « 80 o »). */
export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024)
    return `${(n / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024).toLocaleString("fr-FR")} Ko`;
  return `${n} o`;
}

/** Âge d'un battement en secondes, en français (« il y a 20 s », « il y a 3 min », « il y a 2 h ») ; « — » sinon. */
export function fmtAgeSec(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `il y a ${sec} s`;
  if (sec < 3600) return `il y a ${Math.round(sec / 60)} min`;
  return `il y a ${Math.round(sec / 3600)} h`;
}
