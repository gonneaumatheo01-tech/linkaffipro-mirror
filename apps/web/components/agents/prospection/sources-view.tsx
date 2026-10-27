import { addManualProspectAction, toggleSourcePauseAction } from "@/app/(admin)/agents/prospection/actions";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SOURCE_TYPE_LABELS, TIERS } from "@/lib/agents/prospection/display";
import type { SourcesData } from "@/lib/agents/prospection/queries";
import { DISCOVERY_SOURCE_HINTS, DISCOVERY_SOURCE_LABELS, PAUSE_DAYS } from "@/lib/agents/prospection/sources";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

/**
 * Vue « Sources » : où l'équipe trouve les canaux (état, prochain passage, trouvés / nouveaux / déjà connus sur
 * 30 jours, niveaux obtenus), pause et reprise (administrateurs), journal des derniers passages, et « Ajouter un canal »
 * à la main (lien public t.me : le canal est lu, jamais rejoint ni contacté).
 */
export function SourcesView({ data, isAdmin }: { data: SourcesData; isAdmin: boolean }) {
  return (
    <div className="space-y-6">
      <FormSection id="ajouter" title="Ajouter un canal" description="Collez le lien public d'un canal (t.me/nom ou @nom). Il est lu en priorité puis noté ; personne n'est contacté.">
        <form action={addManualProspectAction} className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 space-y-1">
            <Label htmlFor="pr-add-url">Lien du canal</Label>
            <Input id="pr-add-url" name="url" required placeholder="https://t.me/nomducanal" autoComplete="off" />
          </div>
          <Button type="submit" className="max-md:h-10">
            Ajouter
          </Button>
        </form>
      </FormSection>

      <FormSection
        id="sources"
        title="Sources"
        description={data.enabled ? "Les recherches tournent chaque nuit, de 2 h à 6 h (heure de Paris), doucement : quelques secondes entre deux pages." : "La prospection est coupée (Réglages) : aucune source ne tourne."}
      >
        <ul className="space-y-3">
          {data.rows.map((s) => (
            <li key={s.key} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{DISCOVERY_SOURCE_LABELS[s.key] ?? s.key}</span>
                <StatusBadge kind="prospectSource" value={s.state} />
              </div>
              <p className="text-note text-muted-foreground">{DISCOVERY_SOURCE_HINTS[s.key]}</p>
              <p className="text-note text-muted-foreground">
                {s.lastRunAt ? `Dernier passage le ${fmtDate(s.lastRunAt)}` : "Pas encore de passage"}
                {s.nextRunAt ? ` · prochain le ${fmtDate(s.nextRunAt)}` : s.key === "manual" ? " · lu dès l'ajout" : ""}
                {s.pausedUntil ? ` · en pause jusqu'au ${fmtDate(s.pausedUntil)}${s.pauseReason ? ` (${s.pauseReason})` : ""}` : ""}
              </p>
              <p className="text-note">
                Sur 30 jours : {fmtNum(s.found30d)} trouvés, {fmtNum(s.new30d)} nouveaux, {fmtNum(s.duplicates30d)} déjà connus · {fmtNum(s.prospects)} canaux au total
                {s.prospects ? ` (${TIERS.map((t) => `${s.tiers[t] ?? 0} ${t}`).join(", ")})` : ""}
              </p>
              {s.state === "ERROR" && s.lastErrors.length ? <p className="text-note text-destructive">Dernier passage en erreur : {s.lastErrors.slice(0, 2).join(" · ")}</p> : null}
              {isAdmin && s.key !== "manual" ? (
                s.pausedUntil ? (
                  <form action={toggleSourcePauseAction}>
                    <input type="hidden" name="source" value={s.key} />
                    <input type="hidden" name="action" value="resume" />
                    <Button type="submit" size="sm" variant="secondary" className="max-md:h-10">
                      Reprendre
                    </Button>
                  </form>
                ) : (
                  <form action={toggleSourcePauseAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="source" value={s.key} />
                    <input type="hidden" name="action" value="pause" />
                    <div className="space-y-1">
                      <Label htmlFor={`pause-${s.key}`} className="text-note text-muted-foreground">
                        Durée
                      </Label>
                      <NativeSelect id={`pause-${s.key}`} name="days" defaultValue="7">
                        {PAUSE_DAYS.map((d) => (
                          <option key={d} value={d}>
                            {d} jour{d > 1 ? "s" : ""}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                      Mettre en pause
                    </Button>
                  </form>
                )
              ) : null}
            </li>
          ))}
        </ul>
        {data.otherPauses.length ? (
          <div className="mt-4 space-y-1">
            <p className="text-note font-medium">Sites mis en pause automatiquement (refus d&apos;accès ou vérification « robot ») :</p>
            <ul className="space-y-1">
              {data.otherPauses.map((p) => (
                <li key={p.key} className="text-note text-muted-foreground">
                  {p.key} : jusqu&apos;au {fmtDate(p.until)}
                  {p.reason ? ` (${p.reason})` : ""}
                  {isAdmin ? (
                    <form action={toggleSourcePauseAction} className="ml-2 inline">
                      <input type="hidden" name="source" value={p.key} />
                      <input type="hidden" name="action" value="resume" />
                      <Button type="submit" size="sm" variant="ghost">
                        Reprendre
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </FormSection>

      <FormSection title="Derniers passages" description="Chaque recherche faite par l'équipe, la plus récente d'abord.">
        {!data.runs.length ? (
          <p className="text-note text-muted-foreground">Aucun passage pour l&apos;instant.</p>
        ) : (
          <Table label="Derniers passages des sources">
            <TableCaption className="sr-only">Derniers passages des sources de la prospection</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Début</TableHead>
                <TableHead>Source</TableHead>
                <TableHead numeric>Trouvés</TableHead>
                <TableHead numeric>Nouveaux</TableHead>
                <TableHead>Erreurs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.runs.map((r) => {
                const errors = Array.isArray(r.errors) ? r.errors.length : 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDate(r.started)}</TableCell>
                    <TableCell className="text-note">
                      {SOURCE_TYPE_LABELS[r.sourceType] ?? DISCOVERY_SOURCE_LABELS[r.sourceType] ?? r.sourceType}
                      {r.vertical ? ` · ${r.vertical === "CASINO" ? "casino" : "paris sportifs"}` : ""}
                      {Array.isArray(r.languages) && r.languages.length ? ` · ${(r.languages as string[]).join(", ")}` : ""}
                    </TableCell>
                    <TableCell numeric>{fmtNum(r.found)}</TableCell>
                    <TableCell numeric>
                      {fmtNum(r.newCount)}
                      {r.duplicates ? <span className="text-muted-foreground"> (+{fmtNum(r.duplicates)} connus)</span> : null}
                    </TableCell>
                    <TableCell className="text-note">{errors ? `${errors} erreur${errors > 1 ? "s" : ""}` : r.finished ? "Aucune" : "En cours"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </FormSection>
    </div>
  );
}
