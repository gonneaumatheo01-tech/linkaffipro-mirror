"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { completeTourAction } from "@/lib/onboarding/actions";
import { TOUR_START_EVENT } from "./tour-events";
import {
  TOUR_STEPS,
  applyCommand,
  isLastStep,
  keyCommand,
  pickAnchor,
  placeBubble,
  spotlightRect,
  stepLabel,
  tourSelector,
  type Rect,
  type TourCommand,
} from "./tour-logic";

/** Première copie visible d'un repère (le menu existe deux fois : barre de l'ordinateur et barre du téléphone). */
function visibleElement(anchor: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(tourSelector(anchor))) {
    const r = el.getBoundingClientRect();
    if (el.getClientRects().length > 0 && r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function rectOf(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Fond assombri autour de la zone mise en lumière (couleur nuit du thème). */
const DIM = "0 0 0 200vmax color-mix(in srgb, var(--night) 62%, transparent)";

/**
 * Visite guidée de 2 minutes (7 étapes, docs/REFONTE-UX.md) : une bulle accrochée à chaque entrée du menu, fond
 * assombri autour de l'entrée, « Suivant », « Précédent », « Passer la visite » (`data-tour-skip`), Échap pour passer,
 * flèches pour avancer ou reculer. Sur téléphone, la bulle prend toute la largeur au-dessus de la barre du bas.
 * - démarre seule à la première connexion (`autoStart`, état `onboarding.<userId>` lu par la coque), sauf dans un
 *   navigateur piloté (captures et contrôles automatiques : `navigator.webdriver`) ;
 * - « Revoir la visite guidée » (volet d'aide) la relance par l'événement `TOUR_START_EVENT` ;
 * - terminée ou passée : enregistrée pour l'utilisateur (`completeTourAction`), elle ne redémarre plus seule.
 * Composant maison sans dépendance : positions calculées par `tour-logic.ts`, appliquées directement au DOM.
 */
export function GuidedTour({ autoStart }: { autoStart: boolean }) {
  const [index, setIndex] = useState<number | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const spotRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLSpanElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const total = TOUR_STEPS.length;

  const begin = useCallback(() => {
    const active = document.activeElement;
    returnFocusRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    setIndex(0);
  }, []);

  // Première connexion : la visite démarre seule, une fois la page affichée.
  useEffect(() => {
    if (!autoStart || navigator.webdriver) return;
    const timer = window.setTimeout(begin, 800);
    return () => window.clearTimeout(timer);
  }, [autoStart, begin]);

  useEffect(() => {
    window.addEventListener(TOUR_START_EVENT, begin);
    return () => window.removeEventListener(TOUR_START_EVENT, begin);
  }, [begin]);

  const end = useCallback((how: "finished" | "skipped") => {
    setIndex(null);
    startTransition(async () => {
      await completeTourAction(how).catch(() => undefined);
    });
    const back = returnFocusRef.current;
    window.setTimeout(() => {
      if (back?.isConnected) back.focus();
    }, 0);
  }, []);

  const command = useCallback(
    (cmd: TourCommand) => {
      if (index === null) return;
      const next = applyCommand(index, total, cmd);
      if (next === null) end(cmd === "skip" ? "skipped" : "finished");
      else setIndex(next);
    },
    [index, total, end],
  );

  // Clavier : Échap, flèches ; Tab reste dans la bulle ; les raccourcis du site sont suspendus pendant la visite.
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      const cmd = keyCommand(e.key, index, total);
      if (cmd) {
        e.preventDefault();
        e.stopPropagation();
        command(cmd);
        return;
      }
      if (e.key === "Tab") {
        const bubble = bubbleRef.current;
        const items = bubble
          ? [...bubble.querySelectorAll<HTMLElement>("button:not([disabled])")]
          : [];
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const inside = bubble?.contains(document.activeElement) ?? false;
        if (!inside || (e.shiftKey && document.activeElement === first)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      // Entrée et Espace activent le bouton qui a le focus ; les autres touches ne déclenchent aucun raccourci.
      if (e.key !== "Enter" && e.key !== " ") e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, total, command]);

  // Placement : repère visible mis en lumière, bulle à côté ; recalculé au défilement et au redimensionnement.
  useLayoutEffect(() => {
    if (index === null) return;
    const step = TOUR_STEPS[index]!;
    let frame = 0;
    const place = () => {
      const picked = pickAnchor(step.anchors, (a) => visibleElement(a) !== null);
      const anchor = rectOf(picked ? visibleElement(picked.anchor) : null);
      const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
      const note = noteRef.current;
      if (note) note.hidden = !(picked?.fallback && step.fallbackNote);
      const spot = spotRef.current;
      if (spot) {
        const s = anchor
          ? spotlightRect(anchor, viewport)
          : { top: viewport.height / 2, left: viewport.width / 2, width: 0, height: 0 };
        spot.dataset.empty = anchor ? "false" : "true";
        spot.style.top = `${s.top}px`;
        spot.style.left = `${s.left}px`;
        spot.style.width = `${s.width}px`;
        spot.style.height = `${s.height}px`;
      }
      const bubble = bubbleRef.current;
      if (bubble) {
        const p = placeBubble(
          anchor,
          { width: bubble.offsetWidth, height: bubble.offsetHeight },
          viewport,
        );
        bubble.style.top = `${Math.round(p.top)}px`;
        bubble.style.left = `${Math.round(p.left)}px`;
        bubble.dataset.placement = p.placement;
        bubble.style.visibility = "visible";
      }
    };
    const first = pickAnchor(step.anchors, (a) => visibleElement(a) !== null);
    if (first)
      visibleElement(first.anchor)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    place();
    primaryRef.current?.focus({ preventScroll: true });
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(place);
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [index]);

  if (index === null) return null;
  const step = TOUR_STEPS[index]!;
  const last = isLastStep(index, total);

  return createPortal(
    <div data-slot="guided-tour">
      {/* Bloque les clics sur la page pendant la visite (la bulle et ses boutons restent utilisables). */}
      <div aria-hidden className="fixed inset-0 z-[60]" />
      <div
        ref={spotRef}
        aria-hidden
        data-empty="true"
        style={{ boxShadow: DIM }}
        className="pointer-events-none fixed z-[61] rounded-xl outline-[3px] outline-brand outline-solid data-[empty=true]:outline-0 motion-safe:transition-[top,left,width,height] motion-safe:duration-300 motion-safe:ease-out"
      />
      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-step={step.key}
        style={{ visibility: "hidden", top: 0, left: 0 }}
        className="fixed z-[62] w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-card p-4 text-body text-foreground shadow-lg md:w-[23rem]"
      >
        <div aria-live="polite">
          <p className="text-note font-medium text-brand-ink">{stepLabel(index, total)}</p>
          <h2 id={titleId} className="mt-1 text-title text-foreground">
            {step.title}
          </h2>
          <p id={bodyId} className="mt-2 text-body text-muted-foreground">
            {step.body}
            {step.fallbackNote ? (
              <span ref={noteRef} hidden>
                {" "}
                {step.fallbackNote}
              </span>
            ) : null}
          </p>
        </div>
        <ol aria-hidden className="mt-4 flex gap-1.5">
          {TOUR_STEPS.map((s, i) => (
            <li
              key={s.key}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index
                  ? "w-5 bg-brand"
                  : i < index
                    ? "w-1.5 bg-brand-ink/60"
                    : "w-1.5 bg-border",
              )}
            />
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            data-tour-skip=""
            className="-ml-2 text-muted-foreground hover:text-foreground max-md:h-10"
            onClick={() => command("skip")}
          >
            Passer la visite
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {index > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="max-md:h-10"
                onClick={() => command("prev")}
              >
                Précédent
              </Button>
            ) : null}
            <Button
              ref={primaryRef}
              size="sm"
              className="max-md:h-10"
              onClick={() => command(last ? "finish" : "next")}
            >
              {last ? "Terminer" : "Suivant"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
