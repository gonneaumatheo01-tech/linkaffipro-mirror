import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { ConversationsNav } from "@/components/conversations/conversations-nav";
import { PersonaForm } from "@/components/personas/persona-form";
import { emptyPersonaForm } from "@/lib/personas/form";
import { loadPersonaFormChoices } from "@/lib/personas/queries";
import { requireUser } from "@/lib/session";
import { savePersonaAction } from "../actions";

export const metadata: Metadata = { title: "Nouvelle persona" };
export const dynamic = "force-dynamic";

/**
 * Nouvelle persona (phase 17) : le formulaire unique, désactivée par défaut, avec les textes du profil du bot déjà
 * proposés (ils disent « assistante du canal »). « Créer la persona » ouvre la fiche, où se trouve « Tester ».
 * ADMIN et MANAGER (fiche d'informations : ADMIN seulement, lecture seule pour un MANAGER).
 */
export default async function NewPersonaPage() {
  const me = await requireUser();
  const choices = await loadPersonaFormChoices();
  return (
    <>
      <ConversationsNav current="personas" />
      <PageHeader
        title="Nouvelle persona"
        backHref="/conversations/personas"
        backLabel="Personas"
        description="Un prénom, une personnalité, l'offre présentée et le moment du lien. Elle est créée désactivée si vous ne cochez pas « Persona activée » : testez-la d'abord sur sa fiche, puis activez-la."
      />
      <PersonaForm
        initial={emptyPersonaForm(choices.templates)}
        offers={choices.offers}
        campaigns={choices.campaigns}
        images={choices.images}
        models={choices.models}
        defaultModel={choices.defaultModel}
        templates={choices.templates}
        action={savePersonaAction}
        canEditFaq={me.role === "ADMIN"}
      />
      <p className="mt-6 max-w-3xl text-note text-muted-foreground">
        Photos et vidéos du personnage : elles s&apos;ajoutent sur sa fiche, une fois la persona créée (section
        « Médias du personnage »).
      </p>
    </>
  );
}
