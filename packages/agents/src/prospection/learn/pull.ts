/**
 * Phase 32, chantier B — résultats réels des affiliés rattachés, lus dans Link Affi en lecture seule (règle 6).
 *
 * Par affilié rattaché et par mois (défaut : mois précédent et mois en cours, heure de Paris) : clics, inscriptions,
 * premiers dépôts, revenus (`deps.linkAffiReader.affiliateStats`, table `stats`) → `AffiliateResult` (un par prospect et
 * par mois, mis à jour). Ce que l'API ne donne pas est noté dans `missing`, jamais estimé. Les mois avant la signature
 * ne sont pas lus.
 * - Premier dépôt réel d'un signé → ACTIVE par la transition de la phase 31 (`transitionProspect`, système).
 * - 60 jours sans clic → arrêt PROPOSÉ seulement (`ProspectEvent CHURN_PROPOSED`, une fois par 30 jours) ; le statut
 *   ne change jamais tout seul.
 * Sans lecteur (variables `LINKAFFI_*` absentes) : rien n'est lu, la boucle dit « Link Affi non configuré ».
 */
import { agentEvent } from "../../admin/journal";
import { CHURN_PROPOSE_AFTER_DAYS } from "../contract-advanced";
import type { ProspectStatus } from "../contract";
import type { ProspectionKevinDeps } from "../kevin-port";
import { transitionProspect } from "../pipeline/status";
import { DAY_MS, prospectionNow } from "../score/settings";
import { parisDay, parisMonth } from "../../rules/time";

type Deps = ProspectionKevinDeps;

export const CHURN_REPEAT_DAYS = 30;

type Linked = { id: string; status: ProspectStatus; linkAffiAffiliateId: string; signedAt: Date | null; linkAffiLinkedAt: Date | null };

/** Mois précédent d'un mois « AAAA-MM ». */
export function previousMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Jours d'un mois « AAAA-MM ». */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Bornes de lecture d'un mois (`from` / `to` inclus, « AAAA-MM-JJ »), arrêtées à aujourd'hui pour le mois en cours. */
export function monthRange(month: string, now: Date): { from: string; to: string } | null {
  const from = `${month}-01`;
  const last = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const today = parisDay(now);
  if (from > today) return null;
  return { from, to: last < today ? last : today };
}

/** Mois à lire : celui demandé, sinon le mois précédent et le mois en cours. */
export function monthsToPull(month: string | null | undefined, now: Date): string[] {
  if (month && /^\d{4}-\d{2}$/.test(month)) return [month];
  const cur = parisMonth(now);
  return [previousMonthOf(cur), cur];
}

export type PullResult = { affiliates: number; rows: number; activated: number; churnProposed: number; errors: number; configured: boolean };

/** Lit les résultats du mois (défaut : mois précédent et mois en cours) pour chaque affilié rattaché. */
export async function pullAffiliateResults(deps: Deps, month?: string | null): Promise<PullResult> {
  const out: PullResult = { affiliates: 0, rows: 0, activated: 0, churnProposed: 0, errors: 0, configured: !!deps.linkAffiReader };
  const reader = deps.linkAffiReader;
  if (!reader) {
    await agentEvent(deps, "prospection.linkaffi.not_configured", { step: "pull" });
    return out;
  }
  const now = prospectionNow(deps);
  const linked = (await deps.prisma.prospect.findMany({ where: { linkAffiAffiliateId: { not: null } } })) as unknown as Linked[];
  for (const p of linked) {
    out.affiliates++;
    const signedMonth = p.signedAt ? parisMonth(p.signedAt) : null;
    for (const m of monthsToPull(month, now)) {
      if (signedMonth && m < signedMonth) continue;
      const range = monthRange(m, now);
      if (!range) continue;
      try {
        const r = await reader.affiliateStats(p.linkAffiAffiliateId, range.from, range.to);
        const data = { clicks: r.clicks, regs: r.regs, ftd: r.ftd, revenueCents: r.revenueCents, missing: [...new Set(r.missing)], source: "linkaffi", pulledAt: now };
        await deps.prisma.affiliateResult.upsert({
          where: { prospectId_month: { prospectId: p.id, month: m } },
          create: { prospectId: p.id, month: m, ...data },
          update: data,
        });
        out.rows++;
      } catch (err) {
        out.errors++;
        deps.logger?.warn({ err: (err as Error).message, prospectId: p.id, month: m }, "[prospection] résultats Link Affi illisibles");
      }
    }
    if (await activateOnFirstFtd(deps, p)) out.activated++;
    if (await proposeChurn(deps, p, now)) out.churnProposed++;
  }
  await agentEvent(deps, "prospection.linkaffi.pulled", { affiliates: out.affiliates, rows: out.rows, activated: out.activated, churnProposed: out.churnProposed, errors: out.errors });
  return out;
}

/** Premier dépôt réel d'un signé → ACTIVE (transition système de la phase 31). */
async function activateOnFirstFtd(deps: Deps, p: Linked): Promise<boolean> {
  if (p.status !== "SIGNED") return false;
  const rows = (await deps.prisma.affiliateResult.findMany({ where: { prospectId: p.id } })) as unknown as Array<{ month: string; ftd: number | null }>;
  const first = rows.filter((r) => (r.ftd ?? 0) > 0).sort((a, b) => a.month.localeCompare(b.month))[0];
  if (!first) return false;
  const r = await transitionProspect(deps, p.id, "ACTIVE", { by: "system", payload: { reason: "premier dépôt", source: "linkaffi", month: first.month } });
  return r.ok;
}

/** 60 jours sans clic : arrêt proposé (jamais posé), une fois par 30 jours. Null si les clics manquent. */
async function proposeChurn(deps: Deps, p: Linked, now: Date): Promise<boolean> {
  if (p.status !== "ACTIVE" && p.status !== "SIGNED") return false;
  const since = p.linkAffiLinkedAt && p.signedAt ? Math.min(p.linkAffiLinkedAt.getTime(), p.signedAt.getTime()) : (p.signedAt ?? p.linkAffiLinkedAt)?.getTime();
  if (!since || now.getTime() - since < CHURN_PROPOSE_AFTER_DAYS * DAY_MS) return false;
  const recent = await deps.prisma.prospectEvent.findFirst({ where: { prospectId: p.id, type: "CHURN_PROPOSED", createdAt: { gte: new Date(now.getTime() - CHURN_REPEAT_DAYS * DAY_MS) } } });
  if (recent) return false;
  let clicks: number | null;
  try {
    const r = await deps.linkAffiReader!.affiliateStats(p.linkAffiAffiliateId, parisDay(new Date(now.getTime() - CHURN_PROPOSE_AFTER_DAYS * DAY_MS)), parisDay(now));
    clicks = r.clicks;
  } catch {
    return false;
  }
  if (clicks === null || clicks > 0) return false;
  await deps.prisma.prospectEvent.create({ data: { prospectId: p.id, type: "CHURN_PROPOSED", payload: { days: CHURN_PROPOSE_AFTER_DAYS, clicks: 0, by: "system" }, createdAt: now } });
  return true;
}

/** Arrêts proposés encore valables (prospect toujours signé ou actif, proposition de moins de 30 jours). */
export async function churnProposals(deps: Pick<Deps, "prisma" | "now" | "clock">): Promise<Array<{ prospectId: string; at: Date }>> {
  const now = prospectionNow(deps);
  const events = (await deps.prisma.prospectEvent.findMany({ where: { type: "CHURN_PROPOSED", createdAt: { gte: new Date(now.getTime() - CHURN_REPEAT_DAYS * DAY_MS) } }, orderBy: { createdAt: "desc" } })) as unknown as Array<{ prospectId: string; createdAt: Date }>;
  const ids = [...new Set(events.map((e) => e.prospectId))];
  if (!ids.length) return [];
  const still = (await deps.prisma.prospect.findMany({ where: { id: { in: ids }, status: { in: ["SIGNED", "ACTIVE"] } } })) as unknown as Array<{ id: string }>;
  const keep = new Set(still.map((s) => s.id));
  return ids.filter((id) => keep.has(id)).map((id) => ({ prospectId: id, at: events.find((e) => e.prospectId === id)!.createdAt }));
}
