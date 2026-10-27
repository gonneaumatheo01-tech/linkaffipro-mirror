/**
 * Phase 31 — fiche d'un canal de la Prospection : boutons de statut permis (table des transitions de l'équipe, gestes
 * du client seulement) et chronologie en français (`ProspectEvent`). Règles pures.
 */
import { STATUS_TRANSITIONS, type ProspectStatus } from "@linkaffipro/agents";
import { statusLabel } from "@/lib/status-badges";
import { DEAL_TYPE_LABELS } from "./display";

/** Ordre des boutons sur la fiche. */
const ORDER = ["CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE", "CHURNED", "QUALIFIED", "SKIPPED", "BLACKLISTED"];

/** Statuts qu'un client peut donner depuis ce statut (jamais ceux réservés à l'équipe : lecture, note). */
export function clientTargets(from: string): string[] {
  const list = STATUS_TRANSITIONS[from as ProspectStatus] ?? [];
  return list
    .filter((t) => t.by === "client" || t.by === "both")
    .map((t) => t.to as string)
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

const BUTTONS: Record<string, string> = {
  CONTACTED: "Contacté",
  RESPONDED: "A répondu",
  NEGOTIATING: "En discussion",
  SIGNED: "Signé",
  ACTIVE: "Actif",
  CHURNED: "A arrêté",
  QUALIFIED: "Remettre à contacter",
  SKIPPED: "Pas intéressé",
  BLACKLISTED: "Ne plus montrer",
};

export function statusButtonLabel(status: string): string {
  return BUTTONS[status] ?? statusLabel("prospectStatus", status);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Une ligne de chronologie. */
export function eventText(type: string, payload: unknown): string {
  const p = isObj(payload) ? payload : {};
  const by = p.by === "system" ? " (par l'équipe)" : p.by === "client" ? (p.via === "TELEGRAM" ? " (par vous, avec Kevin)" : " (par vous)") : "";
  switch (type) {
    case "DISCOVERED":
      return "Trouvé";
    case "ENRICHED":
      return "Lu par l'équipe";
    case "SCORED":
      return typeof p.score === "number" ? `Noté ${p.score} / 100${typeof p.tier === "string" ? ` (niveau ${p.tier})` : ""}` : "Noté";
    case "PRESENTED":
      return "Montré dans la liste du matin";
    case "STATUS_CHANGED": {
      const from = typeof p.from === "string" ? statusLabel("prospectStatus", p.from) : "?";
      const to = typeof p.to === "string" ? statusLabel("prospectStatus", p.to) : "?";
      const deal = typeof p.dealType === "string" ? ` · ${DEAL_TYPE_LABELS[p.dealType] ?? p.dealType}` : "";
      return `${from} → ${to}${deal}${by}`;
    }
    case "SNOOZED":
      return `Remis à plus tard${typeof p.days === "number" ? ` (${p.days} jours)` : ""}`;
    case "NOTE":
      return `Note ajoutée${p.by === "client" ? "" : " par l'équipe"}`;
    case "REMINDER":
      return "Rappel envoyé par Kevin";
    case "DOSSIER":
      return "Dossier rédigé";
    case "ALERT":
      return "Alerte";
    default:
      return type.toLowerCase().replace(/_/g, " ");
  }
}
