import {
  openBrowserAction,
  relearnSiteAction,
  setSiteUrlAction,
  testSiteAction,
} from "@/app/(admin)/agents/bookmakers/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  credentialsLabel,
  frOdds,
  gapOf,
  jobKindLabel,
  jobSummary,
  providerLabel,
  recipeSummary,
  targetLabel,
} from "@/lib/agents/bookmakers";
import type { SiteView } from "@/lib/agents/bookmakers-queries";
import { fmtDate, fmtNum, fmtPct, fmtRelative } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

/**
 * Un site de bookmaker lu directement (phase 35) : état, qui lit, dernier succès, réussite sur 24 h, méthode de
 * lecture apprise, gestes (administrateurs), dernières lectures, matchs du jour, écart avec les autres bookmakers.
 */
export function BookmakerSiteCard({
  v,
  isAdmin,
  now,
}: {
  v: SiteView;
  isAdmin: boolean;
  now: Date;
}) {
  const s = v.site;
  const recipe = recipeSummary(v.recipe);
  const id = (k: string) => `bk-${s.key}-${k}`;
  const leagues = new Map<string, typeof v.events>();
  for (const e of v.events) leagues.set(e.league, [...(leagues.get(e.league) ?? []), e]);
  const reason = s.status === "BLOCKED" || s.status === "DEGRADED" ? s.statusReason : null;

  return (
    <li
      className="space-y-4 rounded-xl border border-border bg-card px-4 py-4"
      aria-labelledby={id("title")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={id("title")} className="text-body font-medium text-foreground">
          {s.label}
        </h3>
        <StatusBadge kind="bookmakerSite" value={s.status} />
        {!s.isActive ? <StatusBadge kind="active" value="inactive" /> : null}
      </div>
      {reason ? (
        <p className="text-note text-danger">{reason.charAt(0).toUpperCase() + reason.slice(1)}.</p>
      ) : null}

      <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-note text-muted-foreground">Adresse</dt>
          <dd className="break-all">{s.baseUrl ?? "à renseigner"}</dd>
        </div>
        <div>
          <dt className="text-note text-muted-foreground">Lu par</dt>
          <dd>{targetLabel(s.readTarget)}</dd>
        </div>
        <div>
          <dt className="text-note text-muted-foreground">Dernier succès</dt>
          <dd>
            {s.lastOkAt ? `${fmtRelative(s.lastOkAt, now)} (${fmtDate(s.lastOkAt)})` : "jamais"}
          </dd>
        </div>
        <div>
          <dt className="text-note text-muted-foreground">Réussite sur 24 h</dt>
          <dd>
            {v.rate.ratio === null
              ? "aucun contrôle"
              : `${fmtPct(v.rate.ratio, 0)} sur ${fmtNum(v.rate.total)} contrôle${v.rate.total > 1 ? "s" : ""}`}
          </dd>
        </div>
        <div>
          <dt className="text-note text-muted-foreground">Compte</dt>
          <dd>{credentialsLabel(v.credentials)}</dd>
        </div>
        <div>
          <dt className="text-note text-muted-foreground">Moteur de paris du site</dt>
          <dd>{providerLabel(s.providerHint)}</dd>
        </div>
      </dl>

      <div className="space-y-1">
        <p className="text-body font-medium text-foreground">Méthode de lecture apprise</p>
        {recipe ? (
          <>
            <p className="text-body">
              {recipe.title} ({recipe.detail} le {fmtDate(v.recipe!.createdAt)}).
            </p>
            <p className="text-note text-muted-foreground">
              {recipe.marketsCount
                ? `Marchés reconnus (${fmtNum(recipe.marketsCount)}) : ${recipe.markets.join(", ")}${recipe.marketsCount > recipe.markets.length ? "…" : ""}`
                : "Aucun marché reconnu pour l'instant."}
            </p>
          </>
        ) : (
          <p className="text-note text-muted-foreground">
            Pas encore appris : le système apprend le site une fois, puis le lit par le chemin le
            plus stable.
          </p>
        )}
      </div>

      {isAdmin ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <form action={testSiteAction}>
              <input type="hidden" name="siteKey" value={s.key} />
              <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                Tester
              </Button>
            </form>
            <form action={relearnSiteAction}>
              <input type="hidden" name="siteKey" value={s.key} />
              <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                Ré-apprendre
              </Button>
            </form>
            <form action={openBrowserAction}>
              <input type="hidden" name="siteKey" value={s.key} />
              <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                Ouvrir le navigateur sur le Mac
              </Button>
            </form>
          </div>
          <form action={setSiteUrlAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="siteKey" value={s.key} />
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor={id("url")}>Adresse du site</Label>
              <Input
                id={id("url")}
                name="url"
                type="url"
                inputMode="url"
                defaultValue={s.baseUrl ?? ""}
                placeholder="https://site.com/sports"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
              Changer l&apos;adresse
            </Button>
          </form>
        </div>
      ) : null}

      <div className="space-y-1">
        <p className="text-body font-medium text-foreground">Dernières lectures</p>
        {v.jobs.length ? (
          <ul className="space-y-1 text-body">
            {v.jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-note text-muted-foreground">{fmtDate(j.createdAt)}</span>
                <span>{jobKindLabel(j.kind)}</span>
                <span className="text-note text-muted-foreground">
                  ({j.target === "mac" ? "Mac" : "serveur"})
                </span>
                <StatusBadge kind="bookmakerJob" value={j.status} />
                <span className="text-note">{jobSummary(j)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-note text-muted-foreground">Aucune lecture pour l&apos;instant.</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-body font-medium text-foreground">Matchs du jour</p>
        {v.events.length ? (
          <ul className="space-y-1 text-body">
            {[...leagues].slice(0, 8).map(([league, list]) => (
              <li key={league}>
                <span className="font-medium">{league}</span> :{" "}
                {list
                  .slice(0, 6)
                  .map(
                    (e) =>
                      `${e.homeTeam} - ${e.awayTeam} (${fmtDate(e.startsAt).slice(-5)}${e.marketsCount ? `, ${fmtNum(e.marketsCount)} marchés` : ""})`,
                  )
                  .join(", ")}
                {list.length > 6 ? ` et ${fmtNum(list.length - 6)} autres` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-note text-muted-foreground">
            Aucun match lu dans les 20 dernières minutes. Kevin les lit à la demande (« quels matchs
            sur {s.label} ce soir ? »).
          </p>
        )}
      </div>

      {v.picks.length ? (
        <div className="space-y-1">
          <p className="text-body font-medium text-foreground">
            Écart avec les autres bookmakers (paris des 7 derniers jours)
          </p>
          <ul className="space-y-1 text-body">
            {v.picks.map((p) => {
              const g = gapOf(p);
              return (
                <li key={p.id}>
                  {p.homeTeam} - {p.awayTeam}, {p.selectionLabel || p.marketLabel} :{" "}
                  {frOdds(p.odds)}
                  {g ? (
                    <span className={g.unusual ? "text-danger" : "text-muted-foreground"}>
                      {" "}
                      (moyenne des autres {frOdds(p.consensusOdds!)}, écart {g.pct > 0 ? "+" : ""}
                      {g.pct.toLocaleString("fr-FR")} %{g.unusual ? ", cote inhabituelle" : ""})
                    </span>
                  ) : (
                    <span className="text-muted-foreground"> (pas de comparaison)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
