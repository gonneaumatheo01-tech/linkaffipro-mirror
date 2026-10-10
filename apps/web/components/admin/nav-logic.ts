/**
 * Menu de l'application (logique pure, testée dans nav-logic.test.ts) : liste des entrées, entrée active,
 * répartition entre la barre de menu (ordinateur) et la barre du bas (téléphone).
 * Les icônes (lucide) sont associées par leur nom dans `nav-icons.tsx` (`NAV_ICONS`).
 *
 * Structure prévue pour le menu cible de docs/REFONTE-UX.md (« 6 entrées + Réglages en bas ») :
 * `section: "main"` pour les entrées principales, `section: "bottom"` pour Réglages et Aide, en bas et séparées.
 */

export type NavIcon =
  | "BarChart3"
  | "Bot"
  | "CircleHelp"
  | "House"
  | "Link2"
  | "Megaphone"
  | "MessageSquare"
  | "Radio"
  | "ScrollText"
  | "Send"
  | "Settings"
  | "Users"
  | "Zap";

export type NavSection = "main" | "bottom";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** `main` : entrées principales ; `bottom` : en bas de la barre, séparées (Réglages, Aide). */
  section: NavSection;
  adminOnly?: boolean;
  soon?: boolean;
  /** Libellé court dans la barre du bas du téléphone (ex. « Accueil »). */
  mobileLabel?: string;
  /** Icône dans la barre du bas du téléphone, si différente. */
  mobileIcon?: NavIcon;
};

export const NAV: NavItem[] = [
  {
    href: "/",
    label: "Tableau de bord",
    icon: "BarChart3",
    section: "main",
    mobileLabel: "Accueil",
    mobileIcon: "House",
  },
  { href: "/campaigns", label: "Campagnes", icon: "Megaphone", section: "main" },
  { href: "/channels", label: "Canaux", icon: "Radio", section: "main" },
  { href: "/bots", label: "Bots", icon: "Bot", section: "main" },
  { href: "/members", label: "Membres", icon: "Users", section: "main" },
  { href: "/messages", label: "Messages", icon: "MessageSquare", section: "main" },
  { href: "/links", label: "Liens", icon: "Link2", section: "main" },
  { href: "/broadcasts", label: "Envois", icon: "Send", section: "main" },
  { href: "/automations", label: "Automatisations", icon: "Zap", section: "main" },
  { href: "/journal", label: "Journal", icon: "ScrollText", section: "main" },
  { href: "/settings", label: "Réglages", icon: "Settings", section: "bottom", adminOnly: true },
  { href: "/help", label: "Aide", icon: "CircleHelp", section: "bottom" },
];

/** Barre du bas du téléphone (docs/REFONTE-UX.md) : Accueil, Messages, Membres, Campagnes, puis « Plus ». */
export const MOBILE_PRIMARY_HREFS = ["/", "/messages", "/members", "/campaigns"] as const;

/** Entrées visibles pour l'utilisateur (Réglages réservé aux administrateurs tant que l'étape 2 ne l'ouvre pas). */
export function visibleNav(nav: readonly NavItem[], isAdmin: boolean): NavItem[] {
  return nav.filter((i) => !i.adminOnly || isAdmin);
}

/** Entrées principales et entrées du bas (Réglages, Aide), dans l'ordre de la liste. */
export function navSections(
  nav: readonly NavItem[],
  isAdmin: boolean,
): { main: NavItem[]; bottom: NavItem[] } {
  const items = visibleNav(nav, isAdmin);
  return {
    main: items.filter((i) => i.section === "main"),
    bottom: items.filter((i) => i.section === "bottom"),
  };
}

/** L'adresse `pathname` est-elle la page `href` ou une de ses sous-pages ? (« / » : accueil seulement). */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Entrée active : la plus précise qui correspond (`/members/broadcasts` l'emporte sur `/members`). */
export function activeHref(pathname: string, items: readonly NavItem[]): string | null {
  let best: string | null = null;
  for (const i of items) {
    if (isActiveHref(pathname, i.href) && (best === null || i.href.length > best.length))
      best = i.href;
  }
  return best;
}

/**
 * Barre du bas du téléphone : `primary` (les entrées de `primaryHrefs`, dans cet ordre, si elles existent)
 * et `more` (tout le reste, dans l'ordre du menu : entrées principales puis Réglages et Aide), affiché par « Plus ».
 */
export function mobileNav(
  nav: readonly NavItem[],
  isAdmin: boolean,
  primaryHrefs: readonly string[] = MOBILE_PRIMARY_HREFS,
): { primary: NavItem[]; more: NavItem[] } {
  const { main, bottom } = navSections(nav, isAdmin);
  const items = [...main, ...bottom];
  const primary = primaryHrefs.flatMap((href) => items.filter((i) => i.href === href));
  const taken = new Set(primary.map((i) => i.href));
  return { primary, more: items.filter((i) => !taken.has(i.href)) };
}

/** Particules ignorées dans les initiales (« Élodie de la Tour » → « ÉT »), comparées en minuscules. */
const NAME_PARTICLES = new Set([
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "van",
  "von",
  "der",
  "den",
  "ter",
  "ten",
  "da",
  "di",
  "do",
  "das",
  "dos",
  "del",
  "della",
]);

/** Première lettre ou chiffre d'un mot (la ponctuation de tête est ignorée : « @lucas » → « l »). */
function firstLetter(word: string): string {
  return word.match(/[\p{L}\p{N}]/u)?.[0] ?? "";
}

/**
 * Initiales de la pastille du menu utilisateur, à la française : initiale du prénom (premier mot, gardé tel quel)
 * et initiale du nom (dernier mot significatif), sans les particules (de, du, la, van…) ni l'élision d'/l'
 * (« Charles d'Artagnan » → « CA »). Une seule lettre pour un seul mot, « ? » si le nom est vide.
 */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => firstLetter(w) !== "");
  const [first, ...rest] = words;
  if (first === undefined) return "?";
  const last = rest
    .map((w) => w.replace(/^[dl]['’]/iu, ""))
    .filter((w) => firstLetter(w) !== "" && !NAME_PARTICLES.has(w.toLocaleLowerCase("fr")))
    .at(-1);
  return (firstLetter(first) + (last ? firstLetter(last) : "")).toLocaleUpperCase("fr");
}
