import Link from "next/link";
import { Radar } from "lucide-react";
import { bulkProspectStatusAction } from "@/app/(admin)/agents/prospection/actions";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  COMPETITION_LABELS,
  SOURCE_TYPE_LABELS,
  audienceText,
  brandsText,
  channelName,
  marketText,
  opennessText,
  prospectHref,
  publicChannelUrl,
} from "@/lib/agents/prospection/display";
import type { ProspectTableRow } from "@/lib/agents/prospection/queries";
import { fmtNum, fmtRelative } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

/**
 * Tableau des canaux trouvés : chaque ligne renvoie à la fiche et donne le lien public du canal (t.me). Sélection
 * multiple : « Marquer contactés » ou « Ignorer » (aucun message n'est envoyé : vous notez ce que vous avez fait).
 * Composant serveur ; le tri et les filtres sont faits côté serveur (adresse).
 */
export function ProspectsTable({ rows, total, back, now }: { rows: ProspectTableRow[]; total: number; back: string; now: Date }) {
  if (!rows.length)
    return (
      <EmptyState
        icon={<Radar />}
        title="Aucun canal avec ces filtres"
        description="L'équipe cherche chaque nuit de nouveaux canaux casino et paris sportifs en Europe. Élargissez les filtres, ou ajoutez un canal à la main dans la vue Sources."
      />
    );
  return (
    <form action={bulkProspectStatusAction} className="space-y-3">
      <input type="hidden" name="back" value={back} />
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-note text-muted-foreground">
          {total > rows.length ? `Les ${fmtNum(rows.length)} premiers sur ${fmtNum(total)} canaux.` : `${fmtNum(total)} canal${total > 1 ? "ux" : ""}.`} Cochez des canaux puis :
        </p>
        <Button type="submit" name="status" value="CONTACTED" size="sm" variant="secondary" className="max-md:h-10">
          Marquer contactés
        </Button>
        <Button type="submit" name="status" value="SKIPPED" size="sm" variant="outline" className="max-md:h-10">
          Ignorer (pas intéressé)
        </Button>
      </div>
      <Table label="Canaux trouvés">
        <TableCaption className="sr-only">Canaux trouvés par l&apos;équipe Prospection</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Choisir</span>
            </TableHead>
            <TableHead>Canal</TableHead>
            <TableHead>Niveau et note</TableHead>
            <TableHead>Marché</TableHead>
            <TableHead>Audience</TableHead>
            <TableHead>Concurrence et ouverture</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Statut</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => {
            const url = publicChannelUrl(p);
            const name = channelName(p);
            return (
              <TableRow key={p.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    name="ids"
                    value={p.id}
                    id={`pr-sel-${p.id}`}
                    aria-label={`Choisir ${name}`}
                    className="size-4"
                  />
                </TableCell>
                <TableCell className="min-w-48">
                  <Link href={prospectHref(p.id)} className="font-medium text-foreground underline-offset-4 hover:underline">
                    {name}
                  </Link>
                  <div className="text-note text-muted-foreground">
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer noopener" className="text-info underline underline-offset-4">
                        {p.username ? `@${p.username}` : "Ouvrir dans Telegram"}
                      </a>
                    ) : null}
                    {` · ${SOURCE_TYPE_LABELS[p.sourceType] ?? p.sourceType}`}
                  </div>
                </TableCell>
                <TableCell>
                  {p.tier ? <StatusBadge kind="prospectTier" value={p.tier} /> : <span className="text-note text-muted-foreground">Pas encore noté</span>}
                  {p.score != null ? <div className="text-note text-muted-foreground tabular-nums">{p.score} / 100</div> : null}
                </TableCell>
                <TableCell className="min-w-40 text-note">{marketText(p)}</TableCell>
                <TableCell className="min-w-44 text-note">{audienceText(p)}</TableCell>
                <TableCell className="min-w-44 text-note">
                  <div>{p.competitiveState ? (COMPETITION_LABELS[p.competitiveState] ?? p.competitiveState) : "Concurrence inconnue"}</div>
                  <div className="text-muted-foreground">Marques : {brandsText(p.brands)}</div>
                  <div className="text-muted-foreground">{opennessText(p.monetization)}</div>
                </TableCell>
                <TableCell className="min-w-36 text-note">
                  <StatusBadge kind="contactConfidence" value={p.contactConfidence} />
                  {p.bestContact ? <div className="mt-1 break-all">{p.bestContact}</div> : null}
                </TableCell>
                <TableCell className="min-w-32">
                  <StatusBadge kind="prospectStatus" value={p.status} />
                  <div className="text-note text-muted-foreground">{fmtRelative(p.statusChangedAt ?? p.updatedAt, now)}</div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </form>
  );
}
