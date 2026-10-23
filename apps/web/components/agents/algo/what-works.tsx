import { BarList } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { EmptyState } from "@/components/admin/empty-state";
import { Term } from "@/components/admin/help-tip";
import {
  FORMAT_LABELS,
  LENGTH_BUCKETS,
  notEnoughSentence,
  pctText,
  type GroupStats,
  type Ranking,
  type Summary,
  type Thresholds,
} from "@/lib/agents/algo/insights";
import { fmtNum } from "@/lib/format";

const DAY_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const DAY_NAMES = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

export type Labeler = (key: string) => string;

export const formatLabel: Labeler = (k) => FORMAT_LABELS[k] ?? k;
export const hourLabel: Labeler = (k) => `${k} h`;
export const weekdayLabel: Labeler = (k) => DAY_NAMES[Number(k)] ?? k;
export const lengthLabel: Labeler = (k) => LENGTH_BUCKETS.find((b) => b.key === k)?.label ?? k;

function note(g: GroupStats): string {
  const parts = [`${fmtNum(g.posts)} post${g.posts > 1 ? "s" : ""}`, `${fmtNum(g.views)} vues`];
  if (g.avgViews24h !== null) parts.push(`${fmtNum(Math.round(g.avgViews24h))} vues à 24 h en moyenne`);
  if (g.registrationsPer1000 !== null && g.registrations > 0)
    parts.push(`${g.registrationsPer1000.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} inscriptions pour 1 000 vues`);
  return parts.join(" · ");
}

/** Un classement : barres des cas comparables (ceux au-dessus de la valeur du milieu en orange), puis les autres. */
export function RankingBlock({
  title,
  ranking,
  label,
  thresholds,
}: {
  title: string;
  ranking: Ranking;
  label: Labeler;
  thresholds: Thresholds;
}) {
  const works = new Set(ranking.works.map((g) => g.key));
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="text-body font-semibold text-foreground">{title}</h3>
      {ranking.ranked.length === 0 ? (
        <p className="text-note text-muted-foreground">
          Pas encore assez de données pour conclure : il faut {fmtNum(thresholds.minPosts)} posts ou{" "}
          {fmtNum(thresholds.minViews)} vues dans un même cas. Un test A/B peut être proposé à la place.
        </p>
      ) : (
        <BarList
          label={title}
          items={ranking.ranked.map((g) => ({
            key: g.key,
            label: label(g.key),
            value: g.offerCtr ?? 0,
            valueText: pctText(g.offerCtr),
            note: note(g),
            emphasis: works.has(g.key),
          }))}
        />
      )}
      {ranking.ranked.length === 1 ? (
        <p className="text-note text-muted-foreground">Un seul cas a assez de données : rien à comparer pour l&apos;instant.</p>
      ) : null}
      {ranking.notEnough.length > 0 ? (
        <details className="text-note text-muted-foreground">
          <summary className="cursor-pointer">
            {ranking.notEnough.length} cas pas encore concluant{ranking.notEnough.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-2 space-y-1">
            {ranking.notEnough.slice(0, 12).map((g) => (
              <li key={g.key}>
                <span className="text-foreground">{label(g.key)}</span> : {notEnoughSentence(g, thresholds)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Heures et jours : colonnes du taux de clic sur l'offre, les cas au-dessus de la valeur du milieu en orange plein. */
export function WindowsCharts({ summary, thresholds }: { summary: Summary; thresholds: Thresholds }) {
  const hourWorks = new Set(summary.hour.works.map((g) => g.key));
  const hourOk = new Set(summary.hour.ranked.map((g) => g.key));
  const dayWorks = new Set(summary.weekday.works.map((g) => g.key));
  const dayOk = new Set(summary.weekday.ranked.map((g) => g.key));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h3 className="text-body font-semibold text-foreground">Taux de clic sur l&apos;offre selon l&apos;heure d&apos;envoi</h3>
        <p className="text-note text-muted-foreground">
          Heure de Paris. Orange plein : au-dessus de la <Term term="médiane">valeur du milieu</Term> ; gris : moins de{" "}
          {fmtNum(thresholds.minPosts)} posts et de {fmtNum(thresholds.minViews)} vues.
        </p>
        <ColumnChart
          title="Taux de clic sur l'offre par heure d'envoi"
          unitLabel="Heure"
          valuesSummary="Voir les chiffres heure par heure"
          items={summary.hours.values.map((v, h) => {
            const n = summary.hours.posts[h] ?? 0;
            return {
            key: String(h),
            label: `${h} h`,
            value: v,
            valueText: n ? `${pctText(v)} sur ${fmtNum(n)} posts` : "aucun post",
            emphasis: hourWorks.has(String(h)),
            muted: n > 0 && !hourOk.has(String(h)),
            };
          })}
        />
      </div>
      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h3 className="text-body font-semibold text-foreground">Taux de clic sur l&apos;offre selon le jour</h3>
        <p className="text-note text-muted-foreground">Mêmes règles, jour par jour (heure de Paris).</p>
        <ColumnChart
          title="Taux de clic sur l'offre par jour de la semaine"
          unitLabel="Jour"
          valuesSummary="Voir les chiffres jour par jour"
          items={summary.weekdays.values.map((v, i) => {
            const n = summary.weekdays.posts[i] ?? 0;
            return {
            key: String(i + 1),
            label: DAY_SHORT[i] ?? "",
            value: v,
            valueText: n ? `${pctText(v)} sur ${fmtNum(n)} posts` : "aucun post",
            emphasis: dayWorks.has(String(i + 1)),
            muted: n > 0 && !dayOk.has(String(i + 1)),
            };
          })}
        />
      </div>
    </div>
  );
}

/** « Ce qui ne marche pas » : les cas sous la valeur du milieu, toutes dimensions confondues. */
export function DoesNotWork({
  items,
}: {
  items: Array<{ dimension: string; label: string; group: GroupStats }>;
}) {
  if (items.length === 0)
    return (
      <EmptyState
        title="Rien à signaler"
        description="Aucun cas avec assez de données ne passe sous la valeur du milieu sur cette période."
      />
    );
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={`${it.dimension}-${it.group.key}`} className="rounded-lg border border-border bg-card px-3 py-2 text-body">
          <span className="font-medium text-foreground">
            {it.dimension} : {it.label}
          </span>{" "}
          <span className="text-muted-foreground">
            — {pctText(it.group.offerCtr)} de clics sur l&apos;offre ({note(it.group)})
          </span>
        </li>
      ))}
    </ul>
  );
}
