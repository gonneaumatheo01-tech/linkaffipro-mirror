# Phase 17 — Assistant de conversation dating (bot officiel, assumé comme assistant)

Si `docs/STATUS.md` indique déjà « phase 17 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/STATUS.md` (phase 16), `docs/DECISIONS-TECH.md`, puis `packages/telegram` (factory, handlers `offers.ts`, `join-flow.ts`, `i18n.ts`, offres et sub-ID), `packages/ai` (le pipeline prompt → JSON strict → validation → un seul nouvel essai sert de modèle), les modèles `Bot`, `Member`, `Click`, `TrackingLink`, `OutboundMessage`, et la rubrique Réglages → Bots. Décisions techniques courantes : prends-les toi-même et note-les dans `docs/DECISIONS-TECH.md`. **Décision importante que cette consigne ne tranche pas** (choix visible par le client, coût, contenu envoyé aux personnes) : pose la question au client sur Telegram (courte, en mots simples, 2 ou 3 choix avec ta recommandation en premier), et avance sur une autre étape pendant ce temps. Pour ces décisions-là, ne tranche pas toi-même au bout de 20 minutes (exception voulue par le client) : garde la question ouverte, relance-la une fois sur Telegram après 1 heure, et si tout le reste est fait, attends sa réponse (boucle `sleep 60` puis `pnpm tg:inbox`). Phase plus grosse que les précédentes : livre par étapes testables, dans l'ordre ci-dessous, avec un commit et un court message Telegram à la fin de chaque étape.

## Étapes
1. Données (Prisma, migration) et réglages Venice (clé chiffrée, bouton « Vérifier », liste des modèles).
2. Moteur `packages/chat` (prompt, sortie JSON, validation, style, mémoire, parcours) avec faux client, sans Telegram.
3. Branchement sur le bot (webhook → file → worker → réponses, rythme, lien suivi, `/stop`, `/reset`, relances).
4. Admin : Personas (avec « Tester »), Inbox et reprise en main, Stats, Réglages.
5. Tests de bout en bout, déploiement, guide, bilan.

## But
Un **nouveau bot dédié** de l'univers dating, qui discute en privé avec les personnes qui lui écrivent d'elles-mêmes (après `/start`, depuis un canal, une page ou une pub), s'adapte à leur ton, présente l'app de dating et envoie au bon moment le lien d'affiliation suivi.

Tout est piloté depuis la plateforme : personas, réglages, inbox avec reprise en main humaine, et statistiques par source jusqu'à l'inscription et au dépôt.

## Règles non négociables (décision du client, 18 octobre)
1. **Bot officiel uniquement (Bot API, grammY).**
   - Ni compte utilisateur ni MTProto pour cette fonction. Ne touche ni à `packages/mtproto` ni à la session `main`.
   - Le bot ne fait **aucune prise de contact à froid** : il répond seulement aux personnes qui ont lancé la conversation (c'est aussi la règle Telegram).
2. **Assumé comme assistant.**
   - La persona est l'assistante ou l'assistant du canal : un prénom, une personnalité et un ton, mais jamais une vraie personne.
   - Le premier message le dit en une phrase naturelle (par exemple « moi c'est Léa, l'assistante du canal 😉 »). La description du bot (`setMyDescription`, `setMyShortDescription`) le dit aussi.
   - Si la personne demande si c'est un bot, une IA ou une vraie personne, l'assistant répond franchement, sans casser le ton.
   - Aucune option pour cacher qu'il s'agit d'un assistant, et aucun envoi de « selfies » présentés comme des photos personnelles.
   - Les médias envoyés sont des visuels de l'app ou de l'offre.
3. **Adultes uniquement.**
   - Si la personne indique avoir moins de 18 ans : arrêt poli, pas de lien, conversation marquée « mineur » et fermée.
   - Flirt léger permis dans le ton, jamais de contenu explicite (règles Telegram).
4. **Honnêteté sur l'offre** : n'invente ni chiffres, ni promesses (« des filles près de chez toi t'attendent »), ni faux témoignages. L'assistant présente l'app avec les éléments écrits dans la fiche de l'offre.
5. **Pas de spam.**
   - Au plus 2 relances après un silence, espacées d'au moins 24 h, puis plus rien.
   - `/stop` arrête tout, définitivement.
   - Respect des blocages et des limites de `CLAUDE.md` (1 message/s par chat, 429 `retry_after`).
6. **Désactivé par défaut.** L'assistant ne répond à personne tant qu'un admin ne l'a pas activé dans l'admin (règle de `CLAUDE.md` sur le contact des membres). Les tests se font sur le bot de test.

## Architecture
- Nouveau paquet `packages/chat` (le moteur), indépendant de grammY. Il passe par une petite interface d'envoi (`sendText`, `sendTyping`, `sendButtons`, `sendMedia`), que le bot implémente et qu'un faux client implémente dans les tests.
- Réception :
  - le webhook du bot (déjà existant pour les bots) met chaque message entrant en file ;
  - le **worker** traite la file, **un seul message à la fois par conversation**, dans l'ordre, avec un anti-double-réponse.
  - Les messages reçus pendant qu'une réponse se prépare sont regroupés dans le même tour.
- Un bot passe en mode assistant par un réglage du bot dans Réglages → Bots (« Mode : assistant de conversation » + persona liée). Les autres bots ne changent pas.
- Le lien d'affiliation passe par le système existant d'offres, de sub-ID et de `Click` : bouton inline, sub-ID unique par conversation et par envoi, conversions remontées par Link Affi et les postbacks comme aujourd'hui.

## IA : API Venice (choix du client)
- Compatible OpenAI : `POST https://api.venice.ai/api/v1/chat/completions`, en-tête `Authorization: Bearer`.
- Avant de coder, **vérifie dans la documentation officielle de Venice** (docs.venice.ai) les noms exacts :
  - des paramètres (`venice_parameters` : `include_venice_system_prompt: false`, et la façon de couper le raisonnement) ;
  - de `response_format` en `json_schema` ;
  - de la liste des modèles (`GET /models`).
  
  Note dans `docs/DECISIONS-TECH.md` ce qui est confirmé.
- Modèle par défaut choisi dans les réglages parmi la liste renvoyée par `/models` (suggestion du client : `venice-uncensored-role-play`, repli moins cher au choix).
- Réglages de départ : `temperature` 0,85, environ 400 jetons en sortie.
- Clé chiffrée dans `Setting` `assistant.venice`, jamais renvoyée au navigateur, avec un bouton « Vérifier ». Plafond mensuel en € et limite de messages par jour et par conversation.
- Journal `AiConversationUsage` (persona, conversation, modèle, jetons, coût estimé), sur le modèle d'`AiSuggestion`.
- 429/5xx : nouvel essai borné, puis modèle de repli, puis message neutre (« je reviens vers toi dans un instant ») et alerte admin.
- Les règles 2 à 4 sont dans le prompt système **et** vérifiées par le code après la réponse :
  - pas de markdown ;
  - messages courts ;
  - pas de lien autre que le bouton prévu ;
  - pas de déni d'être un assistant quand la question est posée.
  
  Une réponse non conforme est rejetée et refaite une fois.

## Moteur de conversation
- **Contexte envoyé au modèle** :
  - prompt système (persona + règles + profil de style courant + étape du parcours) ;
  - résumé roulant ;
  - 20 derniers messages ;
  - faits retenus sur la personne, seulement ce qu'elle a dit elle-même (prénom, ville, goûts).
- **Sortie JSON stricte**, validée par le code :
  `{ "messages": [{ "text": "…" }], "style_update": {…}, "stage": "…", "send_offer": false, "memory_facts": [], "note_interne": "…" }`.
- **Rythme naturel, mais sans attente pénible** :
  - indicateur « écrit… » (`sendChatAction typing`) ;
  - délai proportionnel à la longueur, de 1 à 4 s ;
  - réponse découpée en 1 à 3 messages courts, avec 1 à 2 s entre eux.
- **Style adaptatif** : `styleProfile` JSON sur la conversation (longueur moyenne, emojis, registre, langue, ton timide / direct / dragueur / sec / bavard, niveau d'intérêt), mis à jour à chaque tour et réinjecté. La langue de réponse suit celle de la personne (langues de `i18n.ts`).
- **Parcours** : `ACCUEIL → DISCUSSION → PROPOSITION → LIEN_ENVOYÉ → RELANCE → CONVERTI → FERMÉ`.
  - Le lien part quand les règles de la persona le permettent (au moins N échanges, intérêt détecté) **et** que le modèle le propose. Jamais au premier message.
  - Chaque passage d'étape est un `ConversationEvent`.
- **Commandes** : `/start` (avec la source en paramètre), `/stop`, `/reset` (efface l'historique de la personne).

## Données (Prisma)
- `Persona` : nom, personnalité, ton, langues, intérêts, prompt additionnel, modèle et température, règles du parcours, offre liée, active.
- `Conversation` : bot, membre (`Member` existant), persona, source du `/start`, étape, `styleProfile`, résumé, faits retenus, statut `BOT | HUMAIN | PAUSE | FERMÉ`, mineur, `stoppedAt`.
- `ConversationMessage` : sens, texte, média, méta, auteur (assistant ou membre de l'équipe).
- `ConversationEvent`.
- `AiConversationUsage`.
- Conservation : même purge que les données personnelles (24 mois, réglable) ; `/reset` et la suppression d'un membre effacent la conversation.

## Admin (apps/web)
- **Personas** : fiche, aperçu du prompt, réglages du parcours, offre liée, et bouton « Tester » (conversation simulée dans la page, sans Telegram).
- **Inbox** :
  - liste des conversations (filtres : étape, statut, source, persona) et fil en direct ;
  - « Prendre la main » (l'assistant se tait pour cette conversation), « Rendre à l'assistant », envoi manuel d'un message, blocage, fermeture.
  - Les messages de l'équipe apparaissent dans le fil et dans l'historique envoyé au modèle.
- **Stats** :
  - par persona et par source de `/start` : conversations, réponses, liens envoyés, clics, inscriptions, dépôts, coût IA ;
  - entonnoir par étape.
- **Réglages → IA de conversation** : clé Venice, modèles, plafond €, limites, activation générale.
- Journal : famille « Assistant de conversation ».

## Actions humaines (dans `docs/STATUS.md`, expliquées très simplement)
- Créer le nouveau bot dans BotFather et coller son jeton dans Réglages → Bots.
- Créer la clé Venice et la coller dans les réglages.
- Activer l'assistant quand le test est concluant.

## Tests et livraison
- **Tests unitaires** :
  - construction du prompt ;
  - validation de la sortie (rejet d'un markdown, d'un lien étranger, d'un déni d'être un assistant, d'un message trop long) ;
  - parcours et règle « jamais de lien au premier message » ;
  - mineur → arrêt sans lien ;
  - `/stop` ;
  - relances (au plus 2, à 24 h d'écart) ;
  - file ordonnée et anti-double-réponse ;
  - plafond € ;
  - prise de main humaine (l'assistant ne répond plus) ;
  - sub-ID unique par envoi.
- **Faux client Venice et faux Telegram** : aucun appel réseau dans les tests.
- **Une conversation de bout en bout simulée** sur le bot de test : `/start` avec source → 4 échanges → lien → clic → conversion de test.
- `pnpm lint && pnpm build && pnpm test` verts, migration appliquée, déploiement vérifié, `docs/STATUS.md` et guide à jour, commit et push.
- **Bilan Telegram en 3 lignes**, avec le test à faire par le client : ouvrir le bot de test, écrire comme un vrai prospect, regarder l'inbox et la prise en main. Puis `docs/PHASE-DONE`.
