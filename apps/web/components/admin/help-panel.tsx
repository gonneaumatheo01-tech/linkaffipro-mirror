"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { guideHref, pageHelpFor, type HelpResponse } from "@/lib/help/page-help";
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

  if (state.status === "loading")
    return (
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
    );
  if (state.status === "error")
    return (
      <p role="alert" className="text-body text-foreground">
        L&apos;aide n&apos;a pas pu se charger. Ouvrez le guide complet avec le bouton en bas du
        volet.
      </p>
    );
  if (state.data.missing || state.data.sections.length === 0)
    return (
      <p className="text-body text-foreground">
        Le guide d&apos;utilisation n&apos;est pas disponible sur ce serveur pour le moment.
      </p>
    );
  return (
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
  );
}

/**
 * « Revoir la visite guidée », dans le pied du volet : ferme le volet, puis relance la visite (après la fermeture,
 * pour que la bulle se place sur la page et non sous le volet).
 */
function TourAgainButton() {
  return (
    <DialogPrimitive.Close
      render={
        <Button
          variant="outline"
          className="max-md:h-10"
          onClick={() => window.setTimeout(requestTourStart, 250)}
        />
      }
    >
      <Compass aria-hidden />
      Revoir la visite guidée
    </DialogPrimitive.Close>
  );
}

/**
 * Bouton « ? » de l'en-tête : ouvre dans le volet l'aide de la page courante (sections du guide choisies par
 * `lib/help/page-help.ts`, repli sur « Les 10 premières minutes »). Pied du volet : « Revoir la visite guidée » et
 * « Ouvrir le guide complet » (page /help, à la première section de la page).
 */
export function HelpPanel({ className }: { className?: string }) {
  const pathname = usePathname() || "/";
  const { help, fallback } = pageHelpFor(pathname);
  return (
    <HelpButton
      title={fallback ? "Aide" : `Aide : ${help.label}`}
      description={
        fallback
          ? "Les premiers pas, extraits du guide d'utilisation."
          : "Ce que dit le guide d'utilisation sur cette page."
      }
      guideHref={guideHref(help)}
      footerExtra={<TourAgainButton />}
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
