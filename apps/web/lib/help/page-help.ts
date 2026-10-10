/**
 * Aide de la page courante (bouton « ? » de l'en-tête) : table adresse → sections du guide
 * (docs/GUIDE-UTILISATEUR.md). Fonctions pures, testées dans page-help.test.ts.
 *
 * Mettre à jour quand le guide change : chaque ligne donne l'adresse (elle vaut aussi pour ses sous-pages, la plus
 * précise gagne ; « / » ne vaut que pour l'accueil), le nom de la page et les titres des sections à montrer, dans
 * l'ordre (titre exact du guide ; accents et ponctuation ne comptent pas). `{ title, introOnly: true }` : seulement
 * le texte avant la première sous-section. Un test vérifie que chaque titre existe dans le guide (ou, en attendant
 * qu'il y soit, dans les sections intégrées de `builtin-sections.ts` : « Accueil »).
 */
import type { SectionRef } from "./sections";

export type PageHelp = {
  /** Adresse de la page (sans paramètres). */
  path: string;
  /** Nom de la page dans le volet (« Aide : Campagnes »). */
  label: string;
  sections: readonly SectionRef[];
};

export const PAGE_HELP: readonly PageHelp[] = [
  { path: "/", label: "Accueil", sections: ["Accueil"] },
  {
    path: "/campaigns",
    label: "Campagnes",
    sections: [
      "Campagnes",
      "Nommer ses campagnes et les relier à Link Affi",
      "Une pub ne remonte pas",
    ],
  },
  {
    path: "/campaigns/links",
    label: "Tous les liens",
    sections: ["Liens", "Une pub ne remonte pas"],
  },
  {
    path: "/campaigns/import",
    label: "Import des coûts",
    sections: ["Import des coûts publicitaires"],
  },
  {
    path: "/campaigns/imports",
    label: "Imports de coûts",
    sections: ["Import des coûts publicitaires"],
  },
  {
    path: "/channels",
    label: "Canaux",
    sections: ["Canaux", "Meilleurs horaires de publication", "Un membre n'est pas accepté"],
  },
  {
    path: "/messages",
    label: "Messages",
    sections: [
      "Messages",
      "Modèles de messages prêts à l'emploi",
      "Assistant IA pour écrire les messages",
    ],
  },
  { path: "/messages/ab", label: "Test A/B", sections: ["Test A/B d'un message de canal"] },
  {
    path: "/messages/categories",
    label: "Comparer par catégorie",
    sections: ["Catégories de messages"],
  },
  {
    path: "/members",
    label: "Membres",
    sections: [
      "Membres",
      "Notes sur un membre",
      "Réglages → Étiquettes de membres",
      "Je veux supprimer un membre (RGPD)",
    ],
  },
  { path: "/members/broadcasts", label: "Écrire à un groupe", sections: ["Envois"] },
  { path: "/members/automations", label: "Relances automatiques", sections: ["Automatisations"] },
  {
    path: "/stats",
    label: "Statistiques",
    sections: ["Tableau de bord", "Période et comparaison"],
  },
  { path: "/settings", label: "Réglages", sections: [{ title: "Réglages", introOnly: true }] },
  { path: "/settings/bots", label: "Bots", sections: ["Bots", "Le bot ne répond pas"] },
  { path: "/settings/journal", label: "Journal", sections: ["Journal"] },
  {
    path: "/settings/team",
    label: "Équipe",
    sections: ["Réglages → Équipe", "Utilisateurs et invitations"],
  },
  {
    path: "/settings/connectors",
    label: "Connexions",
    sections: [
      "Connecteurs (Link Affi)",
      "Comptes publicitaires et compte Telegram (Réglages → Connecteurs)",
      "La synchro Link Affi est en échec",
    ],
  },
  {
    path: "/settings/ai",
    label: "Assistant IA",
    sections: ["IA", "Assistant IA pour écrire les messages"],
  },
  { path: "/settings/postbacks", label: "Retour du casino", sections: ["Postbacks"] },
  {
    path: "/settings/alerts",
    label: "Alertes",
    sections: [
      "Alertes et rétention",
      "Nouvelles alertes et seuils",
      "Une alerte arrive sur Telegram",
    ],
  },
  { path: "/settings/reports", label: "Rapports", sections: ["Rapports automatiques"] },
  { path: "/settings/categories", label: "Catégories", sections: ["Catégories de messages"] },
  { path: "/settings/tags", label: "Étiquettes", sections: ["Réglages → Étiquettes de membres"] },
  {
    path: "/settings/status",
    label: "État du système",
    sections: ["État du système", "Sauvegardes", "Le site est lent"],
  },
  {
    path: "/account",
    label: "Mon compte",
    sections: ["Mon compte", "J'ai perdu mon mot de passe"],
  },
  { path: "/help", label: "Aide", sections: ["Aide"] },
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

/** La page `path` (ou une de ses sous-pages) est-elle l'adresse `pathname` ? « / » : accueil seulement. */
export function matchesPath(pathname: string, path: string): boolean {
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
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
    if (matchesPath(path, entry.path) && (!best || entry.path.length > best.path.length))
      best = entry;
  return best ? { help: best, fallback: false } : { help: DEFAULT_HELP, fallback: true };
}
