import { Flash } from "@/components/admin/flash";
import { Term } from "@/components/admin/help-tip";
import { PageHeader, type PageAction } from "@/components/admin/page-header";
import {
  periodSentence,
  statsHref,
  statsPage,
  type StatsFilters as Filters,
  type StatsPageKey,
} from "@/lib/dashboard/stats-pages";
import type { StatsOptions } from "@/lib/dashboard/stats-options";
import { StatsFilters } from "./stats-filters";
import { StatsNav } from "./stats-nav";

/**
 * Haut commun des pages de Statistiques : titre (le seul `<h1>`) avec sa ligne d'aide, sous-navigation (sous le
 * titre, comme les autres pages à onglets), retour d'une action, sélecteur unique, puis la période en toutes lettres. Un seul bouton principal (`primaryAction` :
 * « Exporter » sur la page Pubs, aucun ailleurs).
 */
export function StatsTop({
  page,
  filters,
  options,
  sp,
  help,
  primaryAction,
  secondaryActions,
  showCompare = true,
  showChannel = true,
  channelHelp,
  note,
}: {
  page: StatsPageKey;
  filters: Filters;
  options: StatsOptions;
  sp: { ok?: string | string[]; error?: string | string[]; forbidden?: string | string[] };
  help?: React.ReactNode;
  primaryAction?: PageAction;
  secondaryActions?: React.ReactNode;
  showCompare?: boolean;
  showChannel?: boolean;
  channelHelp?: string;
  /** Phrase en plus après la période (ex. « Chiffres calculés le … »). */
  note?: React.ReactNode;
}) {
  const p = statsPage(page);
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <>
      <PageHeader
        title={p.title}
        description={withTerm(p.description, p.termOn, p.term)}
        help={help}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
      />
      <StatsNav current={page} filters={filters} />
      <Flash
        ok={first(sp.ok)}
        error={
          first(sp.forbidden) ? "Cette action est réservée aux administrateurs." : first(sp.error)
        }
      />
      <StatsFilters
        // Remis à zéro quand l'adresse change (bouton Précédent du navigateur) : les champs suivent l'adresse.
        key={statsHref(p.path, filters)}
        action={p.path}
        period={filters.period}
        compare={filters.compare}
        vertical={filters.vertical}
        campaignId={filters.campaignId}
        channelId={filters.channelId}
        campaigns={options.campaigns}
        channels={options.channels}
        showCompare={showCompare}
        showChannel={showChannel}
        channelHelp={channelHelp}
      />
      <p className="mb-6 text-note text-muted-foreground">
        {periodSentence(filters.period, filters.compare && showCompare)}.
        {note ? <> {note}</> : null}
      </p>
    </>
  );
}

/** Ligne d'aide avec le terme technique au survol des mots `on` (« parcours » → entonnoir). */
function withTerm(text: string, on?: string, term?: string): React.ReactNode {
  const at = on && term ? text.indexOf(on) : -1;
  if (at < 0 || !on) return text;
  return (
    <>
      {text.slice(0, at)}
      <Term term={term}>{on}</Term>
      {text.slice(at + on.length)}
    </>
  );
}
