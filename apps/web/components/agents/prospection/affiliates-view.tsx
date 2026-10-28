import Link from "next/link";
import { linkAffiliateAction } from "@/app/(admin)/agents/prospection/advanced-actions";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALERTS_PATH, alertKindLabel, estimateVsReal, evidenceText, missingResultsText, monthLabel, valueRangeText } from "@/lib/agents/prospection/advanced";
import type { AffiliateRow } from "@/lib/agents/prospection/advanced-queries";
import { channelName, prospectHref } from "@/lib/agents/prospection/display";
import { dealText } from "@/lib/agents/prospection/offers";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

const n = (v: number | null) => (v === null ? "—" : fmtNum(v));

function deal(row: AffiliateRow): string {
  const t = (row.dealTerms ?? {}) as Record<string, unknown>;
  const d = dealText(row.dealType === "HYBRID" && t.cpa !== undefined && t.revshare !== undefined ? { hybrid: { cpa: t.cpa, revshare: t.revshare } } : t);
  return d === "Aucune condition" ? "Conditions non notées" : d;
}

/**
 * Vue « Affiliés signés » (phase 32) : les canaux signés, actifs ou arrêtés, leur identifiant d'affilié Link Affi (à
 * rattacher ici ou par Kevin : « @x = affilié 1234 »), leurs vrais résultats par mois lus dans Link Affi (lecture seule ;
 * ce qui manque est dit, jamais estimé), l'estimation comparée au réel, et les alertes de suivi (nos liens absents,
 * concurrent, phrase à risque, silence). Information, jamais sanction : l'équipe n'écrit à personne.
 */
export function AffiliatesView({ rows, back }: { rows: AffiliateRow[]; back: string }) {
  if (!rows.length)
    return <EmptyState title="Aucun affilié signé pour l'instant" description="Quand vous notez qu'un canal a signé, il apparaît ici avec ses vrais résultats, une fois rattaché à son identifiant Link Affi." />;
  return (
    <ul className="space-y-4" aria-label="Affiliés signés">
      {rows.map((r) => {
        const last = r.results[0] ?? null;
        const cmp = estimateVsReal(r.estimate, last?.revenueCents ?? null);
        return (
          <li key={r.id} className="space-y-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={prospectHref(r.id)} className="font-medium text-info underline underline-offset-4">
                {r.username ? `@${r.username}` : channelName(r)}
              </Link>
              <StatusBadge kind="prospectStatus" value={r.status} />
              {r.tier ? <StatusBadge kind="prospectTier" value={r.tier} /> : null}
              <span className="text-note text-muted-foreground">
                {r.signedAt ? `Signé le ${fmtDate(r.signedAt)}` : "Date de signature inconnue"} · {deal(r)}
              </span>
            </div>

            {r.linkAffiAffiliateId ? (
              <p className="text-note">
                Affilié Link Affi <span className="font-medium tabular-nums">{r.linkAffiAffiliateId}</span>
                {r.linkAffiLinkedAt ? ` · rattaché le ${fmtDate(r.linkAffiLinkedAt)}` : ""}
              </p>
            ) : (
              <form action={linkAffiliateAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="prospectId" value={r.id} />
                <input type="hidden" name="back" value={back} />
                <div className="space-y-1">
                  <Label htmlFor={`aff-${r.id}`}>Identifiant d&apos;affilié Link Affi</Label>
                  <Input id={`aff-${r.id}`} name="affiliateId" required placeholder="1234" autoComplete="off" className="w-40" />
                </div>
                <Button type="submit" size="sm" variant="secondary" className="max-md:h-10">
                  Rattacher
                </Button>
                <span className="text-note text-muted-foreground">Sans identifiant, ses vrais résultats ne peuvent pas être lus.</span>
              </form>
            )}

            {r.results.length ? (
              <Table label={`Résultats de ${r.username ? `@${r.username}` : channelName(r)} par mois`}>
                <TableCaption className="sr-only">Résultats réels par mois, lus dans Link Affi</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mois</TableHead>
                    <TableHead numeric>Clics</TableHead>
                    <TableHead numeric>Inscriptions</TableHead>
                    <TableHead numeric>Premiers dépôts</TableHead>
                    <TableHead numeric>Revenus</TableHead>
                    <TableHead>Remarque</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.results.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{monthLabel(m.month)}</TableCell>
                      <TableCell numeric>{n(m.clicks)}</TableCell>
                      <TableCell numeric>{n(m.regs)}</TableCell>
                      <TableCell numeric>{n(m.ftd)}</TableCell>
                      <TableCell numeric>{m.revenueCents === null ? "—" : fmtMoney(m.revenueCents / 100, "EUR", { digits: 0 })}</TableCell>
                      <TableCell className="text-note text-muted-foreground">{missingResultsText(m.missing) ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : r.linkAffiAffiliateId ? (
              <p className="text-note text-muted-foreground">Pas encore de résultats lus : ils arrivent au prochain passage mensuel.</p>
            ) : null}

            <p className="text-note">
              <span className="text-muted-foreground">Estimé : </span>
              {r.estimate ? valueRangeText(r.estimate) : "pas d'estimation"}
              {last ? (
                <>
                  <span className="text-muted-foreground"> · Réel ({monthLabel(last.month)}) : </span>
                  {cmp.text}
                </>
              ) : null}
            </p>

            {r.alerts.length ? (
              <ul className="space-y-1 text-note" aria-label="Alertes de suivi">
                {r.alerts.map((a) => {
                  const proof = evidenceText(a.evidence);
                  return (
                    <li key={a.id}>
                      <span className="font-medium">{alertKindLabel(a.kind)}</span> · {fmtDate(a.createdAt)}
                      {proof ? <span className="italic"> : « {proof} »</span> : null}
                    </li>
                  );
                })}
                <li>
                  <Link href={`${ALERTS_PATH}?famille=affiliate`} className="text-info underline underline-offset-4">
                    Toutes les alertes des affiliés
                  </Link>
                </li>
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
