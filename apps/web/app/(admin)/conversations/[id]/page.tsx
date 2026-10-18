import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Info, UserRound } from "lucide-react";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { ConversationActionButtons } from "@/components/conversations/conversation-actions";
import { ConversationFacts } from "@/components/conversations/conversation-facts";
import { ConversationThread } from "@/components/conversations/conversation-thread";
import { ConversationsNav } from "@/components/conversations/conversations-nav";
import { TeamReplyForm } from "@/components/conversations/team-reply-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { loadAssistantConfig } from "@/lib/assistant/config";
import { loadConversationDetail } from "@/lib/conversations/detail";
import { assistantWord, personName } from "@/lib/conversations/labels";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { cn } from "@/lib/utils";
import {
  blockAction,
  closeAction,
  releaseAction,
  sendTeamMessageAction,
  takeOverAction,
} from "./actions";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

/** Phrase sous les boutons : qui répond en ce moment dans cette conversation (sans accord selon la persona). */
function whoAnswersSentence(status: string, word: string, activationOff: boolean): string | null {
  if (status === "BOT")
    return activationOff
      ? `C'est ${word} qui a la main, mais l'assistant de conversation est désactivé (Réglages → IA de conversation) : personne ne répond pour l'instant.`
      : `C'est ${word} qui répond. Prenez la main pour écrire vous-même : ${word} se tait aussitôt.`;
  if (status === "HUMAN")
    return `Vous avez la main : ${word} ne répond pas. Rendez-lui la conversation quand vous avez fini ; les messages reçus entre-temps resteront sans réponse de sa part.`;
  if (status === "PAUSED")
    return `Conversation en pause : personne ne répond, ni ${word} ni l'équipe.`;
  if (status === "CLOSED")
    return `Conversation fermée : ${word} ne répond plus. Prenez la main ou écrivez pour la rouvrir.`;
  return null;
}

/**
 * Fiche d'une conversation de l'assistant (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 6) : le fil des messages
 * mis à jour en direct (bulles de la personne, de l'assistante, de l'équipe et messages automatiques), la zone
 * « Écrire à cette personne » (« Envoyer », seul bouton orange), les boutons de reprise en main (Prendre la main,
 * Rendre à l'assistante, Fermer, Bloquer), et à droite la conversation (personne, persona, source, étape, langue) et
 * ses résultats (liens de l'offre, inscription, premier dépôt, coût de l'IA), puis ce que l'assistante retient.
 * Administrateurs et managers (`requireUser`).
 */
export default async function ConversationPage({
  params,
  searchParams,
}: PageProps<"/conversations/[id]">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const [c, config] = await Promise.all([loadConversationDetail(id), loadAssistantConfig()]);
  if (!c) notFound();
  const name = personName(c.member);
  const word = assistantWord(c.persona?.gender);
  const sentence = whoAnswersSentence(c.status, word, config.activation === "off");
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  return (
    <>
      <ConversationsNav current="inbox" />
      <PageHeader
        title={name}
        backHref="/conversations"
        backLabel="Boîte de réception"
        description={
          c.persona
            ? `Conversation avec ${c.persona.name}, ${word} du bot @${c.bot.username}.`
            : `Conversation sur le bot @${c.bot.username}.`
        }
        meta={
          <>
            <StatusBadge kind="conversationStage" value={c.stage} />
            <StatusBadge kind="conversationStatus" value={c.status} />
          </>
        }
        secondaryActions={
          c.member.anonymizedAt ? null : (
            <Link
              href={`/members/${c.member.id}`}
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              <UserRound aria-hidden />
              Fiche du membre
            </Link>
          )
        }
      />
      <Flash ok={ok} error={error} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-labelledby="conv-thread" className="min-w-0 space-y-4">
          <h2 id="conv-thread" className="sr-only">
            Messages
          </h2>
          <div className="space-y-2">
            <ConversationActionButtons
              conversationId={c.id}
              actions={c.actions}
              gender={c.persona?.gender ?? null}
              takeOverAction={takeOverAction}
              releaseAction={releaseAction}
              closeAction={closeAction}
              blockAction={blockAction}
            />
            {sentence && !c.actions.lock ? (
              <p className="text-note text-muted-foreground">{sentence}</p>
            ) : null}
          </div>
          {c.status === "HUMAN" && config.activation !== "off" && !c.persona?.isActive ? (
            <Alert variant="info" role="status">
              <Info aria-hidden />
              <AlertDescription>
                La persona de cette conversation est désactivée : en rendant la main, personne ne
                répondra tant qu&apos;elle n&apos;est pas réactivée (onglet Personas).
              </AlertDescription>
            </Alert>
          ) : null}
          <ConversationThread
            key={c.resets}
            conversationId={c.id}
            initialMessages={c.messages}
            initialOffers={c.offers}
            initialCursor={c.cursor}
            stateKey={c.stateKey}
            truncated={c.truncated}
          />
          <TeamReplyForm
            conversationId={c.id}
            action={sendTeamMessageAction}
            lockMessage={c.actions.lock?.message ?? null}
            willTakeOver={c.status !== "HUMAN"}
            assistant={word}
          />
        </section>
        <aside aria-label="La conversation en bref" className="min-w-0">
          <ConversationFacts c={c} />
        </aside>
      </div>
    </>
  );
}
