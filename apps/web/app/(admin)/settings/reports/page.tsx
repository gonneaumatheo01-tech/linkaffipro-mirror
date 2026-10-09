import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAdminPage } from "@/lib/session";
import { saveReportsConfigAction, sendReportNowAction } from "./actions";

export const metadata: Metadata = { title: "Rapports" };

type Config = { daily: boolean; weekly: boolean; hour: number };

function readConfig(value: unknown): Config {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    daily: typeof v.daily === "boolean" ? v.daily : true,
    weekly: typeof v.weekly === "boolean" ? v.weekly : true,
    hour: typeof v.hour === "number" && v.hour >= 0 && v.hour <= 23 ? Math.floor(v.hour) : 9,
  };
}

/** Rendu très simple du HTML Telegram (b, i, code) pour l'aperçu ; le reste est affiché tel quel. */
function telegramToText(html: string): string {
  return html.replace(/<\/?(b|i|code)>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export default async function ReportsPage({ searchParams }: PageProps<"/settings/reports">) {
  await requireAdminPage();
  const sp = await searchParams;
  const keys = ["reports.config", "reports.lastDaily", "reports.lastWeekly", "reports.lastDailyText", "reports.lastWeeklyText"];
  const settings = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const get = (k: string) => settings.find((s) => s.key === k)?.value;
  const config = readConfig(get("reports.config"));
  const lastDaily = typeof get("reports.lastDaily") === "string" ? (get("reports.lastDaily") as string) : null;
  const lastWeekly = typeof get("reports.lastWeekly") === "string" ? (get("reports.lastWeekly") as string) : null;
  const lastDailyText = typeof get("reports.lastDailyText") === "string" ? (get("reports.lastDailyText") as string) : null;
  const lastWeeklyText = typeof get("reports.lastWeeklyText") === "string" ? (get("reports.lastWeeklyText") as string) : null;

  return (
    <>
      <PageHeader title="Rapports automatiques" description="Brief quotidien et rapport hebdomadaire envoyés sur le Telegram de l'administrateur, en chiffres (demandes, acceptés, clics, inscriptions, FTD, dépôts, NGR, dépense, alertes)." />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Réglages</CardTitle>
            <CardDescription>Le brief couvre la veille ; le rapport hebdomadaire part le lundi et couvre les 7 derniers jours. Heure de Paris.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveReportsConfigAction} className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="daily" defaultChecked={config.daily} /> Brief quotidien
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="weekly" defaultChecked={config.weekly} /> Rapport hebdomadaire (lundi)
              </label>
              <div className="space-y-2">
                <Label htmlFor="hour">Heure d&apos;envoi (0 à 23)</Label>
                <Input id="hour" name="hour" type="number" min={0} max={23} defaultValue={config.hour} className="w-24" />
              </div>
              <Button type="submit">Enregistrer</Button>
            </form>
            <div className="mt-6 flex flex-wrap gap-2">
              <form action={sendReportNowAction}>
                <input type="hidden" name="kind" value="daily" />
                <Button type="submit" variant="outline">Envoyer le brief maintenant</Button>
              </form>
              <form action={sendReportNowAction}>
                <input type="hidden" name="kind" value="weekly" />
                <Button type="submit" variant="outline">Envoyer le rapport maintenant</Button>
              </form>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Dernier brief automatique : {lastDaily ?? "jamais"} · dernier rapport hebdomadaire automatique : {lastWeekly ?? "jamais"}.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dernier brief envoyé</CardTitle>
            </CardHeader>
            <CardContent>
              {lastDailyText ? <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{telegramToText(lastDailyText)}</pre> : <p className="text-sm text-muted-foreground">Aucun brief envoyé pour l&apos;instant.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dernier rapport hebdomadaire envoyé</CardTitle>
            </CardHeader>
            <CardContent>
              {lastWeeklyText ? <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{telegramToText(lastWeeklyText)}</pre> : <p className="text-sm text-muted-foreground">Aucun rapport envoyé pour l&apos;instant.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
