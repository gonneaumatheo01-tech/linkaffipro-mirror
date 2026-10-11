# Phase 11 — Règles d'acceptation selon la provenance + délai après les canaux obligatoires

Si `docs/STATUS.md` indique déjà « phase 11 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/REFONTE-UX.md` (règles d'interface et vocabulaire), `docs/STATUS.md`, et le code du flux d'adhésion (`packages/telegram/src/join-flow/`, `apps/web/lib/channels/entry-rule.ts`, page canal « Qui peut entrer et quand »). La phase 10 vient de corriger la création des liens des canaux obligatoires : appuie-toi dessus. Mode autonome, aucune question, décisions dans `docs/DECISIONS-TECH.md`.

## Ce que veut le client (validé le 11 octobre)
- **Feature 1 — délai selon la provenance.** Exemple réel : quand une personne demande à rejoindre « Zone Interdite 🔞 » en venant du bouton « canal obligatoire » de « Tir Cadré » (Tir Cadré exige Zone Interdite), elle est acceptée au bout de **1 jour** ; si elle arrive par n'importe quel autre lien, au bout de **5 minutes**.
- **Feature 2 — délai après les canaux obligatoires.** Aujourd'hui, le choix « après avoir rejoint ces canaux » accepte tout de suite après le clic sur « ✅ J'ai rejoint ». Le client veut régler un délai, qui démarre **au clic sur « ✅ J'ai rejoint »** (choix 2a).
- **Les deux niveaux** (choix 1c) : le délai s'applique au canal principal après les canaux obligatoires, **et** les canaux obligatoires eux-mêmes doivent pouvoir avoir leur propre délai (aujourd'hui leurs liens font entrer directement, sans demande).
- La provenance qui compte en premier pour le client (choix 3b) : **le bouton « canal obligatoire » d'un autre canal** (lien GATE, qui porte déjà `sourceChannelId`).

## 1. Modèle de données (migration additive, rien ne casse)
- `ApprovalRule` : ajouter `scope` (`DEFAULT` | `INVITE_LINK` | `SOURCE_CHANNEL` | `SOURCE_KIND`), `sourceChannelId` (canal d'où vient la personne), `sourceKind` (`GATE` = venu du bouton obligatoire d'un de nos canaux, `ANY_CHANNEL` = venu de n'importe lequel de nos canaux, `AD_ANY`, `AD_TIKTOK`, `AD_META`, `SHARE`), `label` (texte lisible), `sortOrder`, `sendWelcome` (bool, défaut vrai). Garder `inviteLinkId` (règle d'un lien précis). Les règles existantes deviennent `scope = DEFAULT` (ou `INVITE_LINK` si `inviteLinkId`), sans changement de comportement.
- `InviteLink` : nouveau type `SHARE` (lien de partage créé depuis la fiche du canal, avec `sourceChannelId` facultatif et un nom, ex. « Post Tir Cadré ») ; les liens `GATE` créés à partir de maintenant ont `createsJoinRequest = true` (voir section 3).
- `Membership.source` : enregistrer la provenance résolue (`{ type, sourceChannelId, inviteLinkId, label }`) et la règle appliquée (`{ id, scope, label }`).

## 2. Résolution de la règle (fonction pure + tests)
Ordre, du plus précis au plus général : règle du lien précis (`INVITE_LINK`) → règle du canal d'origine (`SOURCE_CHANNEL`, d'après `sourceChannelId` du lien GATE ou SHARE) → règle du type de provenance (`SOURCE_KIND` : GATE, ANY_CHANNEL, AD_TIKTOK / AD_META / AD_ANY selon le lien d'entrée, SHARE) → règle par défaut du canal → aucune règle (validation à la main, comportement actuel). Une personne arrivée par un lien que la plateforme n'a pas créé (Telegram masque la fin de ces liens) suit la règle par défaut. Tests unitaires de chaque cas, y compris l'exemple du client.

## 3. Canaux obligatoires avec leur propre délai (choix 1c)
- Les liens des canaux obligatoires deviennent des liens **avec demande d'adhésion** : le canal obligatoire applique alors sa propre règle, avec la provenance « venu de <canal source> (canal obligatoire) ».
- **Une demande en attente compte comme « rejoint »** : à la vérification de « ✅ J'ai rejoint », un canal obligatoire est satisfait si la personne est membre (`getChatMember`) **ou** a une demande en cours ou planifiée dans ce canal (nos `Membership` REQUESTED / PENDING_GATE / SCHEDULED / APPROVED). Telegram renvoie « left » pour une demande en attente : ne te fie pas qu'à `getChatMember`.
- Le canal d'où vient la personne compte comme déjà satisfait (exigences croisées : Zone Interdite exige Tir Cadré et Tir Cadré exige Zone Interdite ; aucune boucle, aucun blocage). Teste ce cas croisé de bout en bout.
- Messages : une personne venue d'un canal obligatoire reçoit au plus un court message du canal obligatoire (« Ta demande pour <canal> est bien reçue, accès <délai> ») si `sendWelcome` est vrai pour cette provenance ; jamais deux messages d'accueil complets à la suite. Anti-doublon : un même bot n'envoie pas plus d'un message d'accueil à la même personne en 10 minutes.
- Par défaut, une règle de provenance « venu d'un canal obligatoire » n'impose pas d'autres canaux à rejoindre (pas de chaîne infinie) ; l'admin peut en ajouter s'il le veut.
- Les anciens liens GATE (entrée directe) restent valides 7 jours pour les messages déjà envoyés, puis sont révoqués par le worker.

## 4. Délai après « ✅ J'ai rejoint » (feature 2)
- Le choix « après avoir rejoint ces canaux » gagne une ligne « **puis accepter** : tout de suite / 5 min / 1 h / 1 jour / sur mesure ». Le délai démarre au clic sur « ✅ J'ai rejoint » réussi (`approveAtAfterGate`, déjà en place côté moteur : l'interface doit simplement enregistrer `mode` et `delaySeconds` au lieu de les remettre à zéro).
- Le message de confirmation (séquence `GATE_SATISFIED`) annonce le délai réel avec `{delai}` (« tu seras accepté dans 1 jour ») ; « tout de suite » reste immédiat.
- Vérifie que les rappels ne relancent pas une personne qui a déjà cliqué « ✅ J'ai rejoint » et attend juste son délai.

## 5. Interface « Qui peut entrer et quand » (fiche canal)
- En haut, **« Par défaut »** : le réglage actuel (tout de suite / après un délai / après avoir rejoint ces canaux + puis accepter).
- En dessous, **« Exceptions selon la provenance »** : une ligne par exception, en français : « Si la personne vient de [Tir Cadré ▾] → [après 1 jour ▾] ». Le menu de provenance propose : un de nos canaux (liste), le bouton obligatoire d'un de nos canaux, n'importe lequel de nos canaux, une pub TikTok, une pub Meta, n'importe quelle pub, un lien de partage précis. Chaque exception a les mêmes choix que le réglage par défaut (dont canaux obligatoires + délai). Bouton « + Ajouter une exception », glisser pour l'ordre, supprimer.
- Une phrase de résumé sous chaque ligne (« Une personne venue de Tir Cadré sera acceptée 1 jour après sa demande ») et un **simulateur** : « Si quelqu'un vient de [▾], il se passe : … ».
- Section « Liens de partage » de la fiche canal : créer un lien nommé (avec « à poster dans [canal ▾] » facultatif), le copier, voir ses demandes et acceptations, le désactiver.
- Respecte `docs/REFONTE-UX.md` : un bouton principal, le détail dans « Avancé », mots simples, affichage téléphone.

## 6. Suivi
- Liste des demandes et fiche membre : « Venu de Tir Cadré · règle : 1 jour · acceptation prévue le … ».
- Statistiques du canal : demandes, acceptés, départs à 7 jours, par provenance.
- Journal : création, modification, suppression d'exception.

## 7. Tests et livraison
- Tests unitaires : résolution des règles, délai après le gate, demande en attente comptée comme rejointe, exigences croisées, anti-doublon de messages.
- Tests d'intégration simulés (mises à jour Telegram) : le scénario exact du client (Tir Cadré exige Zone Interdite ; Zone Interdite exige Zone Roulette et Tir Cadré ; venu de Tir Cadré → 1 jour ; autre lien → 5 min) de la demande jusqu'à l'acceptation.
- `pnpm lint && pnpm build && pnpm test` verts, migration appliquée, déploiement vérifié, captures 1440 / 390 de la fiche canal, `docs/STATUS.md` et guide (section Canaux) à jour, commit et push.
- Bilan Telegram en 5 lignes : ce qui est en ligne et comment régler l'exemple « Tir Cadré → 1 jour » en 3 clics. Puis `docs/PHASE-DONE`.
