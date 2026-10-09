import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAdminPage } from "@/lib/session";
import { getTagRegistry, TAG_COLORS, TAG_NAME_MAX, tagColorClass } from "@/lib/members/tags";
import { createTagAction, deleteTagAction, updateTagAction } from "./actions";

export const metadata: Metadata = { title: "Étiquettes de membres" };

function ColorSelect({ id, defaultValue }: { id: string; defaultValue: string }) {
  return (
    <select
      id={id}
      name="color"
      defaultValue={defaultValue}
      className="h-10 rounded-md border bg-background px-2 text-sm md:h-8"
    >
      {TAG_COLORS.map((c) => (
        <option key={c.key} value={c.key}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

export default async function TagsPage({ searchParams }: PageProps<"/settings/tags">) {
  await requireAdminPage();
  const sp = await searchParams;
  const registry = await getTagRegistry();
  const counts = await Promise.all(
    registry.map((t) => prisma.member.count({ where: { tags: { array_contains: [t.name] } } })),
  );
  return (
    <>
      <PageHeader
        title="Étiquettes de membres"
        description="Des étiquettes colorées (VIP, test, à relancer…) à poser sur les membres, pour les retrouver dans Membres et les cibler dans les envois groupés."
        help="Créez une étiquette ci-dessous, puis posez-la depuis une fiche membre (bloc « Étiquettes »). Les automatisations peuvent aussi en poser."
      >
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/members" />}
        >
          Voir les membres
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
          <CardTitle className="text-base">Étiquettes</CardTitle>
          <CardDescription>
            Renommer une étiquette la met à jour chez tous les membres qui la portent. La supprimer
            la retire de tous les membres.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {registry.length === 0 ? (
            <EmptyState
              title="Aucune étiquette pour l'instant."
              description="Créez-en une ci-dessous (ex. VIP, test, à relancer)."
            />
          ) : null}
          {registry.map((t, i) => (
            <div key={t.name} className="rounded-md border p-3">
              <form
                action={updateTagAction}
                className="grid gap-2 sm:flex sm:flex-wrap sm:items-end"
              >
                <input type="hidden" name="oldName" value={t.name} />
                <Badge variant="outline" className={`self-center ${tagColorClass(t.color)}`}>
                  {t.name}
                </Badge>
                <div className="space-y-1">
                  <Label htmlFor={`name-${i}`} className="text-xs">
                    Nom
                  </Label>
                  <Input
                    id={`name-${i}`}
                    name="name"
                    defaultValue={t.name}
                    required
                    maxLength={TAG_NAME_MAX}
                    className="h-10 w-full sm:w-44 md:h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`color-${i}`} className="text-xs">
                    Couleur
                  </Label>
                  <ColorSelect id={`color-${i}`} defaultValue={t.color} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {counts[i]} membre{(counts[i] ?? 0) > 1 ? "s" : ""}
                </span>
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="max-md:h-10"
                  aria-label={`Enregistrer l'étiquette ${t.name}`}
                >
                  Enregistrer
                </Button>
              </form>
              <form action={deleteTagAction} className="mt-2">
                <input type="hidden" name="name" value={t.name} />
                <ConfirmSubmit
                  size="sm"
                  variant="ghost"
                  className="text-destructive max-md:h-10"
                  message={`L'étiquette « ${t.name} » sera supprimée et retirée de ${counts[i]} membre${(counts[i] ?? 0) > 1 ? "s" : ""}. Continuer ?`}
                >
                  Supprimer
                </ConfirmSubmit>
              </form>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-6 max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Nouvelle étiquette</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createTagAction} className="grid gap-2 sm:flex sm:flex-wrap sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="new-name" className="text-xs">
                Nom
              </Label>
              <Input
                id="new-name"
                name="name"
                required
                maxLength={TAG_NAME_MAX}
                className="h-10 w-full sm:w-44 md:h-8"
                placeholder="Ex. VIP"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-color" className="text-xs">
                Couleur
              </Label>
              <ColorSelect id="new-color" defaultValue="blue" />
            </div>
            <Button type="submit" size="sm" className="max-md:h-10">
              Créer l&apos;étiquette
            </Button>
          </form>
          <div className="mt-3 flex flex-wrap gap-1">
            {TAG_COLORS.map((c) => (
              <Badge key={c.key} variant="outline" className={c.className}>
                {c.label}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
