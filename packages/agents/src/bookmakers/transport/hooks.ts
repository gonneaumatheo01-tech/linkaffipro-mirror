/**
 * Phase 35, chantier A : points de branchement entre chantiers, sans dépendance de fichier à fichier.
 * - `setRecordSite(fn)` : parcours guidé de l'apprentissage (chantier B, `recordSite`) ; sans lui, `record` rend
 *   `{ obstacle: "apprentissage indisponible" }`.
 * - `setBookmakerBrowserLauncher(fn)` : navigateur du processus (worker : Chromium d'Alpine) ; sans lui, le transport
 *   serveur rend `{ obstacle: "no_browser" }` (le site n'a pas de navigateur : il dépose un travail).
 * - `registerReadJobHandler(kind, fn)` : exécution d'un travail complet par le worker (`learn` → B, `events` /
 *   `markets` / `verify` / `capture` → C, `test` → D).
 * - `registerPortableReadHandler(kind, fn)` : travail complet exécutable sur le Mac sans base (facultatif).
 */
import type { Browser } from "playwright-core";
import type { BookmakerCredentials } from "../../providers/screenshot/adapter";
import type { GuardedPage } from "../../providers/screenshot/guard";
import type { ProxyConfig } from "../../providers/screenshot/session";
import type { AgentsDeps, Logger } from "../../types";
import type { BookmakerTransport, SiteRecording } from "../contract";
import type { ReadJobRow } from "../jobs";
import type { PaceKind } from "./pace";

export type BookmakerBrowserLauncher = (o: { proxy: ProxyConfig | null; headless?: boolean }) => Promise<Browser>;

/** Réponse réseau vue pendant l'enregistrement (lecture seule ; le chantier B masque les secrets avant de garder). */
export type ObservedResponse = {
  url: string;
  method: string;
  status: number;
  resourceType: string;
  contentType: string | null;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  body(): Promise<string>;
};
export type ObservedFrame = { url: string; direction: "sent" | "received"; payload: string };

/** Ce que le transport donne au parcours guidé : la page GARDÉE (jamais la page brute), l'écoute du réseau, le rythme. */
export type RecordIo = {
  siteKey: string;
  baseUrl: string;
  page: GuardedPage;
  /** Pour la connexion seulement ; à masquer dans tout ce qui est gardé (`secrets`). Jamais à l'IA. */
  credentials: BookmakerCredentials | null;
  /** Valeurs à masquer (identifiant, mot de passe, jetons vus). */
  secrets: string[];
  pace(kind?: PaceKind): Promise<void>;
  onResponse(cb: (r: ObservedResponse) => void): void;
  onWebSocketFrame(cb: (f: ObservedFrame) => void): void;
  /** Adresses des cadres de la page (détection du moteur de paris). */
  frameUrls(): string[];
  /** Capture de la fenêtre (PNG base64). */
  screenshot(): Promise<string>;
  /** Connexion avec les identifiants (formulaire du site), si un moyen est connu. */
  login(): Promise<"already" | "logged_in" | "skipped" | { obstacle: string }>;
  logger?: Logger;
};

export type RecordSiteFn = (io: RecordIo) => Promise<SiteRecording | { obstacle: string }>;

let recordSite: RecordSiteFn | null = null;
export function setRecordSite(fn: RecordSiteFn | null): void {
  recordSite = fn;
}
export function registeredRecordSite(): RecordSiteFn | null {
  return recordSite;
}

let launcher: BookmakerBrowserLauncher | null = null;
export function setBookmakerBrowserLauncher(fn: BookmakerBrowserLauncher | null): void {
  launcher = fn;
}
export function registeredBrowserLauncher(): BookmakerBrowserLauncher | null {
  return launcher;
}

/** Travail complet exécuté par le worker (verrou du site déjà tenu). Rend le résultat à ranger (jamais de secret). */
export type ReadJobHandler = (deps: AgentsDeps, job: ReadJobRow) => Promise<unknown>;
const handlers = new Map<string, ReadJobHandler>();
export function registerReadJobHandler(kind: string, fn: ReadJobHandler | null): void {
  if (fn) handlers.set(kind, fn);
  else handlers.delete(kind);
}
export function readJobHandler(kind: string): ReadJobHandler | null {
  return handlers.get(kind) ?? null;
}

/** Travail complet exécutable sur le Mac (sans base) avec un transport local. */
export type PortableReadHandler = (transport: BookmakerTransport, job: { siteKey: string; kind: string; params: Record<string, unknown> }) => Promise<unknown>;
const portable = new Map<string, PortableReadHandler>();
export function registerPortableReadHandler(kind: string, fn: PortableReadHandler | null): void {
  if (fn) portable.set(kind, fn);
  else portable.delete(kind);
}
export function portableReadHandler(kind: string): PortableReadHandler | null {
  return portable.get(kind) ?? null;
}
export function portableReadKinds(): string[] {
  return [...portable.keys()];
}
