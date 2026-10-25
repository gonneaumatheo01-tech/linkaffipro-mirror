import type { Metadata } from "next";
import { RefreshCw } from "lucide-react";
import { parseAlertSwitches, type SwitchableAlertKind } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { alertKindLabel } from "@/lib/status/labels";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { SettingsGroupNav } from "../categories/group-nav";
import {
  checkAlertsNowAction,
  purgeNowAction,
  resolveAlertAction,
  saveAlertThresholdsAction,
  saveRetentionAction,
} from "./actions";
import { openAlertsPill, purgeSummary, retentionMonths } from "./alert-view";
import { ALERT_SWITCH_FIELDS, ALERT_THRESHOLDS_KEY, parseThresholds } from "./thresholds";

export const metadata: Metadata = { title: "Alertes" };

/** Ordre de tri des gravités (la plus grave d'abord au premier clic). */
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, INFO: 1 };

/**
 * Réglages → Alertes et rapports → Alertes : les alertes du système en tableau de 4 colonnes (alerte, gravité, date,
 * état) avec le détail et « Marquer résolue » au clic ; les trois alertes sur les chiffres (seuil et case « Alerte
 * activée ») ; la durée de conservation des données, la purge manuelle étant rangée dans « Avancé ».
 */
export default async function AlertsPage({ searchParams }: PageProps<"/settings/alerts">) {
  await requireAdminPage();
  const sp = await searchParams;
  const [alerts, retention, lastPurge, thresholdsRow] = await Promise.all([
    prisma.alert.findMany({
      orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.setting.findUnique({ where: { key: "retention.months" } }),
    prisma.auditLog.findFirst({
      where: { action: "maintenance.purge" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.setting.findUnique({ where: { key: ALERT_THRESHOLDS_KEY } }),
  ]);
  const thresholds = parseThresholds(thresholdsRow?.value);
  const switches = parseAlertSwitches(thresholdsRow?.value);
  const months = retentionMonths(retention?.value);
  const pill = openAlertsPill(alerts.filter((a) => !a.resolvedAt).length);
  // Après une action, le tableau (et son volet) repart de zéro : le message de retour reste visible.
  const flashKey = JSON.stringify([sp.ok ?? null, sp.error ?? null]);

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Alertes"
        meta={<StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
        description="Le site surveille les bots, la synchro, les envois et vos chiffres toutes les 5 minutes, et vous prévient sur Telegram."
        help="Une alerte vous est envoyée une fois et se ferme seule quand le problème disparaît. « Vérifier maintenant » force un passage."
        secondaryActions={
          <form action={checkAlertsNowAction}>
            <Button type="submit" variant="outline" className="max-md:h-10">
              <RefreshCw aria-hidden />
              Vérifier maintenant
            </Button>
          </form>
        }
      />
      <SettingsGroupNav group="alerts" current="alerts" />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        <FormSection
          title="Alertes récentes"
          description="Les alertes ouvertes d'abord. Cliquez sur une alerte pour son détail."
        >
          <DataTable
            key={`alerts-${flashKey}`}
            label="Alertes récentes"
            columns={[
              { key: "alert", header: "Alerte", className: "min-w-56 whitespace-normal" },
              { key: "severity", header: "Gravité", hideOnMobile: true },
              { key: "when", header: "Quand", hideOnMobile: true },
              { key: "state", header: "État" },
            ]}
            rows={alerts.map((a) => ({
              id: a.id,
              cells: {
                alert: (
                  <span className="flex flex-col items-start gap-0.5">
                    <span>{alertKindLabel(a.kind)}</span>
                    <span className="line-clamp-2 text-note font-normal text-muted-foreground">
                      {a.message}
                    </span>
                  </span>
                ),
                severity: <StatusBadge kind="alert" value={a.severity} />,
                when: fmtDate(a.createdAt),
                state: a.resolvedAt ? (
                  <StatusPill tone="muted">Résolue</StatusPill>
                ) : (
                  <StatusPill tone="danger">Ouverte</StatusPill>
                ),
              },
              sortValues: {
                alert: alertKindLabel(a.kind),
                severity: SEVERITY_RANK[a.severity] ?? 0,
                when: a.createdAt,
                state: a.resolvedAt ? 0 : 1,
              },
              detailTitle: alertKindLabel(a.kind),
              detailDescription: `${statusLabel("alert", a.severity)} · ${fmtDate(a.createdAt)}`,
              detail: (
                <div className="space-y-6">
                  <p className="text-body text-foreground">{a.message}</p>
                  <DetailList>
                    <DetailRow label="Gravité">
                      <StatusBadge kind="alert" value={a.severity} />
                    </DetailRow>
                    <DetailRow label="Apparue le">{fmtDate(a.createdAt)}</DetailRow>
                    <DetailRow label="Envoyée sur Telegram">
                      {a.notifiedAt ? `le ${fmtDate(a.notifiedAt)}` : "Pas encore"}
                    </DetailRow>
                    <DetailRow label="État">
                      {a.resolvedAt ? `Résolue le ${fmtDate(a.resolvedAt)}` : "Ouverte"}
                    </DetailRow>
                  </DetailList>
                  {!a.resolvedAt ? (
                    <form action={resolveAlertAction} className="border-t border-border pt-6">
                      <input type="hidden" name="alertId" value={a.id} />
                      <p className="mb-3 text-note text-muted-foreground">
                        Le problème est réglé ? Fermez l&apos;alerte sans attendre le prochain
                        passage.
                      </p>
                      <Button type="submit" variant="outline" className="max-md:h-10">
                        Marquer résolue
                      </Button>
                    </form>
                  ) : null}
                </div>
              ),
            }))}
            empty={{
              title: "Aucune alerte",
              description:
                "Tout fonctionne. Une alerte apparaîtra ici si un bot ne répond plus, si la synchro échoue, si une sauvegarde rate…",
            }}
          />
        </FormSection>

        <FormSection
          title="Alertes sur vos chiffres"
          description="Cinq alertes se règlent ici : leur seuil, et si elles vous sont envoyées. Une alerte désactivée n'est plus envoyée ; si elle était ouverte, elle se ferme toute seule. Les autres (bot, synchro, sauvegarde, message en échec…) restent toujours actives."
        >
          <form
            action={saveAlertThresholdsAction}
            className="grid gap-x-6 gap-y-5 rounded-xl border border-border bg-card p-4 md:grid-cols-3 md:p-6"
          >
            <div className="space-y-2">
              <Label htmlFor="registrationsDropPct">Chute des inscriptions (%)</Label>
              <Input
                id="registrationsDropPct"
                name="registrationsDropPct"
                type="number"
                min={1}
                max={100}
                defaultValue={thresholds.registrationsDropPct}
                aria-describedby="registrationsDropPct-aide"
              />
              <p id="registrationsDropPct-aide" className="text-note text-muted-foreground">
                Les 24 dernières heures comparées à la moyenne des 7 jours d&apos;avant (dès 10
                inscriptions par jour). 50 = alerte si on passe de 20 à moins de 10 par jour.
              </p>
              <AlertSwitch kind="registrations_drop" checked={switches.registrations_drop} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spendNoConversionEur">Dépense sans inscription (€)</Label>
              <Input
                id="spendNoConversionEur"
                name="spendNoConversionEur"
                inputMode="decimal"
                defaultValue={thresholds.spendNoConversionEur}
                aria-describedby="spendNoConversionEur-aide"
              />
              <p id="spendNoConversionEur-aide" className="text-note text-muted-foreground">
                Une pub qui a coûté plus que ce montant en 24 h sans aucune inscription. 50 = une
                pub à 60 € sans inscrit déclenche l&apos;alerte.
              </p>
              <AlertSwitch kind="spend_no_conversion" checked={switches.spend_no_conversion} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="channelLeakPct">Départs d&apos;un canal (%)</Label>
              <Input
                id="channelLeakPct"
                name="channelLeakPct"
                type="number"
                min={1}
                max={100}
                defaultValue={thresholds.channelLeakPct}
                aria-describedby="channelLeakPct-aide"
              />
              <p id="channelLeakPct-aide" className="text-note text-muted-foreground">
                Part des membres d&apos;un canal (20 au moins) partis en 24 h. 10 = alerte si 11
                membres sur 100 partent dans la journée.
              </p>
              <AlertSwitch kind="channel_leak" checked={switches.channel_leak} />
            </div>
            <div className="space-y-3 border-t border-border pt-5 md:col-span-3">
              <p className="text-body font-medium text-foreground">Équipe Algorithme</p>
              <p className="text-note text-muted-foreground">
                Comparaison des 7 derniers jours aux 7 jours d&apos;avant, seulement quand il y a assez de
                données ; une alerte au plus par jour et par canal ou par profil.
              </p>
              <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-body text-foreground">
                    Canal en baisse : vues ou clics −30 % sur 7 jours
                  </p>
                  <AlertSwitch kind="agents_channel_drop" checked={switches.agents_channel_drop} />
                </div>
                <div className="space-y-1">
                  <p className="text-body text-foreground">
                    Profil de conversation en baisse : réponses ou inscriptions −30 % sur 7 jours
                  </p>
                  <AlertSwitch kind="agents_persona_drop" checked={switches.agents_persona_drop} />
                </div>
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-5 md:col-span-3">
              <p className="text-body font-medium text-foreground">Équipe Casino</p>
              <div className="space-y-1">
                <p className="text-body text-foreground">
                  Médiathèque Casino : moins de 3 vidéos non utilisées pour un thème
                </p>
                <p className="text-note text-muted-foreground">
                  Le seuil se règle dans la fiche de l&apos;équipe Casino ; une alerte au plus par jour.
                </p>
                <AlertSwitch kind="agents_media_low" checked={switches.agents_media_low} />
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-5 md:col-span-3">
              <p className="text-body font-medium text-foreground">Agent Ads</p>
              <p className="text-note text-muted-foreground">
                Les seuils se règlent dans Agents → Agent Ads (section «&nbsp;Seuils par univers&nbsp;») ; une alerte au plus par jour et par campagne (ou par pub pour le coût par inscription).
              </p>
              <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                {(
                  [
                    ["ads_spend_spike", "Dépense pub anormale d'une campagne : nettement au-dessus de sa moyenne des 7 jours"],
                    ["ads_conversion_drop", "Chute des inscriptions d'une campagne"],
                    ["ads_cost_over_threshold", "Pub trop chère par inscription depuis plusieurs jours"],
                    ["ads_budget_exhausted", "Budget du jour d'une campagne atteint"],
                  ] as const
                ).map(([kind, label]) => (
                  <div key={kind} className="space-y-1">
                    <p className="text-body text-foreground">{label}</p>
                    <AlertSwitch kind={kind} checked={switches[kind]} />
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-5 md:col-span-3">
              <p className="text-body font-medium text-foreground">Bookmakers</p>
              <p className="text-note text-muted-foreground">
                Contrôle toutes les 30 minutes (jamais la nuit) ; Kevin dit en même temps quoi faire. Détail dans Agents → Bookmakers.
              </p>
              <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                {(
                  [
                    ["bookmaker_blocked", "Bookmaker qui ne se lit plus : contrôle anti-robot, code, mot de passe refusé ou 3 échecs de suite"],
                    ["bookmaker_degraded", "Bookmaker qui se lit mal : moins de 90 % de lectures réussies sur 24 h"],
                  ] as const
                ).map(([kind, label]) => (
                  <div key={kind} className="space-y-1">
                    <p className="text-body text-foreground">{label}</p>
                    <AlertSwitch kind={kind} checked={switches[kind]} />
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-5 md:col-span-3">
              <p className="text-body font-medium text-foreground">Analyse du marché</p>
              <p className="text-note text-muted-foreground">
                Veille des forums, réseaux et actualités par l&apos;équipe Analystes. Détail dans Agents → Analyses.
              </p>
              <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-body text-foreground">Veille du marché en panne : ses tâches échouent en boucle</p>
                  <AlertSwitch kind="analysts_failing" checked={switches.analysts_failing} />
                </div>
              </div>
            </div>
            <div className="md:col-span-3">
              <Button type="submit" className="max-md:h-10">
                Enregistrer
              </Button>
            </div>
          </form>
        </FormSection>

        <FormSection
          title="Conservation des données"
          description="Au-delà de cette durée, les membres inactifs sont anonymisés et leurs événements supprimés (sauf les événements joueurs). Règle de l'équipe : 24 mois."
        >
          <form
            action={saveRetentionAction}
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end md:p-6"
          >
            <div className="space-y-2">
              <Label htmlFor="months">Durée en mois (de 6 à 120)</Label>
              <Input
                id="months"
                name="months"
                type="number"
                min={6}
                max={120}
                defaultValue={months}
                className="w-32"
              />
            </div>
            <Button type="submit" variant="outline" className="self-start max-md:h-10 sm:self-auto">
              Enregistrer la durée
            </Button>
          </form>
          <p className="text-note text-muted-foreground">
            La purge passe toute seule chaque nuit. {purgeSummary(lastPurge)}
          </p>
          <AdvancedSection
            title="Avancé : purge manuelle"
            description="Rarement utile : seulement pour effacer tout de suite après avoir réduit la durée."
          >
            <form action={purgeNowAction} className="space-y-3">
              <p className="text-body text-muted-foreground">
                Anonymise maintenant tous les membres inactifs depuis plus de {months} mois et
                supprime leurs événements. Irréversible.
              </p>
              <ConfirmSubmit
                variant="destructive"
                className="max-md:h-10"
                confirmTitle={"Lancer la purge maintenant\u00a0?"}
                confirmLabel="Lancer la purge"
                message={`Tous les membres inactifs depuis plus de ${months} mois seront anonymisés et leurs événements supprimés. Cette action est irréversible.`}
              >
                Lancer la purge maintenant
              </ConfirmSubmit>
            </form>
          </AdvancedSection>
        </FormSection>
      </div>
    </>
  );
}

/**
 * Case « Alerte activée » d'une alerte sur les chiffres. Le seuil reste toujours envoyé (jamais désactivé) ; le nom de
 * l'alerte est lu par les lecteurs d'écran pour distinguer les trois cases.
 */
function AlertSwitch({ kind, checked }: { kind: SwitchableAlertKind; checked: boolean }) {
  return (
    <label className="flex min-h-10 items-center gap-3 text-body">
      <Checkbox name={ALERT_SWITCH_FIELDS[kind]} value="on" defaultChecked={checked} />
      <span>
        Alerte activée<span className="sr-only">{` : ${alertKindLabel(kind)}`}</span>
      </span>
    </label>
  );
}
