import Link from "next/link";
import { markAlertSeenAction, muteAlertKindAction, muteProspectAlertsAction, unmuteAlertKindAction } from "@/app/(admin)/agents/prospection/advanced-actions";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ALERT_FAMILIES,
  ALERT_FAMILY_LABELS,
  ALERT_KINDS,
  ALERT_KIND_HINTS,
  ALERT_KIND_LABELS,
  ALERTS_PATH,
  alertFacts,
  alertKindLabel,
  evidenceText,
  isAlertFamily,
  isAlertKind,
  type AlertFilters,
} from "@/lib/agents/prospection/advanced";
import type { AlertsData } from "@/lib/agents/prospection/advanced-queries";
import { channelName, prospectHref } from "@/lib/agents/prospection/display";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

/**
 * Vue « Alertes » de la Prospection (phase 32) : ce que la veille a remarqué chez les canaux suivis et chez les
 * affiliés signés (marque lâchée, forte hausse, concurrent, silence, contact changé…), avec les chiffres mesurés et
 * la preuve (15 mots au plus). Boutons : « Vu », « Plus pour ce canal », « Couper ce type ». Rien n'est envoyé à un canal.
 */
export function AlertsView({ data, filters, back }: { data: AlertsData; filters: AlertFilters; back: string }) {
  return (
    <div className="space-y-6">
      <form method="get" action={ALERTS_PATH} className="flex flex-wrap items-end gap-3" aria-label="Filtrer les alertes">
        <div className="space-y-1">
          <Label htmlFor="al-statut">Statut</Label>
          <NativeSelect id="al-statut" name="statut" defaultValue={filters.status === "open" ? "open" : (filters.status ?? "tous")}>
            <option value="open">À voir</option>
            <option value="SEEN">Vues</option>
            <option value="MUTED">Coupées</option>
            <option value="tous">Toutes</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="al-famille">Genre</Label>
          <NativeSelect id="al-famille" name="famille" defaultValue={filters.family ?? ""}>
            <option value="">Tous</option>
            {ALERT_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {ALERT_FAMILY_LABELS[f]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="al-type">Type</Label>
          <NativeSelect id="al-type" name="type" defaultValue={filters.kind ?? ""}>
            <option value="">Tous les types</option>
            {ALERT_KINDS.map((k) => (
              <option key={k} value={k}>
                {ALERT_KIND_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
          Filtrer
        </Button>
      </form>

      <p className="text-note text-muted-foreground">
        {fmtNum(data.counts.NEW ?? 0)} nouvelle{(data.counts.NEW ?? 0) > 1 ? "s" : ""} · {fmtNum(data.counts.SENT ?? 0)} envoyée{(data.counts.SENT ?? 0) > 1 ? "s" : ""} par Kevin · {fmtNum(data.counts.SEEN ?? 0)} vue
        {(data.counts.SEEN ?? 0) > 1 ? "s" : ""} · {fmtNum(data.counts.MUTED ?? 0)} coupée{(data.counts.MUTED ?? 0) > 1 ? "s" : ""}. Chaque matin vers 9 h 10, Kevin vous envoie les 8 plus importantes ; une même
        alerte ne revient pas avant 14 jours.
      </p>

      {!data.rows.length ? (
        <EmptyState title="Aucune alerte ici" description="Les canaux suivis sont relus régulièrement ; une alerte apparaît dès qu'un changement utile est mesuré." />
      ) : (
        <ul className="space-y-3" aria-label="Alertes de la veille">
          {data.rows.map((a) => {
            const facts = alertFacts(a.data);
            const proof = evidenceText(a.evidence);
            const open = a.status === "NEW" || a.status === "SENT";
            return (
              <li key={a.id} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{alertKindLabel(a.kind)}</span>
                  <span className="text-note text-muted-foreground">·</span>
                  <Link href={prospectHref(a.prospect.id)} className="text-info underline underline-offset-4">
                    {a.prospect.username ? `@${a.prospect.username}` : channelName(a.prospect)}
                  </Link>
                  <StatusBadge kind="prospectAlert" value={a.status} />
                  {isAlertFamily(a.family) ? <span className="text-note text-muted-foreground">{ALERT_FAMILY_LABELS[a.family]}</span> : null}
                  <span className="ml-auto text-note text-muted-foreground">{fmtDate(a.createdAt)}</span>
                </div>
                {isAlertKind(a.kind) ? <p className="text-note text-muted-foreground">{ALERT_KIND_HINTS[a.kind]}</p> : null}
                {facts.length ? (
                  <p className="text-note">
                    {facts.map((f, i) => (
                      <span key={f.label}>
                        {i ? " · " : ""}
                        {f.label} : <span className="tabular-nums">{f.value}</span>
                      </span>
                    ))}
                  </p>
                ) : null}
                {proof ? <blockquote className="border-l-2 border-border pl-3 text-note italic">« {proof} »</blockquote> : null}
                <div className="flex flex-wrap gap-2">
                  {open ? (
                    <form action={markAlertSeenAction}>
                      <input type="hidden" name="alertId" value={a.id} />
                      <input type="hidden" name="back" value={back} />
                      <Button type="submit" size="sm" variant="secondary" className="max-md:h-10">
                        Vu
                      </Button>
                    </form>
                  ) : null}
                  {!a.prospect.watchMuted ? (
                    <form action={muteProspectAlertsAction}>
                      <input type="hidden" name="prospectId" value={a.prospect.id} />
                      <input type="hidden" name="action" value="mute" />
                      <input type="hidden" name="back" value={back} />
                      <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                        Plus pour ce canal
                      </Button>
                    </form>
                  ) : null}
                  {isAlertKind(a.kind) && !data.mutedKinds.includes(a.kind) ? (
                    <form action={muteAlertKindAction}>
                      <input type="hidden" name="kind" value={a.kind} />
                      <input type="hidden" name="back" value={back} />
                      <Button type="submit" size="sm" variant="ghost" className="max-md:h-10">
                        Couper ce type
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data.total > data.rows.length ? <p className="text-note text-muted-foreground">Les {fmtNum(data.rows.length)} plus récentes sur {fmtNum(data.total)}.</p> : null}

      <FormSection id="types-coupes" title="Types d'alerte coupés" description="Un type coupé ne vous est plus envoyé, pour aucun canal. Kevin vous propose de couper un type que vous ignorez 5 fois de suite.">
        {!data.mutedKinds.length ? (
          <p className="text-note text-muted-foreground">Aucun type coupé.</p>
        ) : (
          <ul className="space-y-2">
            {data.mutedKinds.map((k) => (
              <li key={k} className="flex flex-wrap items-center gap-2">
                <span>{ALERT_KIND_LABELS[k]}</span>
                <form action={unmuteAlertKindAction}>
                  <input type="hidden" name="kind" value={k} />
                  <input type="hidden" name="back" value={back} />
                  <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                    Rétablir
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection title="Canaux sans alerte" description="Les canaux pour lesquels vous avez choisi « Plus pour ce canal ». Ils restent suivis, leurs chiffres restent à jour.">
        {!data.mutedChannels.length ? (
          <p className="text-note text-muted-foreground">Aucun canal.</p>
        ) : (
          <ul className="space-y-2">
            {data.mutedChannels.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <Link href={prospectHref(p.id)} className="text-info underline underline-offset-4">
                  {p.username ? `@${p.username}` : channelName(p)}
                </Link>
                <form action={muteProspectAlertsAction}>
                  <input type="hidden" name="prospectId" value={p.id} />
                  <input type="hidden" name="action" value="unmute" />
                  <input type="hidden" name="back" value={back} />
                  <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                    Rétablir ses alertes
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </FormSection>
    </div>
  );
}
