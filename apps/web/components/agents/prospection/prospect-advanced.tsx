import Link from "next/link";
import { muteProspectAlertsAction, splitProspectAction } from "@/app/(admin)/agents/prospection/advanced-actions";
import { TimeChart } from "@/components/charts/time-chart";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import {
  CONFIDENCE_LABELS,
  NETWORKS_PATH,
  alertKindLabel,
  assumptionLines,
  calibrationNote,
  evidenceText,
  monthLabel,
  networkOriginLabel,
  parseValueEstimate,
  snapshotSeries,
  valueRangeText,
} from "@/lib/agents/prospection/advanced";
import type { ProspectExtras } from "@/lib/agents/prospection/advanced-queries";
import { channelName, prospectHref } from "@/lib/agents/prospection/display";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

/**
 * Compléments de la fiche d'un canal (phase 32) : valeur estimée (fourchette, confiance, hypothèses), réseau (autres
 * canaux de la même personne), historique des mesures relevées par la veille (abonnés, vues par post), alertes récentes
 * et, pour un affilié signé, ses vrais résultats par mois.
 */
export function ProspectAdvancedSections({
  p,
  extras,
  back,
}: {
  p: { id: string; valueEstimate: unknown; watchMuted: boolean; lastRequalifiedAt: Date | null; nextRequalifyAt: Date | null };
  extras: ProspectExtras;
  back: string;
}) {
  const e = parseValueEstimate(p.valueEstimate);
  const subs = snapshotSeries(extras.snapshots, "subscribers");
  const views = snapshotSeries(extras.snapshots, "medianViews");
  return (
    <div className="mt-6 space-y-6">
      <FormSection id="valeur" title="Valeur estimée" description="Ce que ce canal pourrait rapporter par mois avec votre offre. Une estimation, jamais une promesse.">
        {e ? (
          <div className="space-y-2 text-note">
            <p className="text-body tabular-nums">{valueRangeText(e)}</p>
            <p className="text-muted-foreground">
              {CONFIDENCE_LABELS[e.confidence]} · {calibrationNote(e)}
              {e.computedAt && !Number.isNaN(Date.parse(e.computedAt)) ? ` · calculée le ${fmtDate(new Date(e.computedAt))}` : ""}
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {assumptionLines(e).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-note text-muted-foreground">Pas encore d&apos;estimation (mesures ou offre correspondante manquantes).</p>
        )}
      </FormSection>

      <FormSection id="reseau" title="Réseau" description="Les autres canaux tenus par la même personne : un seul accord à négocier.">
        {extras.network ? (
          <div className="space-y-2 text-note">
            <p>
              <Link href={`${NETWORKS_PATH}#reseau-${extras.network.id}`} className="font-medium text-info underline underline-offset-4">
                {extras.network.name}
              </Link>{" "}
              · {networkOriginLabel(extras.network.origin)} · {fmtNum(extras.network.totalReach)} vues par post cumulées
              {extras.network.mainContact ? ` · contact principal : ${extras.network.mainContact}` : ""}
            </p>
            <ul className="flex flex-wrap gap-2">
              {extras.network.members
                .filter((m) => m.id !== p.id)
                .map((m) => (
                  <li key={m.id}>
                    <Link href={prospectHref(m.id)} className="text-info underline underline-offset-4">
                      {m.username ? `@${m.username}` : channelName(m)}
                    </Link>
                  </li>
                ))}
            </ul>
            <form action={splitProspectAction}>
              <input type="hidden" name="prospectId" value={p.id} />
              <input type="hidden" name="back" value={back} />
              <Button type="submit" size="sm" variant="ghost" className="max-md:h-10">
                Sortir ce canal du réseau
              </Button>
            </form>
          </div>
        ) : (
          <p className="text-note text-muted-foreground">
            Aucun réseau connu.{" "}
            <Link href={`${NETWORKS_PATH}#regrouper`} className="text-info underline underline-offset-4">
              Regrouper avec d&apos;autres canaux
            </Link>
          </p>
        )}
      </FormSection>

      <FormSection
        id="historique"
        title="Historique des mesures"
        description={`Relevé à chaque relecture par la veille (26 points au plus).${p.lastRequalifiedAt ? ` Dernière relecture le ${fmtDate(p.lastRequalifiedAt)}.` : ""}${p.nextRequalifyAt ? ` Prochaine vers le ${fmtDate(p.nextRequalifyAt)}.` : ""}`}
      >
        {subs.values.length < 2 && views.values.length < 2 ? (
          <p className="text-note text-muted-foreground">Pas encore assez de relectures pour tracer une courbe.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {subs.values.length >= 2 ? <TimeChart title="Abonnés à chaque relecture" labels={subs.labels} series={[{ id: "subs", label: "Abonnés", values: subs.values, tone: "current" }]} format="number" integer unitLabel="Relecture" valuesSummary="Voir les abonnés relecture par relecture" /> : null}
            {views.values.length >= 2 ? <TimeChart title="Vues par post à chaque relecture" labels={views.labels} series={[{ id: "views", label: "Vues par post", values: views.values, tone: "current" }]} format="number" integer unitLabel="Relecture" valuesSummary="Voir les vues relecture par relecture" /> : null}
          </div>
        )}
      </FormSection>

      <FormSection id="alertes" title="Alertes récentes" description={p.watchMuted ? "Vous ne recevez plus d'alerte pour ce canal." : "Ce que la veille a remarqué sur ce canal."}>
        <div className="space-y-2 text-note">
          {!extras.alerts.length ? (
            <p className="text-muted-foreground">Aucune alerte.</p>
          ) : (
            <ul className="space-y-1">
              {extras.alerts.map((a) => {
                const proof = evidenceText(a.evidence);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{alertKindLabel(a.kind)}</span>
                    <StatusBadge kind="prospectAlert" value={a.status} />
                    <span className="text-muted-foreground">{fmtDate(a.createdAt)}</span>
                    {proof ? <span className="italic">« {proof} »</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
          <form action={muteProspectAlertsAction}>
            <input type="hidden" name="prospectId" value={p.id} />
            <input type="hidden" name="action" value={p.watchMuted ? "unmute" : "mute"} />
            <input type="hidden" name="back" value={back} />
            <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
              {p.watchMuted ? "Rétablir ses alertes" : "Plus d'alerte pour ce canal"}
            </Button>
          </form>
        </div>
      </FormSection>

      {extras.results.length ? (
        <FormSection id="resultats" title="Vrais résultats (Link Affi)" description="Lus chaque mois dans Link Affi, en lecture seule. Ce qui manque est dit, jamais estimé.">
          <ul className="space-y-1 text-note">
            {extras.results.map((m) => (
              <li key={m.id}>
                {monthLabel(m.month)} : {m.clicks === null ? "—" : fmtNum(m.clicks)} clics, {m.regs === null ? "—" : fmtNum(m.regs)} inscriptions, {m.ftd === null ? "—" : fmtNum(m.ftd)} premiers dépôts,{" "}
                {m.revenueCents === null ? "revenus non fournis" : `${fmtMoney(m.revenueCents / 100, "EUR", { digits: 0 })} de revenus`}
              </li>
            ))}
          </ul>
        </FormSection>
      ) : null}
    </div>
  );
}
