import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle, Trash2 } from "lucide-react";
import { previewSystemPrompt } from "@linkaffipro/chat";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { PersonaRecommendations } from "@/components/agents/algo/persona-recommendations";
import { ConversationsNav } from "@/components/conversations/conversations-nav";
import { PersonaForm } from "@/components/personas/persona-form";
import { PersonaMediaForm } from "@/components/personas/persona-media-form";
import { PersonaTester } from "@/components/personas/persona-tester";
import { PromptPreview } from "@/components/personas/prompt-preview";
import { buttonVariants } from "@/components/ui/button";
import { loadPersonaRecommendations } from "@/lib/agents/algo/queries";
import { loadAssistantConfig } from "@/lib/assistant/config";
import { monthCostEur } from "@/lib/assistant/usage";
import { fmtNum } from "@/lib/format";
import { cleanIdentity, personaRole, personaToForm, universeLabelFr } from "@/lib/personas/form";
import { loadPersonaMedia } from "@/lib/personas/media-save";
import { loadPersona, loadPersonaFormChoices, loadPersonaTurnInput } from "@/lib/personas/queries";
import { personaDisplayName, testBlockedReason } from "@/lib/personas/view";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { deletePersonaAction, savePersonaAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/conversations/personas/[id]">): Promise<Metadata> {
  const { id } = await params;
  const persona = await loadPersona(id);
  return { title: persona ? `Persona ${personaDisplayName(persona.name)}` : "Persona introuvable" };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Fiche d'une persona (phase 17) : le formulaire en sections (Identité, Parcours, Offre, Profil du bot, Avancé, Mise
 * en service), puis « Médias du personnage » (phase 20, formulaire séparé), « Tester » à côté (conversation simulée
 * avec la vraie IA, sans Telegram, d'après la version enregistrée), l'aperçu replié des consignes envoyées à l'IA et, pour les administrateurs, « Supprimer la persona » (refusé tant
 * qu'un bot l'utilise). ADMIN et MANAGER modifient.
 */
export default async function PersonaPage({
  params,
  searchParams,
}: PageProps<"/conversations/personas/[id]">) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const persona = await loadPersona(id);
  if (!persona) notFound();
  const [choices, turn, config, spent, media, algoRecs] = await Promise.all([
    loadPersonaFormChoices({
      affiliateCampaignId: persona.affiliateCampaignId,
      offerMediaAssetId: persona.offerMediaAssetId,
    }),
    loadPersonaTurnInput(persona.id),
    loadAssistantConfig(),
    monthCostEur(),
    loadPersonaMedia(persona.id),
    loadPersonaRecommendations(persona.id),
  ]);
  const role = personaRole(persona.gender);
  const name = personaDisplayName(persona.name);
  const assistantBots = persona.bots.filter((b) => b.mode === "ASSISTANT");
  const prompt = turn ? previewSystemPrompt(turn.input) : null;
  const blockedReason = testBlockedReason({
    hasKey: Boolean(config.apiKeyEncrypted),
    isAdmin: me.role === "ADMIN",
    spentEur: spent,
    capEur: config.monthlyCapEur,
  });
  const offerNote =
    turn && !turn.input.hasOffer
      ? turn.offerLinked
        ? "L'offre liée n'est plus active : aucun lien ne partira."
        : "Aucune offre liée : aucun lien ne partira."
      : null;

  return (
    <>
      <ConversationsNav current="personas" />
      <PageHeader
        title={name}
        backHref="/conversations/personas"
        backLabel="Personas"
        meta={
          persona.isActive ? (
            <StatusPill tone="success">Active</StatusPill>
          ) : (
            <StatusPill tone="muted">Inactive</StatusPill>
          )
        }
        description={`${universeLabelFr(persona.universe)} · ${cap(role)} du canal · ${fmtNum(persona.conversations)} conversation${persona.conversations > 1 ? "s" : ""}${
          assistantBots.length
            ? ` · ${assistantBots.length > 1 ? "bots" : "bot"} ${assistantBots.map((b) => `@${b.username}`).join(", ")}`
            : ""
        }`}
        help={
          assistantBots.length === 0
            ? "Aucun bot ne l'utilise encore : un administrateur ajoute un bot créé exprès pour l'assistante (jamais un bot de vos canaux), puis la lie dans Réglages → Bots (Mode : assistant de conversation)."
            : undefined
        }
        secondaryActions={
          <Link
            href="#tester"
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <MessageCircle aria-hidden />
            Tester
          </Link>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
          <PersonaForm
            key={`${persona.id}-${persona.updatedAt.getTime()}`}
            initial={personaToForm(persona, choices.templates)}
            offers={choices.offers}
            campaigns={choices.campaigns}
            images={choices.images}
            models={choices.models}
            defaultModel={choices.defaultModel}
            templates={choices.templates}
            action={savePersonaAction}
            canEditFaq={me.role === "ADMIN"}
          />
        </div>

        <div className="min-w-0 xl:sticky xl:top-4 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start">
          <PersonaTester
            key={`${persona.id}-${persona.updatedAt.getTime()}`}
            personaId={persona.id}
            personaName={persona.name}
            gender={persona.gender}
            maxOfferSends={persona.maxOfferSends}
            blockedReason={blockedReason}
            offerNote={offerNote}
          />
        </div>

        <div className="min-w-0 max-w-3xl space-y-10 xl:col-start-1">
          {media ? (
            <PersonaMediaForm
              key={`media-${persona.id}-${persona.updatedAt.getTime()}`}
              personaId={persona.id}
              personaName={persona.name}
              isGirl={cleanIdentity(persona.identityKind) === "GIRL"}
              initial={media}
            />
          ) : null}
          <PersonaRecommendations personaId={persona.id} recs={algoRecs} role={me.role} />
          {prompt ? <PromptPreview prompt={prompt} role={role} /> : null}

          {me.role === "ADMIN" ? (
            <section
              aria-labelledby="persona-delete-title"
              className="space-y-3 border-t border-border pt-6"
            >
              <h2 id="persona-delete-title" className="text-body font-semibold text-foreground">
                Supprimer la persona
              </h2>
              {persona.bots.length > 0 ? (
                <p className="text-note text-muted-foreground">
                  Impossible tant qu&apos;un bot l&apos;utilise (
                  {persona.bots.map((b) => `@${b.username}`).join(", ")}) : dans Réglages → Bots,
                  liez-lui une autre persona ou repassez-le en bot normal. Pour l&apos;arrêter tout
                  de suite, décochez plutôt « Persona activée ».
                </p>
              ) : (
                <>
                  <p className="text-note text-muted-foreground">
                    Ses conversations restent dans la boîte de réception. Pour l&apos;arrêter
                    quelque temps, décochez plutôt « Persona activée ».
                  </p>
                  <form action={deletePersonaAction}>
                    <input type="hidden" name="personaId" value={persona.id} />
                    <ConfirmSubmit
                      variant="destructive"
                      className="max-md:h-10"
                      confirmTitle={`Supprimer la persona « ${name} » ?`}
                      confirmLabel="Supprimer la persona"
                      destructive
                      message="Elle disparaît de la liste et ne pourra plus être liée à un bot. Ses conversations restent."
                    >
                      <Trash2 aria-hidden />
                      Supprimer la persona
                    </ConfirmSubmit>
                  </form>
                </>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
