/**
 * Rapport du contrôle d'accessibilité axe (`pnpm a11y`) : mise en forme des résultats, comptes par gravité et pages
 * bloquantes (fonctions pures, testées dans a11y-report.test.ts).
 */
import { IMPACTS, type Impact } from "./options";
import type { CaptureStatus } from "./manifest";

export type PageViolation = {
  id: string;
  impact: Impact | null;
  help: string;
  helpUrl: string;
  /** Nombre d'éléments en faute. */
  nodes: number;
  /** Sélecteurs des 5 premiers éléments. */
  targets: string[];
};

export type A11yPageResult = {
  route: string;
  path: string | null;
  status: CaptureStatus;
  httpStatus: number | null;
  note: string | null;
  violations: PageViolation[];
};

/** Forme minimale d'une violation axe (structure de `axe-core`, sans dépendre de ses types). */
type AxeViolationLike = {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: ReadonlyArray<{ target: ReadonlyArray<unknown> }>;
};

function asImpact(v: unknown): Impact | null {
  return typeof v === "string" && (IMPACTS as readonly string[]).includes(v) ? (v as Impact) : null;
}

export function toPageViolations(violations: readonly AxeViolationLike[]): PageViolation[] {
  return violations.map((v) => ({
    id: v.id,
    impact: asImpact(v.impact),
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.map(String).join(" ")),
  }));
}

/** Vrai si la gravité atteint le seuil (`failOn`) ; une gravité inconnue n'est jamais bloquante. */
export function isBlocking(impact: Impact | null, failOn: Impact): boolean {
  if (!impact) return false;
  return IMPACTS.indexOf(impact) >= IMPACTS.indexOf(failOn);
}

/** Nombre de règles en violation par gravité, toutes pages confondues. */
export function countByImpact(pages: readonly A11yPageResult[]): Record<Impact, number> {
  const out: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const p of pages) for (const v of p.violations) if (v.impact) out[v.impact]++;
  return out;
}

export function blockingPages(pages: readonly A11yPageResult[], failOn: Impact): A11yPageResult[] {
  return pages.filter((p) => p.violations.some((v) => isBlocking(v.impact, failOn)));
}

const ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];

function statusText(p: A11yPageResult): string | null {
  if (p.status === "absent") return `absente (${p.httpStatus ?? 404})`;
  if (p.status === "redirect") return `redirection${p.note ? ` (${p.note})` : ""}`;
  if (p.status === "no-id") return "aucun identifiant dans la base locale";
  if (p.status === "error")
    return `erreur${p.httpStatus ? ` ${p.httpStatus}` : ""}${p.note ? ` : ${p.note}` : ""}`;
  return null;
}

/** Résumé en console : une ligne par page, le détail des règles bloquantes, puis le total. */
export function formatSummary(pages: readonly A11yPageResult[], failOn: Impact): string[] {
  const lines: string[] = [];
  for (const p of pages) {
    const st = statusText(p);
    if (st && p.violations.length === 0) {
      lines.push(`${p.route} : ${st}`);
      continue;
    }
    const counts = ORDER.map((i) => [i, p.violations.filter((v) => v.impact === i).length] as const)
      .filter(([, n]) => n > 0)
      .map(([i, n]) => `${n} ${i}`);
    lines.push(`${p.route} : ${counts.length ? counts.join(", ") : "aucune violation"}`);
    for (const v of p.violations.filter((x) => isBlocking(x.impact, failOn)))
      lines.push(
        `    [${v.impact}] ${v.id} (${v.nodes} élément(s)) : ${v.help} — ${v.targets.slice(0, 3).join(" ; ")}`,
      );
  }
  const totals = countByImpact(pages);
  lines.push(
    `Total des règles en violation : ${ORDER.map((i) => `${totals[i]} ${i}`).join(", ")}.`,
    `${blockingPages(pages, failOn).length} page(s) avec une violation « ${failOn} » ou plus grave.`,
  );
  return lines;
}
