import { Suspense } from "react";
import Link from "next/link";
import { FilterChips } from "@/components/admin/filter-chips";
import { RememberFilters } from "@/components/admin/remember-filters";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { COUNTRY_CODES, countryName } from "@/lib/agents/analyses";
import {
  COMPETITION_LABELS,
  COMPETITIVE_STATES,
  CONTACT_LEVELS,
  OPENNESS_KEYS,
  OPENNESS_LABELS,
  PROSPECT_STATUSES,
  SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
  TIERS,
  VERTICALS,
  VERTICAL_LABELS,
} from "@/lib/agents/prospection/display";
import {
  QUICK_VIEWS,
  SORTS,
  SORT_LABELS,
  currentQuickView,
  exportHref,
  filterParams,
  viewHref,
  type ProspectFilters,
  type ProspectionView,
  EMPTY_FILTERS,
} from "@/lib/agents/prospection/filters";
import { statusLabel } from "@/lib/status-badges";
import { cn } from "@/lib/utils";

const SELECT_LABEL = "text-note font-medium text-muted-foreground";

function Select({ id, name, label, value, children }: { id: string; name: string; label: string; value: string | null; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className={SELECT_LABEL}>
        {label}
      </Label>
      <NativeSelect id={id} name={name} defaultValue={value ?? ""} wrapperClassName="w-full">
        {children}
      </NativeSelect>
    </div>
  );
}

/**
 * Filtres combinables de la Prospection (formulaire GET : ils restent dans l'adresse, et sont mémorisés sur l'appareil
 * par `RememberFilters`), vues toutes prêtes et lien d'export CSV des lignes filtrées. Composant serveur.
 */
export function ProspectFiltersForm({ filters, view, showExport = true }: { filters: ProspectFilters; view: ProspectionView; showExport?: boolean }) {
  const quick = currentQuickView(filters);
  return (
    <div className="mb-6 space-y-3">
      <FilterChips
        label="Vues toutes prêtes"
        chips={QUICK_VIEWS.map((q) => ({
          key: q.key,
          label: q.label,
          href: viewHref(view, filterParams({ ...EMPTY_FILTERS, ...q.filters })),
          selected: quick === q.key,
        }))}
      />
      <form method="get" aria-label="Filtrer les canaux" className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-3 sm:items-end md:p-4 lg:grid-cols-6">
        {view !== "tableau" ? <input type="hidden" name="vue" value={view} /> : null}
        <div className="min-w-0 space-y-1 sm:col-span-2">
          <Label htmlFor="pr-q" className={SELECT_LABEL}>
            Rechercher
          </Label>
          <Input id="pr-q" name="q" defaultValue={filters.q ?? ""} placeholder="@nom, titre ou contact" />
        </div>
        <Select id="pr-pays" name="pays" label="Pays" value={filters.country}>
          <option value="">Tous les pays</option>
          {COUNTRY_CODES.map((c) => (
            <option key={c} value={c}>
              {countryName(c)}
            </option>
          ))}
        </Select>
        <Select id="pr-verticale" name="verticale" label="Marché" value={filters.vertical}>
          <option value="">Tous</option>
          {VERTICALS.map((v) => (
            <option key={v} value={v}>
              {VERTICAL_LABELS[v]}
            </option>
          ))}
        </Select>
        <Select id="pr-niveau" name="niveau" label="Niveau" value={filters.tier}>
          <option value="">Tous</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {statusLabel("prospectTier", t)}
            </option>
          ))}
        </Select>
        {view === "tableau" ? (
          <Select id="pr-statut" name="statut" label="Statut" value={filters.status}>
            <option value="">Tous sauf écartés</option>
            <option value="suivi">En cours avec vous</option>
            <option value="tous">Tous, écartés compris</option>
            {PROSPECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel("prospectStatus", s)}
              </option>
            ))}
          </Select>
        ) : null}
        <Select id="pr-concurrence" name="concurrence" label="Concurrence" value={filters.competition}>
          <option value="">Toutes</option>
          {COMPETITIVE_STATES.map((c) => (
            <option key={c} value={c}>
              {COMPETITION_LABELS[c]}
            </option>
          ))}
        </Select>
        <Select id="pr-ouverture" name="ouverture" label="Ouverture" value={filters.openness}>
          <option value="">Toutes</option>
          {OPENNESS_KEYS.map((o) => (
            <option key={o} value={o}>
              {OPENNESS_LABELS[o]}
            </option>
          ))}
        </Select>
        <Select id="pr-contact" name="contact" label="Contact" value={filters.contact}>
          <option value="">Tous</option>
          {CONTACT_LEVELS.map((c) => (
            <option key={c} value={c}>
              {statusLabel("contactConfidence", c)}
            </option>
          ))}
        </Select>
        <Select id="pr-source" name="source" label="Trouvé par" value={filters.source}>
          <option value="">Toutes les sources</option>
          {SOURCE_TYPES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_TYPE_LABELS[s]}
            </option>
          ))}
        </Select>
        {view === "tableau" ? (
          <Select id="pr-tri" name="tri" label="Trier par" value={filters.sort}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" variant="outline" className="max-md:h-10">
            Filtrer
          </Button>
          <Suspense fallback={null}>
            <RememberFilters storageKey={`prospection-${view}`} keepParams={["vue"]} className="max-md:h-10" />
          </Suspense>
        </div>
      </form>
      {showExport ? (
        <p className="text-note text-muted-foreground">
          <Link href={exportHref(filters)} prefetch={false} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
            Exporter ces canaux (tableur)
          </Link>{" "}
          Les canaux dont l&apos;audience est hors Europe n&apos;apparaissent jamais.
        </p>
      ) : null}
    </div>
  );
}
