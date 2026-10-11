import type { Job } from "bullmq";
import type { CustomEmojiJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { fetchPreviews } from "../custom-emoji/previews";
import {
  importAccountEmojis,
  refreshAccountStatus,
  tickAccountStatus,
} from "../custom-emoji/account";

/**
 * File `custom-emoji` (phase 12) : aperçus des emojis animés (Bot API), packs installés et état du compte Telegram
 * connecté (MTProto, un seul client à la fois, `withMtprotoLock`).
 * - `fetch-previews` : aperçus de `customEmojiIds` (enfilée après un ajout), ou tous les aperçus manquants ;
 * - `tick` (10 min) : aperçus manquants jamais essayés ou en échec depuis plus d'une heure ;
 * - `import-account` : packs d'emojis animés installés sur le compte connecté → bibliothèque (source ACCOUNT) ;
 * - `account-status` : Premium et droit de publier par canal → `Setting` `mtproto.publishStatus` (bouton « Vérifier »).
 */
export async function processCustomEmoji(job: Job<CustomEmojiJob>): Promise<unknown> {
  const data: CustomEmojiJob = job.data ?? { type: "tick" };
  switch (data.type) {
    case "fetch-previews":
      return fetchPreviews({ customEmojiIds: data.customEmojiIds });
    case "tick": {
      const previews = await fetchPreviews();
      // État du compte connecté (Premium, droits par canal) s'il date de plus d'une heure. Une erreur ici ne doit pas
      // faire échouer le passage des aperçus.
      const account = await tickAccountStatus().catch((err: unknown) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "état du compte Telegram non relevé",
        );
        return { skipped: "erreur" };
      });
      return { previews, account };
    }
    case "import-account":
      return importAccountEmojis({ requestedById: data.requestedById ?? null });
    case "account-status":
      return refreshAccountStatus({ channelIds: data.channelIds, explicit: true });
  }
}

export const repeatableCustomEmoji: Array<{
  data: Record<string, unknown>;
  everyMs: number;
  jobId: string;
}> = [{ data: { type: "tick" }, everyMs: 10 * 60 * 1000, jobId: "custom-emoji:tick" }];
