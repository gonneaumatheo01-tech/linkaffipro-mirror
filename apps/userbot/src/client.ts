/**
 * Client MTProto PERSISTANT d'un compte reel (phase 18, etape 2a).
 * Contrairement a packages/mtproto (qui ouvre et referme a chaque appel),
 * ce client reste connecte et ecoute les messages entrants.
 */
import { createClient } from "@linkaffipro/mtproto";
import { credentials, sessionOf } from "@linkaffipro/userbot";
import { NewMessage } from "telegram/events";
import { logger } from "./logger";

export type LiveAccount = {
  id: string;
  label: string;
  stop: () => Promise<void>;
};

export type AccountToStart = { id: string; label: string; phone: string };

export async function startAccount(account: AccountToStart): Promise<LiveAccount> {
  const creds = await credentials();
  const session = await sessionOf(account.id);
  const client = createClient(session, creds.apiId, creds.apiHash);

  await client.connect();
  const me = await client.getMe();
  logger.info({ compte: account.label, username: me.username ?? null }, "compte connecte");

  client.addEventHandler(
    (event) => {
      const msg = event.message;
      const texte = msg?.message ?? "";
      logger.info(
        { compte: account.label, de: String(msg?.senderId ?? ""), texte: texte.slice(0, 160) },
        "message recu",
      );
    },
    new NewMessage({ incoming: true }),
  );

  return {
    id: account.id,
    label: account.label,
    stop: async () => {
      await client.disconnect().catch(() => undefined);
      await client.destroy().catch(() => undefined);
    },
  };
}
