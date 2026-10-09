import type { Metadata } from "next";
import Link from "next/link";
import { VERTICALS, VERTICAL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAdminPage } from "@/lib/session";
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "./actions";

export const metadata: Metadata = { title: "Catégories" };

export default async function CategoriesPage({ searchParams }: PageProps<"/settings/categories">) {
  await requireAdminPage();
  const sp = await searchParams;
  const categories = await prisma.messageCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { posts: true } } } });
  const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";
  return (
    <>
      <PageHeader title="Catégories de messages" description="Classez vos messages (Bonus, Preuve de gains, Teasing…) pour comparer ce qui marche.">
        <Button variant="outline" size="sm" render={<Link href="/messages/categories" />}>Comparer par catégorie</Button>
        <Button variant="ghost" size="sm" render={<Link href="/settings" />}>← Réglages</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catégories</CardTitle>
          <CardDescription>Une catégorie utilisée par des messages ne peut pas être supprimée : désactivez-la.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {categories.length === 0 ? <p className="text-sm text-muted-foreground">Aucune catégorie.</p> : null}
          {categories.map((c) => (
            <div key={c.id} className="rounded-md border p-3">
              <form action={updateCategoryAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={c.id} />
                <div className="space-y-1">
                  <Label htmlFor={`name-${c.id}`} className="text-xs">Nom</Label>
                  <Input id={`name-${c.id}`} name="name" defaultValue={c.name} className="h-8 w-44" required minLength={2} maxLength={40} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`color-${c.id}`} className="text-xs">Couleur</Label>
                  <input id={`color-${c.id}`} name="color" type="color" defaultValue={c.color} className="h-8 w-12 cursor-pointer rounded border bg-background" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`vertical-${c.id}`} className="text-xs">Univers</Label>
                  <select id={`vertical-${c.id}`} name="vertical" defaultValue={c.vertical ?? ""} className={selectCls}>
                    <option value="">Tous</option>
                    {VERTICALS.map((v) => <option key={v} value={v}>{VERTICAL_LABELS[v]}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`order-${c.id}`} className="text-xs">Ordre</Label>
                  <Input id={`order-${c.id}`} name="sortOrder" type="number" min={0} max={999} defaultValue={c.sortOrder} className="h-8 w-20" />
                </div>
                <label className="flex h-8 items-center gap-1 text-sm"><input type="checkbox" name="isActive" defaultChecked={c.isActive} /> Active</label>
                <span className="text-xs text-muted-foreground">{c._count.posts} message{c._count.posts > 1 ? "s" : ""} · <code>{c.slug}</code></span>
                {!c.isActive ? <Badge variant="secondary">désactivée</Badge> : null}
                <Button type="submit" size="sm" variant="outline">Enregistrer</Button>
              </form>
              {c._count.posts === 0 ? (
                <form action={deleteCategoryAction} className="mt-2">
                  <input type="hidden" name="id" value={c.id} />
                  <Button type="submit" size="sm" variant="ghost" className="text-destructive">Supprimer</Button>
                </form>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-6 max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Nouvelle catégorie</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createCategoryAction} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="new-name" className="text-xs">Nom</Label>
              <Input id="new-name" name="name" required minLength={2} maxLength={40} className="h-8 w-44" placeholder="Ex. Jackpot" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-color" className="text-xs">Couleur</Label>
              <input id="new-color" name="color" type="color" defaultValue="#64748b" className="h-8 w-12 cursor-pointer rounded border bg-background" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-vertical" className="text-xs">Univers</Label>
              <select id="new-vertical" name="vertical" defaultValue="" className={selectCls}>
                <option value="">Tous</option>
                {VERTICALS.map((v) => <option key={v} value={v}>{VERTICAL_LABELS[v]}</option>)}
              </select>
            </div>
            <Button type="submit" size="sm">Créer</Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
