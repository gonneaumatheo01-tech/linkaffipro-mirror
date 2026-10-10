# Guide d'utilisation de LinkAffi Pro

Ce guide s'adresse à toute l'équipe, sans connaissance technique. Il décrit le site tel qu'il est aujourd'hui, menu par menu, avec les noms exacts des boutons et des champs. Il est aussi lisible dans le site, menu **Aide**.

Adresse du site : https://app.linkaffipro.com. Adresse des liens traqués : https://go.goolink.eu.

## Table des matières

- [Les 10 premières minutes](#les-10-premieres-minutes)
- [Comment ça marche](#comment-ca-marche)
- [Tableau de bord](#tableau-de-bord)
- [Campagnes](#campagnes)
- [Canaux](#canaux)
- [Bots](#bots)
- [Membres](#membres)
- [Messages](#messages)
- [Liens](#liens)
- [Envois](#envois)
- [Automatisations](#automatisations)
- [Journal](#journal)
- [Réglages](#reglages)
  - [Utilisateurs et invitations](#utilisateurs-et-invitations)
  - [Connecteurs (Link Affi)](#connecteurs-link-affi)
  - [IA](#ia)
  - [Postbacks](#postbacks)
  - [Alertes et rétention](#alertes-et-retention)
  - [Rapports automatiques](#rapports-automatiques)
  - [Catégories de messages](#categories-de-messages)
  - [État du système](#etat-du-systeme)
  - [Sauvegardes](#sauvegardes)
- [Aide](#aide)
- [Mon compte](#mon-compte)
- [Compléments : équipe, étiquettes, horaires, tests A/B, modèles, alertes, périodes](#complements-equipe-etiquettes-horaires-tests-a-b-modeles-alertes-periodes)
- [Que faire si…](#que-faire-si)
- [Règles à respecter](#regles-a-respecter)
- [Petit lexique](#petit-lexique)

## Les 10 premières minutes

### 1. Se connecter

1. Ouvrez https://app.linkaffipro.com.
2. Saisissez votre **E-mail** et votre **Mot de passe**, puis cliquez sur **Se connecter**.
3. Le menu de gauche liste toutes les pages. Votre prénom, en haut à droite, ouvre **Mon compte** et **Déconnexion**.

Il n'y a pas d'inscription libre : un administrateur doit vous inviter (voir [Utilisateurs et invitations](#utilisateurs-et-invitations)). Après 10 mots de passe faux en 15 minutes, la connexion est bloquée 15 minutes : attendez, puis réessayez.

### 2. Vérifier les bots

1. Menu **Bots**.
2. Chaque ligne est un bot Telegram (un par univers : Casino, Paris sportifs, Dating). Vérifiez que le **Statut** est « actif » et que la colonne **Webhook** affiche « ok ».
3. Si la colonne affiche « à vérifier », cliquez sur **Re-synchroniser le webhook** et rechargez la page.

Le webhook est le « fil » qui relie Telegram au site : sans lui, le bot ne voit plus rien.

### 3. Créer un canal et le relier à un bot

Un canal n'est pas créé depuis le site : il est détecté dès qu'un de nos bots en devient administrateur.

1. Dans Telegram, ouvrez votre canal → Administrateurs → Ajouter un administrateur → choisissez le bot de l'univers (par exemple @casinogamblingoobot) → cochez au minimum le droit « Ajouter des membres » (indispensable pour traiter les demandes d'adhésion) → validez.
2. Menu **Canaux** : le canal apparaît en quelques secondes (si le bot était déjà administrateur avant, utilisez **Ajouter un canal existant** : voir [Canaux](#canaux)). Sur sa ligne, choisissez l'**Univers**, la **Langue**, le **Bot principal**, cochez **Actif** (et **TEST** s'il s'agit d'un canal d'essai), puis cliquez sur **Enregistrer**.
3. Cliquez sur le nom du canal. Onglet **Règles d'adhésion** : choisissez le **Mode** (Immédiat, Après un délai ou Validation manuelle), le **Délai avant acceptation**, cochez éventuellement les **Canaux à rejoindre d'abord**, puis **Enregistrer la règle**.
4. Onglet **Messages du bot** : relisez le texte « Accueil (à la demande d'adhésion) ». Cliquez sur **Modifier**, adaptez le texte, **Enregistrer**, puis **Envoyer un test** pour le recevoir sur votre propre Telegram (il faut d'abord lier votre Telegram dans **Mon compte**).

### 4. Créer votre première campagne (et ses liens de pub)

1. Menu **Campagnes** → **Nouvelle campagne**.
2. Suivez les 4 étapes : **Nom et univers**, **Offres** (cochez votre offre Link Affi), **Canaux** (cochez le canal), **Pubs** (plateforme, nombre de pubs, **Canal d'entrée des pubs**), puis **Créer la campagne**.
3. Fiche de la campagne → onglet **Liens** : copiez la colonne **Adresse à coller dans la pub** et collez-la comme lien de destination dans TikTok Ads Manager ou Meta Ads Manager (une adresse par pub).

Derrière chaque lien goolink, le site a créé automatiquement un lien d'invitation Telegram « avec demande d'adhésion » propre à cette pub : c'est lui qui permet de savoir de quelle pub vient chaque membre. Le menu **Liens** permet aussi de créer des liens hors campagne (bloc **Nouveau lien d'entrée (pub)**).

### 5. Programmer un premier message

1. Menu **Messages** → **Nouveau message**.
2. Cochez le ou les canaux, écrivez le texte, ajoutez si besoin un média et un bouton **Offre (campagne)** (choisissez votre campagne : chaque membre reçoit son lien casino personnel, traqué par sub-ID).
3. Dans **Programmation**, choisissez **Date et heure (Paris)** et une **Catégorie**, puis cliquez sur **Programmer**.
4. Le message apparaît dans le **Calendrier**. Il partira tout seul à l'heure dite.

## Comment ça marche

Voici le fil complet d'un membre, de la pub jusqu'aux statistiques.

1. **La pub.** Une vidéo TikTok ou Meta renvoie vers un lien goolink (`https://go.goolink.eu/...`) créé dans le menu **Liens**.
2. **Le lien goolink.** Il compte le clic (sans page visible, les robots connus sont ignorés) puis redirige instantanément vers le lien d'invitation Telegram propre à cette pub.
3. **La demande d'adhésion.** Le lien d'invitation est de type « demande d'adhésion » : la personne demande à rejoindre le canal, elle n'y entre pas encore.
4. **Le bot en privé.** Dès la demande, le bot du canal lui écrit en privé le message « Accueil » (onglet **Messages du bot** du canal). Si la règle d'adhésion prévoit des canaux à rejoindre d'abord, le message contient un bouton par canal et un bouton « ✅ J'ai rejoint ».
5. **L'acceptation.** Selon la règle du canal, la demande est acceptée tout de suite, après un délai, après « ✅ J'ai rejoint », ou à la main dans l'onglet **Demandes**. Le bot envoie alors le message « Accepté dans le canal ».
6. **Les messages du canal.** Les messages programmés dans le menu **Messages** partent à l'heure dite dans le canal, avec leurs boutons.
7. **Le bouton « Offre ».** Quand un membre appuie sur un bouton de type Offre, le bot lui répond en privé avec un lien personnel : le lien Link Affi de la campagne, complété d'un identifiant de suivi (sub-ID) unique pour ce membre et ce message.
8. **Chez le casino.** Le membre s'inscrit, puis fait un premier dépôt (FTD, « first time deposit »). Link Affi transmet l'identifiant de suivi au casino, qui le renvoie dans ses postbacks (les messages automatiques « inscription », « dépôt » envoyés par le casino).
9. **La remontée.** Toutes les 2 minutes, le site lit l'API de Link Affi (en lecture seule) et récupère clics, joueurs et dépôts avec leur sub-ID. Pour un programme hors Link Affi, le casino peut appeler directement une adresse de postback du site (**Réglages → Postbacks**).
10. **Les statistiques.** Grâce au sub-ID, chaque inscription et chaque dépôt est rattaché au membre, au message, au canal et à la pub d'origine. C'est ce qui alimente le **Tableau de bord**, la page **Campagnes**, la fiche de chaque message et la fiche de chaque membre.

Deux limites à connaître : les liens courts et les pages d'atterrissage (landing pages) de Link Affi ne portent pas de sub-ID, il ne faut donc jamais les utiliser dans un bouton Offre ; et le nombre de vues d'un message n'est pas encore remonté.

## Tableau de bord

**À quoi ça sert.** Voir en un coup d'œil l'activité et l'argent rapporté par **vos** joueurs. En haut : bots actifs, canaux actifs, membres vus et nombre de campagnes. Puis les chiffres de la période en deux lignes :
- **Telegram** : demandes → acceptés → entrées → départs ;
- **Argent** : clics pub → clics offre → inscriptions → premiers dépôts (FTD) → dépôts (€) → NGR (€).

Cinq onglets : **Vue d'ensemble**, **Campagnes**, **Entonnoir**, **Cohortes**, **Canaux**.

**Ce qui est compté.** Seuls vos joueurs comptent : ceux venus d'un de vos clics (identifiant de suivi, sub-ID) ou d'une offre Link Affi rattachée à une de vos campagnes. Les autres joueurs de Link Affi n'apparaissent que dans Réglages → Connecteurs (carte « Diagnostic Link Affi »). Toutes les dates sont celles de Link Affi (inscription, premier dépôt, dépôt, variation du NGR), jamais la date d'import : 7, 30 et 90 jours donnent donc des chiffres différents. Tant qu'aucune campagne n'existe, la page affiche « Pas encore de chiffres : créez votre première campagne » avec le bouton **Nouvelle campagne**.

**Comment faire.**

1. En haut à droite, choisissez **Tous les univers**, **Tous les canaux** et **Toutes les campagnes** (le menu Campagne recharge la page aussitôt), puis cliquez sur **Appliquer**. Les filtres restent quand vous changez d'onglet, de période ou que vous exportez. Avec le filtre Campagne, demandes, acceptés, entrées et départs ne comptent que les personnes arrivées par les liens d'entrée de la campagne (ses pubs), comme sur sa fiche. Avec le filtre canal, l'argent est celui des joueurs qui ont cliqué une offre dans un message de ce canal, ou dont le membre y est arrivé par une pub ; un joueur sans clic n'est rattaché à aucun canal (il reste compté dans le total, l'univers et sa campagne).
2. Choisissez la période (aujourd'hui, hier, 7 jours, 30 jours, 90 jours, mois en cours ou personnalisée) et, si vous voulez, **comparer à la période précédente**.
3. Onglet **Campagnes** : une ligne par campagne (dépense, membres, inscriptions, FTD, CPL, CPA, ROAS), avec la ligne Total. Cliquez sur un en-tête pour trier, sur **Exporter CSV** pour télécharger, sur **Recalculer les statistiques** si les chiffres semblent en retard.
4. Onglet **Entonnoir** : chaque étape (clics → demandes → acceptés → clics d'offres → inscriptions → FTD) avec la perte à chaque marche ; il s'ouvre sur le filtre posé en haut, et le menu **Afficher l'entonnoir pour** permet de regarder une seule campagne, un seul canal ou un seul univers.
5. Onglet **Cohortes** : les membres regroupés par semaine d'arrivée sur la période choisie, avec leurs inscriptions, FTD et la LTV (somme des variations de NGR datées).
6. Onglet **Canaux** : croissance nette par jour (entrées moins départs), meilleurs horaires d'envoi et meilleures catégories de messages.
7. En bas de la Vue d'ensemble, **Derniers événements** (en français) ; le lien **Journal (onglet « Événements »)** ouvre la liste complète.

**Pièges et questions fréquentes.**

- Les onglets Campagnes, Entonnoir et Cohortes sont recalculés une fois par heure. Un message envoyé il y a 5 minutes n'y figure pas encore : attendez ou cliquez sur **Recalculer les statistiques**.
- La Vue d'ensemble est mise en cache une minute : rechargez après 60 secondes pour voir un changement.
- La ligne Total de l'onglet Campagnes compte chaque joueur une seule fois, même quand deux campagnes partagent la même offre Link Affi (le joueur apparaît alors dans les deux lignes). « Chiffres calculés le … » donne l'heure du dernier calcul, même si aucun chiffre n'a changé.
- Les joueurs inscrits depuis un ancien bouton **Offre** (créé avant les campagnes) comptent dans chaque campagne qui porte cette offre, comme leurs clics.
- Le nombre d'événements des 24 dernières heures n'est plus sur le tableau de bord : il est dans Réglages → **État du système** (carte « Activité des bots (24 h) ») et dans le **Journal** (vue « Événements »).
- Les dépenses (CPL, CPA, ROAS) viennent des coûts importés, saisis ou synchronisés dans **Campagnes** (onglet Pubs) : sans coûts, ces colonnes restent vides.

## Campagnes

**À quoi ça sert.** Une **campagne** réunit ce que vous promouvez (une ou plusieurs offres Link Affi), où (vos canaux Telegram) et avec quelles pubs (TikTok, Meta, autre). La liste montre ce que coûte et rapporte chacune : dépense, membres, inscriptions, FTD, revenu (NGR de la période), CPL, CPA, coût par FTD et ROAS. Vocabulaire : « campagne » = la vôtre sur la plateforme ; « campagne pub » = la campagne côté TikTok ou Meta.

**Comment faire.**

1. Menu **Campagnes** → **Nouvelle campagne** : un assistant en 4 étapes.
   - **Nom et univers** : **Nom de la campagne**, **Univers**, **Budget par jour (€, facultatif)**, **Début** / **Fin** (facultatifs), **Notes**.
   - **Offres** : cochez vos offres Link Affi (mention « à vous »), ou **Coller un lien d'offre Link Affi** (la clé doit être entière, par exemple `47eb8mwc`). La case **Afficher les offres des autres affiliés** montre les autres. Tant qu'aucun clic n'a eu lieu, toutes les offres sont affichées avec un avertissement : vérifiez l'affilié avant de cocher.
   - **Canaux** : cochez les canaux de la campagne.
   - **Pubs** : **Plateforme des pubs** (ou « — aucune pub pour l'instant — »), **Nombre de pubs (0 à 20)**, **Compte pub connecté**, **Campagne pub déjà importée de ce compte** (reprend ses groupes, pubs et dépenses), **Canal d'entrée des pubs**. Dans le **Récapitulatif**, vous pouvez modifier le nom ou cliquer **Proposer un nom conventionnel**. Terminez par **Créer la campagne** (un seul clic suffit, le bouton affiche « Création en cours… »).
2. La fiche de la campagne s'ouvre, avec ses onglets :
   - **Vue d'ensemble** : les chiffres de la période, **Modifier la campagne** (y compris le **Compte pub connecté**), et pour les administrateurs **Supprimer la campagne**.
   - **Pubs** : groupes et pubs précises, saisie d'une dépense (date du jour à l'heure de Paris), carte **Rattacher une campagne pub importée** ; administrateurs : **Supprimer** sur chaque groupe et chaque pub. Dans la colonne **Rattacher**, « — détacher — » retire le lien d'une pub de la campagne.
   - **Liens** : un lien d'entrée par pub, colonne **Adresse à coller dans la pub** (c'est l'adresse go.goolink.eu à mettre dans TikTok ou Meta), clics, demandes, acceptés ; **Ajouter un lien d'entrée** (canal à rejoindre, plateforme, nom de la pub précise, groupe).
   - **Canaux**, **Messages**, **Membres** : ce qui appartient à la campagne.
   - **Offres** : les offres Link Affi de la campagne, colonne **Affilié**.
3. Coûts : ils arrivent seuls si le compte pub est connecté (Réglages → Connecteurs → Meta / TikTok). Sinon, **Importer un CSV** (TikTok Ads Manager ou Meta Ads Manager, colonnes détectées, aperçu, correspondances, **Importer N ligne(s)**) ou saisie dans l'onglet Pubs. **Historique des imports** liste les fichiers importés.
4. Dans **Messages** et **Envois**, le bouton **Offre (campagne)** se règle en choisissant une campagne (groupe « Nos campagnes »), puis l'offre si la campagne en a plusieurs : chaque clic est alors rattaché à la campagne.

**Pièges et questions fréquentes.**

- La ligne **Total** compte chaque joueur une seule fois, même quand deux campagnes partagent la même offre : elle n'est donc pas la somme des lignes. L'export CSV contient aussi la ligne « Total (joueurs distincts) ».
- Après une modification d'offres, de canaux, de liens ou de pubs, les statistiques se recalculent seules (environ une minute).
- Une campagne pub reçue d'un compte Meta ou TikTok sans campagne correspondante porte le badge « importée de TikTok/Meta » : rattachez-la depuis l'onglet **Pubs** d'une de vos campagnes. Si votre campagne a le même nom et le même compte connecté, la synchro la reprend toute seule. Le nom de vos campagnes n'est jamais remplacé par celui de la plateforme.
- Changer le **Compte pub connecté** détache la campagne pub suivie (l'historique des coûts reste).
- Supprimer une campagne supprime ses groupes, pubs et coûts ; les liens et boutons restent actifs (page Liens), les membres et joueurs sont conservés.
- Si une offre est retirée d'une campagne, les boutons déjà publiés envoient vers une autre offre active de la campagne. Un ancien bouton sans campagne affiche « Ancien bouton sans campagne : choisissez la campagne pour le rattacher. »
- Le « Revenu » est le NGR remonté par Link Affi : il arrive avec un décalage, le ROAS des derniers jours est donc toujours sous-estimé.
- Une saisie manuelle pour un jour et un niveau remplace la précédente (pas d'addition) ; un import CSV se refait sans doublon pour les mêmes jours. Si la campagne reçoit déjà ses coûts par l'API, les lignes du CSV sont ignorées.

## Canaux

**À quoi ça sert.** Gérer chaque canal ou groupe Telegram où un de nos bots est administrateur : univers, langue, bot principal, règle d'adhésion (quand et comment accepter les demandes), canaux à rejoindre d'abord, demandes en attente, liste des membres et textes envoyés par le bot en privé.

**Comment faire.**

1. Ajoutez le bot comme administrateur du canal dans Telegram (voir [Les 10 premières minutes](#3-creer-un-canal-et-le-relier-a-un-bot)). Le canal apparaît seul dans la liste dès que le bot reçoit quelque chose du canal (une publication, une demande d'adhésion, une réaction).
   - **Le bot était déjà administrateur mais le canal n'apparaît pas ?** Cliquez sur **Ajouter un canal existant**. Trois méthodes, de la plus simple à la plus manuelle :
     1. **Transférer un message du canal à l'un des bots** (marche aussi pour les canaux privés) : dans Telegram, appui long sur un message du canal → **Transférer** → choisissez le bot. Le bot répond « Canal « … » ajouté ✅ (bots administrateurs : …) ». Seuls les comptes liés dans **Mon compte → Lier mon Telegram** sont acceptés. Si vous transférez plusieurs messages d'un coup, le bot ne répond qu'une fois.
     2. **Coller le lien public du canal** : champ **Lien ou @nom** (`t.me/mon_canal`, `t.me/s/mon_canal` ou `@mon_canal`), bouton **Ajouter** (affiche « Vérification… »). Le résultat s'affiche dans la fenêtre. Un lien `t.me/c/…` ou `t.me/+…` est un lien privé : utilisez la méthode 1. Vous pouvez aussi envoyer au bot, dans Telegram, un message qui contient seulement le lien public (ou le @nom) : un lien glissé dans une phrase n'ajoute rien.
     3. **Publier un message dans le canal** (par exemple « . »), puis le supprimer. Le bot doit déjà être administrateur du canal, sinon Telegram ne lui montre pas les publications.
     Tant que la fenêtre est ouverte, la liste se rafraîchit seule pendant 2 minutes et annonce « Canal « … » détecté ✅ ».
   - **Importer tous mes canaux** (bouton visible quand le compte Telegram est connecté dans Réglages → Connecteurs → Telegram) : la page liste les canaux dont votre compte est administrateur ; cochez-les puis **Importer les canaux cochés**. Résultat du type « 12 canaux importés, 3 sans bot » (et la liste des canaux non importés, s'il y en a). « N non vérifiables pour le moment » : ces canaux sont importés, seuls les droits restent à confirmer avec **Re-vérifier les droits des bots** une minute plus tard. « Service momentanément indisponible, réessayez dans une minute. » : réessayez un peu plus tard, rien n'est perdu.
   - **Re-vérifier les droits des bots** : relit les administrateurs de chaque canal avec chacun de nos bots et met à jour la colonne **Bots administrateurs**. Un bot n'est retiré que si Telegram confirme qu'il n'est plus administrateur ; si Telegram ne répond pas, la ligne indique « non vérifiable pour le moment (droits conservés, réessayez dans une minute) ».
2. Sur la ligne du canal : **Univers**, **Langue**, **Bot principal**, cases **TEST** / **Médiathèque** / **Actif**, puis **Enregistrer**. Cochez **Médiathèque** pour un canal privé qui sert seulement à stocker des médias. Cochez **TEST** pour un canal d'essai : les envois de vérification y sont limités.
3. Cliquez sur le nom du canal pour ouvrir ses quatre onglets.
4. Onglet **Règles d'adhésion** :
   - **Mode** : Immédiat (accepté tout de suite), Après un délai, ou Validation manuelle (quelqu'un clique **Accepter maintenant** dans l'onglet Demandes).
   - **Délai avant acceptation** : immédiat, 1 minute, 10 minutes, 1 heure, 1 jour, 2 jours ou personnalisé (en secondes).
   - **Canaux à rejoindre d'abord** : cochez les autres canaux que le membre doit rejoindre avant d'être accepté, et choisissez l'**Exigence** : Obligatoire (accepté seulement après « ✅ J'ai rejoint »), Proposé (accepté après le délai dans tous les cas) ou Aucun.
   - **Rappels (minutes après la demande)** : par exemple `60, 1440` pour un rappel après 1 heure puis après 1 jour, limité par **Nombre maximal de rappels**.
   - **Expiration (heures, 0 = jamais)** et **À l'expiration** : Laisser en attente, Accepter quand même ou Refuser.
   - Case **Envoyer un message « accepté » au membre**, puis **Enregistrer la règle**.
5. Onglet **Demandes** : les demandes en cours avec leur statut (à valider, canaux à rejoindre, planifiée, échec), leur source (nom du lien de pub) et l'heure d'acceptation prévue. Boutons **Accepter maintenant** et **Refuser**. Rechargez la page pour actualiser.
6. Onglet **Membres** : les membres acceptés, partis ou exclus, avec leur source et leurs dates. Cliquez sur un nom pour ouvrir sa fiche.
7. Onglet **Messages du bot** : les cinq textes envoyés en privé par le bot, un bloc par moment :
   - **Accueil (à la demande d'adhésion)** ;
   - **Rappel (canaux pas encore rejoints)** ;
   - **Canaux rejoints (accès planifié)** ;
   - **Accepté dans le canal** ;
   - **Réponse à un clic sur une offre**.
8. Pour chaque bloc : **Modifier** ouvre le texte, **Enregistrer** le sauvegarde, **Envoyer un test** vous l'envoie sur votre Telegram, **Désactiver** / **Activer** coupe ou remet ce message. **Ajouter une langue** crée une version pour les membres dont Telegram est dans cette langue (le français reste obligatoire et sert par défaut). **Média joint** ajoute une photo, une vidéo, un gif ou un document.

**Pièges et questions fréquentes.**

- Le bot n'a pas le droit « Ajouter des membres » : les demandes ne peuvent pas être traitées. Un encadré rouge le signale en haut de la page du canal.
- Les mots magiques `{prenom}`, `{canal}`, `{liste_canaux}`, `{delai}` et `{bot}` sont remplacés automatiquement dans les textes du bot. Mise en forme possible : `<b>gras</b>`, `<i>italique</i>`, `<a href="…">lien</a>`.
- Les rappels ne partent que si le membre a accepté de recevoir les messages du bot (il a appuyé sur Démarrer ou répondu une fois). Sinon Telegram interdit l'envoi.
- Un membre reste « canaux à rejoindre » tant qu'il n'a pas appuyé sur « ✅ J'ai rejoint » et qu'il manque un canal. Si vous cochez un canal à rejoindre dont aucun bot n'est administrateur, la vérification est impossible.
- Un lien de pub peut avoir sa propre règle (voir [Liens](#liens)) : elle remplace la règle par défaut du canal pour les membres venus de ce lien.
- **Envoyer un test** est grisé tant que votre Telegram n'est pas lié dans **Mon compte**.
- **Canal sans règle d'adhésion** (par exemple un canal détecté automatiquement) : les demandes attendent votre validation (onglet **Demandes** → **Accepter maintenant**) et le bot n'écrit à personne de lui-même (quand vous acceptez une demande, le membre reçoit le message « accepté »). Enregistrez une règle pour automatiser l'accueil. Le bot principal est choisi automatiquement à la détection (bot du même univers en priorité) ; vous pouvez le changer sur la ligne du canal.
- Case **Actif** décochée : le bot n'accepte plus les demandes (même celles déjà planifiées), n'envoie plus ni accueil ni rappel et ne suit plus les entrées et départs de ce canal.
- Le bot répond « Vérification impossible pour le moment, réessayez dans une minute. » : le canal est bien enregistré ; cliquez plus tard sur **Re-vérifier les droits des bots** (ou transférez de nouveau un message). S'il dit qu'aucun bot n'est administrateur : ajoutez-le (Canal → Administrateurs → Ajouter un administrateur → @bot), puis transférez de nouveau un message (quelques secondes plus tard suffisent).
- Si le canal interdit le transfert (contenu protégé) : méthode 3 (publier puis supprimer un message) ou méthode 2 (lien public).
- « Le compte Telegram connecté est déjà utilisé (relevé des vues ou import en cours) : réessayez dans une minute. » : l'import et le relevé des vues ne peuvent pas utiliser le compte en même temps.

## Bots

**À quoi ça sert.** Voir l'état de chaque bot Telegram (un par univers), vérifier le webhook, et en ajouter un nouveau. Le jeton du bot (sa clé secrète donnée par @BotFather) est chiffré en base.

**Comment faire.**

1. Le tableau affiche pour chaque bot : **Univers**, **Statut** (actif / inactif), **Webhook** (ok / à vérifier, avec la dernière erreur Telegram), **Canaux admin**, **Membres**, **Dernière update** (dernier signe de vie).
2. Si le webhook est « à vérifier » : **Re-synchroniser le webhook**, puis rechargez.
3. Ajouter un bot (administrateurs seulement) : dans Telegram, ouvrez @BotFather, créez un bot (`/newbot`), copiez le jeton. Dans le bloc **Ajouter un bot**, collez-le dans **Jeton du bot**, choisissez l'**Univers**, cliquez sur **Ajouter le bot**. Le site vérifie le bot, chiffre le jeton et pose le webhook.
4. **Désactiver** (administrateurs) met un bot en pause : il ne traite plus rien. **Activer** le remet en service.

**Pièges et questions fréquentes.**

- Un jeton collé dans un message Telegram, un e-mail ou un document est un jeton à changer : ne le partagez jamais. Si cela arrive, régénérez-le dans @BotFather (`/revoke`) et ajoutez de nouveau le bot.
- « update(s) en attente » qui augmente : Telegram n'arrive pas à joindre le site. Vérifiez **Réglages → État du système**.
- Un bot inactif ne reçoit plus les demandes d'adhésion de ses canaux : les membres restent bloqués dehors.
- Ne mélangez pas les univers : un bot « Casino » dans un canal « Dating » envoie les textes du mauvais univers.

## Membres

**À quoi ça sert.** Retrouver toute personne vue par nos bots : d'où elle vient (pub, lien, canal), ce qu'elle a fait (demandes, clics, inscriptions, dépôts), si le bot peut lui écrire, son niveau de dépense, et des notes internes. C'est aussi là qu'un membre est supprimé à sa demande.

**Comment faire.**

1. Filtres en haut : **Prénom, @pseudo ou identifiant**, canal, statut, source (lien de pub), campagne, niveau (Aucun, Inscrit, Déposant, Régulier, VIP), **Langue**, dates d'arrivée. Cliquez sur **Filtrer** ; **Réinitialiser** efface tout. Tri par dernier événement, arrivée ou nom.
2. **Exporter en CSV** télécharge la liste filtrée (pour un tableur).
   **Exporter les joueurs (CSV)** télécharge vos joueurs (seulement les vôtres, filtrés par campagne si le filtre est posé), avec les colonnes « NGR total (€) » et « NGR de la période (€) » (30 derniers jours).
3. Cliquez sur un nom pour ouvrir la fiche :
   - **Origine** : première demande, lien d'entrée, pub, campagne d'affiliation.
   - **Messages privés** : pour chaque bot, « joignable », « bloqué » ou « non joignable ».
   - **Dépenses** : joueurs rattachés, dépôts, NGR (revenu net généré), clics humains.
   - **Chronologie** : tout l'historique daté (adhésions, messages reçus, clics, événements joueur).
   - **Joueurs rattachés** : programme, **Sub-ID** et sa source (« postback » = reçu du casino, « time_match » = rattaché par rapprochement horaire, moins sûr), FTD, dépôts.
   - **Notes internes** : **Ajouter** une note ; chacun supprime les siennes, un administrateur toutes.
4. Supprimer un membre (administrateurs) : bloc **Supprimer ce membre**, tapez `SUPPRIMER`, cliquez sur **Supprimer**. L'identité est effacée, les notes supprimées, l'historique conservé sans nom (anonymisation). C'est irréversible.

**Pièges et questions fréquentes.**

- « non joignable » : le membre n'a jamais parlé au bot en privé. Telegram interdit au bot de lui écrire le premier. « bloqué » : il a bloqué le bot.
- Un membre sans joueur rattaché n'a simplement pas encore cliqué sur une offre puis fait une inscription : ce n'est pas une erreur.
- Les niveaux de dépense se règlent dans **Réglages → Connecteurs** (seuil VIP et nombre de dépôts pour « Régulier »).
- L'export CSV contient des données personnelles : ne le laissez pas traîner, supprimez-le après usage.
- Les membres inactifs depuis plus de 24 mois sont anonymisés automatiquement chaque nuit (réglable dans **Réglages → Alertes**).

## Messages

**À quoi ça sert.** Écrire et programmer les messages publiés dans les canaux (texte mis en forme, médias, boutons), des jours ou des semaines à l'avance ; garder des modèles ; suivre les clics, réactions, inscriptions et dépôts de chaque message ; comparer les catégories.

**Comment faire.**

1. Trois vues : **Calendrier** (semaine par semaine, boutons **← Semaine précédente**, **Semaine suivante →**, **Aujourd'hui**, et à droite la liste **Toutes les campagnes** + **Filtrer** pour ne voir que les messages d'une campagne), **Liste** (filtres par canal, statut, catégorie, campagne, dates ; **Exporter CSV** respecte les filtres) et **Modèles**. Le filtre Campagne reste actif quand vous changez de semaine ou de vue.
2. **Nouveau message** :
   - Cochez les canaux destinataires (un message par canal sera créé).
   - **Texte** : écrivez, utilisez les boutons Gras, Italique, Souligné, Barré, Spoiler. Limite : 4096 caractères, 1024 avec un média.
   - **Médias** : **choisissez des fichiers** (image, vidéo, gif ou document, 50 Mo maximum). Plusieurs fichiers forment un album.
   - **Boutons** : pour chaque bouton, un **Libellé** et un type : **Lien direct** (une URL simple, clics non comptés), **Lien traqué** (clics comptés, anonymes) ou **Offre (campagne)** (choisissez une de vos campagnes, puis l'offre si elle en a plusieurs : chaque membre qui appuie reçoit en privé son lien personnel avec identifiant de suivi, et le clic est rattaché à la campagne). Vous pouvez mettre plusieurs boutons par ligne et plusieurs lignes.
   - **Programmation** : **Date et heure (Paris)**, **Catégorie** (vos catégories ; **+ Nouvelle catégorie** pour en créer une sans quitter la page), **Langue**, puis les options **Épingler après envoi**, **Désépingler le précédent**, **Silencieux (sans notification)**, **Contenu protégé (pas de transfert)**, **Sans aperçu de lien**, **Supprimer après … minutes**.
   - Terminez par **Programmer**, **Enregistrer en brouillon** ou **Enregistrer comme modèle** (donnez un **Nom du modèle**).
3. Ouvrir un message (bouton **Ouvrir** dans la liste, ou clic dans le calendrier) : bloc **Chiffres** (Clics, Clics uniques, Clics offres, Réactions, Inscriptions, FTD, Dépôts, Montant déposé), tableau **Boutons** avec les clics par bouton, bloc **Actions** : **Décaler (min)**, **Annuler l'envoi** (message programmé), **Supprimer sur Telegram** (message envoyé), **Enregistrer comme modèle**, **Retirer le brouillon**. En haut : **Modifier** (tant qu'il n'est pas parti) et **Dupliquer**.
4. Vue **Modèles** : filtres **Tous les univers** et **Tous les thèmes** (Bonus, Preuve de gains, Teasing, Rappel, Information, Événement, Sondage), puis **Filtrer** ; **Utiliser ce modèle** pré-remplit un nouveau message. Les thèmes des modèles fournis ne sont pas des catégories : ils ne comptent pas dans « Comparer par catégorie ».
5. **Comparer par catégorie** (en haut de la page) : totaux et moyennes par message pour chaque catégorie sur 7, 30 ou 90 jours. Sans catégorie, la page propose « Créez votre première catégorie (par exemple Bonus ou Rappel) pour comparer vos messages » ; les messages envoyés sans catégorie sont comptés dans la ligne « Sans catégorie ».

**Pièges et questions fréquentes.**

- Statuts : Brouillon, Programmé, Envoi en cours, Envoyé, Échec, Supprimé, Annulé. Un message en **Échec** affiche l'erreur Telegram en haut de sa fiche (souvent : le bot n'est plus administrateur, ou le média est trop lourd).
- Un message **Envoyé** ne se modifie plus : dupliquez-le, ou supprimez-le sur Telegram et programmez-en un nouveau.
- Les heures sont toujours en heure de Paris.
- Les boutons d'un album partent dans un second message juste après (limite Telegram).
- Pour un bouton **Offre (campagne)**, choisissez toujours une campagne dans la liste : ne collez jamais un lien court ou une landing page Link Affi en **Lien direct**, le sub-ID serait perdu.
- Les inscriptions, FTD et dépôts d'un message n'apparaissent qu'après la remontée Link Affi (2 minutes) et peuvent évoluer pendant des semaines.

## Liens

**À quoi ça sert.** Créer et suivre tous les liens traqués `go.goolink.eu` : les liens d'entrée des pubs (un par pub, avec son lien d'invitation Telegram), les offres personnalisées créées par les boutons des messages, et les liens génériques (n'importe quelle adresse dont vous voulez compter les clics).

**Comment faire.**

1. Bloc **Nouveau lien d'entrée (pub)** : **Canal**, **Nom(s) de lien** (une ligne par lien pour en créer plusieurs d'un coup), **Plateforme** (TikTok, Meta (Facebook / Instagram), Autre), **Langue**, puis facultatif : **Campagne**, **Groupe**, **Pub** (les noms utilisés dans TikTok / Meta, pour rapprocher les coûts) et **Règle d'adhésion (optionnel)** (sinon la règle par défaut du canal). Cliquez sur **Créer le(s) lien(s)**.
2. Tableau **Entrées par pub** : copiez **URL à coller dans la pub** (elle contient déjà les paramètres de suivi de la plateforme). Les colonnes donnent clics, uniques, demandes, acceptés, inscrits et FTD venus de ce lien.
3. Bloc **Nouveau lien générique** : **Nom**, **URL de destination**, **Créer le lien**. Le lien goolink à partager s'affiche dans le tableau **Boutons et liens génériques**.
4. Tableau **Offres personnalisées** : créé automatiquement pour chaque bouton Offre d'un message, avec clics, membres, inscrits et FTD.
5. **Désactiver** coupe un lien (il ne redirige plus) ; **Réactiver** le remet en service.

**Pièges et questions fréquentes.**

- Un lien d'entrée ne peut être créé que si un bot est administrateur du canal (c'est lui qui crée le lien d'invitation Telegram).
- Ne modifiez pas l'URL copiée : les parties entre accolades sont remplacées par TikTok / Meta au moment du clic.
- Un même lien dans deux pubs différentes mélange leurs résultats : créez un lien par pub (une ligne par nom).
- Le compteur « Clics » exclut les robots connus ; « Uniques » compte les appareils distincts.
- Un lien désactivé renvoie les visiteurs vers l'écran de connexion du site : désactivez-le seulement quand la pub est arrêtée.

## Envois

**À quoi ça sert.** Envoyer un même message privé à un groupe de membres choisi (segment) par un bot : relance, bonus, annonce. Avec test à soi-même, programmation, suivi de la progression, et test A/B (deux versions comparées).

**Comment faire.**

1. **Nouvel envoi**. Bloc **Envoi** : **Nom interne** et **Bot expéditeur**.
2. Bloc **Destinataires (segment)** : sans filtre, tous les membres qui peuvent recevoir un message privé de ce bot. Les filtres se cumulent : **Canaux**, **Statut d'adhésion**, **Niveau de dépense**, **Lien d'entrée (pub)**, **Campagne**, **A cliqué un message de la catégorie**, **Langues (fr, en…)**, **Inactifs depuis (jours)**, **Étiquettes**. Cliquez sur **Compter les destinataires** pour connaître la taille du segment avant d'envoyer.
3. Bloc **Message** : texte, **Média (optionnel)**, **Boutons** (Lien direct, Lien traqué, **Offre (campagne)**).
4. Bloc **Test A/B (optionnel)** : cochez la case, écrivez la version B (texte, média, boutons) et réglez **Part des destinataires pour la version A**.
5. Bloc **Quand** : **Date et heure (Europe/Paris), pour « Programmer »**. Puis **Enregistrer en brouillon**, **Programmer** ou **Envoyer maintenant**.
6. Sur la page de l'envoi : **Envoyer un test à moi** (le message arrive sur votre Telegram lié), **Envoyer maintenant**, **Programmer**, **Annuler l'envoi**, **Retirer** (brouillon). Le bloc **Progression** compte ciblés, envoyés, échoués et bloqués ; le tableau **Message** donne les clics par bouton.
7. Liste des envois : filtres **Tous les statuts** et **Toutes les campagnes** ; **Exporter CSV** respecte ces filtres.
8. Test A/B : ouvrez la page du test depuis la liste. Elle compare envoyés, clics, cliqueurs uniques, inscriptions et FTD, désigne la gagnante dès 30 envois par version, et propose **Envoyer la version gagnante au reste du segment**.

**Pièges et questions fréquentes.**

- Commencez toujours par **Enregistrer en brouillon** puis **Envoyer un test à moi** : relisez sur votre téléphone avant d'envoyer à de vrais membres.
- Le bot n'écrit qu'aux membres « joignables » (ils lui ont déjà parlé en privé). Le segment est donc souvent plus petit que le nombre de membres du canal.
- L'envoi respecte les limites Telegram (environ 25 messages par seconde par bot, 1 par seconde par personne) : un envoi à plusieurs milliers de membres prend quelques minutes, suivez **Progression**.
- « Bloqués » = membres qui ont bloqué le bot ; ils sont automatiquement exclus des envois suivants. Un taux de blocage élevé après un envoi est le signal d'un message trop fréquent ou trop agressif.
- Statuts : Brouillon, Programmé, En cours, Envoyé, Annulé. Un envoi **En cours** ne peut plus être modifié.
- Un envoi groupé n'est pas une automatisation : pour un message déclenché par le comportement d'un membre, voir [Automatisations](#automatisations).

## Automatisations

**À quoi ça sert.** Créer des règles « si… alors… » exécutées automatiquement pour chaque membre : relancer 24 h après l'entrée, remercier après un dépôt, proposer un autre canal aux inactifs, prévenir l'équipe quand un membre devient VIP.

**Comment faire.**

1. **Nouvelle règle** ouvre la page **Nouvelle automatisation** avec des modèles : **Relance 24 h après l'entrée**, **Merci après le premier dépôt**, **Inactif 7 jours → message + canal**, **Niveau VIP atteint → prévenir l'équipe**. Cliquez sur **Utiliser** sous un modèle, ou partez d'une règle vide.
2. Bloc **Si…** : **Nom de la règle**, **Déclencheur** (A rejoint un canal, A cliqué sur une offre, S'est inscrit chez un programme, A déposé, Inactif depuis N jours, A quitté un canal, A atteint un niveau de dépense), puis les conditions facultatives : canaux, pubs, **Langues**, **Jours d'inactivité** (obligatoire pour « Inactif »).
3. Bloc **Alors…** : jusqu'à 8 actions enchaînées : **Envoyer un message** (avec **Texte**, **Boutons** au format `Libellé | https://…`, **Bot (message)**, **Média (message)**), **Envoyer la séquence du canal**, **Attendre** (**Attendre (heures)**), **Étiqueter le membre** (**Étiquette**), **Proposer un canal** (**Canal à proposer**), **Prévenir l'équipe (Telegram)**.
4. Enregistrez. La règle est créée **inactive**. Sur sa page : **Tester sur moi** (vous recevez le message), **Modifier**, **Dupliquer**, **Supprimer**, et **Activer** quand le texte vous convient. Le **Journal des exécutions (100 dernières)** montre, membre par membre, ce qui s'est passé.

**Pièges et questions fréquentes.**

- Une règle active s'applique à tous les membres concernés, immédiatement et sans relecture : testez sur vous avant d'activer.
- Les étiquettes posées par **Étiqueter le membre** servent ensuite de filtre dans **Envois** (champ **Étiquettes**).
- « Inactif depuis N jours » est vérifié toutes les 5 minutes, par lots : un membre peut être traité avec quelques minutes de retard.
- Deux règles sur le même déclencheur envoient deux messages : évitez les doublons.

## Journal

**À quoi ça sert.** Retrouver qui a fait quoi dans le site (toutes les actions des utilisateurs sont enregistrées, ainsi que les actions automatiques du système) et tout ce que les bots ont vu passer : utile en cas de doute ou d'erreur. Deux onglets : **Actions de l'équipe** et **Événements**.

**Comment faire.**

1. Onglet **Actions de l'équipe** : filtres utilisateur (**Tout le monde**, **Système (sans utilisateur)** ou une personne), **Action** (par exemple `user.` ou `bot.created`), dates **Du** / **Au**, puis **Filtrer**. **Réinitialiser** efface les filtres. Colonnes : **Quand**, **Qui**, **Action**, **Objet**, **Détails**. Les actions sur vos campagnes s'appellent « Campagne », celles sur la structure TikTok / Meta « Campagne pub ».
2. Onglet **Événements** (lisible aussi par les managers, page à part : les filtres sont mémorisés sur cet appareil et **Réinitialiser** reste sur cet onglet) : le compteur « événements sur les dernières 24 heures », puis la liste en français (demandes d'adhésion, entrées, clics, messages envoyés, mises à jour Telegram…). Filtres **Tous les types**, **Tous les canaux**, **Tous les bots**, **Du** / **Au**, bouton **Filtrer** ; **Exporter CSV** télécharge la liste filtrée.

**Pièges et questions fréquentes.**

- Le journal ne se modifie ni ne s'efface : c'est voulu.
- Les refus de connexion (`auth.login_throttled`) et les mots de passe faux (`auth.login_failed`) y figurent : un pic signale une tentative d'intrusion.
- Les événements des membres (demandes, clics, dépôts) ne sont pas ici mais dans la fiche de chaque membre.

## Réglages

Le menu **Réglages** est réservé aux administrateurs. Sa page d'accueil gère les utilisateurs ; des boutons mènent aux sous-pages **Connecteurs (Link Affi)**, **Catégories**, **Alertes**, **Postbacks**, **Rapports** et **État du système**.

### Utilisateurs et invitations

**À quoi ça sert.** Donner ou retirer l'accès au site. Deux rôles : **Administrateur** (tout) et **Manager** (tout sauf réglages, utilisateurs, jetons et suppressions).

**Comment faire.**

1. Bloc **Inviter un équipier** : **E-mail**, **Rôle**, **Créer l'invitation**. Un lien d'invitation valable 7 jours apparaît dans **Invitations en attente** : copiez-le et envoyez-le vous-même à la personne (par un canal sûr). Elle ouvre le lien, saisit son **Prénom affiché**, son **Mot de passe (10 caractères minimum)** et clique sur **Créer mon compte**.
2. Tableau **Utilisateurs** : changez le rôle dans la liste déroulante puis **OK** ; **Désactiver** retire l'accès sans supprimer l'historique.
3. **Annuler** supprime une invitation non utilisée.

**Pièges et questions fréquentes.**

- Un mot de passe oublié ne se « réinitialise » pas tout seul : un administrateur désactive l'ancien compte et crée une nouvelle invitation pour la même adresse.
- Changer le rôle ou désactiver un compte déconnecte la personne de tous ses appareils.
- Gardez au moins deux administrateurs.

### Connecteurs (Link Affi)

**À quoi ça sert.** Suivre la synchronisation avec Link Affi (lecture seule, toutes les 2 minutes), vérifier la santé du sub-ID et régler les niveaux de dépense.

**Comment faire.**

1. Bloc **Link Affi — état par table** : statut, dernière exécution, dernier succès, lignes importées et erreur pour chaque table lue. **Synchroniser maintenant** lance un passage ; **Resynchroniser tout** relit tout depuis le début (plus long).
2. Bloc **Santé du sub-ID (7 derniers jours)** : **Joueurs rattachés par postback** (le cas normal), **Joueurs rattachés par rapprochement horaire** (secours, moins précis), **Joueurs sans sub-ID malgré des clics** (à surveiller), **Clics d'offre avec sub-ID envoyés**.
3. Bloc **Niveaux de dépense** : **Seuil VIP (dépôts cumulés, en €)** et **Nombre de dépôts pour « Régulier »**, puis **Enregistrer**.
4. Carte **Diagnostic Link Affi** : **Programmes**, **Offres Link Affi**, **Offres liées** (à une de vos campagnes), **Joueurs (tous)**, **Vos joueurs**, **Non rattachés**. Le tableau **Offres Link Affi non liées qui ont des joueurs** propose **Créer une campagne avec cette offre** (l'assistant s'ouvre pré-rempli). **Exporter tous les joueurs Link Affi (CSV)** (administrateurs) télécharge la liste brute, y compris les joueurs des autres affiliés.

**Pièges et questions fréquentes.**

- Le site ne modifie jamais rien chez Link Affi : il lit seulement.
- Des joueurs uniquement « par rapprochement horaire » et aucun « par postback » : le casino tronque probablement l'identifiant de suivi. Une alerte Telegram « Santé du sub-ID » vous prévient ; il faut alors en parler à Link Affi.
- Une table en erreur ponctuelle n'est pas grave (réessai automatique) ; une erreur répétée déclenche l'alerte « Synchro Link Affi en échec répété ».
- Les niveaux de dépense sont recalculés à la prochaine synchronisation, pas immédiatement.
- La santé du sub-ID se calcule sur la date d'inscription chez Link Affi : une resynchronisation complète ne la fausse plus.
- Un joueur « non rattaché » n'est compté nulle part dans les statistiques : liez son offre à une campagne (bouton ci-dessus) s'il vient bien de chez vous.

### Postbacks

**À quoi ça sert.** Recevoir directement les événements (inscription, FTD, dépôt, revenu) d'un programme qui ne passe pas par Link Affi : le programme appelle une adresse du site à chaque événement, avec le sub-ID. Permet aussi d'importer un fichier CSV de joueurs.

**Comment faire.**

1. Bloc **Nouvel endpoint** : **Programme**, **Nom**, **Mapping (JSON, optionnel)**, puis **Créer l'endpoint**.
2. Sur l'endpoint créé : copiez **URL à donner au programme (remplacez les accolades par ses macros)** et transmettez-la au programme. **Régénérer le jeton** change l'adresse (l'ancienne cesse de fonctionner). **Mapping des paramètres (JSON)** adapte les noms de paramètres si le programme utilise d'autres noms que `sub_id`, `player_id`, `event`, `amount`, `currency`, `txid`, `date`.
3. **Envoyer un postback de test** : **sub_id (optionnel)**, **Événement**, **Montant**, **Envoyer le test** : crée un joueur fictif (identifiant « test-… ») pour vérifier que tout passe.
4. **Derniers postbacks reçus** : les 50 derniers avec statut et message d'erreur.
5. **Importer un CSV de joueurs** : **Programme**, **Fichier CSV (5 Mo max)** avec colonnes identifiant joueur, événement, et si possible sub_id, montant, devise, date, transaction.

**Pièges et questions fréquentes.**

- Un postback sans sub-ID crée bien un joueur, mais il n'est rattaché à aucun membre ni à aucune pub.
- Le même événement envoyé deux fois (même transaction) est ignoré : pas de doublon.
- Un postback avec un jeton inconnu est refusé et apparaît dans le journal : vérifiez l'adresse donnée au programme.
- Limite : 60 appels par minute et par endpoint.

### Alertes et rétention

**À quoi ça sert.** Voir les alertes détectées automatiquement (toutes les 5 minutes) et envoyées sur le Telegram de l'administrateur ; régler la durée de conservation des données personnelles ; lancer la purge.

**Comment faire.**

1. **Vérifier maintenant** force un contrôle immédiat.
2. Tableau des alertes : **Quand**, **Gravité**, **Type**, **Message**, **Notifiée**, **Résolue**. **Marquer résolu** ferme une alerte à la main (elle se rouvre si la cause revient).
3. Bloc **Durée de conservation** : **Mois (minimum 6)**, puis **Enregistrer**. Règle de l'équipe : 24 mois.
4. Bloc **Purge** : exécutée chaque nuit par le worker ; **Lancer la purge maintenant** pour ne pas attendre.

**Pièges et questions fréquentes.**

- Une alerte est envoyée une seule fois par Telegram, puis se résout seule quand la cause disparaît.
- Les alertes arrivent sur le Telegram de l'administrateur lié dans **Mon compte** : si personne n'est lié, personne n'est prévenu.
- La purge anonymise les membres inactifs et supprime leurs événements, mais garde les événements joueurs (chiffres financiers).
- La liste des alertes et la réaction attendue : voir [Une alerte arrive sur Telegram](#une-alerte-arrive-sur-telegram).

### Rapports automatiques

**À quoi ça sert.** Recevoir sur Telegram un brief chaque matin (chiffres de la veille) et un rapport chaque lundi (7 derniers jours) : demandes, acceptés, clics, inscriptions, FTD, dépôts, NGR, dépense, alertes, synchro, messages à venir.

**Comment faire.**

1. Cochez **Brief quotidien** et/ou **Rapport hebdomadaire (lundi)**, choisissez **Heure d'envoi (0 à 23)** (heure de Paris), puis **Enregistrer**.
2. **Envoyer le brief maintenant** et **Envoyer le rapport maintenant** pour un envoi immédiat.
3. Les blocs **Dernier brief envoyé** et **Dernier rapport hebdomadaire envoyé** gardent une copie.

**Pièges et questions fréquentes.**

- Les rapports partent vers le Telegram de l'administrateur lié : liez votre compte dans **Mon compte**.
- Les chiffres du brief sont ceux de la veille complète (minuit à minuit, heure de Paris).

### Catégories de messages

**À quoi ça sert.** Classer vos messages selon vos propres catégories (par exemple Bonus, Rappel…) pour comparer ce qui marche le mieux dans **Messages → Comparer par catégorie** et dans l'onglet **Canaux** du tableau de bord. Aucune catégorie n'est créée d'office : vous créez les vôtres.

**Comment faire.**

1. Le plus simple, en écrivant un message : **Messages → Nouveau message**, champ **Catégorie** → **+ Nouvelle catégorie** (dans le menu, ou le bouton à côté) → nom, couleur → **Créer la catégorie**. Elle est choisie aussitôt.
2. Dans Réglages → **Catégories de messages** (administrateur), carte **Nouvelle catégorie** : **Nom**, **Couleur**, **Univers**, puis **Créer la catégorie**.
3. Sur une catégorie existante : **Nom**, **Couleur**, **Univers**, **Ordre**, **Active**, puis **Enregistrer**.
4. Sous chaque catégorie s'affiche « N messages · N automatisations · N envois pas encore partis ». Dès qu'elle est citée quelque part : **Fusionner et supprimer**, avec le choix « fusionner dans « X » » ou « — sans catégorie — ». Les messages, les automatisations et les envois pas encore partis qui la citent passent dans la catégorie choisie. Sinon, seul **Supprimer** est proposé.

**Pièges et questions fréquentes.**

- Une catégorie par type de contenu, pas par canal : c'est ce qui rend la comparaison utile.
- Sans remplacement, une automatisation qui ne visait que cette catégorie est mise à l'arrêt et un envoi programmé qui ne visait qu'elle repasse en brouillon (le message de confirmation les cite) : c'est voulu, pour ne jamais élargir un envoi à tout le monde. Un brouillon ou une automatisation déjà en pause perd simplement son filtre ; le message « Filtre de catégorie retiré, vérifiez la cible avant d'envoyer » (ou « … avant de réactiver l'automatisation ») les nomme.
- Une catégorie désactivée ne peut être réactivée que par un administrateur (Réglages → Catégories) ; un manager qui tape son nom dans **+ Nouvelle catégorie** reçoit un message qui l'explique.
- L'**Ordre** règle l'affichage dans les listes déroulantes.
- Les 7 catégories créées d'office auparavant ont été retirées le 10 octobre (les messages déjà envoyés aux membres ont gardé la leur).

### IA

**À quoi ça sert.** Brancher l'assistant d'écriture (bouton **✨ Améliorer avec l'IA**) et surveiller son coût.

**Comment faire.**

1. Créez la clé (5 minutes, une seule fois) : https://platform.claude.com → se connecter → Settings → Billing (ajouter des crédits, 5 $ suffisent) → **API keys** → **Create key** → nom « LinkAffi Pro » → **Create** → **Copy** (la clé ne s'affiche qu'une fois).
2. Collez-la dans **Clé API Anthropic**, puis **Enregistrer** et **Vérifier**. La clé est enregistrée chiffrée et ne s'affiche plus jamais en entier.
3. Réglez **Modèle par défaut** (rapide et économique), **Modèle « qualité supérieure »** (proposé dans le panneau par la case « Qualité supérieure »), **Plafond mensuel (€)** (20 € par défaut) et **Suggestions par personne et par jour**.
4. La page affiche le coût estimé du mois et l'**Historique** des demandes (colonne **Utilisée** : « Oui (version N) », « Non » ou « Échec : réponse coupée »). **Retirer la clé** désactive l'assistant.

**Pièges et questions fréquentes.**

- Plafond atteint : l'assistant s'arrête jusqu'au mois suivant (ou augmentez le plafond).
- Une réponse coupée compte dans le plafond : elle a été facturée par Anthropic.

### État du système

**À quoi ça sert.** Vérifier en un coup d'œil que tout tourne : le site, le worker (le programme qui envoie les messages, synchronise et calcule en arrière-plan), les files de tâches, les bots, la synchro Link Affi, la dernière sauvegarde et les alertes ouvertes.

**Comment faire.**

1. Bloc **Site** : base de données et Redis vus depuis le site, avec le temps de réponse.
2. Bloc **Worker** : **Dernier battement** (signe de vie toutes les 30 secondes ; rouge au-delà de 3 minutes), **Version**, **Démarré le**.
3. Bloc **Dernière sauvegarde** : quand, fichier, taille, durée.
4. Bloc **Files de tâches** : **En attente**, **En cours**, **Retardées**, **Échouées**, **Terminées (gardées)** pour chaque file. « En attente » qui grimpe sans redescendre = worker arrêté ou trop lent.
5. Bloc **Dernières tâches échouées** : **Relancer** remet une tâche en attente ; **Purger les échecs > 7 jours** nettoie.
6. Blocs **Bots**, **Synchro Link Affi**, **Alertes ouvertes** : état détaillé. **Actualiser** recharge la page.
7. Carte **Activité des bots (24 h)** : nombre d'événements reçus ou produits par les bots sur les dernières 24 heures, avec le détail par type ; **Voir le détail dans le Journal** ouvre la vue « Événements ».

**Pièges et questions fréquentes.**

- Tout est vert mais le site est lent : regardez la latence du bloc **Site** ; au-delà de 100 ms, le service n'est probablement pas dans la même région que la base (action technique, voir `docs/A-FAIRE-HUMAIN.md`).
- Une tâche échouée en **telegram-send** est souvent un membre qui a bloqué le bot : rien à faire.
- Le worker « jamais démarré avec cette version » juste après une mise à jour est normal pendant une minute.

### Sauvegardes

**À quoi ça sert.** Ne jamais perdre les données. Chaque nuit à 4 h (heure de Paris), le worker copie toute la base dans un espace de stockage dédié chez Railway (l'hébergeur) ; les 14 dernières copies sont conservées. Le résultat est visible dans **Réglages → État du système** (bloc **Dernière sauvegarde**) et dans le brief quotidien.

**Comment faire.**

1. Vérifier : **Réglages → État du système**, bloc **Dernière sauvegarde** : la date doit être celle de la nuit dernière.
2. En cas d'échec deux nuits de suite, l'alerte Telegram « La sauvegarde automatique de la base a échoué » est envoyée.
3. Restaurer une sauvegarde est une opération technique décrite dans `docs/SAUVEGARDES.md` : demandez à la personne technique, ne tentez rien depuis le site.

**Pièges et questions fréquentes.**

- Cette sauvegarde protège contre une erreur humaine ou une corruption, pas contre la perte du compte Railway : l'activation des sauvegardes Railway elles-mêmes est une action humaine notée dans `docs/A-FAIRE-HUMAIN.md`.
- Les médias des messages sont dans la base : ils sont sauvegardés avec le reste.

## Aide

La page **Aide** affiche ce guide, avec sa table des matières à gauche. Le même texte est dans le dépôt du projet : `docs/GUIDE-UTILISATEUR.md`. Toute correction se fait dans ce fichier.

## Mon compte

**À quoi ça sert.** Changer votre mot de passe et lier votre compte Telegram : c'est ce qui permet de recevoir les tests (**Envoyer un test**, **Envoyer un test à moi**, **Tester sur moi**), et pour un administrateur, les alertes et les rapports.

**Comment faire.**

1. Cliquez sur votre prénom en haut à droite → **Mon compte**.
2. Bloc **Changer le mot de passe** : **Mot de passe actuel**, **Nouveau mot de passe** (10 caractères minimum), **Confirmer**, puis **Modifier**. Vos autres appareils sont déconnectés.
3. Bloc **Lier mon Telegram** : **Générer un lien**, ouvrez un des liens proposés dans Telegram (un par bot), appuyez sur **Démarrer**. La page affiche ensuite « lié ». **Délier** retire le lien ; **Régénérer le lien** en crée un nouveau.

**Pièges et questions fréquentes.**

- Sans Telegram lié, tous les boutons de test sont grisés et un administrateur ne reçoit ni alertes ni rapports.
- Le lien de liaison est personnel : ne le transmettez pas.

## Compléments : équipe, étiquettes, horaires, tests A/B, modèles, alertes, périodes

### Meilleurs horaires de publication
**À quoi ça sert.** Savoir à quel jour et à quelle heure vos messages marchent le mieux, canal par canal et catégorie par catégorie.
**Comment faire.** Fiche d'un canal → onglet **Meilleurs horaires**. La carte montre, jour par jour et heure par heure, combien de messages ont été envoyés et lesquels ont le mieux marché (plus la case est bleue, mieux c'est ; le cadre orange est le créneau conseillé). Filtrez par catégorie, cliquez **Programmer à ce créneau** ou **Recalculer maintenant**. Dans **Nouveau message**, l'encart « Meilleur créneau pour ce canal et cette catégorie » apparaît dès qu'il y a assez de données (3 messages dans le même créneau) : **Utiliser** remplit la date avec la prochaine occurrence.
**Pièges.** Le calcul se refait chaque nuit ; tant que Telegram ne transmet pas les vues, il se base sur les clics et les réactions.

### Test A/B d'un message de canal
Dans **Nouveau message**, cochez **Test A/B**, écrivez la version B (texte, médias, boutons), choisissez « même canal, B 30 minutes après A » ou « autre canal à la même heure », puis **Programmer le test A/B**. La page de comparaison (bouton **Voir la comparaison A/B**, badge A/B dans la liste) désigne la gagnante provisoire d'après les clics, les cliqueurs uniques et les réactions.

### Modèles de messages prêts à l'emploi
Messages → **Modèles** : filtrez par univers (casino, paris, dating) et par thème, puis **Utiliser ce modèle** : le message est pré-rempli ; remplacez `{prenom}`, `{canal}`, `{offre}` et ajoutez votre bouton **Offre**. Les modèles casino et paris gardent la mention « Jouer comporte des risques… » en fin de message : ne la retirez pas. 63 modèles sont fournis (3 par univers et par thème).

### Période et comparaison
En haut du tableau de bord, de la liste des campagnes et d'une fiche campagne, choisissez la période (aujourd'hui, hier, 7 / 30 / 90 jours, mois en cours ou deux dates) et cochez **Comparer à la période précédente** : chaque chiffre affiche sa variation en vert (favorable) ou rouge (défavorable ; pour une dépense ou un coût, une baisse est en vert). L'export CSV reprend la même période et, si la comparaison est cochée, ajoute les colonnes « période précédente » et « variation ».

### Import des coûts publicitaires
Campagnes → **Importer un CSV** : laissez « Détection automatique », choisissez le fichier exporté de TikTok Ads Manager ou Meta Ads Manager, puis vérifiez le tableau des colonnes (chaque colonne du fichier → Date, Campagne, Dépense…) et les formats de nombres et de dates devinés ; corrigez au besoin et cliquez **Relire**. Vos choix sont mémorisés pour le prochain import de la même plateforme. À la fin, l'historique affiche les lignes lues, importées et ignorées avec la raison (date illisible, montant vide, ligne de total). Corrigez le fichier et réimportez : les jours déjà importés sont simplement remplacés.

### Nouvelles alertes et seuils
Nouvelles alertes Telegram : chute des inscriptions, dépense sans inscription, canal qui perd ses membres, message programmé en échec, lien désactivé encore cliqué. Elles arrivent une fois et se ferment seules quand la cause disparaît. Réglages → **Alertes** → « Seuils des alertes métier » pour régler le pourcentage de chute (50 % par défaut), la dépense sans inscription (50 €) et le pourcentage de départs (10 %) ; effet au prochain passage (5 minutes).

### Comptes publicitaires et compte Telegram (Réglages → Connecteurs)
**À quoi ça sert.** Brancher vous-même vos comptes Meta Ads et TikTok Ads : les dépenses arrivent toutes seules dans Campagnes (onglet Pubs) (chaque heure, historique de 90 jours au branchement), et le tableau de bord calcule CPL, CPA, coût par premier dépôt et ROAS sans import de fichier. Même principe pour le nombre de vues de vos messages Telegram.

**Meta (Facebook / Instagram) — une fois, 10 minutes.**
1. Sur developers.facebook.com → **Mes apps** → **Créer une app** (cas d'usage « Autre », type **Entreprise**), ajoutez le produit **Facebook Login for Business** (ou Facebook Login).
2. Dans ses **Paramètres**, collez l'adresse de retour affichée sur la page Réglages → Connecteurs → Meta (`https://app.linkaffipro.com/api/connectors/meta/callback`) dans « URI de redirection OAuth valides ».
3. **Paramètres de l'app → Général** : copiez l'App ID et la Clé secrète (Afficher) dans Réglages → Connecteurs → **Meta**, puis **Enregistrer** et **Vérifier**. Renseignez aussi le domaine `app.linkaffipro.com`, l'URL de confidentialité `https://app.linkaffipro.com/privacy` et les conditions `https://app.linkaffipro.com/terms`.
4. **Rôles de l'app** : ajoutez chaque membre de l'équipe (Administrateur, Développeur ou Testeur). En mode Développement, cela suffit pour tous les comptes publicitaires que leur profil Facebook voit.
5. Cliquez **Connecter un compte Meta**, acceptez chez Facebook, cochez les comptes : l'historique de 90 jours se charge seul.
**Pièges.** Le passage en mode Live, la vérification d'entreprise et l'App Review ne servent que pour laisser des personnes hors de l'app connecter leurs comptes : plus tard, seulement si besoin. Un jeton Meta dure 60 jours et se renouvelle seul ; s'il est révoqué, le compte passe « À reconnecter » (alerte Telegram) : cliquez **Reconnecter**.

**TikTok Ads — une fois, 10 minutes + validation par TikTok.**
1. Sur business-api.tiktok.com/portal, connectez-vous avec votre compte TikTok for Business, cliquez **Become a Developer** puis **My Apps → Create an App** : nom « LinkAffi Pro », adresse de retour = celle affichée dans Réglages → Connecteurs → TikTok (bouton Copier), permissions **Ad Account Management → Read** et **Reporting** seulement.
2. Copiez l'App ID et le Secret (**My Apps → Basic Information**) dans la page, puis **Enregistrer** et **Vérifier**.
3. TikTok valide l'app en 1 à 2 semaines (e-mail). Avant, la connexion d'un vrai compte est refusée.
4. En attendant, cochez **Mode bac à sable**, créez un compte de test dans le portail (**Tools → Sandbox → Generate Access Token**) et collez le jeton et l'identifiant dans le formulaire dédié ; décochez le mode et déconnectez le compte de test après validation.
5. Après validation : **Connecter un compte TikTok**, acceptez chez TikTok, cochez les comptes : les dépenses arrivent seules dans Campagnes, onglet Pubs (3 derniers jours chaque heure, 28 jours chaque nuit, 90 jours à la connexion).
**Pièges.** Un compte dans une autre devise que l'euro a besoin d'un taux de change : Link Affi en fournit, et vous pouvez en saisir dans Réglages → Connecteurs (ils ont priorité). Une pub alimentée par l'API refuse les lignes d'un fichier CSV (l'API a priorité).

**Telegram (vues et transferts des messages) — une fois, 5 minutes.**
1. Réglages → Connecteurs → **Telegram (vues et transferts)** : créez une « application » sur https://my.telegram.org (connexion avec votre numéro, **API development tools**, nom « LinkAffi Pro », plateforme Web, URL https://app.linkaffipro.com) et collez `App api_id` et `App api_hash` dans la page.
2. Connectez le compte propriétaire des canaux : numéro international → code reçu dans l'application Telegram → mot de passe de validation en deux étapes si vous en avez un. Ce compte doit être administrateur des canaux ; il sert uniquement à lire les vues.
3. Ensuite tout est automatique : vues et transferts relevés toutes les 15 minutes pendant 48 h après l'envoi, puis une fois par jour pendant 30 jours ; les messages des 30 derniers jours sont repris à la connexion.
4. Les vues apparaissent dans la fiche de chaque message (tuiles « Vues » et « Transferts », courbe dans le temps) et servent au taux de clic par vue, aux meilleurs horaires et aux tests A/B.
**Pièges.** Badge « À reconnecter » = Telegram a fermé la session (depuis l'application ou expirée) : cliquez **Effacer la session** puis refaites l'étape 2. **Déconnecter** révoque la session ; **Relever maintenant** force un passage. « Canal introuvable » = le compte n'est pas membre ou administrateur du canal.

### Assistant IA pour écrire les messages
**À quoi ça sert.** Améliorer ou écrire un message en respectant d'office les règles : pas de promesse de gains, mention des risques et 18+ pour casino et paris, aucun détail d'offre inventé (repère « [à compléter] »), repères `{prenom}` et liens conservés, limite de longueur Telegram (1 024 caractères avec média, 4 096 sans).

**Où se trouve le bouton ✨ Améliorer avec l'IA.** Messages → **Nouveau message** et les modèles (sous le texte ; sous la version B d'un test A/B : **✨ Améliorer la version B avec l'IA**), Envois → **Nouvel envoi** (sous le texte et sous la version B), Canaux → fiche du canal → **Messages du bot** (sous chaque langue), **Automatisations** (texte de l'action « Envoyer un message »).

**Comment faire.**
1. Une seule fois, un administrateur colle la clé dans Réglages → **IA** (voir [IA](#ia)).
2. Cliquez **✨ Améliorer avec l'IA**. Onglet **Améliorer mon brouillon** ou **Écrire à partir d'une idée** (champ « Votre idée, en une phrase »). Réglez **Univers**, **Objectif**, **Ton**, **Longueur**, **Langue** (et la case **Qualité supérieure (plus lent, plus cher)** si elle est proposée), puis **Générer 3 versions** ou **Proposer 3 messages**.
3. Sur chaque version : **Utiliser** (place la version dans le champ), **Comme version B** (messages et envois : active le test A/B), puis **Plus court**, **Plus percutant**, **Autre angle**, qui retravaillent cette version.
4. Rangée du bas, sur le texte actuellement dans le champ : **Plus court**, **Plus percutant**, **Autre angle**, **Traduire dans les langues du bot**, **Créer la version B d'un test A/B**.
5. Traductions : dans les messages du bot, **Utiliser** enregistre la traduction dans sa langue et **Enregistrer toutes les traductions** les enregistre toutes ; ailleurs, **Copier** (le texte du champ n'est jamais remplacé).

**Ce qui marche chez vous.** L'assistant s'inspire de vos messages de canal déjà envoyés qui ont le mieux marché (au moins 5 clics, ou 100 vues et 1 clic) dans le même univers, la même catégorie d'abord.

**Langues.** Dans les textes du bot, l'assistant écrit dans la langue du champ (y compris arabe, turc, néerlandais, polonais, roumain, russe) ; **Traduire dans les langues du bot** remplit le français, l'anglais, l'espagnol, le portugais, l'allemand et l'italien.

**Pièges.** « La réponse de l'IA a été coupée : texte trop long » : réessayez en Longueur « Court » ou avec un brouillon plus court. Sans clé, le bouton explique où l'ajouter. Relisez toujours avant d'envoyer : l'IA propose, vous décidez.

### Réglages → Équipe
**À quoi ça sert.** Gérer les comptes de l'équipe (administrateurs et managers) sans e-mail automatique : vous copiez le lien et vous l'envoyez vous-même.
**Comment faire.**
1. Ouvrez Réglages → **Équipe**.
2. Pour inviter : saisissez l'e-mail, choisissez le rôle, cliquez **Inviter**, puis copiez le lien affiché et envoyez-le à la personne (il reste valable 7 jours).
3. Pour un mot de passe oublié : cliquez **Réinitialiser le mot de passe** sur la ligne de la personne, copiez le lien (valable 48 h) et envoyez-le-lui.
4. **Changer le rôle**, **Désactiver** ou **Réactiver** se font sur chaque ligne.
**Pièges.** Il reste toujours au moins un administrateur actif : le site refuse de désactiver le dernier. Vous ne pouvez pas vous désactiver vous-même.

### Réglages → Étiquettes de membres
**À quoi ça sert.** Marquer des membres (VIP, test, à relancer…) pour les retrouver et les cibler.
**Comment faire.** Créez une étiquette avec une couleur ; sur une fiche membre, cochez les étiquettes dans le bloc **Étiquettes** ; dans Membres, filtrez par étiquette ; dans un Envoi, cochez les étiquettes à cibler. Renommer ou supprimer une étiquette met à jour tous les membres concernés.

### Notes sur un membre
Sur la fiche membre, bloc **Notes** : ajoutez une note interne (visible seulement par l'équipe), modifiez-la avec **modifier** (vos notes, ou toutes pour un administrateur), supprimez-la après confirmation.

### Nommer ses campagnes et les relier à Link Affi
Nommez vos campagnes sur le modèle `TT-casinoX-FR-canalA-2026-10` (plateforme, programme, langue, canal, mois) ou cliquez **Proposer un nom conventionnel** à l'étape 4 de l'assistant. Sur la fiche d'une campagne, l'encart **Liaison suggérée** propose l'offre Link Affi au nom le plus proche : cliquez **Lier** si c'est la bonne. Utilisez le même nom dans TikTok ou Meta : la synchro rattache alors seule la campagne pub à votre campagne.

## Que faire si…

### Le bot ne répond pas

1. **Bots** : le bot est-il « actif » et son **Webhook** « ok » ? Sinon **Re-synchroniser le webhook**.
2. **Réglages → État du système** : le **Worker** a-t-il un battement récent ? Les messages privés sont envoyés par le worker, pas par le site.
3. Le membre a-t-il bien appuyé sur Démarrer dans la conversation privée avec le bot ? Un bot ne peut jamais écrire le premier à quelqu'un qui ne lui a jamais parlé (règle Telegram). Dans sa fiche, bloc **Messages privés**, il apparaît alors « non joignable ».
4. **Canaux** → le canal → **Messages du bot** : le message concerné n'est-il pas « désactivée » ?

### Un membre n'est pas accepté

1. **Canaux** → le canal → **Demandes** : retrouvez-le. Son statut explique l'attente : « planifiée » (le délai court, l'heure est indiquée), « canaux à rejoindre » (il n'a pas encore appuyé sur « ✅ J'ai rejoint » après avoir rejoint tous les canaux requis), « à valider » (mode Validation manuelle : cliquez **Accepter maintenant**), « échec » (l'erreur est affichée).
2. L'encadré rouge « Aucun de nos bots n'est administrateur de ce canal » : rendez le bot administrateur avec le droit « Ajouter des membres ».
3. En cas d'échec répété, **Réglages → État du système** → **Dernières tâches échouées** → **Relancer**.

### Une pub ne remonte pas

1. **Liens** : le lien d'entrée a-t-il des **Clics** ? Non : l'URL collée dans la plateforme n'est pas la bonne (recopiez **URL à coller dans la pub**) ou le lien est **désactivé**.
2. Des clics mais pas de **Demandes** : les visiteurs n'ont pas Telegram ou abandonnent sur l'écran d'invitation ; vérifiez que le canal est **Actif** et que le bot est toujours administrateur.
3. **Campagnes** → fiche de la campagne → onglet **Pubs** : la pub est-elle rattachée au bon lien d'entrée (colonne **Rattacher**) ? Les coûts sont-ils importés pour la période ? L'offre Link Affi est-elle dans l'onglet **Offres** ?
4. Tableau de bord → onglet **Campagnes** : cliquez **Recalculer les statistiques** si les chiffres datent de plus d'une heure.

### La synchro Link Affi est en échec

1. **Réglages → Connecteurs** : la colonne **Erreur** indique la cause par table. Cliquez sur **Synchroniser maintenant**.
2. Si l'erreur persiste, c'est en général côté Link Affi (service indisponible ou clé d'accès changée) : contactez Link Affi. Les données reprendront là où elles s'étaient arrêtées, rien n'est perdu.
3. Après une longue panne, **Resynchroniser tout** relit l'ensemble.

### Une alerte arrive sur Telegram

Chaque alerte est envoyée une fois à l'administrateur, puis se résout seule quand la cause disparaît. Le détail est dans **Réglages → Alertes**.

| Alerte reçue | Ce que ça veut dire | Ce qu'il faut faire |
|---|---|---|
| Bot en difficulté : … | Telegram n'arrive plus à joindre le site pour ce bot, ou son webhook est faux | **Bots** → **Re-synchroniser le webhook** ; si ça persiste, **État du système** |
| Synchro Link Affi en échec répété | Plusieurs passages de lecture ont échoué de suite | **Réglages → Connecteurs**, lire l'erreur, contacter Link Affi si besoin |
| File d'envoi Telegram engorgée | Trop de messages en attente d'envoi | Vérifier le worker dans **État du système** ; éviter de lancer un autre envoi groupé |
| … messages privés bloqués dans l'heure | Beaucoup de membres ont bloqué le bot ou ne sont plus joignables | Relire le dernier envoi ou la dernière automatisation ; espacer les messages |
| Santé du sub-ID : … | Les inscriptions ne reviennent plus avec leur identifiant de suivi | **Réglages → Connecteurs**, bloc Santé du sub-ID ; prévenir Link Affi |
| Worker arrêté | Plus aucun signe de vie du worker : rien ne part, rien ne se synchronise | Prévenir la personne technique (redémarrage du service worker chez Railway) |
| Erreurs répétées sur les tâches du worker | Des tâches échouent en série | **État du système** → **Dernières tâches échouées**, lire l'erreur, **Relancer** |
| La sauvegarde automatique de la base a échoué | Deux nuits sans sauvegarde réussie | Prévenir la personne technique ; en attendant, rien n'est perdu, seule la copie manque |

### Je veux supprimer un membre (RGPD)

Toute personne peut demander l'effacement de ses données.

1. **Membres** : retrouvez la personne (prénom, @pseudo ou identifiant Telegram).
2. Ouvrez sa fiche, bloc **Supprimer ce membre** (administrateurs seulement) : tapez `SUPPRIMER`, cliquez sur **Supprimer**.
3. Son nom, pseudo, identifiant et langue sont effacés, ses notes supprimées, le bot ne lui écrira plus. Les statistiques restent, anonymes. Pensez à retirer la personne du canal dans Telegram si elle le demande aussi.

### J'ai perdu mon mot de passe

1. Demandez à un administrateur.
2. Dans **Réglages**, il clique **Désactiver** sur votre ancien compte, puis crée une invitation pour votre adresse dans **Inviter un équipier** et vous envoie le lien.
3. Vous ouvrez le lien, choisissez un nouveau mot de passe et cliquez sur **Créer mon compte**.

Si vous êtes le seul administrateur : la personne technique peut créer une invitation depuis le serveur.

### Le site est lent

1. **Réglages → État du système** : regardez le temps de réponse du bloc **Site** et le **Dernier battement** du worker.
2. **Files de tâches** : une colonne **En attente** qui grimpe indique un worker arrêté ou saturé.
3. Un tableau de bord sur 90 jours avec beaucoup de membres prend quelques secondes : préférez 7 ou 30 jours.
4. Si tout est vert et que la lenteur persiste, signalez-le à la personne technique avec l'heure exacte.

## Règles à respecter

- **Pas de spam.** Telegram limite chaque bot à environ 25 messages par seconde et à 1 message par seconde par personne en privé. Le site respecte ces limites, mais c'est à vous de limiter la fréquence : un membre qui reçoit trop de messages bloque le bot, et chaque blocage est définitif.
- **Jamais d'envoi groupé sans relecture.** Brouillon, **Envoyer un test à moi**, relecture sur le téléphone, puis envoi. Une faute, un mauvais lien ou un mauvais segment part à des milliers de personnes en quelques minutes et ne se rattrape pas.
- **Tester sur soi d'abord.** Tout nouveau texte du bot, toute automatisation, tout message avec bouton Offre : d'abord sur votre propre Telegram, ou dans un canal **TEST**.
- **Bouton Offre = campagne Link Affi choisie dans la liste.** Jamais un lien court ni une landing page collés à la main : le sub-ID serait perdu et la pub ne serait jamais créditée.
- **Données personnelles.** Conservation 24 mois (purge automatique), suppression sur demande via la fiche membre, exports CSV à détruire après usage, aucun jeton ni mot de passe dans un message, un e-mail ou un document.
- **Link Affi n'est jamais modifié depuis ici.** Le site lit seulement.
- **Un seul changement à la fois** sur les règles d'adhésion d'un canal très actif, et observez l'onglet **Demandes** après.

## Petit lexique

- **Univers** : le thème d'un bot et de ses canaux : Casino, Paris sportifs ou Dating.
- **Campagne** : sur la plateforme, l'ensemble offre(s) Link Affi + canaux + pubs que vous suivez ensemble. **Campagne pub** : la campagne côté TikTok ou Meta.
- **Vos joueurs** : les joueurs Link Affi venus d'un de vos clics ou d'une offre rattachée à une de vos campagnes ; eux seuls comptent dans les statistiques.
- **Webhook** : l'adresse à laquelle Telegram envoie au site tout ce qui se passe (messages, demandes, clics). Sans webhook valide, le bot est sourd.
- **Worker** : le programme qui tourne en arrière-plan : il accepte les demandes, envoie les messages à l'heure, synchronise Link Affi, calcule les statistiques, fait les sauvegardes.
- **Lien goolink** : un lien `go.goolink.eu/…` qui compte le clic puis redirige, sans page visible.
- **Lien d'invitation** : le lien Telegram « rejoindre le canal » créé par le bot, un par pub, avec demande d'adhésion.
- **Demande d'adhésion** : la personne a cliqué « Rejoindre » mais attend l'acceptation (par la règle du canal).
- **Séquence / Messages du bot** : les textes envoyés en privé à un moment précis (accueil, rappel, accepté, réponse à une offre).
- **Identifiant de suivi (sub-ID)** : code unique de 12 caractères ajouté au lien casino de chaque membre pour chaque message. Il revient avec l'inscription et les dépôts, et permet de dire « ce dépôt vient de ce membre, de ce message, de ce canal, de cette pub ».
- **Postback** : message automatique envoyé par le casino ou le programme (« inscription », « dépôt de 20 € ») vers Link Affi ou directement vers le site.
- **FTD** : premier dépôt d'un joueur (« first time deposit »).
- **NGR** : revenu net généré par un joueur, tel que remonté par Link Affi. Le site enregistre chaque variation à sa date : le NGR d'une période est la somme des variations de cette période.
- **CPL, CPA, ROAS** : coût par membre arrivé, coût par inscription, revenu divisé par dépense.
- **LTV** : valeur moyenne d'un membre (somme des variations de NGR des joueurs divisée par le nombre de membres d'une cohorte).
- **Segment** : le groupe de membres visés par un envoi, défini par des filtres.
- **Test A/B** : deux versions d'un même envoi, réparties au hasard, pour voir laquelle fait le plus cliquer.
- **Anonymisation** : effacement de l'identité d'un membre en gardant ses chiffres sans nom.
