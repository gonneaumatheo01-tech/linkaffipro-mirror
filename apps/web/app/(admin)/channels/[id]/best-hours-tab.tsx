import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate, fmtNum, fmtPct } from "@/lib/format";
import { loadBestHours } from "@/lib/besthours/queries";
import {
  ALL_CATEGORIES,
  dayShort,
  intensity,
  maxValue,
  recommendationSentence,
  slotLabel,
  type BestHoursCell,
} from "@/lib/besthours/types";
import { cn } from "@/lib/utils";
import { recomputeBestHoursAction } from "./actions";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = [1, 2, 3, 4, 5, 6, 7];
/** Couleurs sobres par intensité 0–4 (classes Tailwind complètes pour que le build les garde). */
const INTENSITY_CLASS = [
  "bg-muted/30 text-muted-foreground/60",
  "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  "bg-sky-200 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100",
  "bg-sky-300 text-sky-950 dark:bg-sky-800/70 dark:text-sky-50",
  "bg-sky-500 text-white dark:bg-sky-600",
];

function cellTitle(c: BestHoursCell): string {
  const parts = [`${slotLabel(c.day, c.hour)} : ${fmtNum(c.posts)} message(s)`];
  if (c.ctr !== null) parts.push(`taux de clic ${fmtPct(c.ctr)}`);
  parts.push(
    `${c.clicksPerPost.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} clic(s)/message`,
  );
  parts.push(
    `${c.reactionsPerPost.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} réaction(s)/message`,
  );
  return parts.join(" · ");
}

/** Onglet « Meilleurs horaires » de la fiche canal : carte 7 × 24, filtre par catégorie, recommandation. */
export async function BestHoursTab({
  channelId,
  categoryParam,
}: {
  channelId: string;
  categoryParam?: string;
}) {
  const [data, categories] = await Promise.all([
    loadBestHours(channelId),
    prisma.messageCategory.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, color: true },
    }),
  ]);
  const catKey = categoryParam && data?.categories[categoryParam] ? categoryParam : ALL_CATEGORIES;
  const cat = data?.categories[catKey];
  const cells = cat?.cells ?? [];
  const byKey = new Map(cells.map((c) => [`${c.day}:${c.hour}`, c]));
  const max = maxValue(cells);
  const rec = cat?.recommendation ?? null;
  const metricNote = cells.some((c) => c.ctr !== null)
    ? "Couleur = taux de clic (cliqueurs uniques / vues)."
    : "Couleur = clics par message (les vues ne sont pas encore transmises par Telegram).";
  const availableCats = categories.filter((c) => data?.categories[c.id]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Meilleurs horaires{" "}
              <HelpTip label="Aide : meilleurs horaires">
                Pour chaque jour et chaque heure (heure de Paris), la moyenne des messages envoyés
                dans ce canal sur les {data?.weeks ?? 8} dernières semaines : taux de clic si les
                vues sont connues, sinon clics par message, et réactions par message. Un créneau est
                recommandé à partir de {data?.minPosts ?? 3} messages.
              </HelpTip>
            </CardTitle>
            <CardDescription>
              {data
                ? `Calculé le ${fmtDate(new Date(data.computedAt))} sur ${fmtNum(data.posts)} message(s) envoyé(s).`
                : "Jamais calculé pour l'instant : le calcul tourne chaque nuit, ou cliquez « Recalculer maintenant »."}
            </CardDescription>
          </div>
          <form action={recomputeBestHoursAction}>
            <input type="hidden" name="channelId" value={channelId} />
            <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
              Recalculer maintenant
            </Button>
          </form>
        </CardHeader>
        <CardContent className="space-y-4">
          <nav aria-label="Catégorie" className="flex flex-wrap gap-2 text-sm">
            <Link
              href={`/channels/${channelId}?tab=besthours`}
              aria-current={catKey === ALL_CATEGORIES ? "page" : undefined}
              className={cn(
                "rounded-md border px-3 py-1.5 md:py-1",
                catKey === ALL_CATEGORIES ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              Toutes catégories
            </Link>
            {availableCats.map((c) => (
              <Link
                key={c.id}
                href={`/channels/${channelId}?tab=besthours&cat=${c.id}`}
                aria-current={catKey === c.id ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 md:py-1",
                  catKey === c.id ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: c.color }}
                  aria-hidden="true"
                />
                {c.name}
              </Link>
            ))}
          </nav>

          {!data || data.posts === 0 ? (
            <EmptyState
              title="Pas encore de données"
              description="Dès que des messages auront été envoyés dans ce canal, leurs clics et réactions rempliront cette carte. Le calcul se fait chaque nuit."
              action={{ href: "/messages/new", label: "Programmer un message", variant: "outline" }}
            />
          ) : (
            <>
              <p className="text-sm">
                {rec ? (
                  <>
                    <strong>{recommendationSentence(cat, data.minPosts)}</strong>{" "}
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-1 h-7 max-md:h-10"
                      render={
                        <Link
                          href={`/messages/new?channel=${channelId}${catKey !== ALL_CATEGORIES ? `&category=${catKey}` : ""}`}
                        />
                      }
                    >
                      Programmer à ce créneau
                    </Button>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {recommendationSentence(cat, data.minPosts)}
                  </span>
                )}
              </p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[820px] border-collapse text-[11px]">
                  <caption className="sr-only">
                    Messages envoyés par jour et par heure, avec taux de clic et réactions
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="w-12 p-1 text-left font-medium">
                        Jour
                      </th>
                      {HOURS.map((h) => (
                        <th
                          scope="col"
                          key={h}
                          className="p-1 text-center font-normal text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((d) => (
                      <tr key={d}>
                        <th scope="row" className="p-1 text-left font-medium">
                          {dayShort(d)}
                        </th>
                        {HOURS.map((h) => {
                          const c = byKey.get(`${d}:${h}`);
                          const isRec = rec && rec.day === d && rec.hour === h;
                          return (
                            <td
                              key={h}
                              title={c ? cellTitle(c) : `${slotLabel(d, h)} : aucun message`}
                              className={cn(
                                "h-7 border text-center tabular-nums",
                                INTENSITY_CLASS[intensity(c, max)],
                                isRec ? "ring-2 ring-inset ring-amber-500" : null,
                              )}
                            >
                              {c ? c.posts : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Le chiffre dans une case = nombre de messages envoyés à ce jour et à cette heure.{" "}
                {metricNote} Le cadre orange marque le créneau recommandé. Survolez une case pour le
                détail.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
