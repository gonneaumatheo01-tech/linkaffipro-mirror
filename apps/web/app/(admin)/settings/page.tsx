import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { SettingsCardGrid } from "@/components/settings/settings-card-grid";
import { Button } from "@/components/ui/button";
import { restartTourAction } from "@/lib/onboarding/actions";
import { requireUser } from "@/lib/session";
import { NO_STATE_INPUT, settingsStates } from "@/lib/status/settings-cards";
import { loadSettingsStateInput } from "@/lib/status/settings-cards-queries";
import { settingsCardsFor, stateKeysOf } from "./nav";

export const metadata: Metadata = { title: "Réglages" };
export const dynamic = "force-dynamic";

/**
 * Réglages : un écran en cartes regroupées (docs/REFONTE-UX.md), ouvert à tous les rôles. Chacun ne voit que les
 * cartes qu'il peut ouvrir (`settingsCardsFor`) ; chaque sous-page garde ses propres contrôles d'accès. Les pastilles
 * d'état (« Link Affi synchronisé il y a 2 min », « Clé IA absente ») ne lisent que les données des cartes visibles.
 */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const isAdmin = user.role === "ADMIN";
  const now = new Date();
  const cards = settingsCardsFor(user.role);
  const input = await loadSettingsStateInput(stateKeysOf(cards), now).catch(() => NO_STATE_INPUT);
  const states = settingsStates(input, now);
  return (
    <>
      <PageHeader
        title="Réglages"
        description={
          isAdmin
            ? "Ce qui se règle une fois pour toute l'équipe : connexions, bots, comptes, alertes."
            : "Les réglages que vous pouvez ouvrir. Les autres sont réservés aux administrateurs."
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
      <SettingsCardGrid cards={cards} states={states} />
    </>
  );
}
