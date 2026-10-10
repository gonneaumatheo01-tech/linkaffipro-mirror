# Phase 9 — Refonte UX et design (site facile, beau, en langage courant)

Si `docs/STATUS.md` indique déjà « phase 9 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md` (dont « Mode autonome »), **`docs/REFONTE-UX.md` (la spécification de cette phase, validée par le client : elle prime)**, `docs/STATUS.md`, `docs/GUIDE-UTILISATEUR.md`, `docs/A-FAIRE-HUMAIN.md`, `docs/02-decisions.md`. Mode autonome : aucune question, décisions dans `docs/DECISIONS-TECH.md`, aucun test humain.

**Ce que tu es dans cette phase** : un designer produit senior et un développeur front senior. Tu ne changes ni les données, ni les bots, ni les synchronisations, ni les calculs : seulement la façon de les présenter, de les nommer et d'y naviguer. Tout ce qui existe reste accessible (rangé, pas supprimé). Mise en ligne par morceaux : chaque étape est déployée dès qu'elle est prête et remplace l'ancienne page ; les anciennes adresses redirigent.

## Étape 1 — Socle visuel
- Logo : `apps/web/public/brand/logo.png` (et `.webp`), couleurs de marque nuit `#020713` et orange `#FCA314`, identité complète dans `docs/REFONTE-UX.md` (section « Identité visuelle »). Génère aussi le favicon et l'icône Apple à partir du logo.
- Variables de thème (`globals.css`) : remplace le thème par défaut par la palette de la spécification ; vérifie le contraste AA de l'orange sur fond clair (utilise une variante foncée pour le texte) ; thème clair uniquement, le mode sombre viendra plus tard (ne laisse pas de demi-thème sombre cassé).
- Typographie Inter via `next/font`, trois tailles (titre, texte, note) + gros chiffre ; chiffres tabulaires.
- Composants : `PageHeader`, `StatCard`, `DataTable` (≤ 5 colonnes, ligne cliquable, volet latéral de détail), `FormSection` / `AdvancedSection`, `EmptyState`, `StatusPill`, `UniverseDot`, `HelpButton`, `Stepper`, `ConfirmDialog`. Un seul style ; refonte des composants existants plutôt qu'une deuxième bibliothèque. Page interne `/styleguide` (ADMIN) et `docs/DESIGN-SYSTEM.md`.
- Barre de menu fond nuit avec le logo, entrée active soulignée d'orange ; barre du bas sur téléphone (Accueil, Messages, Membres, Campagnes, Plus).
- Déploie : le site change d'allure sans changer de place.

## Étape 2 — Menu, accueil, aide, visite guidée
- Nouveau menu à 6 entrées + Réglages (table « Navigation cible » de la spécification). Redirections de toutes les anciennes adresses. Recherche globale conservée.
- Accueil exactement comme la maquette validée (section « Accueil ») : barre d'état, trois cartes (membres arrivés aujourd'hui, premiers dépôts aujourd'hui, bénéfice du jour = dépôts et revenus moins dépense pub, avec variation vs hier), « À faire », « Prochains messages », « Campagnes actives ». Pensé d'abord pour le téléphone. Chaque bloc mène à sa page en un clic.
- « ? » en haut à droite : ouvre dans un volet l'aide de la page courante (sections du guide), avec le lien vers le guide complet.
- Visite guidée de 2 minutes à la première connexion de chaque utilisateur (5 à 7 étapes, en français simple, sans dépendance lourde), avec une liste « à faire pour démarrer » (relier Telegram, créer une campagne, programmer un message, inviter l'équipe). Réglages → « Revoir la visite ».

## Étape 3 — Campagnes
- Cartes de campagnes (pastille d'univers, dépensé, membres, premiers dépôts, bénéfice, tendance) ; assistant de création en 4 étapes (déjà construit en phase 8 : reprends-le avec `Stepper`, une ligne d'aide par étape) ; page d'une campagne avec onglets Vue d'ensemble, Pubs, Liens, Canaux, Messages, Membres. Les menus Pubs et Liens disparaissent du menu principal (redirections).

## Étape 4 — Messages
- Calendrier semaine par défaut, coloré par univers, glisser pour déplacer un message, meilleurs créneaux suggérés directement dans le calendrier (l'ancien onglet « Meilleurs horaires » des canaux est retiré).
- Création en trois niveaux (section « Formulaires en trois niveaux ») : visible (canaux, texte avec aperçu Telegram à droite, date et heure, catégorie avec « + Nouvelle catégorie ») ; un clic (médias, boutons, test A/B) ; « Avancé » replié (épingler, désépingler, supprimer après, silencieux, contenu protégé, sans aperçu de lien, langue). Un seul bouton principal « Programmer ». Le bouton « ✨ Améliorer avec l'IA » de la phase 8 est intégré dans l'éditeur.
- Modèles : galerie filtrable par univers et catégorie, aperçu, « Utiliser ».

## Étape 5 — Membres, Écrire à un groupe, Relances automatiques
- Liste : filtres en langage courant (ont déposé, premier dépôt, rien fait depuis 7 / 30 jours, venus de telle pub ou campagne, tel univers, tel canal, telle étiquette) ; colonnes ≤ 5 ; fiche : l'essentiel d'abord (d'où il vient, ce qu'il a fait, combien il a déposé, étiquettes), chronologie complète en dessous.
- « Écrire à un groupe » (ex-Envois) en 3 étapes : qui (groupe = filtres), quoi (texte, médias, boutons, IA), quand (maintenant ou date) ; test A/B dans « Avancé » ; récapitulatif « 1 240 membres recevront ce message » avant d'envoyer.
- « Relances automatiques » (ex-Automatisations) : cartes prêtes à l'emploi (section « Relances automatiques »), interrupteur, « Tester sur moi », compteur. Les règles existantes sont converties en cartes quand elles correspondent, gardées en « sur mesure » sinon.
- **Éditeur avancé à branches** (« Créer une relance sur mesure (avancé) ») : canevas à nœuds style Make / Zapier / n8n, avec une bibliothèque de canevas éprouvée (par exemple `@xyflow/react`) : déclencheur → conditions (sorties oui / non) → actions (envoyer un message, attendre, étiqueter, proposer un canal, prévenir l'équipe, arrêter) ; glisser-déposer, zoom, mini-carte, validation en direct, « Tester sur moi », journal d'exécution par nœud. Étends le moteur (`AutomationRule` / `AutomationRun`) à un graphe avec branches, en gardant les règles linéaires existantes valides (migration : une branche unique). Tests unitaires du moteur (branches oui / non, attente, arrêt) et du convertisseur.

## Étape 6 — Canaux
- Fiche en langage courant : « Qui peut entrer et quand » (trois choix : tout de suite / après un délai / après avoir rejoint ces canaux, puis les détails), « Ce que dit le bot » (accueil, rappel, accepté, réponse d'offre, avec aperçu et IA), « Membres ». Le bouton « Ajouter un canal existant » de la phase 8 reste en évidence. Bots → Réglages → Bots.

## Étape 7 — Statistiques et Réglages
- Statistiques : sélecteur unique (période, univers, campagne) en haut ; pages Pubs, Parcours (ex-entonnoir), Canaux, Membres dans le temps (ex-cohortes) ; graphiques avant tableaux ; tableaux ≤ 5 colonnes, détail au clic ; comparaison de période conservée.
- Réglages : un écran en cartes (Connexions, Bots, Équipe, Alertes et rapports, IA, Catégories et étiquettes, Journal, État du système, Avancé : postbacks) ; les sous-pages gardent leur contenu, habillées avec le nouveau socle.

## Étape 8 — Vocabulaire et vérification visuelle
- Applique la table « Vocabulaire » partout : interface, guide, rapports et alertes Telegram, exports, modèles, textes du bot côté admin. Le terme technique reste au survol (`title`) ; les infobulles longues sont remplacées par une phrase claire ou retirées.
- Captures automatiques (Playwright, compte de vérification) de chaque page en 1440 px et en 390 px, enregistrées dans `docs/captures/` (petits fichiers webp, commités) avec un index `docs/REFONTE-CAPTURES.md`. Relis chaque capture comme un designer exigeant : débordements, textes coupés, contrastes, hiérarchie, alignements, cohérence ; corrige puis recapture. Contrôle d'accessibilité automatique (axe) sans erreur critique.
- `docs/GUIDE-UTILISATEUR.md` et la page Aide réécrits avec les nouveaux noms et parcours ; `docs/DESIGN-SYSTEM.md` ; `CLAUDE.md` (composants, règles de vocabulaire, interdiction de réintroduire du jargon en surface) ; `docs/DECISIONS-TECH.md`.

## Livraison
- Après chaque étape : `pnpm lint && pnpm build && pnpm test` verts, déploiement vérifié, commit et push, court message Telegram « Étape N en ligne : … ».
- À la fin : `docs/STATUS.md`, bilan Telegram (ce qui a changé, où retrouver chaque ancienne page, la visite guidée), puis `docs/PHASE-DONE`.
