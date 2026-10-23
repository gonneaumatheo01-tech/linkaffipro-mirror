"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Term } from "@/components/admin/help-tip";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { savePersonaMediaAction } from "@/app/(admin)/conversations/personas/[id]/media-actions";
import { AGENT_MEDIA_RULES, agentUploadProblem } from "@/lib/agents/dating";
import { PERSONA_MEDIA_LIMITS } from "@/lib/personas/media";

export type ReferenceImage = { id: string; filename: string; mimeType: string };

async function uploadReference(personaId: string, file: File): Promise<ReferenceImage> {
  const problem = agentUploadProblem("reference", file.type, file.size);
  if (problem) throw new Error(problem);
  const fd = new FormData();
  fd.append("purpose", "reference");
  fd.append("personaId", personaId);
  fd.append("files", file);
  const res = await fetch("/api/agents/media", { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as {
    files?: Array<ReferenceImage & { error?: string }>;
    error?: string;
  };
  const f = data.files?.[0];
  if (!res.ok || !f) throw new Error(data.error ?? "Envoi de l'image impossible.");
  if (f.error || !f.id) throw new Error(f.error ?? "Image refusée.");
  return { id: f.id, filename: f.filename, mimeType: f.mimeType };
}

/**
 * Section « Médias du personnage » de la fiche persona (phase 20) : 1 à 3 images de référence dans l'ordre (la
 * première sert aux vidéos), le fichier du personnage (adresse https du fichier LoRA, expliqué au survol), son mot
 * déclencheur et son poids, les consignes de tenue et d'ambiance. Formulaire séparé du reste de la fiche (qui ne
 * change pas) : « Enregistrer les médias ». Les images sont envoyées tout de suite, et rangées à l'enregistrement.
 */
export function PersonaMediaForm({
  personaId,
  personaName,
  isGirl,
  initial,
}: {
  personaId: string;
  personaName: string;
  /** Persona « Une fille » : les médias la représentent. Assistante : simple rappel de la règle. */
  isGirl: boolean;
  initial: {
    references: ReferenceImage[];
    loraUrl: string | null;
    loraTrigger: string | null;
    loraScale: number;
    mediaNotes: string | null;
  };
}) {
  const [refs, setRefs] = useState<ReferenceImage[]>(initial.references);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = PERSONA_MEDIA_LIMITS.references;
  const name = personaName.trim() || "la persona";

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const img = await uploadReference(personaId, file);
      setRefs((list) => (list.some((r) => r.id === img.id) ? list : [...list, img].slice(0, max)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi de l'image impossible.");
    } finally {
      setUploading(false);
    }
  }

  function move(i: number, delta: -1 | 1) {
    setRefs((list) => {
      const j = i + delta;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  return (
    <form action={savePersonaMediaAction} id="medias" className="scroll-mt-24 space-y-6 border-t border-border pt-6">
      <input type="hidden" name="personaId" value={personaId} />
      <input type="hidden" name="referenceImageIds" value={refs.map((r) => r.id).join(",")} />
      <FormSection
        title="Médias du personnage"
        description={
          isGirl
            ? `Ce qui sert aux agents de l'équipe Rencontres pour fabriquer les vidéos et les photos de ${name}. Rien ne part sans votre validation pour ses 3 premières vidéos et ses 3 premières photos.`
            : "Pour une assistante du canal, ces médias ne sont jamais présentés comme ses photos. Ils servent surtout aux personas « Une fille » de l'équipe Rencontres."
        }
      >
        <fieldset className="space-y-3">
          <legend className="text-body font-medium text-foreground">
            Images de référence ({refs.length} sur {max})
          </legend>
          <p className="text-note text-muted-foreground">
            1 à 3 photos nettes du personnage, de face et en pied. La première sert à remplacer la personne dans les
            vidéos : mettez la meilleure en premier.
          </p>
          {refs.length ? (
            <ol className="grid gap-3 sm:grid-cols-3">
              {refs.map((r, i) => (
                <li key={r.id} className="space-y-2 rounded-lg border border-border p-2">
                  {/* Notre propre route protégée : pas d'optimisation next/image nécessaire. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/agents/media/${r.id}`}
                    alt={`Image de référence ${i + 1} de ${name}`}
                    className="aspect-square w-full rounded object-cover"
                  />
                  <p className="text-note text-muted-foreground">
                    {i === 0 ? "1re : sert aux vidéos" : `${i + 1}e`}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={i === 0}
                      aria-label={`Monter l'image ${i + 1}`}
                      title="Monter"
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={i === refs.length - 1}
                      aria-label={`Descendre l'image ${i + 1}`}
                      title="Descendre"
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Retirer l'image ${i + 1}`}
                      title="Retirer"
                      onClick={() => setRefs((list) => list.filter((x) => x.id !== r.id))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          {refs.length < max ? (
            <label className="inline-flex min-h-9 cursor-pointer items-center rounded-sm text-body font-medium text-brand-ink underline underline-offset-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring max-md:min-h-10">
              {uploading ? "Envoi de l'image…" : "Ajouter une image"}
              <input
                type="file"
                className="sr-only"
                disabled={uploading}
                accept={AGENT_MEDIA_RULES.reference.mimes.join(",")}
                aria-label="Ajouter une image de référence"
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-body text-danger">
              {error}
            </p>
          ) : null}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="persona-lora-url">
              Adresse du <Term term="LoRA : petit fichier qui apprend au générateur de photos le visage et le corps du personnage (souvent en .safetensors)">
                fichier du personnage
              </Term>
            </Label>
            <Input
              id="persona-lora-url"
              name="loraUrl"
              type="url"
              inputMode="url"
              maxLength={PERSONA_MEDIA_LIMITS.loraUrl}
              defaultValue={initial.loraUrl ?? ""}
              placeholder="https://…"
              aria-describedby="persona-lora-url-aide"
            />
            <p id="persona-lora-url-aide" className="text-note text-muted-foreground">
              Facultatif : sans lui, les photos produites restent celles de la persona. Collez l&apos;adresse complète
              qui commence par https://
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="persona-lora-trigger">Mot déclencheur</Label>
            <Input
              id="persona-lora-trigger"
              name="loraTrigger"
              maxLength={PERSONA_MEDIA_LIMITS.loraTrigger}
              defaultValue={initial.loraTrigger ?? ""}
              aria-describedby="persona-lora-trigger-aide"
            />
            <p id="persona-lora-trigger-aide" className="text-note text-muted-foreground">
              Le mot donné avec le fichier, qui appelle le personnage.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="persona-lora-scale">Force du personnage (0,1 à 1,5)</Label>
            <Input
              id="persona-lora-scale"
              name="loraScale"
              inputMode="decimal"
              defaultValue={String(initial.loraScale).replace(".", ",")}
              aria-describedby="persona-lora-scale-aide"
            />
            <p id="persona-lora-scale-aide" className="text-note text-muted-foreground">
              0,8 conseillé. Plus haut : plus ressemblant, mais moins naturel.
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="persona-media-notes">Tenue et ambiance</Label>
            <Textarea
              id="persona-media-notes"
              name="mediaNotes"
              maxLength={PERSONA_MEDIA_LIMITS.mediaNotes}
              defaultValue={initial.mediaNotes ?? ""}
              placeholder="Exemple : tenues décontractées, lumière naturelle, jamais de lingerie, pas de lieu reconnaissable."
              aria-describedby="persona-media-notes-aide"
            />
            <p id="persona-media-notes-aide" className="text-note text-muted-foreground">
              Lu pour chaque photo et chaque vidéo : ce qu&apos;elle porte, les lieux, ce qu&apos;il faut éviter.
            </p>
          </div>
        </div>
      </FormSection>
      <Button type="submit" variant="outline" className="max-md:h-10" disabled={uploading}>
        Enregistrer les médias
      </Button>
    </form>
  );
}
