import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Compass } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { restartTourAction } from "@/lib/onboarding/actions";
import { requireUser } from "@/lib/session";
import { settingsPagesFor } from "./nav";

export const metadata: Metadata = { title: "Réglages" };

/**
 * Réglages : un écran en cartes, ouvert à tous les rôles. Chacun ne voit que les cartes qu'il peut ouvrir
 * (`settingsPagesFor`) ; chaque sous-page garde ses propres contrôles d'accès.
 */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const sp = await searchParams;
  const pages = settingsPagesFor(user.role);
  return (
    <>
      <PageHeader
        title="Réglages"
        description={
          isAdmin
            ? "Tout ce qui se règle une fois pour toute l'équipe : comptes, connexions, bots, catégories, alertes, rapports."
            : "Les réglages que vous pouvez consulter. Les autres sont réservés aux administrateurs."
        }
        help={
          isAdmin
            ? "Pour ajouter un équipier ou réinitialiser un mot de passe, ouvrez « Équipe »."
            : undefined
        }
        secondaryActions={
          <form action={restartTourAction}>
            <Button type="submit" variant="outline" className="max-md:h-10">
              <Compass aria-hidden />
              Revoir la visite
            </Button>
          </form>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pages.map((p) => (
          <li key={p.href}>
            <Link
              href={p.href}
              className="group block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Card className="h-full transition-colors group-hover:border-brand/50 group-hover:bg-brand-soft/30">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    {p.label}
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </CardTitle>
                  <CardDescription>{p.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
