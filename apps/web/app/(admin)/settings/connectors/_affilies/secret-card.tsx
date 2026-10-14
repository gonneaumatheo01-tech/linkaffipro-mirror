"use client";

import { useActionState, useEffect, useId } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { CopyField } from "@/components/admin/copy-field";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { GenerateState } from "../affiliates-actions";

type GenerateAction = (prev: GenerateState, formData: FormData) => Promise<GenerateState>;

/** Textes d'une carte (écrits en entier par la page : « la clé » / « le secret », accords compris). */
export type SecretCardTexts = {
  title: string;
  description: string;
  /** « Générer la clé » */
  generate: string;
  /** « Régénérer la clé » */
  regenerate: string;
  /** Pastille quand une valeur est en place : « Générée » / « Généré ». */
  ready: string;
  /** « Clé actuelle » */
  currentLabel: string;
  /** « Copiez-la maintenant : elle ne sera plus jamais affichée. » */
  copyNow: string;
  /** Ce qui cesse de marcher si on régénère. */
  confirmDescription: string;
};

/**
 * Carte « Clé de connexion » ou « Secret de signature » (Réglages → Connexions → Campagnes Telegram des affiliés).
 * « Générer » (ou « Régénérer », avec confirmation : l'ancienne valeur cesse de marcher) ; la nouvelle valeur est
 * montrée UNE fois, avec « Copier » et le nom du secret à remplir dans Link Affi. Recharger la page l'efface : seul son
 * début reste affiché. Le focus va sur la valeur dès qu'elle apparaît (clavier, lecteur d'écran).
 */
export function SecretCard({
  texts,
  envName,
  current,
  action,
}: {
  texts: SecretCardTexts;
  /** Nom du secret à remplir dans Link Affi. */
  envName: string;
  /** Valeur en place : son début et sa date (jamais la valeur entière), ou null. */
  current: { hint: string | null; createdAt: string; createdBy: string | null } | null;
  action: GenerateAction;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const valueId = useId();
  const headingId = useId();
  const generated = state?.value ?? null;

  useEffect(() => {
    if (generated) document.getElementById(valueId)?.focus();
  }, [generated, valueId]);

  const label = current ? texts.regenerate : texts.generate;
  const button = (
    <Button type="submit" variant="outline" className="max-md:h-10" disabled={pending}>
      {current ? <RefreshCw aria-hidden /> : <KeyRound aria-hidden />}
      {pending ? "Génération…" : label}
    </Button>
  );

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <h3 id={headingId} className="text-body font-semibold text-foreground">
            {texts.title}
          </h3>
          <p className="text-note text-muted-foreground">{texts.description}</p>
        </div>
        <StatusPill tone={current ? "success" : "warning"}>
          {current ? texts.ready : "À générer"}
        </StatusPill>
      </div>

      {current ? (
        <p className="text-note break-words text-muted-foreground">
          {texts.currentLabel}
          {current.hint ? (
            <>
              {" : "}
              <span className="font-mono text-foreground">{current.hint}</span>
            </>
          ) : null}{" "}
          · le {current.createdAt}
          {current.createdBy ? ` par ${current.createdBy}` : ""}
        </p>
      ) : null}

      {generated ? (
        <div className="space-y-2 rounded-lg border border-warning/25 bg-warning-soft p-3">
          <p className="text-body font-semibold text-warning" role="status">
            {texts.copyNow}
          </p>
          <Label htmlFor={valueId} className="block text-body text-foreground">
            À coller dans Link Affi, dans le secret{" "}
            <code className="font-mono break-words">{envName}</code>
          </Label>
          <CopyField id={valueId} value={generated} />
          {state?.regenerated ? (
            <p className="text-note text-foreground">
              L&apos;ancienne valeur ne marche plus : collez celle-ci dans Link Affi dès maintenant.
            </p>
          ) : null}
        </div>
      ) : null}

      {state?.error ? (
        <p role="alert" className="text-note text-danger">
          {state.error}
        </p>
      ) : null}

      <form action={formAction}>
        {current ? (
          <ConfirmDialog
            title={`${texts.regenerate} ?`}
            description={texts.confirmDescription}
            confirmLabel="Régénérer"
            destructive
            trigger={button}
          />
        ) : (
          button
        )}
      </form>
    </section>
  );
}
