import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Trophy } from "lucide-react";
import { parseSegment } from "@linkaffipro/core";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Flash } from "@/components/admin/flash";
import { Term } from "@/components/admin/help-tip";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { BroadcastProgress } from "@/components/broadcasts/broadcast-progress";
import { ReadOnlyPreview } from "@/components/broadcasts/read-only-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AB_MIN_SENT, ctr, fmtPct, pickWinner } from "@/lib/broadcasts/ab";
import { loadAbComparison } from "@/lib/broadcasts/ab-queries";
import { variantColumn } from "@/lib/broadcasts/display";
import { describeGroup, reachableSentence } from "@/lib/broadcasts/group";
import { loadGroupNames } from "@/lib/broadcasts/results";
import { fmtDate, fmtNum } from "@/lib/format";
import { parseButtons } from "@/lib/posts/buttons";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { sendWinnerToRestAction } from "../../actions";

export const metadata: Metadata = { title: "Test A/B" };

export default async function AbComparisonPage({
  params,
  searchParams,
}: PageProps<"/members/broadcasts/ab/[groupId]">) {
  const { groupId } = await params;
  const sp = await searchParams;
  const cmp = await loadAbComparison(groupId);
  if (!cmp) notFound();
  const segment = parseSegment(cmp.segment);
  const names = await loadGroupNames([segment]);
  const group = describeGroup(segment, names);
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
    ["Clics sur les boutons", "clics", (v) => fmtNum(v.clicks)],
    ["Personnes qui ont cliqué", "uniques", (v) => fmtNum(v.uniqueClicks)],
    ["Clics sur une offre", "offres", (v) => fmtNum(v.offerClicks)],
    ["Taux de clic", "taux", (v) => fmtPct(ctr(v))],
    ["Inscriptions rattachées", "inscriptions", (v) => fmtNum(v.registrations)],
    [
      <Term key="ftd" term="FTD">
        Premiers dépôts
      </Term>,
      "ftd",
      (v) => fmtNum(v.ftds),
    ],
  ];
  const canSendRest = !cmp.rest && winner.status === "winner";
  const other =
    winner.status === "winner" ? cmp.variants.find((v) => v.variant !== winner.variant) : null;

  return (
    <>
      <PageHeader
        backHref="/members/broadcasts"
        backLabel="Écrire à un groupe"
        title={`Test A/B — ${cmp.name}`}
        description={`Envoyé par @${cmp.botUsername} · ${cmp.variants.length} versions comparées`}
        help="Deux versions du même message partent chacune vers une part du groupe. Quand une version a assez d'envois et plus de clics, envoyez-la au reste du groupe."
        primaryAction={
          canSendRest ? (
            <form action={sendWinnerToRestAction} className="contents">
              <input type="hidden" name="groupId" value={groupId} />
              <ConfirmSubmit
                className="max-md:h-10"
                confirmTitle={`Envoyer la version ${winner.variant} au reste du groupe ?`}
                confirmLabel="Envoyer"
                message={`La version ${winner.variant} va partir maintenant à tous les membres du groupe qui n'ont encore reçu aucune version. Une fois parti, un message ne peut pas être rappelé.`}
              >
                <Trophy aria-hidden />
                Envoyer la gagnante au reste
              </ConfirmSubmit>
            </form>
          ) : null
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      {cmp.rest ? (
        <Alert variant="success" role="status" className="mb-6">
          <Trophy aria-hidden />
          <AlertTitle>La gagnante est partie au reste du groupe</AlertTitle>
          <AlertDescription>
            <Link
              href={`/members/broadcasts/${cmp.rest.id}`}
              className="font-medium underline underline-offset-2"
            >
              {cmp.rest.name}
            </Link>{" "}
            : {statusLabel("broadcast", cmp.rest.status).toLowerCase()}, {fmtNum(cmp.rest.sent)}{" "}
            envoyé{cmp.rest.sent > 1 ? "s" : ""}.
          </AlertDescription>
        </Alert>
      ) : winner.status === "winner" ? (
        <Alert variant="success" role="status" className="mb-6">
          <Trophy aria-hidden />
          <AlertTitle>La version {winner.variant} est en tête</AlertTitle>
          <AlertDescription>
            Taux de clic de {fmtPct(winner.ctr)}
            {other ? `, contre ${fmtPct(ctr(other))} pour la version ${other.variant}` : ""}. Vous
            pouvez l&apos;envoyer aux membres du groupe qui n&apos;ont encore rien reçu.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="info" role="status" className="mb-6">
          <AlertTitle>
            {winner.status === "tie" ? "Égalité pour l'instant" : "Pas encore de gagnante"}
          </AlertTitle>
          <AlertDescription>
            {winner.status === "tie"
              ? "Les deux versions ont le même taux de clic : attendez davantage d'envois ou de clics."
              : `Il faut au moins ${AB_MIN_SENT} envois par version, et des clics, pour trancher.`}
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-6 grid gap-6 md:grid-cols-2">
        {cmp.variants.map((v) => {
          const leads = winner.status === "winner" && winner.variant === v.variant;
          const buttons = parseButtons(v.buttons);
          return (
            <section
              key={v.id}
              aria-labelledby={`version-${v.id}`}
              className={cn(
                "min-w-0 space-y-4 rounded-xl border bg-card p-4 md:p-6",
                leads ? "border-success/40" : "border-border",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 id={`version-${v.id}`} className="text-title text-foreground">
                    Version {v.variant}
                  </h2>
                  <p className="text-note text-muted-foreground">
                    {typeof v.abSplit === "number" ? `${v.abSplit} % du groupe · ` : ""}
                    créée le {fmtDate(v.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {leads ? <StatusPill tone="success">En tête</StatusPill> : null}
                  <StatusBadge kind="broadcast" value={v.status} />
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-3">
                <div className="min-w-0">
                  <dt className="text-note text-muted-foreground">Taux de clic</dt>
                  <dd className="text-figure text-foreground tabular-nums">{fmtPct(ctr(v))}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-note text-muted-foreground">Ont cliqué</dt>
                  <dd className="text-figure text-foreground tabular-nums">
                    {fmtNum(v.uniqueClicks)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-note text-muted-foreground">
                    <Term term="FTD">Premiers dépôts</Term>
                  </dt>
                  <dd className="text-figure text-foreground tabular-nums">{fmtNum(v.ftds)}</dd>
                </div>
              </dl>
              <BroadcastProgress b={v} label={`Avancement de la version ${v.variant}`} />
              <ReadOnlyPreview
                html={v.text}
                buttons={buttons.map((r) => r.map((x) => ({ text: x.text })))}
                mediaCount={v.mediaAssetId ? 1 : 0}
              />
              <Link
                href={`/members/broadcasts/${v.id}`}
                className="inline-flex min-h-8 items-center text-body font-medium text-brand-ink underline-offset-2 hover:underline max-md:min-h-10"
              >
                Ouvrir la version {v.variant}
              </Link>
            </section>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Tous les chiffres</CardTitle>
            <CardDescription>
              Taux de clic : personnes qui ont cliqué divisées par messages envoyés. C&apos;est lui
              qui désigne la gagnante.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Téléphone : en-têtes courts (« A », « B ») et indicateurs sur deux lignes, pour que toutes les colonnes
                tiennent sans défiler ; le nom complet reste lu par les lecteurs d'écran. */}
            <Table label="Comparaison des versions">
              <TableHeader>
                <TableRow>
                  <TableHead className="max-sm:pl-0">Indicateur</TableHead>
                  {rows.map((v) => {
                    const col = variantColumn(v.variant);
                    return (
                      <TableHead key={v.id} numeric className="max-sm:px-2 max-sm:last:pr-0">
                        <Link
                          href={`/members/broadcasts/${v.id}`}
                          className="inline-flex min-h-8 items-center underline-offset-2 hover:underline max-md:min-h-10"
                        >
                          <span aria-hidden className="sm:hidden">
                            {col.short}
                          </span>
                          <span className="max-sm:sr-only">{col.long}</span>
                        </Link>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {metricRows.map(([label, key, f]) => (
                  <TableRow key={key}>
                    <TableCell className="whitespace-normal max-sm:pl-0">{label}</TableCell>
                    {rows.map((v) => (
                      <TableCell
                        key={v.id}
                        numeric
                        className="max-sm:px-2 max-sm:whitespace-normal max-sm:last:pr-0"
                      >
                        {f(v)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Le groupe de membres</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-body">
            <p>{group}.</p>
            <p className="text-note text-muted-foreground">{reachableSentence(cmp.botUsername)}</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
