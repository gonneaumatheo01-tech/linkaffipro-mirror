# Phase 14 — Demandes bloquées sur « Attend les canaux » (constat du 15 octobre, trafic TikTok réel)

Si `docs/STATUS.md` indique déjà « phase 14 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/REFONTE-UX.md`, `docs/STATUS.md`, et le code du flux d'adhésion (`packages/telegram/src/join-flow/`, `apps/worker/src/approvals/`, `apps/web/lib/channels/`, onglets « Qui peut entrer », « Ce que dit le bot » et « Demandes » de la fiche canal). Mode autonome, aucune question, décisions dans `docs/DECISIONS-TECH.md`.

## Constat (relevé en production le 15 octobre à 3 h 45, pages du site, lecture seule)
- Canal « Zone Interdite 🔞 » (bot @womendatingoobot). Trafic : pub TikTok « Dating test 1 semaine / Redirection paris sportifs — Pub 1 », depuis le 14 octobre 16 h 41. Règle par défaut : canaux **obligatoires** « LA ZONE ROULETTE 🎰 » et « 🎯 TIR CADRÉ ⚡ », acceptation 5 minutes après.
- Environ 50 demandes : environ 14 vraies personnes acceptées, **36 restées en « Attend les canaux »** (37 demandes en cours dans l'onglet Demandes).
- Sur ces 36 :
  - message d'accueil **envoyé à 36 sur 36** (pas de panne d'envoi) ;
  - **15 ont bloqué le bot** dans les minutes qui suivent l'accueil ;
  - **3 ont rejoint les deux canaux mais n'ont jamais appuyé sur « ✅ J'ai rejoint »**, donc restent bloqués (Aaron `cmv8e8ssd003aoab7zi58rlce`, Momilo Lioutipo `cmv89d8po01iqsab5ou4hoe8u`, Moahmed Junior `cmv894om601dfsab57nj22be7`) ;
  - 4 ont rejoint un seul des deux canaux ;
  - les autres n'ont rien fait.
- Rappel d'une heure : **refusé par Telegram pour 14 personnes** (« bloqué ») et passé pour 6. La fenêtre `user_chat_id` est de 5 minutes, et la personne n'a jamais appuyé sur « Démarrer ».
- Le texte de l'onglet Demandes « Acceptée toute seule une fois les canaux rejoints » est **faux** : rien ne se passe sans « ✅ J'ai rejoint ».
- Le 15 octobre à 3 h 33, le client a passé les canaux de Zone Interdite en **« Proposés »**. Les nouvelles demandes sont donc acceptées après 5 minutes. Mais la règle « s'applique aux prochaines demandes » : les 37 demandes existantes **restent bloquées pour toujours**, et l'accueil personnalisé du canal dit encore « Rejoins les deux canaux ci-dessous, puis clique sur « J'ai rejoint » pour être accepté ».
- Commence par confirmer ces chiffres dans la base de production (lecture seule) :
  - la vraie erreur Telegram des rappels « bloqués » : `bot was blocked by the user`, ou bien `bot can't initiate conversation with a user` ;
  - l'origine de l'événement « A bloqué le bot » ;
  - le taux par heure.
  
  Écris le résultat dans `docs/STATUS.md`.

## 1. Validation automatique quand les canaux obligatoires sont rejoints
- Dès qu'une personne fait une demande dans un canal obligatoire, ou y entre, par un de nos liens ou non, re-vérifier toutes ses demandes `PENDING_GATE`. Satisfait = membre, ou demande en cours / programmée / acceptée chez nous : même règle que `checkGateMembership`.
- Si tous les canaux obligatoires sont satisfaits, passer la demande en `SCHEDULED` avec `approveAtAfterGate(rule, maintenant)`, sans attendre « ✅ J'ai rejoint ». Enregistrer l'événement `membership.gate_satisfied` avec `auto: true`.
- Envoyer le message « Canaux rejoints » seulement si le bot peut encore écrire à la personne. Sinon, aucun envoi.
- Filet de sécurité dans le worker : toutes les 2 minutes, re-vérifier les `PENDING_GATE` de moins de 7 jours (d'abord avec nos données, puis avec `getChatMember` seulement si besoin, en respectant les limites de débit).
- Rattrapage unique en production après déploiement : appliquer cette vérification à toutes les demandes `PENDING_GATE` actuelles (les 3 personnes ci-dessus doivent passer). Écrire le nombre dans `docs/STATUS.md`.
- Le texte « Acceptée toute seule une fois les canaux rejoints » devient vrai. Garde-le, avec en petit « ou dès qu'elle appuie sur ✅ J'ai rejoint ».

## 2. « ✅ J'ai rejoint » sans passer par « Démarrer »
- Nouveaux messages : un bouton à rappel (`callback_data` `g:<code>`) au lieu du lien `t.me/<bot>?start=g<code>`. La réponse se fait par `answerCallbackQuery` et en modifiant le message du bot (texte « C'est bon… » ou « Il te manque encore… » avec les boutons manquants).
- Garder le lien `/start g…` valide pour les messages déjà envoyés.
- Tests : bouton pressé avec canaux complets, avec un canal manquant, et code inconnu.

## 3. Appliquer une règle aux demandes déjà en attente
- Quand une règle de canal (par défaut ou exception) est enregistrée et que des demandes en cours relèvent de cette règle, afficher sous « Enregistrer la règle » : « 37 demandes déjà en attente suivent l'ancienne règle. [Leur appliquer la nouvelle règle] ».
- Le bouton recalcule chaque demande comme si elle arrivait maintenant, avec sa date d'origine pour le délai :
  - « Proposés » ou sans canaux : `SCHEDULED` ;
  - délai déjà écoulé : acceptation au prochain passage du worker.
  
  Fenêtre de confirmation, journal, aucun message d'accueil renvoyé.
- Onglet Demandes : bouton **« Tout accepter »** sur la liste filtrée (confirmation avec le nombre, file d'acceptation avec les limites de Telegram, journal) et filtre par statut.

## 4. Textes cohérents avec la règle
- Canaux en « Proposés » :
  - l'accueil ne porte plus le bouton « ✅ J'ai rejoint » (il ne sert à rien), seulement « Rejoindre … » ;
  - si le texte personnalisé parle d'une étape obligatoire (« J'ai rejoint », « pour être accepté », « dernière étape »), afficher un avertissement dans « Ce que dit le bot » et sur la règle : « Vos canaux sont proposés : la personne est acceptée de toute façon. Votre message d'accueil dit qu'elle doit les rejoindre : pensez à l'adapter. »
- Le rappel n'existe qu'avec des canaux obligatoires (déjà le cas) : le dire à côté du réglage.

## 5. Rappels qui arrivent vraiment
- Telegram ne laisse le bot écrire que 5 minutes après la demande, sauf si la personne a appuyé sur « Démarrer » ou sur un bouton du bot.
- Avec des canaux obligatoires, un **rappel automatique à 4 minutes** si rien n'est fait. Il est réglable et activé par défaut sur les nouvelles règles ; ne pas modifier les règles existantes.
- Les rappels plus tardifs ne partent qu'aux personnes que le bot peut encore joindre.
- Afficher à côté du réglage : « Après 5 minutes, Telegram ne transmet vos rappels qu'aux personnes qui ont déjà écrit au bot. »

## 6. Suivi et alerte « bot bloqué »
- Fiche canal (onglet Demandes, en haut) et Statistiques → Canaux : le parcours des demandes sur la période :
  - demandes ;
  - accueil envoyé ;
  - **ont bloqué le bot** ;
  - au moins un canal rejoint ;
  - tous rejoints ;
  - acceptées ;
  - parties.
  
  Le tout par provenance (pub, canal, lien).
- Alerte Telegram à l'admin (au plus une par canal toutes les 6 heures) si plus de 25 % des personnes bloquent le bot dans l'heure qui suit l'accueil, sur au moins 10 demandes : « 40 % des personnes venues de Pub 1 ont bloqué @womendatingoobot après l'accueil : Telegram peut limiter un bot signalé. Adoucir le message ou passer les canaux en « Proposés ». »

## 7. Tests et livraison
- Tests unitaires et d'intégration simulés :
  - validation automatique : demande dans le 2e canal obligatoire, donc acceptation programmée ;
  - entrée directe dans un canal obligatoire ;
  - filet du worker ;
  - bouton à rappel ;
  - application d'une nouvelle règle aux demandes en attente ;
  - « Tout accepter » ;
  - accueil sans « J'ai rejoint » en « Proposés » ;
  - rappel à 4 minutes ;
  - alerte « bot bloqué ».
- Aucune action sur de vrais membres pendant les tests. En production, seul le rattrapage de la section 1 est fait automatiquement : c'est la règle choisie par le client, et ces personnes ont rejoint les canaux. **Ne touche pas aux 37 demandes de Zone Interdite par le bouton de la section 3** : c'est le client qui décide (il a peut-être déjà accepté ces demandes à la main).
- `pnpm lint && pnpm build && pnpm test` verts, déploiement vérifié, captures 1440 / 390 de la fiche canal, `docs/STATUS.md` et guide (section Canaux : « Pourquoi des demandes restent sur Attend les canaux ») à jour, commit et push.
- Bilan Telegram en 5 lignes, puis `docs/PHASE-DONE`.
