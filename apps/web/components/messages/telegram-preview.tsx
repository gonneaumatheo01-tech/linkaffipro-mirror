"use client";

import { useMemo } from "react";
import { ImageIcon } from "lucide-react";
import { validateTelegramHtml } from "@linkaffipro/core";
import { cn } from "@/components/ui/cn";

const SPOILER =
  '<span class="rounded bg-foreground/80 px-1 text-transparent transition hover:bg-transparent hover:text-inherit">';

/**
 * Rendu approché d'un message Telegram (HTML validé uniquement) : bulle blanche à gauche sur fond de discussion
 * (comme un message de canal ou de bot reçu par le membre), médias,
 * boutons sous le message. `compact` : version réduite (galerie de modèles, volet du calendrier), texte coupé
 * après quelques lignes, sans compteur de caractères.
 */
export function TelegramPreview({
  html,
  buttons,
  mediaCount,
  compact = false,
  className,
}: {
  html: string;
  buttons: Array<Array<{ text: string }>>;
  mediaCount: number;
  compact?: boolean;
  className?: string;
}) {
  const safe = useMemo(() => {
    const r = validateTelegramHtml(html);
    if (!r.ok) return { ok: false as const, error: r.error };
    const rendered = r.html
      .replace(/<tg-spoiler>/g, SPOILER)
      .replace(/<\/tg-spoiler>/g, "</span>")
      .replace(/<span class="tg-spoiler">/g, SPOILER)
      .replace(
        /<blockquote( expandable)?>/g,
        '<blockquote class="border-l-2 border-border pl-2 text-muted-foreground">',
      )
      .replace(
        /<pre( language="[^"]*")?>/g,
        '<pre class="rounded bg-muted p-2 font-mono text-note whitespace-pre-wrap">',
      )
      .replace(
        /<code( class="[^"]*")?>/g,
        '<code class="rounded bg-muted px-1 font-mono text-note">',
      )
      .replace(
        /<a href="/g,
        '<a target="_blank" rel="noopener" class="text-info underline" href="',
      );
    return { ok: true as const, html: rendered, length: r.textLength };
  }, [html]);
  const shownButtons = compact ? buttons.slice(0, 2) : buttons;
  return (
    <div
      data-slot="telegram-preview"
      className={cn("rounded-xl border border-border bg-muted", compact ? "p-2" : "p-4", className)}
    >
      <div
        className={cn(
          "mr-auto w-full rounded-2xl rounded-tl-sm bg-surface text-body text-foreground shadow-xs",
          compact ? "p-2.5" : "max-w-md p-3",
        )}
      >
        {mediaCount > 0 ? (
          <div
            className={cn(
              "mb-2 flex items-center justify-center gap-1.5 rounded-lg bg-muted px-3 text-note text-muted-foreground",
              compact ? "py-3" : "py-6",
            )}
          >
            <ImageIcon aria-hidden className="size-4" />
            {mediaCount} média{mediaCount > 1 ? "s" : ""}
          </div>
        ) : null}
        {safe.ok ? (
          <div
            className={cn(
              "break-words whitespace-pre-wrap",
              compact && "line-clamp-5 text-note leading-5",
            )}
            dangerouslySetInnerHTML={{
              __html: safe.html || "<span class='text-muted-foreground'>(texte vide)</span>",
            }}
          />
        ) : (
          <p className="text-danger">{safe.error}</p>
        )}
        {shownButtons.length > 0 ? (
          <div className="mt-2 space-y-1">
            {shownButtons.map((row, i) => (
              <div key={i} className="flex gap-1">
                {row.map((b, j) => (
                  <div
                    key={j}
                    className="flex-1 truncate rounded-md bg-info-soft px-2 py-1.5 text-center text-note font-medium text-info"
                  >
                    {b.text || "…"}
                  </div>
                ))}
              </div>
            ))}
            {compact && buttons.length > shownButtons.length ? (
              <p className="text-center text-note text-muted-foreground">
                + {buttons.length - shownButtons.length} ligne
                {buttons.length - shownButtons.length > 1 ? "s" : ""} de boutons
              </p>
            ) : null}
          </div>
        ) : null}
        {!compact ? (
          <div className="mt-1 text-right text-note text-muted-foreground tabular-nums">
            {safe.ok ? `${safe.length} caractères` : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}
