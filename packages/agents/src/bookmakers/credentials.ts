/**
 * Phase 35, chantier D — identifiants des comptes bookmakers.
 * - Un seul jeu d'identifiants pour tous les bookmakers (décision du client) : secret commun chiffré
 *   `providers.bookmakers.default.credentials` = `{ email, password }` (mécanique des secrets : `Setting`
 *   `agents.secret.<clé>`, chiffré par `encrypt` de core) ;
 * - un site peut garder ses identifiants propres (phase 23 : `providers.bookmakers.<site>.login` / `.password`),
 *   toujours prioritaires ;
 * - Kevin les demande UNE SEULE FOIS, EN PRIVÉ (deux demandes SECRET : l'e-mail, puis le mot de passe ; messages
 *   effacés, jamais envoyés à l'IA ni journalisés), sauf s'ils existent déjà ; puis il propose de tester les sites
 *   d'un coup (demande CONFIRM). Aucun identifiant n'est écrit dans le code, les consignes, les tests ou la doc.
 */
import { nowOf, readSetting, writeSetting } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import { askHuman } from "../human/requests";
import { registerAnswerAction } from "../human/respond";
import { readSecret, saveSecret, secretSettingKey, secretSummary } from "../human/secrets";
import type { BookmakerCredentials } from "../providers/screenshot/adapter";
import { bookmakerLoginKey, readBookmakerCredentials } from "../providers/screenshot/session";
import type { AgentsDeps } from "../types";
import { BOOKMAKERS_VARIANTS as V } from "../boss/bookmakers-texts";
import { pick } from "../boss/voice";
import { BOOKMAKER_DEFAULT_CREDENTIALS_KEY } from "./contract";

/** Demandes SECRET (clés temporaires, effacées dès que le secret commun est rangé). */
export const DEFAULT_LOGIN_REQUEST_KEY = "providers.bookmakers.default.login";
export const DEFAULT_PASSWORD_REQUEST_KEY = "providers.bookmakers.default.password";
/** Demande CONFIRM « je teste les sites d'un coup ? ». */
export const TEST_ALL_REQUEST_KEY = "bookmakers.testAll";
/** `Setting` : identifiants communs déjà demandés (une seule fois, sauf demande explicite de l'admin). */
export const CREDENTIALS_ASKED_SETTING = "bookmakers.credentialsAsked";

export type SiteCredentials = BookmakerCredentials & { source: "site" | "default" };

/** Pur : secret commun rangé (`{ email, password }` en JSON) → identifiants ; null si illisible ou incomplet. */
export function parseDefaultCredentials(raw: string | null): BookmakerCredentials | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { email?: unknown; login?: unknown; password?: unknown };
    const login = typeof v.email === "string" ? v.email.trim() : typeof v.login === "string" ? v.login.trim() : "";
    const password = typeof v.password === "string" ? v.password : "";
    return login && password ? { login, password } : null;
  } catch {
    return null;
  }
}

/** Identifiants d'un site : les siens d'abord (phase 23), sinon les communs. Côté serveur seulement. */
export async function readBookmakerCredentialsFor(deps: Pick<AgentsDeps, "prisma">, siteKey: string): Promise<SiteCredentials | null> {
  const own = await readBookmakerCredentials(deps.prisma, siteKey);
  if (own) return { ...own, source: "site" };
  const common = parseDefaultCredentials(await readSecret(deps.prisma, BOOKMAKER_DEFAULT_CREDENTIALS_KEY));
  return common ? { ...common, source: "default" } : null;
}

/** Des identifiants communs sont-ils rangés ? (sans jamais lire la valeur hors du serveur) */
export async function hasDefaultCredentials(deps: Pick<AgentsDeps, "prisma">): Promise<boolean> {
  return (await secretSummary(deps.prisma, BOOKMAKER_DEFAULT_CREDENTIALS_KEY)).set;
}

/** Résumé affichable (jamais la valeur) : qui a des identifiants, et lesquels. */
export async function credentialsSummary(
  deps: Pick<AgentsDeps, "prisma">,
  siteKeys: readonly string[],
): Promise<{ common: { set: boolean; updatedAt: Date | null }; sites: Record<string, "site" | "default" | null> }> {
  const common = await secretSummary(deps.prisma, BOOKMAKER_DEFAULT_CREDENTIALS_KEY);
  const sites: Record<string, "site" | "default" | null> = {};
  for (const k of siteKeys) {
    const own = (await secretSummary(deps.prisma, bookmakerLoginKey(k))).set;
    sites[k] = own ? "site" : common.set ? "default" : null;
  }
  return { common: { set: common.set, updatedAt: common.updatedAt }, sites };
}

export type AskCredentialsResult = { asked: boolean; reason: "asked" | "already_saved" | "already_asked" };

/**
 * Kevin demande les identifiants communs en privé (une seule fois) : e-mail puis mot de passe. `force` (l'admin dit
 * « mes identifiants bookmakers ont changé ») : redemande même s'ils existent.
 */
export async function askBookmakerCredentials(deps: AgentsDeps, opts: { force?: boolean } = {}): Promise<AskCredentialsResult> {
  if (!opts.force) {
    if (await hasDefaultCredentials(deps)) return { asked: false, reason: "already_saved" };
    if ((await readSetting(deps, CREDENTIALS_ASKED_SETTING)) !== undefined) {
      const open = await deps.prisma.humanRequest.findFirst({ where: { key: { in: [DEFAULT_LOGIN_REQUEST_KEY, DEFAULT_PASSWORD_REQUEST_KEY] }, status: { in: ["QUEUED", "PENDING"] } } });
      if (open) return { asked: false, reason: "already_asked" };
    }
  }
  await writeSetting(deps, CREDENTIALS_ASKED_SETTING, { askedAt: nowOf(deps).toISOString(), force: opts.force === true });
  await askHuman(deps, {
    teamKey: "sports",
    kind: "SECRET",
    key: DEFAULT_LOGIN_REQUEST_KEY,
    question: pick(V.askLogin, "bookmakers.askLogin"),
    onAnswer: { resume: false },
  });
  await askHuman(deps, {
    teamKey: "sports",
    kind: "SECRET",
    key: DEFAULT_PASSWORD_REQUEST_KEY,
    question: pick(V.askPassword, "bookmakers.askPassword"),
    onAnswer: { action: "bookmakers-default-credentials", resume: false },
  });
  return { asked: true, reason: "asked" };
}

/**
 * Range le secret commun depuis les deux réponses (e-mail et mot de passe), efface les deux clés temporaires. Rend
 * `false` s'il manque l'une des deux. Aucune valeur n'est journalisée (le journal de `saveSecret` n'a que la clé).
 */
export async function combineDefaultCredentials(deps: AgentsDeps, actor: ActorRef): Promise<boolean> {
  const [login, password] = await Promise.all([readSecret(deps.prisma, DEFAULT_LOGIN_REQUEST_KEY), readSecret(deps.prisma, DEFAULT_PASSWORD_REQUEST_KEY)]);
  if (!login || !password) return false;
  await saveSecret(deps, BOOKMAKER_DEFAULT_CREDENTIALS_KEY, JSON.stringify({ email: login.trim(), password }), actor);
  await deps.prisma.setting.deleteMany({ where: { key: { in: [secretSettingKey(DEFAULT_LOGIN_REQUEST_KEY), secretSettingKey(DEFAULT_PASSWORD_REQUEST_KEY)] } } });
  return true;
}

/** Testeur des sites (connexion + une lecture), fourni par `actions.ts` (évite une dépendance circulaire). */
type TestAll = (deps: AgentsDeps, actor: ActorRef) => Promise<{ queued: string[]; skipped: string[] }>;
let testAllSites: TestAll | null = null;
export function registerTestAllSites(fn: TestAll | null): void {
  testAllSites = fn;
}

registerAnswerAction("bookmakers-default-credentials", async (deps, { actor }) => {
  if (!(await combineDefaultCredentials(deps, actor))) return pick(V.credentialsIncomplete, "bookmakers.credentialsIncomplete");
  await askHuman(deps, {
    teamKey: "sports",
    kind: "CONFIRM",
    key: TEST_ALL_REQUEST_KEY,
    question: pick(V.askTestAll, "bookmakers.askTestAll"),
    onAnswer: { action: "bookmakers-test-all", resume: false },
  });
  return pick(V.credentialsSaved, "bookmakers.credentialsSaved");
});

registerAnswerAction("bookmakers-test-all", async (deps, { value, actor }) => {
  if (value !== "oui") return pick(V.testAllLater, "bookmakers.testAllLater");
  if (!testAllSites) return pick(V.testAllUnavailable, "bookmakers.testAllUnavailable");
  const r = await testAllSites(deps, actor);
  if (!r.queued.length) return pick(V.testAllNothing, "bookmakers.testAllNothing");
  return pick(V.testAllStarted({ n: r.queued.length }), "bookmakers.testAllStarted");
});
