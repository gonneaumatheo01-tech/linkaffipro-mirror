import Link from "next/link";
import { applyCalibrationAction, undoCalibrationAction } from "@/app/(admin)/agents/prospection/advanced-actions";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CONFIDENCE_LABELS,
  assumptionLines,
  calibrationBoundsText,
  calibrationNote,
  segmentLabel,
  valueRangeShort,
  valueRangeText,
} from "@/lib/agents/prospection/advanced";
import type { ValuesData } from "@/lib/agents/prospection/advanced-queries";
import { channelName, prospectHref } from "@/lib/agents/prospection/display";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { StatusBadge, statusLabel } from "@/lib/status-badges";

const factor = (n: number) => `× ${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`;

/**
 * Vue « Valeur estimée » (phase 32) : ce que chaque canal pourrait rapporter par mois avec votre offre, TOUJOURS en
 * fourchette (basse – haute, probable) avec sa confiance et ses hypothèses ; la valeur du pipeline par statut ; les
 * coefficients corrigés par les vrais résultats des affiliés signés (par type de canal, avec l'échantillon) ; les
 * propositions de calibrage à appliquer ou non (administrateurs), annulables en un clic.
 */
export function ValueView({ data, isAdmin, back }: { data: ValuesData; isAdmin: boolean; back: string }) {
  const total = data.pipeline.reduce((a, r) => ({ low: a.low + r.low, base: a.base + r.base, high: a.high + r.high, n: a.n + r.estimated }), { low: 0, base: 0, high: 0, n: 0 });
  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-note">
        {data.anyCalibrated
          ? "Une partie des estimations est corrigée par les vrais résultats de vos affiliés signés. Cela reste des estimations : une fourchette, jamais une promesse."
          : "Estimations non calibrées : elles reposent sur des taux moyens, pas encore sur les vrais résultats de vos affiliés. Une fourchette, jamais une promesse."}{" "}
        {data.arpuMonth === null ? "Le revenu moyen par joueur et par mois n'est pas encore donné : la part du revenu n'est pas comptée (seule la prime par joueur l'est)." : `Revenu moyen par joueur et par mois retenu : ${fmtMoney(data.arpuMonth, "EUR", { digits: 0 })}.`}
      </p>

      <FormSection title="Valeur du pipeline" description="Somme des fourchettes des canaux de chaque étape, par mois. Les canaux sans estimation (pas de mesure ou pas d'offre) sont comptés à part.">
        <Table label="Valeur estimée du pipeline par étape">
          <TableCaption className="sr-only">Valeur estimée du pipeline par étape</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Étape</TableHead>
              <TableHead numeric>Canaux</TableHead>
              <TableHead numeric>Estimés</TableHead>
              <TableHead>Fourchette par mois</TableHead>
              <TableHead numeric>Probable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.pipeline.map((r) => (
              <TableRow key={r.status}>
                <TableCell>{statusLabel("prospectStatus", r.status)}</TableCell>
                <TableCell numeric>{fmtNum(r.count)}</TableCell>
                <TableCell numeric>{fmtNum(r.estimated)}</TableCell>
                <TableCell className="tabular-nums">{r.estimated ? valueRangeShort(r) : "—"}</TableCell>
                <TableCell numeric>{r.estimated ? fmtMoney(Math.round(r.base), "EUR", { digits: 0 }) : "—"}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">Total</TableCell>
              <TableCell numeric>{fmtNum(data.pipeline.reduce((a, r) => a + r.count, 0))}</TableCell>
              <TableCell numeric>{fmtNum(total.n)}</TableCell>
              <TableCell className="tabular-nums font-medium">{total.n ? valueRangeShort(total) : "—"}</TableCell>
              <TableCell numeric>{total.n ? fmtMoney(Math.round(total.base), "EUR", { digits: 0 }) : "—"}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </FormSection>

      <FormSection title="Canaux par valeur" description={`Les ${fmtNum(data.top.length)} canaux à la valeur probable la plus haute (sur ${fmtNum(data.valuedCount)} estimés). Ouvrez « Hypothèses » pour voir le calcul.`}>
        {!data.top.length ? (
          <EmptyState title="Aucune estimation pour l'instant" description="La valeur est calculée chaque jour pour les canaux notés qui correspondent à une de vos offres." />
        ) : (
          <ul className="space-y-2" aria-label="Canaux par valeur estimée">
            {data.top.map((p) => {
              const e = p.estimate!;
              return (
                <li key={p.id} className="space-y-1 rounded-xl border border-border bg-card px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={prospectHref(p.id)} className="text-info underline underline-offset-4">
                      {p.username ? `@${p.username}` : channelName(p)}
                    </Link>
                    {p.tier ? <StatusBadge kind="prospectTier" value={p.tier} /> : null}
                    <StatusBadge kind="prospectStatus" value={p.status} />
                    <span className="ml-auto text-note tabular-nums">{valueRangeText(e)}</span>
                  </div>
                  <details className="text-note">
                    <summary className="cursor-pointer text-muted-foreground">
                      Hypothèses · {CONFIDENCE_LABELS[e.confidence]} · {calibrationNote(e)}
                    </summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {assumptionLines(e).map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </FormSection>

      <FormSection
        id="calibrage"
        title="Calibrage"
        description="Chaque mois, l'équipe compare ses estimations aux vrais résultats de vos affiliés signés, lus dans Link Affi, et vous propose de corriger ses taux. Rien ne change sans votre choix."
      >
        <div className="space-y-4">
          {!data.calibrations.length ? (
            <p className="text-note text-muted-foreground">Aucun coefficient corrigé : toutes les estimations utilisent les taux moyens.</p>
          ) : (
            <Table label="Coefficients par type de canal">
              <TableCaption className="sr-only">Coefficients de calibrage par type de canal</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Type de canal</TableHead>
                  <TableHead numeric>Clics</TableHead>
                  <TableHead numeric>Premiers dépôts</TableHead>
                  <TableHead numeric>Affiliés comparés</TableHead>
                  <TableHead>Période</TableHead>
                  <TableHead>Origine</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.calibrations.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-note">{segmentLabel(c.segment)}</TableCell>
                    <TableCell numeric>{factor(c.ctrFactor)}</TableCell>
                    <TableCell numeric>{factor(c.ftdFactor)}</TableCell>
                    <TableCell numeric>{fmtNum(c.sample)}</TableCell>
                    <TableCell className="text-note">{c.periodStart && c.periodEnd ? `${fmtDate(c.periodStart)} – ${fmtDate(c.periodEnd)}` : "—"}</TableCell>
                    <TableCell className="text-note">{c.source === "calibrated" ? "Vrais résultats" : "Taux moyens"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="space-y-2">
            <h3 className="font-medium">Propositions en cours</h3>
            <p className="text-note text-muted-foreground">{calibrationBoundsText()}</p>
            {!data.proposals.length ? (
              <p className="text-note text-muted-foreground">Aucune proposition en cours.</p>
            ) : (
              <form action={applyCalibrationAction} className="space-y-2">
                <input type="hidden" name="back" value={back} />
                <ul className="space-y-2">
                  {data.proposals.map((p) => (
                    <li key={p.id} className="flex items-start gap-2 rounded-xl border border-border bg-card px-4 py-2 text-note">
                      {isAdmin ? <input type="checkbox" id={`cal-${p.id}`} name="ids" value={p.id} className="mt-1 size-4" /> : null}
                      <label htmlFor={isAdmin ? `cal-${p.id}` : undefined} className="space-y-0.5">
                        <span className="block font-medium">
                          {p.number}. {p.what} · {p.target}
                        </span>
                        <span className="block tabular-nums">{p.change}</span>
                        {p.reason ? <span className="block text-muted-foreground">{p.reason}</span> : null}
                        {p.sample ? <span className="block text-muted-foreground">Comparé sur {p.sample}</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
                {isAdmin ? (
                  <Button type="submit" variant="secondary" className="max-md:h-10">
                    Appliquer les choix cochés
                  </Button>
                ) : (
                  <p className="text-note text-muted-foreground">Appliquer un calibrage est réservé aux administrateurs.</p>
                )}
              </form>
            )}
          </div>

          {data.lastApplied ? (
            <div className="flex flex-wrap items-center gap-2 text-note">
              <span>Dernier calibrage appliqué le {fmtDate(data.lastApplied.appliedAt)}.</span>
              {isAdmin ? (
                <form action={undoCalibrationAction}>
                  <input type="hidden" name="back" value={back} />
                  <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                    Annuler le dernier calibrage
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}
        </div>
      </FormSection>
    </div>
  );
}
