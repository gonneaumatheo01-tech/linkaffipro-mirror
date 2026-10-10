"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { slugify } from "@/lib/help/markdown";
import { pageHelpFor, type HelpResponse } from "@/lib/help/page-help";
import { HELP_PANEL_PROSE } from "@/lib/help/prose";
import { HelpButton } from "./help-button";
import { requestTourStart } from "./tour/tour-events";

/** Réponses déjà chargées, par entrée de la table d'aide (le volet se rouvre sans attendre). */
const loaded = new Map<string, HelpResponse>();

type LoadState = { status: "loading" } | { status: "error" } | { status: "ok"; data: HelpResponse };

/** Contenu du volet : chargé à l'ouverture (le volet n'est monté qu'ouvert), depuis GET /api/help. */
function PageHelpBody({ path, cacheKey }: { path: string; cacheKey: string }) {
  const [state, setState] = useState<LoadState>(() => {
    const hit = loaded.get(cacheKey);
    return hit ? { status: "ok", data: hit } : { status: "loading" };
  });

  useEffect(() => {
    if (loaded.has(cacheKey)) return;
    let alive = true;
    fetch(`/api/help?path=${encodeURIComponent(path)}`, { headers: { accept: "application/json" } })
      .then((r) =>
        r.ok ? (r.json() as Promise<HelpResponse>) : Promise.reject(new Error(String(r.status))),
      )
      .then((data) => {
        loaded.set(cacheKey, data);
        if (alive) setState({ status: "ok", data });
      })
      .catch(() => {
        if (alive) setState({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [path, cacheKey]);

  return (
    <div className="space-y-6">
      {state.status === "loading" ? (
        <div role="status" aria-busy="true" className="space-y-3">
          <span className="sr-only">Chargement de l&apos;aide…</span>
          {[70, 100, 92, 85, 60].map((w, i) => (
            <div
              key={i}
              aria-hidden
              className="h-4 rounded bg-muted motion-safe:animate-pulse"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="text-body text-foreground">
          L&apos;aide n&apos;a pas pu se charger. Ouvrez le guide complet avec le bouton en bas du
          volet.
        </p>
      ) : null}
      {state.status === "ok" && (state.data.missing || state.data.sections.length === 0) ? (
        <p className="text-body text-foreground">
          Le guide d&apos;utilisation n&apos;est pas disponible sur ce serveur pour le moment.
        </p>
      ) : null}
      {state.status === "ok" && state.data.sections.length > 0 ? (
        <div className={HELP_PANEL_PROSE}>
          {state.data.fallback ? (
            <p className="text-note text-muted-foreground">
              Cette page n&apos;a pas encore d&apos;aide propre : voici comment bien démarrer.
            </p>
          ) : null}
          {state.data.sections.map((s) => (
            <article
              key={s.id}
              className="space-y-3 border-b border-border pb-6 last:border-b-0 last:pb-0"
              dangerouslySetInnerHTML={{ __html: s.html }}
            />
          ))}
        </div>
      ) : null}
      <div className="rounded-xl border border-border bg-brand-soft/50 p-4">
        <p className="text-body font-semibold text-foreground">Visite guidée</p>
        <p className="mt-1 text-body text-muted-foreground">
          Deux minutes pour retrouver chaque rubrique du menu.
        </p>
        <DialogPrimitive.Close
          render={
            <Button
              variant="outline"
              className="mt-3 max-md:h-10"
              onClick={() => window.setTimeout(requestTourStart, 250)}
            />
          }
        >
          <Compass aria-hidden />
          Revoir la visite guidée
        </DialogPrimitive.Close>
      </div>
    </div>
  );
}

/**
 * Bouton « ? » de l'en-tête : ouvre dans le volet l'aide de la page courante (sections du guide choisies par
 * `lib/help/page-help.ts`, repli sur « Les 10 premières minutes »), avec « Ouvrir le guide complet » (à la bonne
 * section) et « Revoir la visite guidée ».
 */
export function HelpPanel({ className }: { className?: string }) {
  const pathname = usePathname() || "/";
  const { help, fallback } = pageHelpFor(pathname);
  const first = help.sections[0];
  const anchor = first ? slugify(typeof first === "string" ? first : first.title) : "";
  return (
    <HelpButton
      title={fallback ? "Aide" : `Aide : ${help.label}`}
      description={
        fallback
          ? "Les premiers pas, extraits du guide d'utilisation."
          : "Ce que dit le guide d'utilisation sur cette page."
      }
      guideHref={`/help${anchor ? `#${anchor}` : ""}`}
      className={className}
    >
      <PageHelpBody
        key={help.path || "default"}
        path={pathname}
        cacheKey={help.path || "default"}
      />
    </HelpButton>
  );
}
