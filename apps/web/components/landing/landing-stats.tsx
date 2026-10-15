import Link from "next/link";
import { Download } from "lucide-react";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { AdvancedSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { PeriodSelect } from "@/components/admin/period-select";
import { StatCard } from "@/components/admin/stat-card";
import { StatusPill } from "@/components/admin/status-pill";
import { BarList } from "@/components/charts/bar-list";
import { NumCell, STAT_GRID_PHONE } from "@/components/dashboard/cells";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { comparableVariation } from "@/lib/dashboard/display";
import { exactMoney, groupMoney, groupMoneyDigits } from "@/lib/campaigns/cards";
import { fmtNum, fmtPct } from "@/lib/format";
import { shortUrl, sourcePublicUrl } from "@/lib/landing/form";
import {
  LANDING_OS_LABELS,
  SPEND_NOTE_TEXT,
  costSortValue,
  costView,
  methodLabel,
  type CostView,
  type DirectLinksView,
  type LandingFigures,
  type LandingPageTable,
  type LandingSourceRow,
} from "@/lib/landing/stats";
import { periodLabelWithDates, periodParams, type Period } from "@/lib/periods";
import { CopyLinkButton } from "./copy-link-button";
import { ScrollToHash } from "./scroll-to-hash";

/** Explication de « join », au survol (mot du client gardé tel quel). */
export const JOIN_TERM = "join = demande d'adhésion au canal";

/** Nom affiché d'une source. */
export function sourceName(key: string): string {
  return key ? key : "Lien principal";
}

function plural(n: number, one: string, many: string): string {
  return `${fmtNum(n)} ${n > 1 ? many : one}`;
}

/** Cellule « Coût par join » : « — », le coût, ou la dépense avec « aucun join » en dessous. */
function CostCell({ view, digits }: { view: CostView; digits: 0 | 2 }) {
  if (view.kind === "cost") return <NumCell value={groupMoney(view.value, digits)} />;
  if (view.kind === "noJoin")
    return <NumCell value={groupMoney(view.spend, digits)} note="dépensés, aucun join" />;
  return <NumCell value="—" />;
}

/** Ligne d'aide de la carte « Coût par join » de la page. */
function costHint(t: LandingFigures | null, view: CostView): string {
  if (!t?.adLinked) return "Reliez une source à une pub pour le voir";
  if (t.spendNote === "campaign")
    return "Dépense saisie pour toute la campagne : pas de coût par pub";
  if (t.spendNote === "none" || t.spend === null) return "Aucune dépense de pub sur la période";
  if (view.kind === "noJoin") return `${exactMoney(view.spend)} de pub, aucun join`;
  return `${exactMoney(t.spend)} de pub`;
}

/**
 * Chiffres d'une page d'atterrissage (rubrique « Pages », phase 15) sur la période choisie : cartes de la page
 * (visites, clics, demandes, % visite → join, coût par join), tableau par source (5 colonnes ; tout le détail au clic),
 * sources inconnues ou retirées vues dans les adresses, ouverture de Telegram par téléphone (détail par appli replié),
 * et en dessous la comparaison avec les liens directs des pubs du même canal (même partage de la dépense d'une pub
 * entre la page et son lien direct : rien n'est compté deux fois). Composant serveur.
 */
export function LandingStats({
  pageId,
  table,
  previous,
  period,
  compare,
  direct,
  slug,
  trackingBase,
  adNames,
  readyKeys,
}: {
  pageId: string;
  table: LandingPageTable | null;
  previous: LandingPageTable | null;
  period: Period;
  compare: boolean;
  direct: DirectLinksView;
  slug: string;
  trackingBase: string;
  /** Noms des pubs reliées, par identifiant. */
  adNames: Record<string, string>;
  /** Sources dont le lien Telegram est prêt. */
  readyKeys: string[];
}) {
  const t = table?.totals ?? null;
  const p = previous?.totals ?? null;
  const v = (k: "visits" | "clicks" | "requests") =>
    compare && p && t ? comparableVariation(t[k], p[k]) : undefined;
  const rows = table?.sources ?? [];
  const views = rows.map((r) => costView(r));
  const digits = groupMoneyDigits(
    views.map((c) => (c.kind === "cost" ? c.value : c.kind === "noJoin" ? c.spend : null)),
  );
  const periodText = periodLabelWithDates(period);
  const exportHref = `/pages/${pageId}/export?${new URLSearchParams(periodParams(period)).toString()}`;
  const totalView = costView(t ?? { spend: null, costPerJoin: null });
  const unknown = table?.unknownSources ?? [];
  const unknownVisits = unknown.reduce((s, u) => s + u.visits, 0);

  const dataRows: DataTableRow[] = rows.map((r, i) => ({
    id: r.key || "_principal",
    detailTitle: r.key ? `Source « ${r.key} »` : "Lien principal",
    detailDescription: periodText,
    cells: {
      source: (
        <span className="inline-flex flex-wrap items-center gap-2">
          {sourceName(r.key)}
          {r.isActive ? null : <StatusPill tone="muted">Retirée</StatusPill>}
        </span>
      ),
      visits: <NumCell value={fmtNum(r.visits)} />,
      clicks: (
        <NumCell
          value={fmtNum(r.clicks)}
          note={r.clickRate === null ? null : `${fmtPct(r.clickRate)} de clic`}
        />
      ),
      requests: (
        <NumCell
          value={fmtNum(r.requests)}
          note={`${plural(r.approved, "accepté", "acceptés")}${r.visitToJoin === null ? "" : ` · ${fmtPct(r.visitToJoin)}`}`}
        />
      ),
      cost: <CostCell view={views[i]!} digits={digits} />,
    },
    sortValues: {
      source: r.key,
      visits: r.visits,
      clicks: r.clicks,
      requests: r.requests,
      cost: costSortValue(views[i]!),
    },
    detail: (
      <SourceDetail
        row={r}
        url={sourcePublicUrl(trackingBase, slug, r.key)}
        ready={r.isActive && readyKeys.includes(r.key)}
        adName={r.adId ? (adNames[r.adId] ?? "Pub supprimée") : null}
      />
    ),
  }));

  return (
    <section id="chiffres" aria-labelledby="landing-stats-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="landing-stats-title" className="text-title text-foreground">
            Chiffres
          </h2>
          <p className="text-note text-muted-foreground">
            {periodText}. Les robots ne sont jamais comptés.
          </p>
        </div>
        <Link
          href={exportHref}
          prefetch={false}
          className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
        >
          <Download aria-hidden />
          Exporter
        </Link>
      </div>
      {/* `#chiffres` : après « Appliquer », la page revient ici et non sur le formulaire. */}
      <PeriodSelect period={period} compare={compare} action={`/pages/${pageId}#chiffres`} />
      <ScrollToHash id="chiffres" />

      <div
        className={cn(
          "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5",
          STAT_GRID_PHONE,
        )}
      >
        <StatCard label="Visites" value={fmtNum(t?.visits ?? 0)} variation={v("visits")} />
        <StatCard
          label="Clics"
          value={fmtNum(t?.clicks ?? 0)}
          variation={v("clicks")}
          hint={t?.clickRate == null ? undefined : `${fmtPct(t.clickRate)} de clic`}
        />
        <StatCard
          label="Demandes"
          value={fmtNum(t?.requests ?? 0)}
          variation={v("requests")}
          hint={plural(t?.approved ?? 0, "accepté", "acceptés")}
        />
        <StatCard
          label="% visite → join"
          term={JOIN_TERM}
          value={fmtPct(t?.visitToJoin ?? null)}
          hint="Demandes ÷ visites"
        />
        <StatCard
          label="Coût par join"
          term={JOIN_TERM}
          value={totalView.kind === "cost" ? exactMoney(totalView.value) : "—"}
          hint={costHint(t, totalView)}
        />
      </div>

      <DataTable
        label="Chiffres par source"
        panelSize="md"
        columns={[
          { key: "source", header: "Source" },
          { key: "visits", header: "Visites", align: "right", hideOnMobile: true },
          { key: "clicks", header: "Clics", align: "right", hideOnMobile: true },
          { key: "requests", header: "Demandes", align: "right" },
          {
            key: "cost",
            header: "Coût par join",
            term: JOIN_TERM,
            align: "right",
            hideOnMobile: true,
          },
        ]}
        rows={dataRows}
        empty={{
          title: "Aucune source",
          description: "Ajoutez une source par pub dans le formulaire ci-dessus.",
        }}
      />
      <div className="space-y-1">
        <p className="text-note text-muted-foreground">
          Sous les demandes : les acceptés et le <Term term={JOIN_TERM}>% visite → join</Term>.
          Cliquez sur une source pour tout voir.
        </p>
        {unknownVisits > 0 ? (
          <p className="text-note text-warning" role="note">
            {plural(unknownVisits, "visite", "visites")} avec une source inconnue ou retirée (
            {unknown
              .slice(0, 5)
              .map((u) => u.raw)
              .join(", ")}
            {unknown.length > 5 ? "…" : ""}) : comptées dans «&nbsp;Lien principal&nbsp;». Vérifiez
            l&apos;adresse collée dans la pub.
          </p>
        ) : null}
      </div>

      <OpenedSection figures={t} />

      <DirectLinksSection direct={direct} page={t} />
    </section>
  );
}

/** Tout le détail d'une source (volet du tableau). */
function SourceDetail({
  row,
  url,
  ready,
  adName,
}: {
  row: LandingSourceRow;
  url: string;
  ready: boolean;
  adName: string | null;
}) {
  const view = costView(row);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-note break-all text-muted-foreground">{shortUrl(url)}</p>
        <CopyLinkButton
          url={url}
          disabledReason={
            !row.isActive ? "Source retirée." : ready ? null : "Lien Telegram pas encore prêt."
          }
        />
      </div>
      <DetailList>
        <DetailRow label="Visites">{fmtNum(row.visits)}</DetailRow>
        <DetailRow label="Clics">{fmtNum(row.clicks)}</DetailRow>
        <DetailRow label="% de clic">{fmtPct(row.clickRate)}</DetailRow>
        <DetailRow label="Demandes">{fmtNum(row.requests)}</DetailRow>
        <DetailRow label="Acceptés">{fmtNum(row.approved)}</DetailRow>
        <DetailRow label="% visite → join">{fmtPct(row.visitToJoin)}</DetailRow>
        <DetailRow label="Pub reliée">{adName ?? "Aucune"}</DetailRow>
        <DetailRow label="Dépense de la pub">
          {exactMoney(row.spend)}
          {row.spendNote ? (
            <span className="block text-note text-muted-foreground">
              {SPEND_NOTE_TEXT[row.spendNote]}
            </span>
          ) : null}
        </DetailRow>
        <DetailRow label="Coût par join">
          {view.kind === "cost"
            ? exactMoney(view.value)
            : view.kind === "noJoin"
              ? "Aucun join pour cette dépense"
              : "—"}
        </DetailRow>
      </DetailList>
      {row.opened.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-body font-semibold text-foreground">Telegram ouvert après le clic</h3>
          <DetailList>
            {row.opened.map((o) => (
              <DetailRow key={o.os} label={LANDING_OS_LABELS[o.os]}>
                {fmtPct(o.rate)} ({fmtNum(o.opened)} sur {plural(o.clicks, "clic", "clics")})
              </DetailRow>
            ))}
          </DetailList>
        </div>
      ) : null}
    </div>
  );
}

/**
 * « Telegram ouvert après le clic » : part des clics suivis de l'ouverture de l'appli, par téléphone ; replié, le
 * détail par appli (TikTok, Instagram…) et par façon d'ouvrir : les façons d'ouvrir ne se comparent que dans une même
 * appli (c'est là que la page les tire au sort). Un clic par visite, le premier appui (`loadLandingTables`) : le même
 * nombre que la colonne « Clics ».
 */
function OpenedSection({ figures }: { figures: LandingFigures | null }) {
  const opened = figures?.opened ?? [];
  const browsers = opened.flatMap((o) => o.browsers);
  return (
    <section aria-labelledby="landing-opened-title" className="space-y-3">
      <div>
        <h3 id="landing-opened-title" className="text-body font-semibold text-foreground">
          Telegram ouvert après le clic
        </h3>
        <p className="text-note text-muted-foreground">
          Part des clics où la page a laissé la place à l&apos;appli Telegram dans les 2 secondes.
          Un clic par visite, comme dans le tableau : seul le premier appui compte.
        </p>
      </div>
      {opened.length === 0 ? (
        <p className="text-body text-muted-foreground">Aucun clic sur la période.</p>
      ) : (
        <>
          <BarList
            label="Telegram ouvert après le clic, par téléphone"
            labelWidth="narrow"
            max={1}
            items={opened.map((o) => ({
              key: o.os,
              label: LANDING_OS_LABELS[o.os],
              value: o.rate ?? 0,
              valueText: fmtPct(o.rate),
              note: `${fmtNum(o.opened)} sur ${plural(o.clicks, "clic", "clics")}`,
            }))}
          />
          <AdvancedSection
            title="Détail par appli et par façon d'ouvrir"
            description="Comparez les façons d'ouvrir dans une même appli."
          >
            {browsers.map((b) => (
              <div key={b.key} className="space-y-1.5">
                <h4 className="text-body font-medium text-foreground">
                  {b.label}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {fmtPct(b.rate)} sur {plural(b.clicks, "clic", "clics")}
                  </span>
                </h4>
                <DetailList>
                  {b.methods.map((m) => (
                    <DetailRow key={m.method} label={methodLabel(m.method)}>
                      {fmtPct(m.rate)}{" "}
                      <span className="text-muted-foreground">
                        ({fmtNum(m.opened)} sur {plural(m.clicks, "clic", "clics")})
                      </span>
                    </DetailRow>
                  ))}
                </DetailList>
              </div>
            ))}
            {browsers.some((b) => b.httpsInApp) ? (
              <p className="text-note text-muted-foreground">
                Lien Telegram classique dans une appli : la page de Telegram s&apos;ouvre
                d&apos;abord, et une ouverture faite depuis elle ne se voit pas. Son chiffre est un
                minimum.
              </p>
            ) : null}
          </AdvancedSection>
        </>
      )}
    </section>
  );
}

/** Comparaison : liens directs des pubs du même canal, même période. */
function DirectLinksSection({
  direct,
  page,
}: {
  direct: DirectLinksView;
  page: LandingFigures | null;
}) {
  const views = direct.rows.map((r) => costView(r));
  const pageView = costView(page ?? { spend: null, costPerJoin: null });
  const totalView = costView(direct.totals);
  const digits = groupMoneyDigits([
    ...views.map((c) => (c.kind === "cost" ? c.value : c.kind === "noJoin" ? c.spend : null)),
    totalView.kind === "cost" ? totalView.value : null,
    pageView.kind === "cost" ? pageView.value : null,
  ]);
  const shared = direct.rows.some((r) => r.sharedWithPage);
  const rows: DataTableRow[] = direct.rows.map((r, i) => ({
    id: r.inviteLinkId,
    detailTitle: r.name,
    cells: {
      name: (
        <span className="whitespace-normal">
          {r.name}
          {r.isActive ? null : (
            <span className="ml-2 text-note text-muted-foreground">(désactivé)</span>
          )}
        </span>
      ),
      clicks: <NumCell value={fmtNum(r.clicks)} />,
      requests: (
        <NumCell value={fmtNum(r.requests)} note={plural(r.approved, "accepté", "acceptés")} />
      ),
      rate: <NumCell value={fmtPct(r.clickToJoin)} />,
      cost: <CostCell view={views[i]!} digits={digits} />,
    },
    sortValues: {
      name: r.name,
      clicks: r.clicks,
      requests: r.requests,
      rate: r.clickToJoin,
      cost: costSortValue(views[i]!),
    },
    detail: (
      <div className="space-y-4">
        <DetailList>
          <DetailRow label="Clics">{fmtNum(r.clicks)}</DetailRow>
          <DetailRow label="Demandes">{fmtNum(r.requests)}</DetailRow>
          <DetailRow label="Acceptés">{fmtNum(r.approved)}</DetailRow>
          <DetailRow label="% clic → join">{fmtPct(r.clickToJoin)}</DetailRow>
          <DetailRow label="Dépense de la pub">
            {exactMoney(r.spend)}
            {r.spendNote ? (
              <span className="block text-note text-muted-foreground">
                {SPEND_NOTE_TEXT[r.spendNote]}
              </span>
            ) : null}
          </DetailRow>
          <DetailRow label="Coût par join">{groupMoney(r.costPerJoin, 2)}</DetailRow>
        </DetailList>
        {r.sharedWithPage ? (
          <p className="text-note text-muted-foreground">
            Cette pub mène aussi à une page : sa dépense est partagée selon les clics et les visites
            de chaque côté.
          </p>
        ) : null}
      </div>
    ),
  }));
  return (
    <section aria-labelledby="landing-direct-title" className="space-y-3">
      <div>
        <h3 id="landing-direct-title" className="text-body font-semibold text-foreground">
          Comparaison avec les liens directs des pubs
        </h3>
        <p className="text-note text-muted-foreground">
          Même canal, même période : les pubs qui envoient directement vers Telegram, sans la page.
        </p>
      </div>
      {direct.rows.length === 0 ? (
        <p className="text-body text-muted-foreground">
          Aucun lien direct de pub n&apos;a servi sur cette période pour ce canal.
        </p>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <dt className="text-note font-medium text-muted-foreground">Cette page</dt>
              <dd className="mt-1 text-body text-foreground">
                <span className="font-semibold tabular-nums">
                  {fmtPct(page?.visitToJoin ?? null)}
                </span>{" "}
                visite → join ·{" "}
                <span className="tabular-nums">
                  {pageView.kind === "cost" ? groupMoney(pageView.value, digits) : "—"}
                </span>{" "}
                par join
              </dd>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <dt className="text-note font-medium text-muted-foreground">Liens directs</dt>
              <dd className="mt-1 text-body text-foreground">
                <span className="font-semibold tabular-nums">
                  {fmtPct(direct.totals.clickToJoin)}
                </span>{" "}
                clic → join ·{" "}
                <span className="tabular-nums">
                  {totalView.kind === "cost" ? groupMoney(totalView.value, digits) : "—"}
                </span>{" "}
                par join
              </dd>
            </div>
          </dl>
          <DataTable
            label="Liens directs des pubs du canal"
            panelSize="sm"
            columns={[
              { key: "name", header: "Pub" },
              { key: "clicks", header: "Clics", align: "right", hideOnMobile: true },
              { key: "requests", header: "Demandes", align: "right" },
              {
                key: "rate",
                header: "% clic → join",
                term: JOIN_TERM,
                align: "right",
                hideOnMobile: true,
              },
              { key: "cost", header: "Coût par join", term: JOIN_TERM, align: "right" },
            ]}
            rows={rows}
          />
          {shared ? (
            <p className="text-note text-muted-foreground">
              Une pub qui mène à la fois à une page et à son lien direct partage sa dépense entre
              les deux, selon les visites et les clics : rien n&apos;est compté deux fois.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
