# Prompts Claude Code — mode d'emploi

Chaque phase = un fichier ici. Pour lancer une phase, ouvrez le Terminal, puis :

```
cd "$HOME/Desktop/Platefome de statistiques" && claude
```

et tapez une seule ligne :

```
Lis CLAUDE.md puis docs/prompts/<fichier de la phase> et exécute la phase en entier.
```

| Fichier | Quand | Ce que ça construit |
| --- | --- | --- |
| `00-phase-0-setup.md` | Jour 1 | Dépôt GitHub, Railway (site, worker, base, Redis), connexion, bots en ligne, canaux détectés, redirection goolink.eu, accès lecture seule Link Affi |
| `01-phase-1-kit-lancement.md` | Jours 2 à 4, après « phase 0 OK » | Demandes d'adhésion avec délai, flux « rejoins ces canaux », liens par pub, boutons personnalisés (sub-ID), calendrier de messages, synchro Link Affi, fiches membres |
| `02-telegram-dialogue.md` | Fait le 9 octobre | Dialogue par Telegram (`tg:send` / `tg:inbox`), règle permanente |
| `03-phase-2-connecteurs-et-stats.md` | Fait le 9 octobre (rédigé par Claude) | Pubs et coûts, postbacks, tableaux de bord, envois groupés, purge et alertes |
| `04-phase-3-confort-et-automatisations.md` | En cours (rédigé par Claude) | Rapports Telegram, médias en privé, CI, automatisations « si… alors… » |
| `21-phase-19-agents-fondations.md` | Fait le 23 octobre 2026 | Agents IA : Grand Chef, 4 Chefs d'équipe, agents communs (Rédaction, Planification, Contrôle qualité, Publication, Médiathèque), rubrique « Agents », validation et demandes par Telegram, simulation sur le canal Test |
| `22-phase-20-agents-dating.md` | Fait le 23 octobre 2026 | Équipe Dating : vidéos et photos IA de la persona, chaîne complète jusqu'au canal Test |
| `23-phase-21-agents-algorithme.md` | Fait le 23 octobre 2026 | Équipe Algorithme : fiches de résultats des posts, horaires, conversations, tests A/B, réglages bornés, rapport « Ce qui marche » |
| `24-phase-22-agents-casino.md` | Fait le 23 octobre 2026 | Équipe Casino : médiathèque par thème, demandes de vidéos, jamais de média inventé |
| `25-phase-23-agents-paris.md` | Fait le 24 octobre 2026 | Équipe Paris sportifs : cotes, captures du bookmaker, paris publiés et bilan |
| `26-phase-24-agents-ads.md` | Fait le 24 octobre 2026 | Agent Ads : recommandations quotidiennes sur les pubs Meta et TikTok |
| `27-phase-25-agents-supervision.md` | Fait le 24 octobre 2026 (fin de la chaîne) | Supervision complète, conversation Casino et Paris, relecture générale |
| `28-phase-26-boss-telegram.md` | Fait le 24 octobre 2026 | Kevin (le Boss) : un bot à qui parler en français ordinaire, qui répond toujours, agit, confirme, guide le démarrage et travaille dans le groupe de l'équipe |
| `29-phase-27-canal-inspiration.md` | Fait le 25 octobre 2026 | Canal d'inspiration : Kevin lit un canal qui marche, le mesure, résume, propose par numéros et applique avec votre accord, sans jamais copier |
| `35-phase-33-kevin-ordres-equipes.md` | Fait le 25 octobre 2026 (avant les phases 28 à 32) | Kevin donne des ordres aux équipes : registre des capacités, planificateur, récapitulatif, confirmation, réglages temporaires des canaux, suivi et rapports ; voir et parler à chaque agent ; voix de collègue |
| `37-phase-35-cotes-bookmakers.md` | Fait le 25 octobre 2026 | Matchs et cotes lus directement chez Celsius, Sportaza et Bet Portal (apprentissage du site, lecture API → page → image, double lecture, jamais de mise), lecteur du Mac en service, Kevin et page Agents → Bookmakers |
| `36-phase-34-tout-par-kevin.md` | Fait le 25 octobre 2026 (après les phases 33 et 35) | Chaque action du site faisable en parlant à Kevin (mêmes fonctions, droits et journal), confirmations OUI / SUPPRIMER / aperçu d'envoi, entrées Telegram (messages transférés, fichiers, liens d'autorisation), garde-fou de parité permanent |
| `30-phase-28-montage-video.md` | Fait le 26 octobre 2026 | Équipe Montage : vidéo longue envoyée à Kevin → plan de coupe par l'IA → shorts en un seul passage (1080p, sous-titres vérifiés, caméra, texte) → aperçus validés par le client ; page Agents → Montage |
| `31-phase-29-analystes-marche.md` | Fait le 26 octobre 2026 | Équipe Analystes : veille marché sourcée (forums, Reddit, Telegram public, X, actualités, toute l'Europe), règles publicitaires par plateforme et pays, réponses de Kevin, rapport du lundi, alertes ; page Agents → Analyses |
| `32-phase-30-qa-global.md` | Fait le 26 octobre 2026 | QA Global sur Claude Fable 5.1 : dernier verrou avant toute sortie des agents et de l'IA (posts, shorts, rapports, alertes, recommandations, réponses de Kevin), approbation liée au contenu exact, aucun repli, page Agents → Qualité |
| `33-phase-31-…` et suivantes | En file (`QUEUE`) | Lancées automatiquement |
| `90-nouvelle-machine.md` | Quand un second ordinateur ou un équipier arrive | Prépare la machine à partir de GitHub |

Les phases 2, 3 et 4 seront ajoutées ici au fur et à mesure. À la fin de chaque phase, Claude Code écrit `docs/STATUS.md` : lisez-le, faites le test de 5 minutes, puis dites « phase X OK ».
