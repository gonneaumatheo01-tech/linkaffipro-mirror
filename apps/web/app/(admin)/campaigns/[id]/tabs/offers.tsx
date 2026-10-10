import { prisma } from "@linkaffipro/db";
import { VERTICAL_LABELS, type Vertical } from "@linkaffipro/core";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listOfferCandidates } from "@/lib/campaigns/queries";
import { addOfferAction, removeOfferAction } from "../../actions";
import { selectCls, type TabProps } from "./shared";

/** Onglet Offres : campagnes Link Affi rattachées (le bouton Offre des messages utilise ces liens), ajout et retrait. */
export async function OffersTab({ id, scope }: TabProps) {
  const [candidates, players] = await Promise.all([
    listOfferCandidates(),
    scope.affiliateCampaignIds.length
      ? prisma.player.groupBy({ by: ["affiliateCampaignId"], where: { affiliateCampaignId: { in: scope.affiliateCampaignIds } }, _count: { _all: true } })
      : Promise.resolve([] as Array<{ affiliateCampaignId: string; _count: { _all: number } }>),
  ]);
  const playersBy = new Map(players.map((p) => [p.affiliateCampaignId, p._count._all]));
  const linked = scope.affiliateCampaignIds.map((oid) => candidates.find((c) => c.id === oid) ?? { id: oid, name: "(offre inactive ou supprimée côté Link Affi)", programName: "—", campaignKey: null, externalId: oid, trackingUrlTemplate: "", vertical: null });
  const available = candidates.filter((c) => !scope.affiliateCampaignIds.includes(c.id));
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Offres Link Affi rattachées ({linked.length})</CardTitle>
          <CardDescription>
            Dans un message ou un envoi, le bouton « Offre » propose cette campagne : le membre reçoit le lien de l&apos;offre avec son identifiant de suivi (sub-ID), et ses inscriptions et dépôts
            remontent ici. Les joueurs de ces offres sont comptés dans la campagne même sans clic retrouvé.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linked.length === 0 ? (
            <EmptyState title="Aucune offre rattachée." description="Ajoutez une campagne Link Affi ci-dessous : choisissez-la dans la liste ou collez son lien linkaffi.me/go/…" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Offre</TableHead>
                  <TableHead className="hidden md:table-cell">Programme</TableHead>
                  <TableHead className="hidden md:table-cell">Clé</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Joueurs (total)</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {linked.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <div className="font-medium">{o.name}</div>
                      {o.vertical ? <div className="text-xs text-muted-foreground">{VERTICAL_LABELS[o.vertical as Vertical] ?? o.vertical}</div> : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{o.programName}</TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">{o.campaignKey ?? "—"}</TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">{playersBy.get(o.id) ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <form action={removeOfferAction}>
                        <input type="hidden" name="campaignId" value={id} />
                        <input type="hidden" name="affiliateCampaignId" value={o.id} />
                        <ConfirmSubmit size="sm" variant="outline" className="max-md:h-10" message={`Retirer l'offre « ${o.name} » de cette campagne ? Les messages déjà publiés gardent leur lien.`}>
                          Retirer
                        </ConfirmSubmit>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6 max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Ajouter une offre</CardTitle>
          <CardDescription>Choisissez une campagne Link Affi synchronisée, ou collez son lien d&apos;offre (https://linkaffi.me/go/&lt;clé&gt;). Une clé inconnue est refusée : attendez 2 minutes après sa création côté Link Affi.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={addOfferAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="campaignId" value={id} />
            <div className="space-y-1">
              <Label htmlFor="offer-select">Dans la liste</Label>
              <select id="offer-select" name="affiliateCampaignId" className={`${selectCls} w-full`} defaultValue="">
                <option value="">— choisir une offre —</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.programName} · {c.name}
                    {c.campaignKey ? ` (${c.campaignKey})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="offer-ref">Ou coller un lien d&apos;offre</Label>
              <Input id="offer-ref" name="reference" placeholder="https://linkaffi.me/go/47eb8mwc" className="h-10 md:h-9" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" className="max-md:h-10">
                Ajouter l&apos;offre
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
