"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { OFFER_VISUAL_MIME_TYPES } from "@/lib/personas/form";

export type VisualOption = { id: string; filename: string; mimeType: string };

async function uploadImage(file: File): Promise<VisualOption> {
  if (!(OFFER_VISUAL_MIME_TYPES as readonly string[]).includes(file.type))
    throw new Error("Choisissez une image JPEG, PNG ou WebP.");
  const fd = new FormData();
  fd.append("files", file);
  const res = await fetch("/api/media", { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as {
    files?: Array<VisualOption & { error?: string }>;
    error?: string;
  };
  const f = data.files?.[0];
  if (!res.ok || !f) throw new Error(data.error ?? "Envoi de l'image impossible.");
  if (f.error || !f.id) throw new Error(`${f.filename} : ${f.error ?? "image refusée."}`);
  return { id: f.id, filename: f.filename, mimeType: f.mimeType };
}

/**
 * Visuel de l'app ou de l'offre envoyé en photo avec le lien : une image déjà envoyée sur le site, ou une nouvelle
 * (même envoi que les médias des messages, `/api/media`). Jamais une photo présentée comme celle de l'assistante :
 * la phrase est sous le champ.
 *
 * Accessibilité : l'étiquette du formulaire (`<Label htmlFor={id}>`) pointe toujours vers un élément, quel que soit
 * l'état (liste des images déjà envoyées, sinon envoi d'une image, sinon « Retirer le visuel ») ; l'envoi d'une image
 * (champ fichier masqué) montre l'anneau de focus sur son libellé ; une image refusée est annoncée (`role="alert"`).
 */
export function OfferVisualField({
  id,
  images,
  value,
  onChange,
  onUploaded,
  invalid,
  describedBy,
}: {
  id: string;
  images: VisualOption[];
  value: string;
  onChange: (id: string) => void;
  onUploaded: (item: VisualOption) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = images.find((m) => m.id === value) ?? null;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const item = await uploadImage(file);
      onUploaded(item);
      onChange(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi de l'image impossible.");
    } finally {
      setUploading(false);
    }
  }

  if (current)
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border p-2 text-body">
        {/* Aperçu servi par notre propre route (session requise) : pas d'optimisation next/image nécessaire. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/media/${current.id}`}
          alt="Visuel de l'offre choisi"
          className="size-14 rounded object-cover"
        />
        <span className="min-w-0 flex-1 truncate">{current.filename}</span>
        <Button
          id={id}
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-describedby={describedBy}
          aria-label={`Retirer le visuel ${current.filename}`}
          title="Retirer le visuel"
          onClick={() => onChange("")}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {images.length > 0 ? (
          <NativeSelect
            id={id}
            aria-label="Visuel de l'app : choisir une image déjà envoyée"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            value=""
            onChange={(e) => onChange(e.target.value)}
            wrapperClassName="w-full sm:max-w-xs"
          >
            <option value="">Choisir une image déjà envoyée…</option>
            {images.map((m) => (
              <option key={m.id} value={m.id}>
                {m.filename}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-sm text-body font-medium text-brand-ink underline underline-offset-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring max-md:min-h-10">
          {images.length > 0 ? "ou envoyer une image" : "Envoyer une image"}
          <input
            // Sans liste d'images, c'est le seul champ : l'étiquette « Visuel de l'app » pointe vers lui.
            id={images.length > 0 ? undefined : id}
            type="file"
            className="sr-only"
            aria-label="Visuel de l'app : envoyer une image"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            accept={OFFER_VISUAL_MIME_TYPES.join(",")}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {uploading ? (
        <p role="status" className="text-note text-muted-foreground">
          Envoi de l&apos;image…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
