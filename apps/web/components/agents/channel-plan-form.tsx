import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { saveChannelPlanAction } from "@/app/(admin)/agents/[equipe]/actions";
import { CASINO_DEFAULT_MIX, themeHashtags, type CasinoTheme } from "@/lib/agents/casino";
import { DATING_DEFAULT_MIX } from "@/lib/agents/dating";
import { valueText } from "@/lib/agents/algo/recommendations";
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
  weightedThemes: [] as Array<{ theme: string; weight: number }>,
  suggestedWindows: [] as unknown[],
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
  casinoThemes,
}: {
  team: TeamKey;
  channel: ChannelPlanRow;
  personas: Array<{ id: string; name: string; isActive: boolean }>;
  campaigns: Array<{ id: string; name: string }>;
  /** Rencontres (phase 20) : un plan activé exige sa persona ; mélange par défaut 1 vidéo, 2 photos, 1 texte. */
  personaRequired?: boolean;
  /**
   * Casino (phase 22) : thèmes de l'équipe, cochés avec un poids pour ce canal (à la place des sujets libres) ;
   * mélange par défaut 2 vidéos, 1 image, 1 texte ; fenêtres conseillées par l'équipe Algorithme affichées.
   */
  casinoThemes?: CasinoTheme[];
}) {
  const isCasino = Boolean(casinoThemes);
  const p =
    channel.plan ??
    (personaRequired
      ? { ...DEFAULT_PLAN, mix: { ...DATING_DEFAULT_MIX } }
      : isCasino
        ? { ...DEFAULT_PLAN, mix: { ...CASINO_DEFAULT_MIX } }
        : DEFAULT_PLAN);
  const windows = p.suggestedWindows.length
    ? valueText("suggestedWindows", p.suggestedWindows)
    : null;
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
          {p.postsPerDay} post{p.postsPerDay > 1 ? "s" : ""} par jour, de {p.windowStart} à{" "}
          {p.windowEnd}
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
            <Input
              id={id("posts")}
              name="postsPerDay"
              type="number"
              min={0}
              max={24}
              required
              defaultValue={p.postsPerDay}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("start")}>Début de la fenêtre</Label>
            <Input
              id={id("start")}
              name="windowStart"
              type="time"
              required
              defaultValue={p.windowStart}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("end")}>Fin de la fenêtre</Label>
            <Input
              id={id("end")}
              name="windowEnd"
              type="time"
              required
              defaultValue={p.windowEnd}
            />
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
            Avec cet espacement, tous les posts du jour ne tiennent pas dans la fenêtre : le Grand
            Chef en créera moins.
          </p>
        ) : null}
        <fieldset className="space-y-2">
          <legend className="text-body font-medium text-foreground">
            Mélange de la journée (parts)
          </legend>
          <p className="text-note text-muted-foreground">
            {personaRequired
              ? "Par exemple 3 photos pour 1 texte par jour. Sans fichier du personnage ou plafond atteint, une photo devient un texte."
              : isCasino
                ? "Par exemple 2 vidéos, 1 image et 1 texte par jour. Seulement vos vidéos et images : sans vidéo neuve du bon thème, l'équipe prend un autre thème du canal, puis une image, puis un texte."
                : "Par exemple 2 photos pour 1 texte. Une vidéo ou une photo n'est utilisée que si la médiathèque en a."}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                // Rencontres : plus de vidéos IA depuis le 29 octobre 2026.
                ...(team === "dating" ? [] : ([["video", "Vidéo"]] as const)),
                ["photo", isCasino ? "Image" : "Photo"],
                ["text", "Texte"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={id(`mix-${k}`)}>{label}</Label>
                <Input
                  id={id(`mix-${k}`)}
                  name={`mix_${k}`}
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={p.mix[k]}
                />
              </div>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={id("persona")}>
              {personaRequired ? "Persona du canal (obligatoire)" : "Persona (ton du canal)"}
            </Label>
            <NativeSelect
              id={id("persona")}
              name="personaId"
              defaultValue={p.personaId ?? ""}
              wrapperClassName="w-full"
            >
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
            <NativeSelect
              id={id("campaign")}
              name="campaignId"
              defaultValue={p.campaignId ?? ""}
              wrapperClassName="w-full"
            >
              <option value="">Aucun bouton Offre</option>
              {campaigns.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {casinoThemes ? (
          <fieldset className="space-y-2">
            <legend className="text-body font-medium text-foreground">
              Thèmes du canal et leur poids
            </legend>
            <p className="text-note text-muted-foreground">
              Cochez les thèmes de ce canal. Un poids de 2 fait revenir le thème deux fois plus
              souvent qu&apos;un poids de 1.
            </p>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {casinoThemes.map((t) => {
                const current = p.weightedThemes.find((w) => w.theme === t.key);
                return (
                  <li
                    key={t.key}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <label className="flex min-h-9 flex-1 items-center gap-2 text-body">
                      <Checkbox
                        name={`ptheme_${t.key}`}
                        value="on"
                        defaultChecked={Boolean(current)}
                      />
                      <span>
                        {t.label}
                        <span className="block text-note text-muted-foreground">
                          {themeHashtags(t.key)}
                        </span>
                      </span>
                    </label>
                    <Label htmlFor={id(`w-${t.key}`)} className="sr-only">
                      Poids du thème {t.label}
                    </Label>
                    <Input
                      id={id(`w-${t.key}`)}
                      name={`pweight_${t.key}`}
                      type="number"
                      min={1}
                      max={10}
                      defaultValue={current?.weight ?? 1}
                      className="w-16"
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : (
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
        )}
        {isCasino ? (
          <p className="text-note text-muted-foreground">
            Créneaux conseillés par l&apos;équipe Algorithme :{" "}
            <span className="text-foreground">
              {windows ?? "pas encore assez de posts pour en conseiller"}
            </span>
            .{windows ? " Ils passent avant la fenêtre ci-dessus quand l'équipe en a." : ""}
          </p>
        ) : null}
        <Button type="submit" variant="outline" className="max-md:h-10">
          Enregistrer le plan
        </Button>
      </form>
    </details>
  );
}
