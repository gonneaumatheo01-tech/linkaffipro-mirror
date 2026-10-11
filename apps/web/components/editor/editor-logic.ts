/**
 * Règles pures de l'éditeur de texte (sans DOM) : compteur de caractères, repères {prenom}…, adresse d'un lien,
 * raccourcis clavier, navigation dans la barre d'outils.
 */

/** Limites Telegram : texte d'un message, légende d'un média. */
export const TEXT_MAX = 4096;
export const CAPTION_MAX = 1024;

const fmt = (n: number) => n.toLocaleString("fr-FR");

export type CounterState = {
  /** « 123 / 4 096 » */
  label: string;
  /** Lu par les lecteurs d'écran : « 123 caractères sur 4 096 ». */
  srLabel: string;
  tone: "muted" | "warning" | "danger";
  /** Phrase sous le champ quand il faut agir ou savoir (null sinon). */
  message: string | null;
  over: boolean;
};

/**
 * Compteur : 4 096 caractères au plus ; avec un média, la légende fait 1 024 au plus (au-delà, le média part seul
 * puis le texte dans un second message, comme le fait déjà l'envoi).
 */
export function counterState(length: number, hasMedia: boolean): CounterState {
  const limit = hasMedia && length <= CAPTION_MAX ? CAPTION_MAX : TEXT_MAX;
  const base = {
    label: `${fmt(length)} / ${fmt(limit)}`,
    srLabel: `${fmt(length)} caractère${length > 1 ? "s" : ""} sur ${fmt(limit)}`,
  };
  if (length > TEXT_MAX)
    return {
      ...base,
      tone: "danger",
      over: true,
      message: `Texte trop long de ${fmt(length - TEXT_MAX)} caractère${length - TEXT_MAX > 1 ? "s" : ""} : Telegram en accepte ${fmt(TEXT_MAX)} au plus.`,
    };
  if (hasMedia && length > CAPTION_MAX)
    return {
      ...base,
      tone: "warning",
      over: false,
      message: `Avec un média, le texte qui l'accompagne fait ${fmt(CAPTION_MAX)} caractères au plus : au-delà, le média part seul, puis le texte dans un second message.`,
    };
  return { ...base, tone: length > limit * 0.9 ? "warning" : "muted", over: false, message: null };
}

/** Repères connus de la plateforme (mêmes mots que l'assistant IA). */
export const KNOWN_PLACEHOLDERS = [
  "prenom",
  "canal",
  "offre",
  "bot",
  "delai",
  "liste_canaux",
  "lien",
  "nom",
  "canal_propose",
] as const;

export type PlaceholderChip = { key: string; label: string };

export type PlaceholderMatch = { start: number; end: number; key: string; replaced: boolean };

/**
 * Repères trouvés dans un texte : `replaced` = remplacé à l'envoi dans ce formulaire (mis en évidence), sinon repère
 * connu mais pas remplacé ici (signalé). Les autres mots entre accolades sont du texte ordinaire.
 */
export function findPlaceholders(text: string, replaced: readonly string[]): PlaceholderMatch[] {
  const known = new Set<string>([...KNOWN_PLACEHOLDERS, ...replaced]);
  const ok = new Set(replaced);
  const out: PlaceholderMatch[] = [];
  const re = /\{([a-z_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = m[1]!;
    if (!known.has(key)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, key, replaced: ok.has(key) });
  }
  return out;
}

/** Repères connus présents mais non remplacés dans ce formulaire (uniques, dans l'ordre d'apparition). */
export function unresolvedPlaceholders(text: string, replaced: readonly string[]): string[] {
  return [
    ...new Set(
      findPlaceholders(text, replaced)
        .filter((m) => !m.replaced)
        .map((m) => m.key),
    ),
  ];
}

/**
 * Avertissement pour un repère connu non remplacé ici : `true` (par défaut) = surlignage jaune dans le texte et phrase
 * sous le champ ; `"highlight"` = surlignage seul (le formulaire affiche déjà sa propre alerte, comme « Des mots
 * restent à compléter » de Programmer un message) ; `false` = aucun avertissement (modèles, démonstrations).
 */
export type UnresolvedWarning = boolean | "highlight";

/** Ce que l'éditeur montre pour les repères non remplacés : surlignage jaune, phrase sous le champ. */
export type UnresolvedDisplay = { highlight: boolean; message: boolean };

export function unresolvedDisplay(warn: UnresolvedWarning): UnresolvedDisplay {
  return { highlight: warn !== false, message: warn === true };
}

/** Phrase d'avertissement pour des repères qui ne seront pas remplacés. */
export function unresolvedMessage(keys: readonly string[]): string | null {
  if (keys.length === 0) return null;
  const list = keys.map((k) => `{${k}}`).join(", ");
  return keys.length === 1
    ? `${list} ne sera pas remplacé ici : il partira tel quel. Écrivez le vrai mot à la place.`
    : `${list} ne seront pas remplacés ici : ils partiront tels quels. Écrivez les vrais mots à la place.`;
}

export type LinkCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Adresse saisie dans « Insérer un lien » : https:// ajouté si besoin (« exemple.com », « t.me/canal ») ; seules les
 * adresses web sont acceptées (pas de javascript:, mailto:…).
 */
export function normalizeLinkUrl(input: string): LinkCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Indiquez l'adresse du lien." };
  let url = raw;
  if (/^https?:\/\//i.test(raw)) url = raw;
  else if (raw.startsWith("//")) url = `https:${raw}`;
  else if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw))
    return {
      ok: false,
      error: "Seules les adresses web sont acceptées (elles commencent par https://).",
    };
  else url = `https://${raw}`;
  const invalid = {
    ok: false as const,
    error: "Adresse invalide : vérifiez-la (exemple : https://exemple.com).",
  };
  if (/\s/.test(url)) return invalid;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return invalid;
  }
  if (!/^https?:$/.test(parsed.protocol)) return invalid;
  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") return invalid;
  return { ok: true, url };
}

export type EditorCommand = "bold" | "italic" | "underline" | "strike" | "spoiler" | "link";

/** Plateforme Apple (touche ⌘) d'après `navigator.platform` ou, à défaut, `navigator.userAgent`. */
export function isMacPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

/** Touches d'un raccourci (Mac : ⌘ ; Windows et Linux : Ctrl). */
export function shortcutCommand(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  mac: boolean,
): EditorCommand | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (!e.shiftKey) {
    if (k === "b") return "bold";
    if (k === "i") return "italic";
    if (k === "u") return "underline";
    if (k === "k") return "link";
    return null;
  }
  if (k === "x") return "strike";
  return null;
}

/** Libellé du raccourci d'une commande (« ⌘B », « Ctrl+B »), null s'il n'y en a pas. */
export function shortcutLabel(cmd: EditorCommand, mac: boolean): string | null {
  const keys: Partial<Record<EditorCommand, string>> = {
    bold: "B",
    italic: "I",
    underline: "U",
    link: "K",
    strike: "X",
  };
  const key = keys[cmd];
  if (!key) return null;
  const shift = cmd === "strike";
  return mac ? `⌘${shift ? "⇧" : ""}${key}` : `Ctrl+${shift ? "Maj+" : ""}${key}`;
}

/** `aria-keyshortcuts` d'une commande (les deux plateformes). */
export function ariaShortcut(cmd: EditorCommand): string | undefined {
  const label = shortcutLabel(cmd, false);
  if (!label) return undefined;
  const key = label.slice(-1);
  const shift = cmd === "strike" ? "Shift+" : "";
  return `Control+${shift}${key} Meta+${shift}${key}`;
}

/**
 * Barre d'outils au clavier (motif « toolbar » de l'ARIA APG) : flèches gauche / droite (en boucle), Début, Fin.
 * Renvoie l'index du bouton à activer, ou null si la touche ne concerne pas la barre.
 */
export function toolbarIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  const i = Math.min(Math.max(current, 0), count - 1);
  if (key === "ArrowRight") return (i + 1) % count;
  if (key === "ArrowLeft") return (i - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * Types de saisie bloqués dans l'éditeur : mises en forme que Telegram n'a pas (couleurs, listes, alignement…).
 * Safari annonce aussi les commandes de la barre d'outils (`beforeinput`) : elles doivent passer, dont
 * « formatSubscript » (le texte masqué, voir telegram-format.ts).
 */
export function isBlockedInput(inputType: string): boolean {
  if (inputType.startsWith("format")) {
    return ![
      "formatBold",
      "formatItalic",
      "formatUnderline",
      "formatStrikeThrough",
      "formatSubscript",
      "formatRemove",
    ].includes(inputType);
  }
  return (
    inputType === "insertOrderedList" ||
    inputType === "insertUnorderedList" ||
    inputType === "insertHorizontalRule"
  );
}
