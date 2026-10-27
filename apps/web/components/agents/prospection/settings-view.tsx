import { saveProspectionSettingsAction } from "@/app/(admin)/agents/prospection/actions";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { countryName } from "@/lib/agents/analyses";
import { BOOL_FIELDS, NUMBER_FIELDS, VERTICAL_CHOICES, WEIGHT_FIELDS, type NumberField, type ProspectionSettings } from "@/lib/agents/prospection/settings";
import { DEFAULT_COUNTRIES_SCOPE } from "@linkaffipro/agents";

const GROUPS: Array<{ key: NumberField["group"]; title: string }> = [
  { key: "liste", title: "Liste du matin" },
  { key: "lecture", title: "Ce qui compte comme un canal actif" },
  { key: "niveaux", title: "Niveaux" },
  { key: "rappels", title: "Rappels" },
  { key: "plafonds", title: "Plafonds" },
];

const CHECK = "size-4";

/** Vue « Réglages » (administrateurs) : un seul formulaire, enregistré en une fois et noté dans le journal. */
export function ProspectionSettingsView({ settings, isAdmin }: { settings: ProspectionSettings; isAdmin: boolean }) {
  if (!isAdmin) return <p className="text-body text-muted-foreground">Les réglages de la prospection sont réservés aux administrateurs.</p>;
  const scope = new Set(settings.countriesScope);
  const extra = settings.countriesScope.filter((c) => !(DEFAULT_COUNTRIES_SCOPE as readonly string[]).includes(c));
  return (
    <form id="reglages" action={saveProspectionSettingsAction} className="space-y-6">
      <input type="hidden" name="withBools" value="on" />
      <FormSection title="Général">
        <div className="space-y-3">
          {BOOL_FIELDS.map((f) => (
            <div key={f.name} className="flex items-start gap-2">
              <input type="checkbox" id={`ps-${f.name}`} name={f.name} defaultChecked={settings.bools[f.name]} className={`${CHECK} mt-1`} />
              <div>
                <Label htmlFor={`ps-${f.name}`}>{f.label}</Label>
                <p className="text-note text-muted-foreground">{f.hint}</p>
              </div>
            </div>
          ))}
          <fieldset className="space-y-1">
            <legend className="text-body font-medium">Marchés cherchés</legend>
            <div className="flex flex-wrap gap-4">
              {VERTICAL_CHOICES.map((v) => (
                <div key={v.value} className="flex items-center gap-2">
                  <input type="checkbox" id={`ps-v-${v.value}`} name="verticals" value={v.value} defaultChecked={settings.verticals.includes(v.value)} className={CHECK} />
                  <Label htmlFor={`ps-v-${v.value}`}>{v.label}</Label>
                </div>
              ))}
            </div>
          </fieldset>
        </div>
      </FormSection>

      <FormSection title="Pays cherchés" description="Un canal dont l'audience est hors de ces pays n'apparaît jamais. Par défaut : l'Union européenne, le Royaume-Uni, la Suisse, la Norvège et l'Islande.">
        <fieldset>
          <legend className="sr-only">Pays cherchés</legend>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {DEFAULT_COUNTRIES_SCOPE.map((c) => (
              <div key={c} className="flex items-center gap-2">
                <input type="checkbox" id={`ps-c-${c}`} name="countries" value={c} defaultChecked={scope.has(c)} className={CHECK} />
                <Label htmlFor={`ps-c-${c}`}>{countryName(c)}</Label>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="mt-3 space-y-1">
          <Label htmlFor="ps-extra">Autres pays (codes de deux lettres)</Label>
          <Input id="ps-extra" name="countries" defaultValue={extra.join(", ")} placeholder="TR, UA" className="sm:max-w-80" />
        </div>
      </FormSection>

      {GROUPS.map((g) => (
        <FormSection key={g.key} title={g.title}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {NUMBER_FIELDS.filter((f) => f.group === g.key).map((f) => (
              <div key={f.name} className="space-y-1">
                <Label htmlFor={`ps-${f.name}`}>
                  {f.label}
                  {f.unit ? ` (${f.unit})` : ""}
                </Label>
                <Input id={`ps-${f.name}`} name={f.name} inputMode="decimal" required defaultValue={String(settings.numbers[f.name] ?? "")} />
                <p className="text-note text-muted-foreground">
                  {f.hint} De {f.min} à {f.max}.
                </p>
              </div>
            ))}
          </div>
        </FormSection>
      ))}

      <FormSection title="Poids de la note" description="La note sur 100 est la somme de ces parts (plus d'éventuelles pénalités). Les poids doivent faire 100 au total.">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {WEIGHT_FIELDS.map((w) => (
            <div key={w.name} className="space-y-1">
              <Label htmlFor={`ps-w-${w.name}`}>{w.label}</Label>
              <Input id={`ps-w-${w.name}`} name={`weight_${w.name}`} inputMode="numeric" required defaultValue={String(settings.weights[w.name])} />
            </div>
          ))}
        </div>
      </FormSection>

      <Button type="submit" className="max-md:h-10">
        Enregistrer les réglages
      </Button>
    </form>
  );
}
