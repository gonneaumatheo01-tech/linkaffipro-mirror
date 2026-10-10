# Décisions validées — 9 octobre 2026

Réponses du client aux questions du cadrage (`docs/01-cadrage-analyse.md`, section 7). Ce fichier
prime sur l'analyse en cas de contradiction.

## Tableau des décisions

| Sujet | Décision | Conséquence pour la construction |
| --- | --- | --- |
| Hébergement | Railway pour tout : site, worker, bots, PostgreSQL, Redis. Aucun compte Supabase nécessaire (Link Affi se lit par son API). | Une seule plateforme à administrer, un seul jeton d'hébergement. |
| Domaines | `linkaffipro.com` = site interne ; `goolink.eu` = liens traqués (redirections). Déjà achetés. | Deux domaines personnalisés sur le service web, routage par hostname. |
| Link Affi | Hébergé sur Lovable Cloud : aucun compte Supabase, aucun jeton `sbp_`. Une API en lecture seule (GET, deux clés) a été créée pour cette plateforme : voir `docs/LINKAFFI-API.md`. Données disponibles par joueur : clic, inscription, FTD, montant du dépôt, NGR joueur, redépôts, identifiant joueur. Les liens acceptent un sub-ID. | Connecteur Link Affi = client HTTP de cette API, synchro toutes les 2 minutes. Attribution par membre possible ; classement fin par dépense (FTD, montants, NGR, redépôts). |
| Programmes | 1 programme casino aujourd'hui ; d'autres viendront, avec des données pas forcément identiques. | Modèle de données tolérant aux champs manquants ; un connecteur par programme. |
| Bots | 3 bots : casino, paris sportifs, dating. | Parc de bots dès la phase 0 ; identité par univers. |
| Canaux | Aucun créé encore. Tous privés, les membres demandent à rejoindre. Canaux seulement (pas de groupes). Approbation jamais automatique par défaut : réglée canal par canal. | Liens d'invitation créés par la plateforme avec demande d'adhésion ; règle d'approbation par canal (immédiat / délai / gate). |
| Langues | Français principal ; multi-langue obligatoire pour les messages. | Textes du bot traduisibles par langue ; interface en français. |
| Publicité | Aucun compte TikTok / Meta créé. Comptes parfois dans un Business Manager contrôlé, parfois non. Rien d'existant. Redirection intermédiaire invisible (aucune page affichée). | Connecteurs API quand le compte est contrôlé, import CSV sinon. Redirection 302 pure sur goolink.eu. Meta/TikTok reportés à la phase 2. |
| Historique pub | Aucun à importer. | Rien à reprendre. |
| Équipe | 2 admins + 1 manager. Pas de double authentification. | Auth e-mail + mot de passe, rôles ADMIN / MANAGER, invitations. |
| IA manager | Mise de côté pour l'instant (« oublie l'IA, pas besoin »). | Aucune clé Anthropic ; module prévu plus tard, ne pas le construire. |
| Périmètre | Ordre des phases OK. Multi-vertical (casino, paris, dating) dès le début. Conservation 24 mois, suppression sur demande, accès admins seulement. | Enum Vertical sur bots, canaux, campagnes, programmes. |
| Contenus | Aucun modèle de message, aucune charte, aucun fichier existant : « à toi de créer la meilleure ». | Proposer des modèles de messages, des catégories et une charte sobre. |
| Pilotage | Le client pilote Claude Code sur son Mac ; un second ordinateur et un associé viendront. | Projet sur GitHub ; `CLAUDE.md` et prompts dans le dépôt ; jetons par machine dans `.claude/settings.local.json`. |
| Calendrier | Lancement dans 3 à 4 jours. Pas de plafond de budget. | Kit de lancement = phases 0 et 1 ; le reste après le lancement. |
| Déjà en place | GitHub, Railway, les 2 domaines, Claude Code installé, les deux clés de l'API Link Affi. | Phase 0 : bots, canaux, jetons GitHub et Railway, DNS. |

## Réponses brutes (pour référence)

Q1 oui · Q2 oui · Q3 site linkaffipro.com, tracking goolink.eu · Q4 clic, inscrit, FTD, montant du dépôt,
NGR joueur, redépôt, id du joueur · Q5 oui · Q6 un programme, d'autres à venir avec des infos différentes ·
Q7 aucun canal créé, tous privés sur demande · Q8 3 bots (paris sportifs, dating, casino) · Q9 approbation
non automatique, à configurer · Q10 canaux seulement · Q11 français principal, multi-langue requis ·
Q12 aucun compte pub, Business Manager parfois contrôlé parfois non · Q13 rien d'existant, page de
redirection invisible · Q14 pas d'historique · Q15 2 admins, 1 manager · Q16 pas de 2FA · Q17 pas d'IA pour
l'instant · Q19 ok · Q20 ok · Q21 ok · Q22 rien d'existant, à créer · Q23 le client sur son Mac, second
ordinateur et associé à venir · Q24 lancement dans 3-4 jours, pas de budget max.

## Décisions du 10 octobre (retours après première utilisation)

- IA : l'IA « manager » complète reste écartée ; **un assistant IA d'écriture des messages est demandé** (améliorer un brouillon selon l'univers casino, paris sportifs ou dating ; clé API saisie par l'admin dans Réglages → IA). Voir `docs/prompts/10-phase-8-corrections-et-ia-messages.md`.
- Catégories de messages : créées par le client lui-même ; aucune catégorie créée d'office.
- Statistiques : seules nos données comptent (joueurs rattachés à nos clics par sub-ID, ou campagnes Link Affi rattachées à nos campagnes), aux dates réelles des événements. Les totaux Link Affi globaux n'apparaissent jamais dans les statistiques.
- Tableau de bord : tuile « Événements (24 h) » retirée.
- « Campagne » = notre campagne (offre Link Affi + canaux + pubs + liens), entrée principale du menu ; « campagne pub » = structure TikTok / Meta à l'intérieur.
- Comptes publicitaires : comptes d'agence partagés avec le Business Manager / Business Center du client, connectés depuis la plateforme (phase 7).
