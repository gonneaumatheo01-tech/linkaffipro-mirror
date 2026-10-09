import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPage } from "@/lib/session";
import { SETTINGS_PAGES } from "./nav";

export const metadata: Metadata = { title: "Réglages" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await requireAdminPage();
  const sp = await searchParams;
  return (
    <>
      <PageHeader
        title="Réglages"
        description="Tout ce qui se règle une fois pour toute l'équipe : comptes, connecteurs, catégories, étiquettes, alertes, postbacks, rapports. Réservé aux administrateurs."
        help="Pour ajouter un équipier ou réinitialiser un mot de passe, ouvrez « Équipe »."
      />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_PAGES.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="text-base">{p.label}</CardTitle>
                <CardDescription>{p.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">Ouvrir →</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
