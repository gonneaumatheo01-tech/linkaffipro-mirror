import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { describeSegment, parseSegment } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { HelpTip } from "@/components/admin/help-tip";
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
import { fmtDate, fmtNum } from "@/lib/format";
import { AB_MIN_SENT, ctr, fmtPct, pickWinner } from "@/lib/broadcasts/ab";
import { loadAbComparison } from "@/lib/broadcasts/ab-queries";
import { statusLabel } from "@/lib/status-badges";
import { sendWinnerToRestAction } from "../../actions";

export const metadata: Metadata = { title: "Test A/B" };

export default async function AbComparisonPage({
  params,
  searchParams,
}: PageProps<"/broadcasts/ab/[groupId]">) {
  const { groupId } = await params;
  const sp = await searchParams;
  const cmp = await loadAbComparison(groupId);
  if (!cmp) notFound();
  const [channels, inviteLinks, campaigns, categories] = await Promise.all([
    prisma.channel.findMany({ select: { id: true, title: true } }),
    prisma.inviteLink.findMany({ select: { id: true, name: true } }),
    prisma.campaign.findMany({ select: { id: true, name: true } }),
    prisma.messageCategory.findMany({ select: { id: true, name: true } }),
  ]);
  const toMap = (xs: Array<{ id: string; title?: string; name?: string }>) =>
    Object.fromEntries(xs.map((x) => [x.id, x.title ?? x.name ?? x.id]));
  const winner = pickWinner(cmp.variants);
  const rows: Array<
    (typeof cmp.variants)[number] | (NonNullable<typeof cmp.rest> & { abSplit?: number | null })
  > = [...cmp.variants, ...(cmp.rest ? [cmp.rest] : [])];
  const metricRows: Array<[React.ReactNode, string, (v: (typeof rows)[number]) => string]> = [
    ["Statut", "statut", (v) => statusLabel("broadcast", v.status)],
    ["Ciblés", "cibles", (v) => fmtNum(v.targeted)],
    ["Envoyés", "envoyes", (v) => fmtNum(v.sent)],
    ["Échoués", "echoues", (v) => fmtNum(v.failed)],
    ["Bloqués", "bloques", (v) => fmtNum(v.blocked)],
    ["Clics (boutons traqués)", "clics", (v) => fmtNum(v.clicks)],
    ["Personnes ayant cliqué", "uniques", (v) => fmtNum(v.uniqueClicks)],
    ["Clics sur une offre", "offres", (v) => fmtNum(v.offerClicks)],
    [
      <span key="ctr" className="inline-flex items-center gap-1">
        Taux de clic{" "}
        <HelpTip>
          Personnes ayant cliqué divisées par messages envoyés. C&apos;est ce chiffre qui désigne la
          gagnante.
        </HelpTip>
      </span>,
      "taux",
      (v) => fmtPct(ctr(v)),
    ],
    ["Inscriptions rattachées", "inscriptions", (v) => fmtNum(v.registrations)],
    [
      <span key="ftd" className="inline-flex items-center gap-1">
        Premiers dépôts (FTD){" "}
        <HelpTip>FTD : joueurs rattachés à cette version qui ont fait leur premier dépôt.</HelpTip>
      </span>,
      "ftd",
      (v) => fmtNum(v.ftds),
    ],
  ];
  return (
    <>
      <PageHeader
        title={`Test A/B — ${cmp.name}`}
        description={`@${cmp.botUsername} · ${cmp.variants.length} versions comparées`}
        help="Deux versions du même message sont envoyées à deux parts du segment. Quand une version a assez d'envois et plus de clics, envoyez-la au reste du segment."
      >
        <Button variant="outline" className="max-md:h-10" render={<Link href="/broadcasts" />}>
          ← Envois
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Résultat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {winner.status === "winner" ? (
            <p>
              Gagnante provisoire : <Badge>version {winner.variant}</Badge> avec un taux de clic de{" "}
              {fmtPct(winner.ctr)}.
            </p>
          ) : winner.status === "tie" ? (
            <p>Égalité entre les versions : attendez davantage d&apos;envois ou de clics.</p>
          ) : (
            <p className="text-muted-foreground">
              Pas encore de gagnante : il faut au moins {AB_MIN_SENT} envois par version (et des
              clics) pour trancher.
            </p>
          )}
          {cmp.rest ? (
            <p>
              Envoi au reste du segment :{" "}
              <Link href={`/broadcasts/${cmp.rest.id}`} className="underline underline-offset-2">
                {cmp.rest.name}
              </Link>{" "}
              ({statusLabel("broadcast", cmp.rest.status)}, {fmtNum(cmp.rest.sent)} envoyés).
            </p>
          ) : (
            <form action={sendWinnerToRestAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <ConfirmSubmit
                className="max-md:h-10"
                disabled={winner.status !== "winner"}
                message={`La version ${winner.status === "winner" ? winner.variant : ""} va partir maintenant à tous les membres du segment qui n'ont encore reçu aucune version. Cette action est irréversible. Continuer ?`}
              >
                Envoyer la version gagnante au reste du segment
              </ConfirmSubmit>
              <p className="mt-1 text-xs text-muted-foreground">
                Crée un nouvel envoi avec le message gagnant vers les membres du segment qui
                n&apos;ont encore reçu aucune version.
              </p>
            </form>
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
                  {rows.map((v) => (
                    <TableHead key={v.id} className="text-right">
                      <Link
                        href={`/broadcasts/${v.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {v.variant === "REST" ? "Reste" : `Version ${v.variant}`}
                      </Link>
                      {v.variant !== "REST" && typeof v.abSplit === "number" ? (
                        <div className="text-xs font-normal text-muted-foreground">
                          {v.abSplit} % des destinataires
                        </div>
                      ) : null}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {metricRows.map(([label, key, f]) => (
                  <TableRow key={key}>
                    <TableCell>{label}</TableCell>
                    {rows.map((v) => (
                      <TableCell key={v.id} className="text-right tabular-nums">
                        {f(v)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Destinataires</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {describeSegment(parseSegment(cmp.segment), {
                channels: toMap(channels),
                inviteLinks: toMap(inviteLinks),
                campaigns: toMap(campaigns),
                categories: toMap(categories),
              })}
            </CardContent>
          </Card>
          {cmp.variants.map((v) => (
            <Card key={v.id}>
              <CardHeader>
                <CardTitle className="text-base">Version {v.variant}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs">
                  {v.text}
                </div>
                <div className="text-xs text-muted-foreground">
                  créé le {fmtDate(v.createdAt)}
                  {v.finishedAt ? ` · terminé le ${fmtDate(v.finishedAt)}` : ""}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
