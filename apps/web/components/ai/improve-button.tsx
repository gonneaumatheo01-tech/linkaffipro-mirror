"use client";

import { useCallback, useId, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import {
  AI_LABELS,
  AI_LANGUAGES,
  AI_LENGTHS,
  AI_OBJECTIVES,
  AI_TONES,
  type AiKind,
  type AiLanguage,
  type AiLength,
  type AiObjective,
  type AiSurface,
  type AiTone,
  type AiVersion,
  type AiVertical,
} from "@linkaffipro/ai/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { contextLine, toAiLanguage, translationAction } from "./improve-logic";

/** Contexte connu du formulaire qui héberge le bouton (tout est facultatif sauf `surface`). */
export type ImproveContext = {
  vertical?: AiVertical | null;
  categoryId?: string | null;
  categoryName?: string | null;
  language?: string | null;
  /** Média joint au message. `undefined` : l'hôte ne le sait pas, le panneau propose la case « Message avec média ». */
  hasMedia?: boolean;
  surface: AiSurface;
};

export type ImproveButtonProps = {
  /** Texte actuel du champ (HTML Telegram). */
  getText: () => string;
  /** Remplace le texte du champ par la version choisie. */
  setText: (text: string) => void;
  context: ImproveContext;
  /** Si fourni : boutons « Créer la version B d'un test A/B » et « Comme version B » (reçoit le texte de la version B). */
  onCreateVariantB?: (text: string) => void;
  /**
   * Si fourni : l'hôte gère plusieurs langues (textes du bot) et enregistre les traductions reçues ({ en: "…", es: "…" }).
   * Sans lui, une traduction dans une autre langue que celle du champ se copie (elle n'écrase jamais le champ).
   */
  onTranslations?: (texts: Partial<Record<AiLanguage, string>>) => void | Promise<void>;
  /** Libellé du bouton (par défaut « ✨ Améliorer avec l'IA »). */
  label?: string;
  size?: "default" | "sm" | "xs";
  className?: string;
};

type Status = { ready: boolean; reason?: "no_key" | "cap"; message?: string; hasQuality?: boolean };
type Result = {
  id: string;
  versions: AiVersion[];
  model: string;
  costEur: number;
  kind: AiKind;
  fromVersion: number | null;
};

const selectCls = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";
const VERTICALS: AiVertical[] = ["CASINO", "SPORTS", "DATING"];
/** Retouches proposées sur chaque version et sur le texte du champ. */
const REWORKS: Array<{ kind: AiKind; label: string }> = [
  { kind: "shorter", label: "Plus court" },
  { kind: "punchier", label: "Plus percutant" },
  { kind: "angle", label: "Autre angle" },
];

/**
 * Bouton « ✨ Améliorer avec l'IA » + panneau : réglages (univers, objectif, ton, longueur, langue, média), 3 versions,
 * retouches par version (plus court, plus percutant, autre angle), traduction dans les langues du bot, version B,
 * mode « Écrire à partir d'une idée ». La rangée du bas retravaille le texte actuellement dans le champ.
 */
export function ImproveButton({
  getText,
  setText,
  context,
  onCreateVariantB,
  onTranslations,
  label = "✨ Améliorer avec l'IA",
  size = "sm",
  className,
}: ImproveButtonProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"improve" | "idea">("improve");
  const [vertical, setVertical] = useState<AiVertical | "">(context.vertical ?? "");
  const [objective, setObjective] = useState<AiObjective>("offer_click");
  const [tone, setTone] = useState<AiTone>("friendly");
  const [length, setLength] = useState<AiLength>("medium");
  const [language, setLanguage] = useState<AiLanguage>(toAiLanguage(context.language));
  const [withMedia, setWithMedia] = useState(Boolean(context.hasMedia));
  const [quality, setQuality] = useState(false);
  const [idea, setIdea] = useState("");
  /** Demande en cours : `kind` + version d'origine (null = texte du champ). */
  const [loading, setLoading] = useState<{ kind: AiKind; from: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mediaKnown = context.hasMedia !== undefined;
  const hasMedia = mediaKnown ? Boolean(context.hasMedia) : withMedia;

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        setError(null);
        setNotice(null);
        setVertical(context.vertical ?? "");
        setLanguage(toAiLanguage(context.language));
        if (context.hasMedia !== undefined) setWithMedia(Boolean(context.hasMedia));
        if (!status) {
          fetch("/api/ai/suggest", { cache: "no-store" })
            .then((r) => (r.ok ? (r.json() as Promise<Status>) : { ready: false as const }))
            .then(setStatus)
            .catch(() => setStatus({ ready: false }));
        }
      }
    },
    [context.vertical, context.language, context.hasMedia, status],
  );

  /** Lance une demande sur `sourceText` (texte d'une version ou idée) ou, à défaut, sur le texte du champ. */
  const run = useCallback(
    async (kind: AiKind, sourceText?: string, fromVersion: number | null = null) => {
      const text = (sourceText ?? getText()).trim();
      if (!text) {
        setError(
          kind === "idea"
            ? "Écrivez d'abord votre idée en une phrase."
            : "Le champ est vide : écrivez d'abord un brouillon, ou utilisez « Écrire à partir d'une idée ».",
        );
        return;
      }
      setLoading({ kind, from: fromVersion });
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/ai/suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind,
            text,
            quality,
            context: {
              vertical: vertical || null,
              categoryId: context.categoryId ?? null,
              categoryName: context.categoryName ?? null,
              language,
              objective,
              tone,
              length,
              hasMedia,
              surface: context.surface,
            },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          id?: string;
          versions?: AiVersion[];
          model?: string;
          costEur?: number;
          error?: string;
          code?: string;
        };
        if (!res.ok || !data.id || !data.versions) {
          if (res.status === 428) setStatus({ ready: false, reason: "no_key" });
          setError(data.error ?? "L'assistant n'a pas répondu. Réessayez dans un instant.");
          return;
        }
        setResult({
          id: data.id,
          versions: data.versions,
          model: data.model ?? "",
          costEur: data.costEur ?? 0,
          kind,
          fromVersion,
        });
      } catch {
        setError("Connexion impossible. Vérifiez le réseau et réessayez.");
      } finally {
        setLoading(null);
      }
    },
    [
      getText,
      quality,
      vertical,
      context.categoryId,
      context.categoryName,
      context.surface,
      hasMedia,
      language,
      objective,
      tone,
      length,
    ],
  );

  const markUsed = useCallback((suggestionId: string, index: number) => {
    void fetch("/api/ai/used", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: suggestionId, index }),
    }).catch(() => undefined);
  }, []);

  const use = useCallback(
    (index: number, target: "editor" | "variantB") => {
      if (!result) return;
      const v = result.versions[index];
      if (!v) return;
      if (target === "variantB" && onCreateVariantB) onCreateVariantB(v.text);
      else setText(v.text);
      markUsed(result.id, index);
      setNotice(
        target === "variantB"
          ? `Version ${index + 1} placée en version B du test A/B.`
          : `Version ${index + 1} placée dans le champ.`,
      );
    },
    [result, onCreateVariantB, setText, markUsed],
  );

  /** Traductions : enregistre une langue (index) ou toutes (index null) chez l'hôte. */
  const saveTranslations = useCallback(
    async (index: number | null) => {
      if (!result || !onTranslations) return;
      const picked =
        index === null
          ? result.versions
          : [result.versions[index]].filter((v): v is AiVersion => Boolean(v));
      const texts: Partial<Record<AiLanguage, string>> = {};
      for (const v of picked) if (v.lang && v.lang !== language) texts[v.lang] = v.text;
      const langs = Object.keys(texts) as AiLanguage[];
      if (langs.length === 0) return;
      setSaving(true);
      setError(null);
      try {
        await onTranslations(texts);
        markUsed(result.id, index ?? 0);
        setNotice(
          `Traduction${langs.length > 1 ? "s" : ""} enregistrée${langs.length > 1 ? "s" : ""} : ${langs.map((l) => AI_LABELS.language[l]).join(", ")}.`,
        );
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Enregistrement impossible. Réessayez.",
        );
      } finally {
        setSaving(false);
      }
    },
    [result, onTranslations, language, markUsed],
  );

  const copy = useCallback((v: AiVersion) => {
    const name = v.lang ? AI_LABELS.language[v.lang] : "";
    navigator.clipboard
      ?.writeText(v.text)
      .then(() =>
        setNotice(
          `Traduction${name ? ` (${name})` : ""} copiée : collez-la dans le champ de cette langue.`,
        ),
      )
      .catch(() => setError("Copie impossible : sélectionnez le texte et copiez-le à la main."));
  }, []);

  const busy = loading !== null;
  const unavailable = status && !status.ready;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={className}
        onClick={() => onOpenChange(true)}
      >
        <Sparkles aria-hidden="true" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assistant d&apos;écriture</DialogTitle>
            <DialogDescription>
              Trois versions de votre message, avec un angle différent chacune. Règles appliquées
              d&apos;office : pas de promesse de gains, mention des risques et 18+ (casino, paris),
              aucun détail d&apos;offre inventé, repères et liens conservés.
            </DialogDescription>
          </DialogHeader>

          {unavailable ? (
            <div role="status" className="rounded-md border bg-muted/40 p-3 text-sm">
              {status?.reason === "cap" ? (
                <>
                  <p className="font-medium">{status.message ?? "Plafond mensuel atteint."}</p>
                  <p className="mt-1 text-muted-foreground">
                    Un administrateur peut relever le plafond dans Réglages → IA.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">L&apos;assistant n&apos;est pas encore activé.</p>
                  <p className="mt-1 text-muted-foreground">
                    Un administrateur doit coller la clé Anthropic dans Réglages → IA (5 minutes,
                    guide sur la page).
                  </p>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                render={<Link href="/settings/ai" />}
              >
                Ouvrir Réglages → IA
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Mode">
                <Button
                  type="button"
                  role="tab"
                  aria-selected={mode === "improve"}
                  size="sm"
                  variant={mode === "improve" ? "default" : "outline"}
                  onClick={() => setMode("improve")}
                >
                  Améliorer mon brouillon
                </Button>
                <Button
                  type="button"
                  role="tab"
                  aria-selected={mode === "idea"}
                  size="sm"
                  variant={mode === "idea" ? "default" : "outline"}
                  onClick={() => setMode("idea")}
                >
                  Écrire à partir d&apos;une idée
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <label htmlFor={`${id}-vertical`} className="text-xs font-medium">
                    Univers
                  </label>
                  <select
                    id={`${id}-vertical`}
                    className={selectCls}
                    value={vertical}
                    onChange={(e) => setVertical(e.target.value as AiVertical | "")}
                  >
                    <option value="">Non précisé</option>
                    {VERTICALS.map((v) => (
                      <option key={v} value={v}>
                        {AI_LABELS.vertical[v]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${id}-objective`} className="text-xs font-medium">
                    Objectif
                  </label>
                  <select
                    id={`${id}-objective`}
                    className={selectCls}
                    value={objective}
                    onChange={(e) => setObjective(e.target.value as AiObjective)}
                  >
                    {AI_OBJECTIVES.map((o) => (
                      <option key={o} value={o}>
                        {AI_LABELS.objective[o]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${id}-tone`} className="text-xs font-medium">
                    Ton
                  </label>
                  <select
                    id={`${id}-tone`}
                    className={selectCls}
                    value={tone}
                    onChange={(e) => setTone(e.target.value as AiTone)}
                  >
                    {AI_TONES.map((t) => (
                      <option key={t} value={t}>
                        {AI_LABELS.tone[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${id}-length`} className="text-xs font-medium">
                    Longueur
                  </label>
                  <select
                    id={`${id}-length`}
                    className={selectCls}
                    value={length}
                    onChange={(e) => setLength(e.target.value as AiLength)}
                  >
                    {AI_LENGTHS.map((l) => (
                      <option key={l} value={l}>
                        {AI_LABELS.length[l]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${id}-language`} className="text-xs font-medium">
                    Langue
                  </label>
                  <select
                    id={`${id}-language`}
                    className={selectCls}
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as AiLanguage)}
                  >
                    {AI_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {AI_LABELS.language[l]}
                      </option>
                    ))}
                  </select>
                </div>
                {status?.hasQuality ? (
                  <label className="flex items-end gap-2 pb-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={quality}
                      onChange={(e) => setQuality(e.target.checked)}
                      className="size-4"
                    />
                    Qualité supérieure (plus lent, plus cher)
                  </label>
                ) : null}
                {!mediaKnown ? (
                  <label className="flex items-end gap-2 pb-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={withMedia}
                      onChange={(e) => setWithMedia(e.target.checked)}
                      className="size-4"
                    />
                    Message avec média (photo, vidéo…)
                  </label>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {contextLine({ categoryName: context.categoryName, hasMedia })}
              </p>

              {mode === "idea" ? (
                <div className="space-y-1">
                  <label htmlFor={`${id}-idea`} className="text-xs font-medium">
                    Votre idée, en une phrase
                  </label>
                  <Textarea
                    id={`${id}-idea`}
                    rows={2}
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder="Ex. : rappeler le bonus du week-end aux membres qui n'ont pas encore cliqué"
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Le brouillon est lu dans le champ du formulaire. Pour les repères comme{" "}
                  {"{prenom}"}, rien ne change : ils sont conservés.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => (mode === "idea" ? run("idea", idea) : run("improve"))}
                >
                  {loading && (loading.kind === "improve" || loading.kind === "idea") ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles aria-hidden="true" />
                  )}
                  {mode === "idea" ? "Proposer 3 messages" : "Générer 3 versions"}
                </Button>
                {busy ? (
                  <span className="text-xs text-muted-foreground">
                    L&apos;assistant écrit… (quelques secondes)
                  </span>
                ) : null}
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive"
                >
                  {error}
                </p>
              ) : null}

              <div aria-live="polite" aria-busy={busy || saving} className="space-y-3">
                {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
                {result ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">
                        {result.kind === "translate"
                          ? "Traductions"
                          : result.kind === "ab_variant"
                            ? "Candidates pour la version B"
                            : "Versions proposées"}
                        {result.fromVersion !== null ? (
                          <span className="ml-1 font-normal">
                            (à partir de la version {result.fromVersion + 1})
                          </span>
                        ) : null}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({result.model}, ≈{" "}
                          {result.costEur < 0.01
                            ? "< 0,01"
                            : result.costEur.toFixed(2).replace(".", ",")}{" "}
                          €)
                        </span>
                      </h3>
                      {result.kind === "translate" &&
                      onTranslations &&
                      result.versions.filter((v) => v.lang && v.lang !== language).length > 1 ? (
                        <Button
                          type="button"
                          size="xs"
                          disabled={saving}
                          onClick={() => void saveTranslations(null)}
                        >
                          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                          Enregistrer toutes les traductions
                        </Button>
                      ) : null}
                    </div>
                    <ol className="space-y-3">
                      {result.versions.map((v, i) => {
                        const name = v.lang ? AI_LABELS.language[v.lang] : `Version ${i + 1}`;
                        const tr =
                          result.kind === "translate" && v.lang
                            ? translationAction(v.lang, language, Boolean(onTranslations))
                            : null;
                        return (
                          <li key={`${result.id}-${i}`} className="rounded-md border p-3">
                            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-medium">
                                {name}
                                <span className="ml-2 font-normal text-muted-foreground">
                                  {v.why}
                                </span>
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {tr === "save" ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    disabled={saving}
                                    onClick={() => void saveTranslations(i)}
                                    aria-label={`Utiliser la traduction (${name}) dans cette langue`}
                                  >
                                    Utiliser
                                  </Button>
                                ) : tr === "copy" ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    onClick={() => copy(v)}
                                    aria-label={`Copier la traduction (${name})`}
                                  >
                                    Copier
                                  </Button>
                                ) : result.kind === "ab_variant" && onCreateVariantB ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    onClick={() => use(i, "variantB")}
                                  >
                                    Utiliser comme version B
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    size="xs"
                                    onClick={() => use(i, "editor")}
                                    aria-label={`Utiliser ${name.toLowerCase()}`}
                                  >
                                    Utiliser
                                  </Button>
                                )}
                                {onCreateVariantB &&
                                result.kind !== "translate" &&
                                result.kind !== "ab_variant" ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    onClick={() => use(i, "variantB")}
                                    aria-label={`Prendre la version ${i + 1} comme version B du test A/B`}
                                  >
                                    Comme version B
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                              {v.text}
                            </pre>
                            {result.kind !== "translate" ? (
                              <div
                                className="mt-2 flex flex-wrap gap-1"
                                role="group"
                                aria-label={`Retoucher la version ${i + 1}`}
                              >
                                {REWORKS.map((r) => (
                                  <Button
                                    key={r.kind}
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => void run(r.kind, v.text, i)}
                                    aria-label={`${r.label} (à partir de la version ${i + 1})`}
                                  >
                                    {loading?.kind === r.kind && loading.from === i ? (
                                      <Loader2 className="animate-spin" aria-hidden="true" />
                                    ) : null}
                                    {r.label}
                                  </Button>
                                ))}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </>
                ) : null}
              </div>

              <div className="space-y-1 border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  Sur le texte actuellement dans le champ :
                </p>
                <div className="flex flex-wrap gap-2">
                  {REWORKS.map((r) => (
                    <Button
                      key={r.kind}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(r.kind)}
                    >
                      {loading?.kind === r.kind && loading.from === null ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : null}
                      {r.label}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run("translate")}
                  >
                    {loading?.kind === "translate" ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : null}
                    Traduire dans les langues du bot
                  </Button>
                  {onCreateVariantB ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void run("ab_variant")}
                    >
                      {loading?.kind === "ab_variant" ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : null}
                      Créer la version B d&apos;un test A/B
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
