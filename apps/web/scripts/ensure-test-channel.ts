import { prisma } from "@linkaffipro/db";
import { decrypt } from "@linkaffipro/core";
import { parseTelegramUserApi, TELEGRAM_USER_API_SETTING } from "@linkaffipro/mtproto";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

const TITRE = process.argv[2] ?? "Canal Test Local";
const BOT_USERNAME = process.argv[3] ?? "casinogamblingoobot";
const CHANNEL_DB_ID = "cmv0tqkcf000gf4s0neae75aj";

/** Premier canal/chat porté par une réponse MTProto (`Updates.chats`), sinon null. */
function firstChatOf(result: unknown): Api.Channel | Api.Chat | null {
  const chats = (result as { chats?: unknown[] } | undefined)?.chats ?? [];
  for (const c of chats) if (c instanceof Api.Channel || c instanceof Api.Chat) return c;
  return null;
}

async function main() {
  const row = await prisma.setting.findUnique({ where: { key: TELEGRAM_USER_API_SETTING } });
  const raw = row?.value;
  console.log("setting telegram.userApi:", raw && typeof raw === "object" ? Object.keys(raw) : "(absent)");
  const api = parseTelegramUserApi(raw);
  let apiHash = "";
  try {
    if (api) apiHash = decrypt(api.apiHashEncrypted);
  } catch (e) {
    console.log("decrypt apiHash a echoue:", (e as Error).message);
  }
  console.log("apiId:", api?.apiId || "(vide)", "| apiHash:", apiHash ? `${apiHash.slice(0, 6)}...` : "(vide)");
  if (!api || !apiHash) {
    console.log("=> identifiants API introuvables en base");
    return;
  }

  const acc = await prisma.telegramUserAccount.findFirst({});
  if (!acc) {
    console.log("aucun compte userbot en base");
    return;
  }
  console.log("compte userbot:", acc.phone, "| status:", acc.status);

  const client = new TelegramClient(new StringSession(decrypt(acc.sessionEncrypted)), api.apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();
  const me = await client.getMe();
  if (me instanceof Api.User) console.log("connecte en tant que:", me.username ?? "(sans username)", "| id", String(me.id));

  const dialogs = await client.getDialogs({ limit: 300 });
  const trouve = dialogs.find((d) => String(d.title ?? "").toLowerCase().includes(TITRE.toLowerCase()));

  let entity: Api.Channel | Api.Chat | null = null;
  const existant = (trouve as { entity?: unknown } | undefined)?.entity;
  if (existant instanceof Api.Channel || existant instanceof Api.Chat) entity = existant;
  if (entity) {
    console.log("canal DEJA EXISTANT:", trouve?.title, "| id interne", String(entity.id));
  } else {
    const res = await client.invoke(
      new Api.channels.CreateChannel({
        title: TITRE,
        about: "Canal de test LinkAffiPro",
        broadcast: true,
        megagroup: false,
      }),
    );
    entity = firstChatOf(res);
    if (!entity) throw new Error("Telegram n'a pas renvoye le canal cree.");
    console.log("canal CREE:", TITRE, "| id interne", String(entity.id));
  }

  const chatId = `-100${entity.id}`;
  console.log("botApiChatId =", chatId);

  const bot = await client.getEntity(BOT_USERNAME);
  console.log("bot resolu:", bot instanceof Api.User ? (bot.username ?? String(bot.id)) : "(entite inattendue)");

  try {
    await client.invoke(new Api.channels.InviteToChannel({ channel: entity, users: [bot] }));
    console.log("=> bot ajoute au canal");
  } catch (e) {
    console.log("invite bot:", (e as Error).message);
  }

  try {
    await client.invoke(
      new Api.channels.EditAdmin({
        channel: entity,
        userId: bot,
        adminRights: new Api.ChatAdminRights({
          changeInfo: true,
          postMessages: true,
          editMessages: true,
          deleteMessages: true,
          banUsers: true,
          inviteUsers: true,
          pinMessages: true,
        }),
        rank: "bot",
      }),
    );
    console.log("=> bot promu ADMIN avec droit d'inviter");
  } catch (e) {
    console.log("promotion bot:", (e as Error).message);
  }

  await prisma.channel.update({ where: { id: CHANNEL_DB_ID }, data: { telegramChatId: BigInt(chatId) } });
  console.log("=> telegramChatId mis a jour en base :", chatId);

  await client.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
