"use client";

import { useState } from "react";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * « Corriger » depuis le site : le texte proposé s'ouvre dans l'éditeur partagé (mise en forme sans balises visibles) ;
 * le texte corrigé repasse par le Contrôle qualité avant de partir.
 */
export function EditValidationForm({
  validationId,
  initialText,
  action,
}: {
  validationId: string;
  initialText: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [text, setText] = useState(initialText);
  const id = `edit-${validationId}`;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="validationId" value={validationId} />
      <input type="hidden" name="decision" value="edit" />
      <div className="space-y-1.5">
        <Label htmlFor={id}>Texte corrigé</Label>
        <RichTextEditor
          id={id}
          label="Texte corrigé"
          name="editedText"
          value={text}
          onChange={setText}
          rows={5}
          warnUnresolved={false}
          required
        />
      </div>
      <Button type="submit" variant="outline" className="max-md:h-10">
        Enregistrer la correction
      </Button>
    </form>
  );
}
