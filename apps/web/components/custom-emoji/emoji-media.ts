/**
 * Animation d'un emoji animé dans le navigateur (phase 12) : aperçu chargé à la demande depuis
 * `GET /api/custom-emoji/<id>` (une fois par emoji et par page), puis affiché selon son format :
 * - animation (fichier Telegram .tgs, reçu en JSON) : lecteur d'animation chargé seulement quand il en faut un
 *   (rendu sur un `<canvas>`, léger dans l'éditeur) ;
 * - vidéo (.webm) : `<video>` muette, en boucle, sans son ni contrôles ;
 * - image (.webp) : `<img>`.
 * Chargement paresseux (seulement près de l'écran), lecture seulement quand l'emoji est visible, et aucune animation si
 * l'utilisateur a demandé moins de mouvement (première image seulement). Sans aperçu : rien n'est ajouté, l'emoji de
 * remplacement reste affiché par l'appelant.
 */

export type EmojiPreview =
  | { kind: "lottie"; json: string }
  | { kind: "video"; url: string }
  | { kind: "image"; url: string };

type CacheEntry = {
  at: number;
  promise: Promise<EmojiPreview | null>;
  value: EmojiPreview | null | undefined;
};

/** Sans aperçu (pas encore récupéré par le service d'arrière-plan) : nouvel essai au plus une fois par minute. */
const RETRY_MISSING_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export function customEmojiPreviewUrl(id: string): string {
  return `/api/custom-emoji/${encodeURIComponent(id)}`;
}

/** Aperçu d'un emoji (mis en cache pour la page). Null : pas d'aperçu, ou réseau indisponible. */
export function loadEmojiPreview(id: string): Promise<EmojiPreview | null> {
  const hit = cache.get(id);
  if (hit && !(hit.value === null && Date.now() - hit.at > RETRY_MISSING_MS)) return hit.promise;
  const entry: CacheEntry = { at: Date.now(), value: undefined, promise: Promise.resolve(null) };
  entry.promise = (async (): Promise<EmojiPreview | null> => {
    try {
      const res = await fetch(customEmojiPreviewUrl(id), { credentials: "same-origin" });
      if (!res.ok || res.status === 204) return null; // 204 : pas encore d'aperçu
      const type = res.headers.get("content-type") ?? "";
      if (type.startsWith("application/json")) return { kind: "lottie", json: await res.text() };
      if (!type.startsWith("video/") && !type.startsWith("image/")) return null;
      const url = URL.createObjectURL(await res.blob());
      return type.startsWith("video/") ? { kind: "video", url } : { kind: "image", url };
    } catch {
      return null;
    }
  })().then((v) => {
    entry.value = v;
    return v;
  });
  cache.set(id, entry);
  return entry.promise;
}

/** Oublie un aperçu absent (après un ajout, pour le revoir tout de suite). */
export function forgetMissingPreviews(): void {
  for (const [id, e] of cache) if (e.value === null) cache.delete(id);
}

type LottieModule = typeof import("lottie-web/build/player/lottie_light_canvas");
let lottiePromise: Promise<LottieModule["default"]> | null = null;

/** Lecteur d'animation, chargé une seule fois et seulement quand une animation doit être affichée. */
function loadLottie(): Promise<LottieModule["default"]> {
  lottiePromise ??= import("lottie-web/build/player/lottie_light_canvas").then((m) => m.default);
  return lottiePromise;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type VisibilityListener = (visible: boolean) => void;
const visibilityListeners = new Map<Element, Set<VisibilityListener>>();
let visibilityObserver: IntersectionObserver | null = null;
const nearListeners = new Map<Element, () => void>();
let nearObserver: IntersectionObserver | null = null;

function hasObserver(): boolean {
  return typeof window !== "undefined" && typeof window.IntersectionObserver === "function";
}

/** Prévient quand l'élément entre ou sort de l'écran (lecture et pause). Renvoie de quoi arrêter. */
function observeVisibility(el: Element, cb: VisibilityListener): () => void {
  if (!hasObserver()) {
    cb(true);
    return () => undefined;
  }
  visibilityObserver ??= new IntersectionObserver((entries) => {
    for (const e of entries)
      for (const l of visibilityListeners.get(e.target) ?? []) l(e.isIntersecting);
  });
  let set = visibilityListeners.get(el);
  if (!set) {
    set = new Set();
    visibilityListeners.set(el, set);
    visibilityObserver.observe(el);
  }
  set.add(cb);
  return () => {
    const s = visibilityListeners.get(el);
    s?.delete(cb);
    if (s && s.size === 0) {
      visibilityListeners.delete(el);
      visibilityObserver?.unobserve(el);
    }
  };
}

/** Appelle `cb` une fois, quand l'élément arrive près de l'écran (chargement paresseux). */
function whenNear(el: Element, cb: () => void): () => void {
  if (!hasObserver()) {
    cb();
    return () => undefined;
  }
  nearObserver ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const fn = nearListeners.get(e.target);
        nearListeners.delete(e.target);
        nearObserver?.unobserve(e.target);
        fn?.();
      }
    },
    { rootMargin: "200px" },
  );
  nearListeners.set(el, cb);
  nearObserver.observe(el);
  return () => {
    if (nearListeners.delete(el)) nearObserver?.unobserve(el);
  };
}

export type MediaHandle = { destroy(): void };

/**
 * Affiche l'animation de l'emoji `id` dans `container` (vide, dimensionné par l'appelant). `onReady` : l'animation
 * est affichée (l'appelant masque alors l'emoji de remplacement). `destroy` arrête tout et retire ce qui a été ajouté.
 */
export function mountEmojiMedia(
  container: HTMLElement,
  id: string,
  opts: { onReady?: () => void } = {},
): MediaHandle {
  let destroyed = false;
  let cleanup: (() => void) | null = null;
  const reduced = prefersReducedMotion();

  const show = async () => {
    const preview = await loadEmojiPreview(id);
    if (destroyed || !preview) return;
    if (preview.kind === "image") {
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      img.src = preview.url;
      container.appendChild(img);
      cleanup = () => img.remove();
      opts.onReady?.();
      return;
    }
    if (preview.kind === "video") {
      const v = document.createElement("video");
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.disablePictureInPicture = true;
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      v.preload = "auto";
      v.tabIndex = -1;
      v.src = preview.url;
      container.appendChild(v);
      const stop = observeVisibility(container, (visible) => {
        if (reduced) return;
        if (visible) void v.play().catch(() => undefined);
        else v.pause();
      });
      cleanup = () => {
        stop();
        v.pause();
        v.remove();
      };
      opts.onReady?.();
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(preview.json);
    } catch {
      return;
    }
    const lottie = await loadLottie().catch(() => null);
    if (destroyed || !lottie) return;
    const anim = lottie.loadAnimation({
      container,
      renderer: "canvas",
      loop: true,
      autoplay: false,
      animationData: data,
      rendererSettings: {
        clearCanvas: true,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        preserveAspectRatio: "xMidYMid meet",
      },
    });
    let visible = false;
    let loaded = false;
    const sync = () => {
      if (!loaded) return;
      if (reduced || !visible) anim.pause();
      else anim.play();
    };
    anim.addEventListener("DOMLoaded", () => {
      loaded = true;
      if (reduced) anim.goToAndStop(0, true);
      sync();
      opts.onReady?.();
    });
    const stop = observeVisibility(container, (v) => {
      visible = v;
      sync();
    });
    cleanup = () => {
      stop();
      anim.destroy();
    };
  };

  const stopLazy = whenNear(container, () => void show());
  return {
    destroy() {
      destroyed = true;
      stopLazy();
      cleanup?.();
      cleanup = null;
    },
  };
}
