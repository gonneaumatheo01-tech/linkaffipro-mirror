import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAdminPage } from "@/lib/session";
import { saveReportsConfigAction, sendReportNowAction } from "./actions";

export const metadata: Metadata = { title: "Rapports automatiques" };

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
  return html
    .replace(/<\/?(b|i|code)>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export default async function ReportsPage({ searchParams }: PageProps<"/settings/reports">) {
  await requireAdminPage();
  const sp = await searchParams;
  const keys = [
    "reports.config",
    "reports.lastDaily",
    "reports.lastWeekly",
    "reports.lastDailyText",
    "reports.lastWeeklyText",
  ];
  const settings = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const get = (k: string) => settings.find((s) => s.key === k)?.value;
  const config = readConfig(get("reports.config"));
  const lastDaily =
    typeof get("reports.lastDaily") === "string" ? (get("reports.lastDaily") as string) : null;
  const lastWeekly =
    typeof get("reports.lastWeekly") === "string" ? (get("reports.lastWeekly") as string) : null;
  const lastDailyText =
    typeof get("reports.lastDailyText") === "string"
      ? (get("reports.lastDailyText") as string)
      : null;
  const lastWeeklyText =
    typeof get("reports.lastWeeklyText") === "string"
      ? (get("reports.lastWeeklyText") as string)
      : null;

  return (
    <>
      <PageHeader
        title="Rapports automatiques"
        description="Résumé quotidien et rapport hebdomadaire envoyés sur le Telegram de l'administrateur : demandes, acceptés, clics, inscriptions, premiers dépôts (FTD), dépôts, revenu net (NGR), dépense, alertes."
        help="Choisissez l'heure d'envoi, puis cliquez sur « Envoyer le résumé maintenant » pour vérifier que vous le recevez bien."
      >
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings" />}
        >
          ← Réglages
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Réglages</CardTitle>
            <CardDescription>
              Le résumé quotidien couvre la veille ; le rapport hebdomadaire part le lundi et couvre
              les 7 derniers jours. Heure de Paris.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveReportsConfigAction} className="space-y-4">
              <label className="flex min-h-10 items-center gap-2 text-sm md:min-h-0">
                <input
                  type="checkbox"
                  name="daily"
                  defaultChecked={config.daily}
                  className="size-4"
                />{" "}
                Résumé quotidien
              </label>
              <label className="flex min-h-10 items-center gap-2 text-sm md:min-h-0">
                <input
                  type="checkbox"
                  name="weekly"
                  defaultChecked={config.weekly}
                  className="size-4"
                />{" "}
                Rapport hebdomadaire (le lundi)
              </label>
              <div className="space-y-2">
                <Label htmlFor="hour">Heure d&apos;envoi (0 à 23)</Label>
                <Input
                  id="hour"
                  name="hour"
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={config.hour}
                  className="h-10 w-24 md:h-9"
                />
              </div>
              <Button type="submit" className="max-md:h-10">
                Enregistrer
              </Button>
            </form>
            <div className="mt-6 flex flex-wrap gap-2">
              <form action={sendReportNowAction}>
                <input type="hidden" name="kind" value="daily" />
                <Button type="submit" variant="outline" className="max-md:h-10">
                  Envoyer le résumé maintenant
                </Button>
              </form>
              <form action={sendReportNowAction}>
                <input type="hidden" name="kind" value="weekly" />
                <Button type="submit" variant="outline" className="max-md:h-10">
                  Envoyer le rapport maintenant
                </Button>
              </form>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Dernier résumé automatique : {lastDaily ?? "jamais"} · dernier rapport hebdomadaire
              automatique : {lastWeekly ?? "jamais"}.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dernier résumé envoyé</CardTitle>
            </CardHeader>
            <CardContent>
              {lastDailyText ? (
                <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
                  {telegramToText(lastDailyText)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucun résumé envoyé pour l&apos;instant.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dernier rapport hebdomadaire envoyé</CardTitle>
            </CardHeader>
            <CardContent>
              {lastWeeklyText ? (
                <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
                  {telegramToText(lastWeeklyText)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucun rapport envoyé pour l&apos;instant.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
