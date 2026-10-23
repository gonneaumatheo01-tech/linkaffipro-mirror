import { setAutonomyLevelAction } from "@/app/(admin)/agents/actions";
import { saveAlgoSettingsAction } from "@/app/(admin)/agents/[equipe]/algo-actions";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ALGO_FREQUENCIES, ALGO_LEVELS, ALGO_LIMITS, type AlgoSettings } from "@/lib/agents/algo/settings";
import { canSetLevel } from "@/lib/agents/teams";

/** Niveau de l'équipe Algorithme : quels réglages partent seuls. Niveau 2 : administrateurs, avec confirmation. */
export function AlgoLevelPicker({ level, role }: { level: number; role: string }) {
  return (
    <ul className="space-y-2" aria-label="Niveau de l'équipe Algorithme">
      {ALGO_LEVELS.map((l) => {
        const current = l.value === level;
        const allowed = canSetLevel(role, l.value);
        return (
          <li
            key={l.value}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2",
              current ? "border-brand bg-brand-soft/40" : "border-border",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-foreground">
                {l.label}
                {current ? <span className="text-note font-normal text-muted-foreground"> (actuel)</span> : null}
              </p>
              <p className="text-note text-muted-foreground">{l.sentence}</p>
            </div>
            {current ? null : allowed ? (
              <form action={setAutonomyLevelAction}>
                <input type="hidden" name="team" value="algo" />
                <input type="hidden" name="from" value="/agents/algo" />
                <input type="hidden" name="level" value={l.value} />
                {l.value === 2 ? (
                  <ConfirmSubmit
                    variant="outline"
                    size="sm"
                    className="max-md:h-10"
                    confirmTitle="Tout appliquer dans les bornes ?"
                    confirmLabel="Passer au niveau 2"
                    message="Les réglages de persona et les quotas s'appliqueront aussi sans vous demander, toujours dans les bornes et annulables en un clic. Vous recevrez le rapport de la semaine."
                  >
                    Choisir
                  </ConfirmSubmit>
                ) : (
                  <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                    Choisir
                  </Button>
                )}
              </form>
            ) : (
              <span className="text-note text-muted-foreground">Réservé aux administrateurs</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NumberField({
  name,
  label,
  help,
  value,
  disabled,
}: {
  name: keyof typeof ALGO_LIMITS;
  label: string;
  help: string;
  value: number;
  disabled: boolean;
}) {
  const [min, max] = ALGO_LIMITS[name];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`algo-${name}`}>{label}</Label>
      <Input
        id={`algo-${name}`}
        name={name}
        type="number"
        min={min}
        max={max}
        defaultValue={value}
        disabled={disabled}
        aria-describedby={`algo-${name}-aide`}
      />
      <p id={`algo-${name}-aide`} className="text-note text-muted-foreground">
        {help}
      </p>
    </div>
  );
}

/** Seuils de données, bornes des réglages et fréquence (administrateurs ; lecture seule pour un responsable). */
export function AlgoSettingsForm({ settings, isAdmin, from }: { settings: AlgoSettings; isAdmin: boolean; from: string }) {
  const disabled = !isAdmin;
  return (
    <form action={saveAlgoSettingsAction} id="reglages-algo" className="scroll-mt-24 space-y-6">
      <input type="hidden" name="from" value={from} />
      <FormSection
        title="Assez de données pour conclure"
        description="Sous ces seuils, la page dit « pas encore assez de données » et l'équipe propose plutôt un test A/B."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <NumberField name="minPosts" label="Posts minimum par cas" help="20 conseillé (un type de post, une heure, une persona…)." value={settings.minPosts} disabled={disabled} />
          <NumberField name="minViews" label="Ou vues minimum par cas" help="1 000 conseillé : l'un ou l'autre suffit." value={settings.minViews} disabled={disabled} />
          <NumberField name="minConversations" label="Conversations minimum par profil" help="30 conseillé." value={settings.minConversations} disabled={disabled} />
        </div>
      </FormSection>
      <FormSection
        title="Bornes des réglages"
        description="Aucun réglage, même appliqué seul, ne sort de ces limites. Les règles de contenu et l'identité des personas ne sont jamais touchées."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <NumberField
            name="maxMixPointsPerWeek"
            label="Points de mélange par semaine au maximum"
            help="20 conseillé : la part de vidéo, de photo ou de texte ne bouge pas de plus de 20 points en une semaine."
            value={settings.maxMixPointsPerWeek}
            disabled={disabled}
          />
          <NumberField
            name="maxPostsPerDay"
            label="Posts par jour et par canal au maximum"
            help="6 conseillé : un réglage ne propose jamais plus."
            value={settings.maxPostsPerDay}
            disabled={disabled}
          />
          <div className="space-y-1.5">
            <Label htmlFor="algo-allowedStart">Heures autorisées : début</Label>
            <Input id="algo-allowedStart" name="allowedStart" type="time" defaultValue={settings.allowedStart} disabled={disabled} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="algo-allowedEnd">Heures autorisées : fin</Label>
            <Input
              id="algo-allowedEnd"
              name="allowedEnd"
              type="time"
              defaultValue={settings.allowedEnd}
              disabled={disabled}
              aria-describedby="algo-allowed-aide"
            />
            <p id="algo-allowed-aide" className="text-note text-muted-foreground">
              Heure de Paris : une fenêtre de publication conseillée reste toujours entre ces deux heures.
            </p>
          </div>
        </div>
      </FormSection>
      <FormSection title="Fréquence" description="Quand l'équipe transforme ses mesures en réglages. Les calculs, eux, tournent chaque nuit.">
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="algo-frequency">Réglages et rapport</Label>
          <NativeSelect id="algo-frequency" name="frequency" defaultValue={settings.frequency} disabled={disabled} wrapperClassName="w-full">
            {ALGO_FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </FormSection>
      <div className="border-t border-border pt-6">
        {isAdmin ? (
          <Button type="submit" variant="secondary" className="max-md:h-10">
            Enregistrer les réglages de l&apos;équipe
          </Button>
        ) : (
          <p className="text-note text-muted-foreground">Ces réglages sont réservés aux administrateurs.</p>
        )}
      </div>
    </form>
  );
}
