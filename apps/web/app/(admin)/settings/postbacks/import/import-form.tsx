"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import terminé</CardTitle>
          <CardDescription>
            {current.total} ligne{current.total > 1 ? "s" : ""} lue{current.total > 1 ? "s" : ""} ·{" "}
            {current.imported} importée{current.imported > 1 ? "s" : ""} · {current.ignored} déjà
            connue{current.ignored > 1 ? "s" : ""} · {current.errors.length} erreur
            {current.errors.length > 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {current.errors.length > 0 ? (
            <ul className="max-h-60 list-disc overflow-auto pl-5 text-xs text-destructive">
              {current.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="max-md:h-10" onClick={restart}>
              Nouvel import
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="max-md:h-10"
              render={<Link href="/settings/postbacks" />}
            >
              ← Postbacks directs
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (current.step === "preview") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aperçu : {current.filename}</CardTitle>
          <CardDescription>
            {current.total} ligne{current.total > 1 ? "s" : ""} de données · {current.invalid} ligne
            {current.invalid > 1 ? "s" : ""} incomplète{current.invalid > 1 ? "s" : ""} seront
            signalée{current.invalid > 1 ? "s" : ""}. Colonnes reconnues :{" "}
            {Object.entries(current.columns)
              .filter(([, v]) => v !== null)
              .map(([k, v]) => `${COLUMN_LABELS[k] ?? k} = « ${current.headers[v as number]} »`)
              .join(", ")}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {done.error ? (
            <Alert variant="destructive">
              <AlertDescription>{done.error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="max-h-80 overflow-auto rounded-md border">
            <Table>
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
                      <TableCell key={j} className="text-xs">
                        {r[j] ?? ""}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <form action={confirm} className="flex items-center gap-2">
            <input type="hidden" name="programId" value={current.programId} />
            <input type="hidden" name="filename" value={current.filename} />
            <input type="hidden" name="csvB64" value={current.csvB64} />
            <ConfirmSubmit
              className="max-md:h-10"
              disabled={importing}
              message={`${current.total} ligne${current.total > 1 ? "s" : ""} vont être importées comme des postbacks (inscriptions, dépôts…). Les lignes déjà connues seront ignorées. Continuer ?`}
            >
              {importing
                ? "Import en cours…"
                : `Importer ${current.total} ligne${current.total > 1 ? "s" : ""}`}
            </ConfirmSubmit>
            <Button type="button" variant="ghost" className="max-md:h-10" onClick={restart}>
              Annuler
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Fichier de joueurs</CardTitle>
        <CardDescription>
          Colonnes attendues : identifiant joueur, événement (registration, ftd, deposit, redeposit,
          revenue) et, si possible, identifiant de suivi (sub_id), montant, devise, date,
          transaction. Séparateur virgule, point-virgule ou tabulation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={preview} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="programId">Programme</Label>
            <select
              id="programId"
              name="programId"
              required
              className="h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9"
            >
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="file">Fichier CSV (5 Mo max)</Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv,text/plain"
              required
              className="h-10 md:h-9"
            />
          </div>
          {current.error ? (
            <p className="text-sm text-destructive" role="alert">
              {current.error}
            </p>
          ) : null}
          <Button type="submit" className="max-md:h-10" disabled={pending || programs.length === 0}>
            {pending ? "Analyse…" : "Analyser le fichier"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
