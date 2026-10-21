import { prisma } from "@linkaffipro/db";
import { decrypt } from "@linkaffipro/core";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

const TITRE = process.argv[2] ?? "Canal Test Local";
const BOT_USERNAME = process.argv[3] ?? "casinogamblingoobot";
const CHANNEL_DB_ID = "cmv0tqkcf000gf4s0neae75aj";

async function main() {
  const row = (await prisma.setting.findUnique({ where: { key: "telegram.userApi" } })) as any;
  const raw = row?.value;
  console.log("setting telegram.userApi:", raw ? Object.keys(raw) : "(absent)");
  const apiId = Number(raw?.apiId);
  let apiHash = "";
  try {
    apiHash = decrypt(raw?.apiHashEncrypted);
  } catch (e) {
    console.log("decrypt apiHash a echoue:", (e as Error).message);
  }
  console.log("apiId:", apiId || "(vide)", "| apiHash:", apiHash ? `${apiHash.slice(0, 6)}...` : "(vide)");
  if (!apiId || !apiHash) { console.log("=> identifiants API introuvables en base"); return; }

  const acc = (await prisma.telegramUserAccount.findFirst({})) as any;
  if (!acc) { console.log("aucun compte userbot en base"); return; }
  console.log("compte userbot:", acc.phone, "| status:", acc.status);

  const client = new TelegramClient(new StringSession(decrypt(acc.sessionEncrypted)), apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();
  const me = (await client.getMe()) as any;
  console.log("connecte en tant que:", me.username ?? "(sans username)", "| id", String(me.id));

  const dialogs = (await client.getDialogs({ limit: 300 })) as any[];
  const trouve = dialogs.find((d) => String(d.title ?? "").toLowerCase().includes(TITRE.toLowerCase()));

  let entity: any = trouve?.entity ?? null;
  if (entity) {
    console.log("canal DEJA EXISTANT:", trouve.title, "| id interne", String(entity.id));
  } else {
    const res: any = await client.invoke(
      new Api.channels.CreateChannel({
        title: TITRE,
        about: "Canal de test LinkAffiPro",
        broadcast: true,
        megagroup: false,
      })
    );
    entity = res.chats[0];
    console.log("canal CREE:", TITRE, "| id interne", String(entity.id));
  }

  const chatId = `-100${entity.id}`;
  console.log("botApiChatId =", chatId);

  const bot = await client.getEntity(BOT_USERNAME);
  console.log("bot resolu:", (bot as any).username ?? String((bot as any).id));

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
      })
    );
    console.log("=> bot promu ADMIN avec droit d'inviter");
  } catch (e) {
    console.log("promotion bot:", (e as Error).message);
  }

  await prisma.channel.update({ where: { id: CHANNEL_DB_ID }, data: { telegramChatId: BigInt(chatId) } });
  console.log("=> telegramChatId mis a jour en base :", chatId);

  await client.disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
