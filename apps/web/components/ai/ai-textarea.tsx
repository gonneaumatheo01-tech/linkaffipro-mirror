"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ImproveButton, type ImproveButtonProps, type ImproveContext } from "./improve-button";

/**
 * Zone de texte « classique » (formulaire serveur, envoi par `name`) accompagnée du bouton « ✨ Améliorer avec l'IA ».
 * Remplace un `<Textarea name="…" defaultValue="…" />` à l'identique : le champ reste soumis par son `name`.
 * Pour les formulaires déjà contrôlés (post-form, broadcast-form), utilisez directement `ImproveButton`.
 * `onTranslations` : l'hôte enregistre les traductions dans ses autres langues (textes du bot).
 */
export function AiTextarea({
  context,
  defaultValue,
  onChange,
  buttonClassName,
  onTranslations,
  ...props
}: Omit<React.ComponentProps<"textarea">, "value"> & {
  context: ImproveContext;
  buttonClassName?: string;
  onTranslations?: ImproveButtonProps["onTranslations"];
}) {
  const [value, setValue] = useState(
    typeof defaultValue === "string"
      ? defaultValue
      : Array.isArray(defaultValue)
        ? defaultValue.join("")
        : String(defaultValue ?? ""),
  );
  return (
    <div className="space-y-2">
      <Textarea
        {...props}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(e);
        }}
      />
      <ImproveButton
        getText={() => value}
        setText={setValue}
        context={context}
        onTranslations={onTranslations}
        size="xs"
        className={buttonClassName}
      />
    </div>
  );
}
