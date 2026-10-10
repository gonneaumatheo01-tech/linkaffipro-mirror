"use client";

import { useId, useState, type Dispatch, type SetStateAction } from "react";
import { CircleAlert, Plus, Search, X } from "lucide-react";
import { SPEND_LEVELS, SPEND_LEVEL_LABELS, type Segment } from "@linkaffipro/core";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CRITERIA,
  GROUP_QUESTIONS,
  GROUP_STATUSES,
  INACTIVE_DAY_CHOICES,
  SPEND_LEVEL_HINTS,
  openCriteria,
  pendingCriteria,
  splitTags,
  toggleValue,
  withInactiveDays,
  withoutCriterion,
  type CriterionKey,
  type ListCriterionKey,
} from "@/lib/broadcasts/group";
import { languageName } from "@/lib/members/filters";
import { statusLabel } from "@/lib/status-badges";

/** Choix proposés pour chaque critère (lecture faite par la page). */
export type GroupOptions = {
  channels: Array<{ id: string; title: string; vertical?: string | null }>;
  campaigns: Array<{ id: string; name: string; vertical?: string | null }>;
  inviteLinks: Array<{ id: string; label: string; campaignName?: string | null }>;
  categories: Array<{ id: string; name: string }>;
  languages: Array<{ code: string; count: number }>;
  tags: Array<{ name: string }>;
};

type Choice = { value: string; label: string; hint?: string; universe?: string | null };

/** Au-delà de ce nombre de choix, une recherche s'affiche au-dessus des cases. */
const SEARCH_FROM = 10;

/** Cases à cocher en pastilles (un mot par case), avec recherche quand la liste est longue. */
function ChoiceChips({
  label,
  choices,
  selected,
  onToggle,
}: {
  label: string;
  choices: Choice[];
  selected: string[];
  onToggle: (value: string, on: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const q = query.trim().toLowerCase();
  const shown = q
    ? choices.filter(
        (c) => selected.includes(c.value) || `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(q),
      )
    : choices;
  return (
    <div className="space-y-2">
      {choices.length > SEARCH_FROM ? (
        <div className="relative sm:max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            type="search"
            aria-label={`Rechercher : ${label}`}
            placeholder="Rechercher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
      ) : null}
      <div
        role="group"
        aria-label={label}
        className={cn(
          "flex flex-wrap gap-2",
          choices.length > 24 && "max-h-64 overflow-y-auto p-0.5",
        )}
      >
        {shown.map((c) => {
          const checked = selected.includes(c.value);
          return (
            <label
              key={c.value}
              className={cn(
                "inline-flex min-h-9 max-w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-body max-md:min-h-10",
                checked
                  ? "border-brand bg-brand-soft text-foreground"
                  : "border-border bg-surface hover:bg-muted",
              )}
            >
              <Checkbox checked={checked} onCheckedChange={(v) => onToggle(c.value, v === true)} />
              {c.universe !== undefined ? <UniverseDot universe={c.universe} /> : null}
              <span className="min-w-0">
                <span className="break-words">{c.label}</span>
                {c.hint ? (
                  <span className="ml-1 text-note text-muted-foreground">· {c.hint}</span>
                ) : null}
              </span>
            </label>
          );
        })}
        {shown.length === 0 ? (
          <p className="text-body text-muted-foreground">Aucun résultat pour « {query} ».</p>
        ) : null}
      </div>
    </div>
  );
}

function choicesFor(key: ListCriterionKey, o: GroupOptions, segment: Segment): Choice[] {
  // Une valeur déjà choisie (reprise de la liste des membres) reste visible même si elle n'est plus proposée.
  const withSelected = (list: Choice[]): Choice[] => {
    const extra = ((segment[key] as string[] | undefined) ?? [])
      .filter((v) => !list.some((c) => c.value === v))
      .map((v) => ({ value: v, label: key === "languages" ? languageName(v) || v : v }));
    return [...list, ...extra];
  };
  switch (key) {
    case "channelIds":
      return withSelected(
        o.channels.map((c) => ({ value: c.id, label: c.title, universe: c.vertical ?? null })),
      );
    case "campaignIds":
      return withSelected(
        o.campaigns.map((c) => ({ value: c.id, label: c.name, universe: c.vertical ?? null })),
      );
    case "inviteLinkIds":
      return withSelected(
        o.inviteLinks.map((l) => ({
          value: l.id,
          label: l.label,
          hint: l.campaignName ?? undefined,
        })),
      );
    case "clickedCategoryIds":
      return withSelected(o.categories.map((c) => ({ value: c.id, label: c.name })));
    case "spendLevels":
      return SPEND_LEVELS.map((l) => ({
        value: l,
        label: SPEND_LEVEL_LABELS[l],
        hint: SPEND_LEVEL_HINTS[l],
      }));
    case "membershipStatuses":
      return GROUP_STATUSES.map((s) => ({ value: s, label: statusLabel("membership", s) }));
    case "languages":
      return withSelected(
        o.languages.map((l) => ({ value: l.code, label: languageName(l.code) || l.code })),
      );
    case "tags":
      return withSelected(o.tags.map((t) => ({ value: t.name, label: t.name })));
  }
}

/** Un critère est proposé seulement s'il a des choix (pas de « + Catégorie » sans catégorie). */
function available(key: CriterionKey, o: GroupOptions): boolean {
  if (key === "channelIds") return o.channels.length > 0;
  if (key === "campaignIds") return o.campaigns.length > 0;
  if (key === "inviteLinkIds") return o.inviteLinks.length > 0;
  if (key === "clickedCategoryIds") return o.categories.length > 0;
  return true;
}

/**
 * Étape « Qui » : le groupe de membres en langage courant. Les critères choisis s'affichent en blocs (avec une croix
 * pour les retirer) ; les autres s'ajoutent en un clic, rangés par question. Sans critère : tous les membres
 * joignables par le bot. Le groupe reste un `Segment` (mêmes règles de ciblage qu'avant).
 * Un bloc ajouté mais encore vide ne compte pas : il le dit, et l'assistant refuse de continuer tant qu'il est là
 * (`added` est tenu par l'assistant pour cette vérification).
 */
export function GroupBuilder({
  options,
  segment,
  setSegment,
  added,
  setAdded,
}: {
  options: GroupOptions;
  segment: Segment;
  setSegment: (s: Segment) => void;
  /** Critères ajoutés (encore vides ou non) : avec ceux qui ont une valeur, ce sont les blocs affichés. */
  added: CriterionKey[];
  setAdded: Dispatch<SetStateAction<CriterionKey[]>>;
}) {
  const open = openCriteria(added, segment);
  const pending = pendingCriteria(open, segment);
  const [customLanguages, setCustomLanguages] = useState("");
  const [customTags, setCustomTags] = useState((segment.tags ?? []).join(", "));

  function remove(key: CriterionKey) {
    setAdded((a) => a.filter((k) => k !== key));
    setSegment(withoutCriterion(segment, key));
    if (key === "tags") setCustomTags("");
    if (key === "languages") setCustomLanguages("");
  }

  function control(key: CriterionKey) {
    const c = CRITERIA[key];
    if (key === "inactiveDays") {
      const value = segment.inactiveDays ?? 0;
      const choices = [...INACTIVE_DAY_CHOICES] as number[];
      if (value && !choices.includes(value)) choices.push(value);
      choices.sort((a, b) => a - b);
      return (
        <NativeSelect
          id="group-inactive-days"
          aria-label={c.title}
          value={String(value || "")}
          onChange={(e) => setSegment(withInactiveDays(segment, Number(e.target.value) || null))}
          wrapperClassName="w-full sm:w-60"
        >
          <option value="">Choisir une durée…</option>
          {choices.map((n) => (
            <option key={n} value={n}>
              {n} jour{n > 1 ? "s" : ""}
            </option>
          ))}
        </NativeSelect>
      );
    }
    if (key === "tags" && options.tags.length === 0) {
      return (
        <div className="space-y-1">
          <Input
            id="group-tags"
            aria-label={c.title}
            placeholder="vip, à relancer"
            value={customTags}
            onChange={(e) => {
              setCustomTags(e.target.value);
              const tags = splitTags(`${e.target.value},`);
              setSegment(tags.length ? { ...segment, tags } : withoutCriterion(segment, "tags"));
            }}
          />
          <p className="text-note text-muted-foreground">
            Séparez les étiquettes par des virgules.
          </p>
        </div>
      );
    }
    const choices = choicesFor(key, options, segment);
    const selected = (segment[key] as string[] | undefined) ?? [];
    return (
      <div className="space-y-2">
        <ChoiceChips
          label={c.title}
          choices={choices}
          selected={selected}
          onToggle={(value, on) => setSegment(toggleValue(segment, key, value, on))}
        />
        {key === "languages" ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="group-language-other"
              aria-label="Autre langue (code à deux lettres)"
              placeholder="Autre langue : de, it…"
              value={customLanguages}
              maxLength={12}
              onChange={(e) => setCustomLanguages(e.target.value)}
              className="sm:max-w-56"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!customLanguages.trim()}
              onClick={() => {
                let next = segment;
                for (const code of customLanguages
                  .toLowerCase()
                  .split(/[,\s]+/)
                  .filter(Boolean))
                  next = toggleValue(next, "languages", code, true);
                setSegment(next);
                setCustomLanguages("");
              }}
            >
              Ajouter
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const addable = GROUP_QUESTIONS.map((q) => ({
    ...q,
    keys: q.keys.filter((k) => !open.includes(k) && available(k, options)),
  })).filter((q) => q.keys.length > 0);

  return (
    <div className="space-y-4">
      {open.length === 0 ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-body text-muted-foreground">
          Pour l&apos;instant : tous les membres. Ajoutez un critère pour viser un groupe précis.
        </p>
      ) : (
        <ul className="space-y-3">
          {open.map((key) => {
            const c = CRITERIA[key];
            const empty = pending.includes(key);
            return (
              <li
                key={key}
                className={cn(
                  "rounded-xl border bg-surface p-3 md:p-4",
                  empty ? "border-dashed border-warning/60" : "border-border",
                )}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-body font-semibold text-foreground">{c.title}</h3>
                    <p className="text-note text-muted-foreground">{c.help}</p>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Retirer le critère « ${c.title} »`}
                    title="Retirer ce critère"
                    onClick={() => remove(key)}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
                {control(key)}
                {empty ? (
                  <p className="mt-3 flex items-start gap-1.5 text-note text-warning">
                    <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Pas encore réglé : {c.missing}. Ce critère ne compte pas pour l&apos;instant.
                    </span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {addable.length > 0 ? (
        <div className="space-y-2">
          <p className="text-body font-medium text-foreground">
            {open.length ? "Ajouter un autre critère" : "Ajouter un critère"}
          </p>
          <div className="grid gap-2 md:grid-cols-3">
            {addable.map((q) => (
              <div key={q.title} role="group" aria-label={q.title} className="space-y-1.5">
                <p className="text-note text-muted-foreground">{q.title}</p>
                <div className="flex flex-wrap gap-1.5">
                  {q.keys.map((k) => (
                    <Button
                      key={k}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAdded((a) => [...a, k])}
                    >
                      <Plus aria-hidden />
                      {CRITERIA[k].add}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
