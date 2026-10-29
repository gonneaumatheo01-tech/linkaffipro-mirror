/**
 * Définition des files BullMQ et des charges utiles des tâches.
 * Partagé entre le site (producteur) et le worker (consommateur).
 */
export const QUEUE_PREFIX = "lap";

export const QUEUE_NAMES = [
  "scheduler",
  "telegram-send",
  "approvals",
  "sync-linkaffi",
  "stats",
  "maintenance",
  "automations",
  "sync-ads",
  "sync-views",
  "custom-emoji",
  "linkaffi-events",
  "landing-events",
  "chat",
  // Agents IA (phase 19) : le Grand Chef, une file par équipe (nom de la tâche = clé de l'agent), Ads (phase 24).
  "agents-orchestrator",
  "agents-dating",
  "agents-casino",
  "agents-sports",
  "agents-algo",
  "agents-ads",
  // Phase 29 : équipe Analystes (veille du marché, règles des plateformes pub, rapports ; lecture réseau, 2 à la fois).
  "agents-analystes",
  // Phase 31 : équipe Prospection (canaux Telegram publics d'affiliés ; lecture réseau, 2 à la fois).
  "agents-prospection",
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * Tâches de la file `telegram-send` (tout envoi vers Telegram passe ici, avec les limites de débit).
 * `approve` / `decline` (phase 14, « Tout accepter » de l'onglet Demandes) : acceptation ou refus d'une demande encore
 * en cours, au rythme permis par Telegram ; `byUserId` : utilisateur du site qui l'a demandé (journal).
 */
export type TelegramSendJob =
  | { type: "dm"; outboundMessageId: string }
  | { type: "post"; postId: string }
  | { type: "delete-post"; postId: string }
  | { type: "approve"; membershipId: string; byUserId?: string | null }
  | { type: "decline"; membershipId: string; byUserId?: string | null };

/**
 * Tâches de la file `approvals` : balayages périodiques (acceptations échues, rappels, expirations) et, depuis la
 * phase 14, `gate-sweep` (filet de la validation automatique, toutes les 2 minutes), `reminder` (rappel d'une demande
 * à l'heure, tâche différée), `gate-backfill` (rattrapage unique des demandes en attente des canaux).
 */
export type ApprovalsJob =
  | { type: "tick" }
  | { type: "reminders" }
  | { type: "expirations" }
  | { type: "gate-sweep" }
  | { type: "reminder"; membershipId: string }
  | { type: "gate-backfill"; force?: boolean };

/** Tâches de la file `scheduler` (balayage des messages échus, expansion des envois groupés). */
export type SchedulerJob = { type: "tick" } | { type: "broadcast"; broadcastId: string };

/** Tâches de la file `sync-linkaffi`. */
export type SyncLinkAffiJob = { type: "tick"; full?: boolean; tables?: string[] };

/** Tâches de la file `stats` (recalculs). */
export type StatsJob =
  | { type: "post-stats"; postId: string }
  | { type: "tick" }
  | { type: "daily"; days?: number; full?: boolean }
  | { type: "reports"; force?: "daily" | "weekly" }
  | { type: "best-hours" };

/** Tâches de la file `automations` : événement métier à évaluer, ou reprise des étapes différées. */
export type AutomationsJob =
  | {
      type: "event";
      trigger:
        | "JOINED"
        | "OFFER_CLICKED"
        | "REGISTERED"
        | "DEPOSITED"
        | "LEFT"
        | "SPEND_LEVEL_REACHED"
        | "INACTIVE";
      memberId: string;
      context?: Record<string, unknown>;
    }
  | { type: "test"; ruleId: string; memberId: string }
  | { type: "tick" };

/**
 * Tâches de la file `maintenance` (purge 24 mois, alertes, purge des tâches échouées, sauvegardes, révocation des
 * anciens liens des canaux à rejoindre à entrée directe, phase 11 ; pages d'atterrissage, phase 15 : relecture des
 * titres et photos des canaux `landing-chats`, reprise des liens des sources `landing-links`).
 */
export type MaintenanceJob =
  | { type: "purge" }
  | { type: "alerts" }
  | { type: "clean-failed" }
  | { type: "backup" }
  | { type: "legacy-gate-links" }
  | { type: "landing-chats" }
  | { type: "landing-links" }
  /** Phase 26 : contrôle et réparation des connexions Telegram (webhooks) de nos bots, toutes les 10 minutes. */
  | { type: "webhook-repair" }
  | { type: "tick" };

/**
 * Reprise sur erreur par file (options par défaut des tâches ajoutées, et des tâches périodiques du worker).
 * - `telegram-send` : 3 tentatives, attente exponentielle (2 s, 4 s, 8 s). Les messages privés vérifient le statut
 *   `QUEUED` avant d'envoyer, donc une reprise après plantage ne renvoie jamais deux fois. ATTENTION : les messages
 *   de canal (`post`) sont enfilés avec `attempts: 1` explicitement (`sending/claim.ts`) : un plantage entre l'envoi
 *   Telegram et l'écriture en base ferait un doublon visible dans le canal.
 * - `sync-linkaffi` : 3 tentatives (30 s, 60 s, 120 s) ; chaque table a son curseur et un verrou `isRunning`.
 * - `stats` : 3 tentatives (10 s, 20 s, 40 s) ; recalculs idempotents, rapports marqués « envoyés » avant l'envoi.
 * - autres files : 1 tentative (balayages périodiques relancés de toute façon au prochain passage).
 */
export const JOB_RETRY_OPTIONS: Record<
  QueueName,
  { attempts: number; backoff?: { type: "exponential"; delay: number } }
> = {
  "telegram-send": { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
  "sync-linkaffi": { attempts: 3, backoff: { type: "exponential", delay: 30_000 } },
  stats: { attempts: 3, backoff: { type: "exponential", delay: 10_000 } },
  scheduler: { attempts: 1 },
  approvals: { attempts: 1 },
  maintenance: { attempts: 1 },
  automations: { attempts: 1 },
  // Synchros externes : reprise avec attente longue (quotas Meta / TikTok, FLOOD_WAIT Telegram).
  "sync-ads": { attempts: 3, backoff: { type: "exponential", delay: 60_000 } },
  "sync-views": { attempts: 2, backoff: { type: "exponential", delay: 60_000 } },
  // Emojis animés (phase 12) : aperçus par le Bot API, packs et état du compte par MTProto (FLOOD_WAIT possible).
  "custom-emoji": { attempts: 2, backoff: { type: "exponential", delay: 60_000 } },
  // Événements Link Affi (phase 13) : nouvelles tentatives gérées par la ligne LinkaffiEvent (nextAttemptAt, 24 h).
  "linkaffi-events": { attempts: 1 },
  // Pages d'atterrissage (phase 15) : écriture d'une visite ou d'un clic, sans doublon (identifiant fixé à l'ajout).
  "landing-events": { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  // Assistant de conversation (phase 17) : un seul essai ; la reprise passe par le balayage `sweep` (Postgres fait foi).
  chat: { attempts: 1 },
  // Agents (phase 19) : un seul essai BullMQ ; le moteur réessaie une fois l'étape et le balayage `resume` reprend
  // toute mission sans activité depuis 15 minutes (la base fait foi, étape idempotente).
  "agents-orchestrator": { attempts: 1 },
  "agents-dating": { attempts: 1 },
  "agents-casino": { attempts: 1 },
  "agents-sports": { attempts: 1 },
  "agents-algo": { attempts: 1 },
  "agents-ads": { attempts: 1 },
  // Phase 29 : 2 essais (reprise après 1 min) ; la base fait foi (une source lue repart de `nextScrapeAt`, une entrée déjà
  // vérifiée ou une alerte déjà envoyée ne l'est jamais deux fois).
  "agents-analystes": { attempts: 2, backoff: { type: "exponential", delay: 60_000 } },
  // Phase 31 : 2 essais (reprise après 1 min) ; la base fait foi (statut du prospect, repères des passages du jour).
  "agents-prospection": { attempts: 2, backoff: { type: "exponential", delay: 60_000 } },
};

/** File `sync-ads` (phase 7) : dépenses des comptes publicitaires connectés (Meta, TikTok). */
export type SyncAdsJob =
  | { type: "tick" }
  | { type: "connection"; connectionId: string; mode: "recent" | "full" | "backfill" }
  | { type: "rates" };

/** File `sync-views` (phase 7) : vues et transferts des messages de canal via le compte Telegram connecté. */
export type SyncViewsJob = { type: "tick" } | { type: "post"; postId: string };

/**
 * File `custom-emoji` (phase 12) : bibliothèque des emojis animés et publication par le compte Telegram connecté.
 * - `fetch-previews` : aperçus manquants (ou ceux de `customEmojiIds`) par le Bot API (`getCustomEmojiStickers` puis
 *   `getFile`), stockés dans `CustomEmoji.previewBytes` ;
 * - `import-account` : packs d'emojis installés sur le compte Telegram connecté (MTProto, sous `withMtprotoLock`) ;
 * - `account-status` : compte Premium ? administrateur avec le droit de publier dans ces canaux ? (MTProto) → `Setting`
 *   `mtproto.publishStatus` (forme `MtprotoPublishStatus` de @linkaffipro/core) ;
 * - `tick` : passage périodique (aperçus manquants, état du compte s'il date de plus d'une heure).
 */
export type CustomEmojiJob =
  | { type: "fetch-previews"; customEmojiIds?: string[] }
  | { type: "import-account"; requestedById?: string | null }
  | { type: "account-status"; channelIds?: string[] }
  | { type: "tick" };

/**
 * File `linkaffi-events` (phase 13) : envoi des événements des membres d'affiliés à la fonction Link Affi
 * `telegram-events` (corps signé HMAC). `deliver` : un événement (`LinkaffiEvent.eventId`) ; `tick` : passage
 * périodique (événements dus ou jamais mis en file, abandon après 24 h, alerte si la file est bloquée).
 */
export type LinkaffiEventsJob = { type: "deliver"; eventId: string } | { type: "tick" };

/**
 * Une visite, un clic ou une ouverture de Telegram sur une page d'atterrissage (phase 15), telle que le site la met en
 * file : une ligne `LandingEvent` à écrire, champ pour champ (sauf `createdAt`, en ISO). Jamais d'adresse IP : le site
 * calcule l'empreinte (`hashIp`) et le pays avant la mise en file. `id` est fixé à l'ajout (`enqueueLandingEvent`) :
 * le worker écrit avec cet identifiant et ignore un doublon (`createMany` + `skipDuplicates`), une reprise n'écrit
 * jamais deux fois.
 */
export type LandingEventData = {
  /** Identifiant de la ligne `LandingEvent` (aléatoire, fixé à l'ajout). */
  id: string;
  landingPageId: string;
  /** Phase 16 : aussi HELP (aide affichée), ESCAPED (sortie de l'appli) et AUTO_OPEN (ouverture automatique). */
  type: "VIEW" | "CLICK" | "OPENED" | "HELP" | "ESCAPED" | "AUTO_OPEN";
  /** Identifiant aléatoire de la visite (créé par la page ; `vid` de l'adresse après une sortie de l'appli). */
  visitId: string;
  /** Source retenue ("" = source par défaut). */
  sourceKey: string;
  /** `?src=` reçu quand il n'a pas été suivi (diagnostic), sinon null. */
  rawSrc: string | null;
  /** IOS | ANDROID | OTHER (`detectLandingOs`). */
  os: string | null;
  /** TIKTOK | INSTAGRAM | FACEBOOK | OTHER, null : navigateur ordinaire (`detectInApp`). */
  inApp: string | null;
  /** Façon d'ouvrir Telegram (clic et ouverture) : HTTPS | TG_FRAME | INTENT_FRAME | AUTO_TG | AUTO_INTENT… ; appli pour HELP, marqueur (TGO | TTCLID | FBCLID) pour ESCAPED. */
  method: string | null;
  /** Pays ISO 3166-1 alpha-2 (base locale), null si inconnu. */
  country: string | null;
  /** Empreinte de l'adresse IP (`hashIp`, sel `IP_HASH_SALT`), jamais l'adresse. */
  ipHash: string | null;
  /** Robot connu (`isLandingBotUserAgent`) : gardé, jamais compté. */
  isBot: boolean;
  ttclid: string | null;
  fbclid: string | null;
  userAgent: string | null;
  /** Heure de réception par le site (ISO 8601) : l'heure réelle, même si la file a du retard. */
  createdAt: string;
};

/** File `landing-events` (phase 15) : `event` = une ligne `LandingEvent` à écrire. */
export type LandingEventsJob = { type: "event"; event: LandingEventData };

/**
 * File `chat` (phase 17, assistant de conversation, contrat `docs/ASSISTANT-CONVERSATION.md` §5) :
 * - `turn` : un tour de la conversation (réponse ou relance : le worker décide d'après la base, qui fait foi) ;
 * - `sweep` : balayage périodique (messages non traités, tours bloqués, nouvel essai après panne, relances dues,
 *   conversions) ;
 * - `refresh-models` : liste des modèles Venice et leurs prix (cache du réglage `assistant.venice`).
 */
export type ChatJob =
  | { type: "turn"; conversationId: string }
  | { type: "sweep" }
  | { type: "refresh-models" };

/**
 * File `agents-orchestrator` (phase 19, Grand Chef) : `cycle` (toutes les 30 min et à la demande), `resume` (missions
 * sans activité, 10 min), `report` (rapport du jour), `human-requests` (demandes au client, 5 min), `validations`
 * (validations sans réponse). Copie structurelle de `AgentsOrchestratorJob` (`@linkaffipro/agents`).
 */
export type AgentsOrchestratorJob =
  | { type: "cycle"; teamKey?: "dating" | "casino" | "sports" | "algo" }
  | { type: "resume" }
  /** Phase 33 : suivi des ordres de Kevin (`tickOrders` : progression, fin, reprise après redémarrage), toutes les 10 min. */
  | { type: "orders-tick" }
  /** Envois programmés de Kevin (`tickBossRoutines`), toutes les 5 min. */
  | { type: "routines-tick" }
  | { type: "report"; force?: boolean }
  | { type: "human-requests" }
  | { type: "validations" }
  | { type: "admin-voice"; botId: string; fileId: string; messageId: number; chatId: number; replyToMessageId?: number | null; mimeType?: string | null }
  /** Message de l'admin au Boss qui demande l'interprète IA (phase 26), traité par `apps/worker/src/agents/boss-text.ts`. */
  | {
      type: "boss-text";
      botId: string;
      chatId: number;
      messageId: number;
      text: string;
      replyToMessageId?: number | null;
      source?: "text" | "voice";
      forwarded?: boolean;
      entities?: Array<{ type: string; offset: number; length: number; url?: string; language?: string; custom_emoji_id?: string }> | null;
      /** Phase 26 (Kevin en équipe) : auteur, type de conversation, mentions (voir `@linkaffipro/agents`). */
      fromTelegramId?: string;
      chatType?: "private" | "group";
      mentions?: Array<{ telegramUserId?: string | null; username?: string | null; firstName?: string | null }>;
    };

/**
 * Files d'équipe : une étape de mission ; nom de la tâche = clé de l'agent, identifiant `<missionId>:<index>`
 * (`<missionId>:<index>:p<n>` pour la n-ième relecture d'une étape qui attend un fournisseur, phase 20).
 */
export type AgentStepJob = { type: "step"; missionId: string; index: number; poll?: number };

/**
 * File `agents-algo` (phase 21) : en plus des étapes, le passage horaire du Chef Algorithme (`tick` : alertes, nuit,
 * lundi) et « Rapport maintenant » (`report-now`).
 */
export type AgentsAlgoJob = { type: "algo"; task: "tick" | "report-now"; send?: boolean };

/**
 * File `agents-algo` (phase 30, QA Global) : `qa-sweep` (5 min : recommandations sans approbation vérifiées, alertes
 * des Analystes retenues faute de QA) et `qa-alerts` (5 min : alertes internes du QA envoyées par Kevin). Sur cette
 * file plutôt que sur `agents-orchestrator` (une tâche à la fois) : une vérification de 30 s ne retarde jamais Kevin.
 */
export type AgentsQaJob = { type: "qa-sweep" } | { type: "qa-alerts" };

/**
 * File `agents-sports` (phase 23) : en plus des étapes, `settle` toutes les 2 h (résultats des paris publiés).
 */
export type AgentsSportsJob = { type: "sports"; task: "settle" };

/**
 * File `agents-ads` (phase 24) : `tick` toutes les 30 minutes (alertes, rapport du jour à 9 h, rapport de la semaine le
 * lundi) ; `report-now` : rapport tout de suite (quotidien par défaut, ou de la semaine).
 */
export type AgentsAdsJob = { type: "tick" } | { type: "report-now"; kind?: "daily" | "weekly"; send?: boolean };

/**
 * File `agents-analystes` (phase 29) : copie structurelle de `AnalystsQueueJob` de `@linkaffipro/agents`
 * (`analysts/contract.ts`, ce paquet ne dépend pas des agents). `analysts.schedule` toutes les heures (sources dues,
 * rapport de la semaine, découverte, revérification, purge) ; le reste est déposé par la planification et par Kevin.
 */
export type AgentsAnalystesJob =
  | { type: "analysts.schedule" }
  | { type: "analysts.scrape"; sourceId: string }
  | { type: "analysts.compliance_check"; entryId: string }
  | { type: "analysts.strategy"; kind: "weekly" | "on_demand"; requestId?: string | null }
  | { type: "analysts.report"; kind: "weekly" | "briefing"; reportId?: string | null }
  | { type: "analysts.discover" }
  | { type: "analysts.reverify" }
  | { type: "analysts.purge" };

/**
 * File `agents-prospection` (phase 31) : copie structurelle de `ProspectionQueueJob` de `@linkaffipro/agents`
 * (`prospection/contract.ts`, ce paquet ne dépend pas des agents). `prospection.schedule` toutes les 10 minutes
 * (découverte de nuit, enrichissement continu, Top du jour, rappels, rapport du lundi) ; le reste est déposé par la
 * planification et par Kevin. L'équipe n'écrit jamais à un tiers.
 */
export type ProspectionDiscoveryLotJob = {
  source: "directories" | "web_search" | "social" | "graph" | "analysts" | "manual";
  languages: string[];
  vertical: "SPORTS" | "CASINO";
  countries?: string[];
  requestId?: string | null;
  prospectId?: string | null;
};

export type AgentsProspectionJob =
  | { type: "prospection.schedule" }
  | { type: "prospection.discover"; lot: ProspectionDiscoveryLotJob }
  | { type: "prospection.enrich"; prospectId: string }
  | { type: "prospection.score"; prospectId: string }
  | { type: "prospection.dossier"; prospectId: string }
  | { type: "prospection.daily-top"; requested?: { chatId?: string | null; count?: number } | null }
  | { type: "prospection.reminders" }
  | { type: "prospection.weekly-report" }
  | { type: "prospection.requalify" };

export type AgentTeamQueue = "agents-dating" | "agents-casino" | "agents-sports" | "agents-algo";

export type JobOf<Q extends QueueName> = Q extends "telegram-send"
  ? TelegramSendJob
  : Q extends "approvals"
    ? ApprovalsJob
    : Q extends "scheduler"
      ? SchedulerJob
      : Q extends "sync-linkaffi"
        ? SyncLinkAffiJob
        : Q extends "maintenance"
          ? MaintenanceJob
          : Q extends "automations"
            ? AutomationsJob
            : Q extends "sync-ads"
              ? SyncAdsJob
              : Q extends "sync-views"
                ? SyncViewsJob
                : Q extends "custom-emoji"
                  ? CustomEmojiJob
                  : Q extends "linkaffi-events"
                    ? LinkaffiEventsJob
                    : Q extends "landing-events"
                      ? LandingEventsJob
                      : Q extends "chat"
                        ? ChatJob
                        : Q extends "agents-orchestrator"
                          ? AgentsOrchestratorJob
                          : Q extends "agents-algo"
                            ? AgentStepJob | AgentsAlgoJob | AgentsQaJob
                            : Q extends "agents-sports"
                            ? AgentStepJob | AgentsSportsJob
                            : Q extends AgentTeamQueue
                            ? AgentStepJob
                            : Q extends "agents-ads"
                              ? AgentsAdsJob
                              : Q extends "agents-analystes"
                                    ? AgentsAnalystesJob
                                    : Q extends "agents-prospection"
                                      ? AgentsProspectionJob
                                      : StatsJob;
