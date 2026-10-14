"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GripVertical,
  Pencil,
  Plus,
  Route,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { EmptyState } from "@/components/admin/empty-state";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { EntryFormState, GateChannelChoice } from "@/lib/channels/entry-rule";
import {
  EXCEPTIONS_HELP,
  conditionText,
  dropOrder,
  exceptionMessageNote,
  exceptionSentence,
  groupByLevel,
  moveWithinLevel,
  provenanceKey,
  provenanceMenu,
  shadowNote,
  suggestedProvenance,
  whenShort,
  type AffiliateLinkOption,
  type ExceptionItem,
  type ExceptionScope,
  type NameMaps,
} from "@/lib/channels/exceptions";
import { ExceptionPanel, type ExceptionFormResult, type KnownChannel } from "./exception-form";

type ActionResult = { ok?: string; error?: string };

/** Dessin de l'interrupteur (l'état est porté par `aria-pressed` du bouton, et écrit à côté). */
function Track({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        on ? "border-brand bg-brand" : "border-muted-foreground/75 bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute size-3.5 rounded-full shadow-xs transition-transform",
          on ? "translate-x-[1.125rem] bg-night" : "translate-x-0.5 bg-muted-foreground",
        )}
      />
    </span>
  );
}

/** Partie de la phrase qui ressemble à un menu (« [de « Tir Cadré » ▾] ») : un clic ouvre le volet de l'exception. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-muted-foreground/75 bg-surface px-2 py-0.5 font-medium text-foreground">
      {children}
      <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </span>
  );
}

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

/**
 * « Exceptions selon la provenance » (fiche canal → « Qui peut entrer et quand ») : une ligne par exception, en
 * français (« Si la personne vient [de « Tir Cadré » ▾] → [après 1 jour ▾] »), sa phrase de résumé, l'avertissement
 * « jamais utilisée », l'interrupteur, « Modifier » (volet), l'ordre (glisser, ou « Monter » / « Descendre » au
 * clavier, dans le même groupe seulement) et « Supprimer » (administrateurs). « + Ajouter une exception » ouvre le
 * volet d'une nouvelle exception.
 */
export function ExceptionList({
  channelId,
  items,
  names,
  canDelete,
  menuInput,
  baseState,
  activeChannels,
  knownChannels,
  gateViews,
  gateWarnings,
  saveAction,
  toggleAction,
  moveAction,
  reorderAction,
  deleteAction,
}: {
  channelId: string;
  items: ExceptionItem[];
  names: NameMaps;
  /** Suppression réservée aux administrateurs (un responsable peut désactiver). */
  canDelete: boolean;
  menuInput: {
    channels: Array<{ id: string; title: string; isActive: boolean }>;
    links: Array<{ id: string; name: string; kind: string; isActive: boolean }>;
    senders: string[];
    /** Affiliés Link Affi connus et campagnes d'affiliés du canal (phase 13). */
    affiliates?: Array<{ id: string; name: string }>;
    affiliateLinks?: AffiliateLinkOption[];
  };
  baseState: EntryFormState;
  activeChannels: Array<Omit<GateChannelChoice, "unavailable">>;
  knownChannels: KnownChannel[];
  /** État des liens des canaux à rejoindre de chaque exception (`GateLinksStatus` rendu par le serveur). */
  gateViews: Record<string, React.ReactNode>;
  /** Exceptions dont un lien de canal à rejoindre pose problème (phrase courte). */
  gateWarnings: Record<string, string>;
  saveAction: (prev: ExceptionFormResult, formData: FormData) => Promise<ExceptionFormResult>;
  toggleAction: (formData: FormData) => Promise<ActionResult>;
  moveAction: (formData: FormData) => Promise<ActionResult>;
  reorderAction: (formData: FormData) => Promise<ActionResult>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const [shown, setShown] = useOptimistic(items, (_old, next: ExceptionItem[]) => next);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [live, setLive] = useState<{ text: string; error: boolean } | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const focusAfter = useRef<{ id: string; dir: "up" | "down" } | null>(null);

  // Après un enregistrement (exceptions relues par le serveur), le volet ouvert se ferme.
  const signature = items.map((i) => `${i.id}:${i.updatedAt}`).join("|");
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setEditing(null);
  }

  // « Monter » / « Descendre » : le focus reste sur la flèche de l'exception déplacée (l'autre si elle est au bout).
  useEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    const same = buttons.current.get(`${f.id}:${f.dir}`);
    const other = buttons.current.get(`${f.id}:${f.dir === "up" ? "down" : "up"}`);
    const target = same && !same.disabled ? same : other;
    if (target && !target.disabled) {
      target.focus();
      focusAfter.current = null;
    }
  }, [shown]);

  const groups = groupByLevel(shown);
  const keys = shown.map((i) => provenanceKey(i)).filter((k): k is string => !!k);
  const newMenu = provenanceMenu({ ...menuInput, channelId, current: null, used: keys });
  const editingItem = editing && editing !== "new" ? shown.find((i) => i.id === editing) : null;
  // Exception supprimée entre-temps : pas de volet (jamais un volet « nouvelle exception » à sa place).
  const panelOpen = editing === "new" || Boolean(editingItem);

  function announce(r: ActionResult) {
    setLive(r.error ? { text: r.error, error: true } : r.ok ? { text: r.ok, error: false } : null);
  }

  function toggle(item: ExceptionItem) {
    startTransition(async () => {
      setShown(shown.map((i) => (i.id === item.id ? { ...i, isActive: !i.isActive } : i)));
      announce(
        await toggleAction(fd({ channelId, ruleId: item.id, active: item.isActive ? "0" : "1" })),
      );
    });
  }

  function reorderLocal(scope: ExceptionScope, ids: string[]): ExceptionItem[] {
    const rank = new Map(ids.map((id, i) => [id, (i + 1) * 10]));
    return shown.map((i) =>
      i.scope === scope ? { ...i, sortOrder: rank.get(i.id) ?? i.sortOrder } : i,
    );
  }

  function move(item: ExceptionItem, dir: "up" | "down") {
    const ids = moveWithinLevel(shown, item.id, dir);
    if (!ids) return;
    focusAfter.current = { id: item.id, dir };
    startTransition(async () => {
      setShown(reorderLocal(item.scope, ids));
      announce(await moveAction(fd({ channelId, ruleId: item.id, direction: dir })));
    });
  }

  function drop(scope: ExceptionScope, overItemId: string) {
    const from = dragId.current;
    dragId.current = null;
    setOverId(null);
    if (!from) return;
    const group = groupByLevel(shown).find((g) => g.scope === scope);
    const ids = group
      ? dropOrder(
          group.items.map((i) => i.id),
          from,
          overItemId,
        )
      : null;
    if (!ids) return;
    startTransition(async () => {
      setShown(reorderLocal(scope, ids));
      announce(await reorderAction(fd({ channelId, scope, ruleIds: ids })));
    });
  }

  return (
    <section aria-labelledby="exceptions-title" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="exceptions-title" className="text-title text-foreground">
            Exceptions selon la provenance
          </h2>
          <p className="mt-0.5 text-note text-muted-foreground">
            Une règle à part pour les personnes venues d&apos;un endroit précis : un de nos canaux,
            une pub, un lien de partage
            {menuInput.affiliates?.length || menuInput.affiliateLinks?.length
              ? ", un affilié Link Affi."
              : "."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="max-md:h-10"
          onClick={() => setEditing("new")}
        >
          <Plus aria-hidden />
          Ajouter une exception
        </Button>
      </div>

      <p
        role="status"
        className={cn(
          "text-note",
          live ? (live.error ? "text-danger" : "text-success") : "sr-only",
        )}
      >
        {live?.text ?? ""}
      </p>

      {shown.length === 0 ? (
        <EmptyState
          icon={<Route />}
          title="Aucune exception"
          description="Tout le monde suit la règle par défaut. Exemple : les personnes venues du bouton « canal à rejoindre » d'un autre de nos canaux acceptées au bout de 1 jour, les autres au bout de 5 minutes."
        />
      ) : (
        <>
          <p className="text-note text-muted-foreground">{EXCEPTIONS_HELP}</p>
          {groups.map((g) => (
            <div key={g.scope} className="space-y-2">
              <h3 className="text-note font-semibold text-muted-foreground">{g.title}</h3>
              <ul className="space-y-2">
                {g.items.map((item, idx) => {
                  const condition = conditionText(item, names);
                  const shadow = shadowNote(shown, item, names);
                  const note = exceptionMessageNote(item);
                  const first = idx === 0;
                  const last = idx === g.items.length - 1;
                  return (
                    <li
                      key={item.id}
                      onDragOver={(e) => {
                        const from = shown.find((i) => i.id === dragId.current);
                        if (!from || from.scope !== item.scope) return;
                        e.preventDefault();
                        if (overId !== item.id) setOverId(item.id);
                      }}
                      onDragLeave={() => setOverId((o) => (o === item.id ? null : o))}
                      onDrop={(e) => {
                        e.preventDefault();
                        drop(item.scope, item.id);
                      }}
                      onDragEnd={() => {
                        dragId.current = null;
                        setOverId(null);
                      }}
                      className={cn(
                        "rounded-xl border bg-surface p-3 md:p-4",
                        overId === item.id ? "border-brand" : "border-border",
                        !item.isActive && "bg-muted/30",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {g.items.length > 1 ? (
                          // Poignée (souris, ordinateur) : on glisse toute la ligne. Au clavier : « Monter » / « Descendre ».
                          <span
                            aria-hidden
                            draggable
                            title="Glisser pour changer l'ordre"
                            onDragStart={(e) => {
                              dragId.current = item.id;
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", item.id);
                              const row = e.currentTarget.closest("li");
                              if (row) e.dataTransfer.setDragImage(row, 24, 24);
                            }}
                            className="mt-0.5 hidden shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing md:block"
                          >
                            <GripVertical className="size-5" />
                          </span>
                        ) : null}
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => setEditing(item.id)}
                            className="block w-full cursor-pointer text-left text-body leading-7 text-foreground"
                          >
                            Si la personne vient <Chip>{condition}</Chip> →{" "}
                            <Chip>{whenShort(item)}</Chip>
                          </button>
                          <p className="text-note text-muted-foreground">
                            {exceptionSentence(item, names)}
                            {note ? ` ${note}` : ""}
                          </p>
                          {!item.isActive ? (
                            <p className="flex flex-wrap items-center gap-2 text-note text-muted-foreground">
                              <StatusPill tone="muted">Désactivée</StatusPill>
                              Ces personnes suivent la règle par défaut (ou une autre exception).
                            </p>
                          ) : null}
                          {shadow ? (
                            <p className="flex items-start gap-2 text-note text-warning">
                              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                              {shadow}
                            </p>
                          ) : null}
                          {gateWarnings[item.id] ? (
                            <p className="flex items-start gap-2 text-note text-warning">
                              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                              {gateWarnings[item.id]} Ouvrez « Modifier » pour voir la solution.
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border pt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-pressed={item.isActive}
                          onClick={() => toggle(item)}
                          className="max-md:h-10"
                        >
                          <Track on={item.isActive} />
                          <span>{item.isActive ? "Activée" : "Désactivée"}</span>
                          <span className="sr-only"> : exception {condition}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(item.id)}
                          className="max-md:h-10"
                        >
                          <Pencil aria-hidden />
                          Modifier
                          <span className="sr-only"> l&apos;exception {condition}</span>
                        </Button>
                        {g.items.length > 1 ? (
                          <>
                            <Button
                              ref={(el) => {
                                buttons.current.set(`${item.id}:up`, el);
                              }}
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={first}
                              aria-label={`Monter l'exception ${condition}`}
                              title="Monter"
                              onClick={() => move(item, "up")}
                            >
                              <ArrowUp aria-hidden />
                            </Button>
                            <Button
                              ref={(el) => {
                                buttons.current.set(`${item.id}:down`, el);
                              }}
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={last}
                              aria-label={`Descendre l'exception ${condition}`}
                              title="Descendre"
                              onClick={() => move(item, "down")}
                            >
                              <ArrowDown aria-hidden />
                            </Button>
                          </>
                        ) : null}
                        {canDelete ? (
                          <form action={deleteAction} className="ml-auto">
                            <input type="hidden" name="channelId" value={channelId} />
                            <input type="hidden" name="ruleId" value={item.id} />
                            <ConfirmDialog
                              title="Supprimer cette exception ?"
                              description={`Les personnes venues ${condition} suivront la règle par défaut (ou une autre exception). Les demandes déjà planifiées gardent leur date d'acceptation.`}
                              confirmLabel="Supprimer"
                              destructive
                              trigger={
                                <Button
                                  type="submit"
                                  variant="ghost"
                                  size="sm"
                                  className="text-danger max-md:h-10"
                                >
                                  <Trash2 aria-hidden />
                                  Supprimer
                                  <span className="sr-only"> l&apos;exception {condition}</span>
                                </Button>
                              }
                            />
                          </form>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}

      {panelOpen ? (
        <ExceptionPanel
          key={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          channelId={channelId}
          item={editingItem ?? null}
          menu={
            editingItem
              ? provenanceMenu({
                  ...menuInput,
                  channelId,
                  current: provenanceKey(editingItem),
                  used: keys.filter((k) => k !== provenanceKey(editingItem)),
                })
              : newMenu
          }
          suggested={editingItem ? null : suggestedProvenance(newMenu, menuInput.senders)}
          baseState={baseState}
          others={shown.filter((i) => i.id !== editingItem?.id)}
          names={names}
          activeChannels={activeChannels}
          knownChannels={knownChannels}
          action={saveAction}
          gateStatus={editingItem ? gateViews[editingItem.id] : null}
        />
      ) : null}
    </section>
  );
}
