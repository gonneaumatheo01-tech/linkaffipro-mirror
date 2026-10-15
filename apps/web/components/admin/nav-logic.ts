/**
 * Menu de l'application (logique pure, testée dans nav-logic.test.ts) : liste des entrées, entrée active,
 * répartition entre la barre de menu (ordinateur) et la barre du bas (téléphone).
 * Les icônes (lucide) sont associées par leur nom dans `nav-icons.tsx` (`NAV_ICONS`).
 *
 * Menu cible de docs/REFONTE-UX.md : 6 entrées principales (`section: "main"`), plus « Pages » après Campagnes
 * (phase 15, demande explicite du client : pages d'atterrissage), puis Réglages en bas et séparé
 * (`section: "bottom"`), visible pour tous les rôles (l'écran Réglages ne montre à chacun que ce qu'il peut ouvrir).
 * Le guide d'utilisation et « Mon compte » ne sont que dans le volet « Plus » du téléphone (`mobileOnly`) : sur
 * ordinateur, ils sont dans l'en-tête (bouton « ? » et menu du compte).
 * Les rubriques rangées sous une entrée l'allument : /members/broadcasts et /members/automations → Membres,
 * /campaigns/links → Campagnes, /settings/bots et /settings/journal → Réglages (voir `activeHref`).
 */

export type NavIcon =
  | "BarChart3"
  | "BookOpen"
  | "House"
  | "Megaphone"
  | "MessageSquare"
  | "PanelTop"
  | "Radio"
  | "Settings"
  | "UserRound"
  | "Users";

export type NavSection = "main" | "bottom";

export type NavItem = {
  /** Clé stable (minuscules) : repère de la visite guidée `data-tour="nav-<clé>"` (voir `navTourId`). */
  key: string;
  href: string;
  label: string;
  icon: NavIcon;
  /** `main` : entrées principales ; `bottom` : en bas de la barre, séparées (Réglages). */
  section: NavSection;
  adminOnly?: boolean;
  /** Seulement dans le volet « Plus » du téléphone (sur ordinateur, l'en-tête y donne accès). */
  mobileOnly?: boolean;
  soon?: boolean;
  /** Libellé court dans la barre du bas du téléphone, si différent. */
  mobileLabel?: string;
  /** Icône dans la barre du bas du téléphone, si différente. */
  mobileIcon?: NavIcon;
};

export const NAV: NavItem[] = [
  { key: "home", href: "/", label: "Accueil", icon: "House", section: "main" },
  { key: "campaigns", href: "/campaigns", label: "Campagnes", icon: "Megaphone", section: "main" },
  // Phase 15 : pages d'atterrissage (sur téléphone, dans « Plus »).
  { key: "pages", href: "/pages", label: "Pages", icon: "PanelTop", section: "main" },
  { key: "channels", href: "/channels", label: "Canaux", icon: "Radio", section: "main" },
  { key: "messages", href: "/messages", label: "Messages", icon: "MessageSquare", section: "main" },
  { key: "members", href: "/members", label: "Membres", icon: "Users", section: "main" },
  { key: "stats", href: "/stats", label: "Statistiques", icon: "BarChart3", section: "main" },
  { key: "settings", href: "/settings", label: "Réglages", icon: "Settings", section: "bottom" },
  {
    key: "help",
    href: "/help",
    label: "Guide d'utilisation",
    icon: "BookOpen",
    section: "bottom",
    mobileOnly: true,
  },
  {
    key: "account",
    href: "/account",
    label: "Mon compte",
    icon: "UserRound",
    section: "bottom",
    mobileOnly: true,
  },
];

/** Barre du bas du téléphone (docs/REFONTE-UX.md) : Accueil, Messages, Membres, Campagnes, puis « Plus ». */
export const MOBILE_PRIMARY_HREFS = ["/", "/messages", "/members", "/campaigns"] as const;

/** Repère de la visite guidée posé sur l'entrée (`data-tour`) : « nav-members »… ; « nav-more » pour « Plus ». */
export function navTourId(item: Pick<NavItem, "key">): string {
  return `nav-${item.key}`;
}

/** Entrées visibles pour l'utilisateur (`adminOnly` : administrateurs seulement ; aucune dans le menu actuel). */
export function visibleNav(nav: readonly NavItem[], isAdmin: boolean): NavItem[] {
  return nav.filter((i) => !i.adminOnly || isAdmin);
}

/** Barre de menu de l'ordinateur : entrées principales et entrées du bas, sans celles propres au téléphone. */
export function navSections(
  nav: readonly NavItem[],
  isAdmin: boolean,
): { main: NavItem[]; bottom: NavItem[] } {
  const items = visibleNav(nav, isAdmin).filter((i) => !i.mobileOnly);
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
 * et `more` (tout le reste, dans l'ordre du menu : entrées principales, puis Réglages, le guide et le compte),
 * affiché par « Plus ».
 */
export function mobileNav(
  nav: readonly NavItem[],
  isAdmin: boolean,
  primaryHrefs: readonly string[] = MOBILE_PRIMARY_HREFS,
): { primary: NavItem[]; more: NavItem[] } {
  const visible = visibleNav(nav, isAdmin);
  const items = [
    ...visible.filter((i) => i.section === "main"),
    ...visible.filter((i) => i.section === "bottom"),
  ];
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
