"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FileUp, Plus, Trash2, X } from "lucide-react";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FAQ_LIMITS,
  faqEntryProblem,
  moveFaqEntry,
  previewFaqImport,
  type FaqImportMode,
  type PersonaFaqEntry,
} from "@/lib/personas/faq";

export const FAQ_HELP =
  "La seule source de ce que l'assistante peut affirmer (bonus, dépôt minimum, pays, délais de retrait, VIP). Tout le reste, elle le transmet à l'équipe.";

/**
 * Section « Fiche d'informations » du formulaire de persona (phase 25) : questions / réponses dans l'ordre, 40 au
 * plus. Administrateur : ajout, modification, suppression, « Monter » / « Descendre », import d'un fichier tableur
 * (.csv, « question;réponse ») avec aperçu avant d'ajouter ou de remplacer. Responsable : lecture seule (le serveur
 * refuse de toute façon une fiche modifiée par un responsable).
 */
export function PersonaFaqField({
  value,
  onChange,
  canEdit,
  error,
}: {
  value: PersonaFaqEntry[];
  onChange: (v: PersonaFaqEntry[]) => void;
  canEdit: boolean;
  error?: string;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const full = value.length >= FAQ_LIMITS.max;

  const update = (i: number, patch: Partial<PersonaFaqEntry>) =>
    onChange(value.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <FormSection
      id="persona-faq"
      title="Fiche d'informations"
      description={FAQ_HELP}
      actions={
        canEdit ? (
          <span className="text-note text-muted-foreground tabular-nums">
            {value.length} / {FAQ_LIMITS.max} questions
          </span>
        ) : null
      }
    >
      {error ? (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      ) : null}

      {!canEdit ? (
        <>
          <p className="rounded-lg bg-info-soft px-3 py-2 text-note text-info">
            Seul un administrateur peut modifier la fiche d&apos;informations.
          </p>
          {value.length === 0 ? (
            <p className="text-note text-muted-foreground">Aucune question pour l&apos;instant.</p>
          ) : (
            <ol className="space-y-3">
              {value.map((e, i) => (
                <li key={i} className="rounded-lg border border-border px-3 py-2">
                  <p className="text-body font-medium text-foreground">{e.q}</p>
                  <p className="mt-0.5 whitespace-pre-line text-body text-muted-foreground">
                    {e.a}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <>
          {value.length === 0 ? (
            <p className="text-note text-muted-foreground">
              Aucune question pour l&apos;instant : ajoutez-en une, ou importez un fichier.
            </p>
          ) : (
            <ol className="space-y-4">
              {value.map((e, i) => {
                const blank = !e.q.trim() && !e.a.trim();
                const problem = blank ? null : faqEntryProblem(e);
                const qId = `persona-faq-q-${i}`;
                const aId = `persona-faq-a-${i}`;
                return (
                  <li key={i} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-note font-medium text-muted-foreground">
                        Question n° {i + 1}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Monter la question n° ${i + 1}`}
                          title="Monter"
                          disabled={i === 0}
                          onClick={() => onChange(moveFaqEntry(value, i, -1))}
                        >
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Descendre la question n° ${i + 1}`}
                          title="Descendre"
                          disabled={i === value.length - 1}
                          onClick={() => onChange(moveFaqEntry(value, i, 1))}
                        >
                          <ArrowDown aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Supprimer la question n° ${i + 1}`}
                          title="Supprimer"
                          onClick={() => onChange(value.filter((_, j) => j !== i))}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={qId}>Question</Label>
                      <Input
                        id={qId}
                        value={e.q}
                        maxLength={FAQ_LIMITS.question}
                        placeholder="Quel est le dépôt minimum ?"
                        onChange={(ev) => update(i, { q: ev.target.value })}
                        aria-invalid={problem ? true : undefined}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={aId}>Réponse</Label>
                      <Textarea
                        id={aId}
                        value={e.a}
                        rows={2}
                        maxLength={FAQ_LIMITS.answer}
                        placeholder="10 € par carte bancaire."
                        onChange={(ev) => update(i, { a: ev.target.value })}
                        aria-invalid={problem ? true : undefined}
                        aria-describedby={problem ? `${aId}-help` : undefined}
                      />
                      {problem ? (
                        <p id={`${aId}-help`} className="text-note text-danger">
                          {problem}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-md:h-10"
              disabled={full}
              onClick={() => onChange([...value, { q: "", a: "" }])}
            >
              <Plus aria-hidden />
              Ajouter une question
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-md:h-10"
              aria-expanded={importOpen}
              aria-controls="persona-faq-import"
              onClick={() => setImportOpen((o) => !o)}
            >
              <FileUp aria-hidden />
              Importer un fichier tableur (.csv)
            </Button>
            {full ? (
              <span className="text-note text-muted-foreground">
                {FAQ_LIMITS.max} questions au plus : supprimez-en une pour en ajouter.
              </span>
            ) : null}
          </div>
          {importOpen ? (
            <FaqImportPanel
              existing={value}
              onApply={(next) => {
                onChange(next);
                setImportOpen(false);
              }}
              onClose={() => setImportOpen(false)}
            />
          ) : null}
          <p className="text-note text-muted-foreground">
            Question : {FAQ_LIMITS.question} caractères au plus. Réponse : {FAQ_LIMITS.answer}{" "}
            caractères au plus. La fiche est enregistrée avec la persona (bouton du bas de la page).
          </p>
        </>
      )}
    </FormSection>
  );
}

/** Lit un fichier en UTF-8, ou en Windows-1252 (export d'Excel en français) si l'UTF-8 ne passe pas. */
async function readTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("windows-1252").decode(buf);
  } catch {
    return utf8;
  }
}

function FaqImportPanel({
  existing,
  onApply,
  onClose,
}: {
  existing: PersonaFaqEntry[];
  onApply: (next: PersonaFaqEntry[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<FaqImportMode>("add");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const preview = useMemo(
    () => (text.trim() ? previewFaqImport(text, existing, mode) : null),
    [text, existing, mode],
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) {
      setFileNote("Fichier trop gros (1 Mo au plus).");
      return;
    }
    setText(await readTextFile(file));
    setFileNote(`Fichier « ${file.name} » chargé.`);
  }

  return (
    <div
      id="persona-faq-import"
      className="space-y-3 rounded-lg border border-border bg-muted/40 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-note text-muted-foreground">
          Une ligne par question : la question, un point-virgule, puis la réponse (par exemple{" "}
          <span className="font-medium text-foreground">
            Quel est le dépôt minimum ?;10 € par carte bancaire.
          </span>
          ). Une première ligne « question;réponse » est ignorée. Une réponse qui contient un
          point-virgule se met entre guillemets.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Fermer l'import"
          title="Fermer"
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="persona-faq-file">Choisir un fichier (.csv)</Label>
        <Input
          id="persona-faq-file"
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {fileNote ? <p className="text-note text-muted-foreground">{fileNote}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="persona-faq-paste">Ou coller les lignes</Label>
        <Textarea
          id="persona-faq-paste"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"question;réponse\nQuel est le dépôt minimum ?;10 € par carte bancaire."}
        />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-body font-medium text-foreground">Que faire des lignes ?</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {(
            [
              ["add", "Les ajouter aux questions actuelles"],
              ["replace", "Remplacer toute la fiche"],
            ] as const
          ).map(([m, label]) => (
            <label
              key={m}
              className="flex min-h-10 cursor-pointer items-center gap-2 text-body md:min-h-9"
            >
              <input
                type="radio"
                name="persona-faq-import-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="size-4 accent-brand"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {preview ? (
        <div className="space-y-3" aria-live="polite">
          <p className="text-body text-foreground">
            {preview.accepted.length === 0
              ? "Aucune ligne retenue."
              : `${preview.accepted.length} ligne${preview.accepted.length > 1 ? "s" : ""} retenue${preview.accepted.length > 1 ? "s" : ""}`}
            {preview.refused.length > 0
              ? ` · ${preview.refused.length} refusée${preview.refused.length > 1 ? "s" : ""}`
              : ""}
            {preview.header ? " · première ligne d'en-tête ignorée" : ""}
            {` · la fiche aura ${preview.result.length} question${preview.result.length > 1 ? "s" : ""}.`}
          </p>
          {preview.overflow > 0 ? (
            <p className="text-note text-warning">
              {preview.overflow} ligne{preview.overflow > 1 ? "s" : ""} en trop : {FAQ_LIMITS.max}{" "}
              questions au plus dans la fiche.
            </p>
          ) : null}
          {preview.accepted.length > 0 ? (
            <ol className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border bg-surface p-2">
              {preview.accepted.map((r) => (
                <li key={r.line} className="text-note">
                  <span className="text-muted-foreground">Ligne {r.line} · </span>
                  <span className="font-medium text-foreground">{r.q}</span>
                  <span className="text-muted-foreground"> — {r.a}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {preview.refused.length > 0 ? (
            <div className="space-y-1">
              <p className="text-note font-medium text-danger">Lignes refusées</p>
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-danger/25 bg-surface p-2">
                {preview.refused.map((r) => (
                  <li key={r.line} className="text-note">
                    <span className="text-muted-foreground">Ligne {r.line}</span>
                    {r.text ? <span className="text-foreground"> « {r.text} »</span> : null}
                    <span className="text-danger"> : {r.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="max-md:h-10"
              disabled={
                mode === "add" ? preview.accepted.length === 0 : preview.result.length === 0
              }
              onClick={() => onApply(preview.result)}
            >
              {mode === "add" ? "Ajouter à la fiche" : "Remplacer la fiche"}
            </Button>
            <span className="text-note text-muted-foreground">
              Puis enregistrez la persona (bouton du bas de la page).
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
