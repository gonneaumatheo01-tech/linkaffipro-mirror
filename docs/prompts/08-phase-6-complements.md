# Phase 6 — Compléments du cadrage (rédigé par Claude le 9 octobre 2026, mode autonome ; aucune intervention humaine)

Pré-requis : phases 4 et 5 déployées. Objectif : livrer ce que le cadrage (`docs/01-cadrage-analyse.md` sections 2 et 6) liste encore et qui ne demande ni compte, ni clé, ni clic humain. Par ordre de valeur pour l'équipe. Rien vers de vrais membres : tout test est simulé ou limité au compte de vérification.

## A. Meilleurs horaires de publication (par canal et par catégorie)
- Calcul hebdomadaire (file `stats`) à partir des `PostStats` / clics / réactions des 8 dernières semaines : carte jour × heure (Europe/Paris) du taux de clic et des réactions par message, par canal et par catégorie ; stockée dans `Setting` `besthours.<channelId>` ou une table `BestHour` (migration) si plus simple.
- Affichage : onglet Canaux → fiche canal → « Meilleurs horaires » (déjà esquissé dans le tableau de bord Canaux : à compléter), et suggestion dans le formulaire de message : « Meilleur créneau pour ce canal et cette catégorie : mardi 19 h » avec un bouton « Utiliser ».

## B. Tests A/B des messages de canal
- Comme pour les envois groupés (phase 3) : un message programmé peut avoir une variante B (texte, média, boutons) ; les deux sont publiées dans le même canal à 30 min d'intervalle ou dans deux canaux choisis (option) ; comparaison des vues (si disponibles), réactions et clics ; page de comparaison et gagnant provisoire. Réutilise `packages/core/src/ab.ts`.

## C. Modèles de messages prêts à l'emploi par univers
- Bibliothèque de modèles (`Post` avec `templateName`, catégorie, langue) créée par un script de seed idempotent (`pnpm seed:templates`) : casino, paris sportifs, dating × catégories (bonus, preuve de gains, teasing, rappel, information, événement, sondage), en français avec variables (`{prenom}`, `{canal}`, `{offre}`), ton sobre et conforme aux règles Telegram (pas de promesse de gains garantis, mention « jouer comporte des risques » pour le casino et les paris). Page Messages → « Modèles » : filtre par univers et catégorie, « Utiliser ce modèle ».
- Séquences d'accueil par défaut relues et complétées par univers (fr) ; traductions en, es, pt, de, it des textes du bot (`packages/telegram` : fichiers de langue) pour l'accueil, les rappels, l'acceptation, la réponse d'offre.

## D. Alertes supplémentaires
- Règles : chute des inscriptions (−50 % sur 24 h par rapport à la moyenne 7 jours, avec au moins 10 inscriptions attendues), dépense sans conversion (pub avec coût > 50 € sur 24 h et 0 inscription), canal qui fuit (départs > 10 % des membres en 24 h), message programmé en échec, lien d'offre inactif cliqué. Même mécanisme (`alert-rules.ts`), réglables dans Réglages → Alertes (seuils), tests unitaires.

## E. Import CSV des coûts amélioré
- Détection automatique du format (TikTok Ads Manager, Meta Ads Manager, générique) par les en-têtes, aperçu des 5 premières lignes avec la correspondance proposée (colonne → champ), correction manuelle, mémorisation du mapping par source, gestion des formats de nombres (`1 234,56`, `1,234.56`) et de dates (JJ/MM/AAAA, AAAA-MM-JJ), rapport d'import (lignes importées, ignorées, raisons).

## F. Comparaisons de périodes et exports partout
- Sélecteur de période commun (aujourd'hui, hier, 7 jours, 30 jours, mois en cours, personnalisé) avec « comparer à la période précédente » sur tous les onglets du tableau de bord, les fiches canal, pub, campagne et message ; variation en % avec couleur.
- Exports CSV de chaque tableau comparé (si non faits en phase 5).

## G. Page Équipe
- Réglages → Équipe : liste des utilisateurs (nom, e-mail, rôle, dernière connexion, actif), invitation par e-mail avec lien (copie du lien, pas d'envoi d'e-mail : pas de service de mail), changement de rôle, désactivation, réinitialisation du mot de passe par lien d'invitation ; tout en ADMIN seulement, tout journalisé. Compléter ce qui existe déjà dans `settings/users`.

## H. Reste du cadrage réalisable sans humain
- Épinglage et suppression automatique des messages de canal (options du message : épingler après envoi, supprimer après N heures) via la file `scheduler`.
- Étiquettes de membres : gestion des étiquettes (créer, renommer, couleur), filtre par étiquette dans Membres et Envois (le champ existe déjà dans le segment).
- Notes sur un membre (`MemberNote` existe) : affichage et ajout depuis la fiche membre si ce n'est pas encore fait.
- Convention de nommage des campagnes (`TT-casinoX-FR-canalA-2026-10`) : aide dans le formulaire de pub et liaison automatique campagne pub ↔ campagne Link Affi par nom (proposition, validée par l'utilisateur).

## I. Livraison
- Tests unitaires sur chaque règle pure (horaires, A/B canal, détection CSV, alertes) ; tests d'intégration si une route est ajoutée.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build` verts ; déploiement vérifié ; `docs/STATUS.md`, `docs/DECISIONS-TECH.md`, `docs/GUIDE-UTILISATEUR.md`, `CLAUDE.md` à jour ; commit, push.
- Fin de la chaîne : bilan complet par Telegram (tout ce qui existe, la liste `docs/A-FAIRE-HUMAIN.md`, les idées pour la suite), puis `docs/PHASE-DONE`.
