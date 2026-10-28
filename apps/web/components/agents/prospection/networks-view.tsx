import Link from "next/link";
import { mergeProspectsAction, splitProspectAction } from "@/app/(admin)/agents/prospection/advanced-actions";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { countryName, stringList } from "@/lib/agents/analyses";
import { networkEvidenceOf, networkOriginLabel, valueRangeShort } from "@/lib/agents/prospection/advanced";
import type { NetworkRow } from "@/lib/agents/prospection/advanced-queries";
import { VERTICAL_LABELS, channelName, prospectHref } from "@/lib/agents/prospection/display";
import { fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

/**
 * Vue « Réseaux » (phase 32) : les canaux tenus par la même personne, regroupés par l'équipe sur des preuves notées
 * (même contact, même signature, même groupe de discussion, même site, reprises croisées, même code promo ;
 * 4 points au moins) ou par vous. Un réseau = une seule ligne dans la liste du matin et un seul accord à négocier.
 * « Séparer » sort un canal de son réseau ; « Regrouper » réunit des canaux que vous savez tenus par la même personne.
 */
export function NetworksView({ networks, back }: { networks: NetworkRow[]; back: string }) {
  return (
    <div className="space-y-6">
      {!networks.length ? (
        <EmptyState title="Aucun réseau pour l'instant" description="L'équipe regroupe les canaux dès qu'elle trouve assez de preuves qu'ils sont tenus par la même personne." />
      ) : (
        <ul className="space-y-4" aria-label="Réseaux de canaux">
          {networks.map((n) => {
            const evidence = networkEvidenceOf(n.evidence);
            const countries = stringList(n.countries);
            const verticals = stringList(n.verticals);
            return (
              <li key={n.id} id={`reseau-${n.id}`} className="space-y-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{n.name}</span>
                  <span className="text-note text-muted-foreground">{networkOriginLabel(n.origin)}</span>
                  {n.status ? <StatusBadge kind="prospectStatus" value={n.status} /> : null}
                </div>
                <p className="text-note">
                  {fmtNum(n.members.length)} canaux · {fmtNum(n.totalReach)} vues par post cumulées
                  {n.mainContact ? ` · contact principal : ${n.mainContact}` : ""}
                  {countries.length ? ` · ${countries.map(countryName).join(", ")}` : ""}
                  {verticals.length ? ` · ${verticals.map((v) => VERTICAL_LABELS[v] ?? v).join(", ")}` : ""}
                </p>
                {n.value ? (
                  <p className="text-note">
                    Valeur estimée cumulée : <span className="tabular-nums">{valueRangeShort(n.value)}</span> par mois (fourchette, {fmtNum(n.value.count)} canal
                    {n.value.count > 1 ? "aux" : ""} estimé{n.value.count > 1 ? "s" : ""})
                  </p>
                ) : null}
                <ul className="space-y-1" aria-label={`Canaux du réseau ${n.name}`}>
                  {n.members.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 text-note">
                      <Link href={prospectHref(m.id)} className="text-info underline underline-offset-4">
                        {m.username ? `@${m.username}` : channelName(m)}
                      </Link>
                      {m.tier ? <StatusBadge kind="prospectTier" value={m.tier} /> : null}
                      <span className="text-muted-foreground">
                        {m.medianViews !== null ? `${fmtNum(m.medianViews)} vues par post` : "vues inconnues"}
                        {m.subscribers !== null ? ` · ${fmtNum(m.subscribers)} abonnés` : ""}
                      </span>
                      <form action={splitProspectAction} className="ml-auto">
                        <input type="hidden" name="prospectId" value={m.id} />
                        <input type="hidden" name="back" value={back} />
                        <Button type="submit" size="sm" variant="ghost" className="max-md:h-10">
                          Séparer
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
                {evidence.length ? (
                  <details className="text-note">
                    <summary className="cursor-pointer text-muted-foreground">Preuves ({fmtNum(evidence.reduce((a, e) => a + e.points, 0))} points)</summary>
                    <ul className="mt-2 space-y-1">
                      {evidence.map((e, i) => (
                        <li key={`${e.a}-${e.b}-${i}`}>
                          {e.label} ({e.points} point{e.points > 1 ? "s" : ""}){e.detail ? ` : ${e.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <FormSection
        id="regrouper"
        title="Regrouper des canaux"
        description="Vous savez que plusieurs canaux sont tenus par la même personne ? Donnez leurs @noms ou leurs liens t.me, séparés par des virgules. Rien n'est envoyé aux canaux."
      >
        <form action={mergeProspectsAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="back" value={back} />
          <div className="min-w-64 flex-1 space-y-1">
            <Label htmlFor="net-merge">Canaux à regrouper</Label>
            <Input id="net-merge" name="names" required placeholder="@canal1, @canal2" autoComplete="off" />
          </div>
          <Button type="submit" variant="secondary" className="max-md:h-10">
            Regrouper
          </Button>
        </form>
      </FormSection>
    </div>
  );
}
