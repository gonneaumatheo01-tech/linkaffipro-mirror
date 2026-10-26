import Link from "next/link";
import { ListChecks } from "lucide-react";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Pagination } from "@/components/admin/pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  QA_CONTENT_TYPES,
  QA_VERDICTS,
  checkHref,
  correctionsOf,
  filterParams,
  fmtSeconds,
  hasQualiteFilters,
  maskedContentFields,
  modelLabel,
  qaTeamLabel,
  qualiteHref,
  reasonsOf,
  type QualiteFilters,
} from "@/lib/agents/qualite";
import type { CheckDetail, HistoryRow } from "@/lib/agents/qualite-queries";
import { HISTORY_PAGE_SIZE } from "@/lib/agents/qualite-queries";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { cn } from "@/lib/utils";

const SELECT_LABEL = "text-note font-medium text-muted-foreground";

/** Une vérification de la liste : résultat, type, équipe, contenu (nom court), date, premier motif. */
function HistoryItem({ r, filters, selected }: { r: HistoryRow; filters: QualiteFilters; selected: boolean }) {
  const first = reasonsOf(r.reasons).find((x) => x.critical) ?? reasonsOf(r.reasons)[0];
  return (
    <li className={cn("space-y-1.5 rounded-xl border bg-card px-4 py-3", selected ? "border-brand" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="qaVerdict" value={r.verdict} />
        <StatusBadge kind="qaContentType" value={r.contentType} />
        <span className="text-note text-muted-foreground">{qaTeamLabel(r.teamKey)}</span>
        {r.label ? <span className="text-note text-foreground">{r.label}</span> : null}
      </div>
      <p className="text-note text-muted-foreground">
        {fmtDate(r.createdAt)} · tentative {r.attempt} · {fmtSeconds(r.durationMs)}
        {first ? ` · ${first.label}` : ""}
      </p>
      <Link href={checkHref(r.id, filters)} className="text-note text-info underline underline-offset-4" aria-label={`Voir le détail de la vérification du ${fmtDate(r.createdAt)}`}>
        Voir le détail
      </Link>
    </li>
  );
}

/** Détail d'une vérification : motifs, corrections, tentative, durée, modèle, contenu vérifié MASQUÉ. */
export function CheckDetailView({ c, closeHref }: { c: CheckDetail; closeHref: string }) {
  const reasons = reasonsOf(c.reasons);
  const corrections = correctionsOf(c.corrections);
  const fields = maskedContentFields(c.content);
  return (
    <section aria-labelledby="qa-detail-title" className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="qa-detail-title" className="text-title font-semibold text-foreground">
          Détail de la vérification
        </h2>
        <Link href={closeHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
          Fermer le détail
        </Link>
      </div>
      <DetailList>
        <DetailRow label="Résultat">
          <StatusBadge kind="qaVerdict" value={c.verdict} />
        </DetailRow>
        <DetailRow label="Contenu">
          {statusLabel("qaContentType", c.contentType)}
          {c.label ? ` · ${c.label}` : ""}
        </DetailRow>
        <DetailRow label="Équipe">{qaTeamLabel(c.teamKey)}</DetailRow>
        <DetailRow label="Vérifié le">{fmtDate(c.createdAt)}</DetailRow>
        <DetailRow label="Tentative">{`${c.attempt} sur 3`}</DetailRow>
        <DetailRow label="Durée">{fmtSeconds(c.durationMs)}</DetailRow>
        <DetailRow label="Modèle">{modelLabel(c.modelUsed)}</DetailRow>
      </DetailList>

      <div className="space-y-2">
        <h3 className="text-body font-semibold text-foreground">Motifs</h3>
        {reasons.length === 0 ? (
          <p className="text-note text-muted-foreground">
            {c.verdict === "APPROVED" ? "Aucune remarque : le contenu est passé tel quel." : "Aucun motif enregistré."}
          </p>
        ) : (
          <ul className="space-y-2">
            {reasons.map((r, i) => (
              <li key={i} className="text-body text-foreground">
                <span className={cn("font-medium", r.critical ? "text-destructive" : "text-foreground")}>
                  {r.critical ? "Bloquant" : "Remarque"} : {r.label}
                </span>
                {r.message ? <span className="block text-note text-muted-foreground">{r.message}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {corrections.length ? (
        <div className="space-y-2">
          <h3 className="text-body font-semibold text-foreground">Corrections demandées à l&apos;équipe</h3>
          <ul className="space-y-2">
            {corrections.map((k, i) => (
              <li key={i} className="text-body text-foreground">
                {k.field ? <span className="font-medium">{k.field} : </span> : null}
                {k.suggestion || k.expected}
                {k.expected && k.suggestion ? <span className="block text-note text-muted-foreground">Attendu : {k.expected}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="space-y-2">
        <summary className="cursor-pointer text-note font-medium text-foreground underline underline-offset-4">
          Contenu vérifié (masqué)
        </summary>
        <p className="text-note text-muted-foreground">
          Clés, mots de passe, courriels, téléphones et identifiants internes sont cachés. Le contrôle qualité ne modifie
          jamais le contenu : c&apos;est l&apos;équipe qui corrige.
        </p>
        {fields.length ? (
          <DetailList>
            {fields.map((f) => (
              <DetailRow key={f.key} label={f.key}>
                <span className="break-words">{f.value}</span>
              </DetailRow>
            ))}
          </DetailList>
        ) : (
          <p className="text-note text-muted-foreground">Contenu non gardé.</p>
        )}
      </details>

      {c.previous.length ? (
        <div className="space-y-2">
          <h3 className="text-body font-semibold text-foreground">Autres vérifications de ce contenu</h3>
          <ul className="space-y-1">
            {c.previous.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-note text-muted-foreground">
                <StatusBadge kind="qaVerdict" value={p.verdict} />
                <span>
                  {fmtDate(p.createdAt)} · tentative {p.attempt}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Vue « Historique » : chaque vérification, filtrée par résultat, type, équipe et dates, avec son détail. */
export function QualiteHistoryView({
  filters,
  rows,
  total,
  teams,
  detail,
}: {
  filters: QualiteFilters;
  rows: HistoryRow[];
  total: number;
  teams: string[];
  detail: CheckDetail | null;
}) {
  const filtered = hasQualiteFilters(filters);
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const base = filterParams(filters);
  const teamOptions = [...new Set([...teams, ...(filters.team ? [filters.team] : [])])];
  return (
    <div className="space-y-6">
      <form
        method="get"
        aria-label="Filtrer les vérifications"
        className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-3 sm:items-end md:grid-cols-6 md:p-4"
      >
        <input type="hidden" name="vue" value="historique" />
        <div className="min-w-0 space-y-1">
          <Label htmlFor="qa-resultat" className={SELECT_LABEL}>
            Résultat
          </Label>
          <NativeSelect id="qa-resultat" name="resultat" defaultValue={filters.verdict ?? ""} wrapperClassName="w-full">
            <option value="">Tous</option>
            {QA_VERDICTS.map((v) => (
              <option key={v} value={v}>
                {statusLabel("qaVerdict", v)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="qa-type" className={SELECT_LABEL}>
            Type
          </Label>
          <NativeSelect id="qa-type" name="type" defaultValue={filters.type ?? ""} wrapperClassName="w-full">
            <option value="">Tous</option>
            {QA_CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {statusLabel("qaContentType", t)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="qa-equipe" className={SELECT_LABEL}>
            Équipe
          </Label>
          <NativeSelect id="qa-equipe" name="equipe" defaultValue={filters.team ?? ""} wrapperClassName="w-full">
            <option value="">Toutes</option>
            {teamOptions.map((t) => (
              <option key={t} value={t}>
                {qaTeamLabel(t)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="qa-du" className={SELECT_LABEL}>
            Du
          </Label>
          <Input id="qa-du" name="du" type="date" defaultValue={filters.from ?? ""} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="qa-au" className={SELECT_LABEL}>
            Au
          </Label>
          <Input id="qa-au" name="au" type="date" defaultValue={filters.to ?? ""} />
        </div>
        <Button type="submit" variant="outline" className="max-md:h-10">
          Filtrer
        </Button>
      </form>

      {detail ? <CheckDetailView c={detail} closeHref={qualiteHref("historique", { ...base, ...(filters.page > 1 ? { page: filters.page } : {}) })} /> : null}

      <FormSection
        title="Vérifications"
        description={total ? `${fmtNum(total)} vérification${total > 1 ? "s" : ""}, les plus récentes d'abord.` : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<ListChecks />}
            title={filtered ? "Rien pour ces filtres" : "Aucune vérification pour l'instant"}
            description={
              filtered
                ? "Changez de résultat, de type, d'équipe ou de dates."
                : "Chaque contenu produit par les agents passe ici avant de sortir."
            }
            action={filtered ? { href: qualiteHref("historique"), label: "Effacer les filtres", variant: "outline" } : undefined}
          />
        ) : (
          <>
            <ul className="space-y-3">
              {rows.map((r) => (
                <HistoryItem key={r.id} r={r} filters={filters} selected={detail?.id === r.id} />
              ))}
            </ul>
            <Pagination
              page={filters.page}
              pages={pages}
              total={total}
              noun="vérification"
              hrefFor={(p) => qualiteHref("historique", { ...base, ...(p > 1 ? { page: p } : {}) })}
            />
          </>
        )}
      </FormSection>
    </div>
  );
}
