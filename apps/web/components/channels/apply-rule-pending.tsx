"use client";

import { createContext, useContext } from "react";
import { History } from "lucide-react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { PendingRuleView } from "@/lib/channels/pending-rule";

/**
 * Ce que l'onglet « Qui peut entrer et quand » sait du canal, partagé par la règle par défaut et les volets des
 * exceptions (phase 14) sans passer par la liste des exceptions :
 * - l'accueil du canal parle-t-il d'une étape obligatoire (avertissement des canaux proposés) ;
 * - les demandes en cours qui suivent encore l'ancienne version de chaque règle (« Leur appliquer la nouvelle règle »).
 */
export type ChannelRulesContextValue = {
  channelId: string;
  /** Le message d'accueil du canal parle d'une étape obligatoire (« J'ai rejoint », « pour être accepté »…). */
  welcomeMentionsStep: boolean;
  /** « Ce que dit le bot », ouvert sur le message d'accueil. */
  welcomeHref: string;
  /** Demandes à recalculer, par identifiant de règle (textes prêts). */
  pending: Readonly<Record<string, PendingRuleView>>;
  /** Action « Leur appliquer la nouvelle règle » (champs `channelId`, `ruleId`). */
  applyAction: ((formData: FormData) => Promise<void>) | null;
};

const ChannelRulesContext = createContext<ChannelRulesContextValue | null>(null);

/** Fournit le contexte de l'onglet (rendu par la page serveur autour des formulaires de règle). */
export function ChannelRulesProvider({
  value,
  children,
}: {
  value: ChannelRulesContextValue;
  children: React.ReactNode;
}) {
  return <ChannelRulesContext.Provider value={value}>{children}</ChannelRulesContext.Provider>;
}

/** Contexte de l'onglet, ou null hors de l'onglet (aucun avertissement, aucun bouton). */
export function useChannelRules(): ChannelRulesContextValue | null {
  return useContext(ChannelRulesContext);
}

/**
 * Sous « Enregistrer la règle » : « 37 demandes déjà en attente suivent l'ancienne règle. [Leur appliquer la nouvelle
 * règle] », avec une fenêtre de confirmation (nombre et ce qui va se passer). Rien si aucune demande en cours ne
 * changerait avec la règle enregistrée.
 */
export function ApplyRulePending({
  ruleId,
  className,
}: {
  ruleId: string | null | undefined;
  className?: string;
}) {
  const ctx = useChannelRules();
  const view = ruleId ? ctx?.pending[ruleId] : undefined;
  if (!ctx?.applyAction || !view) return null;
  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border border-warning/25 bg-warning-soft p-4",
        className,
      )}
    >
      <History aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="min-w-0 space-y-3">
        <p className="text-body text-foreground">{view.sentence}</p>
        <form action={ctx.applyAction}>
          <input type="hidden" name="channelId" value={ctx.channelId} />
          <input type="hidden" name="ruleId" value={view.ruleId} />
          <ConfirmDialog
            title={view.confirmTitle}
            description={view.confirmDescription}
            confirmLabel="Appliquer la nouvelle règle"
            trigger={
              <Button type="submit" variant="outline" className="max-md:h-10">
                Leur appliquer la nouvelle règle
              </Button>
            }
          />
        </form>
      </div>
    </div>
  );
}
