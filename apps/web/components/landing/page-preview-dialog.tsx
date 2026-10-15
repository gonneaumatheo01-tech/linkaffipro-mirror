"use client";

import { useSyncExternalStore } from "react";
import { Smartphone } from "lucide-react";
import type { LandingRenderInput } from "@linkaffipro/core/landing-render";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PhonePreview } from "./phone-preview";
import { largePreviewWidth } from "./preview-size";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const viewportKey = () => `${window.innerWidth}x${window.innerHeight}`;
const serverKey = () => "";

/** Taille de la fenêtre, suivie pendant que la boîte est ouverte (null au rendu serveur). */
function useViewport(): { width: number; height: number } | null {
  const key = useSyncExternalStore(subscribe, viewportKey, serverKey);
  const [w, h] = key.split("x").map(Number);
  return key && w && h ? { width: w, height: h } : null;
}

function LargePreview({ input }: { input: LandingRenderInput }) {
  const width = largePreviewWidth(useViewport());
  return (
    <PhonePreview
      input={input}
      drawnWidth={width}
      title="Aperçu en grand de la page sur un téléphone"
    />
  );
}

/**
 * « Voir la page » (fiche d'une page d'atterrissage) : la page enregistrée en grand, à la taille d'un téléphone,
 * jusqu'à la taille réelle. C'est l'aperçu (`savedPagePreviewInput` : aucun script, aucun envoi, aucun pixel, bouton
 * sans vrai lien), jamais la vraie page publique : ouverte par l'équipe, celle-ci compterait une visite et un clic
 * comme ceux d'une vraie personne, et ses pixels enverraient leurs événements aux régies. Le téléphone n'est pas
 * cliquable (même règle que l'aperçu du formulaire).
 */
export function PagePreviewDialog({
  input,
  isActive,
}: {
  input: LandingRenderInput;
  isActive: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" className="max-md:h-10" />}>
        <Smartphone aria-hidden />
        Voir la page
      </DialogTrigger>
      <DialogContent className="justify-items-center gap-5 sm:max-w-fit md:grid-cols-[auto_18rem] md:grid-rows-[auto_1fr] md:items-start md:justify-items-start md:gap-x-6">
        <DialogHeader className="w-full md:col-start-2 md:row-start-1">
          <DialogTitle>Aperçu de la page</DialogTitle>
          <DialogDescription>
            {isActive
              ? "La page telle qu'elle est en ligne (dernière version enregistrée), sur un téléphone."
              : "La page est en pause : voici ce qu'elle montrera une fois remise en ligne."}
          </DialogDescription>
        </DialogHeader>
        <div className="md:col-start-1 md:row-span-2 md:row-start-1">
          <LargePreview input={input} />
        </div>
        <p className="w-full text-note text-muted-foreground md:col-start-2 md:row-start-2">
          Ici, rien n&apos;est compté et les pixels ne reçoivent rien. Le vrai lien de la page, lui,
          compte chaque visite, même la vôtre.
        </p>
      </DialogContent>
    </Dialog>
  );
}
