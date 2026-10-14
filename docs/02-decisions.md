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
| IA manager | Mise de côté pour l'instant (« oublie l'IA, pas besoin »). Exception du 10 octobre : un assistant d'écriture des messages est demandé (voir plus bas). | Pas d'IA « manager » ; seul l'assistant d'écriture existe, avec une clé Anthropic saisie par l'ADMIN dans Réglages → IA. |
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

- IA : l'IA « manager » complète reste écartée. **Un assistant IA d'écriture des messages est ajouté** à la demande du client (améliorer ou écrire un message selon l'univers casino, paris sportifs ou dating, sur chaque écran de rédaction). Clé Anthropic saisie par l'ADMIN dans Réglages → IA ; modèle rapide Claude Haiku 5.5 par défaut, Claude Sonnet 5.5 en « qualité supérieure » ; plafond mensuel 20 € et 50 suggestions par personne et par jour par défaut. Voir `docs/prompts/10-phase-8-corrections-et-ia-messages.md`.
- Catégories de messages : créées par le client lui-même ; aucune catégorie créée d'office.
- Statistiques : seules nos données comptent (joueurs rattachés à nos clics par sub-ID, ou campagnes Link Affi rattachées à nos campagnes), aux dates réelles des événements. Les totaux Link Affi globaux n'apparaissent jamais dans les statistiques.
- Tableau de bord : tuile « Événements (24 h) » retirée.
- « Campagne » = notre campagne (offre Link Affi + canaux + pubs + liens), entrée principale du menu ; « campagne pub » = structure TikTok / Meta à l'intérieur.
- Comptes publicitaires : comptes d'agence partagés avec le Business Manager / Business Center du client, connectés depuis la plateforme (phase 7).
- Canal détecté automatiquement (bot déjà administrateur) : aucune acceptation automatique ni message privé automatique tant que l'équipe n'a pas réglé la règle d'adhésion du canal (une demande acceptée à la main reçoit le message « accepté ») (rappel de la décision « approbation jamais automatique par défaut »).

## Décisions du 14 octobre (affiliés Link Affi sur nos canaux Telegram)

- Les affiliés existants de Link Affi peuvent amener des membres dans nos canaux. C'est l'admin qui crée, **dans Link Affi** (partie Campagnes), une campagne de type « Canal Telegram » pour un affilié ; Link Affi demande le lien d'invitation à notre plateforme ; `linkaffi.me/go/<clé>` redirige vers ce lien.
- Les inscriptions, FTD et dépôts des membres venus de ce lien sont crédités à l'affilié dans les stats normales de Link Affi (paramètre `tg` ajouté à nos liens d'offre). Seules les campagnes créées ainsi ont des affiliés.
- Dans la partie « Joueurs » de Link Affi, l'affilié voit ses demandes d'adhésion, les pseudos et le parcours de ses membres ; l'admin voit tout.
- Premier affilié gagne, pas d'attribution pour un membre déjà présent, à vie par défaut ; seuls les boutons d'offre du bot créditent l'affilié.
- Exception à la règle « Link Affi en lecture seule » : notre API d'intégration appelée par Link Affi et l'envoi des événements à `telegram-events`. Contrat : `docs/LINKAFFI-PARTENAIRES.md` ; prompts : `docs/prompts/15-phase-13-partenaires.md` (Claude Code) et `docs/prompts/LOVABLE-campagnes-telegram.md` (Link Affi).
