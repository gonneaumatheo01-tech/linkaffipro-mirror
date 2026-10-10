import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { SidePanel } from "@/components/admin/side-panel";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { campaignTabHref } from "@/lib/campaigns/display";
import { listOfferCandidates, type OfferCandidateRow } from "@/lib/campaigns/queries";
import { offerAffiliateLabel, visibleOffers } from "@/lib/campaigns/wizard";
import { fmtNum } from "@/lib/format";
import { addOfferAction, removeOfferAction } from "../../actions";
import type { TabProps } from "./shared";

/**
 * Section « Offres Link Affi » de la vue d'ensemble (ex-onglet Offres) : offres rattachées (le bouton Offre des
 * messages utilise ces liens, avec l'identifiant de suivi de chaque membre), détail et retrait dans un volet,
 * ajout dans un volet. La liste d'ajout ne montre par défaut que nos offres (`listOfferCandidates`) ; `?others=1`
 * montre aussi celles des autres affiliés (le volet d'ajout s'ouvre alors tout seul).
 */
export async function OffersSection({
  id,
  scope,
  sp,
  keep,
}: TabProps & { keep: Record<string, string> }) {
  const showOthers = sp.others === "1";
  const [candidates, players] = await Promise.all([
    listOfferCandidates(),
    scope.affiliateCampaignIds.length
      ? prisma.player.groupBy({
          by: ["affiliateCampaignId"],
          where: { affiliateCampaignId: { in: scope.affiliateCampaignIds } },
          _count: { _all: true },
        })
      : Promise.resolve([] as Array<{ affiliateCampaignId: string; _count: { _all: number } }>),
  ]);
  const playersBy = new Map(players.map((p) => [p.affiliateCampaignId, p._count._all]));
  const linked: OfferCandidateRow[] = scope.affiliateCampaignIds.map(
    (oid) =>
      candidates.find((c) => c.id === oid) ?? {
        id: oid,
        name: "Offre inactive ou supprimée chez Link Affi",
        programName: "—",
        campaignKey: null,
        externalId: oid,
        trackingUrlTemplate: "",
        vertical: null,
        affiliateId: null,
        ours: false,
      },
  );
  const oursKnown = candidates.some((c) => c.ours);
  const available = visibleOffers(candidates, showOthers).filter(
    (c) => !scope.affiliateCampaignIds.includes(c.id),
  );
  const hiddenOthers =
    oursKnown && !showOthers
      ? candidates.filter((c) => !c.ours && !scope.affiliateCampaignIds.includes(c.id)).length
      : 0;
  const base = campaignTabHref(id, "overview", keep);
  const toggleOthers = showOthers ? base : `${base}${base.includes("?") ? "&" : "?"}others=1`;

  const addPanel = (
    <SidePanel
      title="Ajouter une offre"
      description="Une offre Link Affi synchronisée, ou son lien linkaffi.me/go/…"
      defaultOpen={showOthers}
      trigger={
        <Button variant="outline" className="max-md:h-10">
          <Plus aria-hidden />
          Ajouter une offre
        </Button>
      }
    >
      <form action={addOfferAction} className="space-y-5">
        <input type="hidden" name="campaignId" value={id} />
        <div className="space-y-2">
          <Label htmlFor="offer-select">Dans la liste</Label>
          <NativeSelect
            id="offer-select"
            name="affiliateCampaignId"
            defaultValue=""
            wrapperClassName="w-full"
          >
            <option value="">Choisir une offre</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.programName} · {c.name}
                {c.campaignKey ? ` (${c.campaignKey})` : ""} · {offerAffiliateLabel(c)}
              </option>
            ))}
          </NativeSelect>
          {oursKnown ? (
            <p className="text-note text-muted-foreground">
              {showOthers
                ? "Toutes les offres sont affichées. "
                : `Seulement vos offres${hiddenOthers ? ` (${hiddenOthers} d'autres affiliés masquées)` : ""}. `}
              <Link href={toggleOthers} className="font-medium text-brand-ink underline">
                {showOthers ? "Afficher seulement les vôtres" : "Afficher les autres affiliés"}
              </Link>
            </p>
          ) : (
            <p className="text-note text-warning">
              Vos offres ne sont pas encore reconnues (aucun clic avec{" "}
              <Term term="sub-ID">identifiant de suivi</Term>) : toutes sont affichées, vérifiez
              l&apos;affilié.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="offer-ref">Ou collez un lien d&apos;offre</Label>
          <Input id="offer-ref" name="reference" placeholder="https://linkaffi.me/go/47eb8mwc" />
          <p className="text-note text-muted-foreground">
            Une offre créée il y a moins de 2 minutes chez Link Affi n&apos;est pas encore
            synchronisée : réessayez un peu plus tard.
          </p>
        </div>
        <Button type="submit" className="max-md:h-10">
          Ajouter l&apos;offre
        </Button>
      </form>
    </SidePanel>
  );

  return (
    <FormSection
      id="offres"
      title={`Offres Link Affi (${linked.length})`}
      description="Ce que la campagne promeut : le bouton Offre des messages propose ces offres, et leurs joueurs comptent dans la campagne."
      actions={linked.length ? addPanel : null}
    >
      {linked.length === 0 ? (
        <EmptyState
          title="Aucune offre rattachée"
          description="Ajoutez l'offre Link Affi que cette campagne promeut : ses inscriptions et dépôts remonteront ici."
        >
          {addPanel}
        </EmptyState>
      ) : (
        <DataTable
          label="Offres Link Affi de la campagne"
          columns={[
            { key: "name", header: "Offre", className: "min-w-40 whitespace-normal" },
            { key: "program", header: "Programme", hideOnMobile: true },
            { key: "owner", header: "Affilié", hideOnMobile: true },
            { key: "players", header: "Joueurs", align: "right" },
          ]}
          rows={linked.map((o) => {
            const players = playersBy.get(o.id) ?? 0;
            const other = oursKnown && !o.ours;
            return {
              id: o.id,
              cells: {
                name: o.name,
                program: o.programName,
                owner: (
                  <StatusPill tone={o.ours ? "success" : other ? "warning" : "muted"}>
                    {offerAffiliateLabel(o)}
                  </StatusPill>
                ),
                players: fmtNum(players),
              },
              sortValues: { owner: offerAffiliateLabel(o), players },
              detailDescription: o.programName,
              detail: (
                <div className="space-y-6">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
                    <dt className="text-muted-foreground">Univers</dt>
                    <dd>
                      <UniverseDot universe={o.vertical} withLabel />
                    </dd>
                    <dt className="text-muted-foreground">Clé du lien</dt>
                    <dd className="font-mono text-note">{o.campaignKey ?? "—"}</dd>
                    <dt className="text-muted-foreground">Affilié</dt>
                    <dd>{offerAffiliateLabel(o)}</dd>
                    <dt className="text-muted-foreground">Joueurs (depuis le début)</dt>
                    <dd className="tabular-nums">{fmtNum(players)}</dd>
                  </dl>
                  <form action={removeOfferAction} className="border-t border-border pt-4">
                    <input type="hidden" name="campaignId" value={id} />
                    <input type="hidden" name="affiliateCampaignId" value={o.id} />
                    <ConfirmSubmit
                      variant="destructive"
                      className="max-md:h-10"
                      confirmTitle="Retirer cette offre ?"
                      confirmLabel="Retirer"
                      message={`L'offre « ${o.name} » ne sera plus proposée par cette campagne. Les messages déjà publiés gardent leur lien.`}
                    >
                      Retirer de la campagne
                    </ConfirmSubmit>
                  </form>
                </div>
              ),
            };
          })}
        />
      )}
    </FormSection>
  );
}
