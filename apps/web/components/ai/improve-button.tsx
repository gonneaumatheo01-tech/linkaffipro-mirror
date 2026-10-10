"use client";

import { useCallback, useId, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { AI_LABELS, AI_LANGUAGES, AI_LENGTHS, AI_OBJECTIVES, AI_TONES, type AiKind, type AiLanguage, type AiLength, type AiObjective, type AiSurface, type AiTone, type AiVersion, type AiVertical } from "@linkaffipro/ai/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/** Contexte connu du formulaire qui héberge le bouton (tout est facultatif sauf `surface`). */
export type ImproveContext = {
  vertical?: AiVertical | null;
  categoryId?: string | null;
  categoryName?: string | null;
  language?: string | null;
  hasMedia?: boolean;
  surface: AiSurface;
};

export type ImproveButtonProps = {
  /** Texte actuel du champ (HTML Telegram). */
  getText: () => string;
  /** Remplace le texte du champ par la version choisie. */
  setText: (text: string) => void;
  context: ImproveContext;
  /** Si fourni : bouton « Créer la version B d'un test A/B » (reçoit le texte de la version B). */
  onCreateVariantB?: (text: string) => void;
  /** Libellé du bouton (par défaut « ✨ Améliorer avec l'IA »). */
  label?: string;
  size?: "default" | "sm" | "xs";
  className?: string;
};

type Status = { ready: boolean; reason?: "no_key" | "cap"; message?: string; hasQuality?: boolean };
type Result = { id: string; versions: AiVersion[]; model: string; costEur: number; kind: AiKind };

const selectCls = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";
const VERTICALS: AiVertical[] = ["CASINO", "SPORTS", "DATING"];

function toLanguage(v: string | null | undefined): AiLanguage {
  return (AI_LANGUAGES as readonly string[]).includes(v ?? "") ? (v as AiLanguage) : "fr";
}

/**
 * Bouton « ✨ Améliorer avec l'IA » + panneau : réglages (univers, objectif, ton, longueur, langue), 3 versions,
 * actions en chaîne (plus court, plus percutant, autre angle, traduire, version B), mode « Écrire à partir d'une idée ».
 * Les actions en chaîne s'appliquent au texte actuel du champ (après « Utiliser », c'est la version choisie).
 */
export function ImproveButton({ getText, setText, context, onCreateVariantB, label = "✨ Améliorer avec l'IA", size = "sm", className }: ImproveButtonProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"improve" | "idea">("improve");
  const [vertical, setVertical] = useState<AiVertical | "">(context.vertical ?? "");
  const [objective, setObjective] = useState<AiObjective>("offer_click");
  const [tone, setTone] = useState<AiTone>("friendly");
  const [length, setLength] = useState<AiLength>("medium");
  const [language, setLanguage] = useState<AiLanguage>(toLanguage(context.language));
  const [quality, setQuality] = useState(false);
  const [idea, setIdea] = useState("");
  const [loading, setLoading] = useState<AiKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        setError(null);
        setNotice(null);
        setVertical(context.vertical ?? "");
        setLanguage(toLanguage(context.language));
        if (!status) {
          fetch("/api/ai/suggest", { cache: "no-store" })
            .then((r) => (r.ok ? (r.json() as Promise<Status>) : { ready: false as const }))
            .then(setStatus)
            .catch(() => setStatus({ ready: false }));
        }
      }
    },
    [context.vertical, context.language, status],
  );

  const run = useCallback(
    async (kind: AiKind, sourceText?: string) => {
      const text = (sourceText ?? getText()).trim();
      if (!text) {
        setError(kind === "idea" ? "Écrivez d'abord votre idée en une phrase." : "Le champ est vide : écrivez d'abord un brouillon, ou utilisez « Écrire à partir d'une idée ».");
        return;
      }
      setLoading(kind);
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
              hasMedia: Boolean(context.hasMedia),
              surface: context.surface,
            },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { id?: string; versions?: AiVersion[]; model?: string; costEur?: number; error?: string; code?: string };
        if (!res.ok || !data.id || !data.versions) {
          if (res.status === 428) setStatus({ ready: false, reason: "no_key" });
          setError(data.error ?? "L'assistant n'a pas répondu. Réessayez dans un instant.");
          return;
        }
        setResult({ id: data.id, versions: data.versions, model: data.model ?? "", costEur: data.costEur ?? 0, kind });
      } catch {
        setError("Connexion impossible. Vérifiez le réseau et réessayez.");
      } finally {
        setLoading(null);
      }
    },
    [getText, quality, vertical, context.categoryId, context.categoryName, context.hasMedia, context.surface, language, objective, tone, length],
  );

  const use = useCallback(
    (index: number, target: "editor" | "variantB") => {
      if (!result) return;
      const v = result.versions[index];
      if (!v) return;
      if (target === "variantB" && onCreateVariantB) onCreateVariantB(v.text);
      else setText(v.text);
      void fetch("/api/ai/used", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: result.id, index }) }).catch(() => undefined);
      setNotice(target === "variantB" ? "Version B créée à partir de cette proposition." : `Version ${index + 1} placée dans le champ. Vous pouvez la retravailler avec les boutons ci-dessous.`);
    },
    [result, onCreateVariantB, setText],
  );

  const busy = loading !== null;
  const unavailable = status && !status.ready;

  return (
    <>
      <Button type="button" variant="outline" size={size} className={className} onClick={() => onOpenChange(true)}>
        <Sparkles aria-hidden="true" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assistant d&apos;écriture</DialogTitle>
            <DialogDescription>
              Trois versions de votre message, avec un angle différent chacune. Règles appliquées d&apos;office : pas de promesse de gains, mention des risques et 18+ (casino, paris), aucun détail d&apos;offre inventé, repères et liens conservés.
            </DialogDescription>
          </DialogHeader>

          {unavailable ? (
            <div role="status" className="rounded-md border bg-muted/40 p-3 text-sm">
              {status?.reason === "cap" ? (
                <>
                  <p className="font-medium">{status.message ?? "Plafond mensuel atteint."}</p>
                  <p className="mt-1 text-muted-foreground">Un administrateur peut relever le plafond dans Réglages → IA.</p>
                </>
              ) : (
                <>
                  <p className="font-medium">L&apos;assistant n&apos;est pas encore activé.</p>
                  <p className="mt-1 text-muted-foreground">Un administrateur doit coller la clé Anthropic dans Réglages → IA (5 minutes, guide sur la page).</p>
                </>
              )}
              <Button variant="outline" size="sm" className="mt-3" render={<Link href="/settings/ai" />}>
                Ouvrir Réglages → IA
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Mode">
                <Button type="button" role="tab" aria-selected={mode === "improve"} size="sm" variant={mode === "improve" ? "default" : "outline"} onClick={() => setMode("improve")}>
                  Améliorer mon brouillon
                </Button>
                <Button type="button" role="tab" aria-selected={mode === "idea"} size="sm" variant={mode === "idea" ? "default" : "outline"} onClick={() => setMode("idea")}>
                  Écrire à partir d&apos;une idée
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <label htmlFor={`${id}-vertical`} className="text-xs font-medium">
                    Univers
                  </label>
                  <select id={`${id}-vertical`} className={selectCls} value={vertical} onChange={(e) => setVertical(e.target.value as AiVertical | "")}>
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
                  <select id={`${id}-objective`} className={selectCls} value={objective} onChange={(e) => setObjective(e.target.value as AiObjective)}>
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
                  <select id={`${id}-tone`} className={selectCls} value={tone} onChange={(e) => setTone(e.target.value as AiTone)}>
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
                  <select id={`${id}-length`} className={selectCls} value={length} onChange={(e) => setLength(e.target.value as AiLength)}>
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
                  <select id={`${id}-language`} className={selectCls} value={language} onChange={(e) => setLanguage(e.target.value as AiLanguage)}>
                    {AI_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {AI_LABELS.language[l]}
                      </option>
                    ))}
                  </select>
                </div>
                {status?.hasQuality ? (
                  <label className="flex items-end gap-2 pb-2 text-xs font-medium">
                    <input type="checkbox" checked={quality} onChange={(e) => setQuality(e.target.checked)} className="size-4" />
                    Qualité supérieure (plus lent, plus cher)
                  </label>
                ) : null}
              </div>

              {mode === "idea" ? (
                <div className="space-y-1">
                  <label htmlFor={`${id}-idea`} className="text-xs font-medium">
                    Votre idée, en une phrase
                  </label>
                  <Textarea id={`${id}-idea`} rows={2} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Ex. : rappeler le bonus du week-end aux membres qui n'ont pas encore cliqué" />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Le brouillon est lu dans le champ du formulaire. Pour les repères comme {"{prenom}"}, rien ne change : ils sont conservés.</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={busy} onClick={() => (mode === "idea" ? run("idea", idea) : run("improve"))}>
                  {busy && (loading === "improve" || loading === "idea") ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  {mode === "idea" ? "Proposer 3 messages" : "Générer 3 versions"}
                </Button>
                {busy ? <span className="text-xs text-muted-foreground">L&apos;assistant écrit… (quelques secondes)</span> : null}
              </div>

              {error ? (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div aria-live="polite" aria-busy={busy} className="space-y-3">
                {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
                {result ? (
                  <>
                    <h3 className="text-sm font-medium">
                      {result.kind === "translate" ? "Traductions" : result.kind === "ab_variant" ? "Candidates pour la version B" : "Versions proposées"}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ({result.model}, ≈ {result.costEur < 0.01 ? "< 0,01" : result.costEur.toFixed(2).replace(".", ",")} €)
                      </span>
                    </h3>
                    <ol className="space-y-3">
                      {result.versions.map((v, i) => (
                        <li key={`${result.id}-${i}`} className="rounded-md border p-3">
                          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-medium">
                              {v.lang ? AI_LABELS.language[v.lang] : `Version ${i + 1}`}
                              <span className="ml-2 font-normal text-muted-foreground">{v.why}</span>
                            </span>
                            <div className="flex gap-1">
                              {result.kind === "ab_variant" && onCreateVariantB ? (
                                <Button type="button" size="xs" onClick={() => use(i, "variantB")}>
                                  Utiliser comme version B
                                </Button>
                              ) : (
                                <Button type="button" size="xs" onClick={() => use(i, "editor")}>
                                  Utiliser
                                </Button>
                              )}
                            </div>
                          </div>
                          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{v.text}</pre>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : null}
              </div>

              <div className="space-y-1 border-t pt-3">
                <p className="text-xs text-muted-foreground">Retravailler le texte actuellement dans le champ :</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run("shorter")}>
                    {loading === "shorter" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    Plus court
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run("punchier")}>
                    {loading === "punchier" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    Plus percutant
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run("angle")}>
                    {loading === "angle" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    Autre angle
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run("translate")}>
                    {loading === "translate" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    Traduire dans les langues du bot
                  </Button>
                  {onCreateVariantB ? (
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run("ab_variant")}>
                      {loading === "ab_variant" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
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
