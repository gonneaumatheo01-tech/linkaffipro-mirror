"use client";

import { CornerDownRight } from "lucide-react";
import type { GraphIssue, GraphNames } from "@linkaffipro/core";
import { cn } from "@/components/ui/cn";
import { outlineDraft, viaLabel, type Draft, type OutlineItem } from "@/lib/automations/flow";
import { NODE_TONES, nodeIcon } from "./nodes";

/**
 * Le parcours en liste (alternative accessible au canevas) : chaque bloc dans l'ordre, branches « Oui » / « Non »
 * indentées, bloc à corriger signalé. `onSelect` : chaque bloc est un bouton qui l'ouvre dans le panneau de réglage ;
 * sans `onSelect`, aperçu en lecture seule (téléphone, fiche).
 */
export function FlowOutline({
  draft,
  names,
  triggerText,
  issues = {},
  selectedId,
  onSelect,
  label = "Blocs du parcours",
  extra,
}: {
  draft: Draft;
  names: GraphNames;
  triggerText: string;
  issues?: Record<string, GraphIssue[]>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  label?: string;
  /** Texte en plus sous un bloc (passages sur la fiche d'une relance). */
  extra?: (id: string) => React.ReactNode;
}) {
  const items = outlineDraft(draft, names);
  const linked = items.filter((i) => !i.detached);
  const detached = items.filter((i) => i.detached);
  const row = (item: OutlineItem) => {
    const node = draft.nodes.find((n) => n.id === item.id);
    const hasError = (issues[item.id] ?? []).some((i) => i.severity === "error");
    const text = item.type === "trigger" ? `Départ : ${triggerText}` : item.label;
    const content = (
      <>
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5",
            NODE_TONES[item.type],
          )}
        >
          {item.repeat ? <CornerDownRight /> : nodeIcon(item.type, node?.data)}
        </span>
        <span className="min-w-0 flex-1">
          {item.via ? (
            <span
              className={cn(
                "mr-1 font-semibold",
                item.via === "yes" ? "text-success" : "text-muted-foreground",
              )}
            >
              {viaLabel(item.via)}
              {/* Flèche plutôt que « : » (le libellé du bloc peut déjà en contenir un : « Message : … »). */}
              <span aria-hidden> →</span>
              <span className="sr-only"> :</span>
            </span>
          ) : null}
          <span className={cn(item.repeat && "text-muted-foreground")}>
            {item.repeat ? `rejoint ${item.phrase}` : text}
          </span>
          {hasError && !item.repeat ? (
            <span className="ml-1.5 inline-flex items-center gap-1 text-note font-medium text-danger">
              <span aria-hidden className="size-1.5 rounded-full bg-danger" />à corriger
            </span>
          ) : null}
          {extra && !item.repeat ? (
            <span className="block text-note text-muted-foreground">{extra(item.id)}</span>
          ) : null}
        </span>
      </>
    );
    const cls = cn(
      "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-body",
      onSelect && "min-h-10 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
      selectedId === item.id && "bg-brand-soft",
    );
    return (
      <li
        key={`${item.id}-${item.repeat ? "r" : "n"}-${item.via ?? ""}`}
        style={{ paddingLeft: `${item.depth * 1.25}rem` }}
      >
        {onSelect && !item.repeat ? (
          <button
            type="button"
            className={cls}
            onClick={() => onSelect(item.id)}
            aria-current={selectedId === item.id ? "true" : undefined}
          >
            {content}
          </button>
        ) : (
          <div className={cls}>{content}</div>
        )}
      </li>
    );
  };
  return (
    <div className="space-y-3">
      <ol aria-label={label} className="space-y-0.5">
        {linked.map(row)}
      </ol>
      {detached.length ? (
        <div className="space-y-1">
          <p className="px-2 text-note font-medium text-danger">Blocs non reliés au parcours</p>
          <ul aria-label="Blocs non reliés au parcours" className="space-y-0.5">
            {detached.map(row)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
