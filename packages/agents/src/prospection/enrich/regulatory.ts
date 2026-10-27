/**
 * Phase 31, chantier B — signal réglementaire (section 3.11, règle 9 : pas de conseil juridique).
 *
 * Pour le premier pays et la verticale du canal, cherche une `ComplianceRule` de la phase 29, active, à risque HIGH ou
 * BAN, de nature RÉGLEMENTAIRE : règle hors plateforme publicitaire (`platform = OTHER`) ou née d'une entrée de veille
 * de catégorie `REGULATION`. Les règles publicitaires de Meta / TikTok ne disent rien du pays : ignorées ici.
 * Texte court « FR : <règle> (règle #id) ». Jamais « légal » / « illégal » : une règle dont le texte en parle est
 * remplacée par une formule neutre (le dossier ajoute « vérifie avec un avocat »).
 */
import type { ProspectionDeps, ProspectVertical } from "../contract";

const RISK_ORDER: Record<string, number> = { BAN: 0, HIGH: 1 };
const RULE_MAX = 90;
const LEGAL_WORDS = /\b(il)?l[ée]gal(e|es|ement|it[ée])?\b|\billegal\b|\blegal\b|\blicite\b|\billicite\b|\binterdit par la loi\b/i;

/** Marchés de la phase 29 couverts par une verticale de prospection. */
export function marketsOfVertical(vertical: ProspectVertical): Array<"CASINO" | "SPORTS"> {
  if (vertical === "CASINO") return ["CASINO"];
  if (vertical === "SPORTS") return ["SPORTS"];
  if (vertical === "BOTH") return ["CASINO", "SPORTS"];
  return [];
}

const MARKET_LABEL: Record<string, string> = { CASINO: "casino en ligne", SPORTS: "paris sportifs" };

/** Texte court et neutre d'une règle. */
export function regulatoryText(country: string, rule: { id: string; rule: string; market: string; riskLevel: string }): string {
  let body = rule.rule.replace(/\s+/g, " ").trim();
  if (!body || LEGAL_WORDS.test(body)) body = `${MARKET_LABEL[rule.market] ?? "jeux d'argent"} : règle à risque ${rule.riskLevel === "BAN" ? "très élevé" : "élevé"} signalée`;
  if (body.length > RULE_MAX) {
    const cut = body.slice(0, RULE_MAX - 1);
    const sp = cut.lastIndexOf(" ");
    body = `${(sp > RULE_MAX * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
  }
  return `${country} : ${body} (règle #${rule.id})`;
}

/** Signal réglementaire du pays pour la verticale, ou null. */
export async function regulatoryFlagFor(deps: ProspectionDeps, country: string | null, vertical: ProspectVertical): Promise<string | null> {
  const markets = marketsOfVertical(vertical);
  if (!country || !markets.length) return null;
  const code = country.toUpperCase();
  let rules: Array<{ id: string; rule: string; market: string; riskLevel: string; platform: string; sourceEntryId: string | null; lastVerifiedAt: Date }>;
  try {
    rules = (await deps.prisma.complianceRule.findMany({
      where: { country: code, isActive: true, riskLevel: { in: ["HIGH", "BAN"] }, market: { in: markets } },
    })) as typeof rules;
  } catch {
    return null;
  }
  if (!rules.length) return null;
  const entryIds = rules.map((r) => r.sourceEntryId).filter((x): x is string => !!x);
  const regulationEntries = new Set<string>();
  if (entryIds.length) {
    try {
      const entries = await deps.prisma.trendEntry.findMany({ where: { id: { in: entryIds }, category: "REGULATION" }, select: { id: true } });
      for (const e of entries) regulationEntries.add(e.id);
    } catch {
      /* veille absente : seules les règles hors plateforme comptent */
    }
  }
  const regulatory = rules.filter((r) => r.platform === "OTHER" || (r.sourceEntryId && regulationEntries.has(r.sourceEntryId)));
  if (!regulatory.length) return null;
  regulatory.sort((a, b) => (RISK_ORDER[a.riskLevel] ?? 9) - (RISK_ORDER[b.riskLevel] ?? 9) || b.lastVerifiedAt.getTime() - a.lastVerifiedAt.getTime());
  return regulatoryText(code, regulatory[0]!);
}
