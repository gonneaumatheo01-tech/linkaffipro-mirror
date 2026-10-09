import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pickPostWinner } from "@linkaffipro/core";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { HelpTip } from "@/components/admin/help-tip";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { StatusBadge } from "@/lib/status-badges";

export const metadata: Metadata = { title: "Test A/B" };

const METRIC_LABELS = {
  ctr: "taux de clic (cliqueurs uniques / vues)",
  uniqueClickers: "cliqueurs uniques",
  clicks: "clics",
} as const;

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
  const rows: Array<[React.ReactNode, string, (v: PostVariantRow) => React.ReactNode]> = [
    ["Statut", "statut", (v) => <StatusBadge kind="post" value={v.status} />],
    ["Canal", "canal", (v) => v.channelTitle],
    ["Prévu le", "prevu", (v) => fmtDate(v.scheduledAt)],
    ["Envoyé le", "envoye", (v) => fmtDate(v.sentAt)],
    ["Vues", "vues", (v) => (v.views > 0 ? fmtNum(v.views) : "—")],
    ["Réactions", "reactions", (v) => fmtNum(v.reactionsTotal)],
    ["Clics", "clics", (v) => fmtNum(v.clicks)],
    ["Cliqueurs uniques", "uniques", (v) => fmtNum(v.uniqueClickers)],
    [
      <span key="ctr" className="inline-flex items-center gap-1">
        Taux de clic{" "}
        <HelpTip>
          Cliqueurs uniques divisés par les vues. Affiché seulement quand les vues sont connues.
        </HelpTip>
      </span>,
      "taux",
      (v) => fmtPct(rate(v)),
    ],
    ["Clics offres", "offres", (v) => fmtNum(v.offerClicks)],
    ["Inscriptions", "inscriptions", (v) => fmtNum(v.registrations)],
    ["Premiers dépôts (FTD)", "ftd", (v) => fmtNum(v.ftds)],
    ["Dépôts", "depots", (v) => fmtNum(v.deposits)],
    ["Montant déposé", "montant", (v) => fmtMoney(v.depositAmount, "EUR", { digits: 0 })],
  ];
  return (
    <>
      <PageHeader
        title="Test A/B de message"
        description={
          cmp.sameChannel
            ? `Deux versions publiées dans ${cmp.variants[0]?.channelTitle ?? "le même canal"}, à quelques minutes d'intervalle.`
            : "Deux versions publiées dans deux canaux différents à la même heure."
        }
        help="Comparez les chiffres de chaque version. La gagnante provisoire est désignée par le taux de clic (si les vues sont connues), sinon par les cliqueurs uniques, sinon par les clics."
      >
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/messages?view=list" />}
        >
          ← Messages
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Résultat</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {winner.status === "winner" ? (
            <p>
              Gagnante provisoire : <Badge>version {winner.variant}</Badge> sur{" "}
              {METRIC_LABELS[winner.metric]} (
              {winner.metric === "ctr" ? fmtPct(winner.value) : fmtNum(winner.value)}).
            </p>
          ) : winner.status === "tie" ? (
            <p>Égalité entre les versions sur {METRIC_LABELS[winner.metric]} : attendez un peu.</p>
          ) : winner.reason === "not_sent" ? (
            <p className="text-muted-foreground">
              Pas encore de gagnante : les deux versions doivent avoir été publiées.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Pas encore de gagnante : aucun clic ni réaction pour l&apos;instant. Les chiffres se
              mettent à jour toutes les 10 minutes.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comparaison</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Indicateur</TableHead>
                  {cmp.variants.map((v) => (
                    <TableHead key={v.id} className="text-right">
                      <Link
                        href={`/messages/${v.id}`}
                        className="underline-offset-2 hover:underline"
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
                    <TableCell>{label}</TableCell>
                    {cmp.variants.map((v) => (
                      <TableCell key={v.id} className="text-right tabular-nums">
                        {f(v)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              Les vues ne sont comptées que si Telegram les transmet (connexion téléphone, à venir)
              ; réactions, clics, inscriptions et dépôts sont comptés.
            </p>
          </CardContent>
        </Card>
        <div className="space-y-6">
          {cmp.variants.map((v) => (
            <div key={v.id}>
              <p className="mb-2 text-sm font-medium">
                Aperçu — version {v.variant}
                {v.categoryName ? (
                  <span className="text-muted-foreground"> · {v.categoryName}</span>
                ) : null}
              </p>
              <TelegramPreview
                html={v.text}
                buttons={parseButtons(v.buttons)}
                mediaCount={v.mediaCount}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
