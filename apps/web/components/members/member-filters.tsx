import Link from "next/link";
import { Suspense } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { SPEND_LEVELS, SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { RememberFilters } from "@/components/admin/remember-filters";
import { SidePanel, SidePanelClose } from "@/components/admin/side-panel";
import { UniverseDot } from "@/components/admin/universe-dot";
import { FilterChips } from "@/components/admin/filter-chips";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { fmtNum } from "@/lib/format";
import {
  activeFilterCount,
  activityChips,
  describeMemberFilters,
  FTD_PERIOD_LABELS,
  hiddenFilterFields,
  languageName,
  MEMBER_FTD_PERIODS,
  MEMBER_INACTIVE_CHOICES,
  SORT_LABELS,
  sortLinks,
  universeChips,
  type FilterNames,
  type MemberFilters,
  type MemberSort,
} from "@/lib/members/filters";
import type { MemberFilterOptions } from "@/lib/members/query";
import type { TagDef } from "@/lib/members/tags";
import { statusLabels } from "@/lib/status-badges";
import { UNIVERSES, UNIVERSE_LABELS } from "@/lib/universe";

const STATUS_LABELS = statusLabels("membership");
const FORM_ID = "members-filters";

function Hidden({ entries }: { entries: Array<[string, string]> }) {
  return (
    <>
      {entries.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

/** Un champ du volet de filtres : libellé relié, liste de choix, ligne d'aide facultative. */
function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help ? <p className="text-note text-muted-foreground">{help}</p> : null}
    </div>
  );
}

/**
 * Filtres de la liste des membres, en langage courant :
 * - recherche (prénom, @pseudo, identifiant Telegram) toujours visible ;
 * - « Filtrer » ouvre un volet (plein écran sur téléphone) avec tous les filtres, rangés par question
 *   (« Ce qu'ils ont fait », « D'où ils viennent », « Qui ils sont », puis « Avancé ») ;
 * - sur ordinateur, raccourcis en pastilles (Activité, Univers) ;
 * - filtres actifs en phrases, chacun retirable, avec le nombre de membres et le tri.
 * Les filtres restent dans l'adresse (formulaires GET) et sont mémorisés sur l'appareil (`RememberFilters`).
 */
export function MemberFilterBar({
  filters: f,
  options,
  tags,
  names,
  total,
}: {
  filters: MemberFilters;
  options: MemberFilterOptions;
  tags: TagDef[];
  names: FilterNames;
  total: number;
}) {
  const active = describeMemberFilters(f, names);
  const count = activeFilterCount(f);
  const advancedCount =
    activeFilterCount(f, ["level", "since", "until"]) + (f.sort !== "lastSeen" ? 1 : 0);
  const tagChoices = [
    ...tags.map((t) => t.name),
    ...(f.tag && !tags.some((t) => t.name === f.tag) ? [f.tag] : []),
  ];
  const languages = [
    ...options.languages.map((l) => l.code),
    ...(f.language && !options.languages.some((l) => l.code === f.language) ? [f.language] : []),
  ];
  const inactiveChoices: number[] = [...MEMBER_INACTIVE_CHOICES];
  if (f.inactive && !inactiveChoices.includes(f.inactive)) inactiveChoices.push(f.inactive);

  return (
    <section aria-label="Filtres des membres" className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          method="get"
          role="search"
          className="flex min-w-0 flex-1 basis-64 items-center gap-2"
        >
          <Hidden entries={hiddenFilterFields(f, ["q"])} />
          <Label htmlFor="members-q" className="sr-only">
            Rechercher un membre (nom, @pseudo ou identifiant Telegram)
          </Label>
          {/* `key` : remonte le champ quand l'adresse change (filtres mémorisés rappelés après l'affichage). */}
          <Input
            key={f.q}
            id="members-q"
            name="q"
            type="search"
            defaultValue={f.q}
            placeholder="Nom ou @pseudo"
            className="min-w-0 flex-1"
          />
          {/* Téléphone : la touche « Rechercher » du clavier envoie la recherche ; le champ garde toute la place. */}
          <Button
            type="submit"
            variant="outline"
            size="icon"
            aria-label="Rechercher"
            className="max-md:hidden"
          >
            <Search aria-hidden />
          </Button>
        </form>
        <div className="flex items-center gap-2">
          <SidePanel
            title="Filtrer les membres"
            description="Choisissez qui vous voulez voir ; la liste se met à jour quand vous validez."
            size="lg"
            trigger={
              <Button variant="outline" className="max-md:h-10">
                <SlidersHorizontal aria-hidden />
                Filtrer
                {count > 0 ? (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-soft px-1.5 text-note font-semibold text-brand-ink tabular-nums">
                    <span className="sr-only"> (filtres actifs : </span>
                    {count}
                    <span className="sr-only">)</span>
                  </span>
                ) : null}
              </Button>
            }
            footer={
              <>
                <SidePanelClose>Annuler</SidePanelClose>
                <Button type="submit" form={FORM_ID} className="max-md:h-10">
                  Voir les membres
                </Button>
              </>
            }
          >
            <form id={FORM_ID} method="get" className="space-y-8">
              <Hidden entries={f.q ? [["q", f.q]] : []} />
              <FormSection
                id="members-filters-done"
                title="Ce qu'ils ont fait"
                description="Dépôts et activité récente."
              >
                <label className="flex min-h-10 items-center gap-3 text-body">
                  <Checkbox name="deposited" value="1" defaultChecked={f.deposited} />
                  Ont déposé au moins une fois
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="mf-ftd" label="Premier dépôt">
                    <NativeSelect
                      id="mf-ftd"
                      name="ftd"
                      defaultValue={f.ftd}
                      wrapperClassName="w-full"
                    >
                      <option value="">Peu importe</option>
                      {MEMBER_FTD_PERIODS.map((p) => (
                        <option key={p} value={p}>
                          {FTD_PERIOD_LABELS[p]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="mf-inactive" label="Activité">
                    <NativeSelect
                      id="mf-inactive"
                      name="inactive"
                      defaultValue={f.inactive === "" ? "" : String(f.inactive)}
                      wrapperClassName="w-full"
                    >
                      <option value="">Peu importe</option>
                      {inactiveChoices.map((n) => (
                        <option key={n} value={n}>
                          Rien fait depuis {n} jours
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
              </FormSection>

              <FormSection
                id="members-filters-from"
                title="D'où ils viennent"
                description="La campagne, la pub, l'univers ou le canal par lesquels ils sont arrivés."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="mf-campaign" label="Campagne">
                    <NativeSelect
                      id="mf-campaign"
                      name="campaignId"
                      defaultValue={f.campaignId}
                      wrapperClassName="w-full"
                    >
                      <option value="">Toutes les campagnes</option>
                      {options.campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="mf-ad" label="Pub">
                    <NativeSelect
                      id="mf-ad"
                      name="inviteLinkId"
                      defaultValue={f.inviteLinkId}
                      wrapperClassName="w-full"
                    >
                      <option value="">Toutes les pubs</option>
                      {options.inviteLinks.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.campaignName ? `${l.label} — ${l.campaignName}` : l.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="mf-universe" label="Univers">
                    <NativeSelect
                      id="mf-universe"
                      name="universe"
                      defaultValue={f.universe}
                      wrapperClassName="w-full"
                    >
                      <option value="">Tous les univers</option>
                      {UNIVERSES.map((u) => (
                        <option key={u} value={u}>
                          {UNIVERSE_LABELS[u]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="mf-channel" label="Canal">
                    <NativeSelect
                      id="mf-channel"
                      name="channelId"
                      defaultValue={f.channelId}
                      wrapperClassName="w-full"
                    >
                      <option value="">Tous les canaux</option>
                      {options.channels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
              </FormSection>

              <FormSection
                id="members-filters-who"
                title="Qui ils sont"
                description="Où en est leur demande, vos étiquettes, leur langue."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="mf-status" label="Statut">
                    <NativeSelect
                      id="mf-status"
                      name="status"
                      defaultValue={f.status}
                      wrapperClassName="w-full"
                    >
                      <option value="">Tous les statuts</option>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="mf-tag" label="Étiquette">
                    <NativeSelect
                      id="mf-tag"
                      name="tag"
                      defaultValue={f.tag}
                      wrapperClassName="w-full"
                    >
                      <option value="">Toutes les étiquettes</option>
                      {tagChoices.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="mf-language" label="Langue">
                    <NativeSelect
                      id="mf-language"
                      name="language"
                      defaultValue={f.language}
                      wrapperClassName="w-full"
                    >
                      <option value="">Toutes les langues</option>
                      {languages.map((code) => (
                        <option key={code} value={code}>
                          {languageName(code)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
              </FormSection>

              <AdvancedSection
                description="Niveau de dépense, dates d'arrivée, ordre de la liste."
                modifiedCount={advancedCount}
                defaultOpen={advancedCount > 0}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id="mf-level"
                    label="Niveau de dépense"
                    help="Calculé d'après les dépôts (seuils dans Réglages → Connexions)."
                  >
                    <NativeSelect
                      id="mf-level"
                      name="level"
                      defaultValue={f.level}
                      wrapperClassName="w-full"
                    >
                      <option value="">Tous les niveaux</option>
                      {SPEND_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {SPEND_LEVEL_LABELS[l]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="mf-sort" label="Ordre de la liste">
                    <NativeSelect
                      id="mf-sort"
                      name="sort"
                      defaultValue={f.sort}
                      wrapperClassName="w-full"
                    >
                      {(Object.keys(SORT_LABELS) as MemberSort[]).map((s) => (
                        <option key={s} value={s}>
                          {SORT_LABELS[s]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="mf-since" label="Arrivés à partir du">
                    <Input id="mf-since" type="date" name="since" defaultValue={f.since} />
                  </Field>
                  <Field id="mf-until" label="Arrivés jusqu'au">
                    <Input id="mf-until" type="date" name="until" defaultValue={f.until} />
                  </Field>
                </div>
              </AdvancedSection>
            </form>
          </SidePanel>
          <Suspense fallback={null}>
            <RememberFilters
              storageKey="members"
              label="Effacer les filtres"
              className={cn("max-md:h-10", count === 0 && "hidden")}
            />
          </Suspense>
        </div>
      </div>

      <div className="space-y-2 max-md:hidden">
        <FilterChips label="Activité" chips={activityChips(f)} />
        <FilterChips
          label="Univers"
          chips={universeChips(f).map((c) => ({
            key: c.key,
            label: c.label,
            href: c.href,
            selected: c.selected,
            icon: c.universe ? <UniverseDot universe={c.universe} /> : undefined,
          }))}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="text-body font-medium">
            {fmtNum(total)} membre{total > 1 ? "s" : ""}
          </p>
          {active.length > 0 ? (
            <ul aria-label="Filtres actifs" className="flex min-w-0 flex-wrap items-center gap-1.5">
              {active.map((a) => (
                <li key={a.key} className="min-w-0">
                  <Link
                    href={a.removeHref}
                    aria-label={`Retirer le filtre : ${a.label}`}
                    className={cn(
                      "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface pr-2 pl-3 text-note font-medium text-foreground transition-colors hover:bg-muted max-md:h-10",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    )}
                  >
                    <span className="truncate">{a.label}</span>
                    <X aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <nav
          aria-label="Ordre de la liste"
          className="text-note text-muted-foreground max-md:hidden"
        >
          Trier par :{" "}
          {sortLinks(f).map((s, i) => (
            <span key={s.sort}>
              {i > 0 ? " · " : null}
              <Link
                href={s.href}
                aria-current={s.current ? "true" : undefined}
                className={cn(
                  "underline-offset-4 hover:underline",
                  s.current && "font-semibold text-foreground underline",
                )}
              >
                {s.label.toLocaleLowerCase("fr")}
              </Link>
            </span>
          ))}
        </nav>
      </div>
    </section>
  );
}
