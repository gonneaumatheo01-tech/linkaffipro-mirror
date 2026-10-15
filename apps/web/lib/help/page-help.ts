/**
 * Aide de la page courante (bouton « ? » de l'en-tête) : table adresse → sections du guide
 * (docs/GUIDE-UTILISATEUR.md). Fonctions pures, testées dans page-help.test.ts.
 *
 * Mettre à jour quand le guide ou un écran change : chaque ligne donne l'adresse (elle vaut aussi pour ses sous-pages ;
 * « / » ne vaut que pour l'accueil ; un segment « :id » vaut pour n'importe quel identifiant, comme la fiche d'un canal),
 * le nom de la page dans le volet et les titres des sections à montrer, dans l'ordre (titre exact du guide ; accents et
 * ponctuation ne comptent pas). `{ title, introOnly: true }` : seulement le texte avant la première sous-section (une
 * rubrique entière serait trop longue pour le volet). L'entrée la plus précise gagne : plus de segments d'abord, puis
 * plus de segments fixes (« /channels/import » l'emporte sur « /channels/:id »).
 * Les tests vérifient que chaque titre existe dans le guide et que chaque page de `app/(admin)` a sa ligne.
 */
import { slugify } from "./markdown";
import type { SectionRef } from "./sections";

export type PageHelp = {
  /** Adresse de la page (sans paramètres) ; « :id » = un segment quelconque. */
  path: string;
  /** Nom de la page dans le volet (« Aide : Campagnes »). */
  label: string;
  sections: readonly SectionRef[];
};

const intro = (title: string): SectionRef => ({ title, introOnly: true });

export const PAGE_HELP: readonly PageHelp[] = [
  { path: "/", label: "Accueil", sections: ["Accueil"] },

  // Campagnes
  {
    path: "/campaigns",
    label: "Campagnes",
    sections: [
      intro("Campagnes"),
      "Nouvelle campagne (assistant en 4 étapes)",
      "Nommer ses campagnes et les relier à Link Affi",
    ],
  },
  {
    path: "/campaigns/:id",
    label: "Campagnes",
    sections: [intro("Campagnes"), "Fiche d'une campagne", "Une pub ne remonte pas"],
  },
  {
    path: "/campaigns/new",
    label: "Nouvelle campagne",
    sections: [
      "Nouvelle campagne (assistant en 4 étapes)",
      "Nommer ses campagnes et les relier à Link Affi",
    ],
  },
  {
    path: "/campaigns/links",
    label: "Tous les liens",
    sections: ["Tous les liens", "Une pub ne remonte pas"],
  },
  {
    // Phase 13 : membres amenés par les affiliés Link Affi (section intégrée en attendant le guide).
    path: "/campaigns/affiliates",
    label: "Affiliés Link Affi",
    sections: ["Affiliés sur vos canaux"],
  },
  {
    path: "/campaigns/import",
    label: "Importer des dépenses",
    sections: ["Importer des dépenses (CSV)"],
  },
  {
    path: "/campaigns/imports",
    label: "Historique des imports",
    sections: ["Importer des dépenses (CSV)"],
  },

  // Pages d'atterrissage (phase 15)
  {
    path: "/pages",
    label: "Pages",
    sections: [intro("Pages"), "Créer une page", "Copier le lien d'une source"],
  },
  {
    path: "/pages/new",
    label: "Nouvelle page",
    sections: ["Créer une page", "Copier le lien d'une source", "Vitesse de la page"],
  },
  {
    path: "/pages/:id",
    label: "Fiche d'une page",
    sections: [
      "Copier le lien d'une source",
      "Lire le tableau d'une page",
      "Ce qui est compté",
      "Créer une page",
    ],
  },

  // Canaux
  {
    path: "/channels",
    label: "Canaux",
    sections: [intro("Canaux"), "Ajouter un canal existant", "Importer tous mes canaux"],
  },
  {
    path: "/channels/:id",
    label: "Fiche du canal",
    // Phase 11 : « Qui peut entrer et quand » (règle par défaut, exceptions selon la provenance, simulateur) d'abord,
    // puis le dépannage d'une demande, puis les autres onglets de la fiche.
    sections: [
      intro("Fiche d'un canal"),
      "Qui peut entrer et quand",
      "Un membre n'est pas accepté",
      "Ce que dit le bot",
      "Demandes",
      "Pourquoi des demandes restent sur « Attend les canaux »",
      "Membres du canal",
      "Le bot ne répond pas",
    ],
  },
  {
    path: "/channels/import",
    label: "Importer mes canaux",
    sections: ["Importer tous mes canaux", "Compte Telegram pour les vues"],
  },

  // Messages
  {
    path: "/messages",
    label: "Messages",
    sections: [
      intro("Messages"),
      "Calendrier des messages",
      "Meilleurs créneaux",
      "Liste des messages",
      "Modèles de messages",
    ],
  },
  {
    path: "/messages/new",
    label: "Programmer un message",
    sections: [
      "Programmer un message",
      "Assistant IA pour écrire les messages",
      "Test A/B d'un message de canal",
    ],
  },
  {
    path: "/messages/:id",
    label: "Fiche d'un message",
    sections: ["Fiche d'un message", "Test A/B d'un message de canal"],
  },
  {
    path: "/messages/:id/edit",
    label: "Modifier un message",
    sections: ["Programmer un message", "Assistant IA pour écrire les messages"],
  },
  { path: "/messages/ab", label: "Test A/B", sections: ["Test A/B d'un message de canal"] },
  {
    // Phase 12 : bibliothèque des emojis animés (section du guide sous « Messages »).
    path: "/messages/emojis",
    label: "Emojis animés",
    sections: ["Ajouter des emojis animés"],
  },
  {
    path: "/messages/categories",
    label: "Comparer par catégorie",
    sections: ["Comparer par catégorie", "Catégories de messages"],
  },

  // Membres, Écrire à un groupe, Relances automatiques
  {
    path: "/members",
    label: "Membres",
    sections: [intro("Membres"), "Liste des membres"],
  },
  {
    path: "/members/:id",
    label: "Fiche d'un membre",
    sections: ["Fiche d'un membre", "Je veux supprimer un membre (RGPD)"],
  },
  {
    path: "/members/broadcasts",
    label: "Écrire à un groupe",
    sections: ["Écrire à un groupe", "Test A/B d'un message à un groupe"],
  },
  {
    path: "/members/broadcasts/ab",
    label: "Test A/B d'un message à un groupe",
    sections: ["Test A/B d'un message à un groupe"],
  },
  {
    path: "/members/automations",
    label: "Relances automatiques",
    sections: ["Relances automatiques"],
  },
  {
    path: "/members/automations/:id",
    label: "Fiche d'une relance",
    sections: ["Fiche d'une relance", "Relances automatiques"],
  },
  {
    path: "/members/automations/:id/edit",
    label: "Éditeur avancé",
    sections: ["Éditeur avancé à branches"],
  },
  {
    path: "/members/automations/new",
    label: "Éditeur avancé",
    sections: ["Éditeur avancé à branches"],
  },

  // Statistiques
  {
    path: "/stats",
    label: "Statistiques",
    sections: [intro("Statistiques"), "Statistiques → Vue d'ensemble", "Période et comparaison"],
  },
  {
    path: "/stats/ads",
    label: "Statistiques : Pubs",
    sections: ["Statistiques → Pubs", "Période et comparaison", "Les chiffres semblent en retard"],
  },
  {
    path: "/stats/funnel",
    label: "Statistiques : Parcours",
    sections: ["Statistiques → Parcours", "Période et comparaison"],
  },
  {
    path: "/stats/channels",
    label: "Statistiques : Canaux",
    // Phase 14 : le parcours des demandes suit la période et la comparaison du sélecteur commun.
    sections: ["Statistiques → Canaux", "Période et comparaison", "Meilleurs créneaux"],
  },
  {
    path: "/stats/cohorts",
    label: "Membres dans le temps",
    sections: ["Statistiques → Membres dans le temps", "Période et comparaison"],
  },

  // Réglages
  { path: "/settings", label: "Réglages", sections: [intro("Réglages")] },
  {
    path: "/settings/connectors",
    label: "Connexions",
    sections: ["Réglages → Connexions", "La synchro Link Affi est en échec"],
  },
  {
    path: "/settings/connectors/meta",
    label: "Meta et TikTok",
    sections: ["Comptes publicitaires Meta et TikTok"],
  },
  {
    path: "/settings/connectors/tiktok",
    label: "Meta et TikTok",
    sections: ["Comptes publicitaires Meta et TikTok"],
  },
  {
    path: "/settings/connectors/telegram",
    label: "Telegram (vues)",
    sections: ["Compte Telegram pour les vues"],
  },
  { path: "/settings/bots", label: "Bots", sections: ["Réglages → Bots", "Le bot ne répond pas"] },
  {
    path: "/settings/team",
    label: "Équipe",
    sections: [intro("Réglages → Équipe"), "Utilisateurs et invitations"],
  },
  {
    path: "/settings/alerts",
    label: "Alertes",
    sections: ["Alertes et conservation des données", "Une alerte arrive sur Telegram"],
  },
  {
    path: "/settings/reports",
    label: "Rapports automatiques",
    sections: ["Rapports automatiques"],
  },
  {
    path: "/settings/ai",
    label: "Assistant IA",
    sections: ["Réglages → IA", "Assistant IA pour écrire les messages"],
  },
  { path: "/settings/categories", label: "Catégories", sections: ["Catégories de messages"] },
  { path: "/settings/tags", label: "Étiquettes", sections: ["Étiquettes de membres"] },
  { path: "/settings/journal", label: "Journal", sections: ["Réglages → Journal"] },
  {
    path: "/settings/status",
    label: "État du système",
    sections: ["Réglages → État du système", "Sauvegardes", "Le site est lent"],
  },
  {
    path: "/settings/postbacks",
    label: "Retours du casino",
    sections: ["Réglages → Avancé : retours du casino (postbacks)"],
  },

  // Compte et aide
  {
    path: "/account",
    label: "Mon compte",
    sections: ["Mon compte", "J'ai perdu mon mot de passe"],
  },
  { path: "/help", label: "Aide", sections: ["Aide « ? » et visite guidée"] },
];

/** Réponse de GET /api/help?path=… (volet du bouton « ? »). */
export type HelpResponse = {
  path: string;
  /** Nom de la page (« Campagnes ») ; « Pour commencer » en repli. */
  label: string;
  /** Pas d'aide propre à cette page : « Les 10 premières minutes ». */
  fallback: boolean;
  /** Ancre de la première section dans la page /help (lien « Ouvrir le guide complet »). */
  anchor: string | null;
  /** Sections du guide, déjà rendues en HTML sûr. */
  sections: Array<{ id: string; title: string; html: string }>;
  /** Le guide n'a pas été trouvé sur le serveur. */
  missing?: boolean;
};

/** Repli pour une page sans aide propre. */
export const DEFAULT_HELP: PageHelp = {
  path: "",
  label: "Pour commencer",
  sections: ["Les 10 premières minutes"],
};

/** Adresse sans paramètres ni ancre, sans barre finale (« /campaigns/ » → « /campaigns »). */
export function normalizePath(pathname: string): string {
  const bare = (pathname.split(/[?#]/)[0] ?? "").trim();
  if (!bare.startsWith("/")) return "/";
  const trimmed = bare.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * La page `path` (ou une de ses sous-pages) est-elle l'adresse `pathname` ? « / » : accueil seulement ; « :id » : un
 * segment quelconque (jamais vide).
 */
export function matchesPath(pathname: string, path: string): boolean {
  if (path === "/") return pathname === "/";
  const want = segments(path);
  const got = segments(pathname);
  if (got.length < want.length) return false;
  return want.every((s, i) => (s.startsWith(":") ? Boolean(got[i]) : s === got[i]));
}

/** Précision d'une entrée : nombre de segments, puis nombre de segments fixes. */
function precision(path: string): [number, number] {
  const s = segments(path);
  return [s.length, s.filter((x) => !x.startsWith(":")).length];
}

function morePrecise(a: string, b: string): boolean {
  const [la, fa] = precision(a);
  const [lb, fb] = precision(b);
  return la !== lb ? la > lb : fa > fb;
}

/** Aide de la page : l'entrée la plus précise de la table, sinon « Les 10 premières minutes ». */
export function pageHelpFor(
  pathname: string,
  table: readonly PageHelp[] = PAGE_HELP,
): {
  help: PageHelp;
  fallback: boolean;
} {
  const path = normalizePath(pathname);
  let best: PageHelp | null = null;
  for (const entry of table)
    if (matchesPath(path, entry.path) && (!best || morePrecise(entry.path, best.path)))
      best = entry;
  return best ? { help: best, fallback: false } : { help: DEFAULT_HELP, fallback: true };
}

/**
 * Lien « Ouvrir le guide complet » du volet : la page /help, à l'ancre de la première section de la page (mêmes
 * identifiants que le rendu du guide : les titres du guide sont uniques, un test le vérifie).
 */
export function guideHref(help: PageHelp): string {
  const first = help.sections[0];
  const anchor = first ? slugify(typeof first === "string" ? first : first.title) : "";
  return anchor ? `/help#${anchor}` : "/help";
}
