"use client";

import { useRef } from "react";
import { ImproveButton, type ImproveContext } from "@/components/ai/improve-button";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/cn";
import { fillMessageExamples } from "@/lib/automations/node-form";

const WORDS: ReadonlyArray<{ key: "prenom" | "canal" | "bot"; label: string }> = [
  { key: "prenom", label: "Prénom" },
  { key: "canal", label: "Nom du canal" },
  { key: "bot", label: "Nom du bot" },
];

/**
 * Texte d'un message de relance : zone de texte, mots à insérer en un clic ({prenom}, {canal}, {bot}), « Améliorer
 * avec l'IA » et l'aperçu Telegram mis à jour pendant la frappe (mots remplacés par des exemples). Contrôlé
 * (`value` / `onChange`) ; `name` : le texte est aussi soumis avec un formulaire. `layout="side"` : aperçu à droite
 * sur grand écran ; `"stack"` : aperçu dessous (panneau étroit).
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
  const ta = useRef<HTMLTextAreaElement>(null);
  function insert(word: string) {
    const el = ta.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + word + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + word.length, start + word.length);
    });
  }
  return (
    <div className={cn("grid gap-4", layout === "side" && "lg:grid-cols-2")}>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Label htmlFor={id}>{label}</Label>
          <ImproveButton
            getText={() => value}
            setText={onChange}
            context={{ surface: "automation", ...context }}
            size="xs"
          />
        </div>
        <Textarea
          ref={ta}
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-help`}
        />
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Insérer un mot"
        >
          <span className="mr-1 text-note text-muted-foreground">Insérer :</span>
          {WORDS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => insert(`{${w.key}}`)}
              title={`Insère {${w.key}}, remplacé par le bot pour chaque personne`}
              className="inline-flex h-8 items-center rounded-full border border-border bg-surface px-3 text-note font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:h-10"
            >
              {w.label}
            </button>
          ))}
        </div>
        <p id={`${id}-help`} className="text-note text-muted-foreground">
          {help ??
            "Les mots entre accolades, comme {prenom}, sont remplacés pour chaque personne. Mise en forme Telegram permise (gras, italique, liens)."}
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
