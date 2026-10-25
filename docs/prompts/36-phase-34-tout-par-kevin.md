# Phase 34 — Tout par Kevin : chaque réglage et chaque action du site devient faisable en parlant à Kevin sur Telegram, et le restera pour toute nouvelle fonction

Si `docs/STATUS.md` indique déjà « phase 34 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

**Ordre d'exécution** : après les phases 33 (ordres, voir, agents nommables, voix) et 35 (cotes chez nos bookmakers), **avant** les phases 28 à 32 (file d'attente). `docs/STATUS.md` contient donc les phases 19 à 27, 33 et 35. Les actions serveur ajoutées par la phase 35 (page Bookmakers) sont couvertes comme les autres.

Lis `CLAUDE.md`, `docs/STATUS.md`, `docs/DECISIONS-TECH.md`, `docs/AGENTS-ARCHITECTURE.md` (dont la section « Ordres de Kevin » de la phase 33), `docs/prompts/28-phase-26-boss-telegram.md`, `docs/prompts/35-phase-33-kevin-ordres-equipes.md`, tout `packages/agents/src/boss/` et `packages/agents/src/orders/` (registre des capacités, planificateur, `view/`, `agents-dict.ts`), **toutes les actions serveur du site** (`apps/web/**` fichiers `"use server"` : 53 fichiers, environ 218 fonctions exportées le 25 octobre — `saveChannelPlanAction`, `saveBetCategoryAction`, `savePersonaAction`, `createCampaignWizardAction`, `createBroadcastAction`, `saveRuleAction`, `saveAlertThresholdsAction`, `setAutonomyLevelAction`, `setSimulationAction`, `saveBookmakerCredentialsAction`, `addCasinoThemeAction`, `addOfferAction`, `createPostAction`, `scheduleAction`, `saveLandingPageAction`, etc.) et les fonctions métier qu'elles appellent, les pages admin (`apps/web/app/(admin)/**` : agents, campagnes, liens, affiliés, canaux, conversations et personas, membres, automatisations, envois, messages, catégories, emojis, pages, réglages : comptes, IA, alertes, assistant, bots, catégories, connecteurs Meta / TikTok / Telegram, journal, postbacks, rapports, statut, tags, équipe ; statistiques), les droits par rôle (admin, responsable, membre) côté site et côté groupe Telegram (phase 26). Décisions courantes : prends-les, note-les, continue. Livre par étapes, un commit par étape.

## Étapes
1. Inventaire automatique : `pnpm kevin:parity` liste toutes les actions serveur et leur fonction métier ; table `docs/KEVIN-PARITE.md` (action → capacité Kevin, ou exclusion avec raison et remplacement).
2. Capacités de réglage par domaine, branchées sur les **mêmes fonctions métier** que le site (mêmes validations, mêmes droits, même journal).
3. Entrées propres à Telegram : fichiers (CSV, médias), messages transférés comme contenu de post, liens, boutons de choix ; liens d'autorisation pour ce qui exige un navigateur.
4. Sécurité : droits par rôle, confirmations renforcées pour ce qui détruit, secrets en privé seulement, injection.
5. Garde-fou permanent : un test fait échouer la CI si une action serveur n'est pas couverte (capacité Kevin ou exclusion documentée) — toutes les phases suivantes (28 à 32) y sont soumises.
6. Aide « comment je fais X ? », tests, relecture adverse, déploiement, documentation, bilan, `docs/PHASE-DONE`.

## But de la phase
Le client veut tout mettre en place **uniquement par Telegram, en parlant à Kevin**. Après la phase 33, Kevin sait donner des ordres aux équipes et dire ce que chaque agent va faire. Cette phase lui donne **tout le reste** : chaque chose qu'on peut régler ou lancer sur le site (canaux, plans, campagnes, liens, offres, affiliés, membres, envois, automatisations, messages, catégories, personas, catégories de paris, bookmaker, thèmes casino, budgets, plafonds, niveaux, simulation / vrai, alertes, rapports, bots, IA, équipe, tags, postbacks, connecteurs, pages d'atterrissage…) se fait aussi en une phrase à Kevin. Le site reste là pour regarder en grand, mais le client n'en a plus besoin pour agir.

Exemples à faire marcher : « ajoute le canal t.me/xxx et mets-le en paris sportifs », « crée une campagne pour Celsius en France avec un CPA de 120 », « donne-moi un lien de suivi pour TikTok sur Zone Interdite », « passe le casino en vrai » (OUI), « monte le budget vidéo à 80 € ce mois-ci » (OUI), « crée la persona Inès, 24 ans, Lyon, étudiante » puis les photos envoyées à Kevin, « envoie ce message à tous les membres de Zone Interdite demain 20 h » (message transféré, OUI), « active la catégorie corners avec des cotes entre 1,6 et 2,5 », « ajoute mon compte Sportaza » (en privé, secret effacé), « ajoute Léa à l'équipe comme responsable », « préviens-moi si les dépenses pub dépassent 200 € par jour », « envoie-moi le rapport à 8 h au lieu de 9 h ».

## Règles non négociables
1. **Mêmes fonctions que le site, jamais une copie.** Chaque capacité appelle la fonction métier qu'appelle l'action serveur (si la logique est dans l'action elle-même, extrais-la d'abord dans `packages/` puis fais appeler cette fonction par l'action **et** par Kevin, sans changer le comportement du site). Mêmes validations, mêmes messages d'erreur traduits en phrase simple, même `AuditLog` (avec `via: "TELEGRAM"`).
2. **Mêmes droits.** Un membre du groupe ne peut faire par Kevin que ce que son rôle permet sur le site ; l'admin en privé peut tout ; un inconnu n'obtient rien (phase 26).
3. **Confirmations.** Règle de la phase 33 (vrai canal, mode vrai, dépense, hausse de plafond / niveau / quota → OUI / NON) **plus** : ce qui supprime ou efface (supprimer une campagne, une persona, une page, un tag, anonymiser un membre, purger, déconnecter un compte ou un connecteur, révoquer) → récapitulatif + le client doit écrire **SUPPRIMER** (un « oui » ne suffit pas) ; ce qui envoie à des membres (envoi, automatisation active, relance) → aperçu exact du message tel qu'il partira + nombre de destinataires + OUI.
4. **Secrets** : clés, jetons, mots de passe, identifiants de bookmaker uniquement en privé, effacés de la conversation après enregistrement chiffré, jamais envoyés à l'IA ni écrits dans un journal (règle phase 26, inchangée). Dans le groupe, Kevin répond « envoie-le-moi en privé ».
5. **Exclusions documentées seulement.** Ce qui ne peut vraiment pas se faire dans Telegram est listé dans `docs/KEVIN-PARITE.md` avec la raison et le **remplacement** que Kevin propose : connexion au site, changement de mot de passe, acceptation d'invitation (sécurité du compte) → Kevin envoie le lien direct ; autorisation Meta / TikTok (OAuth, navigateur obligatoire) → Kevin envoie le lien d'autorisation, puis termine seul le choix des comptes par boutons quand le retour arrive ; connexion d'un compte Telegram réel (code SMS) → déjà faisable en privé, sinon lien. Tout le reste doit être couvert.
6. **Le contenu reste fidèle.** Un message transféré à Kevin pour un post ou un envoi garde son texte, sa mise en forme et ses emojis animés (entités Telegram), ses médias ; Kevin ne réécrit rien sans qu'on le lui demande et montre l'aperçu exact avant envoi.
7. **Aucun appel réseau dans les tests** (faux Telegram, fausse IA, faux connecteurs).
8. **Voix de Kevin.** Chaque réponse, récapitulatif, aperçu, erreur et aide ajoutés par cette phase suit `docs/KEVIN-VOIX.md` (phase 33) et passe `voiceCheck` ; une erreur de validation du site est traduite en phrase de collègue (« Il manque le pays pour la campagne, c'est pour où ? »), jamais recopiée telle quelle.

## Modèles IA (allocation validée, rien de nouveau)
| Tâche | Modèle | API model string |
|---|---|---|
| Routage et interprétation des réglages simples | **Haiku 5.5** | `claude-haiku-5-5` |
| Demandes composées (plusieurs réglages, valeurs à déduire) — planificateur de la phase 33 | **Opus 5.5** | `claude-opus-5-5` |
| Aide « comment je fais X ? », messages de récapitulatif | **Haiku 5.5** | `claude-haiku-5-5` |
| Rédaction d'un post ou d'un envoi **seulement si demandé** (« écris-moi un message de relance ») | **Sonnet 5.5** | `claude-sonnet-5-5` |

## 1. Inventaire (`scripts/kevin-parity.ts`, `pnpm kevin:parity`)
- Parcourt `apps/web/**` : chaque fonction exportée d'un fichier `"use server"` → nom, fichier, page qui l'utilise, fonction métier appelée, rôle requis, nature (lecture, réglage, création, envoi, suppression, secret, connexion).
- Lit `packages/agents/src/orders/site-parity.ts` : correspondance `action serveur → { capability: "<equipe>.<cle>" } | { catalog: "<cle>" } | { excluded: { reason, replacement } }`.
- Sortie : tableau en français (couvert / exclu / **manquant**), code 1 s'il manque une action. Génère `docs/KEVIN-PARITE.md` (par page : ce qu'on y fait, la phrase équivalente à dire à Kevin).
- Test unitaire `site-parity.test.ts` : zéro manquant ; chaque capacité citée existe dans le registre ; chaque exclusion a une raison et un remplacement.

## 2. Capacités de réglage par domaine (`packages/agents/src/orders/capabilities/site/`)
Un fichier par domaine, même interface `Capability` que la phase 33 (`check` avec raisons et replis, `plan` sans écriture, `run` idempotent, `report`), chacune avec description en français et exemples de phrases :
- **Canaux** : ajouter par lien, importer depuis un compte, univers, canal de test, plan (quota, fenêtre, mélange, persona, offre, thèmes), droits du bot (revérifier), pause, liens d'entrée, règles d'acceptation par provenance, messages de bienvenue.
- **Campagnes, liens, offres, affiliés** : assistant de campagne (marque, pays, CPA / revshare, liens), lien de suivi par source, lien générique, lien de partage, offres en texte, rattachement d'un affilié Link Affi, imports (fichier CSV envoyé à Kevin → aperçu → OUI).
- **Membres, envois, automatisations** : rechercher un membre, tags, notes, bloquer / débloquer, anonymiser (SUPPRIMER), envoi groupé (message transféré ou rédigé, cible, heure, test A/B), annuler un envoi, automatisations (modèle, texte, langues, délais, activer, tester sur moi).
- **Messages et publications** : créer un post (message transféré), programmer, déplacer, envoyer maintenant, annuler, supprimer sur Telegram, catégories de messages, packs d'emojis, brouillons, modèles.
- **Agents** : budgets par fournisseur et par équipe, plafond de Kevin, niveaux d'autonomie, simulation / vrai, pauses, réglages Algorithme, seuils Ads, alertes Ads, banc d'essai, missions (relancer, reprendre), demandes humaines (répondre, relancer, passer).
- **Univers** : personas (créer, modifier, médias de référence envoyés à Kevin, supprimer), catégories de paris (tous les champs du formulaire), identifiants bookmaker (privé), proxy de capture, thèmes casino (ajouter, renommer, retirer, classer les médias), offres par canal.
- **Pages d'atterrissage** : créer / modifier (titre, texte, bouton, canal cible, langue) par phrase, aperçu en lien, supprimer (SUPPRIMER).
- **Réglages** : bots (ajouter par jeton en privé, mode, webhook), IA et assistant (clés en privé), alertes et seuils de dépense, rapports (heure, destinataires, envoyer maintenant), équipe (inviter : Kevin envoie le lien d'invitation ; rôles ; retirer), tags, postbacks (créer un point de réception, importer, test Link Affi), rétention et purge (SUPPRIMER), journal (lecture), statut du système, connecteurs (lien d'autorisation, choix des comptes par boutons, déconnexion SUPPRIMER).
- **Statistiques** : lecture seulement, déjà couverte par `answer.ts` et la capacité `voir` ; compléter ce qui manque (cohortes, entonnoir, coûts manuels : « ajoute 150 € de dépense TikTok hier »).

## 3. Entrées propres à Telegram (`packages/agents/src/boss/inputs/`)
- **Fichiers** : un document CSV envoyé à Kevin avec « importe ces joueurs / ces canaux / ces postbacks » → même aperçu que le site (lignes, erreurs) → OUI ; photos / vidéos → médiathèque (déjà en place) ou médias de persona selon la phrase.
- **Message transféré** : devient le contenu d'un post ou d'un envoi quand la phrase le demande (« envoie ça à … », « programme ça sur … ») ; sinon reste une donnée (règle 7 de la phase 26).
- **Choix par boutons** : quand une valeur a peu de possibilités (canal, équipe, persona, catégorie, compte publicitaire), Kevin propose des boutons plutôt qu'une question ouverte.
- **Liens d'autorisation** : OAuth Meta / TikTok, connexion au site, invitation : lien signé à usage unique, expiré après 15 minutes ; au retour, Kevin reprend la conversation (« Meta est connecté : 3 comptes publicitaires trouvés, lesquels je suis ? » + boutons).

## 4. Aide (`packages/agents/src/boss/guide.ts`, ajouts)
- « comment je fais pour … ? » → la phrase à dire à Kevin (depuis `docs/KEVIN-PARITE.md`), jamais « va sur le site » sauf exclusion.
- `aide` regroupe par domaine avec 2 exemples chacun ; « aide campagnes » détaille un domaine.

## 5. Garde-fou permanent
- `site-parity.test.ts` tourne dans `pnpm test` et dans la CI : toute nouvelle action serveur sans capacité Kevin ni exclusion documentée fait échouer le build. Ajoute la règle dans `CLAUDE.md` (« toute fonction ajoutée au site doit être faisable par Kevin ») et dans `docs/AGENTS-ARCHITECTURE.md`.

## Tests et livraison
- **Unitaires** : inventaire (fixture de 5 fichiers d'actions) ; correspondance (manquant → échec) ; chaque capacité de domaine (validation identique au site : mêmes cas d'erreur que les tests du site, mêmes droits par rôle) ; confirmations (OUI, SUPPRIMER, aperçu d'envoi) ; secrets refusés dans le groupe et effacés en privé ; CSV ; message transféré avec entités d'emojis animés conservées ; liens d'autorisation (usage unique, expiration, reprise).
- **Intégration sur base réelle, faux Telegram, fausse IA** : les 12 exemples du « But » de bout en bout ; puis au moins 2 phrases par domaine de l'étape 2 ; vérification que chaque action laisse le même état en base et le même `AuditLog` (hors `via`) que l'action serveur équivalente ; un membre « responsable » du groupe tente une action d'admin → refus ; « supprime la campagne X » + « oui » → refusé, + « SUPPRIMER » → fait.
- **Relecture adverse** : contournement des droits par le groupe, secrets, suppression sans SUPPRIMER, envoi massif sans aperçu, injection par un message transféré ou un CSV, écart de comportement entre site et Kevin, non-régression des phases 0 à 33 (le site fonctionne exactement comme avant).
- `pnpm kevin:parity` à 0 manquant ; `pnpm lint && pnpm typecheck && pnpm build && pnpm test` ; sauvegarde ; déploiement ; santé ; `docs/STATUS.md`, `docs/KEVIN-PARITE.md`, `docs/GUIDE-UTILISATEUR.md` (section « Tout faire par Kevin » : une phrase type par page du site), `docs/DECISIONS-TECH.md`, `docs/AGENTS-ARCHITECTURE.md`, `docs/prompts/README.md`, ligne « Phase 34 » dans `CLAUDE.md` avec la règle de parité.
- **Bilan Telegram** par Kevin (5 lignes) : fait, nombre d'actions du site désormais faisables par lui (vrai chiffre) et les exclusions avec leur remplacement, 3 exemples, la règle « SUPPRIMER ». Puis crée `docs/PHASE-DONE` (date + « Phase 34 (tout par Kevin) terminée, testée et déployée ») et arrête-toi : la file d'attente `docs/prompts/QUEUE`, lue par `scripts/run-phase.sh`, lance la phase suivante toute seule.

## Fini quand
- `pnpm kevin:parity` ne trouve aucune action du site sans équivalent Kevin (hors exclusions documentées avec remplacement) ; chaque réglage se fait en une phrase avec les mêmes validations, droits et journal que le site ; les suppressions demandent SUPPRIMER, les envois montrent l'aperçu exact ; fichiers, messages transférés et liens d'autorisation marchent ; la CI empêche toute future fonction du site de ne pas passer par Kevin ; tests, relecture, déploiement, documentation et bilan faits.
