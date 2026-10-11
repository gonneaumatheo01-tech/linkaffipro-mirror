"use client";

import "./rich-text.css";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Bold, EyeOff, Italic, Link2, Smile, Strikethrough, Underline } from "lucide-react";
import { customEmojiTag, textLength } from "@linkaffipro/core";
import { createChipOverlay, type ChipOverlay } from "@/components/custom-emoji/emoji-chips";
import {
  CustomEmojiPickerButton,
  type PickedEmoji,
} from "@/components/custom-emoji/custom-emoji-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ariaShortcut,
  counterState,
  findPlaceholders,
  isBlockedInput,
  normalizeLinkUrl,
  shortcutCommand,
  shortcutLabel,
  toolbarIndex,
  unresolvedDisplay,
  unresolvedMessage,
  unresolvedPlaceholders,
  type EditorCommand,
  type PlaceholderChip,
  type UnresolvedWarning,
} from "./editor-logic";
import {
  escapeText,
  formatsOfAncestors,
  htmlToTelegram,
  plainPasteToTelegram,
  telegramToEditorHtml,
  type ActiveFormats,
} from "./telegram-format";
import { useIsMac } from "./use-is-mac";

export type { PlaceholderChip, UnresolvedWarning } from "./editor-logic";

/** Émojis proposés dans la barre d'outils (les plus utilisés dans les messages de l'équipe). */
export const EDITOR_EMOJIS = ["🔥", "🎁", "💰", "⚡", "✅", "👉", "🎰", "⚽", "❤️"];

const TOOLS: Array<{ cmd: EditorCommand; label: string; icon: React.ReactNode; toggle: boolean }> =
  [
    { cmd: "bold", label: "Gras", icon: <Bold aria-hidden />, toggle: true },
    { cmd: "italic", label: "Italique", icon: <Italic aria-hidden />, toggle: true },
    { cmd: "underline", label: "Souligné", icon: <Underline aria-hidden />, toggle: true },
    { cmd: "strike", label: "Barré", icon: <Strikethrough aria-hidden />, toggle: true },
    { cmd: "link", label: "Lien", icon: <Link2 aria-hidden />, toggle: false },
    { cmd: "spoiler", label: "Texte masqué", icon: <EyeOff aria-hidden />, toggle: true },
  ];

const NO_FORMATS: ActiveFormats = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  spoiler: false,
  code: false,
  link: null,
};

function sameFormats(a: ActiveFormats, b: ActiveFormats): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.spoiler === b.spoiler &&
    a.code === b.code &&
    a.link === b.link
  );
}

/** Repères mis en évidence : une seule surbrillance par document, alimentée par chaque éditeur ouvert. */
type HighlightRanges = { ok: Range[]; warn: Range[] };
const highlightRegistry = new Map<string, HighlightRanges>();
type HighlightApi = {
  highlights: { set(name: string, h: unknown): void; delete(name: string): void };
};
function applyHighlights() {
  const css = (globalThis as { CSS?: Partial<HighlightApi> }).CSS;
  const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!css?.highlights || !HighlightCtor) return;
  const ok: Range[] = [];
  const warn: Range[] = [];
  for (const r of highlightRegistry.values()) {
    ok.push(...r.ok);
    warn.push(...r.warn);
  }
  css.highlights.set("lap-placeholder", new HighlightCtor(...ok));
  css.highlights.set("lap-placeholder-warn", new HighlightCtor(...warn));
}

/** Plus proche lien (ou texte masqué) qui contient le nœud, dans l'éditeur. */
function closestIn(node: Node | null, root: HTMLElement, selector: string): HTMLElement | null {
  const el =
    node && (node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement);
  const found = el?.closest<HTMLElement>(selector) ?? null;
  return found && root.contains(found) && found !== root ? found : null;
}

function caretRangeAt(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (!p) return null;
    const r = document.createRange();
    r.setStart(p.offsetNode, p.offset);
    r.collapse(true);
    return r;
  }
  return doc.caretRangeFromPoint?.(x, y) ?? null;
}

/** HTML collé : lu par le navigateur (sans exécuter de script) pour être normalisé avant d'être nettoyé. */
function pastedToTelegram(data: DataTransfer): string {
  const html = data.getData("text/html");
  if (html) {
    let body = html;
    try {
      body = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    } catch {
      // HTML lu tel quel par notre lecteur tolérant.
    }
    return htmlToTelegram(body, "paste");
  }
  return plainPasteToTelegram(data.getData("text/plain"));
}

export type RichTextEditorProps = {
  /** Identifiant de la zone de saisie (`<Label htmlFor={id}>` y met le curseur). */
  id: string;
  /** Nom accessible de la zone (« Texte du message »). */
  label: string;
  /** Texte en HTML Telegram (b, i, u, s, a href, tg-spoiler, code, pre, blockquote). */
  value: string;
  /** Reçoit le HTML Telegram propre à chaque modification. */
  onChange: (html: string) => void;
  /** Nom du champ caché soumis avec le formulaire (HTML Telegram), si le formulaire ne l'écrit pas déjà. */
  name?: string;
  required?: boolean;
  invalid?: boolean;
  /** Identifiants d'aide à relier (`aria-describedby`), en plus du compteur. */
  describedBy?: string;
  placeholder?: string;
  /** Repères remplacés à l'envoi dans ce formulaire, insérables en un clic et mis en évidence. */
  placeholders?: readonly PlaceholderChip[];
  /**
   * Repère connu ({offre}, {prenom}…) qui ne sera pas remplacé ici : surligné en jaune et signalé par une phrase sous
   * le champ (`true`, par défaut) ; surligné seulement (`"highlight"` : le formulaire a déjà sa propre alerte) ; ou
   * rien (`false`).
   */
  warnUnresolved?: UnresolvedWarning;
  /** Média joint : la légende est limitée à 1 024 caractères (compteur). */
  hasMedia?: boolean;
  /** Bouton « Améliorer avec l'IA », placé au bout de la barre d'outils. */
  ai?: React.ReactNode;
  /** Hauteur minimale en lignes (≈ `rows` d'une zone de texte). */
  rows?: number;
  /**
   * Bouton « Emoji animé » (emojis des packs Premium de la bibliothèque de l'équipe), à côté des émojis : oui par
   * défaut. Un emoji animé s'écrit `<tg-emoji emoji-id="…">😀</tg-emoji>` dans la valeur ; `hasCustomEmoji(value)`
   * (@linkaffipro/core) dit si le texte en contient.
   */
  customEmoji?: boolean;
  className?: string;
};

/**
 * Éditeur de texte simple, sans balise visible : le texte s'écrit et se relit mis en forme (gras, italique, souligné,
 * barré, lien, texte masqué, émojis) ; le formulaire reçoit toujours du HTML Telegram propre et validé.
 * Barre d'outils (une seule tabulation, flèches pour passer d'un bouton à l'autre), raccourcis ⌘B ⌘I ⌘U ⌘K ⌘⇧X,
 * collage nettoyé (seule la mise en forme permise par Telegram est gardée), repères {prenom}… insérables et mis en
 * évidence, compteur de caractères (4 096, 1 024 avec un média ; un emoji animé compte comme son emoji de
 * remplacement), emplacement pour l'assistant IA.
 * Emojis animés (phase 12) : bouton « Emoji animé » (sélecteur de la bibliothèque) ; chaque emoji est une puce
 * animée que l'on supprime d'un retour arrière, comme un caractère (custom-emoji-chip.ts).
 */
export function RichTextEditor({
  id,
  label,
  value,
  onChange,
  name,
  required,
  invalid,
  describedBy,
  placeholder = "Votre message…",
  placeholders = [],
  warnUnresolved = true,
  hasMedia = false,
  ai,
  rows = 8,
  customEmoji = true,
  className,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const linkUrlRef = useRef<HTMLInputElement>(null);
  const linkTextRef = useRef<HTMLInputElement>(null);
  /** Dernier HTML envoyé au parent : s'il revient tel quel par `value`, on ne touche pas au contenu (curseur gardé). */
  const lastEmitted = useRef(value);
  const savedRange = useRef<Range | null>(null);
  const pendingEmoji = useRef<string | null>(null);
  const pendingLink = useRef<{ url: string; text: string } | "remove" | null>(null);
  const internalDrag = useRef(false);
  /** Zone de saisie et son calque d'animations des emojis animés (créé au premier affichage, retiré au démontage). */
  const textAreaRef = useRef<HTMLDivElement>(null);
  const chips = useRef<ChipOverlay | null>(null);
  /** Position du curseur à l'ouverture du sélecteur d'emojis animés (rétablie avant l'insertion). */
  const customEmojiRange = useRef<Range | null>(null);
  const [initialHtml] = useState(() => telegramToEditorHtml(value));
  const [active, setActive] = useState<ActiveFormats>(NO_FORMATS);
  const [focusIndex, setFocusIndex] = useState(0);
  const [requiredError, setRequiredError] = useState(false);
  const [link, setLink] = useState<{
    open: boolean;
    url: string;
    text: string;
    editing: boolean;
    needsText: boolean;
    error: string | null;
  }>({ open: false, url: "", text: "", editing: false, needsText: false, error: null });
  const isMac = useIsMac();
  const replacedKeys = placeholders.map((p) => p.key);
  const length = textLength(value);
  const counter = counterState(length, hasMedia);
  const unresolvedShown = unresolvedDisplay(warnUnresolved);
  const unresolved = unresolvedShown.message ? unresolvedPlaceholders(value, replacedKeys) : [];
  const empty = value.length === 0;
  const helpId = `${id}-editor-help`;
  const counterId = `${id}-counter`;
  const minHeight = rows <= 3 ? "min-h-20" : rows <= 6 ? "min-h-28" : "min-h-40";

  /** Repères du contenu actuel mis en évidence (API de surbrillance CSS : aucune balise ajoutée au texte). */
  function refreshHighlights() {
    const el = editorRef.current;
    if (!el || typeof document === "undefined") return;
    const ok: Range[] = [];
    const warn: Range[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      for (const m of findPlaceholders(n.data, replacedKeys)) {
        if (!m.replaced && !unresolvedShown.highlight) continue;
        const r = document.createRange();
        r.setStart(n, m.start);
        r.setEnd(n, m.end);
        (m.replaced ? ok : warn).push(r);
      }
    }
    highlightRegistry.set(id, { ok, warn });
    applyHighlights();
    animateChips();
  }

  /** Anime les emojis animés du texte (nouveaux, collés, remis par ⌘Z) et arrête ceux qui ont été supprimés. */
  function animateChips() {
    const el = editorRef.current;
    const wrap = textAreaRef.current;
    if (typeof document === "undefined" || !el || !wrap) return;
    chips.current ??= createChipOverlay({ content: el, layerParent: wrap, mode: "over" });
    chips.current.update();
  }

  /** Lit le contenu, le convertit en HTML Telegram et prévient le parent s'il a changé. */
  function sync() {
    const el = editorRef.current;
    if (!el) return;
    const html = htmlToTelegram(el.innerHTML, "editor");
    refreshHighlights();
    if (html !== lastEmitted.current) {
      lastEmitted.current = html;
      if (requiredError && html) setRequiredError(false);
      onChange(html);
    }
  }

  /** Mise en forme au curseur (boutons enfoncés de la barre d'outils). */
  function readFormats() {
    const el = editorRef.current;
    const sel = typeof document !== "undefined" ? document.getSelection() : null;
    if (!el || !sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.commonAncestorContainer)) return;
    savedRange.current = r.cloneRange();
    const chain: Array<{ tag: string; attrs: Record<string, string> }> = [];
    let node: Node | null = r.startContainer;
    if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
    while (node && node !== el && node instanceof HTMLElement) {
      const attrs: Record<string, string> = {};
      for (const a of Array.from(node.attributes)) attrs[a.name] = a.value;
      chain.push({ tag: node.tagName, attrs });
      node = node.parentElement;
    }
    const f = formatsOfAncestors(chain);
    // « Style de frappe » : après ⌘B sans sélection, le prochain caractère sera en gras.
    if (document.activeElement === el) {
      try {
        f.bold = document.queryCommandState("bold");
        f.italic = document.queryCommandState("italic");
        f.underline = document.queryCommandState("underline");
        f.strike = document.queryCommandState("strikeThrough");
        f.spoiler = document.queryCommandState("subscript");
      } catch {
        // Ancienne API absente : la chaîne des parents suffit.
      }
    }
    setActive((prev) => (sameFormats(prev, f) ? prev : f));
  }

  /** Remet le curseur dans l'éditeur, là où il était (ou à la fin). */
  function focusEditor() {
    const el = editorRef.current;
    if (!el) return;
    const sel = document.getSelection();
    // Éditeur déjà actif (raccourci, bouton qui ne prend pas le focus) : la sélection vivante fait foi, même si
    // l'événement « selectionchange » n'a pas encore été traité.
    if (
      document.activeElement === el &&
      sel &&
      sel.rangeCount > 0 &&
      el.contains(sel.getRangeAt(0).commonAncestorContainer)
    ) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
      return;
    }
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    if (!sel) return;
    const saved = savedRange.current;
    if (saved && el.contains(saved.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(saved);
    } else if (sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  /** Commande d'édition du navigateur (gardée dans l'historique : ⌘Z annule). */
  function exec(command: string, arg?: string) {
    focusEditor();
    try {
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      // Sans effet sur ce navigateur.
    }
    document.execCommand(command, false, arg);
    sync();
    readFormats();
  }

  function insertTelegram(tg: string) {
    const fragment = telegramToEditorHtml(tg, { fragment: true });
    if (!fragment) return;
    if (!document.execCommand("insertHTML", false, fragment)) {
      // Repli : insertion directe au curseur (hors historique d'annulation).
      const sel = document.getSelection();
      const el = editorRef.current;
      if (!sel || !el || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      r.deleteContents();
      const tpl = document.createElement("template");
      tpl.innerHTML = fragment;
      const last = tpl.content.lastChild;
      r.insertNode(tpl.content);
      if (last) {
        r.setStartAfter(last);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
    sync();
  }

  /** Ouverture du sélecteur d'emojis animés : on retient où est le curseur dans le texte. */
  function openCustomEmoji() {
    readFormats();
    const el = editorRef.current;
    const saved = savedRange.current;
    customEmojiRange.current =
      el && saved && el.contains(saved.commonAncestorContainer) ? saved.cloneRange() : null;
  }

  /** Sélecteur fermé : curseur remis où il était, puis l'emoji choisi inséré (annulable par ⌘Z). */
  function closeCustomEmoji(emoji: PickedEmoji | null) {
    const el = editorRef.current;
    const range = customEmojiRange.current;
    customEmojiRange.current = null;
    if (!el) return;
    el.focus({ preventScroll: true });
    const sel = document.getSelection();
    if (sel && range && el.contains(range.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
      savedRange.current = range.cloneRange();
    } else focusEditor();
    if (!emoji) return;
    try {
      insertTelegram(customEmojiTag(emoji.id, emoji.fallback));
    } catch {
      // Identifiant invalide (ne vient jamais de la bibliothèque) : rien n'est inséré.
    }
    readFormats();
  }

  function openLink() {
    const el = editorRef.current;
    if (!el) return;
    focusEditor();
    const sel = document.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (range) savedRange.current = range.cloneRange();
    const a = range ? closestIn(range.startContainer, el, "a[href]") : null;
    setLink({
      open: true,
      url: a?.getAttribute("href") ?? "",
      text: "",
      editing: Boolean(a),
      needsText: !a && (!range || range.collapsed),
      error: null,
    });
  }

  /** Applique le lien une fois la boîte fermée (le curseur est revenu dans l'éditeur). */
  function applyPendingLink() {
    const pending = pendingLink.current;
    pendingLink.current = null;
    const el = editorRef.current;
    if (!pending || !el) return;
    focusEditor();
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const a = closestIn(range.startContainer, el, "a[href]");
    if (pending === "remove") {
      if (!a) return;
      const r = document.createRange();
      r.selectNodeContents(a);
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand("unlink");
    } else if (a) {
      // Nouvelle adresse sur tout le lien (le texte et sa mise en forme ne bougent pas).
      const r = document.createRange();
      r.selectNodeContents(a);
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand("createLink", false, pending.url);
    } else if (!range.collapsed) {
      document.execCommand("createLink", false, pending.url);
    } else {
      const href = pending.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${href}">${escapeText(pending.text || pending.url)}</a>`,
      );
    }
    sync();
    readFormats();
  }

  const run = (cmd: EditorCommand) => {
    if (cmd === "bold") exec("bold");
    else if (cmd === "italic") exec("italic");
    else if (cmd === "underline") exec("underline");
    else if (cmd === "strike") exec("strikeThrough");
    else if (cmd === "spoiler") exec("subscript");
    else openLink();
  };

  function submitLink() {
    const check = normalizeLinkUrl(link.url);
    if (!check.ok) {
      setLink((l) => ({ ...l, error: check.error }));
      return;
    }
    pendingLink.current = { url: check.url, text: link.text.trim() };
    setLink((l) => ({ ...l, open: false, error: null }));
  }

  // Les écouteurs natifs passent par des « effect events » : ils lisent toujours les dernières props sans être
  // réinstallés à chaque rendu.
  const onValueFromOutside = useEffectEvent((next: string) => {
    const el = editorRef.current;
    if (!el || next === lastEmitted.current) return;
    lastEmitted.current = next;
    el.innerHTML = telegramToEditorHtml(next);
    savedRange.current = null;
    refreshHighlights();
  });
  const onSelectionChange = useEffectEvent(() => readFormats());
  const onBeforeInput = useEffectEvent((e: InputEvent) => {
    if (e.inputType === "insertParagraph") {
      // Entrée : un saut de ligne (<br>), jamais un nouveau paragraphe <div>.
      e.preventDefault();
      if (!document.execCommand("insertLineBreak"))
        document.execCommand("insertHTML", false, "<br>");
      sync();
      return;
    }
    if (isBlockedInput(e.inputType)) e.preventDefault();
  });
  const onMounted = useEffectEvent(() => refreshHighlights());
  const onLabelClick = useEffectEvent((e: MouseEvent) => {
    e.preventDefault();
    focusEditor();
  });

  // Contenu remplacé de l'extérieur (assistant IA, brouillon rechargé, modèle) : on réaffiche le texte mis en forme.
  useEffect(() => {
    onValueFromOutside(value);
  }, [value]);

  // Écouteurs natifs : sélection (boutons enfoncés), Entrée (saut de ligne simple), mises en forme interdites.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const selection = () => onSelectionChange();
    const beforeInput = (e: InputEvent) => onBeforeInput(e);
    document.addEventListener("selectionchange", selection);
    el.addEventListener("beforeinput", beforeInput);
    onMounted();
    return () => {
      document.removeEventListener("selectionchange", selection);
      el.removeEventListener("beforeinput", beforeInput);
      highlightRegistry.delete(id);
      applyHighlights();
      chips.current?.destroy();
      chips.current = null;
    };
  }, [id]);

  // Un <Label htmlFor={id}> ne sait pas donner le focus à une zone éditable : on le fait pour lui.
  useEffect(() => {
    const labels = Array.from(document.querySelectorAll<HTMLLabelElement>("label[for]")).filter(
      (l) => l.htmlFor === id,
    );
    const click = (e: MouseEvent) => onLabelClick(e);
    for (const l of labels) l.addEventListener("click", click);
    return () => {
      for (const l of labels) l.removeEventListener("click", click);
    };
  }, [id]);

  // Barre d'outils : une seule tabulation (le bouton actif), les flèches pour les autres (motif ARIA « toolbar »).
  useLayoutEffect(() => {
    const bar = toolbarRef.current;
    if (!bar) return;
    const items = Array.from(bar.querySelectorAll<HTMLElement>("button:not([disabled])"));
    const idx = Math.min(focusIndex, items.length - 1);
    items.forEach((b, i) => {
      b.tabIndex = i === idx ? 0 : -1;
    });
  });

  function onToolbarKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const bar = toolbarRef.current;
    if (!bar) return;
    const items = Array.from(bar.querySelectorAll<HTMLElement>("button:not([disabled])"));
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return;
    const next = toolbarIndex(current, e.key, items.length);
    if (next === null) return;
    e.preventDefault();
    items[next]!.focus();
    setFocusIndex(next);
  }

  function onToolbarFocus(e: React.FocusEvent<HTMLDivElement>) {
    const bar = toolbarRef.current;
    if (!bar) return;
    const items = Array.from(bar.querySelectorAll<HTMLElement>("button:not([disabled])"));
    const i = items.indexOf(e.target as HTMLElement);
    if (i !== -1 && i !== focusIndex) setFocusIndex(i);
  }

  const pressed = (cmd: EditorCommand): boolean | undefined => {
    if (cmd === "bold") return active.bold;
    if (cmd === "italic") return active.italic;
    if (cmd === "underline") return active.underline;
    if (cmd === "strike") return active.strike;
    if (cmd === "spoiler") return active.spoiler;
    return undefined;
  };

  const describedByIds = [describedBy, helpId, counterId].filter(Boolean).join(" ");
  const status = counter.over
    ? "Texte trop long : raccourcissez-le."
    : counter.message
      ? "Le texte dépasse la légende d'un média."
      : "";

  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div
        className={cn(
          "relative rounded-lg border bg-surface transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-brand/30",
          invalid || requiredError || counter.over
            ? "border-danger focus-within:border-danger focus-within:ring-danger/15"
            : "border-muted-foreground/75",
        )}
      >
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label={`Mise en forme : ${label}`}
          aria-controls={id}
          onKeyDown={onToolbarKeyDown}
          onFocus={onToolbarFocus}
          className="flex flex-wrap items-center gap-0.5 border-b border-border p-1"
        >
          {TOOLS.map((t) => {
            const shortcut = shortcutLabel(t.cmd, isMac);
            const name =
              t.cmd === "link" && active.link
                ? "Modifier le lien"
                : t.cmd === "link"
                  ? "Insérer un lien"
                  : t.label;
            return (
              <Button
                key={t.cmd}
                type="button"
                size="icon-sm"
                variant="ghost"
                className="max-md:size-10 aria-pressed:bg-brand-soft aria-pressed:text-brand-ink"
                aria-label={name}
                aria-pressed={t.toggle ? pressed(t.cmd) : undefined}
                aria-haspopup={t.cmd === "link" ? "dialog" : undefined}
                aria-keyshortcuts={ariaShortcut(t.cmd)}
                title={shortcut ? `${name} (${shortcut})` : name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(t.cmd)}
              >
                {t.icon}
              </Button>
            );
          })}
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          <DropdownMenu
            onOpenChangeComplete={(open) => {
              if (open) return;
              const emoji = pendingEmoji.current;
              pendingEmoji.current = null;
              if (emoji) exec("insertText", emoji);
            }}
          >
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="max-md:size-10"
                  aria-label="Insérer un émoji"
                  title="Insérer un émoji"
                  onMouseDown={() => readFormats()}
                />
              }
            >
              <Smile aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent finalFocus={editorRef} className="w-auto">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Émojis</DropdownMenuLabel>
                <div className="grid grid-cols-5 gap-0.5">
                  {EDITOR_EMOJIS.map((e) => (
                    <DropdownMenuItem
                      key={e}
                      aria-label={`Insérer ${e}`}
                      className="justify-center text-title"
                      onClick={() => {
                        pendingEmoji.current = e;
                      }}
                    >
                      {e}
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {customEmoji ? (
            <CustomEmojiPickerButton onOpen={openCustomEmoji} onClosed={closeCustomEmoji} />
          ) : null}
          {ai ? (
            // Téléphone : l'assistant passe sur sa propre ligne, sous les outils de mise en forme.
            <div className="ml-auto flex items-center max-md:ml-0 max-md:w-full max-md:border-t max-md:border-border max-md:pt-1">
              {ai}
            </div>
          ) : null}
        </div>

        <div ref={textAreaRef} className="relative">
          {empty ? (
            <span
              aria-hidden
              className="pointer-events-none absolute top-2 left-3 text-base leading-relaxed text-muted-foreground select-none md:text-body"
            >
              {placeholder}
            </span>
          ) : null}
          <div
            ref={editorRef}
            id={id}
            role="textbox"
            aria-multiline="true"
            aria-label={label}
            aria-describedby={describedByIds}
            aria-invalid={invalid || requiredError || counter.over || undefined}
            aria-required={required || undefined}
            aria-placeholder={placeholder}
            contentEditable
            suppressContentEditableWarning
            spellCheck
            data-slot="rich-text-editor"
            className={cn(
              "lap-rich max-h-[28rem] w-full overflow-y-auto px-3 py-2 text-base leading-relaxed text-foreground outline-none md:text-body",
              minHeight,
            )}
            dangerouslySetInnerHTML={{ __html: initialHtml }}
            onInput={() => sync()}
            onKeyDown={(e) => {
              const cmd = shortcutCommand(e, isMac);
              if (!cmd) return;
              // ⌘K dans le texte insère un lien : la recherche globale (⌘K ailleurs) ne doit pas s'ouvrir aussi.
              e.preventDefault();
              e.stopPropagation();
              run(cmd);
            }}
            onPaste={(e) => {
              e.preventDefault();
              insertTelegram(pastedToTelegram(e.clipboardData));
            }}
            onDragStart={() => {
              internalDrag.current = true;
            }}
            onDragEnd={() => {
              internalDrag.current = false;
            }}
            onDrop={(e) => {
              if (internalDrag.current) return; // déplacement dans le texte : géré par le navigateur
              e.preventDefault();
              const dt = e.dataTransfer;
              if (!dt.getData("text/html") && !dt.getData("text/plain")) return;
              const el = editorRef.current;
              const r = caretRangeAt(e.clientX, e.clientY);
              if (el && r && el.contains(r.startContainer)) {
                el.focus({ preventScroll: true });
                const sel = document.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(r);
              }
              insertTelegram(pastedToTelegram(dt));
            }}
          />
        </div>

        {required ? (
          // Champ obligatoire : la vérification du navigateur (bulle « Veuillez renseigner ce champ ») passe par ce
          // relais invisible, qui renvoie aussitôt le curseur dans l'éditeur.
          <input
            tabIndex={-1}
            aria-hidden="true"
            aria-label={label}
            required
            value={empty ? "" : "ok"}
            onChange={() => undefined}
            onInvalid={() => setRequiredError(true)}
            onFocus={() => focusEditor()}
            className="pointer-events-none absolute bottom-0 left-4 size-px opacity-0"
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border px-2 py-1.5">
          {placeholders.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Insérer un repère"
            >
              <span className="text-note text-muted-foreground">Insérer :</span>
              {placeholders.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => exec("insertText", `{${p.key}}`)}
                  title={`Insère {${p.key}}, remplacé pour chaque personne`}
                  className="inline-flex h-7 items-center rounded-full border border-border bg-brand-soft px-2.5 text-note font-medium text-brand-ink transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:h-10"
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}
          <p
            id={counterId}
            className={cn(
              "ml-auto text-note tabular-nums",
              counter.tone === "danger"
                ? "font-medium text-danger"
                : counter.tone === "warning"
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            <span aria-hidden>{counter.label}</span>
            <span className="sr-only">{counter.srLabel}</span>
          </p>
        </div>
      </div>

      <p id={helpId} className="sr-only">
        Mise en forme avec la barre d&apos;outils ou les raccourcis : gras{" "}
        {shortcutLabel("bold", isMac)}, italique {shortcutLabel("italic", isMac)}, souligné{" "}
        {shortcutLabel("underline", isMac)}, lien {shortcutLabel("link", isMac)}, barré{" "}
        {shortcutLabel("strike", isMac)}.
      </p>
      {counter.message ? (
        <p className={cn("text-note", counter.over ? "text-danger" : "text-warning")}>
          {counter.message}
        </p>
      ) : null}
      {requiredError && empty ? (
        <p className="text-note text-danger">Écrivez le texte du message.</p>
      ) : null}
      {unresolved.length > 0 ? (
        <p className="text-note text-warning">{unresolvedMessage(unresolved)}</p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      {name ? <input type="hidden" name={name} value={value} /> : null}

      <Dialog
        open={link.open}
        onOpenChange={(open) => setLink((l) => ({ ...l, open }))}
        onOpenChangeComplete={(open) => {
          if (!open) applyPendingLink();
        }}
      >
        <DialogContent
          finalFocus={editorRef}
          initialFocus={link.needsText ? linkTextRef : linkUrlRef}
        >
          <DialogHeader>
            <DialogTitle>{link.editing ? "Modifier le lien" : "Insérer un lien"}</DialogTitle>
            <DialogDescription>
              {link.needsText
                ? "Le texte s'affiche dans le message ; un appui ouvre l'adresse."
                : "Le texte sélectionné devient un lien vers cette adresse."}
            </DialogDescription>
          </DialogHeader>
          <div
            className="space-y-4"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              e.stopPropagation();
              submitLink();
            }}
          >
            {link.needsText ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-link-text`}>Texte du lien</Label>
                <Input
                  ref={linkTextRef}
                  id={`${id}-link-text`}
                  value={link.text}
                  placeholder="Ex. : Voir l'offre"
                  onChange={(e) => setLink((l) => ({ ...l, text: e.target.value }))}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-link-url`}>Adresse</Label>
              <Input
                ref={linkUrlRef}
                id={`${id}-link-url`}
                value={link.url}
                inputMode="url"
                autoComplete="url"
                placeholder="https://…"
                aria-invalid={link.error ? true : undefined}
                aria-describedby={link.error ? `${id}-link-error` : undefined}
                onChange={(e) => setLink((l) => ({ ...l, url: e.target.value, error: null }))}
              />
              {link.error ? (
                <p id={`${id}-link-error`} className="text-note text-danger">
                  {link.error}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            {link.editing ? (
              <Button
                type="button"
                variant="ghost"
                className="text-danger sm:mr-auto"
                onClick={() => {
                  pendingLink.current = "remove";
                  setLink((l) => ({ ...l, open: false }));
                }}
              >
                Retirer le lien
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => setLink((l) => ({ ...l, open: false }))}
            >
              Annuler
            </Button>
            <Button type="button" onClick={submitLink}>
              {link.editing ? "Enregistrer" : "Insérer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
