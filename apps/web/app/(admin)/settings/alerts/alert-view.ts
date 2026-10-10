/** Affichage de Réglages → Alertes (fonctions pures, testées). Libellés des types d'alerte : lib/status/labels.ts. */
import type { PillTone } from "@/components/admin/status-pill";
import { fmtDate, fmtNum } from "@/lib/format";

/** Pastille à côté du titre : « 2 alertes ouvertes » en rouge, « Aucune alerte ouverte » en vert. */
export function openAlertsPill(count: number): { tone: PillTone; label: string } {
  if (count <= 0) return { tone: "success", label: "Aucune alerte ouverte" };
  return {
    tone: "danger",
    label: `${fmtNum(count)} alerte${count > 1 ? "s" : ""} ouverte${count > 1 ? "s" : ""}`,
  };
}

/** Durée de conservation enregistrée (`Setting` `retention.months`) ; 24 mois par défaut. */
export function retentionMonths(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 24) || 24;
}

/** Phrase « Dernière purge » à partir de l'entrée du journal `maintenance.purge` (ou son absence). */
export function purgeSummary(
  last: { createdAt: Date; metadata: unknown } | null | undefined,
): string {
  if (!last) return "Aucune purge pour l'instant : la première aura lieu cette nuit.";
  const m = (last.metadata ?? {}) as { membersAnonymized?: number; eventsDeleted?: number };
  const members = m.membersAnonymized ?? 0;
  const events = m.eventsDeleted ?? 0;
  return `Dernière purge le ${fmtDate(last.createdAt)} : ${fmtNum(members)} membre${members > 1 ? "s" : ""} anonymisé${members > 1 ? "s" : ""}, ${fmtNum(events)} événement${events > 1 ? "s" : ""} supprimé${events > 1 ? "s" : ""}.`;
}
