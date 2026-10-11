"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AiVertical } from "@linkaffipro/ai/types";
import { ImproveButton } from "@/components/ai/improve-button";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Label } from "@/components/ui/label";
import {
  PLACEHOLDER_CHIPS,
  fillExamples,
  type BotMoment,
  type PlaceholderExamples,
} from "@/lib/channels/bot-messages";

/**
 * Texte d'un message du bot dans une langue : l'éditeur partagé (texte mis en forme sans balise visible, barre
 * d'outils avec émojis et « Améliorer avec l'IA », repères à insérer en un clic : prénom, nom du canal…), et l'aperçu
 * Telegram mis à jour pendant la frappe (repères remplacés par des exemples). Le texte est soumis en HTML Telegram
 * sous le nom `text` avec le formulaire « Enregistrer ». « Traduire dans les langues du bot » enregistre directement
 * les autres langues, puis recharge.
 */
export function BotTextEditor({
  id,
  label,
  defaultValue,
  required,
  examples,
  buttons,
  mediaCount,
  context,
  channelId,
  moment,
  saveTranslations,
}: {
  id: string;
  label: string;
  defaultValue: string;
  required: boolean;
  examples: PlaceholderExamples;
  buttons: Array<Array<{ text: string }>>;
  mediaCount: number;
  context: { vertical: AiVertical | null; language: string; hasMedia: boolean };
  channelId: string;
  moment: BotMoment;
  /** Action serveur qui enregistre les traductions de l'assistant ; renvoie une erreur lisible sinon. */
  saveTranslations: (input: {
    channelId: string;
    trigger: BotMoment;
    texts: Partial<Record<string, string>>;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <RichTextEditor
          id={id}
          name="text"
          label={label}
          value={value}
          onChange={setValue}
          required={required}
          describedBy={`${id}-help`}
          placeholders={PLACEHOLDER_CHIPS}
          hasMedia={mediaCount > 0}
          rows={8}
          ai={
            <ImproveButton
              getText={() => value}
              setText={setValue}
              context={{ surface: "bot_text", ...context }}
              onTranslations={async (texts) => {
                const r = await saveTranslations({ channelId, trigger: moment, texts });
                if (!r.ok) throw new Error(r.error);
                router.refresh();
              }}
              label="Améliorer avec l'IA"
              variant="ghost"
              size="sm"
              className="text-brand-ink"
            />
          }
        />
        <p id={`${id}-help`} className="text-note text-muted-foreground">
          Les repères en couleur, comme {"{prenom}"}, sont remplacés par le bot pour chaque
          personne.
        </p>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-body font-medium text-foreground">Aperçu</p>
        {/* Un seul compteur : celui de l'éditeur, qui porte la limite de Telegram (4 096, 1 024 avec un média). */}
        <TelegramPreview
          html={fillExamples(value, examples)}
          buttons={buttons}
          mediaCount={mediaCount}
          counter={false}
        />
      </div>
    </div>
  );
}
