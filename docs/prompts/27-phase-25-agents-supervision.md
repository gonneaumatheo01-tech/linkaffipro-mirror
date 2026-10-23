# Phase 25 — Agents IA : supervision complète, conversation Casino / Paris, relecture générale (fin de la chaîne)

Si `docs/STATUS.md` indique déjà « phase 25 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/STATUS.md` (phases 19 à 24), `docs/DECISIONS-TECH.md`, `docs/A-FAIRE-HUMAIN.md`, **`docs/AGENTS-ARCHITECTURE.md`** (tout, et en particulier « Niveaux d'autonomie et garde-fous », « Risques et parades », « Phase 25 »), puis `packages/agents` en entier, `packages/chat` et `apps/worker/src/assistant` (assistante de conversation, phase 17), la rubrique Conversations, et `docs/ASSISTANT-CONVERSATION.md`. Décisions courantes : prends-les, note-les, continue. Livre par étapes, un commit par étape.

## Étapes
1. Tableau de bord complet de la rubrique Agents (toutes les équipes, coûts, résultats, réglages en cours, santé) et carte « Agents » de l'État du système.
2. Conversation Casino et Paris sportifs : assistante du canal (bot dédié par univers), fiche d'informations, lien VIP, passage à un humain.
3. Tests d'intégration de toute la chaîne (les quatre équipes ensemble, réglages de l'équipe Algorithme appliqués aux trois autres) et relecture adverse.
4. Guide, aide, captures, STATUS, `A-FAIRE-HUMAIN.md` consolidé, bilan complet Telegram, `docs/PHASE-DONE`.

## But de la phase
Terminer la chaîne : une supervision complète en un écran, l'agent Conversation pour les univers Casino et Paris sportifs (prévu « plus tard » dans le plan : c'est maintenant), une relecture générale de tout ce qui a été construit depuis la phase 19, et un bilan complet pour le client. **Cette phase clôt la chaîne : après son bilan, crée `docs/PHASE-DONE` et arrête-toi** (ne rédige pas d'autres phases de ta propre initiative ; le client décidera de la suite).

## 1. Supervision complète
- `/agents` : vue d'ensemble des 4 équipes et de l'Agent Ads : état (active, simulation, pause, niveau), missions du jour (créées, publiées, en attente, refusées, échouées, replis), dépense du mois par poste avec plafond et projection à fin de mois, résultats des posts d'agents sur 7 et 28 jours (vues, clics, inscriptions, dépôts, commissions : mêmes règles que Statistiques), réglages appliqués cette semaine par l'équipe Algorithme (avec Annuler), tests A/B en cours, alertes ouvertes, derniers rapports ; bouton Pause générale ; liens vers chaque fiche d'équipe.
- Réglages → État du système : carte « Agents » (files `agents-*`, dernier passage du Grand Chef, missions bloquées à relancer, fournisseurs : clé présente, dernier appel réussi, erreurs 24 h) ; `/api/health` ne change pas.
- Dialogue admin : `agents` renvoie ce résumé en 8 lignes au plus ; `rapport` renvoie le rapport du jour.
- Commande `pnpm agents:status` (locale et `railway ssh`) qui imprime le même résumé.

## 2. Conversation Casino et Paris sportifs (règles de la phase 17, étendues)
- **Même moteur** (`packages/chat`, bot en mode ASSISTANT, file `chat`, inbox, prise en main, chiffres) ; aucun compte réel, aucune prise de contact à froid ; **identité assistante assumée obligatoire** pour ces univers (`identityKind = ASSISTANT`, jamais « fille » ni mode illusion sur un bot Casino ou Paris : règle codée dans le formulaire et dans le moteur, testée) ; adultes seulement ; `/stop` ; pas de spam ; désactivé par défaut.
- `Persona.universe` (dating, casino, sports) et **fiche d'informations** (`Persona.faq`, JSON : questions courantes et réponses, 40 entrées au plus, plus la fiche de l'offre existante) : la seule source de ce que l'assistante peut affirmer (bonus, dépôt minimum, pays, délais de retrait, VIP) ; tout ce qui n'y est pas → « je transmets à l'équipe » (règle 3). Formulaire Personas : section « Fiche d'informations » (ajout, modification, import CSV).
- **Lien VIP / offre** : envoyé par le bouton suivi existant (`go.goolink.eu/a/…`, sub-ID par envoi) quand la personne demande l'accès VIP ou l'inscription, ou selon les règles du parcours de la persona (nombre d'échanges, intérêt) ; jamais au premier message ; les règles « gratuit via inscription chez le bookmaker » se règlent dans la fiche (texte exact à dire).
- **Passage à un humain** : question hors fiche, réclamation, demande d'argent, mineur suspecté, insulte → réponse neutre, conversation marquée « à traiter » dans l'inbox, alerte Telegram groupée (toutes les 30 minutes au plus) ; l'équipe reprend la main comme aujourd'hui.
- Chiffres : par persona et univers, dans Conversations → Chiffres ; l'agent Conversations de l'équipe Algorithme les lit aussi (profil = persona).
- Les bots des canaux Casino et Paris existants ne changent pas de mode (un bot dédié par univers, créé dans @BotFather par le client : action humaine, clics exacts dans `A-FAIRE-HUMAIN.md`).

## 3. Tests d'intégration de toute la chaîne et relecture
- **Scénario complet sur base réelle** (`pnpm test:integration`, section worker) avec horloge injectée sur 3 jours simulés : Dating (vidéo faux fournisseur, photo, texte), Casino (médias déposés, repli, demande groupée), Paris (faux fournisseur, page locale, résultats), Algorithme (fiches, fenêtres, un test A/B, une recommandation appliquée → Planification Dating l'utilise le lendemain → annulation), Ads (rapport), validations par Telegram et par le site, pause d'une équipe en cours de mission, redémarrage du worker au milieu d'une chaîne (reprise sans double publication), plafond atteint (replis), rapports quotidiens, aucune publication hors canal Test en simulation (assertion sur tous les `Post` créés).
- **Relecture adverse** (comme à la phase 17) de tout `packages/agents`, des handlers Telegram ajoutés, de la rubrique Agents et des migrations, en 6 dimensions : règles du client (plan), robustesse (reprise, idempotence, limites), données personnelles (anonymisation, journaux sans textes), chiffres (cohérence avec Statistiques), interface (vocabulaire, aide, accessibilité, mobile), non-régression des phases 0 à 18 (bots, envois, assistante, comptes réels). Chaque défaut confirmé est corrigé avec un test. Compte-rendu dans `docs/STATUS.md`.
- Performance : le Grand Chef et les agents de nuit ne doivent pas ralentir le site ni les envois (mesure des durées dans `AgentRun`, index vérifiés, requêtes des fiches `PostInsight` par lots).

## 4. Guide, documentation, bilan
- `docs/GUIDE-UTILISATEUR.md` : section « Agents » complète et relue (une sous-partie par écran, en français simple : comment lancer une équipe pour de vrai en 3 clics, comment valider, comment mettre en pause, comment annuler un réglage, comment envoyer des médias au bot, où voir les coûts), section « Conversations » mise à jour (Casino / Paris) ; aide « ? » par page ; `docs/prompts/README.md` ; captures de référence (`docs/REFONTE-CAPTURES.md`) ; `docs/DATA-MODEL.md` ; `docs/DECISIONS-TECH.md` ; `CLAUDE.md` (ligne « Phases 19-25 » résumant la stack des agents, les files, les commandes `agents:*`).
- `docs/A-FAIRE-HUMAIN.md` : **une liste consolidée, dans l'ordre**, de tout ce que le client doit faire pour mettre les équipes en route (clés, médias, comptes, bots, bornes, simulation → vrai, niveaux), en clics exacts, en 15 minutes au plus par équipe ; ce qui est déjà fait est retiré. Tout ce qui peut être demandé par le bot l'est (`HumanRequest`) : les demandes encore ouvertes sont relancées une fois dans l'ordre, et la commande `demandes` les liste ; seules les actions impossibles par Telegram (créer un bot dans @BotFather, souscrire un service) restent décrites en clics.
- Mise en route d'une équipe par Telegram : « vrai <équipe> » → le bot résume ce qui va se passer (canaux concernés, quota, niveau) et demande « Réponds OUI pour confirmer » ; de même « niveau <équipe> <0|1|2> ». Testé avec le faux Telegram.
- `docs/STATUS.md` : état final des phases 19 à 25, chiffres des tests, limites connues, suites possibles (sans les lancer).
- `pnpm lint && pnpm typecheck && pnpm build && pnpm test` ; sauvegarde ; déploiement ; santé ; captures ; commit ; push.
- **Bilan complet Telegram** (c'est la fin de la chaîne : plusieurs messages courts sont permis, 5 lignes chacun) : ce qui existe maintenant (une ligne par équipe), ce qu'il doit faire pour démarrer (renvoi à `A-FAIRE-HUMAIN.md`, les 3 premières actions en clair), le test de 5 minutes, les coûts à prévoir, et « Réponds "fait" quand c'est fait ». Puis crée `docs/PHASE-DONE` (date + « Phases 19 à 25 (agents IA) terminées, testées et déployées ») et arrête-toi.

## Fini quand
- Tableau de bord complet en ligne ; conversation Casino / Paris prête (désactivée par défaut, identité assistante imposée) ; scénario complet sur 3 jours simulés vert ; relecture adverse faite et corrigée ; guide, aide, captures, docs à jour ; déploiement vérifié ; bilan complet envoyé ; `docs/PHASE-DONE` créé.
