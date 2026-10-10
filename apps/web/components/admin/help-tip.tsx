"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { CircleHelp } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { isInsideInteractive } from "./help-tip-logic";

/**
 * Bulle sombre commune à `Term` et `HelpTip` : rendue dans un portail (jamais coupée par une carte ou un
 * tableau qui défile), au-dessus du déclencheur, retournée en dessous et recadrée près des bords.
 * Ouverte au survol, au toucher (clic) et au focus clavier ; Échap, un clic à côté ou la perte du focus la ferment.
 */
const BUBBLE =
  "w-max max-w-[min(16rem,calc(100vw-1rem))] rounded-md bg-night px-2.5 py-2 text-left text-note font-normal whitespace-normal text-night-foreground shadow-md outline-none transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0";

function useBubble() {
  const [open, setOpen] = useState(false);
  return {
    root: { open, onOpenChange: (next: boolean) => setOpen(next) },
    trigger: {
      // Au clavier seulement (focus visible) : à la souris et au toucher, le survol ou le clic l'ouvrent déjà.
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        if (e.currentTarget.matches(":focus-visible")) setOpen(true);
      },
      onBlur: () => setOpen(false),
    },
  };
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <Popover.Portal>
      <Popover.Positioner side="top" sideOffset={8} collisionPadding={8} className="z-50">
        {/* Le texte est déjà lu avec le déclencheur (aria-describedby) : la bulle n'est qu'un repère visuel. */}
        <Popover.Popup
          role="tooltip"
          initialFocus={false}
          finalFocus={false}
          data-slot="help-bubble"
          className={BUBBLE}
        >
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

/**
 * Terme technique (la règle de la refonte) : le mot du client est affiché, souligné en pointillé ; le terme exact
 * apparaît au survol, au toucher et au focus clavier, et il est lu par les lecteurs d'écran (« premiers dépôts (FTD) »).
 * Dans un bouton, un lien ou un libellé (en-tête triable, carte cliquable), il reste un simple texte (pas de bouton
 * dans un bouton) : le terme est alors en `title` et dans le nom accessible de l'élément parent.
 * Usage : `<Term term="FTD">premiers dépôts</Term>`. Sans `term`, le texte est rendu tel quel.
 */
export function Term({
  term,
  children,
  className,
}: {
  term?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [interactive, setInteractive] = useState(false);
  const bubble = useBubble();
  useEffect(() => {
    // Après l'affichage seulement (même rendu serveur et client) : devient un bouton s'il n'est pas déjà dans un.
    if (ref.current && !isInsideInteractive(ref.current)) setInteractive(true);
  }, []);

  if (!term) return <>{children}</>;
  const look = cn(
    "cursor-help underline decoration-muted-foreground/50 decoration-dotted underline-offset-4",
    className,
  );
  const spoken = <span className="sr-only"> ({term})</span>;

  if (!interactive) {
    return (
      <span ref={ref} title={term} data-slot="term" className={look}>
        {children}
        {spoken}
      </span>
    );
  }
  return (
    <Popover.Root {...bubble.root}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={100}
        data-slot="term"
        {...bubble.trigger}
        className={cn(look, "rounded-xs text-left")}
      >
        {children}
        {spoken}
      </Popover.Trigger>
      <Bubble>
        Terme technique : <span className="font-semibold">{term}</span>
      </Bubble>
    </Popover.Root>
  );
}

/**
 * Infobulle « ? » accessible et discrète : bulle au survol, au toucher et au focus clavier (portail : jamais coupée),
 * texte lu avec le bouton par les lecteurs d'écran (`aria-describedby`).
 * À réserver aux précisions courtes ; pour un terme technique, préférez `Term`.
 * Usage : `<HelpTip label="Aide : coût par membre">Dépense pub divisée par les membres entrés.</HelpTip>`.
 */
export function HelpTip({
  children,
  label = "Aide",
  className,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const bubble = useBubble();
  return (
    <span className={cn("inline-flex align-middle", className)}>
      <Popover.Root {...bubble.root}>
        <Popover.Trigger
          openOnHover
          delay={100}
          closeDelay={100}
          aria-label={label}
          aria-describedby={id}
          data-slot="help-tip"
          {...bubble.trigger}
          className="relative inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors after:absolute after:-inset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-popup-open:text-foreground max-md:after:-inset-3"
        >
          <CircleHelp aria-hidden className="size-3.5" />
        </Popover.Trigger>
        <Bubble>{children}</Bubble>
      </Popover.Root>
      {/* Texte lu par les lecteurs d'écran avec le bouton, même bulle fermée (les éléments cachés comptent pour aria-describedby). */}
      <span id={id} hidden>
        {children}
      </span>
    </span>
  );
}
