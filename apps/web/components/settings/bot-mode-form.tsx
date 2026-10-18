import { statusLabel } from "@/lib/status-badges";
import { BotModeFields, type BotModePersonaOption } from "./bot-mode-fields";

export type { BotModePersonaOption };

/** Mode d'un bot et persona liée, en mots simples (« Bot normal », « Assistant de conversation · Léa »). */
export function botModeSummary(
  mode: string,
  persona: { name: string; isActive: boolean } | null,
): string {
  if (mode !== "ASSISTANT") return statusLabel("botMode", "STANDARD");
  const label = statusLabel("botMode", "ASSISTANT");
  if (!persona) return `${label} · aucune persona liée`;
  return `${label} · ${persona.name}${persona.isActive ? "" : " (désactivée)"}`;
}

/**
 * Réglages → Bots, détail d'un bot (ADMIN) : « Mode » (bot normal / assistant de conversation) et « Persona liée ».
 * Bouton secondaire (contour) : l'orange reste réservé à « Ajouter un bot ». `action` : `setBotModeAction`.
 * `bot.channelCount` (canaux administrés) : un bot normal qui gère au moins un canal ne peut pas devenir l'assistante
 * (choix désactivé et expliqué, refusé aussi par le serveur) ; sans canal, le passage en assistant demande confirmation
 * (`BotModeFields`).
 */
export function BotModeForm({
  bot,
  personas,
  action,
}: {
  bot: { id: string; mode: string; personaId: string | null; channelCount?: number | null };
  personas: BotModePersonaOption[];
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="botId" value={bot.id} />
      <BotModeFields
        bot={{ id: bot.id, mode: bot.mode, personaId: bot.personaId }}
        personas={personas}
        channelCount={bot.channelCount}
        modeLabels={{
          STANDARD: statusLabel("botMode", "STANDARD"),
          ASSISTANT: statusLabel("botMode", "ASSISTANT"),
        }}
      />
    </form>
  );
}
