"use client";

import { useDeferredValue, useMemo } from "react";
import { renderLandingHtml, type LandingRenderInput } from "@linkaffipro/core/landing-render";
import { cn } from "@/components/ui/cn";

/** Taille de l'écran simulé (iPhone 12 à 15) et de son dessin dans la page. */
export const PREVIEW_SCREEN = { width: 390, height: 780 } as const;
export const PREVIEW_DRAWN_WIDTH = 270;

/**
 * Aperçu téléphone en direct d'une page d'atterrissage (phase 15) : le MÊME rendu que la page publique
 * (`renderLandingHtml`, mode aperçu : aucun script, aucun envoi, aucun pixel), dans un cadre `srcDoc` à la taille d'un
 * téléphone puis réduit. Pas d'attribut `sandbox` : le contenu est le nôtre (textes strictement échappés, aucune
 * balise script en aperçu) et le cadre hérite de la politique de sécurité du site ; un cadre sans droit de script
 * bloquait le contrôle d'accessibilité (axe ne peut pas l'analyser) et la photo du canal (servie à l'équipe connectée). Mis à jour à la frappe (rendu différé pour que
 * la saisie reste fluide). Le bouton de l'aperçu ne mène nulle part.
 */
export function PhonePreview({
  input,
  drawnWidth = PREVIEW_DRAWN_WIDTH,
  title = "Aperçu de la page sur un téléphone",
  className,
}: {
  input: LandingRenderInput;
  /** Largeur dessinée de l'écran (px) : 270 à côté du formulaire, plus grand dans « Voir la page ». */
  drawnWidth?: number;
  /** Nom du cadre pour les lecteurs d'écran (unique dans la page). */
  title?: string;
  className?: string;
}) {
  const deferred = useDeferredValue(input);
  const html = useMemo(() => renderLandingHtml({ ...deferred, preview: true }), [deferred]);
  const scale = drawnWidth / PREVIEW_SCREEN.width;
  return (
    <div
      className={cn(
        "relative mx-auto overflow-hidden rounded-[2rem] border-8 border-night bg-night",
        className,
      )}
      style={{
        width: drawnWidth + 16,
        height: Math.round(PREVIEW_SCREEN.height * scale) + 16,
      }}
    >
      <iframe
        title={title}
        srcDoc={html}
        loading="lazy"
        // Aperçu seulement : ni clic ni focus dedans (les mêmes textes sont dans le formulaire, à côté).
        inert
        className="pointer-events-none absolute top-0 left-0 origin-top-left rounded-[1.5rem] bg-surface"
        style={{
          width: PREVIEW_SCREEN.width,
          height: PREVIEW_SCREEN.height,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}
