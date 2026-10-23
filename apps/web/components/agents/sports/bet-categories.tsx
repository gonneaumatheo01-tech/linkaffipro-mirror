import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { saveBetCategoryAction } from "@/app/(admin)/agents/[equipe]/sports-actions";
import {
  KNOWN_BOOKMAKERS,
  LEAGUE_LABELS,
  SPORTS,
  SPORTS_DEFAULTS,
  bookmakerLabel,
  fmtOdds,
  leagueLabel,
  sportLabel,
} from "@/lib/agents/sports";
import type { BetCategoryView } from "@/lib/agents/sports-queries";

type Choice = { id: string; title?: string; name?: string; isTest?: boolean };

const NEW_CATEGORY: Omit<BetCategoryView, "id" | "key" | "updatedAt"> = {
  name: "",
  sport: "SOCCER",
  marketTypes: [],
  leagues: [],
  bookmakers: ["sportaza"],
  minOdds: 1.5,
  maxOdds: 3.5,
  picksPerDay: 2,
  channelIds: [],
  campaignId: null,
  minMinutesBeforeKickoff: SPORTS_DEFAULTS.minMinutesBeforeKickoff,
  maxOddsDriftPct: SPORTS_DEFAULTS.maxOddsDriftPct,
  active: false,
  sortOrder: 0,
};

const decimal = (v: number) => String(v).replace(".", ",");

/** Formulaire complet d'une catégorie (création si `category.id` est absent). Administrateurs seulement. */
function CategoryForm({
  category,
  channels,
  campaigns,
}: {
  category: Omit<BetCategoryView, "id" | "key" | "updatedAt"> & { id?: string; key?: string };
  channels: Choice[];
  campaigns: Choice[];
}) {
  const p = (k: string) => `cat-${category.id ?? "new"}-${k}`;
  const otherBookmakers = category.bookmakers.filter((b) => !KNOWN_BOOKMAKERS.some((k) => k.key === b));
  return (
    <form action={saveBetCategoryAction} className="space-y-4 border-t border-border px-4 py-4">
      {category.id ? (
        <>
          <input type="hidden" name="id" value={category.id} />
          <input type="hidden" name="key" value={category.key} />
        </>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={p("name")}>Nom de la catégorie</Label>
          <Input id={p("name")} name="name" required maxLength={80} defaultValue={category.name} placeholder="Tirs cadrés" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p("sport")}>Sport</Label>
          <NativeSelect id={p("sport")} name="sport" defaultValue={category.sport} wrapperClassName="w-full">
            {SPORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
            {SPORTS.some((s) => s.value === category.sport) ? null : (
              <option value={category.sport}>{category.sport}</option>
            )}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p("markets")}>Marchés (un identifiant par ligne)</Label>
          <Textarea
            id={p("markets")}
            name="marketTypes"
            required
            className="font-mono"
            defaultValue={category.marketTypes.join("\n")}
            placeholder="shots_onGoal-all-game-ou-over"
            aria-describedby={p("markets-aide")}
          />
          <p id={p("markets-aide")} className="text-note text-muted-foreground">
            Identifiants des marchés chez le{" "}
            <Term term="SportsGameOdds : identifiant « oddID » de chaque marché">fournisseur de cotes</Term>, à confirmer
            avec le fournisseur (ceux de départ sont des suppositions). Une ligne = un marché.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p("leagues")}>Ligues (une par ligne)</Label>
          <Textarea
            id={p("leagues")}
            name="leagues"
            required
            className="font-mono"
            defaultValue={category.leagues.join("\n")}
            placeholder="FR_LIGUE_1"
            aria-describedby={p("leagues-aide")}
          />
          <p id={p("leagues-aide")} className="text-note text-muted-foreground">
            Identifiants du fournisseur, par exemple{" "}
            {Object.entries(LEAGUE_LABELS)
              .slice(0, 5)
              .map(([k, v]) => `${k} (${v})`)
              .join(", ")}
            .
          </p>
        </div>
        <fieldset className="space-y-1.5 md:col-span-2">
          <legend className="text-body font-medium text-foreground">Bookmakers</legend>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {KNOWN_BOOKMAKERS.map((b) => (
              <li key={b.key}>
                <label className="flex min-h-9 items-center gap-2 text-body">
                  <Checkbox name="bookmakers" value={b.key} defaultChecked={category.bookmakers.includes(b.key)} />
                  {b.label}
                </label>
              </li>
            ))}
          </ul>
          <Label htmlFor={p("other-bk")} className="text-note text-muted-foreground">
            Autres bookmakers (noms séparés par des virgules)
          </Label>
          <Input id={p("other-bk")} name="otherBookmakers" defaultValue={otherBookmakers.join(", ")} />
        </fieldset>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={p("min")}>Cote minimale</Label>
            <Input id={p("min")} name="minOdds" inputMode="decimal" required defaultValue={decimal(category.minOdds)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={p("max")}>Cote maximale</Label>
            <Input id={p("max")} name="maxOdds" inputMode="decimal" required defaultValue={decimal(category.maxOdds)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p("picks")}>Paris par jour</Label>
          <Input id={p("picks")} name="picksPerDay" type="number" min={1} max={20} required defaultValue={category.picksPerDay} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p("delay")}>Délai minimal avant le coup d&apos;envoi (minutes)</Label>
          <Input
            id={p("delay")}
            name="minMinutesBeforeKickoff"
            type="number"
            min={0}
            max={1440}
            required
            defaultValue={category.minMinutesBeforeKickoff}
            aria-describedby={p("delay-aide")}
          />
          <p id={p("delay-aide")} className="text-note text-muted-foreground">
            Jamais de publication plus près du match (30 conseillé), ni après le coup d&apos;envoi.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p("drift")}>Écart de cote toléré (%)</Label>
          <Input
            id={p("drift")}
            name="maxOddsDriftPct"
            inputMode="decimal"
            required
            defaultValue={decimal(category.maxOddsDriftPct)}
            aria-describedby={p("drift-aide")}
          />
          <p id={p("drift-aide")} className="text-note text-muted-foreground">
            Si la cote a bougé de plus que cet écart juste avant l&apos;envoi, le pari est écarté (5 % conseillé).
          </p>
        </div>
        <fieldset className="space-y-1.5 md:col-span-2">
          <legend className="text-body font-medium text-foreground">Canaux de destination</legend>
          {channels.length === 0 ? (
            <p className="text-note text-muted-foreground">Aucun canal Paris sportifs : ajoutez-en un dans Canaux.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {channels.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-9 items-center gap-2 text-body">
                    <Checkbox name="channelIds" value={c.id} defaultChecked={category.channelIds.includes(c.id)} />
                    {c.title}
                    {c.isTest ? " (canal Test)" : ""}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-note text-muted-foreground">
            Tant que la simulation est active, tout part sur le canal Test.
          </p>
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor={p("campaign")}>Campagne du bouton Offre</Label>
          <NativeSelect id={p("campaign")} name="campaignId" defaultValue={category.campaignId ?? ""} wrapperClassName="w-full">
            <option value="">Aucune : pas de bouton Offre</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p("order")}>Ordre d&apos;affichage</Label>
          <Input id={p("order")} name="sortOrder" type="number" min={0} max={999} defaultValue={category.sortOrder} />
        </div>
        <label className="flex min-h-9 items-center gap-2 text-body md:col-span-2">
          <Checkbox name="active" defaultChecked={category.active} />
          Active : l&apos;équipe cherche des paris de cette catégorie à chaque passage
        </label>
      </div>
      <Button type="submit" className="max-md:h-10">
        {category.id ? "Enregistrer la catégorie" : "Créer la catégorie"}
      </Button>
    </form>
  );
}

function CategorySummary({ c, channelTitles }: { c: BetCategoryView; channelTitles: Record<string, string> }) {
  const channels = c.channelIds.map((id) => channelTitles[id]).filter(Boolean);
  return (
    <span className="text-note text-muted-foreground">
      {sportLabel(c.sport)} · cote {fmtOdds(c.minOdds)} à {fmtOdds(c.maxOdds)} · {c.picksPerDay} pari
      {c.picksPerDay > 1 ? "s" : ""} par jour · {c.bookmakers.map(bookmakerLabel).join(", ") || "aucun bookmaker"} ·{" "}
      {c.leagues.length} ligue{c.leagues.length > 1 ? "s" : ""}
      {c.leagues.length ? ` (${c.leagues.slice(0, 3).map(leagueLabel).join(", ")}${c.leagues.length > 3 ? "…" : ""})` : ""}
      {channels.length ? ` · ${channels.join(", ")}` : " · aucun canal"}
    </span>
  );
}

/** Catégories de paris : résumé de chacune, formulaire complet replié (administrateurs), nouvelle catégorie. */
export function BetCategories({
  categories,
  channels,
  campaigns,
  isAdmin,
}: {
  categories: BetCategoryView[];
  channels: Array<{ id: string; title: string; isTest: boolean }>;
  campaigns: Array<{ id: string; name: string }>;
  isAdmin: boolean;
}) {
  const channelTitles = Object.fromEntries(channels.map((c) => [c.id, c.title]));
  return (
    <FormSection
      id="categories"
      title="Catégories de paris"
      description="Ce que l'équipe cherche chaque jour (par exemple « tirs cadrés ») : marchés, ligues, bookmakers, fourchette de cote, nombre de paris et canaux. Seules les catégories actives servent."
      className="scroll-mt-24"
    >
      {categories.length === 0 ? (
        <EmptyState title="Aucune catégorie" description="Créez la première catégorie ci-dessous." />
      ) : (
        <ul className="space-y-3">
          {categories.map((c) => (
            <li key={c.id}>
              <details className="group rounded-xl border border-border bg-card">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
                  <span className="font-medium text-foreground">{c.name}</span>
                  {c.active ? <StatusPill tone="success">Active</StatusPill> : <StatusPill tone="muted">Inactive</StatusPill>}
                  <CategorySummary c={c} channelTitles={channelTitles} />
                </summary>
                {isAdmin ? (
                  <CategoryForm category={c} channels={channels} campaigns={campaigns} />
                ) : (
                  <div className="space-y-1 border-t border-border px-4 py-3 text-note text-muted-foreground">
                    <p>Marchés : {c.marketTypes.join(", ") || "aucun"}</p>
                    <p>
                      Délai avant le match : {c.minMinutesBeforeKickoff} min · écart de cote toléré :{" "}
                      {decimal(c.maxOddsDriftPct)} %
                    </p>
                    <p>Modifier une catégorie est réservé aux administrateurs.</p>
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
      {isAdmin ? (
        <details className="group rounded-xl border border-dashed border-border bg-card">
          <summary className="cursor-pointer px-4 py-3 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
            Nouvelle catégorie
          </summary>
          <CategoryForm category={NEW_CATEGORY} channels={channels} campaigns={campaigns} />
        </details>
      ) : null}
    </FormSection>
  );
}
