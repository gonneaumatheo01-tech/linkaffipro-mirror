/**
 * Phase 34 — contrat FIGÉ « tout par Kevin » (`docs/prompts/36-phase-34-tout-par-kevin.md`). Types, noms et protocole
 * partagés par plusieurs chantiers ; ne pas les renommer.
 *
 * Principe (règle 1, « mêmes fonctions que le site, jamais une copie ») : chaque action serveur du site est découpée en
 * une fonction CŒUR unique `run(input, actor, opts)` déclarée dans le registre des opérations du site
 * (`apps/web/lib/site-ops/`). Le bouton du site (action serveur : lecture du formulaire, droits, `revalidatePath`,
 * redirection) et Kevin (worker, par l'entrée interne signée `POST /api/internal/site-ops`) appellent cette MÊME
 * fonction : mêmes validations, mêmes messages d'erreur, même `AuditLog` (métadonnée `via`). Kevin tourne dans le
 * worker et la logique du site reste dans le site : l'appel passe par le réseau privé, signé (voir `SITE_OPS_*`).
 *
 * Qui fournit quoi :
 * - Chantier A, SOCLE (`apps/web/lib/site-ops/{registry,actor,endpoint-auth}.ts`, route `app/api/internal/site-ops`,
 *   client du worker `apps/worker/src/agents/site-ops-client.ts` + `deps.siteOps`, côté Kevin
 *   `packages/agents/src/site/{registry,flow,confirm,errors,tools,capabilities}.ts` : outils par domaine pour l'IA,
 *   essai à blanc → question si une valeur manque → confirmation (OUI / SUPPRIMER / aperçu d'envoi) → exécution →
 *   phrase de collègue ; branchement au registre des capacités de la phase 33 pour le planificateur ;
 *   inventaire `pnpm kevin:parity` + `site-parity.test.ts` + `docs/KEVIN-PARITE.md` ; aide par domaine).
 * - Chantiers B à E, DOMAINES : pour chaque fichier d'actions de leur périmètre : cœurs extraits dans un module SANS
 *   « use server » (jamais exportés d'un fichier « use server » : ils deviendraient appelables par le navigateur),
 *   actions serveur réécrites pour appeler le cœur (comportement du site identique), opérations enregistrées dans
 *   `apps/web/lib/site-ops/ops/<domaine>.ts`, métadonnées pour Kevin dans `packages/agents/src/site/ops/<domaine>.ts`,
 *   correspondance dans `packages/agents/src/site/parity/<domaine>.ts`.
 * - Chantier F, ENTRÉES TELEGRAM (`packages/agents/src/boss/inputs/*`) : fichiers CSV, message transféré = contenu,
 *   boutons de choix, liens d'autorisation signés à usage unique (15 min) et reprise après OAuth.
 */

/** Domaines (un fichier de métadonnées et un fichier de correspondance par domaine). */
export type SiteDomain =
  | "canaux"
  | "messages"
  | "pages"
  | "campagnes"
  | "membres"
  | "envois"
  | "automatisations"
  | "conversations"
  | "agents"
  | "univers"
  | "reglages"
  | "connecteurs"
  | "equipe"
  | "statistiques";

/**
 * Nature d'une opération : `read` lecture ; `setting` réglage ; `create` création ; `send` envoie à des membres
 * (aperçu exact + nombre de destinataires + OUI) ; `delete` supprime / efface / anonymise / purge / déconnecte /
 * révoque (récapitulatif + le mot SUPPRIMER) ; `secret` porte une clé ou un mot de passe (privé seulement, message
 * effacé, jamais à l'IA) ; `connect` exige un navigateur (lien d'autorisation).
 */
export type SiteOpKind = "read" | "setting" | "create" | "send" | "delete" | "secret" | "connect";

/** Rôle minimum sur le site (règle 2). MANAGER = tout sauf réglages, utilisateurs, jetons, suppressions. */
export type SiteOpRole = "ADMIN" | "MANAGER";

/**
 * Confirmation demandée par Kevin : `none` ; `yes` (OUI / NON, règle de la phase 33 : vrai canal, mode vrai, dépense,
 * hausse de plafond / niveau / quota) ; `delete` (récapitulatif + écrire exactement SUPPRIMER ; « oui » ne suffit pas) ;
 * `send` (aperçu exact du message tel qu'il partira + nombre de destinataires + OUI).
 * `classify` (facultatif, côté Kevin) peut durcir selon les valeurs (baisse = `none`, hausse = `yes`).
 */
export type SiteOpConfirm = "none" | "yes" | "delete" | "send";

/** Métadonnées d'une opération pour Kevin (pures, sans Prisma : `packages/agents/src/site/ops/<domaine>.ts`). */
export type SiteOpMeta = {
  /** Clé stable « <domaine>.<verbe> » (ex. « canaux.ajouter », « reglages.etiquette_creer »). */
  key: string;
  domain: SiteDomain;
  /** Une ligne en français courant (montrée à l'IA et dans l'aide). */
  description: string;
  /** Deux phrases type au moins, comme le client les dirait (aide « comment je fais X ? », `docs/KEVIN-PARITE.md`). */
  examples: string[];
  kind: SiteOpKind;
  role: SiteOpRole;
  confirm: SiteOpConfirm;
  /** Schéma JSON strict des paramètres (envoyé à l'IA). Jamais de champ secret ici. */
  params: Record<string, unknown>;
  /** Champs secrets : demandés par Kevin EN PRIVÉ (demande SECRET), jamais à l'IA, jamais journalisés. */
  secretParams?: string[];
  /**
   * Entrées Telegram acceptées en plus des paramètres : `file` (document CSV), `forwarded` (message transféré = contenu,
   * entités et médias gardés), `media` (photos / vidéos envoyées), `choice` (valeur choisie par bouton).
   */
  inputs?: Array<"file" | "forwarded" | "media" | "choice">;
  /** Actions serveur couvertes (« <fichier relatif à apps/web>#<fonction> ») : sert à l'inventaire. */
  serverActions: string[];
};

/** Qui agit. `via` part dans l'`AuditLog` (métadonnée `via`). */
export type SiteOpActor = {
  /** Utilisateur du site (ADMIN lié au compte Telegram, ou membre de l'équipe lié à un compte du site), sinon null. */
  userId: string | null;
  role: SiteOpRole;
  via: "WEB" | "TELEGRAM";
  /** Identifiant Telegram (chaîne d'un BigInt) quand `via = TELEGRAM`. */
  telegramUserId?: string | null;
};

/** Aperçu rendu par un essai à blanc (`dryRun`) : ce qui sera fait, sans rien écrire ni envoyer. */
export type SiteOpPreview = {
  /** 1 à 3 lignes en français courant (« Campagne Celsius FR, CPA 120 €, 2 liens »). */
  summary: string;
  /** Envoi : le texte EXACT tel qu'il partira (HTML Telegram) et le nombre de destinataires. */
  exactText?: string | null;
  recipients?: number | null;
  /** Suppression : ce qui disparaît (« 12 liens, 340 clics gardés en statistiques »). */
  impact?: string | null;
};

/** Résultat d'une opération (site comme Kevin). Erreur = message de validation du site, tel quel. */
export type SiteOpResult =
  | { ok: true; message: string; data?: Record<string, unknown>; preview?: SiteOpPreview }
  | { ok: false; error: string; field?: string | null; code?: "invalid" | "forbidden" | "not_found" | "conflict" | "unavailable" };

/** Options d'exécution. `dryRun` : valide tout (mêmes règles) et rend `preview`, sans écrire ni envoyer. */
export type SiteOpRunOptions = { dryRun?: boolean };

/** Appel d'une opération (worker → site, signé). Les tests injectent un faux client (aucun réseau). */
export type SiteOpsClient = (req: {
  op: string;
  input: Record<string, unknown>;
  actor: SiteOpActor;
  dryRun?: boolean;
}) => Promise<SiteOpResult>;

/** Correspondance d'une action serveur (inventaire, règle 5). */
export type SiteParityEntry =
  | { op: string }
  | { catalog: string }
  | { capability: string }
  | { excluded: { reason: string; replacement: string } };

/** Protocole de l'entrée interne signée. */
export const SITE_OPS_PATH = "/api/internal/site-ops";
/** En-têtes : horodatage (ms) et signature HMAC-SHA256 hex de `${timestamp}.${corps}`. */
export const SITE_OPS_TIMESTAMP_HEADER = "x-site-ops-ts";
export const SITE_OPS_SIGNATURE_HEADER = "x-site-ops-sig";
/** Fenêtre d'acceptation d'une requête signée. */
export const SITE_OPS_MAX_SKEW_MS = 60_000;
/** Contexte de dérivation de la clé de signature depuis `APP_ENCRYPTION_KEY` (aucune nouvelle variable à poser). */
export const SITE_OPS_KEY_CONTEXT = "linkaffipro:site-ops:v1";

/** Mot exact exigé pour une suppression (règle 3). */
export const DELETE_CONFIRM_WORD = "SUPPRIMER";
/** Liens d'autorisation (connexion, OAuth, invitation) : usage unique, 15 minutes. */
export const AUTH_LINK_TTL_MS = 15 * 60_000;

/**
 * Entrées Telegram (chantier F, `packages/agents/src/boss/inputs/`) lues par le déroulé de Kevin (chantier A) :
 * un message transféré ou un document reçu est GARDÉ 30 minutes pour la conversation (`Setting`
 * `boss.input.<chatId>`), puis consommé par l'opération qui le demande (`inputs` de `SiteOpMeta`).
 */
export type ForwardedContent = {
  /** Texte en HTML Telegram, entités gardées (gras, liens, `<tg-emoji emoji-id>` des emojis animés). */
  html: string;
  /** Médias du message (identifiants de fichiers Telegram, jamais téléchargés sans besoin). */
  media: Array<{ kind: "photo" | "video" | "animation" | "document" | "audio"; fileId: string }>;
  /** Origine affichée (« transféré de @canal »), jamais exécutée. */
  from?: string | null;
  receivedAt: string;
};

export type ReceivedDocument = { fileName: string; mimeType: string | null; sizeBytes: number; text: string; receivedAt: string };

/** Signatures attendues du chantier F (le chantier A les importe par ces noms). */
export type BossInputsApi = {
  peekForwarded(deps: unknown, chatId: string): Promise<ForwardedContent | null>;
  takeForwarded(deps: unknown, chatId: string): Promise<ForwardedContent | null>;
  peekDocument(deps: unknown, chatId: string): Promise<ReceivedDocument | null>;
  takeDocument(deps: unknown, chatId: string): Promise<ReceivedDocument | null>;
  /** Lien signé à usage unique (15 min) vers `/k/<jeton>` ; `purpose` dit où il mène. */
  createAuthLink(
    deps: unknown,
    req: { purpose: "login" | "oauth_meta" | "oauth_tiktok" | "invite" | "page"; userId: string | null; chatId: string; payload?: Record<string, unknown> },
  ): Promise<{ url: string; expiresAt: string }>;
};

/** Clé du `Setting` qui garde l'entrée reçue d'une conversation. */
export const BOSS_INPUT_SETTING_PREFIX = "boss.input.";
export const BOSS_INPUT_TTL_MS = 30 * 60_000;
/** Route publique des liens d'autorisation (`apps/web/app/k/[token]/route.ts`). */
export const AUTH_LINK_PATH = "/k/";
