"use client";

import { useId } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_BUTTONS, entriesToButtons, type ButtonEntry } from "@/lib/automations/node-form";

/**
 * Boutons sous un message de relance, saisis champ par champ (« Libellé » et « Adresse »), un bouton par ligne, comme
 * dans « Écrire à un groupe » ; « + Ajouter un bouton » (10 au plus). La ligne fautive est signalée sous ses champs.
 * Forme enregistrée inchangée (rangées d'un bouton { text, url }, voir `entriesToButtons`).
 */
export function LinkButtonsField({
  entries,
  onChange,
  legend = "Boutons sous le message",
}: {
  entries: ButtonEntry[];
  onChange: (next: ButtonEntry[]) => void;
  legend?: string;
}) {
  const uid = useId();
  const check = entriesToButtons(entries);
  const bad = check.ok ? null : check;
  const set = (i: number, patch: Partial<ButtonEntry>) =>
    onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-body font-medium text-foreground">{legend}</legend>
      <p id={`${uid}-help`} className="text-note text-muted-foreground">
        Chaque bouton ouvre une adresse (elle commence par https://).
      </p>
      {entries.length ? (
        <ul className="space-y-2">
          {entries.map((e, i) => {
            const wrong = bad?.index === i;
            const labelWrong = wrong && !e.text.trim();
            const urlWrong = wrong && !labelWrong;
            const errId = `${uid}-err-${i}`;
            return (
              <li key={i} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
                  <Input
                    value={e.text}
                    maxLength={64}
                    placeholder="Libellé"
                    aria-label={`Libellé du bouton ${i + 1}`}
                    aria-invalid={labelWrong || undefined}
                    aria-describedby={wrong ? errId : `${uid}-help`}
                    onChange={(ev) => set(i, { text: ev.target.value })}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="self-center max-md:size-10 sm:order-last"
                    aria-label={`Retirer le bouton ${i + 1}`}
                    title="Retirer ce bouton"
                    onClick={() => onChange(entries.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden />
                  </Button>
                  <Input
                    value={e.url}
                    inputMode="url"
                    placeholder="https://…"
                    aria-label={`Adresse du bouton ${i + 1}`}
                    aria-invalid={urlWrong || undefined}
                    aria-describedby={wrong ? errId : `${uid}-help`}
                    className="col-span-2 sm:col-span-1"
                    onChange={(ev) => set(i, { url: ev.target.value })}
                  />
                </div>
                {wrong ? (
                  <p id={errId} className="text-note text-danger">
                    {bad.error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="max-md:h-10"
        disabled={entries.length >= MAX_BUTTONS}
        onClick={() => onChange([...entries, { text: "", url: "" }])}
      >
        <Plus aria-hidden />
        Ajouter un bouton
      </Button>
    </fieldset>
  );
}
