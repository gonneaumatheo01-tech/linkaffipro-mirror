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
| `00-phase-0-setup.md` | Jour 1 | Dépôt GitHub, Railway (site, worker, base, Redis), connexion, bots en ligne, canaux détectés, redirection goolink.me, accès lecture seule Link Affi |
| `01-phase-1-kit-lancement.md` | Jours 2 à 4, après « phase 0 OK » | Demandes d'adhésion avec délai, flux « rejoins ces canaux », liens par pub, boutons personnalisés (sub-ID), calendrier de messages, synchro Link Affi, fiches membres |
| `90-nouvelle-machine.md` | Quand un second ordinateur ou un équipier arrive | Prépare la machine à partir de GitHub |

Les phases 2, 3 et 4 seront ajoutées ici au fur et à mesure. À la fin de chaque phase, Claude Code écrit `docs/STATUS.md` : lisez-le, faites le test de 5 minutes, puis dites « phase X OK ».
