"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { confirmImportAction, previewImportAction, type PreviewState } from "./actions";

const FIELD_LABELS: Array<[string, string]> = [["date", "Date"], ["campaign", "Campagne"], ["adset", "Groupe"], ["ad", "Pub"], ["spend", "Dépense"], ["impressions", "Impressions"], ["clicks", "Clics"], ["currency", "Devise"]];

export function ImportWizard() {
  const [state, action, pending] = useActionState<PreviewState, FormData>(previewImportAction, { error: null, preview: null });
  const p = state.preview;
  const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm";
  const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">1. Fichier</CardTitle><CardDescription>Dans TikTok Ads Manager ou Meta Ads Manager, exportez un rapport par jour avec les colonnes campagne / groupe / pub / dépense (CSV, 2 Mo maximum).</CardDescription></CardHeader>
        <CardContent>
          <form action={action} className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="platform">Plateforme</Label>
              <select id="platform" name="platform" defaultValue={p?.platform ?? "TIKTOK"} className={selectCls}>
                <option value="TIKTOK">TikTok Ads Manager</option>
                <option value="META">Meta Ads Manager</option>
                <option value="OTHER">Autre (CSV générique)</option>
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="file">Fichier CSV</Label>
              <Input id="file" name="file" type="file" accept=".csv,text/csv,.txt" />
            </div>
            {p ? <input type="hidden" name="csvB64" value={p.csvB64} /> : null}
            {p ? <input type="hidden" name="filename" value={p.filename} /> : null}
            {p ? (
              <div className="sm:col-span-3 grid gap-3 sm:grid-cols-4">
                {FIELD_LABELS.map(([f, label]) => (
                  <div key={f} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <select name={`col_${f}`} defaultValue={p.map[f as keyof typeof p.map] ?? ""} className={selectCls}>
                      <option value="">— aucune —</option>
                      {p.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="sm:col-span-3 flex items-center gap-3">
              <Button type="submit" disabled={pending}>{pending ? "Lecture…" : p ? "Relire avec ces colonnes" : "Lire le fichier"}</Button>
              {state.error ? <span className="text-sm text-destructive">{state.error}</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {p ? (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">2. Aperçu</CardTitle><CardDescription>{p.filename} · {p.totalRows} ligne(s) de coût lisibles · colonnes détectées : {Object.keys(p.map).length}/8{p.errors.length ? ` · ${p.errors.length} ligne(s) ignorée(s)` : ""}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {p.errors.length ? <ul className="list-disc pl-5 text-xs text-destructive">{p.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Campagne</TableHead><TableHead>Groupe</TableHead><TableHead>Pub</TableHead><TableHead className="text-right">Dépense</TableHead><TableHead className="text-right">Impr.</TableHead><TableHead className="text-right">Clics</TableHead></TableRow></TableHeader>
                <TableBody>
                  {p.sample.map((r, i) => (
                    <TableRow key={i}><TableCell>{r.date}</TableCell><TableCell>{r.campaign}</TableCell><TableCell>{r.adset}</TableCell><TableCell>{r.ad}</TableCell><TableCell className="text-right tabular-nums">{eur(r.spend)}</TableCell><TableCell className="text-right tabular-nums">{r.impressions}</TableCell><TableCell className="text-right tabular-nums">{r.clicks}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">3. Correspondances et import</CardTitle><CardDescription>Les noms sont rapprochés des pubs existantes (sans tenir compte de la casse). Ce qui n&apos;existe pas sera créé.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader><TableRow><TableHead>Campagne</TableHead><TableHead>Groupe</TableHead><TableHead>Pub</TableHead><TableHead className="text-right">Jours</TableHead><TableHead className="text-right">Dépense</TableHead></TableRow></TableHeader>
                <TableBody>
                  {p.matches.map((m) => (
                    <TableRow key={m.key}>
                      <TableCell>{m.match.campaign.name} <Tag status={m.match.campaign.status} /></TableCell>
                      <TableCell>{m.match.adset ? <>{m.match.adset.name} <Tag status={m.match.adset.status} /></> : "—"}</TableCell>
                      <TableCell>{m.match.ad ? <>{m.match.ad.name} <Tag status={m.match.ad.status} /></> : "—"}</TableCell>
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
                {FIELD_LABELS.map(([f]) => <input key={f} type="hidden" name={`col_${f}`} value={p.map[f as keyof typeof p.map] ?? ""} />)}
                <Button type="submit" disabled={p.totalRows === 0}>Importer {p.totalRows} ligne(s)</Button>
              </form>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Tag({ status }: { status: "existing" | "create" }) {
  return <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] uppercase ${status === "existing" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800"}`}>{status === "existing" ? "existe" : "à créer"}</span>;
}
