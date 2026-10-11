# Refonte UX & design — plan validé le 10 octobre 2026

Ce fichier est la spécification de la phase 9. Il reprend l'audit et le plan rédigés par Claude (document « Refonte UX & design — audit et plan ») et les réponses du client. En cas de doute, ce fichier prime sur l'existant.

## Pourquoi
Le site est complet mais parle comme un ingénieur : 12 entrées de menu au même niveau, 44 écrans, des formulaires de 8 à 15 boutons (message : 894 lignes, 15 boutons ; envoi groupé : 736 lignes, 11 boutons), du jargon partout (sub-ID, FTD, NGR, CPL, CPA, ROAS, webhook, postback, déclencheur, cohorte, segment), 17 infobulles sur la seule page d'accueil, un thème par défaut sans identité (noir, gris, blanc, police du système, aucune couleur d'univers). L'aide compense la complexité au lieu de la supprimer.

## Les six règles
1. Une page répond à une question (Accueil : ça marche ? Campagnes : qu'est-ce que je promeus et combien ça rapporte ? Messages : qu'est-ce qui part et quand ? Membres : qui sont-ils et comment leur parler ?).
2. Le fréquent d'abord, le rare derrière « Avancé » : un formulaire montre 3 à 5 champs ; le reste se déplie à la demande, avec des valeurs par défaut sensées.
3. Zéro jargon en surface : les mots du client (premier dépôt, revenu net, identifiant de suivi, retour sur dépense pub, relance, écrire à un groupe). Le terme technique reste disponible au survol.
4. Trois clics maximum pour les gestes courants, depuis n'importe quelle page.
5. Une identité visuelle : une couleur de marque, une couleur par univers, une typographie, trois tailles de texte, un bouton principal par page.
6. On ne retire aucune capacité, on la range : ce qui disparaît du menu se retrouve dans Réglages ou derrière « Avancé » ; les anciennes adresses redirigent.

## Réponses du client (10 octobre)
- Style : clair et sobre, couleur par univers.
- Marque : logo Link Affi fourni (`apps/web/public/brand/logo.png`) : un « L » en maillons de chaîne orange `#FCA314` sur fond nuit `#020713`. Couleur principale = orange du logo ; barre de menu = fond nuit du logo ; contenu clair.
- Pas de notion affichée de « gestes quotidiens » : c'est une règle de conception, pas un élément d'interface.
- Trois chiffres de l'accueil : membres arrivés aujourd'hui, premiers dépôts aujourd'hui, gains du jour (nos commissions moins la dépense pub ; règle de la phase 10, les dépôts et le revenu net ne s'y ajoutent jamais).
- Automatisations : relances prêtes à l'emploi en cartes ; le constructeur avancé est conservé derrière « Avancé » et devient un **éditeur visuel à branches**, style Make / Zapier / n8n (nœuds reliés, conditions oui / non, zoom, glisser-déposer).
- Vocabulaire : la table ci-dessous suffit.
- Téléphone : accueil, calendrier et demandes à valider pensés d'abord pour le téléphone ; le reste surtout ordinateur.
- Calendrier des messages : vue semaine par défaut.
- Mode sombre : plus tard.
- Visite guidée de 2 minutes à la première connexion, avec liste « à faire » : oui.
- Illustrations : icônes simples seulement.
- Mise en ligne par morceaux : chaque page refaite remplace l'ancienne dès qu'elle est prête.

## Vocabulaire (à appliquer partout : interface, guide, rapports Telegram, exports)
| Terme technique | Mot affiché | Au survol |
| --- | --- | --- |
| FTD | premier dépôt | FTD |
| NGR | revenu net | NGR |
| sub-ID | identifiant de suivi | sub-ID |
| ROAS | retour sur dépense pub | ROAS |
| CPL / CPA | coût par membre / coût par inscription | CPL / CPA |
| automatisation, règle | relance automatique | — |
| envoi groupé, segment | écrire à un groupe, groupe de membres | — |
| séquence | messages du bot | — |
| cohorte | membres dans le temps | cohorte |
| entonnoir | parcours | entonnoir |
| webhook, postback | connexion, retour du casino | terme exact dans Réglages → Avancé seulement |

## Identité visuelle
- Couleurs : nuit `#020713` (barre de menu, en-têtes sombres) ; orange `#FCA314` (bouton principal, lien actif, élément sélectionné, accents) avec une variante foncée pour le texte sur fond clair (contraste AA) ; fond `#FAFAF7` (blanc cassé), surfaces blanches, texte anthracite `#1A1F2B`, texte secondaire gris ; succès vert, attention ambre (distinct de l'orange de marque : utiliser un jaune-brun), erreur rouge. Univers : casino violet `#7C3AED`, paris sportifs vert `#059669`, dating rose `#DB2777` ; toujours en pastille, bordure fine ou étiquette, jamais en fond plein.
- Typographie : Inter (auto-hébergée via `next/font`), trois tailles seulement : titre 20 / 600, texte 14 / 400, note 12 / 400 ; chiffres tabulaires (`font-variant-numeric: tabular-nums`) ; gros chiffres des cartes 28 / 600.
- Espacement : grille de 8 ; cartes rayon 12 ; bordures 1 px gris clair ; aucune ombre portée lourde.
- Composants (dans `apps/web/components/ui-v2/` ou refonte des existants, un seul style) : `PageHeader` (titre, une ligne d'aide, un bouton principal orange, actions secondaires discrètes), `StatCard` (libellé, gros chiffre, variation colorée, mini-courbe), `DataTable` (5 colonnes maximum, ligne cliquable qui ouvre un volet latéral de détail, tri, vide), `FormSection` + `AdvancedSection` (bloc replié « Avancé »), `EmptyState` (icône, une phrase, un bouton), `StatusPill`, `UniverseDot`, `HelpButton` (« ? » contextuel), `Stepper` (assistants en étapes), `ConfirmDialog`.
- Barre de menu : fond nuit, logo en haut, 6 entrées + Réglages en bas, entrée active soulignée d'orange ; sur téléphone : barre en bas avec Accueil, Messages, Membres, Campagnes, Plus.
- Page interne `/styleguide` (ADMIN) qui montre tous les composants et les couleurs ; `docs/DESIGN-SYSTEM.md` avec les règles.

## Navigation cible (6 entrées + Réglages)
| Menu | Contenu | Reprend |
| --- | --- | --- |
| Accueil | État, 3 chiffres du jour, À faire, Prochains messages, Campagnes actives | l'ancien tableau de bord (vue d'ensemble) |
| Campagnes | Cartes de campagnes ; assistant en 4 étapes ; onglets Vue d'ensemble, Pubs, Liens, Canaux, Messages, Membres | Pubs, Liens |
| Canaux | Liste ; fiche en langage courant : « Qui peut entrer et quand », « Ce que dit le bot », « Membres » | Canaux (sans l'onglet Meilleurs horaires, déplacé dans le calendrier) |
| Messages | Calendrier semaine coloré par univers ; création en 3 niveaux ; modèles | Messages |
| Membres | Liste avec filtres en langage courant ; « Écrire à un groupe » ; « Relances automatiques » | Membres, Envois, Automatisations |
| Statistiques | Sélecteur unique (période, univers, campagne) ; pages Pubs, Parcours, Canaux, Membres dans le temps | Tableau de bord détaillé |
| Réglages | Cartes : Connexions, Bots, Équipe, Alertes et rapports, IA, Catégories et étiquettes, Journal, État du système, Avancé (postbacks) | Réglages, Bots, Journal |
| Aide | Bouton « ? » en haut à droite : aide de la page courante ; guide complet ; visite guidée | Aide |

Toutes les anciennes adresses (`/campaigns`, `/links`, `/broadcasts`, `/automations`, `/bots`, `/journal`, `/help`…) redirigent vers leur nouvel emplacement.

## Accueil (maquette validée)
De haut en bas : barre d'état verte « Tout va bien · 3 bots en ligne · Link Affi synchronisé il y a 2 min » (orange avec le nombre de points à voir sinon) ; trois cartes (membres arrivés aujourd'hui, premiers dépôts aujourd'hui, gains du jour) avec variation vs hier ; « À faire » (demandes à valider, messages en échec, connexion à refaire, test A/B à conclure, éléments de `docs/A-FAIRE-HUMAIN.md` pertinents) ; « Prochains messages » (3 prochains, lien « Programmer un message ») ; « Campagnes actives » (3 colonnes : dépensé, membres, gains). Pensé d'abord pour le téléphone.

## Formulaires en trois niveaux
- Niveau 1 (visible) : ce qu'il faut pour que ça marche. Message : canal(aux), texte avec aperçu Telegram à droite, date et heure, catégorie (avec « + Nouvelle catégorie »). Écrire à un groupe : qui (groupe), quoi (texte), quand (maintenant ou date).
- Niveau 2 (un clic) : médias, boutons, test A/B.
- Niveau 3 (« Avancé », replié) : épingler, désépingler le précédent, supprimer après N minutes, silencieux, contenu protégé, sans aperçu de lien, langue, part du test A/B.
- Un seul bouton principal : « Programmer » / « Envoyer ». Brouillon en secondaire.

## Relances automatiques (Membres → Relances automatiques)
Cartes prêtes à l'emploi, écrites en français, avec deux ou trois cases à régler (délai, message, canaux) : rejoint un canal → bienvenue ; a cliqué une offre sans s'inscrire sous 1 jour → relance ; inscrit sans dépôt sous 2 jours → relance ; rien fait depuis 7 jours → relance ; premier dépôt → merci ; dépôts au-delà d'un seuil → message VIP. Sur chaque carte : aperçu du message modifiable (avec « ✨ Améliorer avec l'IA »), canaux, interrupteur, « Tester sur moi », compteur « envoyé à N personnes cette semaine, M ont cliqué ».

**Éditeur avancé à branches** (derrière « Créer une relance sur mesure (avancé) ») : un canevas type Make / Zapier / n8n : nœud de départ (déclencheur), nœuds de condition avec deux sorties « oui » / « non », nœuds d'action (envoyer un message, attendre, étiqueter, proposer un canal, prévenir l'équipe, arrêter), reliés par des liens ; glisser-déposer, zoom, mini-carte, validation en direct (nœud incomplet surligné), « Tester sur moi », journal des exécutions par nœud. Les règles existantes (chaîne linéaire) s'ouvrent dans l'éditeur comme une branche unique. Le moteur d'exécution doit supporter les branches (graphe) sans casser les règles existantes.

## Page par page : ajouter / modifier / enlever
Voir le tableau de la section 6 du document d'audit, reporté ici en résumé :
- Accueil : ajouter état, 3 chiffres, À faire, prochains messages, campagnes actives ; enlever les 5 onglets, 11 indicateurs, 17 infobulles (déplacés dans Statistiques).
- Campagnes : cartes, assistant 4 étapes, onglets ; absorbe Pubs et Liens.
- Canaux : fiche en langage courant ; trois choix d'accueil (tout de suite / après un délai / après avoir rejoint ces canaux) ; Bots → Réglages.
- Messages : calendrier coloré, formulaire 3 niveaux, IA, catégories à la volée ; options rares dans Avancé.
- Membres : filtres en langage courant (ont déposé, rien fait depuis 7 jours, venus de telle pub, telle campagne, tel univers) ; fiche : l'essentiel d'abord, chronologie en dessous ; deux boutons Écrire à un groupe / Relances automatiques.
- Statistiques : sélecteur unique ; tableaux ≤ 5 colonnes, détail au clic ; graphiques avant tableaux ; mots du vocabulaire.
- Réglages : un écran en cartes qui regroupe les 15 sous-pages.
- Partout : barre d'actions (un bouton principal), recherche globale, « ? » contextuel, affichage téléphone, remplacement du vocabulaire, infobulles remplacées par des mots clairs (terme technique au survol).
