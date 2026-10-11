"use client";

import "@xyflow/react/dist/base.css";
import "./flow.css";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type FitViewOptions,
  type NodeChange,
  type OnBeforeDelete,
} from "@xyflow/react";
import { CircleAlert, CircleCheck, Monitor, TriangleAlert } from "lucide-react";
import {
  AUTOMATION_TRIGGER_LABELS,
  type AutomationTriggerKey,
  type GraphHandle,
} from "@linkaffipro/core";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeConditions, type NameMaps } from "@/lib/automations/describe";
import {
  addNode,
  canConnect,
  canInsertAfter,
  connectExit,
  defaultInsertExit,
  disconnectExit,
  draftNodePhrase,
  draftToRaw,
  findNode,
  insertAfter,
  isPaletteKey,
  isSimpleChain,
  layoutDraft,
  paletteItem,
  removeNode,
  updateNodeData,
  validateEditor,
  type Draft,
  type DraftNodeData,
  type PaletteKey,
} from "@/lib/automations/flow";
import {
  draftFromView,
  fillHeight,
  measuredSizes,
  miniMapClass,
  syncViewNodes,
  usedExits,
  viewEdges,
} from "@/lib/automations/flow-view";
import type { EditorOptions } from "@/lib/automations/queries";
import { TestOnMeButton } from "../rule-switch";
import { FLOW_ARIA_FR } from "./aria";
import { CanvasControls } from "./canvas-controls";
import { FlowContext, type FlowContextValue } from "./editor-context";
import { NodePanel, type RuleState } from "./node-panel";
import { NODE_TYPES, type FlowNode } from "./nodes";
import { FlowOutline } from "./outline";
import { BlockPalette, PALETTE_DRAG_TYPE } from "./palette";
import { useIsDesktop } from "./use-desktop";

export type RuleEditorProps = {
  ruleId: string | null;
  initial: {
    name: string;
    trigger: string;
    conditions: Record<string, unknown>;
    oncePerMember: boolean;
    /** Parcours ouvert dans l'éditeur (une relance à liste s'ouvre en branche unique). */
    draft: Draft;
    templateKey: string | null;
  };
  /** Parcours enregistré illisible (repris au mieux) : raison affichée en haut de l'éditeur. */
  readError?: string | null;
  options: EditorOptions;
  names: NameMaps;
  /** Relance à liste avec des membres en attente : prévenir si le parcours devient à branches. */
  pendingLinear: number;
  saveAction: (fd: FormData) => Promise<{ ok: false; error: string }>;
  testAction: (fd: FormData) => Promise<void>;
};

const triggerLabel = (t: string) => AUTOMATION_TRIGGER_LABELS[t as AutomationTriggerKey] ?? "";

/** Ajustement de la vue : marge de 40 px autour des blocs, jamais au-delà de l'échelle 1. */
const FIT_VIEW: FitViewOptions = { padding: "40px", maxZoom: 1 };

/**
 * Mini-carte : petite (120 × 80) dès 480 px de canevas (cas de l'écran de 1440 px, bibliothèque et panneau ouverts :
 * environ 540 px), grande (140 × 96) dès 720 px ; en dessous, elle cacherait des blocs.
 */
const MINIMAP_MIN_WIDTH = 480;
const MINIMAP_LARGE_WIDTH = 720;

function EditorDesktop({
  ruleId,
  initial,
  options,
  names,
  pendingLinear,
  readError,
  saveAction,
  testAction,
}: RuleEditorProps) {
  const rf = useReactFlow<FlowNode, Edge>();
  /** Zone du canevas (pour viser son centre) et cadre complet (barre + canevas, pour sa hauteur). */
  const wrapper = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  /** Taille de la mini-carte selon la largeur du canevas (aucune sur un canevas étroit). */
  const [minimap, setMinimap] = useState<null | "small" | "large">(null);
  const [rule, setRule] = useState<RuleState>({
    name: initial.name,
    trigger: initial.trigger,
    conditions: initial.conditions,
    oncePerMember: initial.oncePerMember,
  });
  const graphNames = useMemo(
    () => ({ channels: names.channels, campaigns: names.campaigns }),
    [names],
  );
  const [nodes, setNodes] = useState<FlowNode[]>(() =>
    syncViewNodes<FlowNode>([], initial.draft, graphNames, triggerLabel(initial.trigger)),
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    viewEdges<Edge>([], initial.draft, new Set(), graphNames),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Après un premier essai d'enregistrement, le nom vide est aussi signalé en rouge. */
  const [attempted, setAttempted] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [pending, startTransition] = useTransition();
  const leaving = useRef(false);

  const triggerText = triggerLabel(rule.trigger);
  const filtersText = describeConditions(rule.conditions, names);
  const draft = useMemo(() => draftFromView(nodes, edges), [nodes, edges]);
  // Dernier brouillon affiché, pour les gestionnaires du canevas (lus hors rendu).
  const draftRef = useRef<Draft>(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const validation = useMemo(() => validateEditor(draft, rule), [draft, rule]);
  const selectedId = nodes.find((n) => n.selected)?.id ?? null;
  const selected = findNode(draft, selectedId);

  const shownNodes = useMemo(
    () => syncViewNodes(nodes, draft, graphNames, triggerText),
    [nodes, draft, graphNames, triggerText],
  );
  const shownEdges = useMemo(
    () => viewEdges(edges, draft, validation.edgeIds, graphNames),
    [edges, draft, validation.edgeIds, graphNames],
  );

  const firstIssueNode = validation.errors.find((i) => i.nodeId)?.nodeId ?? null;
  const errorCount = validation.errors.length;
  const general = validation.byNode["*"] ?? [];
  const becomesBranched =
    pendingLinear > 0 && !!validation.graph && !isSimpleChain(validation.graph);

  // Le canevas remplit l'écran sous l'en-tête (mesuré à l'ouverture, au redimensionnement et quand une alerte
  // au-dessus apparaît ou disparaît).
  useLayoutEffect(() => {
    const measure = () => {
      const el = frame.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      setHeight(fillHeight(window.innerHeight, box.top + window.scrollY));
      setMinimap(
        box.width >= MINIMAP_LARGE_WIDTH
          ? "large"
          : box.width >= MINIMAP_MIN_WIDTH
            ? "small"
            : null,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [error, becomesBranched, readError]);

  // Quitter la page avec des modifications non enregistrées : le navigateur demande confirmation.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const select = useCallback((id: string | null) => {
    setNodes((ns) =>
      ns.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })),
    );
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
  }, []);

  const focusNode = useCallback(
    (id: string) => {
      requestAnimationFrame(() => {
        const n = rf.getNode(id);
        if (!n) return;
        const w = n.measured?.width ?? 240;
        const h = n.measured?.height ?? 90;
        void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, {
          zoom: Math.max(rf.getZoom(), 0.8),
          duration: 300,
        });
      });
    },
    [rf],
  );

  /** Applique un nouveau brouillon (opération de l'éditeur) ; `selectId` : bloc à ouvrir ensuite. */
  const apply = useCallback(
    (next: Draft, selectId?: string | null) => {
      setNodes((prev) => {
        const ns = syncViewNodes(prev, next, graphNames, triggerText);
        return selectId === undefined ? ns : ns.map((n) => ({ ...n, selected: n.id === selectId }));
      });
      setEdges((prev) => viewEdges(prev, next, new Set(), graphNames));
      setDirty(true);
      setError(null);
    },
    [graphNames, triggerText],
  );

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    // Les suppressions passent par onBeforeDelete (recousage du parcours) ; le reste est appliqué tel quel.
    const kept = changes.filter((c) => c.type !== "remove");
    setNodes((ns) => applyNodeChanges(kept, ns));
    if (kept.some((c) => c.type === "position" && c.dragging === false)) setDirty(true);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some((c) => c.type === "remove")) {
      setDirty(true);
      setAnnounce("Lien retiré.");
    }
  }, []);

  const onBeforeDelete: OnBeforeDelete<FlowNode, Edge> = useCallback(
    async ({ nodes: gone }) => {
      const removable = gone.filter((n) => n.type !== "trigger");
      if (gone.length === 0) return true; // liens seuls : retirés par le canevas
      let d = draftRef.current;
      for (const n of removable) d = removeNode(d, n.id);
      if (removable.length) {
        apply(d, null);
        setAnnounce(
          removable.length > 1 ? `${removable.length} blocs supprimés.` : "Bloc supprimé.",
        );
      }
      return false;
    },
    [apply],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      const handle = (c.sourceHandle ?? "next") as GraphHandle;
      apply(connectExit(draftRef.current, c.source, handle, c.target));
      setAnnounce("Blocs reliés.");
    },
    [apply],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) =>
      !!c.source &&
      !!c.target &&
      canConnect(draftRef.current, c.source, (c.sourceHandle ?? "next") as GraphHandle, c.target),
    [],
  );

  const addAfter = useCallback(
    (source: string, handle: GraphHandle, key: PaletteKey) => {
      const r = insertAfter(draftRef.current, source, handle, key, measuredSizes(rf.getNodes()));
      if (!r) return;
      apply(r.draft, r.id);
      setAnnounce(
        `Bloc « ${paletteItem(key).label} » ajouté. Réglez-le dans le panneau de droite.`,
      );
      focusNode(r.id);
    },
    [apply, focusNode, rf],
  );

  const insertTarget = (() => {
    if (!selected) return null;
    const h = defaultInsertExit(draft, selected.id);
    return h ? { id: selected.id, handle: h } : null;
  })();

  /** Bibliothèque au clic ou au clavier : après le bloc choisi, sinon posé à part au centre de la vue. */
  const addFromPalette = (key: PaletteKey) => {
    if (insertTarget && canInsertAfter(draft, insertTarget.id, insertTarget.handle, key)) {
      addAfter(insertTarget.id, insertTarget.handle, key);
      return;
    }
    const box = wrapper.current?.getBoundingClientRect();
    const center = rf.screenToFlowPosition({
      x: (box?.left ?? 0) + (box?.width ?? 600) / 2,
      y: (box?.top ?? 0) + (box?.height ?? 400) / 2,
    });
    const r = addNode(
      draft,
      key,
      { x: center.x - 120, y: center.y - 40 },
      measuredSizes(rf.getNodes()),
    );
    apply(r.draft, r.id);
    setAnnounce(
      `Bloc « ${paletteItem(key).label} » posé à part : reliez-le au parcours depuis le panneau.`,
    );
  };

  const onDrop = (e: React.DragEvent) => {
    const key = e.dataTransfer.getData(PALETTE_DRAG_TYPE);
    if (!isPaletteKey(key)) return;
    e.preventDefault();
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const r = addNode(
      draftRef.current,
      key,
      { x: pos.x - 120, y: pos.y - 30 },
      measuredSizes(rf.getNodes()),
    );
    apply(r.draft, r.id);
    setAnnounce(`Bloc « ${paletteItem(key).label} » posé : reliez-le au parcours.`);
  };

  const layout = () => {
    apply(layoutDraft(draftRef.current));
    requestAnimationFrame(() => void rf.fitView({ duration: 300, ...FIT_VIEW }));
    setAnnounce("Blocs rangés.");
  };

  const save = () => {
    setAttempted(true);
    if (!validation.ok) {
      setError("Corrigez d'abord les points signalés en rouge : la relance n'est pas enregistrée.");
      return;
    }
    const fd = new FormData();
    if (ruleId) fd.set("ruleId", ruleId);
    fd.set("name", rule.name.trim());
    fd.set("trigger", rule.trigger);
    fd.set("conditions", JSON.stringify(rule.conditions));
    if (rule.oncePerMember) fd.set("oncePerMember", "on");
    fd.set("graph", JSON.stringify(draftToRaw(draft)));
    if (initial.templateKey) fd.set("templateKey", initial.templateKey);
    leaving.current = true;
    startTransition(async () => {
      const r = await saveAction(fd);
      if (r && !r.ok) {
        leaving.current = false;
        setError(r.error);
      }
    });
  };

  const ctx: FlowContextValue = {
    readOnly: false,
    issues: validation.byNode,
    names: graphNames,
    triggerText,
    filtersText,
    usedExits: usedExits(draft),
    onAddAfter: addAfter,
  };

  return (
    <FlowContext.Provider value={ctx}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
          <div className="min-w-64 flex-1 space-y-1.5">
            <Label htmlFor="relance-nom">Nom de la relance</Label>
            <Input
              id="relance-nom"
              value={rule.name}
              maxLength={80}
              onChange={(e) => {
                setRule((r) => ({ ...r, name: e.target.value }));
                setDirty(true);
              }}
              aria-invalid={
                ((attempted || rule.name.length > 0) && rule.name.trim().length < 2) || undefined
              }
            />
          </div>
          <div role="status" className="flex min-h-9 items-center">
            {errorCount === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-note font-medium text-success">
                <CircleCheck aria-hidden className="size-4" />
                Prête à enregistrer
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (firstIssueNode) {
                    select(firstIssueNode);
                    focusNode(firstIssueNode);
                  } else select(null);
                }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-note font-medium text-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-ring"
              >
                <CircleAlert aria-hidden className="size-4" />
                {errorCount} point{errorCount > 1 ? "s" : ""} à corriger
              </button>
            )}
          </div>
          <TestOnMeButton
            ruleId={ruleId}
            action={testAction}
            size="default"
            disabledReason={
              dirty
                ? "Enregistrez d'abord vos modifications : le test utilise la version enregistrée."
                : null
            }
          />
          <Button type="button" onClick={save} disabled={pending} className="max-md:h-10">
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>

        {readError ? (
          <Alert variant="warning" role="status">
            <TriangleAlert aria-hidden />
            <AlertTitle>Parcours enregistré abîmé</AlertTitle>
            <AlertDescription>
              {readError} Ce qui pouvait être repris est affiché : corrigez puis enregistrez.
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {becomesBranched ? (
          <Alert variant="warning" role="status">
            <TriangleAlert aria-hidden />
            <AlertTitle>Des membres attendent la suite de cette relance</AlertTitle>
            <AlertDescription>
              Avec une condition, elle devient un parcours à branches : à l&apos;enregistrement,
              l&apos;attente de ces {pendingLinear} membre{pendingLinear > 1 ? "s" : ""} sera
              arrêtée.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* 14rem : chaque bloc de la bibliothèque tient sur une ligne ; le canevas garde plus de 480 px (mini-carte). */}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[14rem_minmax(0,1fr)_22rem]">
          <div className="md:col-span-2 xl:col-span-1">
            <BlockPalette
              onAdd={addFromPalette}
              targetLabel={
                insertTarget && selected
                  ? `après ${draftNodePhrase(selected, graphNames)}`
                  : "sur le canevas (à relier ensuite)"
              }
            />
          </div>
          <div
            ref={frame}
            style={height ? { height } : undefined}
            className={cn(
              "lap-flow flex flex-col overflow-hidden rounded-xl border border-border",
              !height && "h-[min(70dvh,720px)] min-h-[480px]",
            )}
          >
            <CanvasControls onLayout={layout} fitViewOptions={FIT_VIEW} />
            <div
              ref={wrapper}
              className="relative min-h-0 flex-1"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }
              }}
              onDrop={onDrop}
            >
              <ReactFlow<FlowNode, Edge>
                nodes={shownNodes}
                edges={shownEdges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={isValidConnection}
                onBeforeDelete={onBeforeDelete}
                onPaneClick={() => select(null)}
                deleteKeyCode={["Backspace", "Delete"]}
                connectionLineType={ConnectionLineType.SmoothStep}
                defaultEdgeOptions={{ type: "smoothstep" }}
                fitView
                fitViewOptions={FIT_VIEW}
                minZoom={0.3}
                maxZoom={1.5}
                snapToGrid
                snapGrid={[8, 8]}
                ariaLabelConfig={FLOW_ARIA_FR}
                aria-label="Canevas du parcours"
              >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1.25} />
                {/* En haut à droite : un parcours s'élargit vers le bas, ce coin reste presque toujours libre. */}
                {minimap ? (
                  <MiniMap<FlowNode>
                    position="top-right"
                    pannable
                    zoomable
                    ariaLabel="Mini-carte du parcours"
                    style={
                      minimap === "large" ? { width: 140, height: 96 } : { width: 120, height: 80 }
                    }
                    nodeClassName={(n) =>
                      miniMapClass(
                        n.type,
                        (validation.byNode[n.id] ?? []).some((i) => i.severity === "error"),
                      )
                    }
                  />
                ) : null}
              </ReactFlow>
            </div>
          </div>
          <aside
            aria-label={selected ? "Réglage du bloc choisi" : "Blocs du parcours"}
            style={height ? { height } : undefined}
            className={cn(
              "overflow-y-auto rounded-xl border border-border bg-card p-4",
              !height && "max-h-[min(70dvh,720px)] min-h-[480px]",
            )}
          >
            {selected ? (
              <NodePanel
                key={selected.id}
                draft={draft}
                node={selected}
                rule={rule}
                onRuleChange={(patch) => {
                  setRule((r) => ({ ...r, ...patch }));
                  setDirty(true);
                }}
                options={options}
                names={graphNames}
                issues={validation.byNode[selected.id] ?? []}
                onChangeData={(id, data: DraftNodeData) =>
                  apply(updateNodeData(draftRef.current, id, data))
                }
                onConnect={(source, handle, target) => {
                  apply(
                    target
                      ? connectExit(draftRef.current, source, handle, target)
                      : disconnectExit(draftRef.current, source, handle),
                  );
                  setAnnounce(
                    target ? "Blocs reliés." : "Lien retiré : la relance s'arrête de ce côté.",
                  );
                }}
                onInsert={addAfter}
                onRemove={(id) => {
                  apply(removeNode(draftRef.current, id), null);
                  setAnnounce("Bloc supprimé.");
                }}
                onClose={() => select(null)}
              />
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-body font-semibold text-foreground">Le parcours</h2>
                  <p className="text-note text-muted-foreground">
                    Choisissez un bloc (ici ou sur le canevas) pour le régler.
                  </p>
                </div>
                {general.length ? (
                  <Alert variant="destructive" role="status">
                    <CircleAlert aria-hidden />
                    <AlertDescription>
                      <ul className="space-y-0.5">
                        {general.map((i, k) => (
                          <li key={k}>{i.message}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                ) : null}
                <FlowOutline
                  draft={draft}
                  names={graphNames}
                  triggerText={triggerText}
                  issues={validation.byNode}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    select(id);
                    focusNode(id);
                  }}
                />
              </div>
            )}
          </aside>
        </div>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </div>
    </FlowContext.Provider>
  );
}

/**
 * Éditeur visuel d'une relance sur mesure (Membres → Relances automatiques → avancé) : bibliothèque de blocs, canevas
 * (@xyflow/react : glisser-déposer, liens, zoom, mini-carte), panneau de réglage du bloc choisi, validation en direct,
 * « Tester sur moi », « Enregistrer » (`saveRuleAction` : l'erreur s'affiche sans rien perdre).
 * Sur téléphone : message « à utiliser sur ordinateur » et aperçu du parcours en lecture seule.
 */
export function RuleEditor(props: RuleEditorProps) {
  const desktop = useIsDesktop();
  const graphNames = { channels: props.names.channels, campaigns: props.names.campaigns };
  return (
    <>
      <div className="space-y-4 md:hidden">
        <Alert variant="info" role="status">
          <Monitor aria-hidden />
          <AlertTitle>À utiliser sur ordinateur</AlertTitle>
          <AlertDescription>
            L&apos;éditeur à branches a besoin d&apos;un grand écran. Voici le parcours en lecture
            seule ; les relances prêtes à l&apos;emploi se règlent aussi sur téléphone.
          </AlertDescription>
        </Alert>
        <section
          aria-labelledby="apercu-parcours"
          className="rounded-xl border border-border bg-card p-4"
        >
          <h2 id="apercu-parcours" className="mb-1 text-body font-semibold text-foreground">
            {props.initial.name || "Nouvelle relance"}
          </h2>
          <p className="mb-3 text-note text-muted-foreground">
            {triggerLabel(props.initial.trigger)} ·{" "}
            {describeConditions(props.initial.conditions, props.names)}
          </p>
          <FlowOutline
            draft={props.initial.draft}
            names={graphNames}
            triggerText={triggerLabel(props.initial.trigger)}
            label="Parcours (lecture seule)"
          />
        </section>
      </div>
      <div className={cn("hidden md:block")}>
        {desktop ? (
          <ReactFlowProvider>
            <EditorDesktop {...props} />
          </ReactFlowProvider>
        ) : (
          <div
            aria-hidden
            className="h-[min(70dvh,720px)] min-h-[480px] animate-pulse rounded-xl border border-border bg-muted/40"
          />
        )}
      </div>
    </>
  );
}
