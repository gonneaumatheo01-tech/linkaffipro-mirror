"use client";

import { useState } from "react";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { assistantModeRefusal, botModeConfirmMessage } from "./bot-mode-logic";

/** Persona proposée dans la liste (inactive : signalée, l'assistant ne répond pas tant qu'elle est désactivée). */
export type BotModePersonaOption = { id: string; name: string; isActive: boolean };

/**
 * Champs du formulaire « Mode » d'un bot (dans `BotModeForm`, formulaire serveur) : mode, persona liée et bouton
 * « Enregistrer le mode ». Un bot normal qui gère des canaux (`channelCount` > 0) ne peut pas devenir l'assistante : le
 * choix « Assistant de conversation » est désactivé, avec l'explication (`assistantModeRefusal`, même refus côté
 * serveur). Un bot normal sans canal demande confirmation (`botModeConfirmMessage`). Libellés passés par le serveur
 * (`modeLabels`), comme le reste de la page.
 */
export function BotModeFields({
  bot,
  personas,
  modeLabels,
  channelCount,
}: {
  bot: { id: string; mode: string; personaId: string | null };
  personas: BotModePersonaOption[];
  modeLabels: { STANDARD: string; ASSISTANT: string };
  channelCount?: number | null;
}) {
  const [mode, setMode] = useState(bot.mode);
  const modeId = `bot-mode-${bot.id}`;
  const personaId = `bot-persona-${bot.id}`;
  const confirm = botModeConfirmMessage(bot.mode, mode, channelCount);
  const refusal = assistantModeRefusal(bot.mode, channelCount);
  const refusalId = `bot-mode-refusal-${bot.id}`;
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={modeId}>Mode</Label>
        <NativeSelect
          id={modeId}
          name="mode"
          defaultValue={bot.mode}
          onChange={(e) => setMode(e.currentTarget.value)}
          aria-describedby={refusal ? refusalId : undefined}
          wrapperClassName="w-full"
        >
          <option value="STANDARD">{modeLabels.STANDARD}</option>
          <option value="ASSISTANT" disabled={Boolean(refusal)}>
            {modeLabels.ASSISTANT}
          </option>
        </NativeSelect>
        {refusal ? (
          <p id={refusalId} className="text-note text-foreground">
            {refusal}
          </p>
        ) : null}
        <p className="text-note text-muted-foreground">
          En assistant de conversation, le bot discute en privé avec les personnes qui lui écrivent.
          Il ne s&apos;occupe plus des canaux : ni accueil, ni demandes d&apos;adhésion, ni liens.
          Utilisez un bot à part, créé exprès pour l&apos;assistante, jamais un bot de vos canaux.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={personaId}>Persona liée</Label>
        <NativeSelect
          id={personaId}
          name="personaId"
          defaultValue={bot.personaId ?? ""}
          wrapperClassName="w-full"
        >
          <option value="">Aucune</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.isActive ? p.name : `${p.name} (désactivée)`}
            </option>
          ))}
        </NativeSelect>
        <p className="text-note text-muted-foreground">
          Seulement pour un assistant de conversation : son prénom, son ton et l&apos;offre
          qu&apos;il présente. La description du bot dans Telegram dit qu&apos;il s&apos;agit de
          l&apos;assistante ou de l&apos;assistant du canal.
        </p>
      </div>
      {confirm ? (
        <ConfirmSubmit
          variant="outline"
          className="max-md:h-10"
          message={confirm}
          confirmTitle="Passer ce bot en assistant de conversation ?"
          confirmLabel="Passer en assistant"
        >
          Enregistrer le mode
        </ConfirmSubmit>
      ) : (
        <Button type="submit" variant="outline" className="max-md:h-10">
          Enregistrer le mode
        </Button>
      )}
    </>
  );
}
