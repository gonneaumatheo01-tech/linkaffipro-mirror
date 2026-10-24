/**
 * Mise en forme du résumé de supervision (`agentsOverview`, phase 25) pour la page `/agents` et la carte « Agents » de
 * l'État du système. Règles pures, testées dans overview-view.test.ts. Le résumé est calculé par le moteur
 * (`packages/agents`) : ici, rien n'est recalculé, on ne fait que choisir les mots, les couleurs et l'ordre.
 */
import type { AgentsOverview, TeamOverview } from "@linkaffipro/agents";
import { fmtMoney } from "@/lib/format";
import { PROVIDER_LABELS } from "./teams";

export type { AgentsOverview, TeamOverview };

/** Libellé d'un poste de dépense (« IA d'écriture », « Vidéos IA »…) ; un poste inconnu garde son nom. */
export function spendLabel(provider: string): string {
  return (PROVIDER_LABELS as Record<string, string>)[provider] ?? provider;
}

export type SpendRow = {
  provider: string;
  label: string;
  /** « 12,30 € sur 50,00 € » ou « 12,30 € (aucun plafond) ». */
  text: string;
  /** « 31,00 € prévus à la fin du mois ». */
  projection: string;
  /** Part du plafond utilisée (0 à 100), `null` sans plafond. */
  pct: number | null;
  /** brand : sous 80 % ; warning : 80 % et plus, ou projection au-dessus du plafond ; danger : plafond atteint. */
  tone: "brand" | "warning" | "danger";
};

const euros = (cents: number) => fmtMoney(cents / 100);

export function spendRows(team: Pick<TeamOverview, "spend">): SpendRow[] {
  return team.spend.map((s) => {
    const cap = s.capCents;
    const pct = cap === null ? null : cap <= 0 ? (s.cents > 0 ? 100 : 0) : Math.min(100, Math.round((s.cents / cap) * 100));
    const over = cap !== null && s.projectedCents > cap;
    const tone: SpendRow["tone"] =
      pct !== null && pct >= 100 ? "danger" : (pct !== null && pct >= 80) || over ? "warning" : "brand";
    return {
      provider: s.provider,
      label: spendLabel(s.provider),
      text: cap === null ? `${euros(s.cents)} (aucun plafond)` : `${euros(s.cents)} sur ${euros(cap)}`,
      projection: `${euros(s.projectedCents)} prévus à la fin du mois${over ? " : au-dessus du plafond" : ""}`,
      pct,
      tone,
    };
  });
}

/** Dépense totale du mois de l'équipe (centimes). */
export function spendTotalCents(team: Pick<TeamOverview, "spend">): number {
  return team.spend.reduce((a, s) => a + s.cents, 0);
}

/** Les six chiffres du jour, dans l'ordre du parcours d'une mission. */
export function todayFigures(t: Pick<TeamOverview, "today">): { key: string; label: string; value: number; tone?: "danger" | "warning" }[] {
  return [
    { key: "created", label: "Créées", value: t.today.created },
    { key: "published", label: "Publiées", value: t.today.published },
    { key: "waiting", label: "En attente", value: t.today.waiting, tone: t.today.waiting > 0 ? "warning" : undefined },
    { key: "rejected", label: "Refusées", value: t.today.rejected },
    { key: "failed", label: "Échouées", value: t.today.failed, tone: t.today.failed > 0 ? "danger" : undefined },
    { key: "fallbacks", label: "Replis", value: t.today.fallbacks },
  ];
}

export const RESULT_COLUMNS = [
  { key: "posts", label: "Posts" },
  { key: "views", label: "Vues" },
  { key: "clicks", label: "Clics" },
  { key: "registrations", label: "Inscriptions" },
  { key: "ftds", label: "Premiers dépôts" },
  { key: "commissions", label: "Commissions" },
] as const;

/** Une équipe a-t-elle publié quelque chose sur 28 jours ? (sinon le tableau des résultats est remplacé par une phrase) */
export function hasResults(t: Pick<TeamOverview, "results">): boolean {
  return t.results.d28.posts > 0;
}

/** État d'un fournisseur pour la carte de l'État du système. */
export function providerState(p: AgentsOverview["health"]["providers"][number]): {
  tone: "success" | "warning" | "danger" | "muted";
  label: string;
} {
  if (!p.keyPresent) return { tone: "muted", label: "Clé absente" };
  if (p.errors24h > 0) return { tone: p.lastOkAt ? "warning" : "danger", label: `${p.errors24h} erreur${p.errors24h > 1 ? "s" : ""} en 24 h` };
  if (!p.lastOkAt) return { tone: "muted", label: "Jamais appelé" };
  return { tone: "success", label: "Fonctionne" };
}

/** Le résumé tient-il quelque chose qui réclame l'équipe humaine ? */
export function needsAttention(o: Pick<AgentsOverview, "pendingValidations" | "openHumanRequests" | "openAlerts">): number {
  return o.pendingValidations + o.openHumanRequests + o.openAlerts;
}

/** Appliqué cette semaine : date « il y a » lisible et tri du plus récent au plus ancien. */
export function sortApplied<T extends { appliedAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
}
