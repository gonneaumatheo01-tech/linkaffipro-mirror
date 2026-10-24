import type { AdsThresholds } from "@linkaffipro/agents";
import { saveAdsThresholdsAction } from "@/app/(admin)/agents/ads/actions";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ADS_UNIVERSES,
  ADS_UNIVERSE_WORDS,
  fieldValue,
  thresholdField,
  type UniverseThresholds,
} from "@/lib/agents/ads/thresholds";

const FIELDS: Array<{
  key: keyof UniverseThresholds;
  label: string;
  hint: string;
  unit: string;
  step: string;
  optional: boolean;
}> = [
  {
    key: "targetCostPerRegistration",
    label: "Coût par inscription visé",
    hint: "Au-dessus, depuis les jours d'observation : « Arrêter ». Vide = automatique (valeur du milieu de vos pubs).",
    unit: "€",
    step: "0.5",
    optional: true,
  },
  {
    key: "minRoas",
    label: "Retour sur dépense pub minimal",
    hint: "Au-dessus (commissions ÷ dépense), budget non épuisé : « Augmenter ». Vide = automatique.",
    unit: "×",
    step: "0.1",
    optional: true,
  },
  {
    key: "observationDays",
    label: "Jours d'observation",
    hint: "Une pub plus jeune est seulement « à surveiller ».",
    unit: "jours",
    step: "1",
    optional: false,
  },
  {
    key: "minSpend",
    label: "Dépense minimale par pub",
    hint: "En dessous, l'agent ne conclut rien (« à surveiller »).",
    unit: "€",
    step: "1",
    optional: false,
  },
];

/**
 * Seuils par univers de l'Agent Ads : lecture pour tous, formulaire pour les administrateurs (`AuditLog` à chaque
 * enregistrement). Les seuils ne changent que les conseils : jamais rien chez Meta ou TikTok.
 */
export function AdsThresholdsForm({
  thresholds,
  isAdmin,
  from,
}: {
  thresholds: AdsThresholds;
  isAdmin: boolean;
  from: string;
}) {
  return (
    <form action={saveAdsThresholdsAction} className="space-y-4">
      <input type="hidden" name="from" value={from} />
      <div className="grid gap-4 lg:grid-cols-3">
        {ADS_UNIVERSES.map((u) => (
          <fieldset key={u} className="space-y-3 rounded-xl border border-border bg-card p-4" disabled={!isAdmin}>
            <legend className="px-1">
              <UniverseDot universe={u} withLabel label={ADS_UNIVERSE_WORDS[u]} />
            </legend>
            {FIELDS.map((f) => {
              const id = `ads-${u}-${f.key}`;
              const v = thresholds[u][f.key];
              return (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={id}>{f.label}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      name={thresholdField(u, f.key)}
                      inputMode="decimal"
                      defaultValue={fieldValue(v)}
                      placeholder={f.optional ? "Automatique" : undefined}
                      required={!f.optional}
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
          </fieldset>
        ))}
      </div>
      {isAdmin ? (
        <Button type="submit" className="max-md:h-10">
          Enregistrer les seuils
        </Button>
      ) : (
        <p className="text-note text-muted-foreground">Seuls les administrateurs peuvent changer les seuils.</p>
      )}
    </form>
  );
}
