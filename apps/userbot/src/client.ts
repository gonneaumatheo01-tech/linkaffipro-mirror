/**
 * Client MTProto PERSISTANT d'un compte reel (phase 18, etape 2a).
 * Contrairement a packages/mtproto (qui ouvre et referme a chaque appel),
 * ce client reste connecte et ecoute les messages entrants.
 */
import { createClient } from "@linkaffipro/mtproto";
import { credentials, sessionOf } from "@linkaffipro/userbot";
import type { TelegramClient } from "telegram";
import { Api } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { loadUserbotSettings } from "./settings";
import { transcribe } from "./transcribe";
import { logger } from "./logger";
import { handleIncomingPrivate, type IncomingPrivate, type TurnAccount } from "./turn";

export type LiveAccount = {
  id: string;
  label: string;
  /** Expose pour le transport (transport.ts) : la session ne doit jamais etre rouverte ailleurs. */
  client: TelegramClient;
  stop: () => Promise<void>;
};

export type AccountToStart = {
  id: string;
  label: string;
  phone: string;
  /** Bot fantome et persona qui portent les conversations du compte (turn.ts). */
  botId: string | null;
  personaId: string | null;
};

/** Message prive entrant d'une vraie personne (ni groupe, ni canal, ni bot, ni nous-memes), sinon null. */
async function toIncomingPrivate(
  client: ReturnType<typeof createClient>,
  event: NewMessageEvent,
): Promise<IncomingPrivate | null> {
  const msg = event.message;
  if (!event.isPrivate || msg.out || !msg.senderId) return null;
  const legende = msg.message?.trim() ?? "";
  const vocal = isVoiceMessage(msg);
  // Un vocal n'a pas de texte : on ne le jette pas, il sera transcrit.
  if (!legende && !vocal) return null;
  const sender = await msg.getSender().catch(() => undefined);
  if (!(sender instanceof Api.User) || sender.bot || sender.self) return null;
  const peer = (await msg.getInputChat().catch(() => undefined)) ?? msg.chatId ?? sender;
  const text = vocal ? ((await voiceText(client, msg)) ?? "") : legende;
  return {
    telegramUserId: BigInt(msg.senderId.toString()),
    telegramMessageId: msg.id,
    text,
    peer,
    firstName: sender.firstName ?? null,
    lastName: sender.lastName ?? null,
    username: sender.username ?? null,
    languageCode: sender.langCode ?? null,
  };
}

/** Vrai si le message porte un vocal (document avec attribut audio « voice »). */
function isVoiceMessage(msg: Api.Message): boolean {
  const media = msg.media;
  if (!(media instanceof Api.MessageMediaDocument)) return false;
  const doc = media.document;
  if (!(doc instanceof Api.Document)) return false;
  return doc.attributes.some(
    (a) => a instanceof Api.DocumentAttributeAudio && Boolean(a.voice),
  );
}

/** Texte du vocal, ou null si Telegram ou la transcription a echoue. */
async function voiceText(
  client: ReturnType<typeof createClient>,
  msg: Api.Message,
): Promise<string | null> {
  const octets = (await client.downloadMedia(msg, {}).catch(() => undefined)) as
    | Buffer
    | undefined;
  if (!octets?.length) return null;
  const { apiKey } = await loadUserbotSettings();
  if (!apiKey) return null;
  return transcribe(apiKey, octets, "audio/ogg");
}

export async function startAccount(account: AccountToStart): Promise<LiveAccount> {
  const creds = await credentials();
  const session = await sessionOf(account.id);
  const client = createClient(session, creds.apiId, creds.apiHash);

  await client.connect();
  const me = await client.getMe();
  logger.info({ compte: account.label, username: me.username ?? null }, "compte connecte");

  const turnAccount: TurnAccount = {
    id: account.id,
    label: account.label,
    botId: account.botId,
    personaId: account.personaId,
    client,
  };
  client.addEventHandler(
    (event: NewMessageEvent) => {
      // Jamais d'attente ici : GramJS doit continuer a recevoir pendant qu'un tour se prepare.
      void (async () => {
        const incoming = await toIncomingPrivate(client, event);
        if (!incoming) return;
        logger.info(
          {
            compte: account.label,
            de: String(incoming.telegramUserId),
            texte: incoming.text.slice(0, 160),
          },
          "message recu",
        );
        await handleIncomingPrivate(turnAccount, incoming);
      })().catch((err: unknown) =>
        logger.error(
          { compte: account.label, err: err instanceof Error ? err.message : String(err) },
          "message entrant non traite",
        ),
      );
    },
    new NewMessage({ incoming: true }),
  );

  return {
    id: account.id,
    label: account.label,
    client,
    stop: async () => {
      await client.disconnect().catch(() => undefined);
      await client.destroy().catch(() => undefined);
    },
  };
}
