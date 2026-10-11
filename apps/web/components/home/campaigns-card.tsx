import Link from "next/link";
import { Megaphone } from "lucide-react";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { UniverseDot } from "@/components/admin/universe-dot";
import { cn } from "@/components/ui/cn";
import { fmtNum } from "@/lib/format";
import { homeMoney, moneyDigits } from "@/lib/home/figures";
import type { ActiveCampaign } from "@/lib/home/lists";
import { HomeSection, sectionLinkClass } from "./home-section";

/**
 * « Campagnes actives » sur les 7 derniers jours : dépensé, membres, gains (commissions − dépense pub, la même définition
 * que « Gains du jour », la page Campagnes et les Statistiques) ; chaque ligne ouvre sa campagne. Aucune campagne
 * active : bouton « Nouvelle campagne » (secondaire, le bouton orange de l'accueil est « Programmer un message »).
 * Téléphone : une ligne par campagne, nom puis les trois chiffres côte à côte (un tableau à 4 colonnes ne tient pas
 * dans 390 px) ; à partir de 768 px : tableau triable.
 */
export function CampaignsCard({ rows, total }: { rows: readonly ActiveCampaign[]; total: number }) {
  const digits = moneyDigits(rows.flatMap((r) => [r.spend, r.gains]));
  return (
    <HomeSection
      id="campagnes-actives"
      title="Campagnes actives"
      description="7 derniers jours · gains = commissions − dépense pub"
      action={
        <Link href="/campaigns" className={sectionLinkClass}>
          {total > rows.length ? `Toutes les campagnes (${fmtNum(total)})` : "Toutes les campagnes"}
        </Link>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="Aucune campagne active"
          description="Une campagne réunit vos pubs, vos offres et vos canaux pour suivre ce qu'ils rapportent."
          action={{ href: "/campaigns/new", label: "Nouvelle campagne", variant: "outline" }}
          className="border-0 py-6"
        />
      ) : (
        <>
          <ul className="-mx-2 divide-y divide-border md:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/campaigns/${c.id}`}
                  className="block rounded-lg px-2 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex min-w-0 items-center gap-2 text-body font-medium text-foreground">
                    <UniverseDot universe={c.vertical} />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className="mt-1.5 grid grid-cols-3 gap-2">
                    <Figure label="Dépensé">{homeMoney(c.spend, digits)}</Figure>
                    <Figure label="Membres">{fmtNum(c.members)}</Figure>
                    <Figure label="Gains">
                      <Gains value={c.gains} digits={digits} />
                    </Figure>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <DataTable
            label="Campagnes actives, 7 derniers jours"
            columns={[
              { key: "name", header: "Campagne" },
              { key: "spend", header: "Dépensé", align: "right" },
              { key: "members", header: "Membres", align: "right" },
              { key: "gains", header: "Gains", align: "right" },
            ]}
            rows={rows.map((c) => ({
              id: c.id,
              href: `/campaigns/${c.id}`,
              cells: {
                name: (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <UniverseDot universe={c.vertical} />
                    <span>{c.name}</span>
                  </span>
                ),
                spend: homeMoney(c.spend, digits),
                members: fmtNum(c.members),
                gains: <Gains value={c.gains} digits={digits} />,
              },
              sortValues: { name: c.name, gains: c.gains },
            }))}
            className="-mx-1 max-md:hidden"
          />
        </>
      )}
    </HomeSection>
  );
}

/** Chiffre étiqueté de la version téléphone. */
function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-note text-muted-foreground">{label}</span>
      <span className="truncate text-body text-foreground tabular-nums">{children}</span>
    </span>
  );
}

/** Gains : verts s'ils sont positifs, rouges s'ils sont négatifs. */
function Gains({ value, digits }: { value: number; digits: 0 | 2 }) {
  return (
    <span
      className={cn(
        "font-medium",
        value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-foreground",
      )}
    >
      {homeMoney(value, digits)}
    </span>
  );
}
