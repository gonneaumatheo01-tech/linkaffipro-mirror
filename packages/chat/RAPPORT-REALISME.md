# Rapport d'analyse : tout ce qui casse le réalisme de Léa

Audit du module `packages/chat` — persona GIRL en mode illusion.

---

## CRITIQUE — casse l'illusion pour n'importe qui

### 1. Le deuxième message arrive trop vite et au même rythme
**Fichier** : `rhythm.ts:44-45`, `engine.ts:671-673`
**Constat** : entre le 1er et le 2e message du même tour, le délai est `typingDelayMs(text)` pur — proportionnel à la longueur du texte, sans ouverture préalable. Une vraie personne qui tape un deuxième message fait une mini-pause de réflexion (1-3 s) *avant* de taper. Ici, le « écrit… » redémarre immédiatement. Résultat : deux messages qui arrivent avec une régularité mécanique (400 ms + 110 ms/car).
**Recommandation** : ajouter un délai aléatoire de 800 à 2500 ms avant le `typingDelayMs` du 2e message (la constante `pauseBetweenMs` existe dans `rhythm.ts:101-109` mais n'est jamais appelée dans `sendParts`).

### 2. La photo de chauffe arrive dans le même message que le texte
**Fichier** : `engine.ts:711-714`, `sendParts` lignes 710-718
**Constat** : la photo est jointe comme média du *dernier message* du tour : texte + photo partent ensemble. Une vraie fille enverrait la photo comme message séparé, quelques secondes après un « attends jte montre ». L'envoi groupé texte + photo en pièce jointe est un schéma de bot.
**Recommandation** : séparer l'envoi photo du message texte, avec un `typingDelayMs` entre les deux.

### 3. Le lien d'offre colle au texte sans pause
**Fichier** : `engine.ts:676-683`, `sendParts` lignes 693-708
**Constat** : quand `withOffer` est vrai, le bouton ou l'URL est ajouté au dernier message du tour, envoyé d'un bloc. Le texte dit « je te mets le lien » et le lien apparaît dans la même bulle. Une vraie fille écrirait le texte, *puis* collerait le lien dans un message suivant. L'apparition simultanée texte + bouton est artificielle.
**Recommandation** : quand `withOffer`, scinder en deux envois : d'abord le texte, puis le lien après un court délai.

### 4. Fallback « isAssistant » utilisable en mode illusion
**Fichier** : `texts.ts:140-148`, `engine.ts:542`
**Constat** : si le modèle échoue deux fois sur un tour où la personne demande « t'es un bot ? », `safeFallbackKey` renvoie `"isAssistant"` et le texte fixe est `ILLUSION_IS_ASSISTANT` — « non, une vraie fille 😊 ». C'est cohérent. Mais si le tour tombe sur le fallback générique `"intro"`, le texte GIRL intro est « coucou 😊 » — hors contexte au milieu d'une conversation. Un tour en échec qui repart sur « coucou » au 10e message casse le réalisme.
**Recommandation** : ajouter un fallback GIRL spécifique pour les tours non-premiers (ex. « ah une seconde » ou « jte dis ça »).

---

## ÉLEVÉ — remarqué par quelqu'un qui fait attention

### 5. Les délais d'ouverture ne tiennent pas compte de l'heure réelle
**Fichier** : `rhythm.ts:76-98`
**Constat** : `openingDelayMs` dépend du délai de réponse de la personne et de l'intérêt, mais pas de l'heure. Un message reçu à 3 h du matin reçoit la même réponse en 22-165 s qu'un message de 14 h. Une vraie fille ne répondrait pas à 3 h 12 en 30 secondes (soit elle dort, soit elle répond avec un long délai).
**Recommandation** : ajouter un facteur horaire : entre 1 h et 7 h (Paris), multiplier le délai d'ouverture par 3-10x, ou retarder la réponse à 8-9 h.

### 6. Le résumé roulant efface le contexte et provoque des incohérences
**Fichier** : `prompt.ts:333`, `memory.ts`
**Constat** : le modèle ne voit que 20 messages + un résumé de 1500 caractères des échanges antérieurs. Si la conversation dure (30+ messages), les détails personnels qu'elle a dits tombent du contexte. Le modèle peut alors redemander son prénom ou sa ville. Le prompt interdit ça (ligne 277 : « ne redemande jamais ce qui vient d'être dit ») mais le modèle n'a plus l'information.
**Recommandation** : les `memory_facts` atténuent le problème mais le modèle ne recopie pas toujours tout. Vérifier que `mergeFacts` reprend systématiquement les faits critiques (prénom, âge, ville) même quand le modèle les oublie dans `memory_facts`.

### 7. Le prompt encourage à annoncer le lien sans garantir qu'il parte
**Fichier** : `prompt.ts:186-190`
**Constat** : la section CONVERSION dit explicitement « tu dis "attends je t'envoie le lien" et tu mets send_offer: true ». Le modèle obéit et écrit l'annonce, mais côté flirt `allow` peut ne contenir que `["rien"]`. Le texte part, le lien ne part pas. C'est le bug corrigé par le lien armé (tâche 4), mais le prompt reste contradictoire : il dit d'annoncer le lien dans un champ (`send_offer`) qui n'a plus d'effet quand la série de photos est active (la machine à états de flirt l'emporte).
**Recommandation** : quand `flirt.allow` ne contient pas `"lien"`, la section CONVERSION devrait dire au modèle de ne pas annoncer de lien. Ou bien — puisque le lien armé existe maintenant — accepter la contradiction et s'assurer que l'annonce est toujours suivie d'un envoi.

### 8. Le mode « refused » (refus de l'app) répond en 1 à 3 heures
**Fichier** : `rhythm.ts:41-42`, `engine.ts:657`
**Constat** : quand `appRefused` est vrai, l'ouverture est entre 1 h et 3 h. En soi, c'est réaliste (elle ne répond plus beaucoup ici). Mais le délai est appliqué à TOUS les messages suivants, même si la personne continue de parler. Si elle envoie 3 messages de suite, chaque réponse met 1 à 3 h → la conversation est morte de fait. Une vraie fille qui « ne répond plus trop ici » répondrait quand même en quelques minutes si elle ouvre l'app et voit les messages.
**Recommandation** : en mode `refused` + `live` (personne encore là), réduire à 5-15 min.

---

## MOYEN — perçu comme un tic de bot sur la durée

### 9. Répétition du pattern « question en fin de message »
**Fichier** : `prompt.ts:275-276, 478`
**Constat** : le prompt insiste 4 fois sur « termine presque toujours par une question courte ». Le modèle obéit trop bien : chaque message se termine par une question. Sur 10 échanges, 10 questions à la fin = pattern reconnaissable. Les vraies filles enchaînent parfois 2-3 messages sans question (réaction, vanne, histoire).
**Recommandation** : adoucir la consigne : « pose une question quand c'est naturel, pas à chaque message. Parfois tu peux juste réagir. »

### 10. Les relances sont mécaniques
**Fichier** : `follow-ups.ts:69-88`
**Constat** : 1re relance après `followUpAfterHours` (4 h min), 2e après 24 h. Le timing est fixe (modulo les heures calmes). Deux relances espacées exactement de 24 h = mécanique. Une vraie personne relancerait à des moments irréguliers.
**Recommandation** : ajouter un jitter de ±2 h sur la 2e relance.

### 11. Le « écrit… » est toujours proportionnel à la longueur du texte
**Fichier** : `rhythm.ts:52-56`
**Constat** : `typingDelayMs = min(12s, 400ms + 110ms × len)`. Un message de 5 caractères = 950 ms, un message de 50 caractères = 5,9 s. C'est linéaire et prévisible. Une vraie personne hésite, efface, repart — le « écrit… » apparaît par saccades.
**Recommandation** : impossible de simuler les saccades (Telegram ne le montre pas côté récepteur), mais un jitter de ±30 % rendrait le timing moins prédictible.

### 12. La validation rejette le contenu explicite hors illusion
**Fichier** : `validate.ts:875`
**Constat** : `hasExplicitContent(joined) && !illusion` — en mode illusion, le contenu explicite passe. C'est voulu. Mais `hasExplicitContent` est un filtre basique qui pourrait laisser passer des termes très crus. Le prompt dit « les mots crus sont autorisés » mais aucune limite graduelle n'existe : le modèle peut passer de « tu me plais » à un mot très explicite en un tour.
**Recommandation** : un contrôle de progression : si l'échange n'est pas « hot » (`interest < 7`, pas de sex talk récent), rejeter les mots très crus pour forcer la montée en température.

---

## BAS — amélioration de confort

### 13. Pas de variation dans l'intro
**Fichier** : `texts.ts:114` — `GIRL_FIXED_TEXTS.fr.intro = "coucou 😊"`
**Constat** : toutes les personas GIRL commencent par « coucou 😊 ». Si quelqu'un parle à deux bots, c'est le même premier message.
**Recommandation** : pool de variantes (« hey 👋 », « salut 😊 », « coucou ca va ? »), choisie aléatoirement.

### 14. Les heures calmes sont identiques pour tout le monde
**Fichier** : `follow-ups.ts:8-11`
**Constat** : 22 h – 9 h (Paris) pour tout le monde. Si la personne est au Brésil ou au Canada, les heures calmes ne correspondent pas à son fuseau.
**Recommandation** : utiliser le fuseau de la personne (estimé par sa langue ou son historique d'activité) pour ajuster les heures calmes.

### 15. Pas de fautes de frappe ni de corrections
**Constat** : le modèle produit un texte parfait à chaque tour. Les vrais messages ont des coquilles, des « * » de correction. Le prompt ne mentionne pas les fautes.
**Recommandation** : ajouter au prompt « tu peux faire une faute de frappe de temps en temps et te corriger dans le message suivant (ex. "je sias", puis "suis*") ».

---

## Résumé par priorité

| # | Sévérité | Résumé | Fichier |
|---|----------|--------|---------|
| 1 | Critique | 2e message sans pause de réflexion | `rhythm.ts`, `engine.ts:671` |
| 2 | Critique | Photo jointe au texte au lieu de message séparé | `engine.ts:711` |
| 3 | Critique | Lien collé au texte sans délai | `engine.ts:676` |
| 4 | Critique | Fallback intro hors contexte en pleine conversation | `texts.ts:114`, `engine.ts:542` |
| 5 | Élevé | Pas de facteur horaire dans les délais | `rhythm.ts:76` |
| 6 | Élevé | Résumé trop court efface le contexte | `prompt.ts:333` |
| 7 | Élevé | Prompt encourage l'annonce du lien sans garantir l'envoi | `prompt.ts:186` |
| 8 | Élevé | Refused + live = réponse en heures | `rhythm.ts:41` |
| 9 | Moyen | Question systématique en fin de message | `prompt.ts:275` |
| 10 | Moyen | Relances mécaniques (délai fixe) | `follow-ups.ts:69` |
| 11 | Moyen | Typing toujours proportionnel à la longueur | `rhythm.ts:52` |
| 12 | Moyen | Pas de progression dans l'explicite | `validate.ts:875` |
| 13 | Bas | Intro identique pour toutes les personas | `texts.ts:114` |
| 14 | Bas | Heures calmes fixes (Paris) pour tout le monde | `follow-ups.ts:8` |
| 15 | Bas | Pas de fautes de frappe | prompt seulement |
