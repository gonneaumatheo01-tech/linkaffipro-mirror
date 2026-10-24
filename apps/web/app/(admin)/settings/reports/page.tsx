import type { Metadata } from "next";
import { Send } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireAdminPage } from "@/lib/session";
import { SettingsGroupNav } from "../categories/group-nav";
import { saveReportsConfigAction, sendReportNowAction } from "./actions";
import {
  HOUR_OPTIONS,
  lastSentLabel,
  readReportsConfig,
  reportsSummary,
  telegramToText,
} from "./report-view";

export const metadata: Metadata = { title: "Rapports automatiques" };

/** Dernier texte envoyé, tel qu'il est arrivé sur Telegram (sans la mise en forme). */
function ReportPreview({
  title,
  text,
  emptyTitle,
  emptyHint,
}: {
  title: string;
  text: string | null;
  emptyTitle: string;
  emptyHint: string;
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-body font-semibold text-foreground">{title}</h3>
      {text ? (
        <pre
          tabIndex={0}
          aria-label={title}
          className="max-h-96 overflow-auto rounded-xl border border-border bg-muted/40 p-4 font-sans text-note whitespace-pre-wrap text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {telegramToText(text)}
        </pre>
      ) : (
        <EmptyState icon={<Send />} title={emptyTitle} description={emptyHint} className="py-8" />
      )}
    </section>
  );
}

/**
 * Réglages → Alertes et rapports → Rapports automatiques : quand recevoir le résumé quotidien et le rapport du lundi
 * (mêmes champs qu'avant : `daily`, `weekly`, `hour`), un envoi d'essai, puis l'aperçu des derniers textes envoyés.
 */
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
  const str = (k: string) => {
    const v = settings.find((s) => s.key === k)?.value;
    return typeof v === "string" ? v : null;
  };
  const config = readReportsConfig(settings.find((s) => s.key === "reports.config")?.value);
  const anyOn = config.daily || config.weekly;

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Rapports automatiques"
        meta={
          <StatusPill tone={anyOn ? "success" : "muted"}>
            {anyOn ? "Activés" : "Désactivés"}
          </StatusPill>
        }
        description={
          <>
            Un résumé sur votre Telegram : demandes, acceptés, clics, inscriptions,{" "}
            <Term term="FTD">premiers dépôts</Term>, dépôts, <Term term="NGR">revenu net</Term>,
            dépense pub et alertes.
          </>
        }
        help="Choisissez l'heure, puis « Envoyer maintenant » pour vérifier que vous le recevez bien."
      />
      <SettingsGroupNav group="alerts" current="reports" />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        <FormSection
          title="Quand les recevoir"
          description="Le résumé quotidien couvre la veille ; le rapport du lundi couvre les 7 derniers jours. Heure de Paris."
        >
          <form
            action={saveReportsConfigAction}
            className="max-w-xl space-y-5 rounded-xl border border-border bg-card p-4 md:p-6"
          >
            <p className="text-body text-muted-foreground">{reportsSummary(config)}</p>
            <div className="space-y-1">
              <label className="flex min-h-10 items-center gap-3 text-body">
                <Checkbox name="daily" value="on" defaultChecked={config.daily} />
                Résumé quotidien
              </label>
              <label className="flex min-h-10 items-center gap-3 text-body">
                <Checkbox name="weekly" value="on" defaultChecked={config.weekly} />
                Rapport hebdomadaire (le lundi)
              </label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hour">Heure d&apos;envoi</Label>
              <NativeSelect
                id="hour"
                name="hour"
                defaultValue={String(config.hour)}
                className="w-32"
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" className="max-md:h-10">
              Enregistrer
            </Button>
          </form>
        </FormSection>

        <FormSection
          title="Essayer maintenant"
          description="Envoie tout de suite le résumé ou le rapport sur le Telegram de l'administrateur, sans attendre l'heure prévue."
        >
          <div className="flex flex-wrap gap-2">
            <form action={sendReportNowAction}>
              <input type="hidden" name="kind" value="daily" />
              <Button type="submit" variant="outline" className="max-md:h-10">
                <Send aria-hidden />
                Envoyer le résumé maintenant
              </Button>
            </form>
            <form action={sendReportNowAction}>
              <input type="hidden" name="kind" value="weekly" />
              <Button type="submit" variant="outline" className="max-md:h-10">
                <Send aria-hidden />
                Envoyer le rapport maintenant
              </Button>
            </form>
          </div>
          <p className="text-note text-muted-foreground">
            Dernier résumé automatique : {lastSentLabel(str("reports.lastDaily"))} · dernier rapport
            du lundi : {lastSentLabel(str("reports.lastWeekly"))}.
          </p>
        </FormSection>

        <FormSection
          title="Derniers textes envoyés"
          description="Ce que vous avez reçu sur Telegram, sans la mise en forme."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <ReportPreview
              title="Résumé quotidien"
              text={str("reports.lastDailyText")}
              emptyTitle="Aucun résumé envoyé pour l'instant"
              emptyHint="« Envoyer le résumé maintenant » ci-dessus : il s'affichera ici."
            />
            <ReportPreview
              title="Rapport hebdomadaire"
              text={str("reports.lastWeeklyText")}
              emptyTitle="Aucun rapport envoyé pour l'instant"
              emptyHint="« Envoyer le rapport maintenant » ci-dessus : il s'affichera ici."
            />
          </div>
        </FormSection>
      </div>
    </>
  );
}
