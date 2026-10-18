import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { statusLabel } from "@/lib/status-badges";

/** Persona proposée dans la liste (inactive : signalée, l'assistant ne répond pas tant qu'elle est désactivée). */
export type BotModePersonaOption = { id: string; name: string; isActive: boolean };

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
 */
export function BotModeForm({
  bot,
  personas,
  action,
}: {
  bot: { id: string; mode: string; personaId: string | null };
  personas: BotModePersonaOption[];
  action: (formData: FormData) => Promise<void>;
}) {
  const modeId = `bot-mode-${bot.id}`;
  const personaId = `bot-persona-${bot.id}`;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="botId" value={bot.id} />
      <div className="space-y-2">
        <Label htmlFor={modeId}>Mode</Label>
        <NativeSelect id={modeId} name="mode" defaultValue={bot.mode} wrapperClassName="w-full">
          <option value="STANDARD">{statusLabel("botMode", "STANDARD")}</option>
          <option value="ASSISTANT">{statusLabel("botMode", "ASSISTANT")}</option>
        </NativeSelect>
        <p className="text-note text-muted-foreground">
          En assistant de conversation, le bot discute en privé avec les personnes qui lui écrivent.
          Il ne s&apos;occupe plus des canaux : ni accueil, ni demandes d&apos;adhésion, ni liens.
          Utilisez un bot à part pour cela.
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
      <Button type="submit" variant="outline" className="max-md:h-10">
        Enregistrer le mode
      </Button>
    </form>
  );
}
