import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Plus } from "lucide-react";
import { VERTICALS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { AdvancedSection } from "@/components/admin/form-section";
import { SidePanel } from "@/components/admin/side-panel";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldBorderClass, NativeSelect } from "@/components/ui/native-select";
import { requireAdminPage } from "@/lib/session";
import { universeLabel } from "@/lib/universe";
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "./actions";
import { SettingsGroupNav } from "./group-nav";
import { categoryUsageLabel, countCategoryReferences, deleteConfirmMessage } from "./remap";

export const metadata: Metadata = { title: "Catégories de messages" };

/** Sélecteur de couleur natif, à la bordure des champs (la couleur est une donnée choisie par l'équipe). */
const colorInputClass = cn(
  "h-10 w-16 cursor-pointer rounded-lg border bg-surface p-1 md:h-9",
  fieldBorderClass,
);

function UniverseOptions() {
  return (
    <>
      <option value="">Tous les univers</option>
      {VERTICALS.map((v) => (
        <option key={v} value={v}>
          {universeLabel(v)}
        </option>
      ))}
    </>
  );
}

/** Point de la couleur de la catégorie, devant son nom. */
function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/10"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Réglages → Catégories et étiquettes → Catégories de messages : tableau de 4 colonnes (catégorie, univers,
 * utilisation, état), détail au clic avec la modification et la suppression (fusion dans une autre catégorie).
 * « Nouvelle catégorie » ouvre un volet. Mêmes champs et mêmes actions serveur qu'avant.
 */
export default async function CategoriesPage({ searchParams }: PageProps<"/settings/categories">) {
  await requireAdminPage();
  const sp = await searchParams;
  const [categories, rules, broadcasts] = await Promise.all([
    prisma.messageCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { posts: true } } },
    }),
    // Références JSON mises à jour par « Fusionner et supprimer » (mêmes lignes que dans l'action).
    prisma.automationRule.findMany({ select: { conditions: true } }),
    prisma.broadcast.findMany({
      where: { status: { in: ["DRAFT", "SCHEDULED"] } },
      select: { segment: true },
    }),
  ]);
  const refsById = countCategoryReferences(rules, broadcasts);
  // Après une action, le tableau (et son volet) repart de zéro : le message de retour reste visible.
  const flashKey = JSON.stringify([sp.ok ?? null, sp.error ?? null]);

  const createPanel = (
    <SidePanel
      key={`create-${flashKey}`}
      title="Nouvelle catégorie"
      description="Pour ranger vos messages et comparer ce qui marche le mieux."
      trigger={
        <Button className="max-md:h-10">
          <Plus aria-hidden />
          Nouvelle catégorie
        </Button>
      }
    >
      <form action={createCategoryAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="new-name">Nom</Label>
          <Input
            id="new-name"
            name="name"
            required
            minLength={2}
            maxLength={40}
            placeholder="Ex. Jackpot"
            aria-describedby="new-name-aide"
          />
          <p id="new-name-aide" className="text-note text-muted-foreground">
            De 2 à 40 caractères. Vous pourrez le changer ensuite.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="space-y-2">
            <Label htmlFor="new-color">Couleur</Label>
            <input
              id="new-color"
              name="color"
              type="color"
              defaultValue="#64748b"
              className={colorInputClass}
            />
          </div>
          <div className="min-w-48 flex-1 space-y-2">
            <Label htmlFor="new-vertical">Univers</Label>
            <NativeSelect
              id="new-vertical"
              name="vertical"
              defaultValue=""
              wrapperClassName="w-full"
            >
              <UniverseOptions />
            </NativeSelect>
          </div>
        </div>
        <Button type="submit" className="max-md:h-10">
          Créer la catégorie
        </Button>
      </form>
    </SidePanel>
  );

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Catégories de messages"
        description="Vos propres catégories (bonus, jackpot, match du jour…) pour ranger les messages et comparer ce qui marche le mieux."
        help="Créez une catégorie ici, ou directement en écrivant un message (champ Catégorie → « + Nouvelle catégorie »)."
        primaryAction={createPanel}
        secondaryActions={
          <Link
            href="/messages/categories"
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <BarChart3 aria-hidden />
            Comparer par catégorie
          </Link>
        }
      />
      <SettingsGroupNav group="content" current="categories" />
      <Flash ok={sp.ok} error={sp.error} />

      <DataTable
        key={`table-${flashKey}`}
        label="Catégories de messages"
        columns={[
          { key: "name", header: "Catégorie", className: "min-w-40 whitespace-normal" },
          { key: "universe", header: "Univers", hideOnMobile: true },
          {
            key: "usage",
            header: "Utilisée par",
            hideOnMobile: true,
            className: "whitespace-normal",
          },
          { key: "state", header: "État" },
        ]}
        rows={categories.map((c) => {
          const refs = refsById.get(c.id);
          const referenced =
            c._count.posts > 0 || (refs?.rules ?? 0) > 0 || (refs?.broadcasts ?? 0) > 0;
          const usage = categoryUsageLabel(c._count.posts, refs);
          const others = categories.filter((o) => o.id !== c.id);
          return {
            id: c.id,
            cells: {
              name: (
                <span className="inline-flex items-center gap-2">
                  <ColorDot color={c.color} />
                  {c.name}
                </span>
              ),
              universe: c.vertical ? (
                <UniverseDot universe={c.vertical} withLabel />
              ) : (
                <span className="text-muted-foreground">Tous</span>
              ),
              usage: <span className="text-muted-foreground">{usage}</span>,
              state: c.isActive ? (
                <StatusPill tone="success">Active</StatusPill>
              ) : (
                <StatusPill tone="muted">Inactive</StatusPill>
              ),
            },
            sortValues: {
              name: c.name,
              universe: c.vertical ? universeLabel(c.vertical) : "",
              usage: c._count.posts + (refs?.rules ?? 0) + (refs?.broadcasts ?? 0),
              state: c.isActive ? 1 : 0,
            },
            detailTitle: c.name,
            detailDescription: usage,
            detail: (
              <div className="space-y-8">
                <form action={updateCategoryAction} className="space-y-5">
                  <input type="hidden" name="id" value={c.id} />
                  <div className="space-y-2">
                    <Label htmlFor={`name-${c.id}`}>Nom</Label>
                    <Input
                      id={`name-${c.id}`}
                      name="name"
                      defaultValue={c.name}
                      required
                      minLength={2}
                      maxLength={40}
                    />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`color-${c.id}`}>Couleur</Label>
                      <input
                        id={`color-${c.id}`}
                        name="color"
                        type="color"
                        defaultValue={c.color}
                        className={colorInputClass}
                      />
                    </div>
                    <div className="min-w-48 flex-1 space-y-2">
                      <Label htmlFor={`vertical-${c.id}`}>Univers</Label>
                      <NativeSelect
                        id={`vertical-${c.id}`}
                        name="vertical"
                        defaultValue={c.vertical ?? ""}
                        wrapperClassName="w-full"
                      >
                        <UniverseOptions />
                      </NativeSelect>
                    </div>
                  </div>
                  <label className="flex min-h-10 items-center gap-3 text-body">
                    <Checkbox name="isActive" value="on" defaultChecked={c.isActive} />
                    Active (proposée quand on écrit un message)
                  </label>
                  <AdvancedSection description="Ordre d'affichage dans les listes.">
                    <div className="space-y-2">
                      <Label htmlFor={`order-${c.id}`}>Ordre (0 en premier)</Label>
                      <Input
                        id={`order-${c.id}`}
                        name="sortOrder"
                        type="number"
                        min={0}
                        max={999}
                        defaultValue={c.sortOrder}
                        className="w-28"
                      />
                    </div>
                  </AdvancedSection>
                  <Button type="submit" className="max-md:h-10">
                    Enregistrer
                  </Button>
                </form>

                <form
                  action={deleteCategoryAction}
                  className="space-y-3 border-t border-border pt-6"
                >
                  <input type="hidden" name="id" value={c.id} />
                  <h3 className="text-body font-semibold text-foreground">
                    {referenced ? "Fusionner et supprimer" : "Supprimer la catégorie"}
                  </h3>
                  {referenced ? (
                    <>
                      <p className="text-note text-muted-foreground">
                        Les messages, relances automatiques et messages à un groupe pas encore
                        partis passent dans la catégorie choisie (ou sans catégorie), puis celle-ci
                        est supprimée.
                      </p>
                      <div className="space-y-2">
                        <Label htmlFor={`replacement-${c.id}`}>Déplacer vers</Label>
                        <NativeSelect
                          id={`replacement-${c.id}`}
                          name="replacementId"
                          defaultValue=""
                          wrapperClassName="w-full"
                        >
                          <option value="">Sans catégorie</option>
                          {others.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                    </>
                  ) : (
                    <p className="text-note text-muted-foreground">
                      Aucun message ne l&apos;utilise : elle sera simplement supprimée.
                    </p>
                  )}
                  <ConfirmSubmit
                    variant="destructive"
                    className="max-md:h-10"
                    confirmTitle={
                      referenced
                        ? `Fusionner et supprimer « ${c.name} »\u00a0?`
                        : `Supprimer « ${c.name} »\u00a0?`
                    }
                    message={deleteConfirmMessage(c.name, c._count.posts, refs)}
                  >
                    {referenced ? "Fusionner et supprimer" : "Supprimer"}
                  </ConfirmSubmit>
                </form>
              </div>
            ),
          };
        })}
        empty={{
          title: "Aucune catégorie pour l'instant",
          description:
            "Les catégories sont à créer vous-même, selon vos types de messages : cliquez sur « Nouvelle catégorie », ou créez-la en écrivant un message.",
        }}
      />
      {categories.length > 0 ? (
        <p className="mt-3 text-note text-muted-foreground">
          Cliquez sur une catégorie pour changer son nom, sa couleur ou son univers, ou pour la
          supprimer. Une catégorie supprimée peut être fusionnée dans une autre.
        </p>
      ) : null}
    </>
  );
}
