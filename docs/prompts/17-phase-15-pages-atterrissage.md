# Phase 15 — Pages d'atterrissage Telegram ultra-rapides (rubrique « Pages »)

Si `docs/STATUS.md` indique déjà « phase 15 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/REFONTE-UX.md`, `docs/DESIGN-SYSTEM.md`, `docs/STATUS.md` (la phase 14 vient de changer le flux d'adhésion : respecte-la), puis le code :
- domaine de tracking : `apps/web/proxy.ts`, `apps/web/app/r/` ;
- liens d'invitation : `InviteLink`, ses types et sa provenance (phase 11), `packages/telegram/src/join-flow/` ;
- campagnes, pubs et dépenses : `Campaign`, `AdSet`, `Ad`, `DailyStat`.

Mode autonome, décisions dans `docs/DECISIONS-TECH.md`. Communication : la règle de `CLAUDE.md` (un seul message Telegram en fin de phase). Une vraie question bloquante peut partir sur Telegram ; sans réponse en 20 minutes, prends la décision raisonnable et continue.

## Demande du client (texte exact, 15 octobre)

NOUVELLE FONCTIONNALITÉ : pages d'atterrissage Telegram ultra-rapides

CONTEXTE
Je fais de la pub (TikTok, Meta, régies) qui envoie vers mes canaux Telegram. Aujourd'hui je perds jusqu'à 88 % des clics entre la pub et Telegram (redirections lentes dans le navigateur intégré de TikTok). Je veux une page d'atterrissage la plus rapide et la plus simple possible, créée et suivie directement depuis notre plateforme.

1. LA PAGE (CÔTÉ VISITEUR)
- Un seul écran mobile, sans défilement. Dans cet ordre :
  • le nom réel du canal (voir Règles)
  • une phrase d'accroche (saisie dans l'admin)
  • un sous-texte court, optionnel
  • un gros bouton « Rejoindre le canal → » (texte modifiable), bleu Telegram, pleine largeur, dans la zone du pouce
  • une petite ligne optionnelle sous le bouton (ex. « Gratuit · 1 clic · via Telegram »)
- Photo : option, désactivée par défaut. Aucun pied de page, menu, autre lien ou pop-up.
- Langue choisie par page (français par défaut, multi-langue comme le reste de la plateforme).

2. VITESSE (À MESURER)
- HTML rendu côté serveur, CSS en ligne, zéro framework, zéro police externe (polices système).
- Poids < 15 Ko hors pixels. Page mise en cache, cache vidé quand je modifie la page.
- Pixels chargés en asynchrone APRÈS l'affichage : ils ne bloquent jamais le rendu ni le bouton.
- Objectif : affichage complet < 1 s en 4G simulée. Mesure avec Lighthouse mobile et donne-moi le score.
- Servie sur goolink.eu (ex. https://goolink.eu/j/<slug>?src=tk01). Aucune redirection avant la page.

3. LE CLIC
- Canaux privés sur demande d'adhésion : le bouton essaie d'abord d'ouvrir l'appli Telegram (tg://join?invite=…), puis bascule sur https://t.me/+… si l'appli ne s'ouvre pas.
- Teste dans les navigateurs intégrés TikTok et Instagram, iPhone et Android (émulation si besoin), et garde la méthode la plus fiable.
- Pas de redirection automatique : le visiteur clique.

4. SOURCES ET LIENS D'INVITATION
- Pour chaque page, j'ajoute des sources (ex. tk01, tk03, exo1).
- Pour chaque source, la plateforme crée automatiquement un lien d'invitation via le bot de l'univers du canal (createChatInviteLink, creates_join_request = true, nom = <page>-<source>).
- La page lit ?src= et utilise le lien de cette source ; sinon le lien par défaut de la page.
- Réutilise le système d'attribution par lien d'invitation déjà prévu pour les affiliés partenaires s'il existe, ne le duplique pas.

5. SUIVI
- Pixel TikTok et pixel Meta : champs optionnels par page. Événements : PageView à l'affichage, ClickButton (TikTok) et Contact (Meta) au clic.
- Enregistre aussi côté serveur, sans ralentir (sendBeacon) : visite et clic, avec source, pays, appareil, et ttclid/fbclid s'ils sont dans l'URL (pour un futur renvoi des joins via Events API / Conversions API, ne pas le construire maintenant).
- Relie les demandes d'adhésion (chat_join_request) et les acceptations à la page + source via le lien d'invitation.
- Bandeau cookies : option par page, désactivée par défaut. Si activée, les pixels ne se chargent qu'après accord ; bandeau fin en bas qui ne cache jamais le bouton.

6. DANS LA PLATEFORME
- Nouvelle rubrique « Pages », ultra simple (je trouve déjà le site trop compliqué : minimum de mots et de boutons).
- Créer une page = un seul formulaire : canal, accroche, sous-texte, texte du bouton, langue, pixels, bandeau cookies, sources. Aperçu mobile en direct à côté.
- Pour chaque source, un bouton « Copier le lien » (celui à coller dans la pub).
- Tableau par page et par source, avec filtre de dates : visites, clics, % de clic, demandes, acceptés, % visite → join. Si les dépenses pub de la source sont dans la plateforme : coût par join.

7. RÈGLES
- Le nom affiché est toujours le vrai titre du canal, récupéré via le bot (getChat) et mis à jour automatiquement. Il n'est pas modifiable à la main.
- La page montre la même chose à tout le monde : aucune détection de robots, de vérificateurs, d'IP, de pays ou de navigateur pour changer le contenu ou la destination.

8. FAÇON DE TRAVAILLER
- Comme d'habitude : avance seul, teste tout toi-même (vitesse, clic → Telegram, création des liens, comptage visites/clics/joins, stats) et enchaîne sans t'arrêter.
- Si tu as une vraie question, pose-la-moi sur Telegram via le bot du projet.
- À la fin, explique-moi en 3-4 phrases très simples comment créer une page et où copier le lien, plus le score Lighthouse obtenu.

## Précisions du chef de projet (elles complètent la demande, sans la changer)

1. **Adresse.**
   - IONOS refuse un CNAME sur `goolink.eu` nu. Le domaine qui pointe vers Railway est `go.goolink.eu`. Les pages sont donc servies en `https://go.goolink.eu/j/<slug>?src=<source>`, sans aucune redirection. Ajoute la route `/j/` à la branche tracking de `proxy.ts`.
   - Si tu trouves une façon propre de servir aussi `goolink.eu/j/…` sans redirection, note-la dans `docs/A-FAIRE-HUMAIN.md` (avec les clics exacts chez IONOS) ; ne la mets pas en place toi-même.

2. **Liens d'invitation.**
   - Nouveau type `InviteLink` `LANDING`, avec `landingPageId` et `landingSource`, créé par le bot de l'univers du canal. Repli sur un autre de nos bots administrateurs, comme pour les liens des canaux obligatoires.
   - Nom tronqué à 32 caractères (limite de Telegram).
   - La provenance et les compteurs existants (`incrementInviteLink`, demandes, entrées, `Membership.source.provenance`) servent tels quels : pas de second système. Les affiliés Link Affi (`LINKAFFI`) ne sont pas concernés.
   - Règles d'entrée (« Qui peut entrer ») : ajoute les provenances « une page d'atterrissage (toutes) » et « la page <nom> » aux exceptions de la phase 11.

3. **Source reliée à une pub.**
   - Dans le formulaire, chaque source peut être reliée, en option, à une pub d'une de nos campagnes. La dépense de cette pub donne le coût par join.
   - Une source non reliée affiche « — » pour le coût.

4. **Rapidité réelle.**
   - Aucune requête à la base de données pour afficher la page : HTML pré-rendu par page, langue et source, gardé en mémoire dans le service web et invalidé par Redis (publication) à chaque modification ou changement de titre du canal.
   - Visite et clic enregistrés via la file d'attente, jamais pendant la réponse.
   - Vérifie la région du service web Railway et mesure le temps de première réponse depuis le Mac. Si le service est hors d'Europe et que le changer ralentirait le reste (base de données), écris l'option dans `docs/A-FAIRE-HUMAIN.md` avec les chiffres au lieu de le changer.
   - En-têtes de cache adaptés : les chiffres sont comptés côté serveur, jamais par le cache.

5. **Le clic.**
   - Même contenu et même lien Telegram pour tout le monde. Seule la **façon technique d'ouvrir l'appli Telegram** peut s'adapter au système du téléphone : par exemple `intent://…` avec repli sur Android, `tg://join?invite=` puis `https://t.me/+…` sur iPhone. Ce n'est pas un changement de contenu ni de destination ; la règle 7 du client reste respectée.
   - Jamais plus de 150 ms d'attente avant d'ouvrir Telegram (les pixels et l'envoi au serveur partent en même temps, sans être attendus).
   - L'émulation ne reproduit pas parfaitement les navigateurs intégrés de TikTok et d'Instagram. Fais tes tests (Playwright avec leurs identifiants de navigateur, iPhone et Android). Ensuite, **enregistre pour chaque clic la méthode utilisée et si la page a été quittée dans les 2 secondes** (signe que Telegram s'est ouvert). Le tableau montre « % d'ouverture de Telegram » par système, pour que les vrais chiffres départagent les méthodes.
   - Recherche d'abord (WebFetch) les pratiques actuelles pour ouvrir Telegram depuis ces navigateurs intégrés, et note ta source dans `docs/DECISIONS-TECH.md`.

6. **Comptage.**
   - Les statistiques peuvent écarter les robots connus, comme les compteurs « humains seulement » existants. Rien de ce qui est affiché ni la destination ne change pour eux.
   - Pays : à partir de l'adresse IP sans la conserver (hachage existant `IP_HASH_SALT`), avec une base locale, sans service externe.

7. **Pixels.**
   - Identifiants vérifiés à la saisie.
   - Chargés après l'événement `load` (et `requestIdleCallback` si disponible) : PageView à l'affichage, ClickButton (TikTok) et Contact (Meta) au clic.
   - Garder `ttclid` / `fbclid` avec la visite et le clic.

8. **Interface.**
   - Rubrique « Pages » ajoutée au menu (demande explicite du client). Mets à jour `nav-logic.ts`, le test des anciennes adresses et le test de vocabulaire.
   - Un seul formulaire avec aperçu téléphone en direct, un bouton « Copier le lien » par source, un tableau par page et par source avec filtre de dates.
   - Respecte `docs/REFONTE-UX.md` : peu de mots, un bouton principal, le reste dans « Avancé ».

9. **Comparaison.** Dans le tableau, affiche en dessous, pour la même période et le même canal, les chiffres des liens directs des pubs (liens d'entrée existants). Le client verra si la page fait mieux que le lien direct.

## Tests et livraison
- Tests unitaires :
  - rendu de la page (poids < 15 Ko, aucun script bloquant, mêmes octets pour un robot et pour un visiteur) ;
  - choix du lien selon `src` ;
  - nom des liens tronqué ;
  - invalidation du cache ;
  - compteurs ;
  - % et coût par join.
- Tests d'intégration simulés : création d'une page avec 3 sources → 3 liens d'invitation (Telegram simulé) → visite → clic → demande d'adhésion par le lien de la source → acceptation → chiffres justes dans le tableau.
- Mesures réelles en production sur une page de test reliée au canal **TEST uniquement** :
  - Lighthouse mobile (score, temps d'affichage) ;
  - poids de la page ;
  - temps de première réponse depuis Paris.
- Aucune publicité, aucun message ni aucune action vers de vrais membres.
- `pnpm lint && pnpm build && pnpm test` verts, migration appliquée, déploiement vérifié, captures 1440 / 390 (rubrique Pages et page publique), `docs/STATUS.md` et guide (section « Pages ») à jour, commit et push.
- Bilan Telegram : 3-4 phrases très simples (créer une page, où copier le lien) + score Lighthouse. Puis `docs/PHASE-DONE`.
