"use client";

import { useMemo } from "react";
import { validateTelegramHtml } from "@linkaffipro/core";

/** Rendu approximatif d'un message Telegram (HTML validé uniquement). */
export function TelegramPreview({ html, buttons, mediaCount }: { html: string; buttons: Array<Array<{ text: string }>>; mediaCount: number }) {
  const safe = useMemo(() => {
    const r = validateTelegramHtml(html);
    if (!r.ok) return { ok: false as const, error: r.error };
    const rendered = r.html
      .replace(/<tg-spoiler>/g, '<span class="rounded bg-foreground/80 px-1 text-transparent hover:text-inherit hover:bg-transparent transition">')
      .replace(/<\/tg-spoiler>/g, "</span>")
      .replace(/<span class="tg-spoiler">/g, '<span class="rounded bg-foreground/80 px-1 text-transparent hover:text-inherit hover:bg-transparent transition">')
      .replace(/<blockquote( expandable)?>/g, '<blockquote class="border-l-2 pl-2 text-muted-foreground">')
      .replace(/<pre( language="[^"]*")?>/g, '<pre class="rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap">')
      .replace(/<code( class="[^"]*")?>/g, '<code class="rounded bg-muted px-1 font-mono text-xs">')
      .replace(/<a href="/g, '<a target="_blank" rel="noopener" class="text-blue-600 underline" href="');
    return { ok: true as const, html: rendered, length: r.textLength };
  }, [html]);
  return (
    <div className="rounded-xl border bg-[#e7ebf0] p-4">
      <div className="ml-auto w-full max-w-md rounded-2xl rounded-tr-sm bg-white p-3 text-sm shadow-sm">
        {mediaCount > 0 ? <div className="mb-2 rounded-lg bg-muted px-3 py-6 text-center text-xs text-muted-foreground">{mediaCount} média{mediaCount > 1 ? "s" : ""}</div> : null}
        {safe.ok ? (
          <div className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: safe.html || "<span class='text-muted-foreground'>(texte vide)</span>" }} />
        ) : (
          <p className="text-destructive">{safe.error}</p>
        )}
        {buttons.length > 0 ? (
          <div className="mt-2 space-y-1">
            {buttons.map((row, i) => (
              <div key={i} className="flex gap-1">
                {row.map((b, j) => (
                  <div key={j} className="flex-1 truncate rounded-md bg-[#f1f5f9] px-2 py-1.5 text-center text-xs font-medium text-blue-600">{b.text || "…"}</div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-1 text-right text-[10px] text-muted-foreground">{safe.ok ? `${safe.length} car.` : ""}</div>
      </div>
    </div>
  );
}
