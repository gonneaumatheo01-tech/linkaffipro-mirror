Un fichier par file BullMQ. Chaque fichier exporte `processXxx(job)` et `repeatableXxx` (tâches périodiques).
Propriétaires : approvals → chantier A ; scheduler et telegram-send → chantier C ; sync-linkaffi → chantier D ; stats → chantier E.
Ne pas modifier `index.ts` ni `queues.ts` : ils sont déjà branchés.

Phase 14 (demandes bloquées sur « Attend les canaux ») :

- `approvals` : `gate-sweep` toutes les 2 minutes (filet de la validation automatique des canaux obligatoires, demandes
  de moins de 7 jours : nos données pour toutes, puis `getChatMember` dans la limite de 30 appels par bot, jamais
  vérifiées d'abord puis les moins récemment vérifiées ; après un 429, aucun appel de ce bot avant la fin de
  `retry_after`, même aux passages suivants ; le premier passage fait le rattrapage unique si la marque `Setting`
  `phase14.gateBackfill` manque : états « joignable / a bloqué le bot » hérités réparés, accueils par défaut réécrits,
  demandes en attente revérifiées), `reminder` (rappel d'une demande à l'heure, tâche différée enfilée par le bot pour
  les rappels de moins de 5 minutes), `gate-backfill` (rattrapage forcé : `{ type: "gate-backfill", force: true }`).
- `telegram-send` : `approve` / `decline` (« Tout accepter » de l'onglet Demandes) traités ici, au rythme permis par
  Telegram, jamais sur une demande qui n'est plus en cours (`approvals/queued-decisions.ts`).
- Type de tâche inconnu (`approvals` comme `telegram-send`) : signalé dans les journaux (« type de tâche inconnu »)
  et rendu `{ ok: false }`, jamais terminé en silence comme une tâche réussie.

Ordre de déploiement de la phase 14 : **worker d'abord**, vérifier sa santé (`/api/health`, `workerHeartbeatAgeSec`
récent), puis le site. Un ancien worker ne connaît ni la tâche `approvals` `reminder` (rappel à 4 minutes : perdu
s'il tombe pendant l'écart, la fenêtre de 5 minutes est passée quand le nouveau worker arrive) ni les tâches
`telegram-send` `approve` (« Tout accepter » : terminées sans rien faire ; la demande n'est acceptée qu'à l'heure de
secours posée par le site, 10 minutes plus tard). Le nouveau worker accepte tout ce que produit l'ancien site (liens
`/start g…`, anciennes tâches) et aucune migration n'est prévue. Ne pas utiliser « Tout accepter » avant la fin des
deux déploiements.

Phase 15 (pages d'atterrissage) :

- `landing-events` (`landing-events.ts`, logique dans `apps/worker/src/landing/`) : `event` = une visite (VIEW), un
  clic (CLICK) ou une ouverture de Telegram (OPENED) envoyé par une page (`/j/_e`) et mis en file par le site après sa
  réponse 204. Une ligne `LandingEvent` par envoi, identifiant fixé par le site (`createMany` + `skipDuplicates` :
  une reprise n'écrit jamais deux fois), page retrouvée par identifiant ou adresse, source inconnue → source par
  défaut "" et valeur reçue dans `rawSrc`, page inconnue ignorée (`{ ok: false, reason: "unknown-page" }`, la tâche
  se termine). Jamais d'adresse IP (empreinte et pays calculés par le site). 8 à la fois.
- Aucune tâche périodique : les visites plus anciennes que `retention.months` (24 mois par défaut) sont supprimées par
  la purge de nuit (`maintenance/purge.ts` → `deleteLandingEventsBefore`).
- Ordre de déploiement : le worker peut partir avant ou après le site (le site ne met rien en file tant qu'aucune page
  n'existe ; un ancien worker ne lit pas cette file : les envois y attendent le nouveau, rien n'est perdu).

Phase 19 (agents IA : Grand Chef, Chefs d'équipe, agents — logique dans `packages/agents`, adaptation dans
`apps/worker/src/agents/`) :

- `agents-orchestrator` (`agents-orchestrator.ts`, Grand Chef, aucun appel d'IA) : `cycle` toutes les 30 min et à la
  demande (question unique du rapport du matin, plan du jour, reprise, validations sans réponse, demandes au client,
  rapport de 9 h Paris), `resume` toutes les 10 min (missions sans activité depuis 15 min ré-enfilées ; validations
  décidées dont la reprise a échoué reprises), `human-requests` toutes les 5 min, `validations` toutes les 15 min
  (24 h : reportée au lendemain + rappel ; 72 h : annulée), `report` (rapport forcé). Un passage à la fois.
- `agents-dating`, `agents-casino`, `agents-sports`, `agents-algo` (`agents-<équipe>.ts` → `agents/step.ts` →
  `runNextStep`) : une étape de mission ; **nom de la tâche = clé de l'agent** (`redaction`, `controle`…),
  identifiant `<missionId>-<index>` (idempotent ; une tâche terminée du même identifiant est remise par le balayage).
  2 étapes à la fois par équipe. Étape déjà faite ou index dépassé : ignorée. Équipe en pause ou pause générale :
  rien n'est fait, la mission attend.
- `agents-ads` : prévue pour la phase 24, aucune tâche ; tout type est inconnu (`{ ok: false }`).
- Une tentative BullMQ par tâche : le moteur réessaie une fois l'étape, puis la mission échoue ; 3 missions échouées de
  suite → équipe en pause (alerte `agents_team_paused` au passage d'alertes suivant).
- Publication : un `Post` programmé (canal Test en simulation), envoyé par `scheduler` / `telegram-send` comme les
  messages du site.
- Purge : missions (et leurs passages) de plus de `retention.months` supprimées la nuit.
- Ordre de déploiement : site d'abord (migration), puis worker.
