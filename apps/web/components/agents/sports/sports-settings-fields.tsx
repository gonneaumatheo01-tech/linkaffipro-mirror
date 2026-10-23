import { FormSection } from "@/components/admin/form-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runHoursText, type SportsSettings } from "@/lib/agents/sports";
import { fmtNum } from "@/lib/format";

/**
 * Champs « Passages et cotes » du formulaire des réglages de l'équipe Paris sportifs (administrateurs) : heures de
 * passage, écart de cote toléré, délai avant le match (valeurs par défaut des nouvelles catégories et garde-fous de
 * l'équipe), plafond mensuel d'appels de cotes.
 */
export function SportsSettingsFields({
  settings,
  callsThisMonth,
  isAdmin,
}: {
  settings: SportsSettings;
  callsThisMonth: number;
  isAdmin: boolean;
}) {
  const used = `Appels ce mois : ${fmtNum(callsThisMonth)} sur ${fmtNum(settings.maxApiCallsPerMonth)}.`;
  return (
    <FormSection
      title="Passages et cotes"
      description="Quand l'équipe cherche les paris, et les garde-fous de la cote. Un pari ne se programme jamais : il part tout de suite, ou pas du tout."
    >
      {isAdmin ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sportsRunHours">Heures de passage (heure de Paris)</Label>
            <Input
              id="sportsRunHours"
              name="sportsRunHours"
              required
              defaultValue={settings.runHours.join(", ")}
              aria-describedby="sportsRunHours-aide"
            />
            <p id="sportsRunHours-aide" className="text-note text-muted-foreground">
              Heures séparées par des virgules (10, 15, 18 au départ). L&apos;équipe repasse aussi 2 h avant chaque match retenu.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sportsMaxOddsDriftPct">Écart de cote toléré (%)</Label>
            <Input
              id="sportsMaxOddsDriftPct"
              name="sportsMaxOddsDriftPct"
              inputMode="decimal"
              required
              defaultValue={String(settings.maxOddsDriftPct).replace(".", ",")}
              aria-describedby="sportsMaxOddsDriftPct-aide"
            />
            <p id="sportsMaxOddsDriftPct-aide" className="text-note text-muted-foreground">
              La cote est revérifiée juste avant l&apos;envoi : au-delà de cet écart, le pari est écarté (5 % conseillé).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sportsMinMinutesBeforeKickoff">Délai minimal avant le coup d&apos;envoi (minutes)</Label>
            <Input
              id="sportsMinMinutesBeforeKickoff"
              name="sportsMinMinutesBeforeKickoff"
              type="number"
              min={0}
              max={1440}
              required
              defaultValue={settings.minMinutesBeforeKickoff}
              aria-describedby="sportsMinMinutesBeforeKickoff-aide"
            />
            <p id="sportsMinMinutesBeforeKickoff-aide" className="text-note text-muted-foreground">
              Jamais de publication plus près du match (30 conseillé). Chaque catégorie peut être plus prudente.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sportsMaxApiCallsPerMonth">Plafond d&apos;appels de cotes par mois</Label>
            <Input
              id="sportsMaxApiCallsPerMonth"
              name="sportsMaxApiCallsPerMonth"
              type="number"
              min={0}
              max={1000000}
              required
              defaultValue={settings.maxApiCallsPerMonth}
              aria-describedby="sportsMaxApiCallsPerMonth-aide"
            />
            <p id="sportsMaxApiCallsPerMonth-aide" className="text-note text-muted-foreground">
              {used} Au plafond, l&apos;équipe s&apos;arrête proprement et vous prévient.
            </p>
          </div>
        </div>
      ) : (
        <p className="text-body text-foreground">
          Passages à {runHoursText(settings.runHours)} · écart de cote toléré {String(settings.maxOddsDriftPct).replace(".", ",")} % ·
          au moins {settings.minMinutesBeforeKickoff} min avant le match · {used}{" "}
          <span className="text-note text-muted-foreground">Réservé aux administrateurs.</span>
        </p>
      )}
    </FormSection>
  );
}
