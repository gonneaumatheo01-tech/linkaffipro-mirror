import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Trophy } from "lucide-react";
import { pickPostWinner } from "@linkaffipro/core";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { StatusPill } from "@/components/admin/status-pill";
import { Term } from "@/components/admin/help-tip";
import { BarList } from "@/components/messages/bar-list";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { loadPostAbComparison, type PostVariantRow } from "@/lib/posts/ab-queries";
import { parseButtons } from "@/lib/posts/buttons";
import { abMetricRows } from "@/lib/posts/compare";
import { StatusBadge } from "@/lib/status-badges";

export const metadata: Metadata = { title: "Test A/B" };

const METRIC_LABELS = {
  ctr: "le taux de clic (personnes qui ont cliqué ÷ vues)",
  uniqueClickers: "les personnes qui ont cliqué",
  clicks: "les clics",
} as const;

/** Comparaison des deux versions d'un test A/B : résultat, graphique par mesure, tableau, aperçus. */
export default async function PostAbPage({
  params,
  searchParams,
}: PageProps<"/messages/ab/[groupId]">) {
  const { groupId } = await params;
  const sp = await searchParams;
  const cmp = await loadPostAbComparison(groupId);
  if (!cmp) notFound();
  const winner = pickPostWinner(cmp.variants);
  const rate = (v: PostVariantRow) => (v.views > 0 ? v.uniqueClickers / v.views : null);
  const chart = abMetricRows(cmp.variants);
  const rows: Array<[React.ReactNode, string, (v: PostVariantRow) => React.ReactNode]> = [
    ["Statut", "statut", (v) => <StatusBadge kind="post" value={v.status} />],
    ["Canal", "canal", (v) => v.channelTitle],
    ["Prévu le", "prevu", (v) => fmtDate(v.scheduledAt)],
    ["Envoyé le", "envoye", (v) => fmtDate(v.sentAt)],
    ["Vues", "vues", (v) => (v.views > 0 ? fmtNum(v.views) : "—")],
    ["Réactions", "reactions", (v) => fmtNum(v.reactionsTotal)],
    ["Clics", "clics", (v) => fmtNum(v.clicks)],
    ["Personnes qui ont cliqué", "uniques", (v) => fmtNum(v.uniqueClickers)],
    ["Taux de clic", "taux", (v) => fmtPct(rate(v))],
    ["Clics sur les offres", "offres", (v) => fmtNum(v.offerClicks)],
    ["Inscriptions", "inscriptions", (v) => fmtNum(v.registrations)],
    [
      <Term key="ftd" term="FTD">
        Premiers dépôts
      </Term>,
      "ftd",
      (v) => fmtNum(v.ftds),
    ],
    ["Dépôts", "depots", (v) => fmtNum(v.deposits)],
    ["Montant déposé", "montant", (v) => fmtMoney(v.depositAmount, "EUR", { digits: 0 })],
  ];

  return (
    <>
      <PageHeader
        title="Test A/B"
        backHref="/messages"
        backLabel="Messages"
        description={
          cmp.sameChannel
            ? `Deux versions publiées dans ${cmp.variants[0]?.channelTitle ?? "le même canal"}, à quelques minutes d'intervalle.`
            : "Deux versions publiées dans deux canaux différents, à la même heure."
        }
        help="La gagnante est désignée par le taux de clic quand les vues sont connues, sinon par les personnes qui ont cliqué, sinon par les clics."
      />
      <Flash ok={sp.ok} error={sp.error} />

      <section
        aria-label="Résultat"
        className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4"
      >
        {winner.status === "winner" ? (
          <>
            <StatusPill tone="brand" dot={false}>
              <Trophy aria-hidden className="size-3.5" />
              Version {winner.variant} en tête
            </StatusPill>
            <p className="text-body">
              Sur {METRIC_LABELS[winner.metric]} :{" "}
              <strong className="font-semibold tabular-nums">
                {winner.metric === "ctr" ? fmtPct(winner.value) : fmtNum(winner.value)}
              </strong>
              . Résultat provisoire, mis à jour toutes les 10 minutes.
            </p>
          </>
        ) : winner.status === "tie" ? (
          <>
            <StatusPill tone="neutral">Égalité</StatusPill>
            <p className="text-body">
              Les deux versions font jeu égal sur {METRIC_LABELS[winner.metric]} : attendez un peu.
            </p>
          </>
        ) : (
          <>
            <StatusPill tone="muted">En attente</StatusPill>
            <p className="text-body text-muted-foreground">
              {winner.reason === "not_sent"
                ? "Pas encore de gagnante : les deux versions doivent avoir été publiées."
                : "Pas encore de gagnante : aucun clic ni réaction pour l'instant."}
            </p>
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Les deux versions côte à côte</CardTitle>
              <CardDescription>La version en tête sur chaque mesure est en orange.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              {chart.map((m) => (
                <div key={m.key} className="space-y-2">
                  <h3 className="text-note font-medium text-muted-foreground">
                    <Term term={m.term}>{m.label}</Term>
                  </h3>
                  <BarList
                    label={m.label}
                    labels="narrow"
                    items={m.values.map((x) => ({
                      key: x.variant,
                      label: `Version ${x.variant}`,
                      value: x.value,
                      display: m.key === "ctr" ? fmtPct(x.value) : fmtNum(x.value),
                      emphasis: m.leader === null ? undefined : m.leader === x.variant,
                    }))}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tous les chiffres</CardTitle>
              <CardDescription>
                Les vues demandent un compte Telegram connecté ; réactions, clics, inscriptions et
                dépôts sont toujours comptés.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table label="Chiffres des deux versions">
                <TableHeader>
                  <TableRow>
                    <TableHead>Mesure</TableHead>
                    {cmp.variants.map((v) => (
                      <TableHead key={v.id} numeric>
                        <Link
                          href={`/messages/${v.id}`}
                          className="font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          Version {v.variant}
                        </Link>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(([label, key, f]) => (
                    <TableRow key={key}>
                      <TableCell className="whitespace-normal">{label}</TableCell>
                      {cmp.variants.map((v) => (
                        <TableCell key={v.id} numeric className="whitespace-normal">
                          {f(v)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
        <aside className="space-y-6" aria-label="Aperçus">
          {cmp.variants.map((v) => (
            <div key={v.id}>
              <p className="mb-2 text-note font-medium text-muted-foreground">
                Aperçu — version {v.variant}
                {v.categoryName ? ` · ${v.categoryName}` : ""}
              </p>
              <TelegramPreview
                html={v.text}
                buttons={parseButtons(v.buttons)}
                mediaCount={v.mediaCount}
              />
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
