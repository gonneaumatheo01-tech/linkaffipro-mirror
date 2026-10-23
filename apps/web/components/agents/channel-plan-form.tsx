import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { saveChannelPlanAction } from "@/app/(admin)/agents/[equipe]/actions";
import { DATING_DEFAULT_MIX } from "@/lib/agents/dating";
import { planFitsWindow } from "@/lib/agents/forms";
import type { ChannelPlanRow } from "@/lib/agents/queries";
import type { TeamKey } from "@/lib/agents/teams";

const DEFAULT_PLAN = {
  enabled: false,
  postsPerDay: 3,
  windowStart: "09:00",
  windowEnd: "22:00",
  minSpacingMinutes: 90,
  mix: { video: 0, photo: 0, text: 1 },
  personaId: null,
  campaignId: null,
  themes: [] as string[],
};

/**
 * Plan d'un canal (fiche d'équipe) : replié dans un `<details>`, une ligne de résumé (activé ou non, posts par jour,
 * fenêtre), puis le formulaire. Enregistrer n'appelle aucune IA : le Grand Chef relit le plan à son prochain passage.
 */
export function ChannelPlanForm({
  team,
  channel,
  personas,
  campaigns,
  personaRequired = false,
}: {
  team: TeamKey;
  channel: ChannelPlanRow;
  personas: Array<{ id: string; name: string; isActive: boolean }>;
  campaigns: Array<{ id: string; name: string }>;
  /** Rencontres (phase 20) : un plan activé exige sa persona ; mélange par défaut 1 vidéo, 2 photos, 1 texte. */
  personaRequired?: boolean;
}) {
  const p = channel.plan ?? (personaRequired ? { ...DEFAULT_PLAN, mix: { ...DATING_DEFAULT_MIX } } : DEFAULT_PLAN);
  const id = (k: string) => `plan-${channel.id}-${k}`;
  const fits = planFitsWindow(p);
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
        <span className="font-medium text-foreground">{channel.title}</span>
        {channel.isTest ? <StatusPill tone="info">Canal Test</StatusPill> : null}
        {channel.plan?.enabled ? (
          <StatusPill tone="success">Plan activé</StatusPill>
        ) : (
          <StatusPill tone="muted">{channel.plan ? "Plan désactivé" : "Pas de plan"}</StatusPill>
        )}
        <span className="text-note text-muted-foreground">
          {p.postsPerDay} post{p.postsPerDay > 1 ? "s" : ""} par jour, de {p.windowStart} à {p.windowEnd}
        </span>
      </summary>
      <form action={saveChannelPlanAction} className="space-y-4 border-t border-border px-4 py-4">
        <input type="hidden" name="team" value={team} />
        <input type="hidden" name="channelId" value={channel.id} />
        <label className="flex items-start gap-3 text-body">
          <Checkbox name="enabled" value="on" defaultChecked={p.enabled} className="mt-0.5" />
          <span>
            Les agents publient sur ce canal
            <span className="block text-note text-muted-foreground">
              Décoché : le Grand Chef ne crée aucune mission pour ce canal.
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor={id("posts")}>Posts par jour</Label>
            <Input id={id("posts")} name="postsPerDay" type="number" min={0} max={24} required defaultValue={p.postsPerDay} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("start")}>Début de la fenêtre</Label>
            <Input id={id("start")} name="windowStart" type="time" required defaultValue={p.windowStart} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("end")}>Fin de la fenêtre</Label>
            <Input id={id("end")} name="windowEnd" type="time" required defaultValue={p.windowEnd} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("spacing")}>Espacement minimal (minutes)</Label>
            <Input
              id={id("spacing")}
              name="minSpacingMinutes"
              type="number"
              min={0}
              max={1440}
              required
              defaultValue={p.minSpacingMinutes}
            />
          </div>
        </div>
        {!fits ? (
          <p className="text-note text-warning">
            Avec cet espacement, tous les posts du jour ne tiennent pas dans la fenêtre : le Grand Chef en créera moins.
          </p>
        ) : null}
        <fieldset className="space-y-2">
          <legend className="text-body font-medium text-foreground">Mélange de la journée (parts)</legend>
          <p className="text-note text-muted-foreground">
            {personaRequired
              ? "Par exemple 1 vidéo, 2 photos et 1 texte par jour. Sans vidéo source neuve ou plafond atteint, une vidéo devient une photo, puis un texte."
              : "Par exemple 2 photos pour 1 texte. Une vidéo ou une photo n'est utilisée que si la médiathèque en a."}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["video", "Vidéo"],
                ["photo", "Photo"],
                ["text", "Texte"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={id(`mix-${k}`)}>{label}</Label>
                <Input id={id(`mix-${k}`)} name={`mix_${k}`} type="number" min={0} max={100} defaultValue={p.mix[k]} />
              </div>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={id("persona")}>{personaRequired ? "Persona du canal (obligatoire)" : "Persona (ton du canal)"}</Label>
            <NativeSelect id={id("persona")} name="personaId" defaultValue={p.personaId ?? ""} wrapperClassName="w-full">
              <option value="">{personaRequired ? "Choisir une persona…" : "Aucune"}</option>
              {personas.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("campaign")}>Campagne du bouton Offre</Label>
            <NativeSelect id={id("campaign")} name="campaignId" defaultValue={p.campaignId ?? ""} wrapperClassName="w-full">
              <option value="">Aucun bouton Offre</option>
              {campaigns.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("themes")}>Thèmes</Label>
          <Input
            id={id("themes")}
            name="themes"
            defaultValue={p.themes.join(", ")}
            placeholder="Séparés par des virgules : soirée, week-end, conseils"
            aria-describedby={id("themes-aide")}
          />
          <p id={id("themes-aide")} className="text-note text-muted-foreground">
            Facultatif : les sujets que la Rédaction fait tourner.
          </p>
        </div>
        <Button type="submit" variant="outline" className="max-md:h-10">
          Enregistrer le plan
        </Button>
      </form>
    </details>
  );
}
