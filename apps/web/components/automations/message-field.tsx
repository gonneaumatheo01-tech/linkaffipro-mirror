"use client";

import { ImproveButton, type ImproveContext } from "@/components/ai/improve-button";
import { RichTextEditor, type PlaceholderChip } from "@/components/editor/rich-text-editor";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Label } from "@/components/ui/label";
import { cn } from "@/components/ui/cn";
import { fillMessageExamples } from "@/lib/automations/node-form";

/** Repères remplacés dans un message de relance (mêmes mots que l'exécution : prénom, canal, bot). */
const WORDS: readonly PlaceholderChip[] = [
  { key: "prenom", label: "Prénom" },
  { key: "canal", label: "Nom du canal" },
  { key: "bot", label: "Nom du bot" },
];

/**
 * Texte d'un message de relance : l'éditeur partagé (texte mis en forme sans balise visible, barre d'outils avec
 * « Améliorer avec l'IA », repères à insérer en un clic : {prenom}, {canal}, {bot}) et l'aperçu Telegram mis à jour
 * pendant la frappe (repères remplacés par des exemples). Contrôlé (`value` / `onChange`, HTML Telegram) ; `name` :
 * le texte est aussi soumis avec un formulaire. `layout="side"` : aperçu à droite sur grand écran ; `"stack"` :
 * aperçu dessous (panneau étroit).
 */
export function MessageField({
  id,
  label,
  value,
  onChange,
  name,
  buttons = [],
  mediaCount = 0,
  context,
  required,
  invalid,
  layout = "side",
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  name?: string;
  buttons?: Array<Array<{ text: string }>>;
  mediaCount?: number;
  context: Omit<ImproveContext, "surface">;
  required?: boolean;
  invalid?: boolean;
  layout?: "side" | "stack";
  help?: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-4", layout === "side" && "lg:grid-cols-2")}>
      <div className="min-w-0 space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <RichTextEditor
          id={id}
          name={name}
          label={label}
          value={value}
          onChange={onChange}
          required={required}
          invalid={invalid}
          describedBy={`${id}-help`}
          placeholders={WORDS}
          hasMedia={mediaCount > 0}
          rows={5}
          ai={
            <ImproveButton
              getText={() => value}
              setText={onChange}
              context={{ surface: "automation", ...context }}
              label="Améliorer avec l'IA"
              variant="ghost"
              size="sm"
              className="text-brand-ink"
            />
          }
        />
        <p id={`${id}-help`} className="text-note text-muted-foreground">
          {help ?? "Les repères en couleur, comme {prenom}, sont remplacés pour chaque personne."}
        </p>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-body font-medium text-foreground">Aperçu</p>
        <TelegramPreview
          html={fillMessageExamples(value)}
          buttons={buttons}
          mediaCount={mediaCount}
        />
      </div>
    </div>
  );
}
