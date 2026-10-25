import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { TimeChart } from "@/components/charts/time-chart";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  COUNTRY_CODES,
  MARKETS,
  SENTIMENTS,
  TREND_CATEGORIES,
  countriesText,
  countryName,
  hostOf,
  safeUrl,
  scoreText,
  viewHref,
  weeklyCounts,
  type TrendFilters,
} from "@/lib/agents/analyses";
import type { TrendRow } from "@/lib/agents/analyses-queries";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { cn } from "@/lib/utils";

const SELECT_LABEL = "text-note font-medium text-muted-foreground";

function TrendItem({ t }: { t: TrendRow }) {
  const url = safeUrl(t.url);
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="trendCategory" value={t.category} />
        <StatusBadge kind="trendSentiment" value={t.sentiment} />
        <span className="text-note text-muted-foreground">Pertinence {scoreText(t.relevanceScore)}</span>
        {!t.verified ? (
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-note text-muted-foreground" title="Une seule source, pas encore recoupée">
            Non vérifiée
          </span>
        ) : null}
      </div>
      {t.title ? <p className="font-medium text-foreground">{t.title}</p> : null}
      <p className="text-body text-foreground">{t.summary}</p>
      <p className="text-note text-muted-foreground">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer noopener" className="text-info underline underline-offset-4">
            {t.sourceName} ({hostOf(url)})
          </a>
        ) : (
          t.sourceName
        )}
        {" · "}
        {t.publishedAt ? `publié le ${fmtDate(t.publishedAt)}` : `relevé le ${fmtDate(t.createdAt)}`}
        {t.author ? ` · par ${t.author}` : ""}
        {" · "}
        {countriesText(t.countries)}
      </p>
    </li>
  );
}

/**
 * Vue « Tendances » : ce que la veille a relevé (résumé en français, source cliquable, date, « non vérifiée » quand une
 * seule source le dit), filtré par marché, pays, catégorie, ton et pertinence, avec la courbe des entrées par semaine.
 */
export function TrendsView({
  filters,
  rows,
  total,
  weekDates,
  now,
}: {
  filters: TrendFilters;
  rows: TrendRow[];
  total: number;
  weekDates: Date[];
  now: Date;
}) {
  const curve = weeklyCounts(weekDates, now);
  const filtered = Boolean(filters.market || filters.country || filters.category || filters.sentiment);
  const byMarket = MARKETS.map((m) => ({ market: m, list: rows.filter((r) => r.market === m) })).filter((g) => g.list.length > 0);
  return (
    <div className="space-y-6">
      <form
        method="get"
        aria-label="Filtrer les tendances"
        className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-3 sm:items-end md:grid-cols-6 md:p-4"
      >
        <div className="min-w-0 space-y-1">
          <Label htmlFor="tr-marche" className={SELECT_LABEL}>
            Marché
          </Label>
          <NativeSelect id="tr-marche" name="marche" defaultValue={filters.market ?? ""} wrapperClassName="w-full">
            <option value="">Tous les marchés</option>
            {MARKETS.map((m) => (
              <option key={m} value={m}>
                {statusLabel("vertical", m)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="tr-pays" className={SELECT_LABEL}>
            Pays
          </Label>
          <NativeSelect id="tr-pays" name="pays" defaultValue={filters.country ?? ""} wrapperClassName="w-full">
            <option value="">Tous les pays</option>
            {COUNTRY_CODES.map((c) => (
              <option key={c} value={c}>
                {countryName(c)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="tr-categorie" className={SELECT_LABEL}>
            Catégorie
          </Label>
          <NativeSelect id="tr-categorie" name="categorie" defaultValue={filters.category ?? ""} wrapperClassName="w-full">
            <option value="">Toutes</option>
            {TREND_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {statusLabel("trendCategory", c)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="tr-ton" className={SELECT_LABEL}>
            Ton
          </Label>
          <NativeSelect id="tr-ton" name="ton" defaultValue={filters.sentiment ?? ""} wrapperClassName="w-full">
            <option value="">Tous</option>
            {SENTIMENTS.map((s) => (
              <option key={s} value={s}>
                {statusLabel("trendSentiment", s)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="tr-score" className={SELECT_LABEL}>
            Pertinence au moins
          </Label>
          <NativeSelect id="tr-score" name="score" defaultValue={String(filters.minScore)} wrapperClassName="w-full">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {scoreText(n)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" className="max-md:h-10">
          Filtrer
        </Button>
      </form>

      <FormSection
        title="Entrées par semaine"
        description="Combien de contenus utiles la veille a relevés chaque semaine, avec les filtres choisis."
      >
        <TimeChart
          title="Entrées de veille par semaine"
          period={`${curve.labels.length} dernières semaines`}
          labels={curve.labels}
          series={[{ id: "entries", label: "Entrées", values: curve.values, tone: "current" }]}
          format="number"
          integer
          unitLabel="Semaine"
          valuesSummary="Voir les chiffres semaine par semaine"
        />
      </FormSection>

      <FormSection
        title="Tendances récentes"
        description={
          total
            ? `${fmtNum(total)} entrée${total > 1 ? "s" : ""}${total > rows.length ? ` · les ${fmtNum(rows.length)} plus récentes` : ""}. Chaque entrée renvoie à sa source.`
            : undefined
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<TrendingUp />}
            title={filtered ? "Rien pour ces filtres" : "Pas encore de tendance"}
            description={
              filtered
                ? "Changez de pays, de catégorie ou baissez la pertinence minimale."
                : "La veille lit ses sources chaque jour : les premières entrées arrivent après son premier passage."
            }
            action={filtered ? { href: viewHref("tendances"), label: "Effacer les filtres", variant: "outline" } : undefined}
          />
        ) : (
          <div className="space-y-6">
            {byMarket.map((g) => (
              <div key={g.market} className="space-y-2">
                <h3 className="flex items-center gap-2 text-body font-semibold text-foreground">
                  <StatusBadge kind="vertical" value={g.market} />
                  <span className="font-normal text-muted-foreground">({fmtNum(g.list.length)})</span>
                </h3>
                <ul className="space-y-3">
                  {g.list.map((t) => (
                    <TrendItem key={t.id} t={t} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </FormSection>
      <p className={cn("text-note text-muted-foreground")}>
        Pour une réponse en quelques lignes, demandez à Kevin : « qu&apos;est-ce qui marche en casino en France ? ».{" "}
        <Link href="/agents/boss" className="underline underline-offset-4">
          Parler à Kevin
        </Link>
      </p>
    </div>
  );
}
