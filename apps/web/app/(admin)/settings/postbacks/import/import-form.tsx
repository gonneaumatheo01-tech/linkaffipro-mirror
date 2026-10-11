"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { FormSection } from "@/components/admin/form-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { importPlayersAction, previewPlayersImportAction, type PreviewState } from "./actions";

const COLUMN_LABELS: Record<string, string> = {
  subId: "identifiant de suivi (sub_id)",
  playerId: "identifiant joueur",
  event: "événement",
  amount: "montant",
  currency: "devise",
  date: "date",
  txid: "transaction",
};

const s = (n: number) => (n > 1 ? "s" : "");

/** Enveloppe : la clé force un nouveau formulaire vierge à chaque « Nouvel import » / « Annuler ». */
export function ImportForm({ programs }: { programs: Array<{ id: string; name: string }> }) {
  const [epoch, setEpoch] = useState(0);
  return <ImportFlow key={epoch} programs={programs} restart={() => setEpoch((e) => e + 1)} />;
}

function ImportFlow({
  programs,
  restart,
}: {
  programs: Array<{ id: string; name: string }>;
  restart: () => void;
}) {
  const [state, preview, pending] = useActionState(previewPlayersImportAction, {
    step: "upload",
    error: null,
  } as PreviewState);
  const [done, confirm, importing] = useActionState(importPlayersAction, {
    step: "upload",
    error: null,
  } as PreviewState);
  const current: PreviewState = done.step === "done" ? done : state;

  if (current.step === "done") {
    const ok = current.errors.length === 0;
    return (
      <FormSection title="Import terminé">
        <Alert variant={ok ? "success" : "warning"} role="status">
          {ok ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
          <AlertTitle>
            {current.imported} ligne{s(current.imported)} importée{s(current.imported)}
          </AlertTitle>
          <AlertDescription>
            {current.total} ligne{s(current.total)} lue{s(current.total)} · {current.ignored} déjà
            connue{s(current.ignored)} · {current.errors.length} erreur{s(current.errors.length)}
          </AlertDescription>
        </Alert>
        {current.errors.length > 0 ? (
          <ul className="max-h-60 list-disc space-y-1 overflow-auto pl-5 text-note text-danger">
            {current.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="max-md:h-10" onClick={restart}>
            Nouvel import
          </Button>
          <Link
            href="/settings/postbacks"
            className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
          >
            Retour aux retours du casino
          </Link>
        </div>
      </FormSection>
    );
  }

  if (current.step === "preview") {
    const recognized = Object.entries(current.columns)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${COLUMN_LABELS[k] ?? k} = « ${current.headers[v as number]} »`)
      .join(", ");
    return (
      <FormSection
        title={`Aperçu : ${current.filename}`}
        description={`${current.total} ligne${s(current.total)} de données · ${current.invalid} ligne${s(current.invalid)} incomplète${s(current.invalid)} ser${current.invalid > 1 ? "ont" : "a"} signalée${s(current.invalid)}.`}
      >
        <p className="text-note text-muted-foreground">Colonnes reconnues : {recognized}.</p>
        {done.error ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{done.error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="max-h-80 overflow-auto rounded-xl border border-border bg-card">
          <Table label="Aperçu du fichier">
            <TableHeader>
              <TableRow>
                {current.headers.map((h, i) => (
                  <TableHead key={i}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.rows.map((r, i) => (
                <TableRow key={i}>
                  {current.headers.map((_h, j) => (
                    <TableCell key={j} className="text-note">
                      {r[j] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <form action={confirm} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="programId" value={current.programId} />
          <input type="hidden" name="filename" value={current.filename} />
          <input type="hidden" name="csvB64" value={current.csvB64} />
          <ConfirmSubmit
            className="max-md:h-10"
            disabled={importing}
            confirmTitle={`Importer ${current.total} ligne${s(current.total)}\u00a0?`}
            confirmLabel="Importer"
            message={`${current.total} ligne${s(current.total)} ${current.total > 1 ? "vont être importées" : "va être importée"} comme des retours du casino (inscriptions, dépôts…). Les lignes déjà connues seront ignorées.`}
          >
            {importing ? "Import en cours…" : `Importer ${current.total} ligne${s(current.total)}`}
          </ConfirmSubmit>
          <Button type="button" variant="ghost" className="max-md:h-10" onClick={restart}>
            Annuler
          </Button>
        </form>
      </FormSection>
    );
  }

  return (
    <FormSection
      title="Fichier de joueurs"
      description="Colonnes attendues : identifiant joueur, événement (registration, ftd, deposit, redeposit, revenue) et, si possible, identifiant de suivi (sub_id), montant, devise, date, transaction. Séparateur virgule, point-virgule ou tabulation."
    >
      <form
        action={preview}
        className="max-w-xl space-y-5 rounded-xl border border-border bg-card p-4 md:p-6"
      >
        <div className="space-y-2">
          <Label htmlFor="programId">Programme</Label>
          <NativeSelect id="programId" name="programId" required wrapperClassName="w-full">
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          {programs.length === 0 ? (
            <p className="text-note text-danger">
              Aucun programme : attendez la synchronisation Link Affi.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="file">Fichier CSV (5 Mo au plus)</Label>
          <Input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv,text/plain"
            required
            className="h-auto py-1.5 max-md:h-auto"
          />
        </div>
        {current.error ? (
          <p className="text-body text-danger" role="alert">
            {current.error}
          </p>
        ) : null}
        <Button type="submit" className="max-md:h-10" disabled={pending || programs.length === 0}>
          {pending ? "Analyse…" : "Analyser le fichier"}
        </Button>
      </form>
    </FormSection>
  );
}
