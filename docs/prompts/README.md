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
| `90-nouvelle-machine.md` | Quand un second ordinateur ou un équipier arrive | Prépare la machine à partir de GitHub |

Les phases 2, 3 et 4 seront ajoutées ici au fur et à mesure. À la fin de chaque phase, Claude Code écrit `docs/STATUS.md` : lisez-le, faites le test de 5 minutes, puis dites « phase X OK ».
