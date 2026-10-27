# Tout par Kevin : correspondance du site

Généré par `pnpm kevin:parity -- --write` (ne pas modifier à la main). Chaque action du site se fait aussi en parlant à Kevin sur Telegram, sauf les exclusions listées avec leur remplacement.

État du 27 octobre 2026 : 243 actions du site, 233 faisables par Kevin, 10 exclues (avec remplacement), 0 manquantes.

## /

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Renvoyer l'accueil avec les liens des canaux à rejoindre aux demandes qui les attendent. | « renvoie l'accueil avec les liens sur Zone Interdite » | `resendGateWelcomeAction` |

Exclusions (impossible dans Telegram) :

- `completeTourAction` : Visite guidée du site : affichage seul (la visite n'existe que dans le navigateur). Kevin propose : L'aide de Kevin (« aide », « comment je fais … ? ») remplace la visite guidée.
- `dismissChecklistAction` : Masquer la liste « À faire pour démarrer » de l'accueil du site : affichage seul. Kevin propose : L'aide de Kevin (« commencer », « aide ») donne la même liste de départ.
- `restartTourAction` : Revoir la visite guidée du site : affichage seul. Kevin propose : L'aide de Kevin (« aide », « commencer ») remplace la visite guidée.

## /account

Exclusions (impossible dans Telegram) :

- `changePasswordAction` : Changement de mot de passe (mot de passe actuel exigé) : sécurité du compte, jamais un mot de passe du site dans une conversation. Kevin propose : Kevin envoie le lien direct de la page (lien d'autorisation signé, usage unique, 15 minutes : `createAuthLink`). (purpose « page », Mon compte).
- `generateTelegramLinkAction` : Lier son compte Telegram à son compte du site décide qui Kevin reconnaît : sécurité du compte, faite depuis la session du site. Kevin propose : Kevin envoie le lien direct de la page (lien d'autorisation signé, usage unique, 15 minutes : `createAuthLink`). (purpose « page », Mon compte → Lier Telegram).
- `unlinkTelegramAction` : Délier son compte Telegram retire l'accès à Kevin : sécurité du compte, faite depuis la session du site. Kevin propose : Kevin envoie le lien direct de la page (lien d'autorisation signé, usage unique, 15 minutes : `createAuthLink`). (purpose « page », Mon compte).
- `completeTourAction` : Visite guidée du site : affichage seul (la visite n'existe que dans le navigateur). Kevin propose : L'aide de Kevin (« aide », « comment je fais … ? ») remplace la visite guidée.
- `dismissChecklistAction` : Masquer la liste « À faire pour démarrer » de l'accueil du site : affichage seul. Kevin propose : L'aide de Kevin (« commencer », « aide ») donne la même liste de départ.
- `restartTourAction` : Revoir la visite guidée du site : affichage seul. Kevin propose : L'aide de Kevin (« aide », « commencer ») remplace la visite guidée.

## /agents

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Appliquer, annuler ou refuser une proposition de l'équipe Algorithme (persona et quotas : administrateurs) | « applique la proposition du mélange de Zone Interdite » | `recommendationAction` |
| Recalculer et envoyer maintenant le rapport de l'équipe Algorithme | « envoie-moi le rapport algorithme maintenant » | `runAlgoReportNowAction` |
| Régler l'équipe Algorithme : seuils de données (posts, vues, conversations), points de mélange par semaine, posts par jour au plus, heures autorisées, fréquence | « l'algorithme ne propose pas plus de 5 posts par jour » | `saveAlgoSettingsAction` |
| Créer une mission de test d'une équipe (un post sur le canal Test, en simulation) | « fais une mission de test pour le casino » | `createTestMissionAction` |
| catalogue niveau | catalogue niveau | `setAutonomyLevelAction` |
| catalogue simulation | catalogue simulation | `setSimulationAction` |
| catalogue pause | catalogue pause | `setTeamPausedAction` |
| Retirer la clé d'un fournisseur des agents | « retire la clé Magic Hour » | `deleteSecretAction` |
| Changer le plafond du mois d'une équipe pour un poste de dépense (vidéo, photo, IA d'écriture, cotes, captures), en euros | « monte le budget vidéo à 80 € ce mois-ci » | `saveAllBudgetsAction` |
| Choisir les modèles d'IA des agents (rapide et d'écriture) et le canal Médiathèque | « les agents écrivent avec Opus » | `saveGeneralSettingsAction` |
| Enregistrer la clé d'un fournisseur des agents (fal.ai, Magic Hour, cotes sportives), chiffrée | « voici la clé fal » | `saveSecretAction` |
| catalogue pause | catalogue pause | `setPausedAllAction` |
| Vérifier la clé enregistrée d'un fournisseur (appel gratuit) | « vérifie la clé fal » | `verifySecretAction` |

## /agents/[equipe]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Produire un post de test Rencontres (vidéo, photo ou texte) en simulation sur le canal Test | « fais un post de test vidéo avec Léa » | `createTestPostAction` |
| Régler le plan d'un canal pour les agents : activé ou non, posts par jour, fenêtre horaire, espacement, mélange vidéo / photo / texte, persona, campagne de l'offre, thèmes (avec leur poids pour un canal Casino) | « mets 4 posts par jour sur Zone Interdite entre 10 h et 22 h » | `saveChannelPlanAction` |
| Régler une équipe : consignes de style, mots interdits, longueur maximale, heures calmes ; pour un administrateur aussi les plafonds du mois, le fournisseur et la résolution des vidéos (Rencontres), le seuil de manque et la rotation (Casino), les heures de passage, l'écart de cote, le délai avant match et le plafond d'appels (Paris sportifs) | « ajoute « gratuit » aux mots interdits du casino » | `saveTeamSettingsAction` |
| Lancer le banc d'essai vidéo d'une persona (compare les réglages, dépense quelques euros) | « lance le banc d'essai de Léa » | `startBenchAction` |
| Appliquer, annuler ou refuser une proposition de l'équipe Algorithme (persona et quotas : administrateurs) | « applique la proposition du mélange de Zone Interdite » | `recommendationAction` |
| Recalculer et envoyer maintenant le rapport de l'équipe Algorithme | « envoie-moi le rapport algorithme maintenant » | `runAlgoReportNowAction` |
| Régler l'équipe Algorithme : seuils de données (posts, vues, conversations), points de mélange par semaine, posts par jour au plus, heures autorisées, fréquence | « l'algorithme ne propose pas plus de 5 posts par jour » | `saveAlgoSettingsAction` |
| Ajouter un thème casino (mot-clé #casino #<thème> pour déposer des médias) | « ajoute le thème poker » | `addCasinoThemeAction` |
| Classer un média casino « à classer » dans un ou plusieurs thèmes (le plus ancien à classer par défaut) | « range cette vidéo dans roulette » | `classifyCasinoMediaAction` |
| Produire un post de test Casino (vidéo, image ou texte) en simulation sur le canal Test | « fais un post de test casino en vidéo » | `createCasinoTestPostAction` |
| Retirer un thème casino (refusé s'il a encore des médias ou s'il est dans le plan d'un canal) | « retire le thème poker » | `removeCasinoThemeAction` |
| Renommer un thème casino (le mot-clé des légendes ne change pas) | « renomme le thème live en Tables en direct » | `renameCasinoThemeAction` |
| Produire un pari de test en simulation (cotes d'essai, aucune vraie mise, canal Test) | « fais un pari de test » | `createTestBetAction` |
| Retirer les identifiants d'un compte bookmaker | « retire mon compte Sportaza » | `deleteBookmakerCredentialsAction` |
| Retirer l'adresse internet de secours des captures | « retire le proxy des captures » | `deleteScreenshotProxyAction` |
| Créer ou modifier une catégorie de paris, tous les champs : nom, sport, marchés, ligues, bookmakers, cotes minimale et maximale, paris par jour, canaux, campagne, délai avant le match, écart de cote toléré, active, ordre | « active la catégorie corners avec des cotes entre 1,6 et 2,5 » | `saveBetCategoryAction` |
| Enregistrer l'identifiant et le mot de passe d'un compte bookmaker (chiffrés, jamais de mise) | « ajoute mon compte Sportaza » | `saveBookmakerCredentialsAction` |
| Enregistrer l'adresse internet de secours des captures (si le bookmaker bloque), chiffrée | « voici l'adresse de secours des captures » | `saveScreenshotProxyAction` |
| Tester la connexion au compte bookmaker (connexion et capture de la page d'accueil, aucune mise) | « teste la connexion à Sportaza » | `testBookmakerConnectionAction` |
| Créer une mission de test d'une équipe (un post sur le canal Test, en simulation) | « fais une mission de test pour le casino » | `createTestMissionAction` |
| catalogue niveau | catalogue niveau | `setAutonomyLevelAction` |
| catalogue simulation | catalogue simulation | `setSimulationAction` |
| catalogue pause | catalogue pause | `setTeamPausedAction` |

## /agents/ads

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Noter une recommandation pubs comme faite (par toi chez Meta / TikTok) ou la refuser, avec un commentaire | « la recommandation de couper la pub 3, c'est fait » | `markAdsRecommendationAction` |
| Régler les alertes de l'Agent Ads : hausse de dépense, dépense minimale par jour, baisse des inscriptions, inscriptions minimales | « préviens-moi si la dépense d'une campagne monte de 80 % » | `saveAdsAlertSettingsAction` |
| Régler les seuils de l'Agent Ads d'un univers : coût par inscription visé, retour sur dépense minimal, jours d'observation, dépense minimale | « vise 8 € par inscription sur le casino » | `saveAdsThresholdsAction` |

## /agents/analyses

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Activer une source de la veille (forum, site d'actualité, canal public) : elle est lue au prochain passage | « active la source BlackHatWorld » | `activateSourceAction` |
| Désactiver une source de la veille (elle n'est plus lue, ses entrées restent) | « arrête de lire Reddit r/gambling » | `deactivateSourceAction` |
| Accepter ou refuser une recommandation de l'analyse de marché (rien n'est changé chez Meta, TikTok, sur les canaux ni les budgets) | « j'accepte la recommandation 2 de l'analyse de marché » | `decideMarketRecommendationAction` |
| Supprimer une source de la veille et ses entrées (les règles publicitaires et les rapports restent) | « supprime la source STM Forum » | `deleteSourceAction` |

## /agents/bookmakers

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ouvrir le navigateur sur le Mac, sur un bookmaker (pour passer un contrôle ou un code) | « ouvre le navigateur sur Sportaza » | `openBrowserAction` |
| Faire ré-apprendre la lecture d'un bookmaker (quelques minutes, dépense d'IA) | « ré-apprends Sportaza » | `relearnSiteAction` |
| Changer l'adresse du site d'un bookmaker | « l'adresse de Sportaza est sportaza.com/fr/sports » | `setSiteUrlAction` |
| Tester la lecture d'un bookmaker (connexion et une lecture des matchs, aucune mise) | « teste la lecture de Sportaza » | `testSiteAction` |

## /agents/boss

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Changer le plafond mensuel de l'IA de Kevin (500 € au plus ; 0 = commandes exactes seulement) | « monte ton plafond à 50 € par mois » | `saveBossBudgetAction` |
| Changer le prénom affiché du Boss | « appelle-toi Max » | `saveBossNameAction` |

## /agents/inspiration/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Retirer un canal d'inspiration (ses posts lus et son profil de style sont effacés) | « retire la référence @roulette_pro » | `removeReferenceAction` |
| Annuler une inspiration appliquée (toutes les propositions d'une référence, ou une seule) : réglages d'avant remis | « annule l'inspiration de @roulette_pro » | `undoInspirationAction` |

## /agents/montage/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Valider un short du montage (il est prêt dans la médiathèque ; rien n'est publié sans un ordre) | « valide le short 3 » | `approveShortAction` |
| Annuler un montage en cours (shorts pas encore faits abandonnés, shorts validés gardés) | « annule le montage en cours » | `cancelMontageAction` |
| Faire refaire un short avec une modification (durée, caméra, texte, sous-titres) ; un nouvel aperçu suit | « le short 5, raccourcis de 2 secondes » | `modifyShortAction` |
| Refuser un short (archivé, pas supprimé) | « refuse le short 4 » | `rejectShortAction` |

## /agents/orders/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Prolonger un ordre en cours de 1 à 30 jours | « prolonge l'ordre 3 de 2 jours » | `extendOrderAction` |
| Arrêter un ordre donné aux équipes (missions pas commencées annulées, le canal reprend son plan) | « arrête l'ordre 3 » | `stopOrderAction` |

## /agents/prospection

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ajouter à la main un canal Telegram public à la prospection (il est lu en priorité, jamais rejoint ni contacté) | « ajoute t.me/pronosfoot à la prospection » | `addManualProspectAction` |
| Ajouter une note sur un canal de la prospection | « note @parisfoot : veut des visuels mardi » | `addProspectNoteAction` |
| Marquer plusieurs canaux de la prospection d'un coup comme contactés, ou les ignorer (pas intéressé) | « marque @a, @b et @c comme contactés » | `bulkProspectStatusAction` |
| Valider ou refuser une proposition d'ajout aux repères de la prospection | « valide la proposition 1 des repères » | `decideDictAction` |
| Proposer d'ajouter une marque, un repère de lien d'affiliation, un raccourcisseur ou un mot de code promo / de contact aux repères de la prospection (validé ensuite par un administrateur) | « ajoute la marque Celsius (FR) aux repères de la prospection » | `proposeDictAction` |
| Créer ou modifier une offre aux affiliés (marque, marché, pays acceptés, prime par joueur, part du revenu, mixte) | « ajoute une offre : Celsius, FR BE, prime par joueur 120 » | `saveOfferAction` |
| Changer les réglages de la prospection : activée, pays et marchés cherchés, nombre et heure de la liste du matin, notes des niveaux, poids de la note, rappels, plafonds par jour et dépense mensuelle de l'IA | « envoie-moi 15 canaux le matin au lieu de 10 » | `saveProspectionSettingsAction` |
| Noter où en est un canal de la prospection (contacté, a répondu, en discussion, signé avec ses conditions, actif, a arrêté, pas intéressé, reprendre, plus tard, ne plus montrer) ; rien n'est envoyé au canal | « j'ai contacté @parisfoot » | `setProspectStatusAction` |
| Activer ou désactiver une offre aux affiliés (désactivée : elle ne sert plus à noter les canaux, rien n'est effacé) | « désactive l'offre Celsius » | `toggleOfferAction` |
| Mettre en pause (1, 7 ou 30 jours) ou reprendre une source de découverte de la prospection (annuaires, recherche internet, réseaux sociaux, canaux cités, Analystes) | « mets les annuaires en pause une semaine » | `toggleSourcePauseAction` |

## /agents/prospection/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ajouter à la main un canal Telegram public à la prospection (il est lu en priorité, jamais rejoint ni contacté) | « ajoute t.me/pronosfoot à la prospection » | `addManualProspectAction` |
| Ajouter une note sur un canal de la prospection | « note @parisfoot : veut des visuels mardi » | `addProspectNoteAction` |
| Marquer plusieurs canaux de la prospection d'un coup comme contactés, ou les ignorer (pas intéressé) | « marque @a, @b et @c comme contactés » | `bulkProspectStatusAction` |
| Valider ou refuser une proposition d'ajout aux repères de la prospection | « valide la proposition 1 des repères » | `decideDictAction` |
| Proposer d'ajouter une marque, un repère de lien d'affiliation, un raccourcisseur ou un mot de code promo / de contact aux repères de la prospection (validé ensuite par un administrateur) | « ajoute la marque Celsius (FR) aux repères de la prospection » | `proposeDictAction` |
| Créer ou modifier une offre aux affiliés (marque, marché, pays acceptés, prime par joueur, part du revenu, mixte) | « ajoute une offre : Celsius, FR BE, prime par joueur 120 » | `saveOfferAction` |
| Changer les réglages de la prospection : activée, pays et marchés cherchés, nombre et heure de la liste du matin, notes des niveaux, poids de la note, rappels, plafonds par jour et dépense mensuelle de l'IA | « envoie-moi 15 canaux le matin au lieu de 10 » | `saveProspectionSettingsAction` |
| Noter où en est un canal de la prospection (contacté, a répondu, en discussion, signé avec ses conditions, actif, a arrêté, pas intéressé, reprendre, plus tard, ne plus montrer) ; rien n'est envoyé au canal | « j'ai contacté @parisfoot » | `setProspectStatusAction` |
| Activer ou désactiver une offre aux affiliés (désactivée : elle ne sert plus à noter les canaux, rien n'est effacé) | « désactive l'offre Celsius » | `toggleOfferAction` |
| Mettre en pause (1, 7 ou 30 jours) ou reprendre une source de découverte de la prospection (annuaires, recherche internet, réseaux sociaux, canaux cités, Analystes) | « mets les annuaires en pause une semaine » | `toggleSourcePauseAction` |

## /agents/settings

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Retirer la clé d'un fournisseur des agents | « retire la clé Magic Hour » | `deleteSecretAction` |
| Changer le plafond du mois d'une équipe pour un poste de dépense (vidéo, photo, IA d'écriture, cotes, captures), en euros | « monte le budget vidéo à 80 € ce mois-ci » | `saveAllBudgetsAction` |
| Choisir les modèles d'IA des agents (rapide et d'écriture) et le canal Médiathèque | « les agents écrivent avec Opus » | `saveGeneralSettingsAction` |
| Enregistrer la clé d'un fournisseur des agents (fal.ai, Magic Hour, cotes sportives), chiffrée | « voici la clé fal » | `saveSecretAction` |
| catalogue pause | catalogue pause | `setPausedAllAction` |
| Vérifier la clé enregistrée d'un fournisseur (appel gratuit) | « vérifie la clé fal » | `verifySecretAction` |

## /agents/validations

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Répondre à une demande des agents (la question en cours par défaut ; jamais une clé : elle se donne en privé) | « réponds oui à la demande » | `answerHumanRequestAction` |
| catalogue valider_post | catalogue valider_post | `decideValidationAction` |
| Relancer une demande passée ou expirée (elle est reposée) | « repose-moi la dernière question » | `relaunchHumanRequestAction` |
| Passer une demande des agents (« plus tard ») : la suivante arrive | « passe cette question » | `skipHumanRequestAction` |

## /campaigns/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ajouter une pub précise dans un groupe (avec, si on veut, un lien d'entrée existant). | « ajoute la pub « Vidéo plage » au groupe 1 de Celsius » | `addAdAction` |
| Ajouter un groupe de pubs à une campagne. | « ajoute un groupe « Femmes 25-34 » à la campagne Celsius » | `addAdSetAction` |
| Ajouter à une campagne une pub et son lien d'entrée (lien goolink + invitation Telegram avec demande d'adhésion). | « ajoute un lien d'entrée vers Zone Interdite à la campagne Celsius » | `addEntryLinkAction` |
| Saisir à la main la dépense pub d'un jour (campagne, groupe ou pub) ; refusé si TikTok / Meta l'envoie déjà par l'API. | « ajoute 150 € de dépense TikTok hier sur Celsius » | `addManualCostAction` |
| Rattacher une offre Link Affi à une campagne (par son nom, ou par un lien linkaffi.me/go/<clé>). | « ajoute l'offre Celsius à la campagne Casino Octobre » | `addOfferAction` |
| Reprendre dans une campagne une campagne pub importée de TikTok / Meta (ses groupes, pubs et dépenses). | « rattache la campagne pub TT-celsius-10 à Celsius FR » | `attachImportedCampaignAction` |
| Rattacher un lien d'entrée à une pub précise, ou le détacher. | « mets le lien TikTok 26/10 sur la pub Vidéo plage » | `attachLinkAction` |
| Supprimer une pub précise (ses dépenses propres ; son lien d'entrée reste dans la campagne). | « supprime la pub Vidéo plage de Celsius » | `deleteAdAction` |
| Supprimer un groupe de pubs et ses pubs (leurs liens d'entrée restent dans la campagne). | « supprime le groupe Retargeting de Celsius » | `deleteAdSetAction` |
| Supprimer une campagne : groupes, pubs, dépenses et statistiques supprimés ; liens, membres, clics et joueurs gardés. | « supprime la campagne Celsius » | `deleteCampaignAction` |
| Retirer une offre Link Affi d'une campagne (les boutons déjà publiés passent à une autre offre). | « retire l'offre Celsius de la campagne Casino Octobre » | `removeOfferAction` |
| Modifier une campagne : nom, plateforme, univers, statut, budget par jour, dates, canaux, compte pub, notes (les champs non dits ne changent pas). | « mets la campagne Celsius en pause » | `updateCampaignAction` |
| Choisir les canaux d'une campagne (liste complète, ou ajouter / retirer des canaux). | « ajoute Zone Interdite à la campagne Celsius » | `updateChannelsAction` |

## /campaigns/[id]/tabs

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ajouter une pub précise dans un groupe (avec, si on veut, un lien d'entrée existant). | « ajoute la pub « Vidéo plage » au groupe 1 de Celsius » | `addAdAction` |
| Ajouter un groupe de pubs à une campagne. | « ajoute un groupe « Femmes 25-34 » à la campagne Celsius » | `addAdSetAction` |
| Ajouter à une campagne une pub et son lien d'entrée (lien goolink + invitation Telegram avec demande d'adhésion). | « ajoute un lien d'entrée vers Zone Interdite à la campagne Celsius » | `addEntryLinkAction` |
| Saisir à la main la dépense pub d'un jour (campagne, groupe ou pub) ; refusé si TikTok / Meta l'envoie déjà par l'API. | « ajoute 150 € de dépense TikTok hier sur Celsius » | `addManualCostAction` |
| Rattacher une offre Link Affi à une campagne (par son nom, ou par un lien linkaffi.me/go/<clé>). | « ajoute l'offre Celsius à la campagne Casino Octobre » | `addOfferAction` |
| Reprendre dans une campagne une campagne pub importée de TikTok / Meta (ses groupes, pubs et dépenses). | « rattache la campagne pub TT-celsius-10 à Celsius FR » | `attachImportedCampaignAction` |
| Rattacher un lien d'entrée à une pub précise, ou le détacher. | « mets le lien TikTok 26/10 sur la pub Vidéo plage » | `attachLinkAction` |
| Supprimer une pub précise (ses dépenses propres ; son lien d'entrée reste dans la campagne). | « supprime la pub Vidéo plage de Celsius » | `deleteAdAction` |
| Supprimer un groupe de pubs et ses pubs (leurs liens d'entrée restent dans la campagne). | « supprime le groupe Retargeting de Celsius » | `deleteAdSetAction` |
| Supprimer une campagne : groupes, pubs, dépenses et statistiques supprimés ; liens, membres, clics et joueurs gardés. | « supprime la campagne Celsius » | `deleteCampaignAction` |
| Retirer une offre Link Affi d'une campagne (les boutons déjà publiés passent à une autre offre). | « retire l'offre Celsius de la campagne Casino Octobre » | `removeOfferAction` |
| Modifier une campagne : nom, plateforme, univers, statut, budget par jour, dates, canaux, compte pub, notes (les champs non dits ne changent pas). | « mets la campagne Celsius en pause » | `updateCampaignAction` |
| Choisir les canaux d'une campagne (liste complète, ou ajouter / retirer des canaux). | « ajoute Zone Interdite à la campagne Celsius » | `updateChannelsAction` |

## /campaigns/affiliates

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ne plus afficher le mini-tutoriel « Affiliés sur vos canaux » sur le site (pour ce compte). | « cache le tutoriel des affiliés » | `dismissAffiliatesTutorialAction` |

## /campaigns/import

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Importer les dépenses pub d'un fichier CSV envoyé à Kevin (aperçu : lignes et erreurs, puis OUI) : pubs manquantes créées, dépenses par jour. | « importe ce fichier de dépenses TikTok » | `confirmImportAction` |
| Lire un fichier CSV de dépenses TikTok / Meta envoyé à Kevin : plateforme et colonnes détectées, lignes, erreurs, campagnes reconnues (rien n'est importé). | « regarde ce fichier de dépenses TikTok » | `previewImportAction` |

## /campaigns/links

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Créer un ou plusieurs liens de suivi d'entrée vers un canal (goolink + invitation Telegram avec demande d'adhésion), un par nom ; Kevin renvoie les adresses. | « donne-moi un lien de suivi pour TikTok sur Zone Interdite » | `createEntryLinksAction` |
| Créer un lien suivi go.goolink.eu vers n'importe quelle adresse https. | « fais-moi un lien suivi vers https://exemple.com/promo nommé Promo Noël » | `createGenericLinkAction` |
| Activer ou désactiver un lien suivi (désactivé, il renvoie vers l'accueil du site). | « désactive le lien TikTok 26/10 » | `toggleLinkAction` |

## /campaigns/new

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Créer une campagne (assistant du site) : nom, univers, offres Link Affi, canaux, plateforme et nombre de pubs (un lien d'entrée par pub), budget, dates ; pays et rémunération notés dans les notes. | « crée une campagne pour Celsius en France avec un CPA de 120 » | `createCampaignWizardAction` |

## /channels

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ajouter un canal existant par son lien public, avec ses réglages si on les donne (univers, langue, test). | « ajoute le canal t.me/xxx et mets-le en paris sportifs » | `addChannelByLinkAction` |
| Importer des canaux du compte Telegram connecté (liste cochée). | « importe mes canaux Telegram » | `importChannelsFromAccountAction` |
| Re-vérifier les droits de nos bots sur tous les canaux actifs. | « revérifie les droits des bots partout » | `recheckAllRightsAction` |
| Changer les réglages d'un canal : univers, langue, bot principal, canal de test, médiathèque, actif. | « mets Zone Interdite en paris sportifs » | `updateChannelAction` |

## /channels/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Appliquer la nouvelle règle aux demandes déjà en attente (aucun message envoyé). | « applique la nouvelle règle aux demandes en attente de Zone Interdite » | `applyRuleToPendingAction` |
| Accepter toutes les demandes en attente d'un canal (ou celles d'un filtre). | « accepte toutes les demandes de Zone Interdite » | `approveAllRequestsAction` |
| Accepter tout de suite une demande d'adhésion. | « accepte la demande de @paul sur Zone Interdite » | `approveMembershipAction` |
| Créer et vérifier les liens des canaux à rejoindre d'un canal. | « vérifie les liens des canaux à rejoindre de Zone Interdite » | `checkGateLinksAction` |
| Refuser une demande d'adhésion (la personne devra redemander). | « refuse la demande de @paul sur Zone Interdite » | `declineMembershipAction` |
| Supprimer une exception (les prochaines demandes suivent la règle par défaut). | « supprime l'exception Venu de Tir Cadré sur Zone Interdite » | `deleteExceptionAction` |
| Monter ou descendre une exception dans son groupe (priorité). | « monte l'exception Venu de Tir Cadré » | `moveExceptionAction` |
| Re-vérifier les droits de nos bots sur un canal. | « revérifie les droits des bots sur Zone Interdite » | `recheckRightsAction` |
| Recalculer tout de suite les meilleurs créneaux de publication. | « recalcule les meilleurs horaires » | `recomputeBestHoursAction` |
| Ranger les exceptions d'un groupe dans un ordre donné (liste complète du groupe). | « mets l'exception Tir Cadré avant celle de Corner » | `reorderExceptionsAction` |
| Créer ou modifier une exception à la règle selon la provenance (canal d'origine, pub, lien de partage, affilié, page). | « les gens qui viennent de Tir Cadré sont acceptés tout de suite sur Zone Interdite » | `saveExceptionAction` |
| Régler la règle d'acceptation par défaut d'un canal : quand accepter, canaux à rejoindre, rappels, expiration, messages. | « sur Zone Interdite, accepte les demandes au bout de 5 minutes » | `saveRuleAction` |
| Activer ou désactiver une exception. | « désactive l'exception Venu de Tir Cadré sur Zone Interdite » | `toggleExceptionAction` |
| Ajouter un canal existant par son lien public, avec ses réglages si on les donne (univers, langue, test). | « ajoute le canal t.me/xxx et mets-le en paris sportifs » | `addChannelByLinkAction` |
| Importer des canaux du compte Telegram connecté (liste cochée). | « importe mes canaux Telegram » | `importChannelsFromAccountAction` |
| Re-vérifier les droits de nos bots sur tous les canaux actifs. | « revérifie les droits des bots partout » | `recheckAllRightsAction` |
| Changer les réglages d'un canal : univers, langue, bot principal, canal de test, médiathèque, actif. | « mets Zone Interdite en paris sportifs » | `updateChannelAction` |

## /channels/[id]/sequences

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ajouter une langue à un message du bot (copie du français à traduire). | « ajoute l'anglais au message d'accueil de Zone Interdite » | `addSequenceLangAction` |
| Retirer une langue d'un message du bot (jamais le français). | « retire l'anglais du message d'accueil de Zone Interdite » | `removeSequenceLangAction` |
| Écrire le texte d'un message du bot (accueil, rappel, accepté, offre) dans une langue ; un message transféré est repris tel quel. | « mets ça comme message d'accueil de Zone Interdite » | `saveSequenceTextAction` |
| Enregistrer les traductions d'un message du bot dans plusieurs langues d'un coup. | « enregistre ces traductions du message d'accueil de Zone Interdite » | `saveSequenceTranslationsAction` |
| M'envoyer un message du bot en test sur mon Telegram. | « envoie-moi le message d'accueil de Zone Interdite en test » | `sendSequenceTestAction` |
| Joindre un média de la médiathèque à un message du bot, ou le retirer. | « mets cette photo avec le message d'accueil de Zone Interdite » | `setSequenceMediaAction` |
| Activer ou désactiver un message du bot (désactivé : texte intégré par défaut). | « désactive le rappel de Zone Interdite » | `toggleSequenceAction` |

## /channels/[id]/tabs

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Appliquer la nouvelle règle aux demandes déjà en attente (aucun message envoyé). | « applique la nouvelle règle aux demandes en attente de Zone Interdite » | `applyRuleToPendingAction` |
| Accepter toutes les demandes en attente d'un canal (ou celles d'un filtre). | « accepte toutes les demandes de Zone Interdite » | `approveAllRequestsAction` |
| Accepter tout de suite une demande d'adhésion. | « accepte la demande de @paul sur Zone Interdite » | `approveMembershipAction` |
| Créer et vérifier les liens des canaux à rejoindre d'un canal. | « vérifie les liens des canaux à rejoindre de Zone Interdite » | `checkGateLinksAction` |
| Refuser une demande d'adhésion (la personne devra redemander). | « refuse la demande de @paul sur Zone Interdite » | `declineMembershipAction` |
| Supprimer une exception (les prochaines demandes suivent la règle par défaut). | « supprime l'exception Venu de Tir Cadré sur Zone Interdite » | `deleteExceptionAction` |
| Monter ou descendre une exception dans son groupe (priorité). | « monte l'exception Venu de Tir Cadré » | `moveExceptionAction` |
| Re-vérifier les droits de nos bots sur un canal. | « revérifie les droits des bots sur Zone Interdite » | `recheckRightsAction` |
| Recalculer tout de suite les meilleurs créneaux de publication. | « recalcule les meilleurs horaires » | `recomputeBestHoursAction` |
| Ranger les exceptions d'un groupe dans un ordre donné (liste complète du groupe). | « mets l'exception Tir Cadré avant celle de Corner » | `reorderExceptionsAction` |
| Créer ou modifier une exception à la règle selon la provenance (canal d'origine, pub, lien de partage, affilié, page). | « les gens qui viennent de Tir Cadré sont acceptés tout de suite sur Zone Interdite » | `saveExceptionAction` |
| Régler la règle d'acceptation par défaut d'un canal : quand accepter, canaux à rejoindre, rappels, expiration, messages. | « sur Zone Interdite, accepte les demandes au bout de 5 minutes » | `saveRuleAction` |
| Activer ou désactiver une exception. | « désactive l'exception Venu de Tir Cadré sur Zone Interdite » | `toggleExceptionAction` |
| Créer un lien de partage nommé (avec demande d'adhésion) pour un canal, à poster dans un autre canal si on veut. | « crée un lien de partage « Post Tir Cadré » pour Zone Interdite » | `createShareLinkAction` |
| Désactiver (révoquer) un lien de partage : il ne marche plus dans Telegram. | « désactive le lien de partage « Post Tir Cadré » de Zone Interdite » | `disableShareLinkAction` |

## /channels/import

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ajouter un canal existant par son lien public, avec ses réglages si on les donne (univers, langue, test). | « ajoute le canal t.me/xxx et mets-le en paris sportifs » | `addChannelByLinkAction` |
| Importer des canaux du compte Telegram connecté (liste cochée). | « importe mes canaux Telegram » | `importChannelsFromAccountAction` |
| Re-vérifier les droits de nos bots sur tous les canaux actifs. | « revérifie les droits des bots partout » | `recheckAllRightsAction` |
| Changer les réglages d'un canal : univers, langue, bot principal, canal de test, médiathèque, actif. | « mets Zone Interdite en paris sportifs » | `updateChannelAction` |

## /conversations/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Bloquer une conversation : plus aucun message ne part vers cette personne, définitivement. | « bloque la conversation avec Paul » | `blockAction` |
| Marquer une conversation « à traiter » comme traitée (rien d'autre ne change). | « la conversation de Paul est traitée » | `clearNeedsHumanAction` |
| Fermer une conversation (ni réponse ni relance ; réouvrable). | « ferme la conversation avec Paul » | `closeAction` |
| Rendre une conversation à l'assistante (elle répond aux prochains messages). | « rends la conversation de Paul à l'assistante » | `releaseAction` |
| Écrire dans une conversation à la place de l'assistante (l'équipe prend la main). | « réponds à Paul : on regarde ton bonus tout de suite » | `sendTeamMessageAction` |
| Prendre la main dans une conversation : l'assistante se tait, l'équipe écrit. | « prends la main avec Paul » | `takeOverAction` |

## /conversations/personas/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Médias du personnage d'une persona : photos de référence envoyées à Kevin (3 au plus), fichier du personnage (LoRA), mot déclencheur, poids, consignes. | « voici les photos d'Inès » | `savePersonaMediaAction` |
| Supprimer une persona (refusé tant qu'un bot l'utilise ; ses conversations restent). | « supprime la persona Inès » | `deletePersonaAction` |
| Créer ou modifier une persona de l'assistante : prénom, âge, personnalité (ville, métier…), ton, langues, centres d'intérêt, offre et moment du lien, activation (créée désactivée). | « crée la persona Inès, 24 ans, Lyon, étudiante » | `savePersonaAction` |

## /conversations/personas/new

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Supprimer une persona (refusé tant qu'un bot l'utilise ; ses conversations restent). | « supprime la persona Inès » | `deletePersonaAction` |
| Créer ou modifier une persona de l'assistante : prénom, âge, personnalité (ville, métier…), ton, langues, centres d'intérêt, offre et moment du lien, activation (créée désactivée). | « crée la persona Inès, 24 ans, Lyon, étudiante » | `savePersonaAction` |

## /help

Exclusions (impossible dans Telegram) :

- `completeTourAction` : Visite guidée du site : affichage seul (la visite n'existe que dans le navigateur). Kevin propose : L'aide de Kevin (« aide », « comment je fais … ? ») remplace la visite guidée.
- `dismissChecklistAction` : Masquer la liste « À faire pour démarrer » de l'accueil du site : affichage seul. Kevin propose : L'aide de Kevin (« commencer », « aide ») donne la même liste de départ.
- `restartTourAction` : Revoir la visite guidée du site : affichage seul. Kevin propose : L'aide de Kevin (« aide », « commencer ») remplace la visite guidée.

## /invite/[token]

Exclusions (impossible dans Telegram) :

- `acceptInviteAction` : Acceptation d'une invitation (choix du mot de passe par la personne invitée) : sécurité du compte. Kevin propose : Kevin envoie le lien direct de l'invitation (« equipe.inviter » rend le lien) ; la personne choisit son mot de passe sur la page.

## /login

Exclusions (impossible dans Telegram) :

- `loginAction` : Connexion au site (e-mail et mot de passe) : sécurité du compte, elle se fait dans le navigateur. Kevin propose : Kevin envoie le lien direct de la page (lien d'autorisation signé, usage unique, 15 minutes : `createAuthLink`). (purpose « login »).

## /members/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ajouter une note sur la fiche d'un membre (2000 caractères au plus). | « note sur Paul Martin : a demandé un bonus » | `addNoteAction` |
| Supprimer un membre à sa demande (anonymisation, irréversible) : identité, notes et conversations effacées ; statistiques gardées sans donnée personnelle. | « supprime le membre Paul Martin, il l'a demandé » | `anonymizeMemberAction` |
| Rattacher un membre à une autre campagne Telegram d'affilié Link Affi, avec un motif. | « Paul Martin vient de l'affilié Max (campagne max-casino), corrige » | `changeMemberAffiliateAction` |
| Supprimer une note d'un membre (la sienne, ou n'importe laquelle pour un administrateur) ; par défaut la dernière. | « supprime ma dernière note sur Paul » | `deleteNoteAction` |
| Modifier une note d'un membre (la sienne, ou n'importe laquelle pour un administrateur) ; par défaut la dernière. | « corrige ma dernière note sur Paul : bonus refusé » | `editNoteAction` |
| Retirer l'affilié d'un membre (plus aucun affilié), avec un motif. | « retire l'affilié de Paul Martin, il est venu tout seul » | `removeMemberAffiliateAction` |
| Poser ou retirer des étiquettes (de Réglages → Étiquettes) sur un membre. | « mets l'étiquette VIP à Paul Martin » | `setMemberTagsAction` |

## /members/automations

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `createRuleAction` |
| Supprimer une relance. | « supprime la relance Cliqueurs octobre » | `deleteRuleAction` |
| Dupliquer une relance (la copie est désactivée). | « duplique la relance Cliqueurs » | `duplicateRuleAction` |
| Régler une relance prête à l'emploi (bienvenue, offre sans inscription, inscrit sans dépôt, inactifs, merci du premier dépôt, VIP) : texte, délai, canaux, bot ; créée désactivée la première fois. | « change le message de bienvenue : Salut {prenom}, bienvenue ! » | `saveCardAction` |
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `saveRuleAction` |
| Jouer une relance pour moi seul, en messages de test sur mon Telegram. | « teste la relance de bienvenue sur moi » | `testRuleOnMeAction` |
| Activer ou désactiver une relance (activée, elle écrit automatiquement aux membres concernés : aperçu du message avant le OUI). | « active la relance de bienvenue » | `toggleRuleAction` |
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `updateRuleAction` |

## /members/automations/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `createRuleAction` |
| Supprimer une relance. | « supprime la relance Cliqueurs octobre » | `deleteRuleAction` |
| Dupliquer une relance (la copie est désactivée). | « duplique la relance Cliqueurs » | `duplicateRuleAction` |
| Régler une relance prête à l'emploi (bienvenue, offre sans inscription, inscrit sans dépôt, inactifs, merci du premier dépôt, VIP) : texte, délai, canaux, bot ; créée désactivée la première fois. | « change le message de bienvenue : Salut {prenom}, bienvenue ! » | `saveCardAction` |
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `saveRuleAction` |
| Jouer une relance pour moi seul, en messages de test sur mon Telegram. | « teste la relance de bienvenue sur moi » | `testRuleOnMeAction` |
| Activer ou désactiver une relance (activée, elle écrit automatiquement aux membres concernés : aperçu du message avant le OUI). | « active la relance de bienvenue » | `toggleRuleAction` |
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `updateRuleAction` |

## /members/automations/[id]/edit

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `createRuleAction` |
| Supprimer une relance. | « supprime la relance Cliqueurs octobre » | `deleteRuleAction` |
| Dupliquer une relance (la copie est désactivée). | « duplique la relance Cliqueurs » | `duplicateRuleAction` |
| Régler une relance prête à l'emploi (bienvenue, offre sans inscription, inscrit sans dépôt, inactifs, merci du premier dépôt, VIP) : texte, délai, canaux, bot ; créée désactivée la première fois. | « change le message de bienvenue : Salut {prenom}, bienvenue ! » | `saveCardAction` |
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `saveRuleAction` |
| Jouer une relance pour moi seul, en messages de test sur mon Telegram. | « teste la relance de bienvenue sur moi » | `testRuleOnMeAction` |
| Activer ou désactiver une relance (activée, elle écrit automatiquement aux membres concernés : aperçu du message avant le OUI). | « active la relance de bienvenue » | `toggleRuleAction` |
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `updateRuleAction` |

## /members/automations/new

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `createRuleAction` |
| Supprimer une relance. | « supprime la relance Cliqueurs octobre » | `deleteRuleAction` |
| Dupliquer une relance (la copie est désactivée). | « duplique la relance Cliqueurs » | `duplicateRuleAction` |
| Régler une relance prête à l'emploi (bienvenue, offre sans inscription, inscrit sans dépôt, inactifs, merci du premier dépôt, VIP) : texte, délai, canaux, bot ; créée désactivée la première fois. | « change le message de bienvenue : Salut {prenom}, bienvenue ! » | `saveCardAction` |
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `saveRuleAction` |
| Jouer une relance pour moi seul, en messages de test sur mon Telegram. | « teste la relance de bienvenue sur moi » | `testRuleOnMeAction` |
| Activer ou désactiver une relance (activée, elle écrit automatiquement aux membres concernés : aperçu du message avant le OUI). | « active la relance de bienvenue » | `toggleRuleAction` |
| Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée. | « crée une relance pour ceux qui cliquent l'offre sans s'inscrire » | `updateRuleAction` |

## /members/broadcasts/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Annuler un envoi programmé ou en cours (les messages encore en attente ne partent pas). | « annule l'envoi Promo Halloween » | `cancelBroadcastAction` |
| Enregistrer un envoi en brouillon et me l'envoyer en test sur mon Telegram (rien ne part vers les membres). | « prépare ce message pour Zone Interdite et envoie-le moi en test » | `createAndTestAction` |
| Écrire à un groupe de membres en privé : message transféré (gardé tel quel) ou texte donné, groupe (canaux, campagnes, statuts, langues, étiquettes…), tout de suite, à une heure, ou en brouillon ; test A/B possible. | « envoie ce message à tous les membres de Zone Interdite demain 20 h » | `createBroadcastAction` |
| Supprimer un brouillon ou un envoi annulé. | « supprime le brouillon Promo Halloween » | `deleteDraftAction` |
| Programmer un envoi en brouillon (ou changer son heure). | « programme l'envoi Promo Halloween samedi 18 h » | `scheduleAction` |
| Lancer tout de suite un envoi en brouillon ou programmé. | « lance l'envoi Bonus du soir maintenant » | `sendNowAction` |
| Test A/B : envoyer la version gagnante aux membres du groupe pas encore servis. | « envoie la gagnante du test A/B Promo au reste » | `sendWinnerToRestAction` |
| M'envoyer un envoi en message de test sur mon Telegram, personnalisé comme pour un membre. | « envoie-moi l'envoi Promo Halloween en test » | `testToMeAction` |

## /members/broadcasts/ab/[groupId]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Annuler un envoi programmé ou en cours (les messages encore en attente ne partent pas). | « annule l'envoi Promo Halloween » | `cancelBroadcastAction` |
| Enregistrer un envoi en brouillon et me l'envoyer en test sur mon Telegram (rien ne part vers les membres). | « prépare ce message pour Zone Interdite et envoie-le moi en test » | `createAndTestAction` |
| Écrire à un groupe de membres en privé : message transféré (gardé tel quel) ou texte donné, groupe (canaux, campagnes, statuts, langues, étiquettes…), tout de suite, à une heure, ou en brouillon ; test A/B possible. | « envoie ce message à tous les membres de Zone Interdite demain 20 h » | `createBroadcastAction` |
| Supprimer un brouillon ou un envoi annulé. | « supprime le brouillon Promo Halloween » | `deleteDraftAction` |
| Programmer un envoi en brouillon (ou changer son heure). | « programme l'envoi Promo Halloween samedi 18 h » | `scheduleAction` |
| Lancer tout de suite un envoi en brouillon ou programmé. | « lance l'envoi Bonus du soir maintenant » | `sendNowAction` |
| Test A/B : envoyer la version gagnante aux membres du groupe pas encore servis. | « envoie la gagnante du test A/B Promo au reste » | `sendWinnerToRestAction` |
| M'envoyer un envoi en message de test sur mon Telegram, personnalisé comme pour un membre. | « envoie-moi l'envoi Promo Halloween en test » | `testToMeAction` |

## /members/broadcasts/new

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Annuler un envoi programmé ou en cours (les messages encore en attente ne partent pas). | « annule l'envoi Promo Halloween » | `cancelBroadcastAction` |
| Enregistrer un envoi en brouillon et me l'envoyer en test sur mon Telegram (rien ne part vers les membres). | « prépare ce message pour Zone Interdite et envoie-le moi en test » | `createAndTestAction` |
| Écrire à un groupe de membres en privé : message transféré (gardé tel quel) ou texte donné, groupe (canaux, campagnes, statuts, langues, étiquettes…), tout de suite, à une heure, ou en brouillon ; test A/B possible. | « envoie ce message à tous les membres de Zone Interdite demain 20 h » | `createBroadcastAction` |
| Supprimer un brouillon ou un envoi annulé. | « supprime le brouillon Promo Halloween » | `deleteDraftAction` |
| Programmer un envoi en brouillon (ou changer son heure). | « programme l'envoi Promo Halloween samedi 18 h » | `scheduleAction` |
| Lancer tout de suite un envoi en brouillon ou programmé. | « lance l'envoi Bonus du soir maintenant » | `sendNowAction` |
| Test A/B : envoyer la version gagnante aux membres du groupe pas encore servis. | « envoie la gagnante du test A/B Promo au reste » | `sendWinnerToRestAction` |
| M'envoyer un envoi en message de test sur mon Telegram, personnalisé comme pour un membre. | « envoie-moi l'envoi Promo Halloween en test » | `testToMeAction` |

## /messages

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Appliquer la nouvelle règle aux demandes déjà en attente (aucun message envoyé). | « applique la nouvelle règle aux demandes en attente de Zone Interdite » | `applyRuleToPendingAction` |
| Accepter toutes les demandes en attente d'un canal (ou celles d'un filtre). | « accepte toutes les demandes de Zone Interdite » | `approveAllRequestsAction` |
| Accepter tout de suite une demande d'adhésion. | « accepte la demande de @paul sur Zone Interdite » | `approveMembershipAction` |
| Créer et vérifier les liens des canaux à rejoindre d'un canal. | « vérifie les liens des canaux à rejoindre de Zone Interdite » | `checkGateLinksAction` |
| Refuser une demande d'adhésion (la personne devra redemander). | « refuse la demande de @paul sur Zone Interdite » | `declineMembershipAction` |
| Supprimer une exception (les prochaines demandes suivent la règle par défaut). | « supprime l'exception Venu de Tir Cadré sur Zone Interdite » | `deleteExceptionAction` |
| Monter ou descendre une exception dans son groupe (priorité). | « monte l'exception Venu de Tir Cadré » | `moveExceptionAction` |
| Re-vérifier les droits de nos bots sur un canal. | « revérifie les droits des bots sur Zone Interdite » | `recheckRightsAction` |
| Recalculer tout de suite les meilleurs créneaux de publication. | « recalcule les meilleurs horaires » | `recomputeBestHoursAction` |
| Ranger les exceptions d'un groupe dans un ordre donné (liste complète du groupe). | « mets l'exception Tir Cadré avant celle de Corner » | `reorderExceptionsAction` |
| Créer ou modifier une exception à la règle selon la provenance (canal d'origine, pub, lien de partage, affilié, page). | « les gens qui viennent de Tir Cadré sont acceptés tout de suite sur Zone Interdite » | `saveExceptionAction` |
| Régler la règle d'acceptation par défaut d'un canal : quand accepter, canaux à rejoindre, rappels, expiration, messages. | « sur Zone Interdite, accepte les demandes au bout de 5 minutes » | `saveRuleAction` |
| Activer ou désactiver une exception. | « désactive l'exception Venu de Tir Cadré sur Zone Interdite » | `toggleExceptionAction` |
| Déplacer un brouillon ou un message programmé à une autre date (test A/B déplacé d'un bloc). | « déplace le message ABC123 à vendredi 19 h » | `movePostAction` |

## /messages/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Dernier relevé du compte Telegram connecté (Premium, canaux où il peut publier). | « où le compte Telegram peut-il publier ? » | `accountPublishStatusAction` |
| Annuler l'envoi d'un message programmé (il reste modifiable). | « annule le message ABC123 » | `cancelPostAction` |
| Vérifier si le compte Telegram connecté peut publier dans des canaux (Premium, droit de publier). | « le compte peut-il publier dans Zone Interdite ? » | `checkAccountPublishAction` |
| Programmer un message dans un ou plusieurs canaux (message transféré repris tel quel, emojis animés compris). | « programme ça sur Zone Interdite demain 20 h » | `createPostAction` |
| Créer le lien suivi de l'offre d'une campagne, à mettre dans le texte d'un message. | « donne-moi le lien de l'offre Celsius à mettre dans le texte » | `createTextOfferLinkAction` |
| Supprimer du canal Telegram un message déjà envoyé. | « supprime le message ABC123 du canal » | `deleteOnTelegramAction` |
| Retirer de la plateforme un brouillon, un modèle ou un message annulé. | « supprime le brouillon ABC123 » | `discardPostAction` |
| Enregistrer un message existant comme modèle. | « garde le message ABC123 comme modèle « Bonus du vendredi » » | `saveAsTemplateAction` |
| Décaler un message programmé de N minutes (avant ou après). | « décale le message ABC123 de 30 minutes » | `shiftPostAction` |
| Modifier un brouillon ou un message programmé (texte, date, boutons, catégorie). | « remplace le texte du message ABC123 par ça » | `updatePostAction` |
| Déplacer un brouillon ou un message programmé à une autre date (test A/B déplacé d'un bloc). | « déplace le message ABC123 à vendredi 19 h » | `movePostAction` |

## /messages/[id]/edit

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Dernier relevé du compte Telegram connecté (Premium, canaux où il peut publier). | « où le compte Telegram peut-il publier ? » | `accountPublishStatusAction` |
| Annuler l'envoi d'un message programmé (il reste modifiable). | « annule le message ABC123 » | `cancelPostAction` |
| Vérifier si le compte Telegram connecté peut publier dans des canaux (Premium, droit de publier). | « le compte peut-il publier dans Zone Interdite ? » | `checkAccountPublishAction` |
| Programmer un message dans un ou plusieurs canaux (message transféré repris tel quel, emojis animés compris). | « programme ça sur Zone Interdite demain 20 h » | `createPostAction` |
| Créer le lien suivi de l'offre d'une campagne, à mettre dans le texte d'un message. | « donne-moi le lien de l'offre Celsius à mettre dans le texte » | `createTextOfferLinkAction` |
| Supprimer du canal Telegram un message déjà envoyé. | « supprime le message ABC123 du canal » | `deleteOnTelegramAction` |
| Retirer de la plateforme un brouillon, un modèle ou un message annulé. | « supprime le brouillon ABC123 » | `discardPostAction` |
| Enregistrer un message existant comme modèle. | « garde le message ABC123 comme modèle « Bonus du vendredi » » | `saveAsTemplateAction` |
| Décaler un message programmé de N minutes (avant ou après). | « décale le message ABC123 de 30 minutes » | `shiftPostAction` |
| Modifier un brouillon ou un message programmé (texte, date, boutons, catégorie). | « remplace le texte du message ABC123 par ça » | `updatePostAction` |

## /messages/categories

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Créer (ou réutiliser) une catégorie de messages en passant. | « crée la catégorie Teasing » | `createCategoryInlineAction` |

## /messages/emojis

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Retirer un emoji animé de la bibliothèque (les messages qui l'utilisent le gardent). | « retire l'emoji 🔥 de la bibliothèque » | `hideEmojiAction` |
| Ajouter tous les emojis animés d'un pack à la bibliothèque (lien t.me/addemoji/…). | « ajoute le pack t.me/addemoji/NomDuPack » | `importPackAction` |
| Importer les packs d'emojis animés installés sur le compte Telegram connecté. | « importe les emojis de mon compte » | `requestAccountImportAction` |
| Remettre un emoji animé dans la bibliothèque. | « remets l'emoji 🔥 dans la bibliothèque » | `restoreEmojiAction` |
| Relancer la récupération des aperçus d'emojis animés manquants. | « relance les aperçus des emojis » | `retryPreviewsAction` |

## /messages/new

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Dernier relevé du compte Telegram connecté (Premium, canaux où il peut publier). | « où le compte Telegram peut-il publier ? » | `accountPublishStatusAction` |
| Annuler l'envoi d'un message programmé (il reste modifiable). | « annule le message ABC123 » | `cancelPostAction` |
| Vérifier si le compte Telegram connecté peut publier dans des canaux (Premium, droit de publier). | « le compte peut-il publier dans Zone Interdite ? » | `checkAccountPublishAction` |
| Programmer un message dans un ou plusieurs canaux (message transféré repris tel quel, emojis animés compris). | « programme ça sur Zone Interdite demain 20 h » | `createPostAction` |
| Créer le lien suivi de l'offre d'une campagne, à mettre dans le texte d'un message. | « donne-moi le lien de l'offre Celsius à mettre dans le texte » | `createTextOfferLinkAction` |
| Supprimer du canal Telegram un message déjà envoyé. | « supprime le message ABC123 du canal » | `deleteOnTelegramAction` |
| Retirer de la plateforme un brouillon, un modèle ou un message annulé. | « supprime le brouillon ABC123 » | `discardPostAction` |
| Enregistrer un message existant comme modèle. | « garde le message ABC123 comme modèle « Bonus du vendredi » » | `saveAsTemplateAction` |
| Décaler un message programmé de N minutes (avant ou après). | « décale le message ABC123 de 30 minutes » | `shiftPostAction` |
| Modifier un brouillon ou un message programmé (texte, date, boutons, catégorie). | « remplace le texte du message ABC123 par ça » | `updatePostAction` |

## /pages/[id]

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Supprimer une page d'atterrissage (ses liens Telegram sont révoqués, ses visites effacées). | « supprime la page Zone » | `deleteLandingPageAction` |
| Réessayer de créer les liens Telegram manquants d'une page. | « réessaie les liens de la page Zone » | `retryLandingLinksAction` |
| Créer une page d'atterrissage pour un canal (titre, texte, bouton, langue, sources). | « crée une page pour Zone Interdite avec le titre « Rejoins-nous » et le bouton « Entrer » » | `saveLandingPageAction` |

## /pages/new

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Supprimer une page d'atterrissage (ses liens Telegram sont révoqués, ses visites effacées). | « supprime la page Zone » | `deleteLandingPageAction` |
| Réessayer de créer les liens Telegram manquants d'une page. | « réessaie les liens de la page Zone » | `retryLandingLinksAction` |
| Créer une page d'atterrissage pour un canal (titre, texte, bouton, langue, sources). | « crée une page pour Zone Interdite avec le titre « Rejoins-nous » et le bouton « Entrer » » | `saveLandingPageAction` |

## /settings

Exclusions (impossible dans Telegram) :

- `completeTourAction` : Visite guidée du site : affichage seul (la visite n'existe que dans le navigateur). Kevin propose : L'aide de Kevin (« aide », « comment je fais … ? ») remplace la visite guidée.
- `dismissChecklistAction` : Masquer la liste « À faire pour démarrer » de l'accueil du site : affichage seul. Kevin propose : L'aide de Kevin (« commencer », « aide ») donne la même liste de départ.
- `restartTourAction` : Revoir la visite guidée du site : affichage seul. Kevin propose : L'aide de Kevin (« aide », « commencer ») remplace la visite guidée.

## /settings/accounts

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ajouter un vrai compte Telegram (étape 1 : code envoyé au numéro ; le code se tape sur la page, lien envoyé par Kevin). | « ajoute le compte Telegram +33612345678 nommé Inès » | `addAccountAction` |
| Déconnecter un vrai compte Telegram (session révoquée, compte désactivé). | « déconnecte le compte Inès » | `disconnectAccountAction` |
| Vérifier que la session d'un vrai compte Telegram est encore valable. | « vérifie le compte Inès » | `refreshAccountAction` |
| Rattacher une persona Rencontres à un vrai compte Telegram (ou « aucune »). | « mets la persona Inès sur le compte +33612345678 » | `setAccountPersonaAction` |
| Terminer la connexion d'un vrai compte Telegram avec son mot de passe en deux étapes (demandé en privé). | « voici le mot de passe en deux étapes du compte Inès » | `submitPasswordAction` |
| Activer ou désactiver un vrai compte Telegram (prend effet au redémarrage du service des comptes). | « désactive le compte Inès » | `toggleAccountAction` |

Exclusions (impossible dans Telegram) :

- `submitCodeAction` : Étape « code reçu » d'un vrai compte Telegram. Telegram annule un code de connexion recopié dans une conversation Telegram (protection contre le vol de compte) : le code ne peut pas passer par Kevin. Kevin propose : Kevin envoie le code (« connecteurs.compte_ajouter »), puis le lien direct de Réglages → Comptes pour taper le code ; le mot de passe en deux étapes, lui, passe par Kevin en privé. Kevin envoie le lien direct de la page (lien d'autorisation signé, usage unique, 15 minutes : `createAuthLink`).

## /settings/ai

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Retirer la clé Anthropic (l'assistant d'écriture est désactivé, l'historique reste) | « retire la clé Anthropic » | `removeAiKeyAction` |
| Régler l'assistant d'écriture des messages : modèles, plafond mensuel, limite par personne et par jour, mentions des risques casino et paris | « plafond de l'assistant d'écriture à 30 € par mois » | `saveAiSettingsAction` |
| Vérifier la clé Anthropic de l'assistant d'écriture (appel minimal) | « vérifie la clé Anthropic » | `verifyAiKeyAction` |

## /settings/alerts

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Vérifier les alertes maintenant. | « vérifie les alertes maintenant » | `checkAlertsNowAction` |
| Lancer maintenant la purge des données personnelles trop anciennes (anonymisation des membres inactifs). | « lance la purge maintenant » | `purgeNowAction` |
| Marquer une alerte comme résolue. | « l'alerte sur le bot est réglée » | `resolveAlertAction` |
| Seuils et interrupteurs des alertes sur les chiffres : chute des inscriptions (%), dépense pub sans aucune inscription sur 24 h (€ par pub), départs d'un canal (%) ; activer ou couper une alerte. | « préviens-moi si une pub dépense plus de 200 € sans inscription » | `saveAlertThresholdsAction` |
| Durée de conservation des données personnelles des membres (6 à 120 mois ; une baisse anonymise plus de membres à la prochaine purge). | « garde les données 36 mois » | `saveRetentionAction` |

## /settings/assistant

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Retirer la clé Venice : l'assistant de conversation ne répond plus à personne (l'historique des coûts reste) | « retire la clé Venice » | `removeAssistantKeyAction` |
| Régler l'assistant de conversation : à qui il répond (personne, l'équipe, tout le monde), modèles, créativité, longueur, plafond mensuel, réponses par jour et par conversation | « l'assistante répond seulement à l'équipe » | `saveAssistantSettingsAction` |
| Vérifier la clé Venice enregistrée (sans dépense) et relire la liste des modèles | « vérifie la clé Venice » | `verifyAssistantKeyAction` |

## /settings/bots

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Ajouter un bot Telegram par son jeton @BotFather (en privé) : bot de canal d'un univers, ou Boss. | « ajoute un bot pour les paris sportifs » | `addBotAction` |
| Reposer la connexion Telegram d'un bot (il reçoit de nouveau les messages). | « repose la connexion de @zone_bot » | `resyncWebhookAction` |
| Mode d'un bot : bot normal, ou assistant de conversation lié à une persona. | « passe @ines_bot en assistante avec la persona Inès » | `setBotModeAction` |
| Activer ou désactiver un bot (désactivé : il ne répond plus aux membres). | « désactive @zone_bot » | `toggleBotAction` |

## /settings/categories

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Créer une catégorie de messages (nom, couleur, univers). | « crée la catégorie Bonus en rouge pour le casino » | `createCategoryAction` |
| Supprimer une catégorie de messages, en fusionnant ses messages dans une autre si on veut. | « supprime la catégorie Teasing » | `deleteCategoryAction` |
| Modifier une catégorie de messages (nom, couleur, ordre, univers, active). | « renomme la catégorie Bonus en Bonus VIP » | `updateCategoryAction` |

## /settings/connectors

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Taux de change saisis (unités pour 1 €), prioritaires sur ceux de Link Affi ; vide = efface les taux saisis. | « mets le dollar à 1,08 » | `saveRatesAction` |
| Seuils du niveau de dépense des membres : VIP à partir de X € déposés, régulier à partir de N dépôts. | « un membre est VIP à partir de 800 € déposés » | `saveSpendThresholdsAction` |
| Relire Link Affi maintenant (passage normal, ou resynchronisation complète). | « synchronise Link Affi » | `syncNowAction` |
| Générer la clé de connexion que Link Affi utilise pour appeler notre API (montrée une fois, en privé ; l'ancienne cesse de marcher). | « génère la clé pour Link Affi » | `generateLinkaffiKeyAction` |
| Générer le secret de signature des événements envoyés à Link Affi (montré une fois, en privé ; remplace l'ancien). | « génère le secret de signature Link Affi » | `generateLinkaffiSecretAction` |
| Changer l'adresse de la fonction Link Affi « telegram-events » (vide = adresse d'origine). | « envoie les événements Link Affi à https://…/telegram-events » | `saveLinkaffiEventsUrlAction` |
| Envoyer un événement de test signé à Link Affi pour vérifier la connexion des affiliés. | « teste la connexion Link Affi des affiliés » | `sendLinkaffiTestEventAction` |

## /settings/connectors/meta

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Abandonner la connexion Meta en attente du choix des comptes. | « annule la connexion Meta » | `cancelPendingMetaAction` |
| Suivre les comptes publicitaires Meta choisis parmi ceux proposés (historique de 90 jours importé). | « suis le compte Meta Zone Interdite » | `connectChosenMetaAccountsAction` |
| Déconnecter un compte publicitaire Meta (jeton effacé, dépenses déjà importées conservées). | « déconnecte le compte Meta Zone Interdite » | `disconnectMetaConnectionAction` |
| Enregistrer les identifiants de l'application Meta (App ID ; secret demandé en privé, vide = inchangé), config_id facultatif. | « enregistre l'application Meta avec l'App ID 1234567 » | `saveMetaAppAction` |
| Relire maintenant les dépenses d'un compte Meta (3 jours, ou 28 jours). | « synchronise Meta » | `syncMetaConnectionAction` |
| Tester les identifiants de l'application Meta, sans rien connecter. | « vérifie l'application Meta » | `verifyMetaAppAction` |

## /settings/connectors/meta/choose

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Abandonner la connexion Meta en attente du choix des comptes. | « annule la connexion Meta » | `cancelPendingMetaAction` |
| Suivre les comptes publicitaires Meta choisis parmi ceux proposés (historique de 90 jours importé). | « suis le compte Meta Zone Interdite » | `connectChosenMetaAccountsAction` |
| Déconnecter un compte publicitaire Meta (jeton effacé, dépenses déjà importées conservées). | « déconnecte le compte Meta Zone Interdite » | `disconnectMetaConnectionAction` |
| Enregistrer les identifiants de l'application Meta (App ID ; secret demandé en privé, vide = inchangé), config_id facultatif. | « enregistre l'application Meta avec l'App ID 1234567 » | `saveMetaAppAction` |
| Relire maintenant les dépenses d'un compte Meta (3 jours, ou 28 jours). | « synchronise Meta » | `syncMetaConnectionAction` |
| Tester les identifiants de l'application Meta, sans rien connecter. | « vérifie l'application Meta » | `verifyMetaAppAction` |

## /settings/connectors/telegram

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Étape 3 : mot de passe de validation en deux étapes du compte qui relève les vues (demandé en privé). | « voici le mot de passe en deux étapes du compte des vues » | `checkPasswordAction` |
| Déconnecter le compte Telegram qui relève les vues (session révoquée). | « déconnecte le compte Telegram des vues » | `disconnectAction` |
| Relever maintenant les vues des messages des canaux. | « relève les vues maintenant » | `pollNowAction` |
| Enregistrer l'application Telegram (my.telegram.org) du compte qui relève les vues : api_id, api_hash en privé. | « enregistre l'api_id Telegram 1234567 » | `saveUserApiAction` |
| Étape 1 de la connexion du compte qui relève les vues : envoyer le code au numéro (le code se tape ensuite sur la page, lien envoyé par Kevin). | « connecte le compte Telegram +33612345678 pour les vues » | `sendCodeAction` |

Exclusions (impossible dans Telegram) :

- `signInAction` : Étape « code reçu » du compte qui relève les vues. Telegram annule un code de connexion recopié dans une conversation Telegram (protection contre le vol de compte) : le code ne peut pas passer par Kevin. Kevin propose : Kevin envoie le code (« connecteurs.telegram_envoyer_code »), puis le lien direct de Réglages → Connexions → Telegram pour taper le code ; le mot de passe en deux étapes, lui, passe par Kevin en privé. Kevin envoie le lien direct de la page (lien d'autorisation signé, usage unique, 15 minutes : `createAuthLink`).

## /settings/connectors/tiktok

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Abandonner la connexion TikTok en attente du choix des comptes. | « annule la connexion TikTok » | `cancelPendingAction` |
| Suivre les comptes publicitaires TikTok choisis parmi ceux proposés (historique de 90 jours importé). | « suis le compte TikTok Zone Interdite » | `connectChosenAccountsAction` |
| Connecter un annonceur de test TikTok (bac à sable : jeton du portail demandé en privé). | « connecte l'annonceur de test TikTok 7012345678 » | `connectSandboxAction` |
| Déconnecter un compte publicitaire TikTok (jeton effacé, dépenses déjà importées conservées). | « déconnecte le compte TikTok Zone Interdite » | `disconnectTikTokAction` |
| Enregistrer les identifiants de l'application TikTok (App ID ; secret demandé en privé, vide = inchangé), mode bac à sable. | « enregistre l'application TikTok avec l'App ID 1234567 » | `saveTikTokAppAction` |
| Relire maintenant les dépenses d'un compte TikTok (3 jours, ou 28 jours). | « synchronise TikTok » | `syncTikTokNowAction` |
| Tester les identifiants de l'application TikTok, sans rien connecter. | « vérifie l'application TikTok » | `verifyTikTokAppAction` |

## /settings/connectors/tiktok/choose

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Abandonner la connexion TikTok en attente du choix des comptes. | « annule la connexion TikTok » | `cancelPendingAction` |
| Suivre les comptes publicitaires TikTok choisis parmi ceux proposés (historique de 90 jours importé). | « suis le compte TikTok Zone Interdite » | `connectChosenAccountsAction` |
| Connecter un annonceur de test TikTok (bac à sable : jeton du portail demandé en privé). | « connecte l'annonceur de test TikTok 7012345678 » | `connectSandboxAction` |
| Déconnecter un compte publicitaire TikTok (jeton effacé, dépenses déjà importées conservées). | « déconnecte le compte TikTok Zone Interdite » | `disconnectTikTokAction` |
| Enregistrer les identifiants de l'application TikTok (App ID ; secret demandé en privé, vide = inchangé), mode bac à sable. | « enregistre l'application TikTok avec l'App ID 1234567 » | `saveTikTokAppAction` |
| Relire maintenant les dépenses d'un compte TikTok (3 jours, ou 28 jours). | « synchronise TikTok » | `syncTikTokNowAction` |
| Tester les identifiants de l'application TikTok, sans rien connecter. | « vérifie l'application TikTok » | `verifyTikTokAppAction` |

## /settings/postbacks

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Créer une adresse de réception de postbacks pour un programme (l'adresse est envoyée en privé). | « crée une adresse de postback « Celsius direct » pour le programme Celsius » | `createEndpointAction` |
| Générer une nouvelle URL pour une adresse de postback (l'ancienne cesse de marcher ; envoyée en privé). | « change l'URL du postback Celsius » | `regenerateTokenAction` |
| Simuler un postback (inscription par défaut) sur une adresse pour vérifier la chaîne (un joueur de test est enregistré). | « teste le postback Celsius » | `testPostbackAction` |
| Activer ou désactiver une adresse de postback (désactivée : les postbacks du partenaire sont refusés). | « désactive l'adresse de postback Celsius » | `toggleEndpointAction` |
| Renommer une adresse de postback ou changer la correspondance de ses paramètres. | « renomme l'adresse de postback Celsius en « Celsius FR » » | `updateEndpointAction` |

## /settings/postbacks/import

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Importer les joueurs d'un fichier CSV envoyé à Kevin dans un programme (aperçu d'abord, puis OUI). | « importe ces joueurs dans Celsius » | `importPlayersAction` |
| Analyser un fichier CSV de joueurs envoyé à Kevin (lignes, colonnes reconnues, lignes illisibles), sans rien importer. | « regarde ce fichier de joueurs Celsius » | `previewPlayersImportAction` |

## /settings/reports

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Rapports automatiques sur Telegram : heure d'envoi (heure de Paris), résumé quotidien et rapport du lundi activés ou non. | « envoie-moi le rapport à 8 h au lieu de 9 h » | `saveReportsConfigAction` |
| Envoyer tout de suite le résumé quotidien ou le rapport hebdomadaire. | « envoie-moi le résumé maintenant » | `sendReportNowAction` |

## /settings/status

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Effacer les tâches échouées de plus de 7 jours dans toutes les files. | « fais le ménage dans les tâches échouées » | `cleanFailedJobsAction` |
| Relancer les missions bloquées des agents (même balayage que celui du Grand Chef). | « relance les missions bloquées » | `resumeAgentMissionsAction` |
| Relancer une tâche échouée (État du système). | « relance la tâche échouée 1234 de la file stats » | `retryJobAction` |

## /settings/tags

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Créer une étiquette de membres. | « crée l'étiquette VIP en vert » | `createTagAction` |
| Supprimer une étiquette (retirée de tous les membres qui la portent). | « supprime l'étiquette VIP » | `deleteTagAction` |
| Renommer ou recolorer une étiquette (le nouveau nom passe sur tous les membres qui l'ont). | « renomme l'étiquette VIP en VIP Gold » | `updateTagAction` |

## /settings/team

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Inviter une personne sur le site avec un rôle : Kevin crée l'invitation et envoie le lien (7 jours) en privé. | « ajoute Léa à l'équipe comme responsable » | `inviteAction` |
| Créer un lien de réinitialisation du mot de passe pour une personne (48 h, envoyé en privé). | « Léa a oublié son mot de passe » | `resetPasswordAction` |
| Annuler une invitation en attente (le lien ne marche plus). | « annule l'invitation de lea@exemple.fr » | `revokeInvitationAction` |
| Changer le rôle d'une personne (administrateur ou responsable ; elle devra se reconnecter). | « passe Léa administratrice » | `setRoleAction` |
| Retirer une personne de l'équipe : son compte est désactivé et elle est déconnectée partout. | « retire Marc de l'équipe » | `toggleUserAction` |

## /stats/ads

| Ce qu'on y fait | La phrase à dire à Kevin | Action du site |
|---|---|---|
| Relancer le recalcul complet des statistiques journalières (en arrière-plan, une minute). | « recalcule les statistiques » | `recomputeStatsAction` |

