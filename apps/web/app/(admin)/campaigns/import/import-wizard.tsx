"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HelpTip } from "@/components/admin/help-tip";
import {
  DATE_FORMAT_LABELS,
  NUMBER_FORMAT_LABELS,
  PLATFORM_NAMES,
  type CostField,
  type DateFormat,
  type NumberFormat,
} from "@/lib/campaigns/csv";
import { confirmImportAction, previewImportAction, type PreviewState } from "./actions";

const FIELD_LABELS: Array<[CostField, string]> = [
  ["date", "Date"],
  ["campaign", "Campagne"],
  ["adset", "Groupe"],
  ["ad", "Pub"],
  ["spend", "Dépense"],
  ["impressions", "Impressions"],
  ["clicks", "Clics"],
  ["currency", "Devise"],
];

const SOURCE_TEXT = {
  saved: "colonnes reprises de votre dernier import pour cette plateforme",
  detected: "colonnes reconnues automatiquement",
  manual: "colonnes choisies à la main",
} as const;

export function ImportWizard() {
  const [state, action, pending] = useActionState<PreviewState, FormData>(previewImportAction, {
    error: null,
    preview: null,
  });
  const p = state.preview;
  const selectCls = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";
  const eur = (n: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
  const fieldOf = (col: number): CostField | "" =>
    (Object.entries(p?.map ?? {}).find(([, idx]) => idx === col)?.[0] as CostField | undefined) ??
    "";
  const recognized = p ? Object.keys(p.map).length : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Fichier et colonnes</CardTitle>
          <CardDescription>
            Dans TikTok Ads Manager ou Meta Ads Manager, exportez un rapport par jour avec les
            colonnes campagne / groupe / pub / dépense (CSV, 2 Mo maximum). La plateforme est
            reconnue d&apos;après les en-têtes ; vous pouvez l&apos;imposer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="platform">Plateforme</Label>
              <select
                id="platform"
                name="platform"
                defaultValue={p?.platformChoice ?? "AUTO"}
                className={selectCls}
              >
                <option value="AUTO">Détection automatique</option>
                <option value="TIKTOK">TikTok Ads Manager</option>
                <option value="META">Meta Ads Manager</option>
                <option value="OTHER">Autre (CSV générique)</option>
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="file">Fichier CSV</Label>
              <Input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv,.txt"
                className="h-10 md:h-9"
              />
            </div>
            {p ? <input type="hidden" name="csvB64" value={p.csvB64} /> : null}
            {p ? <input type="hidden" name="filename" value={p.filename} /> : null}

            {p ? (
              <div className="space-y-4 sm:col-span-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>
                    Plateforme retenue : <strong>{PLATFORM_NAMES[p.platform]}</strong>
                  </span>
                  <Badge variant={p.detected.confidence >= 70 ? "default" : "outline"}>
                    {p.platformChoice === "AUTO"
                      ? `détectée, confiance ${p.detected.confidence} %`
                      : `imposée (détection : ${PLATFORM_NAMES[p.detected.platform]}, ${p.detected.confidence} %)`}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    · {SOURCE_TEXT[p.mappingSource]} ({recognized}/8)
                  </span>
                </div>

                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Colonne du fichier</TableHead>
                        <TableHead className="w-44">
                          <span className="inline-flex items-center gap-1">
                            Champ
                            <HelpTip>
                              À quoi sert cette colonne. « Date » et « Dépense » sont obligatoires ;
                              laissez « — ignorer — » pour les autres colonnes.
                            </HelpTip>
                          </span>
                        </TableHead>
                        <TableHead>Exemples (5 premières lignes)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.headers.map((h, i) => {
                        const current = fieldOf(i);
                        return (
                          <TableRow key={i} className={current ? "" : "text-muted-foreground"}>
                            <TableCell className="font-medium">{h || `Colonne ${i + 1}`}</TableCell>
                            <TableCell>
                              <Label htmlFor={`map_${i}`} className="sr-only">
                                Champ pour la colonne {h || i + 1}
                              </Label>
                              <select
                                id={`map_${i}`}
                                name={`map_${i}`}
                                defaultValue={current}
                                className={selectCls}
                              >
                                <option value="">— ignorer —</option>
                                {FIELD_LABELS.map(([f, label]) => (
                                  <option key={f} value={f}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </TableCell>
                            <TableCell
                              className="max-w-md truncate text-xs"
                              title={p.rawSample.map((r) => r[i] ?? "").join(" · ")}
                            >
                              {p.rawSample.map((r) => r[i] ?? "").join(" · ") || "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="numberFormat" className="flex items-center gap-1">
                      Format des nombres
                      <HelpTip>
                        Comment lire « 1,234 » : 1 234 (point décimal, exports en anglais) ou 1,234
                        (virgule décimale, exports en français). Deviné d&apos;après la colonne
                        Dépense.
                      </HelpTip>
                    </Label>
                    <select
                      id="numberFormat"
                      name="numberFormat"
                      defaultValue={p.numberFormat}
                      className={selectCls}
                    >
                      {(Object.keys(NUMBER_FORMAT_LABELS) as NumberFormat[]).map((k) => (
                        <option key={k} value={k}>
                          {NUMBER_FORMAT_LABELS[k]}
                          {k === p.detectedNumberFormat && k !== "auto" ? " (deviné)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dateFormat" className="flex items-center gap-1">
                      Format des dates
                      <HelpTip>
                        Comment lire « 09/10/2026 » : 9 octobre (France) ou 10 septembre
                        (États-Unis, fréquent sur Meta). Deviné d&apos;après la colonne Date.
                      </HelpTip>
                    </Label>
                    <select
                      id="dateFormat"
                      name="dateFormat"
                      defaultValue={p.dateFormat}
                      className={selectCls}
                    >
                      {(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map((k) => (
                        <option key={k} value={k}>
                          {DATE_FORMAT_LABELS[k]}
                          {k === p.detectedDateFormat && k !== "auto" ? " (deviné)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-3 sm:col-span-3">
              <Button type="submit" className="max-md:h-10" disabled={pending}>
                {pending ? "Lecture…" : p ? "Relire avec ces réglages" : "Lire le fichier"}
              </Button>
              {state.error ? (
                <span className="text-sm text-destructive" role="alert">
                  {state.error}
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {p ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Aperçu</CardTitle>
              <CardDescription>
                {p.filename} · {p.totalRows} ligne{p.totalRows > 1 ? "s" : ""} de coût lisible
                {p.totalRows > 1 ? "s" : ""}
                {p.skipped.length
                  ? ` · ${p.skipped.length} ligne${p.skipped.length > 1 ? "s" : ""} ignorée${p.skipped.length > 1 ? "s" : ""} (${p.skippedSummary.map((s) => `${s.count} : ${s.label}`).join(", ")})`
                  : " · aucune ligne ignorée"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {p.errors.length ? (
                <details className="text-xs text-destructive">
                  <summary className="cursor-pointer">
                    Détail des lignes en erreur ({p.errors.length}
                    {p.skipped.length > p.errors.length ? " affichées" : ""})
                  </summary>
                  <ul className="list-disc pl-5">
                    {p.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {p.totalRows === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucune ligne lisible : vérifiez les colonnes Date et Dépense et les formats
                  ci-dessus, puis « Relire ».
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Campagne</TableHead>
                      <TableHead className="hidden md:table-cell">Groupe</TableHead>
                      <TableHead className="hidden md:table-cell">Pub</TableHead>
                      <TableHead className="text-right">Dépense</TableHead>
                      <TableHead className="hidden text-right md:table-cell">Impressions</TableHead>
                      <TableHead className="hidden text-right md:table-cell">Clics</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.sample.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{r.date}</TableCell>
                        <TableCell>{r.campaign}</TableCell>
                        <TableCell className="hidden md:table-cell">{r.adset}</TableCell>
                        <TableCell className="hidden md:table-cell">{r.ad}</TableCell>
                        <TableCell className="text-right tabular-nums">{eur(r.spend)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {r.impressions}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {r.clicks}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Correspondances et import</CardTitle>
              <CardDescription>
                Les noms du fichier sont comparés aux campagnes pub existantes (majuscules ignorées). Ce qui
                n&apos;existe pas encore sera créé. Les colonnes choisies seront mémorisées pour le
                prochain import {PLATFORM_NAMES[p.platform]}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campagne</TableHead>
                    <TableHead>Groupe</TableHead>
                    <TableHead>Pub</TableHead>
                    <TableHead className="text-right">Jours</TableHead>
                    <TableHead className="text-right">Dépense</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.matches.map((m) => (
                    <TableRow key={m.key}>
                      <TableCell>
                        {m.match.campaign.name} <Tag status={m.match.campaign.status} />
                      </TableCell>
                      <TableCell>
                        {m.match.adset ? (
                          <>
                            {m.match.adset.name} <Tag status={m.match.adset.status} />
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {m.match.ad ? (
                          <>
                            {m.match.ad.name} <Tag status={m.match.ad.status} />
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(m.spend)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <form action={confirmImportAction}>
                <input type="hidden" name="platform" value={p.platform} />
                <input type="hidden" name="csvB64" value={p.csvB64} />
                <input type="hidden" name="filename" value={p.filename} />
                <input type="hidden" name="numberFormat" value={p.numberFormat} />
                <input type="hidden" name="dateFormat" value={p.dateFormat} />
                {p.headers.map((_, i) => (
                  <input key={i} type="hidden" name={`map_${i}`} value={fieldOf(i)} />
                ))}
                <Button type="submit" className="max-md:h-10" disabled={p.totalRows === 0}>
                  Importer {p.totalRows} ligne{p.totalRows > 1 ? "s" : ""}
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Tag({ status }: { status: "existing" | "create" }) {
  return (
    <span
      className={`ml-1 rounded px-1.5 py-0.5 text-[10px] uppercase ${status === "existing" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800"}`}
    >
      {status === "existing" ? "existe" : "à créer"}
    </span>
  );
}
