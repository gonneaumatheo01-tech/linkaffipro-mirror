/**
 * Affichage de Réglages → Avancé → Retours du casino (postbacks) : fonctions pures, testées.
 * Un « retour du casino » (postback) est un appel automatique du partenaire à chaque inscription, dépôt ou revenu.
 */
import type { PostbackEventType } from "@/lib/postback/parse";
import { fmtDate, fmtNum } from "@/lib/format";

/** Type d'événement enregistré, en mots simples. */
export const EVENT_TYPE_LABELS: Record<PostbackEventType, string> = {
  REGISTRATION: "inscription",
  FTD: "premier dépôt",
  DEPOSIT: "dépôt",
  REDEPOSIT: "nouveau dépôt",
  NGR: "revenu net",
  OTHER: "autre",
};

/** Option de la liste « Événement » du test : valeur reçue du partenaire → ce qu'elle devient chez nous. */
export function eventOptionLabel(received: string, type: PostbackEventType | string): string {
  const label = EVENT_TYPE_LABELS[type as PostbackEventType] ?? String(type).toLowerCase();
  return `${received} → ${label}`;
}

/** Ligne sous le nom d'une adresse : « 12 retours reçus · dernier le 09/10/2026 14:05 ». */
export function receivedSummary(count: number, last: Date | null): string {
  if (count <= 0) return "Aucun retour reçu pour l'instant";
  const n = `${fmtNum(count)} retour${count > 1 ? "s" : ""} reçu${count > 1 ? "s" : ""}`;
  return last ? `${n} · dernier le ${fmtDate(last)}` : n;
}

/** Ligne de l'historique des imports : « 120 lignes · 118 importées · 2 erreurs ». */
export function importSummary(b: { rows: number; imported: number; errors: unknown }): string {
  const errors = Array.isArray(b.errors) ? b.errors.length : 0;
  const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n > 1 ? many : one}`;
  return [
    plural(b.rows, "ligne", "lignes"),
    plural(b.imported, "importée", "importées"),
    plural(errors, "erreur", "erreurs"),
  ].join(" · ");
}
