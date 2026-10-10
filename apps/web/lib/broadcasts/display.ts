/**
 * Affichage des envois à un groupe (liste, fiche, page A/B) : date utile, étiquette du test A/B, résultats en une
 * ligne, progression et actions possibles selon le statut (fonctions pures, testées). Aucune règle d'envoi ici :
 * les actions serveur (`actions.ts`) refont leurs propres contrôles.
 */
import { fmtNum } from "@/lib/format";

export type BroadcastStatusValue = "DRAFT" | "SCHEDULED" | "SENDING" | "SENT" | "CANCELLED";

type Dated = {
  status: string;
  createdAt: Date;
  scheduledAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

/** La date qui compte pour un envoi : prévu le, commencé le, envoyé le, annulé le, sinon créé le. */
export function broadcastDateInfo(b: Dated): { label: string; date: Date } {
  if (b.status === "SCHEDULED" && b.scheduledAt) return { label: "Prévu le", date: b.scheduledAt };
  if (b.status === "SENDING" && b.startedAt) return { label: "Commencé le", date: b.startedAt };
  if (b.status === "SENT")
    return { label: "Envoyé le", date: b.finishedAt ?? b.startedAt ?? b.createdAt };
  if (b.status === "CANCELLED") return { label: "Annulé le", date: b.finishedAt ?? b.createdAt };
  return { label: "Créé le", date: b.createdAt };
}

/** « Test A/B · version A (50 %) », « Test A/B · envoi au reste », ou null hors test. */
export function abLabel(b: {
  abGroupId: string | null;
  abVariant: string | null;
  abSplit: number | null;
}): string | null {
  if (!b.abGroupId) return null;
  if (b.abVariant === "REST") return "Test A/B · envoi au reste";
  return `Test A/B · version ${b.abVariant ?? "?"}${b.abSplit !== null ? ` (${b.abSplit} %)` : ""}`;
}

/** Pas encore parti : brouillon ou programmé. */
export function notLaunched(status: string): boolean {
  return status === "DRAFT" || status === "SCHEDULED";
}

/** Résultats en une ligne : « 1 200 envoyés · 85 ont cliqué » ; « Pas encore parti » avant l'envoi. */
export function resultsLine(b: { status: string; sent: number; uniqueClicks: number }): string {
  if (notLaunched(b.status)) return "Pas encore parti";
  const sent = `${fmtNum(b.sent)} envoyé${b.sent > 1 ? "s" : ""}`;
  const clicked =
    b.uniqueClicks === 0
      ? "aucun clic"
      : `${fmtNum(b.uniqueClicks)} ${b.uniqueClicks > 1 ? "ont" : "a"} cliqué`;
  return `${sent} · ${clicked}`;
}

/** « 980 traités sur 1 240 (79 %) » ; « En préparation… » tant que le nombre de destinataires n'est pas connu. */
export function progressSentence(b: {
  targeted: number;
  sent: number;
  failed: number;
  blocked: number;
}): { done: number; pct: number; sentence: string } {
  const done = b.sent + b.failed + b.blocked;
  const pct = b.targeted > 0 ? Math.min(100, Math.round((done / b.targeted) * 100)) : 0;
  if (b.targeted <= 0) return { done, pct, sentence: "Liste des destinataires en préparation…" };
  return {
    done,
    pct,
    sentence: `${fmtNum(done)} traité${done > 1 ? "s" : ""} sur ${fmtNum(b.targeted)} (${pct} %)`,
  };
}

export type BroadcastActions = {
  /** « Envoyer » (brouillon) ou « Envoyer maintenant » (programmé) : le bouton principal de la fiche. */
  send: boolean;
  /** « Programmer » (brouillon) ou « Changer la date » (programmé). */
  schedule: "Programmer" | "Changer la date" | null;
  /** « Annuler l'envoi » : programmé ou en cours. */
  cancel: boolean;
  /** « Supprimer » : brouillon ou envoi annulé, administrateurs seulement. */
  remove: boolean;
  /** « Envoyer un test à moi » : toujours. */
  test: true;
};

/** Actions de la fiche selon le statut (mêmes conditions que les actions serveur). */
export function broadcastActions(
  status: string,
  role: string | null | undefined,
): BroadcastActions {
  return {
    send: notLaunched(status),
    schedule: status === "DRAFT" ? "Programmer" : status === "SCHEDULED" ? "Changer la date" : null,
    cancel: status === "SCHEDULED" || status === "SENDING",
    remove: role === "ADMIN" && (status === "DRAFT" || status === "CANCELLED"),
    test: true,
  };
}

/** Libellé du bouton principal de la fiche. */
export function sendLabel(status: string): string {
  return status === "SCHEDULED" ? "Envoyer maintenant" : "Envoyer";
}

/** Taux de clic affiché (« 7,1 % ») : personnes ayant cliqué / messages envoyés. */
export function clickRate(sent: number, uniqueClicks: number): string {
  if (sent <= 0) return "—";
  return `${((uniqueClicks / sent) * 100).toFixed(1).replace(".", ",")} %`;
}

/**
 * Colonne d'une version dans la comparaison A/B : en-tête court sur téléphone (« A », « B », « Reste ») pour que
 * le tableau tienne sans défiler, nom complet pour les lecteurs d'écran et sur ordinateur.
 */
export function variantColumn(variant: string | null): { short: string; long: string } {
  if (variant === "REST") return { short: "Reste", long: "Reste du groupe" };
  const v = variant ?? "?";
  return { short: v, long: `Version ${v}` };
}
