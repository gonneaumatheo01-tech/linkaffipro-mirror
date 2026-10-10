"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCategoryInlineAction } from "@/app/(admin)/messages/categories/inline-actions";

export type CategoryOption = { id: string; name: string; color: string };

/** Couleurs proposées à la création (la première libre est choisie d'office ; modifiable). */
const PALETTE = [
  "#16a34a",
  "#ca8a04",
  "#9333ea",
  "#2563eb",
  "#64748b",
  "#dc2626",
  "#0891b2",
  "#db2777",
];

/**
 * Champ « Catégorie » d'un message avec « + Nouvelle catégorie » (nom + couleur) sans quitter la page (phase 8).
 * Contrôlé (`value` + `onChange`, utilisé par le formulaire de message pour le meilleur créneau et l'assistant IA)
 * ou libre (`defaultValue`). Le menu (champ `categoryId`) est lu par le formulaire parent.
 */
export function CategoryPicker({
  categories,
  value: controlled,
  onChange,
  defaultValue,
  name = "categoryId",
  id = "categoryId",
}: {
  categories: CategoryOption[];
  value?: string;
  onChange?: (id: string, category: CategoryOption | null) => void;
  defaultValue?: string | null;
  name?: string;
  id?: string;
}) {
  const uid = useId();
  const [list, setList] = useState<CategoryOption[]>(categories);
  const [internal, setInternal] = useState<string>(defaultValue ?? "");
  const value = controlled ?? internal;
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[categories.length % PALETTE.length]!);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const select = (next: string, options: CategoryOption[] = list) => {
    if (controlled === undefined) setInternal(next);
    onChange?.(next, options.find((c) => c.id === next) ?? null);
  };

  const openCreate = () => {
    setNewColor(PALETTE[list.length % PALETTE.length]!);
    setError(null);
    setCreating(true);
  };

  const create = () => {
    setError(null);
    start(async () => {
      const r = await createCategoryInlineAction({ name: newName, color: newColor });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const created = { id: r.id, name: r.name, color: r.color };
      const next = list.some((c) => c.id === r.id) ? list : [...list, created];
      setList(next);
      select(r.id, next);
      setCreating(false);
      setNewName("");
    });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Catégorie</Label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={id}
          name={name}
          value={value}
          onChange={(e) => (e.target.value === "__new__" ? openCreate() : select(e.target.value))}
          className="h-10 min-w-48 rounded-md border bg-background px-2 text-sm md:h-9"
        >
          <option value="">— sans catégorie —</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new__">+ Nouvelle catégorie…</option>
        </select>
        {value ? (
          <span
            className="inline-block size-3 rounded-full"
            style={{ backgroundColor: list.find((c) => c.id === value)?.color ?? "#94a3b8" }}
            aria-hidden
          />
        ) : null}
        {!creating ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="max-md:h-10"
            onClick={openCreate}
          >
            + Nouvelle catégorie
          </Button>
        ) : null}
      </div>
      {creating ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <Input
            id={`${uid}-name`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nom de la catégorie"
            aria-label="Nom de la nouvelle catégorie"
            maxLength={40}
            className="max-w-xs max-md:h-10"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (newName.trim()) create();
              }
            }}
          />
          <input
            id={`${uid}-color`}
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            aria-label="Couleur de la nouvelle catégorie"
            className="h-10 w-12 cursor-pointer rounded border bg-background md:h-9"
          />
          <Button
            type="button"
            size="sm"
            disabled={pending || !newName.trim()}
            onClick={create}
            className="max-md:h-10"
          >
            {pending ? "Création…" : "Créer la catégorie"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setCreating(false);
              setError(null);
            }}
            className="max-md:h-10"
          >
            Annuler
          </Button>
          {error ? (
            <p className="w-full text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <p className="w-full text-xs text-muted-foreground">
            Renommer, changer la couleur ou l&apos;ordre, fusionner : Réglages → Catégories de
            messages (administrateur).
          </p>
        </div>
      ) : null}
      {list.length === 0 && !creating ? (
        <p className="text-xs text-muted-foreground">
          Aucune catégorie pour l&apos;instant : créez la première (vos propres types de messages)
          pour comparer vos messages entre eux.
        </p>
      ) : null}
    </div>
  );
}
