import { saveAdsAlertSettingsAction } from "@/app/(admin)/agents/ads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADS_ALERT_FIELDS, alertField, type AdsAlertSettingsValues } from "@/lib/agents/ads/alert-settings";

/**
 * Réglages des alertes de l'Agent Ads (`Setting` `agents.ads.alerts`) : lecture pour tous, formulaire pour les
 * administrateurs (`AuditLog` avant / après). Les interrupteurs restent dans Réglages → Alertes.
 */
export function AdsAlertsForm({
  settings,
  isAdmin,
  from,
}: {
  settings: AdsAlertSettingsValues;
  isAdmin: boolean;
  from: string;
}) {
  return (
    <form action={saveAdsAlertSettingsAction} className="space-y-4">
      <input type="hidden" name="from" value={from} />
      <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4" disabled={!isAdmin}>
        <legend className="px-1 text-body font-medium text-foreground">Alertes sur les campagnes</legend>
        <div className="grid gap-4 md:grid-cols-2">
          {ADS_ALERT_FIELDS.map((f) => {
            const id = `ads-alerts-${f.key}`;
            return (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={id}>{f.label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={id}
                    name={alertField(f.key)}
                    inputMode="decimal"
                    defaultValue={String(settings[f.key]).replace(".", ",")}
                    required
                    aria-describedby={`${id}-hint`}
                    className="max-w-32"
                  />
                  <span className="text-note text-muted-foreground">{f.unit}</span>
                </div>
                <p id={`${id}-hint`} className="text-note text-muted-foreground">
                  {f.hint}
                </p>
              </div>
            );
          })}
        </div>
      </fieldset>
      {isAdmin ? (
        <Button type="submit" variant="outline" className="max-md:h-10">
          Enregistrer les réglages des alertes
        </Button>
      ) : (
        <p className="text-note text-muted-foreground">Seuls les administrateurs peuvent changer ces réglages.</p>
      )}
    </form>
  );
}
