import { Globe } from "lucide-react";
import { activateSourceAction, deactivateSourceAction, deleteSourceAction } from "@/app/(admin)/agents/analyses/actions";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SOURCE_ORIGIN_LABELS, countriesText, safeUrl, sourceState } from "@/lib/agents/analyses";
import type { SourceRow } from "@/lib/agents/analyses-queries";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

function SourceItem({ s, isAdmin }: { s: SourceRow; isAdmin: boolean }) {
  const state = sourceState(s);
  const url = safeUrl(s.url);
  const confirmId = `source-delete-${s.id}`;
  return (
    <li id={`source-${s.id}`} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{s.name}</span>
        <StatusBadge kind="trendSource" value={state} />
        <StatusBadge kind="trendSourceType" value={s.sourceType} />
        <StatusBadge kind="vertical" value={s.market} />
      </div>
      <p className="text-note text-muted-foreground">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer noopener" className="text-info underline underline-offset-4">
            {s.url}
          </a>
        ) : (
          s.url
        )}
        {" · "}
        {countriesText(s.countries)}
        {" · "}
        {SOURCE_ORIGIN_LABELS[s.origin] ?? "Autre origine"}
      </p>
      <p className="text-note text-muted-foreground">
        {s.lastScrapedAt ? `Dernière collecte le ${fmtDate(s.lastScrapedAt)}` : "Jamais lue"}
        {s.isActive && s.nextScrapeAt ? ` · prochaine le ${fmtDate(s.nextScrapeAt)}` : ""}
        {` · ${fmtNum(s.entries)} entrée${s.entries > 1 ? "s" : ""}`}
      </p>
      {state === "ERROR" && s.lastError ? (
        <p className="text-note text-destructive">
          {s.errorCount > 1 ? `${s.errorCount} échecs de suite` : "Dernière lecture en échec"} : {s.lastError}
          {!s.isActive ? " La source a été arrêtée : réactivez-la quand le site répond de nouveau." : ""}
        </p>
      ) : null}
      {state === "PROPOSED" ? (
        <p className="text-note text-foreground">La veille a trouvé cette source : activez-la pour qu&apos;elle soit lue, ou supprimez-la.</p>
      ) : null}
      {isAdmin ? (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          {!s.isActive || s.errorCount > 0 ? (
            <form action={activateSourceAction}>
              <input type="hidden" name="sourceId" value={s.id} />
              <Button type="submit" size="sm" variant="secondary" className="max-md:h-10">
                {s.isActive ? "Relancer" : "Activer"}
              </Button>
            </form>
          ) : null}
          {s.isActive ? (
            <form action={deactivateSourceAction}>
              <input type="hidden" name="sourceId" value={s.id} />
              <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                Désactiver
              </Button>
            </form>
          ) : null}
          <details className="w-full sm:w-auto">
            <summary className="cursor-pointer text-note text-destructive underline underline-offset-4">Supprimer</summary>
            <form action={deleteSourceAction} className="mt-2 space-y-2">
              <input type="hidden" name="sourceId" value={s.id} />
              <p className="text-note text-muted-foreground">
                {s.entries
                  ? `Ses ${fmtNum(s.entries)} entrée${s.entries > 1 ? "s" : ""} de veille seront effacées. Les règles publicitaires et les rapports restent.`
                  : "Aucune entrée de veille à effacer."}
              </p>
              <div className="space-y-1">
                <Label htmlFor={confirmId}>Pour confirmer, tapez SUPPRIMER</Label>
                <Input id={confirmId} name="confirm" required autoComplete="off" className="sm:max-w-56" />
              </div>
              <ConfirmSubmit
                variant="destructive"
                size="sm"
                className="max-md:h-10"
                confirmTitle={`Supprimer la source ${s.name} ?`}
                message={`La source « ${s.name} » ne sera plus lue et ses entrées de veille seront effacées. C'est définitif.`}
                confirmLabel="Supprimer définitivement"
                destructive
              >
                Supprimer la source
              </ConfirmSubmit>
            </form>
          </details>
        </div>
      ) : null}
    </li>
  );
}

/** Vue « Sources » : ce que la veille lit, son état, sa dernière collecte ; gestes réservés aux administrateurs. */
export function SourcesView({ rows, isAdmin }: { rows: SourceRow[]; isAdmin: boolean }) {
  const active = rows.filter((r) => r.isActive).length;
  const inError = rows.filter((r) => sourceState(r) === "ERROR").length;
  const proposed = rows.filter((r) => sourceState(r) === "PROPOSED").length;
  return (
    <FormSection
      id="sources"
      title="Sources de la veille"
      description={
        rows.length
          ? [
              `${fmtNum(rows.length)} source${rows.length > 1 ? "s" : ""}`,
              `${fmtNum(active)} active${active > 1 ? "s" : ""}`,
              inError ? `${fmtNum(inError)} en erreur` : null,
              proposed ? `${fmtNum(proposed)} à valider` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
    >
      {!isAdmin ? (
        <p className="text-note text-muted-foreground">Seuls les administrateurs peuvent activer, désactiver ou supprimer une source.</p>
      ) : (
        <p className="text-note text-muted-foreground">
          Pour ajouter un forum ou un site, écrivez à Kevin « ajoute ce forum : » suivi de l&apos;adresse. Chaque source est lue
          à son rythme (un passage par jour par défaut, quelques secondes entre deux pages).
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Globe />}
          title="Aucune source pour l'instant"
          description="La liste de départ (forums d'affiliés, actualité des jeux et paris, canaux publics) est posée au premier passage de la veille."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <SourceItem key={s.id} s={s} isAdmin={isAdmin} />
          ))}
        </ul>
      )}
    </FormSection>
  );
}
