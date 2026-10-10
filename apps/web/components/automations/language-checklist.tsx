"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { languageName } from "@/lib/members/filters";
import { languageChoiceCodes, parseLanguageCodes, toggleInList } from "@/lib/automations/node-form";

/**
 * Langues à cocher, en clair (« Français », « Anglais »), comme dans les filtres Membres et « Écrire à un groupe » :
 * celles de nos membres d'abord, puis « Autre langue » (code à deux lettres) pour une langue absente de la liste.
 */
export function LanguageChecklist({
  legend,
  help,
  available,
  value,
  onChange,
}: {
  legend: string;
  help?: string;
  /** Langues des membres (code et nombre de membres), les plus parlées d'abord. */
  available: ReadonlyArray<{ code: string; count: number }>;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const uid = useId();
  const [other, setOther] = useState("");
  const [refused, setRefused] = useState<string[]>([]);
  const codes = languageChoiceCodes(available, value);
  const counts = new Map(available.map((l) => [l.code.toLowerCase(), l.count]));
  const add = () => {
    const { codes: ok, invalid } = parseLanguageCodes(other);
    let next = value;
    for (const c of ok) next = toggleInList(next, c, true);
    onChange(next);
    setRefused(invalid);
    setOther(invalid.join(", "));
  };
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-body font-medium text-foreground">{legend}</legend>
      {help ? <p className="text-note text-muted-foreground">{help}</p> : null}
      {codes.length ? (
        <div className="space-y-0.5">
          {codes.map((c) => (
            <label key={c} className="flex min-h-9 items-center gap-2 text-body max-md:min-h-10">
              <Checkbox
                checked={value.includes(c)}
                onCheckedChange={(on) => onChange(toggleInList(value, c, on))}
              />
              <span className="min-w-0 truncate">{languageName(c) || c}</span>
              {counts.get(c) ? (
                <span className="ml-auto text-note text-muted-foreground tabular-nums">
                  {counts.get(c)!.toLocaleString("fr-FR")} membre{counts.get(c)! > 1 ? "s" : ""}
                </span>
              ) : null}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-note text-muted-foreground">
          Aucune langue connue chez vos membres pour l&apos;instant.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Input
          id={`${uid}-other`}
          value={other}
          maxLength={24}
          placeholder="Autre langue : de, it…"
          aria-label="Autre langue (code à deux lettres)"
          aria-invalid={refused.length ? true : undefined}
          aria-describedby={refused.length ? `${uid}-refused` : undefined}
          onChange={(e) => {
            setOther(e.target.value);
            setRefused([]);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (other.trim()) add();
            }
          }}
          className="min-w-0 flex-1 sm:max-w-48"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-md:h-10"
          disabled={!other.trim()}
          onClick={add}
        >
          Ajouter
        </Button>
      </div>
      {refused.length ? (
        <p id={`${uid}-refused`} className="text-note text-danger">
          Code de langue inconnu : {refused.join(", ")}. Utilisez deux lettres, par exemple « de »
          pour l&apos;allemand.
        </p>
      ) : null}
    </fieldset>
  );
}
