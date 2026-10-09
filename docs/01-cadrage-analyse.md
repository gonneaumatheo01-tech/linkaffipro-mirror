# Plateforme Stats & Bot d'affiliation — Cadrage (v1, 9 octobre 2026)

> Copie de travail pour Claude Code. La version lisible et commentable est le document Claude
> « Plateforme Stats & Bot d'affiliation — Cadrage ». Les décisions prises après les réponses
> aux questions de la section 7 seront reportées dans `CLAUDE.md`.

## 1. Le projet en une phrase

Un site interne qui voit tout (pubs, canaux Telegram, membres, joueurs, argent) et un bot Telegram
qui fait tout (accueil, programmation, suivi, envois), conseillé par une IA qui agit comme un manager.

Trois blocs :

- **Un centre de données** : il aspire les chiffres des pubs (TikTok, Meta), de Link Affi (casinos,
  paris sportifs, plus tard dating) et des canaux Telegram, et les range au même endroit.
- **Un bot Telegram multi-identités piloté depuis le site** : programmation de messages sur des
  semaines, accueil des nouveaux, flux « rejoins ces canaux », acceptation après délai, suivi de
  chaque clic, envois groupés ou ciblés.
- **Un cerveau** : statistiques très poussées (par pub, canal, message, membre, joueur) et une IA
  qui lit ces chiffres chaque jour et dit quoi faire.

But final : pour chaque euro dépensé en pub, savoir combien de membres, d'inscriptions et de dépôts
il a produits, et par quel chemin. Accès réservé aux admins et managers (pas d'affiliés).

## 2. Ce que la plateforme fera

### A. Connecteurs (les données entrent)
- Telegram : canaux, membres, demandes d'adhésion, réactions, clics sur nos liens, vues des posts.
- Link Affi (Lovable / Supabase) : campagnes, clics, inscriptions, premiers dépôts, dépôts, revenus,
  par casino et par joueur, en lecture seule.
- Meta Ads et TikTok Ads : dépenses, impressions, clics, par campagne / groupe de pubs / pub, par jour.
- Postbacks casinos : endpoint qui reçoit en direct « ce joueur vient de s'inscrire / déposer ».
- Import manuel CSV/Excel pour tout ce qui n'a pas encore d'API (dating inclus).
- Prévu : Google Ads, Snapchat, réseaux dating, autres plateformes d'affiliation.

### B. Statistiques
- Par campagne / pub : dépense, clics, membres arrivés, inscriptions, dépôts, CPL (coût par membre),
  CPA (coût par inscription), coût par FTD, ROAS, bénéfice.
- Par canal : croissance, départs, activité, meilleurs horaires, meilleurs types de messages.
- Par message : vues, réactions, clics, CTR, inscriptions et dépôts générés, comparés par catégorie.
- Par membre Telegram : origine (pub → lien → canal), chronologie (rejoint, cliqué, déposé, parti),
  niveau de dépense, messages préférés.
- Par joueur casino : inscription, FTD, dépôts suivants, LTV, relié au membre Telegram si possible.
- Entonnoir complet pub → clic → rejoint → clic lien → inscription → dépôt, avec les pertes.
- Cohortes, comparaisons de périodes, exports Excel.

### C. Bot Telegram (plusieurs bots, une seule console)
- Programmation sur des semaines, par canal : catégories, médias, boutons traqués, épinglage,
  suppression automatique, modèles, variantes A/B.
- Accueil : à la demande d'adhésion, le bot écrit au membre, donne les canaux à rejoindre, vérifie,
  relance, accepte après le délai choisi (immédiat, 1 min, 2 jours…), réglable par canal et par source.
- Identités : une identité par bot ; assignation bot ↔ canaux.
- Envois groupés et ciblés : par niveau de dépense, type de message cliqué, canal, source,
  inactivité ; file d'attente respectant les limites Telegram.
- Suivi : chaque membre, lien, clic, arrivée, départ.

### D. Automatisations (si… alors…)
- Déclencheurs : a rejoint, a cliqué, s'est inscrit, a déposé, inactif depuis X jours, a quitté,
  dépense élevée.
- Actions : envoyer un message, attendre, étiqueter, proposer un canal, prévenir l'équipe, test A/B.
- Éditeur visuel simple par blocs.

### E. IA manager (Claude)
- Brief quotidien, rapport hebdomadaire avec recommandations chiffrées, questions en français,
  alertes (dépense anormale, chute d'inscriptions, canal qui fuit, bot en erreur).
- Elle propose, les humains valident : jamais de modification de budget pub en autonomie.

### F. Administration
- Rôles Admin / Manager, 2FA, journal d'audit, réglages des connecteurs, bots, canaux, alertes.

## 3. Le fil d'un membre (attribution)

Trois briques indispensables : un lien d'invitation par pub, un lien casino personnalisé par membre
(fabriqué par le bot), et le renvoi de l'identifiant (sub-ID) par le casino.

1. **Pub TikTok ou Meta** → chaque pub pointe vers son propre lien d'invitation Telegram.
2. **Demande d'adhésion au canal** → le bot enregistre : membre, pub d'origine, date.
3. **Accueil par le bot (message privé)** → canaux à rejoindre, vérification, acceptation après délai.
4. **Posts programmés avec boutons** → le bouton ouvre le bot (deep link) : on sait qui a cliqué sur
   quel message.
5. **Lien casino personnalisé (clé du système)** → le lien porte l'identifiant du membre et du message.
6. **Casino : inscription, FTD, dépôts** → le casino renvoie chaque événement avec cet identifiant.
7. **Link Affi ou postback → plateforme** → dépôt relié au membre, au message, au canal et à la pub.

Si une brique manque : statistiques globales conservées (par pub, canal, message), détail par membre perdu.

## 4. Réalités techniques à connaître

1. **Un bot = une identité.** Pas de nom/photo par canal. Solution : parc de bots (un par identité),
   assignés aux canaux. Dans un canal, un post de bot apparaît au nom du canal : l'identité compte
   surtout pour les messages privés.
2. **Telegram ne dit pas qui clique sur un lien normal.** Lien classique = total de clics via notre
   domaine de tracking. Pour savoir *qui* : bouton → ouvre le bot → lien casino personnalisé.
3. **Le bot n'écrit en privé qu'aux membres qui l'ont contacté** (ou qui viennent de faire une
   demande d'adhésion). Le flux d'accueil crée la liste des membres joignables. Envois groupés via
   file d'attente (max ~30 msg/s, moins en pratique).
4. **Acceptation différée** = activer « Approuver les nouveaux membres » sur chaque canal + bot admin.
   Bascule à planifier canal par canal.
5. **Vues par post** : pas dans l'API Bot classique → couche MTProto à ajouter (prévu, faisable).
6. **Niveau de dépense** : dépend de ce que les casinos renvoient (montants par joueur avec sub-ID,
   ou seulement FTD). À vérifier casino par casino.
7. **API publicitaires** : Meta = app + jeton utilisateur système (≈ 1 h). TikTok = app développeur à
   faire valider (1 à 2 semaines) → lancer tout de suite, import fichier en attendant.

Prudence : RGPD (accès restreint, conservation 24 mois par défaut, suppression sur demande) ;
règles Telegram (rythme limité, bots en relais, respect du « stop »).

## 5. Architecture et stack proposés

Cinq sources (Telegram, Link Affi, Meta Ads, TikTok Ads, postbacks casinos) alimentent une seule
plateforme : Connecteurs, Bots Telegram, Tracking, Base de données, Robots de tâches, IA manager,
et le Site web interne (seule partie visible par l'équipe).

| Brique | Rôle | Outil choisi | Pourquoi |
| --- | --- | --- | --- |
| Site web | Tableaux de bord, console du bot, automatisations | Next.js + TypeScript | Standard, très bien maîtrisé par Claude Code |
| Base de données | Membres, joueurs, messages, coûts, événements | PostgreSQL (Supabase) | Fiable, scalable, même famille que Link Affi |
| Robots de tâches | Récupérer les stats, programmer, accepter, calculer | Node.js + BullMQ (Redis) | Rejoue les tâches en échec, respecte les rythmes |
| Service bots | Parle à Telegram pour tous les bots | grammY + couche MTProto (vues) | Multi-bots natif, robuste |
| Tracking | Liens courts, redirections, postbacks | Petit service web sur le domaine court | Mesure chaque clic, reçoit les événements |
| IA manager | Analyses, rapports, réponses | API Claude (Anthropic) | Sait lire les données via des outils |
| Hébergement | Fait tourner le tout | Railway (site + robots + bots + Redis) + Supabase (base) | Déploiement auto depuis GitHub, zéro serveur à gérer |

Lien avec Link Affi : accès en lecture seule sur sa base Supabase (rôle SELECT uniquement),
synchronisation toutes les quelques minutes ; postbacks en double si disponibles. Aucune
modification de Link Affi.

Coûts estimés : Railway 20–40 €/mois, Supabase 0–25 €/mois, domaines 20 €/an, API Claude
30–100 €/mois. Total ≈ 60–170 €/mois.

## 6. Ajouts recommandés

1. Domaine court de tracking (ex. go-marque.com) pour tous les liens.
2. Endpoint de réception de postbacks (temps réel).
3. Journal d'événements inaltérable (append-only) : toute stat se recalcule.
4. Convention de nommage commune TikTok / Meta / Link Affi / Telegram
   (ex. `TT-casinoX-FR-canalA-2026-10`) → liaison automatique des campagnes.
5. Tests A/B de messages.
6. Alertes automatiques dans un groupe Telegram « équipe ».
7. Cohortes et LTV à 30/60/90 jours par source.
8. Carte des meilleurs horaires par canal et catégorie.
9. Sécurité des bots : rythme limité, bascule automatique, respect du stop.
10. Journal d'audit (qui a fait quoi).
11. Architecture « connecteurs » enfichables (dating, Google Ads, Snapchat…).
12. Sauvegardes quotidiennes avec restauration testée.

Conseil : collecter les données Telegram dès la phase 2, avant les tableaux de bord.

## 7. Questions (★ = réponse indispensable)

**Accès et comptes**
- Q1 ★ Accès au tableau de bord Supabase du projet Lovable (Link Affi) ? Reco : oui + clé lecture seule.
- Q2. Hébergement Railway + Supabase ? Reco : oui.
- Q3. Domaine existant ? Reco : 2 domaines (site + tracking court). Nom de la marque ?

**Données casinos / paris**
- Q4 ★ Que reçoit Link Affi par joueur : clics, inscriptions, FTD, montants, revenus ? Captures bienvenues.
- Q5 ★ Les liens casinos acceptent-ils un sub-ID renvoyé ensuite par le casino ?
- Q6. Nombre de programmes casinos / paris ; lesquels envoient des postbacks ?

**Telegram**
- Q7 ★ Nombre de canaux, publics ou privés ?
- Q8 ★ Nombre d'identités de bot (donc de bots) ? Reco : 2 pour commencer.
- Q9. « Approuver les nouveaux membres » déjà activé ? Reco : activation canal par canal en phase 2.
- Q10. Groupes en plus des canaux ? Reco : canaux d'abord.
- Q11. Langue : français seulement ? Reco : français, multi-langue prévu.

**Publicité**
- Q12 ★ Nombre de comptes TikTok / Meta ; dans un Business Center / Business Manager contrôlé ?
- Q13. Pubs → lien Telegram direct ou page intermédiaire ? Reco : page de redirection invisible.
- Q14. Importer l'historique des dépenses ? Reco : oui, 12 mois.

**Équipe et usage**
- Q15 ★ Nombre d'utilisateurs, qui est admin ? Reco : rôles Admin / Manager.
- Q16. 2FA obligatoire ? Reco : oui.
- Q17. Où parle l'IA ? Reco : plateforme + groupe Telegram « Direction », brief 9 h, hebdo lundi.
- Q18. Budget IA 30–100 €/mois OK ?

**Périmètre et calendrier**
- Q19. Ordre des phases OK ? Reco : fondations → bot → connecteurs → stats → automatisations → IA.
- Q20. Multi-vertical (casino, paris, dating) dès le début ? Reco : oui.
- Q21. Conservation 24 mois, suppression sur demande, accès admins ? Reco : oui.
- Q22. Modèles de messages, charte, fichiers Excel existants ? Reco : les déposer dans ce dossier.
- Q23 ★ Qui pilote Claude Code, sur quel ordinateur ? Déjà installé et connecté ?
- Q24. Date cible ou budget maximum ?

## 8. À préparer avant de coder (≈ 2 h côté client, une seule fois)

| # | Quoi | Qui | Temps |
| --- | --- | --- | --- |
| 1 | Compte GitHub | Client | 5 min |
| 2 | Comptes Railway et Supabase (+ carte) | Client | 10 min |
| 3 | Achat des 2 domaines | Client | 10 min |
| 4 | Création des bots via @BotFather (nom, photo, jeton) | Client | 3 min / bot |
| 5 | Bots administrateurs des canaux | Client | 5 min |
| 6 | Accès Supabase de Link Affi : URL + clé lecture seule | Client (guidé) | 10 min |
| 7 | Meta : utilisateur système + jeton (ads_read) | Client (guidé) | 20 min |
| 8 | TikTok : app développeur + demande d'accès API Marketing | Client (guidé) | 20 min + attente |
| 9 | Clé API Anthropic | Client | 5 min |
| 10 | Claude Code installé et connecté à GitHub, Railway, Supabase | Client (guidé) | 15 min |

Règles : jamais de clés dans un fichier partagé ou un message public ; remises une fois à Claude Code,
stockées dans les variables d'environnement de l'hébergeur.

## 9. Plan d'action par phases (8 à 12 semaines estimées)

| Phase | Contenu | Résultat utilisable | Durée |
| --- | --- | --- | --- |
| 0. Préparation | Comptes, domaines, bots, clés, dossier projet, règles Claude Code | Tout est prêt | 2–5 jours |
| 1. Fondations | Site en ligne, auth admins/managers, base, déploiement auto | Connexion de l'équipe | 1 sem |
| 2. Bot Telegram cœur | Parc de bots, canaux, adhésions différées, flux d'accueil, suivi des membres, calendrier, liens traqués | Programmer, accueillir, accepter, tracer l'origine | 2 sem |
| 3. Connecteurs | Link Affi, postbacks, Meta, TikTok, import, liaison des campagnes | Toutes les données au même endroit | 1,5 sem |
| 4. Statistiques | Dashboards campagne / canal / message / membre / joueur, entonnoir, cohortes, exports | « Quelle pub rapporte ? » en 10 s | 2 sem |
| 5. Envois & automatisations | Segments, envois groupés, éditeur d'automatisations, A/B | Relances automatiques | 1,5 sem |
| 6. IA manager | Brief, rapport hebdo, questions, alertes | Un manager qui lit les chiffres | 1 sem |
| 7. Solidité | Tests, surveillance, sauvegardes, guide, formation | Usage quotidien serein | 1 sem |

## 10. Mode de travail

1. Je prépare le prompt complet de chaque phase + `CLAUDE.md` (mémoire du projet).
2. Le client ouvre Claude Code dans ce dossier, colle le prompt, choisit « toujours autoriser ».
3. Claude Code construit, déploie, teste ; en cas de doute : « fais au mieux ».
4. Je relis le travail dans le dossier, je fais corriger, le client fait un test de 5 minutes et dit OK.

Demandé au client, et rien d'autre : réponses aux questions ★, une approbation par phase,
un test de 5 minutes par phase.

## 11. Prochaine étape

Réponses aux questions ★ (Q1, Q4, Q5, Q7, Q8, Q12, Q15, Q23) + « OK pour tout le reste » ou corrections.
Ensuite : cadrage final, plan détaillé phases 0 et 1, `CLAUDE.md`, premier prompt Claude Code,
guide clic par clic des comptes et jetons.
