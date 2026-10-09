# Phase 5 — Finitions (rédigé par Claude le 9 octobre 2026, mode autonome ; aucune intervention humaine)

Pré-requis : phase 4 déployée. Objectif : une interface que l'équipe comprend sans formation, en français simple, utilisable sur téléphone, avec un guide d'utilisation complet. Rien de nouveau côté données ; pas d'envoi vers de vrais membres.

## A. Qualité de l'interface (toutes les pages de `apps/web/app/(admin)`)
- Inventaire page par page : état vide (phrase + bouton d'action), état de chargement (`loading.tsx` par section avec squelettes), erreurs lisibles (`error.tsx` par section : phrase simple + « Réessayer », jamais de trace technique), confirmations avant toute action irréversible (suppression, envoi immédiat, désactivation) avec un texte qui dit ce qui va se passer.
- Cohérence : mêmes libellés pour les mêmes notions (membre, canal, message, envoi, pub, campagne, règle), mêmes formats de dates (`fmtDate`) et de nombres (`fmtNum`, `fmtMoney`), badges de statut avec les mêmes couleurs partout (`lib/status-badges.ts` partagé), boutons primaires à droite, secondaires à gauche.
- Textes : relecture de tous les textes visibles (titres, aides, messages `Flash`, erreurs de validation Zod) : français simple, sans jargon (« sub-ID » → « identifiant de suivi (sub-ID) » à la première occurrence d'une page, « webhook » → « connexion Telegram », « FTD » → « premier dépôt (FTD) »), vouvoiement, pas d'anglicisme inutile.
- Aide en ligne : une ligne d'aide sous le titre de chaque écran (`PageHeader description`) qui dit à quoi sert la page et la première chose à faire ; infobulle « ? » (`components/admin/help-tip.tsx`) sur chaque indicateur de tableau de bord (CPL, CPA, ROAS, NGR, cohorte…).

## B. Téléphone et accessibilité
- Menu latéral repliable en tiroir sous 768 px, tableaux défilants horizontalement (`overflow-x-auto`) avec colonnes secondaires masquées sur petit écran (`hidden md:table-cell`), formulaires sur une colonne, boutons tactiles ≥ 40 px.
- Accessibilité : libellés `<label>` reliés à chaque champ, focus visible, contraste AA sur les badges, `aria-label` sur les boutons icône, titres de page `<h1>` uniques, `lang="fr"` sur `<html>`.
- Vérification automatique : test vitest qui rend chaque page de liste avec des données simulées et vérifie l'absence d'image sans `alt` et de bouton sans libellé (ou, si trop lourd, un script `pnpm a11y` basé sur `@axe-core/playwright` est hors périmètre : documenter alors la vérification manuelle dans STATUS).

## C. Confort
- Recherche globale (`⌘K` / bouton loupe dans l'en-tête) : membres (nom, @username, identifiant Telegram), messages (titre, texte), canaux, pubs, règles ; résultats groupés, navigation clavier ; route `GET /api/search?q=` protégée par la session, limitée à 10 résultats par groupe.
- Filtres mémorisés : les filtres des listes (membres, messages, journal, envois, pubs) sont conservés dans l'URL et le dernier jeu de filtres est mémorisé par utilisateur dans `localStorage` (clé par page) avec un bouton « Réinitialiser ».
- Exports : bouton « Exporter CSV » sur chaque liste et tableau (membres existe déjà ; ajouter messages avec leurs statistiques, envois, pubs/coûts, joueurs, journal), séparateur `;`, encodage UTF-8 avec BOM (Excel français), dates en Europe/Paris.
- Raccourcis : `n` nouveau message depuis la page Messages, `/` focus sur la recherche, `?` affiche la liste des raccourcis.

## D. Guide d'utilisation `docs/GUIDE-UTILISATEUR.md` (français simple, non technique)
- Une section par menu dans l'ordre du menu : **à quoi ça sert**, **comment faire** (étapes numérotées avec les libellés exacts des boutons), **pièges et questions fréquentes**. Menus : Tableau de bord, Canaux (et séquences d'accueil / messages du bot), Bots, Messages (calendrier, catégories, modèles, boutons, médias), Liens, Membres (fiche, export, suppression), Envois (segments, test à soi-même, A/B), Pubs (campagnes, import des coûts), Automatisations, Journal, Réglages (connecteurs, postbacks, alertes, rapports, catégories, utilisateurs, état du système, sauvegardes).
- En tête : « Les 10 premières minutes » (se connecter, vérifier les bots, créer un canal, créer un lien de pub, programmer un message) et « Que faire si… » (le bot ne répond pas, un membre n'est pas accepté, une pub ne remonte pas, la synchro est en échec, une alerte arrive sur Telegram).
- Le guide est aussi accessible depuis le site : page **Aide** (`/help`) qui rend le Markdown du guide (lecture seule, table des matières), lien « Aide » dans le menu.

## E. Tests et livraison
- Tests vitest sur les nouveaux utilitaires (recherche : découpage de la requête ; export CSV : BOM et séparateur ; badges de statut : couverture de tous les statuts des enums Prisma).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build` verts ; déploiement vérifié ; `docs/STATUS.md`, `docs/DECISIONS-TECH.md`, `CLAUDE.md` (page Aide, recherche) à jour ; commit, push ; court message Telegram ; puis phase 6 (`08-phase-6-complements.md`).
