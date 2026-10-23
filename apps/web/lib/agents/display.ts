/**
 * Phrases et pastilles de la rubrique Agents (pur, testé dans display.test.ts) : état d'une équipe (simulation,
 * pause, niveau), dépense du mois face au plafond.
 */
import type { PillTone } from "@/components/admin/status-pill";
import { fmtMoney } from "@/lib/format";
import type { TeamConfigView } from "./config";

export type Pill = { tone: PillTone; label: string; title?: string };

/** Pastilles d'une équipe, de la plus importante à la moins importante. */
export function teamPills(c: TeamConfigView, pausedAll: boolean): Pill[] {
  const out: Pill[] = [];
  if (pausedAll) out.push({ tone: "danger", label: "Pause générale", title: "Toutes les équipes sont arrêtées." });
  else if (c.paused)
    out.push({ tone: "danger", label: "En pause", title: c.pausedReason ?? "Mise en pause par l'équipe." });
  else if (!c.enabled) out.push({ tone: "muted", label: "Désactivée" });
  else out.push({ tone: "success", label: "Active" });
  out.push(
    c.simulation
      ? { tone: "warning", label: "Simulation", title: "Tout part sur le canal Test, jamais sur un vrai canal." }
      : { tone: "info", label: "Vrais canaux", title: "Les posts partent sur les vrais canaux de l'équipe." },
  );
  out.push({ tone: "neutral", label: `Niveau ${c.autonomyLevel}` });
  return out;
}

/** La phrase qui dit où partent les posts de l'équipe. */
export function simulationSentence(c: Pick<TeamConfigView, "simulation">): string {
  return c.simulation
    ? "Simulation : chaque post part sur le canal Test, avec en tête le nom du vrai canal visé."
    : "Les posts partent sur les vrais canaux de l'équipe.";
}

export type SpendView = { text: string; pct: number; tone: "brand" | "warning" | "danger"; capCents: number | null };

/** Dépense du mois face à la somme des plafonds (« 12,30 € sur 50,00 € ») ; sans plafond saisi, la dépense seule. */
export function spendView(spentCents: number, budgets: Partial<Record<string, number>>): SpendView {
  const caps = Object.values(budgets).filter((n): n is number => typeof n === "number");
  const capCents = caps.length ? caps.reduce((a, n) => a + n, 0) : null;
  const spent = fmtMoney(spentCents / 100);
  if (capCents === null) return { text: `${spent} ce mois (aucun plafond saisi)`, pct: 0, tone: "brand", capCents };
  const pct = capCents === 0 ? (spentCents > 0 ? 100 : 0) : Math.min(100, Math.round((spentCents / capCents) * 100));
  const tone = pct >= 100 ? "danger" : pct >= 80 ? "warning" : "brand";
  return { text: `${spent} sur ${fmtMoney(capCents / 100)} ce mois`, pct, tone, capCents };
}
