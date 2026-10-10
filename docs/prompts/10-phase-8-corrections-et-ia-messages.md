# Phase 8 — Corrections après la première utilisation + assistant IA pour écrire les messages

Si `docs/STATUS.md` indique déjà « phase 8 terminée », vérifie rapidement le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Contexte : le client a utilisé la plateforme le 10 octobre et a remonté les points ci-dessous. Lis `CLAUDE.md` (dont « Mode autonome »), `docs/STATUS.md`, `docs/A-FAIRE-HUMAIN.md`, `docs/02-decisions.md`, `docs/LINKAFFI-API.md`, `docs/LINKAFFI-SCHEMA.md`, `docs/LINKAFFI-SUBID.md`. Pour chaque bug : diagnostique avec les vraies données (base de production en lecture, logs Railway), écris un test qui reproduit le bug et échoue, puis corrige. Mode autonome : aucune question, décisions notées dans `docs/DECISIONS-TECH.md`.

## 1. Canaux existants introuvables (priorité 1, bloquant pour le lancement)
Constat : le client avait ajouté les bots comme administrateurs de ses canaux existants AVANT la mise en ligne des webhooks. Les mises à jour `my_chat_member` de ce moment sont perdues, et l'API Bot ne permet pas de lister les canaux d'un bot. Aujourd'hui un canal n'apparaît qu'au prochain `channel_post` (handler dans `packages/telegram/src/handlers/core.ts`).
- Diagnostic : canaux en base, `getWebhookInfo` de chaque bot (mises à jour en attente, dernière erreur), et vérifie qu'aucun type de mise à jour n'est ignoré.
- Toute mise à jour venant d'un canal inconnu (`channel_post`, `edited_channel_post`, `chat_join_request`, `chat_member`, `message_reaction_count`, `my_chat_member`) crée le canal et relève les droits de nos bots (`getChatAdministrators`).
- Page Canaux → bouton « Ajouter un canal existant », trois méthodes affichées dans cet ordre :
  1. **Transférer un message du canal à l'un des bots** (marche pour les canaux privés) : handler des messages privés avec `forward_origin.type === "channel"` (et l'ancien `forward_from_chat`), accepté seulement si l'expéditeur est un utilisateur de la plateforme (`User.telegramUserId`) ou l'admin (`Setting admin.telegramUserId`) ; `getChat` + `getChatAdministrators` → création du canal et des droits de chacun de nos bots ; le bot répond « Canal « X » ajouté ✅ (bots administrateurs : …) », ou explique clairement quoi faire si aucun de nos bots n'est administrateur. Si le canal interdit le transfert (contenu protégé), le bot le dit et propose la méthode 3.
  2. **Coller le lien public** `t.me/<nom>` ou `@nom` → `getChat`.
  3. **Publier un message dans le canal** (détection existante), puis le supprimer.
  Pendant 2 minutes après l'ouverture de la fenêtre, la page se rafraîchit toute seule et affiche le canal dès qu'il arrive.
- Si une session Telegram (MTProto, phase 7) est connectée : bouton « Importer tous mes canaux » qui liste les canaux dont le compte est administrateur ou créateur, pré-coche ceux où au moins un de nos bots est administrateur, et importe en un clic ; pour les autres, explication pour ajouter le bot (aucune modification automatique des droits).
- Bouton « Re-vérifier les droits des bots », par canal et pour tous les canaux.
- Dès que c'est déployé, envoie au client un message Telegram de 3 lignes : comment ajouter ses canaux existants (méthode 1).

## 2. Tableau de bord : retirer « Événements (24 h) »
- Supprimer la tuile « Événements (24 h) » (`apps/web/app/(admin)/page.tsx`). L'information reste dans Réglages → État du système et dans le Journal.

## 3. Bloc « Activité » : chiffres faux et hors sujet
Constats du client : (a) mêmes chiffres en 7, 30 et 90 jours ; (b) il affiche le total de Link Affi (toutes campagnes, tous affiliés), pas nos chiffres, alors qu'aucune campagne n'a encore été créée ; (c) ordre incompréhensible.
Pistes déjà repérées, à confirmer par des tests qui échouent avant correction :
- `loadDashboardUncached` (`apps/web/lib/dashboard/queries.ts`) : sans filtre canal ou univers, inscriptions, FTD, dépôts et NGR comptent TOUS les `PlayerEvent` / `Player` synchronisés depuis Link Affi.
- Le NGR est calculé sur `player.updatedAt` et `lastEventAt`, qui sont des dates d'import (la synchro touche tous les joueurs), d'où des totaux identiques quelle que soit la période. Vérifie aussi que `PlayerEvent.occurredAt` et `Player.registeredAt` / `ftdAt` portent bien les dates réelles Link Affi (`created_at`, `ftd_at`, dates de `player_financials`), et la même logique dans `apps/worker/src/stats/daily.ts`.
- `cachedDashboard` inclut bien les arguments dans sa clé ; vérifie quand même que la période choisie arrive jusqu'aux requêtes.
Règles à appliquer partout (tableau de bord, Pubs, Entonnoir, Cohortes, Canaux, fiches membres, rapports Telegram quotidien et hebdo, alertes métier, statistiques journalières) :
- « Nos » données = joueurs rattachés à un de nos clics (`sub_id` → `Click`) OU appartenant à une campagne Link Affi rattachée à une de nos campagnes (section 4). Rien d'autre n'entre dans les statistiques.
- Les données Link Affi non rattachées restent visibles uniquement dans Réglages → Connecteurs → Link Affi (diagnostic), jamais dans les statistiques.
- Toutes les dates sont les dates réelles des événements chez Link Affi, jamais la date d'import. Corrige les données déjà importées (migration ou resynchronisation complète), puis recalcule les statistiques journalières.
- NGR d'une période = somme des NGR datés dans la période (`player_financials` ou snapshots, selon `docs/LINKAFFI-SCHEMA.md`), pas un cumul.
- Présentation en deux lignes, dans l'ordre du parcours : **Telegram** : Demandes → Acceptés → Entrées → Départs ; **Argent** : Clics pub → Clics offre → Inscriptions → Premiers dépôts (FTD) → Dépôts (€) → NGR (€). Libellés en français simple, graphique par jour cohérent avec la période.
- Tant qu'aucune campagne n'existe : état vide clair « Pas encore de chiffres : créez votre première campagne », avec le bouton.
- Tests : 7, 30 et 90 jours donnent des totaux différents sur un jeu de données daté ; les données d'un autre affilié Link Affi sont exclues ; NGR daté ; le brief de 9 h et les alertes n'envoient plus de totaux Link Affi globaux.

## 4. Campagnes : introuvables, à rendre centrales
Constat : la page existe (`/campaigns`) mais s'appelle « Pubs » dans le menu et ne gère que la structure publicitaire. Le client cherche « Campagne » au sens : ce qu'on promeut, où, avec quelles pubs.
- Menu : entrée « Campagnes » en 2e position (après Tableau de bord), bouton « Nouvelle campagne » bien visible en haut de la page et sur le tableau de bord vide.
- Une campagne = nom + univers (casino, paris sportifs, dating) + offre(s) Link Affi + canaux Telegram + pubs (TikTok, Meta ou autre, avec le compte pub s'il est connecté) + liens d'entrée + budget et dates (facultatifs).
- Assistant « Nouvelle campagne » en 4 étapes, une ligne d'aide par étape : (1) nom, univers, dates, budget ; (2) offre : choisir dans la liste des campagnes Link Affi synchronisées (recherche par nom, clé, casino) ou coller le lien `linkaffi.me/go/<clé>` ; (3) canaux : cocher ; (4) pubs : plateforme, compte (si connecté), nombre de pubs → un lien d'entrée par pub (go.goolink.eu + lien d'invitation avec demande d'adhésion), avec l'URL à coller ; récapitulatif → Créer. Tout reste modifiable ensuite.
- Page d'une campagne, onglets : Vue d'ensemble (dépense, clics pub, membres, clics offre, inscriptions, FTD, dépôts, NGR, CPL, CPA, coût par FTD, ROAS, bénéfice, avec période et comparaison), Pubs (structure TikTok / Meta existante et coûts), Liens, Canaux, Messages, Membres.
- Vocabulaire dans toute l'interface : « Campagne » = la nôtre ; « campagne pub » = la structure TikTok / Meta, affichée dans l'onglet Pubs.
- Reprendre l'existant sans rien casser : rattacher les campagnes pub actuelles (s'il y en a) à une campagne ; liens d'entrée, imports CSV, connecteurs de la phase 7 et convention de nommage continuent de marcher.
- Bouton « Offre » d'un message et réponses d'offre du bot : on choisit la campagne (qui détermine le lien Link Affi), plus une campagne Link Affi brute.
- Filtre « Campagne » sur le tableau de bord, Membres, Messages et Envois.

## 5. Catégories de messages : c'est le client qui les crée
- Supprimer les 7 catégories créées d'office (`packages/db/prisma/seed.ts`) et ne plus jamais en créer automatiquement. Catégories inutilisées : suppression ; catégories portées par des messages de test : retirer la catégorie de ces messages, puis supprimer. Les 63 modèles gardent leur thème interne sans dépendre des catégories.
- Création facile : dans le formulaire de message, le champ Catégorie propose « + Nouvelle catégorie » (nom + couleur) sans quitter la page ; Réglages → Catégories pour renommer, changer la couleur, l'ordre, fusionner, supprimer (avec choix d'une catégorie de remplacement).
- La comparaison par catégorie et les meilleurs horaires fonctionnent avec les catégories du client ; état vide qui invite à créer la première.

## 6. Assistant IA pour écrire les messages (demandé par le client le 10 octobre)
Décision : l'IA « manager » complète reste écartée ; on ajoute uniquement un assistant d'écriture. Mets à jour `docs/02-decisions.md`.
- Partout où l'on écrit un message (message de canal, messages du bot : accueil, rappels, offre ; envois groupés ; modèles ; automatisations) : bouton « ✨ Améliorer avec l'IA ».
- Entrées : le brouillon, l'univers (déduit de la campagne ou du canal, modifiable : casino, paris sportifs, dating), la catégorie, la langue, l'objectif (clic sur l'offre, inscription, engagement, relance des inactifs), le ton, la longueur, la présence d'un média.
- Sortie : 3 versions améliorées avec des angles différents, chacune avec une phrase qui explique ce qui change ; boutons « Utiliser », « Plus court », « Plus percutant », « Autre angle », « Traduire dans les langues du bot », « Créer la version B d'un test A/B ». Le texte respecte le HTML Telegram, les limites (1024 caractères avec média, 4096 sans), et laisse intacts les repères (`{prenom}`, `{canal}`…) et les liens.
- « Écrire à partir d'une idée » : une phrase → 3 propositions.
- « Ce qui marche chez vous » : dès qu'il y a assez de données, joindre en exemples les messages de l'équipe les plus performants pour le même univers et la même catégorie (taux de clic, FTD), sans aucune donnée personnelle.
- Règles imposées au modèle (prompt système non modifiable par l'utilisateur) : ne jamais promettre de gains, de résultat garanti ni d'argent facile ; garder la mention des risques et 18+ pour casino et paris sportifs (texte réglable dans Réglages → IA, par défaut celui des modèles existants) et l'ajouter si elle manque ; aucune affirmation trompeuse (faux bonus, faux témoignages, fausses preuves de gains) ; ne pas inventer les détails d'une offre (montant de bonus, conditions) : laisser un repère « [à compléter] » ; dating : adultes uniquement, suggestif mais jamais explicite, conforme aux règles Telegram ; jamais de contenu visant des mineurs.
- Technique : API Claude d'Anthropic avec le SDK officiel ; lis docs.claude.com pour choisir le modèle actuel rapide et économique par défaut, avec une option « qualité supérieure » sur un modèle plus puissant ; mise en cache du prompt système et des exemples ; clé API saisie par un ADMIN dans Réglages → IA (chiffrée en base, bouton « Vérifier »), avec sur la même page le guide pas à pas pour créer la clé dans la console Anthropic (clics exacts d'après la doc actuelle) ; plafond de dépense mensuel en € réglable, compteur d'usage et coût estimé du mois, limite par utilisateur ; historique des suggestions ; sans clé, le bouton explique où l'ajouter. Tests avec l'API simulée, aucun appel réel sans clé.
- Ajoute en tête de `docs/A-FAIRE-HUMAIN.md` : « Créer la clé API Anthropic et la coller dans Réglages → IA (5 minutes) ».

## 7. Livraison
- Ordre : 1, 2, 3, 5, puis 4 et 6 (sous-agents en parallèle quand les fichiers ne se recouvrent pas).
- `pnpm lint && pnpm build && pnpm test` verts, migrations appliquées, déploiement vérifié, statistiques recalculées, contrôle visuel des pages modifiées avec le compte de vérification.
- `docs/STATUS.md`, `docs/A-FAIRE-HUMAIN.md`, `docs/GUIDE-UTILISATEUR.md` (sections Canaux, Campagnes, Catégories, IA), `docs/DECISIONS-TECH.md` et `CLAUDE.md` à jour ; commit et push.
- Bilan Telegram court : ce qui est corrigé, comment ajouter les canaux existants, la clé IA à créer. Puis crée `docs/PHASE-DONE`.
