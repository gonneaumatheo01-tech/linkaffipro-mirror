"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCategoryInlineAction } from "@/app/(admin)/messages/categories/inline-actions";

export type CategoryOption = { id: string; name: string; color: string };

/**
 * Champ « Catégorie » d'un message avec « + Nouvelle catégorie » sans quitter la page (phase 8).
 * Le champ caché `categoryId` est lu par le formulaire parent.
 */
export function CategoryPicker({ categories, defaultValue, name = "categoryId", id = "categoryId" }: { categories: CategoryOption[]; defaultValue?: string | null; name?: string; id?: string }) {
  const [list, setList] = useState<CategoryOption[]>(categories);
  const [value, setValue] = useState<string>(defaultValue ?? "");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const create = () => {
    setError(null);
    start(async () => {
      const r = await createCategoryInlineAction({ name: newName });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setList((prev) => (prev.some((c) => c.id === r.id) ? prev : [...prev, { id: r.id, name: r.name, color: r.color }]));
      setValue(r.id);
      setCreating(false);
      setNewName("");
    });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Catégorie</Label>
      <div className="flex flex-wrap items-center gap-2">
        <select id={id} name={name} value={value} onChange={(e) => (e.target.value === "__new__" ? setCreating(true) : setValue(e.target.value))} className="h-9 min-w-48 rounded-md border bg-background px-2 text-sm max-md:h-10">
          <option value="">— sans catégorie —</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new__">+ Nouvelle catégorie…</option>
        </select>
        {value ? <span className="inline-block size-3 rounded-full" style={{ backgroundColor: list.find((c) => c.id === value)?.color ?? "#94a3b8" }} aria-hidden /> : null}
        {!creating ? (
          <Button type="button" size="sm" variant="outline" className="max-md:h-10" onClick={() => setCreating(true)}>
            + Nouvelle catégorie
          </Button>
        ) : null}
      </div>
      {creating ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom de la catégorie (ex. Bonus du week-end)" aria-label="Nom de la nouvelle catégorie" maxLength={40} className="max-w-xs" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }} />
          <Button type="button" size="sm" disabled={pending || !newName.trim()} onClick={create} className="max-md:h-10">
            {pending ? "Création…" : "Créer"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setCreating(false); setError(null); }} className="max-md:h-10">
            Annuler
          </Button>
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
          <p className="w-full text-xs text-muted-foreground">La couleur est choisie automatiquement ; changez-la dans Réglages → Catégories.</p>
        </div>
      ) : null}
      {list.length === 0 && !creating ? <p className="text-xs text-muted-foreground">Aucune catégorie pour l&apos;instant : créez la première (bonus, rappel, teasing…) pour comparer vos messages entre eux.</p> : null}
    </div>
  );
}
