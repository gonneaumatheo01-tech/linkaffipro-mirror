import type { Metadata } from "next";
import Link from "next/link";
import type { AdsAnalysis, AdsMetrics, AdsRow } from "@linkaffipro/agents";
import { AgentsNav } from "@/components/agents/agents-nav";
import { AdsRecommendationsList } from "@/components/agents/ads/ads-recommendations";
import { AdsReportsList } from "@/components/agents/ads/ads-reports";
import { AdsThresholdsForm } from "@/components/agents/ads/ads-thresholds-form";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { StatusPill } from "@/components/admin/status-pill";
import { TabNav } from "@/components/admin/tab-nav";
import { UniverseDot } from "@/components/admin/universe-dot";
import { BarList } from "@/components/charts/bar-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ADS_METRIC_VIEWS,
  ADS_PATH,
  ADS_PERIODS,
  ADS_PERIOD_LABELS,
  CONNECTORS_HREF,
  NO_CONNECTOR_SENTENCE,
  adLine,
  bestAndWorst,
  campaignRows,
  fmtAds,
  funnelSteps,
  parseAdsPeriod,
  pickCampaign,
  rankAds,
  statsHref,
  type AdsMetricKey,
} from "@/lib/agents/ads/display";
import {
  loadAdsAnalysis,
  loadAdsRecommendations,
  loadAdsReports,
  loadAdsThresholds,
} from "@/lib/agents/ads/queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtPct } from "@/lib/format";
import { fmtDayKey } from "@/lib/periods";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agent Ads" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function dayText(s: string): string {
  const k = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(k) ? fmtDayKey(k) : s;
}

function periodText(a: Pick<AdsAnalysis, "from" | "to">): string {
  const from = dayText(a.from);
  const to = dayText(a.to);
  return from === to ? from : `du ${from} au ${to}`;
}

/** Chiffre d'un total (le moteur ne donne pas le total de la période d'avant : pas de variation ici). */
function Stat({ m, k, hint }: { m: AdsMetrics; k: AdsMetricKey; hint?: string }) {
  const v = ADS_METRIC_VIEWS[k];
  return <StatCard label={v.label} term={v.term} value={fmtAds(k, m[k])} favorable={v.favorable} hint={hint} />;
}

function AdItem({ r, tone }: { r: AdsRow; tone: "best" | "worst" | "young" }) {
  return (
    <li className="space-y-0.5 rounded-xl border border-border bg-card px-4 py-3">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{r.name}</span>
        {r.vertical ? <UniverseDot universe={r.vertical} /> : null}
        {tone === "young" ? <StatusPill tone="muted">Pas encore assez de chiffres</StatusPill> : null}
      </p>
      <p className="text-note text-muted-foreground">{adLine(r)}</p>
      {r.campaignId ? (
        <Link href={`/campaigns/${r.campaignId}?tab=ads`} className="text-note underline underline-offset-4 hover:text-foreground">
          Voir la campagne
        </Link>
      ) : null}
    </li>
  );
}

const CAMPAIGN_COLUMNS: DataTableColumn[] = [
  { key: "name", header: "Campagne" },
  { key: "spend", header: "Dépense pub", align: "right" },
  { key: "gains", header: "Gains", align: "right" },
  { key: "roas", header: "Retour sur dépense pub", term: "ROAS", align: "right", hideOnMobile: true },
  { key: "cpr", header: "Coût par inscription", term: "CPA", align: "right", hideOnMobile: true },
];

const COHORT_COLUMNS: DataTableColumn[] = [
  { key: "name", header: "Pub" },
  { key: "members", header: "Membres", align: "right" },
  { key: "d7", header: "Après 7 jours", align: "right" },
  { key: "d14", header: "Après 14 jours", align: "right", hideOnMobile: true },
  { key: "d30", header: "Après 30 jours", align: "right" },
];

/**
 * Agent Ads (`/agents/ads`, phase 24), rattaché au Grand Chef : il lit chaque jour les dépenses et les résultats des
 * pubs (Meta, TikTok, coûts importés ou saisis) et ce qu'elles ont vraiment rapporté, puis RECOMMANDE (arrêter,
 * augmenter, tester, surveiller), preuves à l'appui. Il n'agit jamais chez Meta ou TikTok : le client fait l'action
 * lui-même puis clique « Fait » (ou « Refuser »). Page : résumé d'hier, recommandations, campagnes, parcours d'une
 * campagne, meilleures et pires pubs, ce que rapportent les membres après 7 / 14 / 30 jours, seuils (ADMIN),
 * rapports archivés, exports. Le détail reste dans Statistiques (liens), sans doublon.
 */
export default async function AdsAgentPage({ searchParams }: PageProps<"/agents/ads">) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const sp: SP = await searchParams;
  const period = parseAdsPeriod(one(sp.periode));
  const now = new Date();
  const [main, yesterday, recs, reports, thresholds, pending] = await Promise.all([
    loadAdsAnalysis(period, now),
    period === "yesterday" ? Promise.resolve(null) : loadAdsAnalysis("yesterday", now),
    loadAdsRecommendations(),
    loadAdsReports(),
    loadAdsThresholds(),
    loadPendingCounts(),
  ]);
  const day = yesterday ?? main;
  const a = main.ok ? main.analysis : null;
  const y = day.ok ? day.analysis : null;
  const campaignParam = one(sp.campagne);
  const campaign = a ? pickCampaign(a.rows, campaignParam) : null;
  const query: Record<string, string> = {
    ...(period !== "7d" ? { periode: period } : {}),
    ...(campaignParam && campaign?.id === campaignParam ? { campagne: campaignParam } : {}),
  };
  const qs = new URLSearchParams(query).toString();
  const from = `${ADS_PATH}${qs ? `?${qs}` : ""}`;
  const toDecide = recs.filter((r) => r.status === "PROPOSED").length;
  const connectorsMissing = (a ?? y)?.connectorsMissing ?? false;
  const dayPicks = y ? bestAndWorst(y.rows) : { best: null, worst: null };
  const ranks = a ? rankAds(a.rows) : { best: [], worst: [], young: [] };
  const campaigns = a ? campaignRows(a.rows) : [];
  const steps = campaign ? funnelSteps(campaign) : [];
  const weakest = steps.find((s) => s.weakest);

  const campaignTable: DataTableRow[] = campaigns.map((r) => ({
    id: r.id,
    href: `${ADS_PATH}?${new URLSearchParams({ ...(period !== "7d" ? { periode: period } : {}), campagne: r.id }).toString()}#parcours`,
    cells: {
      name: (
        <span className="inline-flex items-center gap-2">
          {r.vertical ? <UniverseDot universe={r.vertical} /> : null}
          {r.name}
        </span>
      ),
      spend: fmtAds("spend", r.current.spend),
      gains: fmtAds("gains", r.current.gains),
      roas: fmtAds("roas", r.current.roas),
      cpr: fmtAds("costPerRegistration", r.current.costPerRegistration),
    },
    sortValues: {
      name: r.name,
      spend: r.current.spend,
      gains: r.current.gains,
      roas: r.current.roas,
      cpr: r.current.costPerRegistration,
    },
  }));
  const cohortTable: DataTableRow[] = (a?.cohorts ?? []).map((c) => ({
    id: c.adId,
    cells: {
      name: c.name,
      members: c.members.toLocaleString("fr-FR"),
      d7: fmtAds("commissions", c.d7),
      d14: fmtAds("commissions", c.d14),
      d30: fmtAds("commissions", c.d30),
    },
    sortValues: { name: c.name, members: c.members, d7: c.d7, d14: c.d14, d30: c.d30 },
  }));

  return (
    <>
      <AgentsNav current="ads" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        backHref="/agents"
        backLabel="Agents"
        title="Agent Ads"
        description="Il lit chaque jour ce que coûtent vos pubs et ce qu'elles rapportent vraiment (membres, inscriptions, dépôts, commissions), puis vous conseille : arrêter, augmenter, tester ou surveiller, chiffres à l'appui."
        help="L'agent ne change jamais rien chez Meta ou TikTok : c'est vous qui le faites dans le gestionnaire de pubs, puis vous cliquez « Fait »."
        meta={toDecide > 0 ? <StatusPill tone="warning">{toDecide} à décider</StatusPill> : null}
        secondaryActions={
          <>
            <a
              href={`${ADS_PATH}/export?type=recommandations`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
            >
              Exporter les recommandations
            </a>
            {a ? (
              <a
                href={`${ADS_PATH}/export?type=chiffres&periode=${period}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
              >
                Exporter les chiffres
              </a>
            ) : null}
          </>
        }
      />
      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      <div className="space-y-10">
        {connectorsMissing ? (
          <p className="text-body text-foreground">
            {NO_CONNECTOR_SENTENCE}{" "}
            <Link href={CONNECTORS_HREF} className="font-medium underline underline-offset-4">
              Brancher Meta ou TikTok
            </Link>
          </p>
        ) : null}

        <FormSection
          id="resume"
          title="Résumé d'hier"
          description={y ? `${periodText(y)} : dépense, gains (commissions moins dépense pub), meilleure et pire pub.` : undefined}
        >
          {!y ? (
            <Alert variant="warning" role="status">
              <AlertTitle>Chiffres indisponibles pour l&apos;instant</AlertTitle>
              <AlertDescription>
                L&apos;analyse des pubs n&apos;a pas pu se faire ({day.ok ? "" : day.error}). Réessayez dans quelques minutes.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat m={y.totals} k="spend" />
                <Stat m={y.totals} k="gains" />
                <Stat m={y.totals} k="roas" />
                <StatCard
                  label="Recommandations à décider"
                  value={toDecide.toLocaleString("fr-FR")}
                  href="#recommandations"
                  favorable="none"
                />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-body font-semibold text-foreground">Meilleure pub d&apos;hier</h3>
                  {dayPicks.best ? (
                    <ul>
                      <AdItem r={dayPicks.best} tone="best" />
                    </ul>
                  ) : (
                    <p className="text-note text-muted-foreground">Aucune pub n&apos;a encore assez de chiffres pour être jugée.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <h3 className="text-body font-semibold text-foreground">Pire pub d&apos;hier</h3>
                  {dayPicks.worst ? (
                    <ul>
                      <AdItem r={dayPicks.worst} tone="worst" />
                    </ul>
                  ) : (
                    <p className="text-note text-muted-foreground">Rien à signaler.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </FormSection>

        <FormSection
          id="recommandations"
          title="Recommandations"
          description="Chaque conseil porte ses preuves (chiffres, période, comparaison, seuil). L'agent ne change rien chez Meta ou TikTok : faites-le vous-même, puis cliquez « Fait » ; « Refuser » l'écarte. Un commentaire aide l'agent à comprendre votre choix."
        >
          <AdsRecommendationsList recs={recs} from={from} />
        </FormSection>

        <div className="space-y-4">
          <h2 className="text-title text-foreground">Vos pubs en détail</h2>
          <TabNav
            label="Période"
            current={period}
            items={ADS_PERIODS.map((p) => ({
              key: p,
              href: `${ADS_PATH}${p === "7d" ? "" : `?periode=${p}`}`,
              label: ADS_PERIOD_LABELS[p],
            }))}
          />
          {!a ? (
            <Alert variant="warning" role="status">
              <AlertTitle>Chiffres indisponibles pour l&apos;instant</AlertTitle>
              <AlertDescription>
                L&apos;analyse des pubs n&apos;a pas pu se faire ({main.ok ? "" : main.error}). Réessayez dans quelques minutes.
              </AlertDescription>
            </Alert>
          ) : a.rows.length === 0 ? (
            <EmptyState
              title="Pas encore de pub avec des chiffres sur cette période"
              description="Les pubs apparaissent dès qu'elles ont une dépense (Meta, TikTok, coûts importés ou saisis) dans une de vos campagnes."
              action={{ href: "/campaigns", label: "Voir les campagnes", variant: "outline" }}
            />
          ) : (
            <div className="space-y-10">
              <p className="text-note text-muted-foreground">
                {ADS_PERIOD_LABELS[period]} ({periodText(a)}), comparés à la période d&apos;avant de même longueur.
              </p>
              <section aria-label="Chiffres de la période" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat m={a.totals} k="spend" />
                <Stat m={a.totals} k="commissions" />
                <Stat m={a.totals} k="gains" />
                <Stat m={a.totals} k="costPerRegistration" />
              </section>

              <FormSection
                id="campagnes"
                title="Campagnes"
                description="De la plus grosse dépense à la plus petite. Cliquez sur une campagne pour voir son parcours."
                actions={
                  <Link href={statsHref("/stats/ads", a)} className="text-note underline underline-offset-4">
                    Détail dans Statistiques → Pubs
                  </Link>
                }
              >
                <DataTable columns={CAMPAIGN_COLUMNS} rows={campaignTable} label="Campagnes de la période" />
              </FormSection>

              <FormSection
                id="parcours"
                title={campaign ? `Parcours : ${campaign.name}` : "Parcours d'une campagne"}
                description="De l'affichage de la pub au dépôt : combien passent chaque étape, et la part gardée depuis l'étape d'avant."
                actions={
                  campaign ? (
                    <Link
                      href={statsHref("/stats/funnel", a, { campaignId: campaign.id })}
                      className="text-note underline underline-offset-4"
                    >
                      Détail dans Statistiques → Parcours
                    </Link>
                  ) : null
                }
              >
                {campaigns.length > 1 ? (
                  <form method="get" action={ADS_PATH} className="flex flex-wrap items-end gap-2" aria-label="Campagne du parcours">
                    {period !== "7d" ? <input type="hidden" name="periode" value={period} /> : null}
                    <div className="space-y-1">
                      <Label htmlFor="ads-campagne">Campagne</Label>
                      <NativeSelect id="ads-campagne" name="campagne" defaultValue={campaign?.id ?? ""}>
                        {campaigns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <Button type="submit" variant="outline" className="max-md:h-10">
                      Afficher
                    </Button>
                  </form>
                ) : null}
                {steps.length === 0 ? (
                  <p className="text-note text-muted-foreground">Pas encore de chiffre sur le parcours de cette campagne.</p>
                ) : (
                  <div className="space-y-3">
                    <BarList
                      label="Parcours, étape par étape"
                      items={steps.map((s) => ({
                        key: s.key,
                        label: <Term term={s.term}>{s.label}</Term>,
                        value: s.value,
                        valueText: s.value.toLocaleString("fr-FR"),
                        note: s.rate !== null ? `${fmtPct(s.rate)} de l'étape d'avant` : undefined,
                        emphasis: s.weakest || undefined,
                      }))}
                    />
                    {weakest ? (
                      <p className="text-body text-foreground">
                        Étape la plus faible : <span className="font-medium">{weakest.label}</span>, plus basse que pour vos pubs comparables.
                      </p>
                    ) : campaign && !campaign.enoughData ? (
                      <p className="text-note text-muted-foreground">Pas encore assez de chiffres pour dire quelle étape coince.</p>
                    ) : null}
                  </div>
                )}
              </FormSection>

              <FormSection
                id="pubs"
                title="Meilleures et pires pubs"
                description="Classées par gains (commissions moins dépense pub), seulement les pubs qui ont assez de jours et de dépense."
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <h3 className="text-body font-semibold text-foreground">Les meilleures</h3>
                    {ranks.best.length ? (
                      <ul className="space-y-2">
                        {ranks.best.map((r) => (
                          <AdItem key={r.id} r={r} tone="best" />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-note text-muted-foreground">Aucune pub n&apos;a encore assez de chiffres.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-body font-semibold text-foreground">Les pires</h3>
                    {ranks.worst.length ? (
                      <ul className="space-y-2">
                        {ranks.worst.map((r) => (
                          <AdItem key={r.id} r={r} tone="worst" />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-note text-muted-foreground">Rien à signaler.</p>
                    )}
                  </div>
                </div>
                {ranks.young.length ? (
                  <details className="rounded-xl border border-border bg-card px-4 py-3">
                    <summary className="cursor-pointer font-medium text-foreground">
                      À surveiller : {ranks.young.length} pub{ranks.young.length > 1 ? "s" : ""} trop jeune
                      {ranks.young.length > 1 ? "s" : ""} ou avec trop peu de dépense
                    </summary>
                    <ul className="mt-3 space-y-2">
                      {ranks.young.slice(0, 20).map((r) => (
                        <AdItem key={r.id} r={r} tone="young" />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </FormSection>

              <FormSection
                id="membres-dans-le-temps"
                title="Ce que rapportent les membres de chaque pub"
                description="Commissions rapportées par les membres venus de chaque pub, 7, 14 et 30 jours après leur arrivée."
                actions={
                  <Link href={statsHref("/stats/cohorts", a)} className="text-note underline underline-offset-4">
                    Détail dans Statistiques → Membres dans le temps
                  </Link>
                }
              >
                <DataTable
                  columns={COHORT_COLUMNS}
                  rows={cohortTable}
                  label="Ce que rapportent les membres de chaque pub"
                  empty={{ title: "Pas encore de membre venu d'une pub sur cette période" }}
                />
              </FormSection>
            </div>
          )}
        </div>

        <FormSection
          id="seuils"
          title="Seuils par univers"
          description="Ce qui déclenche un conseil. Au départ : au moins 3 jours et 20 € de dépense par pub, coût par inscription et retour sur dépense pub automatiques (valeur du milieu de vos pubs comparables). Ils ne changent que les conseils, jamais vos pubs."
        >
          <AdsThresholdsForm thresholds={thresholds} isAdmin={isAdmin} from={from} />
        </FormSection>

        <FormSection
          id="rapports"
          title="Rapports archivés"
          description="Le rapport du jour part chaque matin sur Telegram (5 lignes au plus) ; celui de la semaine, le lundi, par univers."
        >
          <AdsReportsList reports={reports} />
        </FormSection>
      </div>
    </>
  );
}
