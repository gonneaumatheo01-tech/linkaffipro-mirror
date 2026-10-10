import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { SidePanel } from "@/components/admin/side-panel";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireAdminPage } from "@/lib/session";
import { getTagRegistry, TAG_COLORS, TAG_NAME_MAX, tagColorClass } from "@/lib/members/tags";
import { SettingsGroupNav } from "../categories/group-nav";
import { createTagAction, deleteTagAction, updateTagAction } from "./actions";
import { deleteTagMessage, memberCountLabel, membersWithTagHref } from "./tag-view";

export const metadata: Metadata = { title: "Étiquettes de membres" };

function ColorSelect({ id, defaultValue }: { id: string; defaultValue: string }) {
  return (
    <NativeSelect id={id} name="color" defaultValue={defaultValue} wrapperClassName="w-full">
      {TAG_COLORS.map((c) => (
        <option key={c.key} value={c.key}>
          {c.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Étiquette telle qu'elle apparaît sur une fiche membre (couleur choisie par l'équipe). */
function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <Badge variant="outline" className={tagColorClass(color)}>
      {name}
    </Badge>
  );
}

/**
 * Réglages → Catégories et étiquettes → Étiquettes de membres : tableau de 3 colonnes (étiquette, couleur, membres),
 * détail au clic (renommer, changer la couleur, supprimer avec confirmation, voir les membres).
 * « Nouvelle étiquette » ouvre un volet. Mêmes champs et mêmes actions serveur qu'avant.
 */
export default async function TagsPage({ searchParams }: PageProps<"/settings/tags">) {
  await requireAdminPage();
  const sp = await searchParams;
  const registry = await getTagRegistry();
  const counts = await Promise.all(
    registry.map((t) => prisma.member.count({ where: { tags: { array_contains: [t.name] } } })),
  );
  // Après une action, le tableau (et son volet) repart de zéro : le message de retour reste visible.
  const flashKey = JSON.stringify([sp.ok ?? null, sp.error ?? null]);
  const colorLabel = (key: string) => TAG_COLORS.find((c) => c.key === key)?.label ?? "Gris";

  const createPanel = (
    <SidePanel
      key={`create-${flashKey}`}
      title="Nouvelle étiquette"
      description="Elle se pose ensuite depuis la fiche d'un membre (bloc « Étiquettes »)."
      trigger={
        <Button className="max-md:h-10">
          <Plus aria-hidden />
          Nouvelle étiquette
        </Button>
      }
    >
      <form action={createTagAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="new-name">Nom</Label>
          <Input
            id="new-name"
            name="name"
            required
            maxLength={TAG_NAME_MAX}
            placeholder="Ex. VIP"
            aria-describedby="new-name-aide"
          />
          <p id="new-name-aide" className="text-note text-muted-foreground">
            {TAG_NAME_MAX} caractères au plus : lettres, chiffres, espaces, tirets.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-color">Couleur</Label>
          <ColorSelect id="new-color" defaultValue="blue" />
          <div className="flex flex-wrap gap-1.5 pt-1" aria-hidden>
            {TAG_COLORS.map((c) => (
              <TagChip key={c.key} name={c.label} color={c.key} />
            ))}
          </div>
        </div>
        <Button type="submit" className="max-md:h-10">
          Créer l&apos;étiquette
        </Button>
      </form>
    </SidePanel>
  );

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Étiquettes de membres"
        description="Des étiquettes colorées (VIP, test, à relancer…) pour retrouver des membres et leur écrire en groupe."
        help="Créez une étiquette ici, puis posez-la depuis la fiche d'un membre. Les relances automatiques peuvent aussi en poser."
        primaryAction={createPanel}
        secondaryActions={
          <Link
            href="/members"
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <Users aria-hidden />
            Voir les membres
          </Link>
        }
      />
      <SettingsGroupNav group="content" current="tags" />
      <Flash ok={sp.ok} error={sp.error} />

      <DataTable
        key={`table-${flashKey}`}
        label="Étiquettes de membres"
        columns={[
          { key: "name", header: "Étiquette", className: "min-w-32 whitespace-normal" },
          { key: "color", header: "Couleur", hideOnMobile: true },
          { key: "members", header: "Membres", align: "right" },
        ]}
        rows={registry.map((t, i) => {
          const count = counts[i] ?? 0;
          return {
            id: t.name,
            cells: {
              name: <TagChip name={t.name} color={t.color} />,
              color: <span className="text-muted-foreground">{colorLabel(t.color)}</span>,
              members: memberCountLabel(count),
            },
            sortValues: { name: t.name, color: colorLabel(t.color), members: count },
            detailTitle: t.name,
            detailDescription: memberCountLabel(count),
            detail: (
              <div className="space-y-8">
                <form action={updateTagAction} className="space-y-5">
                  <input type="hidden" name="oldName" value={t.name} />
                  <div className="space-y-2">
                    <Label htmlFor={`name-${i}`}>Nom</Label>
                    <Input
                      id={`name-${i}`}
                      name="name"
                      defaultValue={t.name}
                      required
                      maxLength={TAG_NAME_MAX}
                      aria-describedby={`name-${i}-aide`}
                    />
                    <p id={`name-${i}-aide`} className="text-note text-muted-foreground">
                      Renommer l&apos;étiquette la met à jour chez tous les membres qui la portent.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`color-${i}`}>Couleur</Label>
                    <ColorSelect id={`color-${i}`} defaultValue={t.color} />
                  </div>
                  <Button type="submit" className="max-md:h-10">
                    Enregistrer
                  </Button>
                </form>

                {count > 0 ? (
                  <Link
                    href={membersWithTagHref(t.name)}
                    className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
                  >
                    <Users aria-hidden />
                    Voir {count > 1 ? `les ${memberCountLabel(count)}` : "le membre"}
                  </Link>
                ) : null}

                <form action={deleteTagAction} className="space-y-3 border-t border-border pt-6">
                  <input type="hidden" name="name" value={t.name} />
                  <h3 className="text-body font-semibold text-foreground">
                    Supprimer l&apos;étiquette
                  </h3>
                  <p className="text-note text-muted-foreground">
                    Elle est retirée de tous les membres qui la portent.
                  </p>
                  <ConfirmSubmit
                    variant="destructive"
                    className="max-md:h-10"
                    confirmTitle={`Supprimer l'étiquette « ${t.name} »\u00a0?`}
                    message={deleteTagMessage(t.name, count)}
                  >
                    Supprimer
                  </ConfirmSubmit>
                </form>
              </div>
            ),
          };
        })}
        empty={{
          title: "Aucune étiquette pour l'instant",
          description: "Cliquez sur « Nouvelle étiquette » (ex. VIP, test, à relancer).",
        }}
      />
      {registry.length > 0 ? (
        <p className="mt-3 text-note text-muted-foreground">
          Cliquez sur une étiquette pour la renommer, changer sa couleur ou la supprimer.
        </p>
      ) : null}
    </>
  );
}
