"use client";

import { useActionState, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { FormSection } from "@/components/admin/form-section";
import { Stepper } from "@/components/admin/stepper";
import { StatusPill } from "@/components/admin/status-pill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import {
  DATE_FORMAT_LABELS,
  NUMBER_FORMAT_LABELS,
  PLATFORM_NAMES,
  type CostField,
  type DateFormat,
  type NumberFormat,
} from "@/lib/campaigns/csv";
import { IMPORT_STEPS, importStep, type ImportView } from "@/lib/campaigns/wizard-display";
import { confirmImportAction, previewImportAction, type PreviewState } from "./actions";

const FIELD_LABELS: Array<[CostField, string]> = [
  ["date", "Date"],
  ["campaign", "Campagne pub"],
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

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

function MatchTag({ status }: { status: "existing" | "create" }) {
  return status === "existing" ? (
    <StatusPill tone="muted">existe</StatusPill>
  ) : (
    <StatusPill tone="info">à créer</StatusPill>
  );
}

/**
 * Import CSV des dépenses en 3 étapes (`Stepper`) : 1. fichier et plateforme ; 2. vérification (colonnes
 * reconnues, formats, aperçu, lignes ignorées ; « Relire » après un changement) ; 3. correspondances avec les
 * campagnes pub existantes ou à créer, puis import. Les actions serveur sont inchangées : l'aperçu
 * (`previewImportAction`) et l'import (`confirmImportAction`, qui relit le fichier avec les réglages du dernier aperçu).
 */
export function ImportWizard() {
  const [state, action, pending] = useActionState<PreviewState, FormData>(previewImportAction, {
    error: null,
    preview: null,
  });
  const [view, setView] = useState<ImportView | null>(null);
  const p = state.preview;
  const step = importStep(p, view);
  const goTo = (s: number) => setView({ preview: p, step: s });
  const fieldOf = (col: number): CostField | "" =>
    (Object.entries(p?.map ?? {}).find(([, idx]) => idx === col)?.[0] as CostField | undefined) ??
    "";
  const recognized = p ? Object.keys(p.map).length : 0;

  return (
    <div className="max-w-4xl space-y-6">
      <Stepper
        steps={IMPORT_STEPS}
        current={step}
        label="Étapes de l'import"
        onStepClick={p ? goTo : undefined}
      />

      <div className="space-y-6 rounded-xl border border-border bg-card p-4 md:p-6">
        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        {step < 2 ? (
          <form action={action} className="space-y-6">
            {p ? <input type="hidden" name="csvB64" value={p.csvB64} /> : null}
            {p ? <input type="hidden" name="filename" value={p.filename} /> : null}

            {step === 0 ? (
              <FormSection title="Le fichier">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="platform">Plateforme</Label>
                    <NativeSelect
                      id="platform"
                      name="platform"
                      defaultValue={p?.platformChoice ?? "AUTO"}
                      wrapperClassName="w-full"
                    >
                      <option value="AUTO">Reconnaître toute seule</option>
                      <option value="TIKTOK">TikTok Ads Manager</option>
                      <option value="META">Meta Ads Manager</option>
                      <option value="OTHER">Autre (CSV simple)</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="file">Fichier CSV (2 Mo au plus)</Label>
                    {/* Le bouton du navigateur prend l'allure d'un bouton secondaire (sinon un simple texte gras). */}
                    <Input
                      id="file"
                      name="file"
                      type="file"
                      accept=".csv,text/csv,.txt"
                      className="cursor-pointer pl-1 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-muted file:px-3 hover:file:bg-muted/70 max-md:pl-1.5 max-md:file:h-8"
                    />
                    {p ? (
                      <p className="text-note text-muted-foreground">
                        Sans nouveau fichier, « {p.filename} » est relu.
                      </p>
                    ) : null}
                  </div>
                </div>
              </FormSection>
            ) : null}

            {step === 1 && p ? (
              <>
                <input type="hidden" name="platform" value={p.platformChoice} />
                <FormSection
                  title="Colonnes reconnues"
                  description="« Date » et « Dépense » sont obligatoires ; laissez « Ignorer » pour les autres colonnes."
                >
                  <div className="flex flex-wrap items-center gap-2 text-body">
                    <span>
                      {p.filename} · plateforme{" "}
                      <strong className="font-semibold">{PLATFORM_NAMES[p.platform]}</strong>
                    </span>
                    <StatusPill tone={p.detected.confidence >= 70 ? "success" : "warning"}>
                      {p.platformChoice === "AUTO"
                        ? `reconnue à ${p.detected.confidence} %`
                        : `choisie (reconnue : ${PLATFORM_NAMES[p.detected.platform]}, ${p.detected.confidence} %)`}
                    </StatusPill>
                    <span className="text-note text-muted-foreground">
                      {SOURCE_TEXT[p.mappingSource]} ({recognized}/8)
                    </span>
                  </div>
                  <Table label="Colonnes du fichier">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Colonne du fichier</TableHead>
                        <TableHead className="w-48">Sert à</TableHead>
                        <TableHead>Exemples</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.headers.map((h, i) => {
                        const current = fieldOf(i);
                        const sample = p.rawSample.map((r) => r[i] ?? "").join(" · ");
                        return (
                          <TableRow key={i}>
                            <TableCell
                              className={current ? "font-medium" : "text-muted-foreground"}
                            >
                              {h || `Colonne ${i + 1}`}
                            </TableCell>
                            <TableCell>
                              <NativeSelect
                                id={`map_${i}`}
                                name={`map_${i}`}
                                defaultValue={current}
                                aria-label={`À quoi sert la colonne ${h || i + 1}`}
                                wrapperClassName="w-full"
                              >
                                <option value="">Ignorer</option>
                                {FIELD_LABELS.map(([f, label]) => (
                                  <option key={f} value={f}>
                                    {label}
                                  </option>
                                ))}
                              </NativeSelect>
                            </TableCell>
                            <TableCell
                              className="max-w-xs truncate text-note text-muted-foreground"
                              title={sample}
                            >
                              {sample || "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="numberFormat">Format des nombres</Label>
                      <NativeSelect
                        id="numberFormat"
                        name="numberFormat"
                        defaultValue={p.numberFormat}
                        wrapperClassName="w-full"
                      >
                        {(Object.keys(NUMBER_FORMAT_LABELS) as NumberFormat[]).map((k) => (
                          <option key={k} value={k}>
                            {NUMBER_FORMAT_LABELS[k]}
                            {k === p.detectedNumberFormat && k !== "auto" ? " (deviné)" : ""}
                          </option>
                        ))}
                      </NativeSelect>
                      <p className="text-note text-muted-foreground">
                        « 1,234 » : mille deux cent trente-quatre (export en anglais) ou un virgule
                        deux (export en français).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dateFormat">Format des dates</Label>
                      <NativeSelect
                        id="dateFormat"
                        name="dateFormat"
                        defaultValue={p.dateFormat}
                        wrapperClassName="w-full"
                      >
                        {(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map((k) => (
                          <option key={k} value={k}>
                            {DATE_FORMAT_LABELS[k]}
                            {k === p.detectedDateFormat && k !== "auto" ? " (deviné)" : ""}
                          </option>
                        ))}
                      </NativeSelect>
                      <p className="text-note text-muted-foreground">
                        « 09/10/2026 » : 9 octobre (France) ou 10 septembre (États-Unis, fréquent
                        chez Meta).
                      </p>
                    </div>
                  </div>
                </FormSection>

                <FormSection
                  title="Aperçu"
                  description={`${p.totalRows} ligne${p.totalRows > 1 ? "s" : ""} de dépense lisible${p.totalRows > 1 ? "s" : ""}${
                    p.skipped.length
                      ? ` · ${p.skipped.length} ligne${p.skipped.length > 1 ? "s" : ""} ignorée${p.skipped.length > 1 ? "s" : ""} (${p.skippedSummary.map((s) => `${s.count} : ${s.label}`).join(", ")})`
                      : " · aucune ligne ignorée"
                  }`}
                >
                  {p.errors.length ? (
                    <details className="text-note text-danger">
                      <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium md:min-h-8">
                        Voir les lignes en erreur ({p.errors.length}
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
                    <p className="text-body text-muted-foreground">
                      Aucune ligne lisible : vérifiez les colonnes Date et Dépense et les formats
                      ci-dessus, puis « Relire ».
                    </p>
                  ) : (
                    <Table label="Aperçu des premières lignes">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Campagne pub</TableHead>
                          <TableHead className="max-md:hidden">Groupe</TableHead>
                          <TableHead className="max-md:hidden">Pub</TableHead>
                          <TableHead numeric>Dépense</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.sample.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell>{r.date}</TableCell>
                            <TableCell>{r.campaign}</TableCell>
                            <TableCell className="max-md:hidden">{r.adset}</TableCell>
                            <TableCell className="max-md:hidden">{r.ad}</TableCell>
                            <TableCell numeric>{eur(r.spend)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </FormSection>
              </>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              {step === 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="max-md:h-10"
                  onClick={() => goTo(0)}
                >
                  <ArrowLeft aria-hidden />
                  Autre fichier
                </Button>
              ) : (
                <span aria-hidden />
              )}
              <div className="flex flex-wrap items-center gap-2">
                {step === 1 && p ? (
                  <>
                    <Button
                      type="submit"
                      variant="outline"
                      className="max-md:h-10"
                      disabled={pending}
                    >
                      {pending ? "Lecture…" : "Relire avec ces réglages"}
                    </Button>
                    <Button
                      type="button"
                      className="max-md:h-10"
                      disabled={pending || p.totalRows === 0}
                      onClick={() => goTo(2)}
                    >
                      Continuer
                      <ArrowRight aria-hidden />
                    </Button>
                  </>
                ) : (
                  <Button type="submit" className="max-md:h-10" disabled={pending}>
                    {pending ? "Lecture…" : "Lire le fichier"}
                  </Button>
                )}
              </div>
            </div>
          </form>
        ) : null}

        {step === 2 && p ? (
          <>
            <FormSection
              title="Campagnes pub retrouvées"
              description={`Les noms du fichier sont comparés aux campagnes pub existantes (majuscules ignorées) ; le reste est créé. Les colonnes seront mémorisées pour le prochain import ${PLATFORM_NAMES[p.platform]}.`}
            >
              <Table label="Correspondances avec les campagnes pub">
                <TableHeader>
                  <TableRow>
                    <TableHead>Campagne pub</TableHead>
                    <TableHead className="max-md:hidden">Groupe</TableHead>
                    <TableHead className="max-md:hidden">Pub</TableHead>
                    <TableHead numeric>Jours</TableHead>
                    <TableHead numeric>Dépense</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.matches.map((m) => (
                    <TableRow key={m.key}>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {m.match.campaign.name} <MatchTag status={m.match.campaign.status} />
                        </span>
                      </TableCell>
                      <TableCell className="max-md:hidden">
                        {m.match.adset ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            {m.match.adset.name} <MatchTag status={m.match.adset.status} />
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="max-md:hidden">
                        {m.match.ad ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            {m.match.ad.name} <MatchTag status={m.match.ad.status} />
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell numeric>{m.count}</TableCell>
                      <TableCell numeric>{eur(m.spend)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-note text-muted-foreground">
                Un nouvel import du même jour remplace les dépenses précédentes ; un rapport
                s&apos;affiche à la fin.
              </p>
            </FormSection>
            <form
              action={confirmImportAction}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
            >
              <input type="hidden" name="platform" value={p.platform} />
              <input type="hidden" name="csvB64" value={p.csvB64} />
              <input type="hidden" name="filename" value={p.filename} />
              <input type="hidden" name="numberFormat" value={p.numberFormat} />
              <input type="hidden" name="dateFormat" value={p.dateFormat} />
              {p.headers.map((_, i) => (
                <input key={i} type="hidden" name={`map_${i}`} value={fieldOf(i)} />
              ))}
              <Button
                type="button"
                variant="outline"
                className="max-md:h-10"
                onClick={() => goTo(1)}
              >
                <ArrowLeft aria-hidden />
                Retour
              </Button>
              <Button type="submit" className="max-md:h-10" disabled={p.totalRows === 0}>
                Importer {p.totalRows} ligne{p.totalRows > 1 ? "s" : ""}
              </Button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
