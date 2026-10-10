"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  BellRing,
  Bot,
  CircleAlert,
  Hourglass,
  MessageSquareText,
  OctagonX,
  Play,
  Plus,
  Split,
  Tag,
  TriangleAlert,
  UserPlus,
  Zap,
} from "lucide-react";
import {
  GRAPH_HANDLE_LABELS,
  GRAPH_NODE_LABELS,
  graphHandlesFor,
  type GraphHandle,
  type GraphNodeType,
  type NodeRunStats,
} from "@linkaffipro/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PALETTE, draftNodeLabel, type DraftNodeData } from "@/lib/automations/flow";
import { useFlowContext } from "./editor-context";

export type FlowNodeData = { payload: DraftNodeData };
export type FlowNode = Node<FlowNodeData, GraphNodeType>;

/** Pastille d'icône et nuance de chaque type de bloc (jetons du thème). */
export const NODE_TONES: Record<GraphNodeType, string> = {
  trigger: "bg-brand-soft text-brand-ink",
  condition: "bg-info-soft text-info",
  action: "bg-success-soft text-success",
  wait: "bg-warning-soft text-warning",
  stop: "bg-muted text-foreground",
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  send_message: <MessageSquareText />,
  send_sequence: <Bot />,
  tag: <Tag />,
  suggest_channel: <UserPlus />,
  notify_team: <BellRing />,
};

/** Icône d'un bloc (une action prend l'icône de ce qu'elle fait). */
export function nodeIcon(type: GraphNodeType, payload?: DraftNodeData): React.ReactNode {
  switch (type) {
    case "trigger":
      return <Play />;
    case "condition":
      return <Split />;
    case "wait":
      return <Hourglass />;
    case "stop":
      return <OctagonX />;
    case "action":
      return ACTION_ICONS[String(payload?.action?.type ?? "")] ?? <Zap />;
  }
}

/** Position horizontale des sorties sous le bloc (« oui » à gauche, « non » à droite). */
export const HANDLE_LEFT: Record<GraphHandle, string> = { next: "50%", yes: "28%", no: "72%" };

function plural(n: number, one: string, many: string) {
  return `${n} ${n > 1 ? many : one}`;
}

/** Passages d'un bloc sur la fiche d'une relance (« 12 passages · oui 5 · non 7 · 1 erreur »). */
export function statsLine(type: GraphNodeType, s: NodeRunStats | undefined): string {
  if (!s) return type === "trigger" ? "" : "Aucun passage";
  const parts: string[] = [];
  if (type !== "trigger") parts.push(plural(s.reached, "passage", "passages"));
  if (type === "condition" && s.reached) parts.push(`oui ${s.yes} · non ${s.no}`);
  if (s.waiting) parts.push(`${s.waiting} en attente`);
  if (s.failed) parts.push(plural(s.failed, "erreur", "erreurs"));
  return parts.join(" · ");
}

function AddAfterButton({ nodeId, handle }: { nodeId: string; handle: GraphHandle }) {
  const { onAddAfter } = useFlowContext();
  if (!onAddAfter) return null;
  const where = handle === "next" ? "après ce bloc" : `après « ${GRAPH_HANDLE_LABELS[handle]} »`;
  return (
    <div
      className="nodrag nopan absolute top-full mt-3 -translate-x-1/2"
      style={{ left: HANDLE_LEFT[handle] }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              className="rounded-full bg-surface"
              aria-label={`Ajouter un bloc ${where}`}
              title={`Ajouter un bloc ${where}`}
            />
          }
        >
          <Plus aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Ajouter {where}</DropdownMenuLabel>
            {PALETTE.map((p) => (
              <DropdownMenuItem key={p.key} onClick={() => onAddAfter(nodeId, handle, p.key)}>
                <span
                  aria-hidden
                  className={cn(
                    "flex size-5 items-center justify-center rounded-md [&>svg]:size-3.5",
                    NODE_TONES[
                      p.key === "condition" || p.key === "wait" || p.key === "stop"
                        ? p.key
                        : "action"
                    ],
                  )}
                >
                  {nodeIcon(
                    p.key === "condition" || p.key === "wait" || p.key === "stop"
                      ? p.key
                      : "action",
                    { action: { type: p.key } },
                  )}
                </span>
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Bloc du canevas : en-tête (icône et type), ce que fait le bloc en une phrase, problème à corriger (rouge) ou
 * avertissement, passages (fiche de la relance). Point d'entrée en haut, sorties en bas (« oui » / « non » pour une
 * condition) ; « + » sous une sortie libre pour ajouter la suite (éditeur seulement).
 */
function FlowBlock({ id, type, data, selected }: NodeProps<FlowNode>) {
  const ctx = useFlowContext();
  const issues = ctx.issues[id] ?? [];
  const error = issues.find((i) => i.severity === "error");
  const warning = issues.find((i) => i.severity === "warning");
  const label = draftNodeLabel(
    { id, type, position: { x: 0, y: 0 }, data: data.payload },
    ctx.names,
  );
  const handles = graphHandlesFor(type);
  const stats = ctx.stats ? statsLine(type, ctx.stats[id]) : "";
  return (
    <div
      className={cn(
        "relative w-60 rounded-xl border bg-card text-left shadow-xs transition-shadow",
        error ? "border-danger ring-2 ring-danger/15" : "border-border",
        selected && (error ? "ring-danger/40" : "border-brand-ink ring-2 ring-brand/40"),
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-note text-muted-foreground">
        <span
          aria-hidden
          className={cn(
            "flex size-5 items-center justify-center rounded-md [&>svg]:size-3.5",
            NODE_TONES[type],
          )}
        >
          {nodeIcon(type, data.payload)}
        </span>
        <span className="font-medium">{GRAPH_NODE_LABELS[type]}</span>
      </div>
      <div className="space-y-1 px-3 py-2">
        <p className="line-clamp-3 text-body font-medium break-words text-foreground">
          {type === "trigger" ? ctx.triggerText || "Choisissez ce qui lance la relance" : label}
        </p>
        {type === "trigger" && ctx.filtersText ? (
          <p className="line-clamp-2 text-note text-muted-foreground">{ctx.filtersText}</p>
        ) : null}
        {error ? (
          <p className="flex gap-1 text-note text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{error.message}</span>
          </p>
        ) : warning ? (
          <p className="flex gap-1 text-note text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{warning.message}</span>
          </p>
        ) : null}
        {stats ? (
          <p
            className={cn(
              "text-note tabular-nums",
              ctx.stats?.[id]?.failed ? "text-danger" : "text-muted-foreground",
            )}
          >
            {stats}
          </p>
        ) : null}
      </div>
      {type === "condition" ? (
        <div className="flex justify-between px-[18%] pb-1.5 text-note font-semibold" aria-hidden>
          <span className="text-success">Oui</span>
          <span className="text-muted-foreground">Non</span>
        </div>
      ) : null}
      {type !== "trigger" ? (
        <Handle type="target" position={Position.Top} id="in" isConnectable={!ctx.readOnly} />
      ) : null}
      {handles.map((h) => (
        <Handle
          key={h}
          type="source"
          position={Position.Bottom}
          id={h}
          className={`is-${h}`}
          style={{ left: HANDLE_LEFT[h] }}
          isConnectable={!ctx.readOnly}
        />
      ))}
      {!ctx.readOnly
        ? handles
            .filter((h) => !ctx.usedExits.has(`${id}:${h}`))
            .map((h) => <AddAfterButton key={h} nodeId={id} handle={h} />)
        : null}
    </div>
  );
}

const Block = memo(FlowBlock);

/** Types de blocs du canevas (un seul composant, qui s'adapte au type). */
export const NODE_TYPES = {
  trigger: Block,
  condition: Block,
  action: Block,
  wait: Block,
  stop: Block,
};
