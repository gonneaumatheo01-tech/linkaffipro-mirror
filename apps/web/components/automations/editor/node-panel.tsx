"use client";

import { useId, useState } from "react";
import { ArrowLeft, CircleAlert, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRIGGER_LABELS,
  GRAPH_ACTION_HELP,
  GRAPH_ACTION_LABELS,
  GRAPH_ACTION_TYPES,
  GRAPH_CONDITION_HELP,
  GRAPH_CONDITION_KINDS,
  GRAPH_CONDITION_LABELS,
  GRAPH_HANDLE_LABELS,
  GRAPH_NODE_LABELS,
  GRAPH_SEQUENCE_LABELS,
  SPEND_LEVELS,
  SPEND_LEVEL_LABELS,
  type GraphActionType,
  type GraphConditionKind,
  type GraphHandle,
  type GraphIssue,
  type GraphNames,
} from "@linkaffipro/core";
import { AdvancedSection } from "@/components/admin/form-section";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  PALETTE,
  canConnect,
  canInsertAfter,
  draftNodeLabel,
  exitsOf,
  type Draft,
  type DraftNode,
  type DraftNodeData,
  type PaletteKey,
} from "@/lib/automations/flow";
import {
  buttonsToEntries,
  delayToHours,
  hoursToDelay,
  toggleInList,
  type ButtonEntry,
  type ButtonRows,
  type DelayUnit,
} from "@/lib/automations/node-form";
import type { EditorOptions } from "@/lib/automations/queries";
import { LanguageChecklist } from "../language-checklist";
import { LinkButtonsField } from "../link-buttons-field";
import { MessageField } from "../message-field";
import { NODE_TONES, nodeIcon } from "./nodes";

export type RuleState = {
  name: string;
  trigger: string;
  conditions: Record<string, unknown>;
  oncePerMember: boolean;
};

type Vertical = "CASINO" | "SPORTS" | "DATING";
const toVertical = (v: string | undefined): Vertical | null =>
  v === "CASINO" || v === "SPORTS" || v === "DATING" ? v : null;

const EXIT_TITLES: Record<GraphHandle, string> = {
  next: "Ensuite",
  yes: "Si oui",
  no: "Si non",
};

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numStr = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v : "";

/** Liste de cases à cocher (canaux avec la pastille de leur univers, campagnes, niveaux…). */
function CheckList({
  legend,
  help,
  items,
  value,
  onChange,
  empty,
}: {
  legend: string;
  help?: string;
  /** `universe` : pastille de couleur devant le libellé (canaux). */
  items: Array<{ value: string; label: string; universe?: string | null }>;
  value: string[];
  onChange: (next: string[]) => void;
  empty?: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-body font-medium text-foreground">{legend}</legend>
      {help ? <p className="text-note text-muted-foreground">{help}</p> : null}
      {items.length === 0 ? (
        <p className="text-note text-muted-foreground">{empty ?? "Aucun choix."}</p>
      ) : (
        <div className="space-y-0.5">
          {items.map((i) => (
            <label key={i.value} className="flex min-h-9 items-center gap-2 text-body">
              <Checkbox
                checked={value.includes(i.value)}
                onCheckedChange={(on) => onChange(toggleInList(value, i.value, on))}
              />
              {i.universe !== undefined ? <UniverseDot universe={i.universe} /> : null}
              <span className="min-w-0 truncate">{i.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help ? (
        <p id={`${id}-help`} className="text-note text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}

/** Départ : ce qui lance la relance, pour qui (filtres), une seule fois par membre. */
function TriggerForm({
  rule,
  onChange,
  options,
}: {
  rule: RuleState;
  onChange: (patch: Partial<RuleState>) => void;
  options: EditorOptions;
}) {
  const id = useId();
  const c = rule.conditions;
  const set = (patch: Record<string, unknown>) => {
    const next = { ...c, ...patch };
    for (const k of Object.keys(next))
      if (next[k] === undefined || (Array.isArray(next[k]) && (next[k] as unknown[]).length === 0))
        delete next[k];
    onChange({ conditions: next });
  };
  const advanced =
    strList(c.spendLevels).length +
    strList(c.languages).length +
    strList(c.categoryIds).length +
    (rule.trigger !== "INACTIVE" && c.inactiveDays ? 1 : 0);
  return (
    <div className="space-y-5">
      <Field id={`${id}-trigger`} label="Ce qui lance la relance">
        <NativeSelect
          id={`${id}-trigger`}
          value={rule.trigger}
          onChange={(e) => onChange({ trigger: e.target.value })}
          wrapperClassName="w-full"
        >
          {AUTOMATION_TRIGGERS.map((t) => (
            <option key={t} value={t}>
              {AUTOMATION_TRIGGER_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {rule.trigger === "INACTIVE" ? (
        <Field
          id={`${id}-inactive`}
          label="Après combien de jours sans rien faire"
          help="Le membre n'a ni écrit au bot, ni fait de demande, ni cliqué."
        >
          <Input
            id={`${id}-inactive`}
            type="number"
            min={1}
            max={3650}
            value={numStr(c.inactiveDays)}
            onChange={(e) =>
              set({ inactiveDays: e.target.value ? Number(e.target.value) : undefined })
            }
            aria-describedby={`${id}-inactive-help`}
          />
        </Field>
      ) : null}
      <CheckList
        legend="Canaux"
        help="Sans case cochée : les membres de tous les canaux."
        items={options.channels.map((ch) => ({
          value: ch.id,
          label: ch.title,
          universe: ch.vertical,
        }))}
        value={strList(c.channelIds)}
        onChange={(v) => set({ channelIds: v })}
        empty="Aucun canal actif."
      />
      {options.campaigns.length ? (
        <CheckList
          legend="Venus de ces campagnes"
          help="Sans case cochée : toutes les origines."
          items={options.campaigns.map((k) => ({ value: k.id, label: k.name }))}
          value={strList(c.campaignIds)}
          onChange={(v) => set({ campaignIds: v })}
        />
      ) : null}
      <label className="flex items-start gap-2 text-body">
        <Checkbox
          className="mt-0.5"
          checked={rule.oncePerMember}
          onCheckedChange={(on) => onChange({ oncePerMember: on })}
        />
        <span>
          Une seule fois par membre
          <span className="block text-note text-muted-foreground">
            Recommandé : la même personne n&apos;est jamais relancée deux fois.
          </span>
        </span>
      </label>
      <AdvancedSection
        title="Plus de filtres"
        description="Niveau de dépense, langue, catégorie du message cliqué."
        modifiedCount={advanced}
      >
        <CheckList
          legend="Niveau de dépense"
          items={SPEND_LEVELS.map((l) => ({ value: l, label: SPEND_LEVEL_LABELS[l] }))}
          value={strList(c.spendLevels)}
          onChange={(v) => set({ spendLevels: v })}
        />
        <LanguageChecklist
          legend="Langues"
          help="Sans case cochée : toutes les langues."
          available={options.languages}
          value={strList(c.languages)}
          onChange={(v) => set({ languages: v })}
        />
        {rule.trigger !== "INACTIVE" ? (
          <Field
            id={`${id}-idle`}
            label="Seulement s'il n'a rien fait depuis (jours)"
            help="Laissez vide pour ne pas filtrer."
          >
            <Input
              id={`${id}-idle`}
              type="number"
              min={1}
              max={3650}
              value={numStr(c.inactiveDays)}
              onChange={(e) =>
                set({ inactiveDays: e.target.value ? Number(e.target.value) : undefined })
              }
              aria-describedby={`${id}-idle-help`}
            />
          </Field>
        ) : null}
        {rule.trigger === "OFFER_CLICKED" ? (
          <CheckList
            legend="Catégorie du message cliqué"
            items={options.categories.map((k) => ({ value: k.id, label: k.name }))}
            value={strList(c.categoryIds)}
            onChange={(v) => set({ categoryIds: v })}
          />
        ) : null}
      </AdvancedSection>
    </div>
  );
}

/** Valeurs par défaut des réglages d'une condition (quand on en change la nature). */
function conditionDefaults(kind: GraphConditionKind): Record<string, unknown> {
  switch (kind) {
    case "deposit_count_gte":
      return { kind, n: 2 };
    case "inactive_days_gte":
      return { kind, n: 7 };
    case "spend_level_in":
      return { kind, levels: [] };
    case "language_in":
      return { kind, languages: [] };
    case "has_tag":
      return { kind, tag: "" };
    case "in_channel":
      return { kind, channelId: "" };
    case "campaign_in":
      return { kind, campaignIds: [] };
    default:
      return { kind };
  }
}

function ConditionForm({
  data,
  onChange,
  options,
}: {
  data: DraftNodeData;
  onChange: (d: DraftNodeData) => void;
  options: EditorOptions;
}) {
  const id = useId();
  const c = data.condition ?? {};
  const kind = str(c.kind) as GraphConditionKind | "";
  const set = (patch: Record<string, unknown>) => onChange({ condition: { ...c, ...patch } });
  return (
    <div className="space-y-4">
      <Field
        id={`${id}-kind`}
        label="Ce qu'il faut vérifier"
        help={kind ? GRAPH_CONDITION_HELP[kind] : undefined}
      >
        <NativeSelect
          id={`${id}-kind`}
          value={kind}
          onChange={(e) =>
            onChange({
              condition: e.target.value
                ? conditionDefaults(e.target.value as GraphConditionKind)
                : { kind: "" },
            })
          }
          aria-describedby={kind ? `${id}-kind-help` : undefined}
          wrapperClassName="w-full"
        >
          <option value="">Choisissez…</option>
          {GRAPH_CONDITION_KINDS.map((k) => (
            <option key={k} value={k}>
              {GRAPH_CONDITION_LABELS[k]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {kind === "deposit_count_gte" || kind === "inactive_days_gte" ? (
        <Field
          id={`${id}-n`}
          label={
            kind === "deposit_count_gte" ? "Au moins combien de dépôts" : "Depuis combien de jours"
          }
        >
          <Input
            id={`${id}-n`}
            type="number"
            min={1}
            value={numStr(c.n)}
            onChange={(e) => set({ n: e.target.value ? Number(e.target.value) : "" })}
          />
        </Field>
      ) : null}
      {kind === "spend_level_in" ? (
        <CheckList
          legend="Niveaux"
          items={SPEND_LEVELS.map((l) => ({ value: l, label: SPEND_LEVEL_LABELS[l] }))}
          value={strList(c.levels)}
          onChange={(v) => set({ levels: v })}
        />
      ) : null}
      {kind === "language_in" ? (
        <LanguageChecklist
          legend="Langues"
          available={options.languages}
          value={strList(c.languages)}
          onChange={(v) => set({ languages: v })}
        />
      ) : null}
      {kind === "has_tag" ? (
        <Field id={`${id}-tag`} label="Étiquette">
          <Input
            id={`${id}-tag`}
            list={`${id}-tags`}
            value={str(c.tag)}
            maxLength={40}
            onChange={(e) => set({ tag: e.target.value })}
          />
          <datalist id={`${id}-tags`}>
            {options.tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
      ) : null}
      {kind === "in_channel" ? (
        <Field id={`${id}-ch`} label="Canal">
          <NativeSelect
            id={`${id}-ch`}
            value={str(c.channelId)}
            onChange={(e) => set({ channelId: e.target.value })}
            wrapperClassName="w-full"
          >
            <option value="">Choisissez…</option>
            {options.channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.title}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      {kind === "campaign_in" ? (
        <CheckList
          legend="Campagnes"
          items={options.campaigns.map((k) => ({ value: k.id, label: k.name }))}
          value={strList(c.campaignIds)}
          onChange={(v) => set({ campaignIds: v })}
          empty="Aucune campagne."
        />
      ) : null}
    </div>
  );
}

/** Données d'une action quand on en change la nature (le texte est gardé s'il a encore un sens). */
function actionDefaults(
  type: GraphActionType,
  prev: Record<string, unknown>,
): Record<string, unknown> {
  const text = str(prev.text);
  switch (type) {
    case "send_message":
      return { type, text };
    case "notify_team":
      return { type, text };
    case "suggest_channel":
      return { type, channelId: "", text };
    case "tag":
      return { type, tag: "" };
    case "send_sequence":
      return { type, trigger: "" };
  }
}

function ActionForm({
  data,
  onChange,
  options,
}: {
  data: DraftNodeData;
  onChange: (d: DraftNodeData) => void;
  options: EditorOptions;
}) {
  const id = useId();
  const a = data.action ?? {};
  const type = str(a.type) as GraphActionType | "";
  const set = (patch: Record<string, unknown>) => onChange({ action: { ...a, ...patch } });
  const [buttons, setButtons] = useState<ButtonEntry[]>(() =>
    buttonsToEntries(Array.isArray(a.buttons) ? (a.buttons as ButtonRows) : []),
  );
  const filled = buttons.filter((b) => b.text.trim() || b.url.trim());
  const bot = options.bots.find((b) => b.id === a.botId);
  const verticals = [...new Set(options.bots.map((b) => b.vertical))];
  const vertical = toVertical(bot?.vertical ?? (verticals.length === 1 ? verticals[0] : undefined));
  return (
    <div className="space-y-4">
      <Field
        id={`${id}-type`}
        label="Ce que fait le bloc"
        help={type ? GRAPH_ACTION_HELP[type] : undefined}
      >
        <NativeSelect
          id={`${id}-type`}
          value={type}
          onChange={(e) =>
            onChange({ action: actionDefaults(e.target.value as GraphActionType, a) })
          }
          aria-describedby={type ? `${id}-type-help` : undefined}
          wrapperClassName="w-full"
        >
          {GRAPH_ACTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {GRAPH_ACTION_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {type === "send_message" ? (
        <>
          <MessageField
            id={`${id}-text`}
            label="Message"
            value={str(a.text)}
            onChange={(text) => set({ text })}
            buttons={filled.map((b) => [{ text: b.text.trim(), url: b.url.trim() }])}
            mediaCount={a.mediaAssetId ? 1 : 0}
            context={{ vertical, ...(a.mediaAssetId ? { hasMedia: true } : {}) }}
            layout="stack"
          />
          <AdvancedSection
            title="Boutons, bot et média"
            modifiedCount={(filled.length ? 1 : 0) + (a.botId ? 1 : 0) + (a.mediaAssetId ? 1 : 0)}
          >
            <LinkButtonsField
              entries={buttons}
              onChange={(next) => {
                setButtons(next);
                // Tel que saisi (lignes vides retirées) : un bouton incomplet est signalé sur le bloc et bloque
                // l'enregistrement (validation de l'éditeur), au lieu d'être perdu en silence.
                const rows = next
                  .filter((b) => b.text.trim() || b.url.trim())
                  .map((b) => [{ text: b.text.trim(), url: b.url.trim() }]);
                set({ buttons: rows.length ? rows : undefined });
              }}
            />
            <Field id={`${id}-bot`} label="Bot qui écrit">
              <NativeSelect
                id={`${id}-bot`}
                value={str(a.botId)}
                onChange={(e) => set({ botId: e.target.value || null })}
                wrapperClassName="w-full"
              >
                <option value="">Le bot du canal</option>
                {options.bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    @{b.username}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={`${id}-media`} label="Image ou vidéo jointe">
              <NativeSelect
                id={`${id}-media`}
                value={str(a.mediaAssetId)}
                onChange={(e) => set({ mediaAssetId: e.target.value || null })}
                wrapperClassName="w-full"
              >
                <option value="">Aucune</option>
                {options.media.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.filename}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </AdvancedSection>
        </>
      ) : null}
      {type === "send_sequence" ? (
        <Field
          id={`${id}-seq`}
          label="Message du bot à envoyer"
          help="Le texte réglé dans la fiche du canal (Ce que dit le bot)."
        >
          <NativeSelect
            id={`${id}-seq`}
            value={str(a.trigger)}
            onChange={(e) => set({ trigger: e.target.value })}
            aria-describedby={`${id}-seq-help`}
            wrapperClassName="w-full"
          >
            <option value="">Choisissez…</option>
            {Object.entries(GRAPH_SEQUENCE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      {type === "tag" ? (
        <Field id={`${id}-tag`} label="Étiquette à poser">
          <Input
            id={`${id}-tag`}
            list={`${id}-tags`}
            value={str(a.tag)}
            maxLength={40}
            onChange={(e) => set({ tag: e.target.value })}
          />
          <datalist id={`${id}-tags`}>
            {options.tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
      ) : null}
      {type === "suggest_channel" ? (
        <>
          <Field id={`${id}-ch`} label="Canal à proposer">
            <NativeSelect
              id={`${id}-ch`}
              value={str(a.channelId)}
              onChange={(e) => set({ channelId: e.target.value })}
              wrapperClassName="w-full"
            >
              <option value="">Choisissez…</option>
              {options.channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id={`${id}-sugg`}
            label="Texte (facultatif)"
            help="{canal_propose} est remplacé par le nom du canal ; un bouton pour le rejoindre est ajouté."
          >
            <Textarea
              id={`${id}-sugg`}
              rows={3}
              value={str(a.text)}
              onChange={(e) => set({ text: e.target.value })}
              aria-describedby={`${id}-sugg-help`}
            />
          </Field>
        </>
      ) : null}
      {type === "notify_team" ? (
        <Field
          id={`${id}-team`}
          label="Texte de la notification"
          help="Envoyé à l'équipe sur Telegram, avec le nom du membre."
        >
          <Textarea
            id={`${id}-team`}
            rows={3}
            value={str(a.text)}
            onChange={(e) => set({ text: e.target.value })}
            aria-describedby={`${id}-team-help`}
          />
        </Field>
      ) : null}
    </div>
  );
}

function WaitForm({
  data,
  onChange,
}: {
  data: DraftNodeData;
  onChange: (d: DraftNodeData) => void;
}) {
  const id = useId();
  const initial = hoursToDelay(data.hours ?? null);
  const [value, setValue] = useState(initial.value);
  const [unit, setUnit] = useState<DelayUnit>(initial.unit);
  const update = (v: string, u: DelayUnit) => {
    setValue(v);
    setUnit(u);
    onChange({ hours: delayToHours(v, u) });
  };
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-body font-medium text-foreground">Durée de la pause</legend>
      <div className="flex gap-2">
        <Input
          id={`${id}-v`}
          type="number"
          min={1}
          step="any"
          value={value}
          onChange={(e) => update(e.target.value, unit)}
          aria-label="Durée"
          aria-describedby={`${id}-help`}
          className="w-28"
        />
        <NativeSelect
          id={`${id}-u`}
          aria-label="Unité"
          value={unit}
          onChange={(e) => update(value, e.target.value as DelayUnit)}
        >
          <option value="hours">heures</option>
          <option value="days">jours</option>
        </NativeSelect>
      </div>
      <p id={`${id}-help`} className="text-note text-muted-foreground">
        De 1 heure à 90 jours. Les conditions qui suivent sont vérifiées après la pause.
      </p>
    </fieldset>
  );
}

/** Suite d'une sortie : relier à un bloc existant, « fin de la relance », ou ajouter un bloc neuf ici. */
function ExitRow({
  draft,
  node,
  handle,
  target,
  names,
  onConnect,
  onInsert,
}: {
  draft: Draft;
  node: DraftNode;
  handle: GraphHandle;
  target: string | null;
  names: GraphNames;
  onConnect: (source: string, handle: GraphHandle, target: string | null) => void;
  onInsert: (source: string, handle: GraphHandle, key: PaletteKey) => void;
}) {
  const id = useId();
  const candidates = draft.nodes.filter((n) => n.type !== "trigger" && n.id !== node.id);
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-2.5">
      <Label htmlFor={id} className={cn(handle === "yes" && "text-success")}>
        {EXIT_TITLES[handle]}
      </Label>
      <NativeSelect
        id={id}
        value={target ?? ""}
        onChange={(e) => onConnect(node.id, handle, e.target.value || null)}
        wrapperClassName="w-full"
      >
        <option value="">Fin de la relance</option>
        {candidates.map((n) => {
          const ok = n.id === target || canConnect(draft, node.id, handle, n.id);
          return (
            <option key={n.id} value={n.id} disabled={!ok}>
              {draftNodeLabel(n, names)}
              {ok ? "" : " (ferait une boucle)"}
            </option>
          );
        })}
      </NativeSelect>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="ghost" size="sm" className="max-md:h-10">
              <Plus aria-hidden />
              Ajouter un bloc ici
              <span className="sr-only"> ({EXIT_TITLES[handle].toLowerCase()})</span>
            </Button>
          }
        />
        <DropdownMenuContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{EXIT_TITLES[handle]} : ajouter</DropdownMenuLabel>
            {PALETTE.map((p) => (
              <DropdownMenuItem
                key={p.key}
                disabled={!canInsertAfter(draft, node.id, handle, p.key)}
                onClick={() => onInsert(node.id, handle, p.key)}
              >
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function IssueList({ issues }: { issues: GraphIssue[] }) {
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return (
    <div className="space-y-2">
      {errors.length ? (
        <Alert variant="destructive" role="status">
          <CircleAlert aria-hidden />
          <AlertDescription>
            <ul className="space-y-0.5">
              {errors.map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {warnings.length ? (
        <Alert variant="warning" role="status">
          <TriangleAlert aria-hidden />
          <AlertDescription>
            <ul className="space-y-0.5">
              {warnings.map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * Panneau de réglage du bloc choisi (à droite du canevas) : formulaire simple selon le type, problèmes à corriger,
 * suites de chaque sortie (relier, fin, ajouter un bloc ici) et « Supprimer ce bloc ». Tout se fait au clavier.
 * Le formulaire est recréé à chaque changement de bloc (`key` = identifiant du bloc).
 */
export function NodePanel({
  draft,
  node,
  rule,
  onRuleChange,
  options,
  names,
  issues,
  onChangeData,
  onConnect,
  onInsert,
  onRemove,
  onClose,
}: {
  draft: Draft;
  node: DraftNode;
  rule: RuleState;
  onRuleChange: (patch: Partial<RuleState>) => void;
  options: EditorOptions;
  names: GraphNames;
  issues: GraphIssue[];
  onChangeData: (id: string, data: DraftNodeData) => void;
  onConnect: (source: string, handle: GraphHandle, target: string | null) => void;
  onInsert: (source: string, handle: GraphHandle, key: PaletteKey) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const change = (d: DraftNodeData) => onChangeData(node.id, d);
  const exits = exitsOf(draft, node.id);
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Revenir à la liste des blocs"
          title="Revenir à la liste des blocs"
        >
          <ArrowLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-note font-medium text-muted-foreground">
            <span
              aria-hidden
              className={cn(
                "flex size-5 items-center justify-center rounded-md [&>svg]:size-3.5",
                NODE_TONES[node.type],
              )}
            >
              {nodeIcon(node.type, node.data)}
            </span>
            {GRAPH_NODE_LABELS[node.type]}
          </p>
          <h2 className="mt-0.5 text-body font-semibold break-words text-foreground">
            {node.type === "trigger" ? "Départ de la relance" : draftNodeLabel(node, names)}
          </h2>
        </div>
      </div>
      <IssueList issues={issues} />
      {node.type === "trigger" ? (
        <TriggerForm rule={rule} onChange={onRuleChange} options={options} />
      ) : node.type === "condition" ? (
        <ConditionForm data={node.data} onChange={change} options={options} />
      ) : node.type === "action" ? (
        <ActionForm data={node.data} onChange={change} options={options} />
      ) : node.type === "wait" ? (
        <WaitForm data={node.data} onChange={change} />
      ) : (
        <p className="text-body text-muted-foreground">
          La relance s&apos;arrête ici pour ce membre : rien ne part après ce bloc.
        </p>
      )}
      {exits.length ? (
        <section aria-label="Suite du parcours" className="space-y-2">
          <h3 className="text-body font-semibold text-foreground">Suite</h3>
          {exits.map((x) => (
            <ExitRow
              key={x.handle}
              draft={draft}
              node={node}
              handle={x.handle}
              target={x.target}
              names={names}
              onConnect={onConnect}
              onInsert={onInsert}
            />
          ))}
          <p className="text-note text-muted-foreground">
            {node.type === "condition"
              ? `« ${GRAPH_HANDLE_LABELS.yes} » et « ${GRAPH_HANDLE_LABELS.no} » : une seule suite chacun. Sans suite, la relance s'arrête de ce côté.`
              : "Sans suite, la relance s'arrête après ce bloc."}
          </p>
        </section>
      ) : null}
      {node.type !== "trigger" ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => onRemove(node.id)}
          className="max-md:h-10"
        >
          <Trash2 aria-hidden />
          Supprimer ce bloc
        </Button>
      ) : null}
    </div>
  );
}
