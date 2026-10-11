/**
 * Animation des emojis animés d'un texte affiché (éditeur, aperçus en lecture seule), phase 12.
 *
 * Chaque emoji animé du texte est une image (`<img class="lap-ce" data-ce-id>`, components/editor/custom-emoji-chip.ts)
 * qui montre son emoji de remplacement. L'animation n'est jamais mise dans le texte (le navigateur pourrait la
 * déplacer, la copier ou la relire) : elle est dessinée dans un calque posé par-dessus, hors du texte, case par case
 * à la place exacte de chaque image (même principe que Telegram Web). Quand l'animation est prête, l'image est masquée
 * (`data-ce-ready`) ; sans aperçu, l'emoji de remplacement reste. Une image supprimée arrête son animation, une image
 * remise (⌘Z, collage) la retrouve ; le calque suit le défilement, les retours à la ligne et la sélection.
 *
 * Un aperçu redessiné à chaque frappe (nouveau HTML, donc nouvelles images) garde ses animations : la k-ième image d'un
 * emoji reprend l'animation de la k-ième ancienne image du même emoji (`pairChips`), déjà prête, au lieu de la recréer
 * (sinon chaque emoji repasserait en emoji normal puis repartirait de zéro à chaque touche).
 *
 * Texte masqué (aperçu « tel que les membres le verront », `[data-spoiler]`) : comme sur Telegram, ses emojis animés
 * restent cachés tant que le texte n'est pas révélé (survol) — l'image par la feuille de style, l'animation ici.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { isValidCustomEmojiId } from "@linkaffipro/core";
import { CUSTOM_EMOJI_CHIP_SELECTOR } from "@/components/editor/custom-emoji-chip";
import { mountEmojiMedia, type MediaHandle } from "./emoji-media";

export type ChipOverlay = {
  /** Recale le calque : nouvelles images animées, images supprimées, positions. */
  update(): void;
  destroy(): void;
};

type Entry = {
  id: string;
  /** Image du texte suivie par cette animation (change quand l'animation est reprise par une nouvelle image). */
  img: HTMLImageElement;
  box: HTMLDivElement;
  handle: MediaHandle;
  ready: boolean;
};

/**
 * Réemploi des animations quand les images du texte sont remplacées : pour chaque nouvelle image (`next`, identifiants
 * dans l'ordre du texte), l'indice de l'ancienne animation reprise dans `previous` (même emoji, premier rang libre), ou
 * -1 pour en démarrer une ; `drop` : anciennes animations à arrêter (emoji retiré du texte).
 */
export function pairChips(
  previous: readonly string[],
  next: readonly string[],
): { reuse: number[]; drop: number[] } {
  const used = new Set<number>();
  const reuse = next.map((id) => {
    const j = previous.findIndex((p, k) => p === id && !used.has(k));
    if (j !== -1) used.add(j);
    return j;
  });
  const drop = previous.map((_, k) => k).filter((k) => !used.has(k));
  return { reuse, drop };
}

/** Repère du texte masqué dans un aperçu (`<span data-spoiler>`, components/messages/telegram-preview.tsx). */
export const SPOILER_SELECTOR = "[data-spoiler]";

/** Emoji animé dans un texte masqué pas encore révélé (survol) : son animation reste cachée. */
export function isConcealed(img: Element): boolean {
  return !!img.closest(SPOILER_SELECTOR) && !img.closest(`${SPOILER_SELECTOR}:hover`);
}

/**
 * Calque des animations des emojis de `content`.
 * - `over` (éditeur) : le calque est ajouté dans `layerParent` (positionné), recouvre exactement la zone visible de
 *   `content` (qui peut défiler) et coupe ce qui en sort ;
 * - `inside` (lecture seule) : le calque est ajouté dans `content` lui-même (rendu positionné). Si le contenu est
 *   réécrit (HTML remplacé), `update()` remet le calque en place, avec ses animations.
 */
export function createChipOverlay(opts: {
  content: HTMLElement;
  layerParent?: HTMLElement;
  mode?: "over" | "inside";
}): ChipOverlay {
  const { content } = opts;
  const mode = opts.mode ?? "over";
  const parent = mode === "inside" ? content : (opts.layerParent ?? content.parentElement!);
  if (mode === "inside" && getComputedStyle(content).position === "static")
    content.style.position = "relative";
  const layer = document.createElement("div");
  layer.className = "lap-ce-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.slot = "custom-emoji-layer";
  if (mode === "inside") layer.style.inset = "0";
  parent.appendChild(layer);
  /** Animations en cours, dans l'ordre du texte au dernier `update()`. */
  let entries = new Map<HTMLImageElement, Entry>();
  let frame = 0;
  let destroyed = false;

  const place = () => {
    if (mode === "over") {
      layer.style.top = `${content.offsetTop + content.clientTop}px`;
      layer.style.left = `${content.offsetLeft + content.clientLeft}px`;
      layer.style.width = `${content.clientWidth}px`;
      layer.style.height = `${content.clientHeight}px`;
    }
    const origin = layer.getBoundingClientRect();
    const sel = document.getSelection();
    const selecting = !!sel && sel.rangeCount > 0 && !sel.isCollapsed;
    for (const [img, e] of entries) {
      const r = img.getBoundingClientRect();
      const hidden = r.width === 0 || r.height === 0 || isConcealed(img);
      e.box.style.display = hidden ? "none" : "";
      if (hidden) continue;
      e.box.style.left = `${r.left - origin.left}px`;
      e.box.style.top = `${r.top - origin.top}px`;
      e.box.style.width = `${r.width}px`;
      e.box.style.height = `${r.height}px`;
      e.box.classList.toggle("lap-ce-selected", selecting && sel!.containsNode(img, false));
    }
  };

  const mount = (id: string, img: HTMLImageElement): Entry => {
    const box = document.createElement("div");
    box.className = "lap-ce-box";
    layer.appendChild(box);
    const entry: Entry = { id, img, box, ready: false, handle: { destroy: () => undefined } };
    entry.handle = mountEmojiMedia(box, id, {
      onReady: () => {
        entry.ready = true;
        if (entry.img.isConnected) entry.img.setAttribute("data-ce-ready", "");
      },
    });
    return entry;
  };

  const update = () => {
    if (destroyed) return;
    // Contenu réécrit (HTML remplacé par React) : le calque, sorti avec l'ancien contenu, est remis en place.
    if (layer.parentNode !== parent) parent.appendChild(layer);
    const chips = Array.from(content.querySelectorAll<HTMLImageElement>(CUSTOM_EMOJI_CHIP_SELECTOR))
      .map((img) => ({ img, id: img.dataset.ceId ?? "" }))
      .filter((c) => isValidCustomEmojiId(c.id));
    const present = new Set(chips.map((c) => c.img));
    // Animations dont l'image a disparu, et images sans animation : appariées par emoji et par rang.
    const orphans = [...entries.values()].filter((e) => !present.has(e.img));
    const newcomers = chips.filter((c) => !entries.has(c.img));
    const { reuse, drop } = pairChips(
      orphans.map((e) => e.id),
      newcomers.map((c) => c.id),
    );
    const adopted = new Map<HTMLImageElement, Entry>();
    newcomers.forEach((c, i) => {
      const j = reuse[i]!;
      if (j === -1) return;
      const e = orphans[j]!;
      e.img = c.img;
      adopted.set(c.img, e);
    });
    for (const k of drop) {
      orphans[k]!.handle.destroy();
      orphans[k]!.box.remove();
    }
    const next = new Map<HTMLImageElement, Entry>();
    for (const { img, id } of chips) {
      const e = adopted.get(img) ?? entries.get(img) ?? mount(id, img);
      next.set(img, e);
      // Image remise par ⌘Z, collée ou redessinée : masquée tout de suite si son animation est prête.
      if (e.ready) {
        if (!img.hasAttribute("data-ce-ready")) img.setAttribute("data-ce-ready", "");
      } else if (img.hasAttribute("data-ce-ready")) img.removeAttribute("data-ce-ready");
    }
    entries = next;
    place();
  };

  const schedule = () => {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  };

  content.addEventListener("scroll", schedule, { passive: true });
  // Texte masqué révélé au survol (ou caché de nouveau) : ses emojis animés suivent.
  content.addEventListener("mouseover", schedule, { passive: true });
  content.addEventListener("mouseout", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  document.addEventListener("selectionchange", schedule);
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  resize?.observe(content);
  void document.fonts?.ready.then(schedule);

  return {
    update,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      content.removeEventListener("scroll", schedule);
      content.removeEventListener("mouseover", schedule);
      content.removeEventListener("mouseout", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("selectionchange", schedule);
      resize?.disconnect();
      for (const e of entries.values()) e.handle.destroy();
      entries.clear();
      layer.remove();
    },
  };
}

/**
 * Anime les emojis animés d'un texte affiché en lecture seule (aperçus) : à appeler avec la référence du conteneur
 * (HTML injecté) et une clé qui change avec son contenu. Un seul calque par conteneur pendant toute la vie du
 * composant : à chaque changement de contenu, il est recalé avant l'affichage (les animations déjà prêtes sont
 * reprises, sans clignotement). Rien n'est ajouté tant qu'il n'y a pas d'emoji animé.
 */
export function useCustomEmojiChips(ref: RefObject<HTMLElement | null>, contentKey: unknown): void {
  const overlay = useRef<{ el: HTMLElement; chips: ChipOverlay } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (overlay.current && overlay.current.el !== el) {
      overlay.current.chips.destroy();
      overlay.current = null;
    }
    if (!el) return;
    if (!overlay.current) {
      if (!el.querySelector(CUSTOM_EMOJI_CHIP_SELECTOR)) return;
      overlay.current = { el, chips: createChipOverlay({ content: el, mode: "inside" }) };
    }
    overlay.current.chips.update();
  }, [ref, contentKey]);
  useEffect(
    () => () => {
      overlay.current?.chips.destroy();
      overlay.current = null;
    },
    [],
  );
}
