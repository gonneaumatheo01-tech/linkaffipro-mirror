import { Suspense } from "react";
import { CollapsibleFilters } from "@/components/admin/collapsible-filters";
import { FilterChips } from "@/components/admin/filter-chips";
import { RememberFilters } from "@/components/admin/remember-filters";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  activeInboxFilterCount,
  inboxHref,
  type InboxFilters as Filters,
} from "@/lib/conversations/filters";
import type { InboxOptions } from "@/lib/conversations/inbox";
import { NONE_KEY } from "@/lib/conversations/labels";
import { statusLabels } from "@/lib/status-badges";

const STAGE_OPTIONS = statusLabels("conversationStage");
const STATUS_OPTIONS = statusLabels("conversationStatus");

/**
 * Filtres de la boîte de réception : pastilles « Toutes », « Non lues » (dernier message de la personne, sans
 * réponse), « L'équipe a la main » (avec leur nombre), puis étape, qui répond, source et persona (formulaire GET,
 * replié sur téléphone). Mémorisés sur l'appareil (`RememberFilters`, clé « conversations »). Composant serveur.
 */
export function InboxFilters({
  filters: f,
  options,
  counts,
}: {
  filters: Filters;
  options: InboxOptions;
  counts: { all: number; unread: number; human: number };
}) {
  const quick = !f.unread && f.status !== "HUMAN" ? "all" : f.unread ? "unread" : "human";
  return (
    <div className="mb-4 space-y-3">
      <FilterChips
        label="Afficher"
        chips={[
          {
            key: "all",
            label: "Toutes",
            href: inboxHref(f, { unread: false, status: f.status === "HUMAN" ? "" : f.status }),
            count: counts.all,
            selected: quick === "all",
          },
          {
            key: "unread",
            label: "Non lues",
            href: inboxHref(f, { unread: true }),
            count: counts.unread,
            selected: f.unread,
          },
          {
            key: "human",
            label: "L'équipe a la main",
            href: inboxHref(f, { status: "HUMAN", unread: false }),
            count: counts.human,
            selected: f.status === "HUMAN" && !f.unread,
          },
        ]}
      />
      <CollapsibleFilters activeCount={activeInboxFilterCount(f)}>
        <form method="get" className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          {f.unread ? <input type="hidden" name="unread" value="1" /> : null}
          <div className="min-w-0 space-y-1 sm:w-44">
            <Label htmlFor="inbox-stage" className="text-note text-muted-foreground">
              Étape
            </Label>
            <NativeSelect
              id="inbox-stage"
              name="stage"
              defaultValue={f.stage}
              wrapperClassName="w-full"
            >
              <option value="">Toutes</option>
              {Object.entries(STAGE_OPTIONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-0 space-y-1 sm:w-48">
            <Label htmlFor="inbox-status" className="text-note text-muted-foreground">
              Qui répond
            </Label>
            <NativeSelect
              id="inbox-status"
              name="status"
              defaultValue={f.status}
              wrapperClassName="w-full"
            >
              <option value="">Tous</option>
              {Object.entries(STATUS_OPTIONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-0 space-y-1 sm:w-44">
            <Label htmlFor="inbox-source" className="text-note text-muted-foreground">
              Source
            </Label>
            <NativeSelect
              id="inbox-source"
              name="source"
              defaultValue={f.source}
              wrapperClassName="w-full"
            >
              <option value="">Toutes</option>
              {options.hasNoSource || f.source === NONE_KEY ? (
                <option value={NONE_KEY}>Sans source</option>
              ) : null}
              {options.sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {f.source && f.source !== NONE_KEY && !options.sources.includes(f.source) ? (
                <option value={f.source}>{f.source}</option>
              ) : null}
            </NativeSelect>
          </div>
          <div className="min-w-0 space-y-1 sm:w-48">
            <Label htmlFor="inbox-persona" className="text-note text-muted-foreground">
              Persona
            </Label>
            <NativeSelect
              id="inbox-persona"
              name="persona"
              defaultValue={f.persona}
              wrapperClassName="w-full"
            >
              <option value="">Toutes</option>
              {options.personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {options.hasNoPersona || f.persona === NONE_KEY ? (
                <option value={NONE_KEY}>Sans persona</option>
              ) : null}
            </NativeSelect>
          </div>
          <div className="col-span-2 flex flex-wrap gap-2">
            <Button type="submit" variant="outline" className="max-md:h-10">
              Filtrer
            </Button>
            <Suspense fallback={null}>
              <RememberFilters storageKey="conversations" className="max-md:h-10" />
            </Suspense>
          </div>
        </form>
      </CollapsibleFilters>
    </div>
  );
}
