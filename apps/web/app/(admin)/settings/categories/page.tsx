import type { Metadata } from "next";
import Link from "next/link";
import { VERTICALS, VERTICAL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAdminPage } from "@/lib/session";
import { ActiveBadge } from "@/lib/status-badges";
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "./actions";
import { countCategoryReferences, deleteConfirmMessage } from "./remap";

export const metadata: Metadata = { title: "Catégories de messages" };

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
  const selectCls = "h-10 rounded-md border bg-background px-2 text-sm md:h-8";
  return (
    <>
      <PageHeader
        title="Catégories de messages"
        description="Classez vos messages avec vos propres catégories (à créer vous-même) pour comparer ce qui marche le mieux."
        help="Créez une catégorie ci-dessous, ou directement en écrivant un message (champ Catégorie → « + Nouvelle catégorie »). La comparaison se fait dans Messages → Catégories."
      >
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/messages/categories" />}
        >
          Comparer par catégorie
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings" />}
        >
          ← Réglages
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catégories</CardTitle>
          <CardDescription>
            Changez le nom, la couleur ou l&apos;ordre, puis cliquez « Enregistrer ». « Fusionner et
            supprimer » déplace les messages, les automatisations et les envois pas encore partis
            vers la catégorie choisie (ou sans catégorie), puis supprime la catégorie. Sans
            remplacement, une automatisation ou un envoi programmé qui ne visait que cette catégorie
            est mis en pause (désactivé ou remis en brouillon).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {categories.length === 0 ? (
            <EmptyState
              title="Aucune catégorie pour l'instant."
              description="Les catégories sont à créer vous-même, selon vos types de messages : créez la première ci-dessous, ou depuis Messages → Nouveau message."
            />
          ) : null}
          {categories.map((c) => {
            const refs = refsById.get(c.id);
            const referenced =
              c._count.posts > 0 || (refs?.rules ?? 0) > 0 || (refs?.broadcasts ?? 0) > 0;
            return (
              <div key={c.id} className="rounded-md border p-3">
                <form
                  action={updateCategoryAction}
                  className="grid gap-2 sm:flex sm:flex-wrap sm:items-end"
                >
                  <input type="hidden" name="id" value={c.id} />
                  <div className="space-y-1">
                    <Label htmlFor={`name-${c.id}`} className="text-xs">
                      Nom
                    </Label>
                    <Input
                      id={`name-${c.id}`}
                      name="name"
                      defaultValue={c.name}
                      className="h-10 w-full sm:w-44 md:h-8"
                      required
                      minLength={2}
                      maxLength={40}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`color-${c.id}`} className="text-xs">
                      Couleur
                    </Label>
                    <input
                      id={`color-${c.id}`}
                      name="color"
                      type="color"
                      defaultValue={c.color}
                      className="h-10 w-12 cursor-pointer rounded border bg-background md:h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`vertical-${c.id}`} className="text-xs">
                      Univers
                    </Label>
                    <select
                      id={`vertical-${c.id}`}
                      name="vertical"
                      defaultValue={c.vertical ?? ""}
                      className={selectCls}
                    >
                      <option value="">Tous</option>
                      {VERTICALS.map((v) => (
                        <option key={v} value={v}>
                          {VERTICAL_LABELS[v]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`order-${c.id}`} className="text-xs">
                      Ordre
                    </Label>
                    <Input
                      id={`order-${c.id}`}
                      name="sortOrder"
                      type="number"
                      min={0}
                      max={999}
                      defaultValue={c.sortOrder}
                      className="h-10 w-20 md:h-8"
                    />
                  </div>
                  <label className="flex h-10 items-center gap-2 text-sm md:h-8">
                    <input
                      type="checkbox"
                      name="isActive"
                      defaultChecked={c.isActive}
                      className="size-4"
                    />{" "}
                    Active
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {c._count.posts} message{c._count.posts > 1 ? "s" : ""}
                    {refs?.rules
                      ? ` · ${refs.rules} automatisation${refs.rules > 1 ? "s" : ""}`
                      : ""}
                    {refs?.broadcasts
                      ? ` · ${refs.broadcasts} envoi${refs.broadcasts > 1 ? "s" : ""} pas encore parti${refs.broadcasts > 1 ? "s" : ""}`
                      : ""}
                  </span>
                  {!c.isActive ? <ActiveBadge active={false} /> : null}
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="max-md:h-10"
                    aria-label={`Enregistrer la catégorie ${c.name}`}
                  >
                    Enregistrer
                  </Button>
                </form>
                <form
                  action={deleteCategoryAction}
                  className="mt-2 flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="id" value={c.id} />
                  {referenced ? (
                    <select
                      name="replacementId"
                      aria-label={`Catégorie de remplacement pour ${c.name}`}
                      className="h-9 rounded-md border bg-background px-2 text-sm max-md:h-10"
                    >
                      <option value="">— sans catégorie —</option>
                      {categories
                        .filter((o) => o.id !== c.id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            fusionner dans « {o.name} »
                          </option>
                        ))}
                    </select>
                  ) : null}
                  <ConfirmSubmit
                    size="sm"
                    variant="ghost"
                    className="text-destructive max-md:h-10"
                    message={deleteConfirmMessage(c.name, c._count.posts, refs)}
                  >
                    {referenced ? "Fusionner et supprimer" : "Supprimer"}
                  </ConfirmSubmit>
                </form>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mt-6 max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Nouvelle catégorie</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={createCategoryAction}
            className="grid gap-2 sm:flex sm:flex-wrap sm:items-end"
          >
            <div className="space-y-1">
              <Label htmlFor="new-name" className="text-xs">
                Nom
              </Label>
              <Input
                id="new-name"
                name="name"
                required
                minLength={2}
                maxLength={40}
                className="h-10 w-full sm:w-44 md:h-8"
                placeholder="Ex. Jackpot"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-color" className="text-xs">
                Couleur
              </Label>
              <input
                id="new-color"
                name="color"
                type="color"
                defaultValue="#64748b"
                className="h-10 w-12 cursor-pointer rounded border bg-background md:h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-vertical" className="text-xs">
                Univers
              </Label>
              <select id="new-vertical" name="vertical" defaultValue="" className={selectCls}>
                <option value="">Tous</option>
                {VERTICALS.map((v) => (
                  <option key={v} value={v}>
                    {VERTICAL_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" className="max-md:h-10">
              Créer la catégorie
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
