/**
 * Enveloppe GramJS (MTProto) : un seul client par appel, toujours déconnecté en `finally`.
 * Les sessions (StringSession) circulent en clair ici : à chiffrer par l'appelant avant stockage, jamais journalisées.
 */
import { Api, Logger, TelegramClient, errors as gramErrors, password as gramPassword, sessions } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";
import { chunkMessageIds, channelIdToNumber } from "./batches";
import { classifyError, MtprotoRpcError } from "./errors";

export type MtprotoCredentials = { apiId: number; apiHash: string };

export type MtprotoUser = { id: string; firstName: string; username: string | null; phone: string | null };

export type SignInResult = { status: "ok"; session: string; user: MtprotoUser } | { status: "password_needed"; session: string };

export type MessageViews = { id: number; views: number; forwards: number };

/** Canal (ou supergroupe) dont le compte connecté est administrateur ou créateur. `telegramChatId` au format Bot API (`-100…`), en chaîne. */
export type AdminChannel = {
  telegramChatId: string;
  title: string;
  username: string | null;
  isCreator: boolean;
  isAdmin: boolean;
  /** true : canal de diffusion ; false : supergroupe (megagroup). */
  isBroadcast: boolean;
  memberCount: number | null;
};

const CLIENT_PARAMS = {
  connectionRetries: 3,
  requestRetries: 2,
  /** 0 : GramJS ne dort jamais tout seul sur FLOOD_WAIT ; l'appelant décide (worker : arrêt du passage). */
  floodSleepThreshold: 0,
  deviceModel: "LinkAffi Pro",
  systemVersion: "Node 22",
  appVersion: "1.0",
  langCode: "fr",
  systemLangCode: "fr",
  useWSS: false,
} as const;

/** Crée un client GramJS silencieux (aucun journal GramJS : il pourrait contenir des données de session). */
export function createClient(sessionString: string, apiId: number, apiHash: string): TelegramClient {
  if (!Number.isInteger(apiId) || apiId <= 0) throw new MtprotoRpcError("API_ID_INVALID");
  if (!apiHash || apiHash.length < 16) throw new MtprotoRpcError("API_ID_INVALID");
  return new TelegramClient(new sessions.StringSession(sessionString), apiId, apiHash, {
    ...CLIENT_PARAMS,
    baseLogger: new Logger(LogLevel.NONE),
  });
}

/** Exécute `fn` avec un client connecté, convertit les erreurs, déconnecte toujours. */
async function withClient<T>(
  session: string,
  creds: MtprotoCredentials,
  fn: (client: TelegramClient) => Promise<T>,
): Promise<T> {
  const client = createClient(session, creds.apiId, creds.apiHash);
  try {
    await client.connect();
    return await fn(client);
  } catch (err) {
    throw classifyError(err);
  } finally {
    await client.disconnect().catch(() => undefined);
    await client.destroy().catch(() => undefined);
  }
}

function saveSession(client: TelegramClient): string {
  return (client.session as sessions.StringSession).save();
}

function toUser(u: Api.TypeUser): MtprotoUser {
  if (u instanceof Api.User) {
    return { id: u.id.toString(), firstName: u.firstName ?? "", username: u.username ?? null, phone: u.phone ?? null };
  }
  return { id: u.id.toString(), firstName: "", username: null, phone: null };
}

/**
 * Étape 1 : envoie le code de connexion au numéro (reçu dans l'application Telegram).
 * Retourne la session à conserver (chiffrée) : elle porte la clé d'autorisation liée au code,
 * indispensable pour `signIn` dans un autre processus.
 */
export async function sendCode(phone: string, creds: MtprotoCredentials): Promise<{ phoneCodeHash: string; session: string }> {
  return withClient("", creds, async (client) => {
    const res = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: creds.apiId,
        apiHash: creds.apiHash,
        settings: new Api.CodeSettings({}),
      }),
    );
    if (!(res instanceof Api.auth.SentCode)) throw new MtprotoRpcError("AUTH_RESTART");
    return { phoneCodeHash: res.phoneCodeHash, session: saveSession(client) };
  });
}

/** Étape 2 : valide le code reçu. `password_needed` si le compte a la validation en deux étapes. */
export async function signIn(
  input: { session: string; phone: string; phoneCodeHash: string; code: string },
  creds: MtprotoCredentials,
): Promise<SignInResult> {
  const client = createClient(input.session, creds.apiId, creds.apiHash);
  try {
    await client.connect();
    const res = await client.invoke(
      new Api.auth.SignIn({ phoneNumber: input.phone, phoneCodeHash: input.phoneCodeHash, phoneCode: input.code }),
    );
    if (res instanceof Api.auth.AuthorizationSignUpRequired) throw new MtprotoRpcError("PHONE_NUMBER_UNOCCUPIED");
    if (!(res instanceof Api.auth.Authorization)) throw new MtprotoRpcError("AUTH_RESTART");
    return { status: "ok", session: saveSession(client), user: toUser(res.user) };
  } catch (err) {
    const typed = classifyError(err);
    if (typed.name === "MtprotoPasswordNeeded") return { status: "password_needed", session: saveSession(client) };
    throw typed;
  } finally {
    await client.disconnect().catch(() => undefined);
    await client.destroy().catch(() => undefined);
  }
}

/** Étape 3 : mot de passe de validation en deux étapes (SRP calculé localement, le mot de passe n'est jamais envoyé en clair). */
export async function checkPassword(
  input: { session: string; password: string },
  creds: MtprotoCredentials,
): Promise<{ session: string; user: MtprotoUser }> {
  return withClient(input.session, creds, async (client) => {
    const pwd = await client.invoke(new Api.account.GetPassword());
    const srp = await gramPassword.computeCheck(pwd, input.password);
    const res = await client.invoke(new Api.auth.CheckPassword({ password: srp }));
    if (!(res instanceof Api.auth.Authorization)) throw new MtprotoRpcError("AUTH_RESTART");
    return { session: saveSession(client), user: toUser(res.user) };
  });
}

/** Révoque la session côté Telegram. Une session déjà invalide n'est pas une erreur (retourne false). */
export async function logOut(session: string, creds: MtprotoCredentials): Promise<boolean> {
  try {
    return await withClient(session, creds, async (client) => {
      await client.invoke(new Api.auth.LogOut());
      return true;
    });
  } catch (err) {
    if (err instanceof Error && err.name === "MtprotoAuthError") return false;
    throw err;
  }
}

/** Compte connecté (vérification de la session). */
export async function getMe(session: string, creds: MtprotoCredentials): Promise<MtprotoUser> {
  return withClient(session, creds, async (client) => {
    const me = await client.getMe();
    return toUser(me as Api.TypeUser);
  });
}

/**
 * Résout le peer d'un canal à partir de son identifiant numérique (-100…). GramJS tente d'abord `channels.getChannels`
 * (suffit quand le compte est membre) ; sinon on charge les dialogues du compte (remplit le cache d'entités) et on réessaie.
 */
async function resolveChannelPeer(client: TelegramClient, channelId: number): Promise<Api.TypeInputPeer> {
  try {
    return await client.getInputEntity(channelId);
  } catch (first) {
    const typed = classifyError(first);
    if (typed.name === "MtprotoFloodWait" || typed.name === "MtprotoAuthError") throw typed;
  }
  await client.getDialogs({ limit: 300 });
  try {
    return await client.getInputEntity(channelId);
  } catch (second) {
    const typed = classifyError(second);
    if (typed.name === "MtprotoFloodWait" || typed.name === "MtprotoAuthError") throw typed;
    throw new MtprotoRpcError("PEER_ID_INVALID");
  }
}

/**
 * Vues et transferts de messages d'un canal, par lots de 100 (`messages.getMessagesViews`, sans incrémenter).
 * Les identifiants absents de la réponse (message supprimé) sont renvoyés avec -1.
 */
export async function getViews(
  input: { session: string; channelId: bigint | number | string; messageIds: number[] },
  creds: MtprotoCredentials,
): Promise<MessageViews[]> {
  const batches = chunkMessageIds(input.messageIds);
  if (batches.length === 0) return [];
  return withClient(input.session, creds, async (client) => {
    const peer = await resolveChannelPeer(client, channelIdToNumber(input.channelId));
    const out: MessageViews[] = [];
    for (const ids of batches) {
      const res = await client.invoke(new Api.messages.GetMessagesViews({ peer, id: ids, increment: false }));
      ids.forEach((id, i) => {
        const v = res.views[i];
        out.push({ id, views: v?.views ?? -1, forwards: v?.forwards ?? (v ? 0 : -1) });
      });
    }
    return out;
  });
}

/** Convertit une entité GramJS `Channel` en `AdminChannel` ; null si le compte n'y est ni administrateur ni créateur. */
export function adminChannelFromEntity(entity: unknown): AdminChannel | null {
  if (!(entity instanceof Api.Channel)) return null;
  const isCreator = entity.creator === true;
  const isAdmin = isCreator || !!entity.adminRights;
  if (!isAdmin) return null;
  const username = entity.username ?? entity.usernames?.find((u) => u.active)?.username ?? null;
  return {
    telegramChatId: `-100${entity.id.toString()}`,
    title: entity.title,
    username,
    isCreator,
    isAdmin,
    isBroadcast: entity.broadcast === true || entity.megagroup !== true,
    memberCount: typeof entity.participantsCount === "number" ? entity.participantsCount : null,
  };
}

/**
 * Canaux et supergroupes dont le compte connecté est administrateur ou créateur (parmi ses 500 derniers dialogues),
 * sans doublon, triés par titre. Aucune modification côté Telegram.
 */
export async function listAdminChannels(session: string, creds: MtprotoCredentials): Promise<AdminChannel[]> {
  return withClient(session, creds, async (client) => {
    const dialogs = await client.getDialogs({ limit: 500 });
    const seen = new Set<string>();
    const out: AdminChannel[] = [];
    for (const d of dialogs) {
      const c = adminChannelFromEntity(d.entity);
      if (!c || seen.has(c.telegramChatId)) continue;
      seen.add(c.telegramChatId);
      out.push(c);
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, "fr"));
  });
}

/** Réexport utile aux tests d'intégration : les classes d'erreur GramJS (jamais nécessaires ailleurs). */
export const gramjsErrors = gramErrors;
