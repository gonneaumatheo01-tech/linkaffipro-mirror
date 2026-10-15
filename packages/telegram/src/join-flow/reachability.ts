/**
 * Le bot peut-il encore écrire à une personne en privé ? (phase 14, décision E2) Règles pures, partagées par le bot
 * (« Canaux rejoints »), le worker (rappels, « Accepté ») et le site (acceptation à la main).
 *
 * Telegram ne laisse un bot écrire en premier qu'à une personne qui a ouvert la conversation avec lui (« Démarrer », ou
 * un de ses boutons). Seule exception : pendant les 5 minutes qui suivent une demande d'adhésion, le bot peut écrire au
 * chat `user_chat_id` de la demande. Un message envoyé grâce à cette fenêtre ne rend PAS la personne joignable ensuite :
 * passé 5 minutes, Telegram répond « Forbidden: bot can't initiate conversation with a user ».
 */

/** Fenêtre pendant laquelle Telegram laisse le bot écrire après une demande d'adhésion (`user_chat_id`). */
export const JOIN_REQUEST_DM_WINDOW_MS = 5 * 60_000;

/** État enregistré d'un membre pour un bot (`MemberBotState`), ou rien si le bot ne lui a jamais parlé. */
export type BotStateLike = {
  canDm: boolean;
  startedAt: Date | null;
  blockedAt: Date | null;
} | null;

/** Demande d'adhésion qui ouvre la fenêtre de 5 minutes (chat `user_chat_id` et date de la demande). */
export type JoinWindowRequest = { userChatId: bigint | null; requestedAt: Date } | null;

export type Reachability =
  | {
      reachable: true;
      /** « started » : la personne a démarré le bot (ou appuyé sur un bouton) ; « join_window » : demande de moins de 5 min. */
      via: "started" | "join_window";
    }
  | {
      reachable: false;
      /**
       * « blocked » : la personne a bloqué le bot (Telegram l'a dit) ; « never_started » : elle n'a jamais appuyé sur
       * « Démarrer » et la fenêtre de 5 minutes est passée ; « unreachable » : Telegram a refusé le dernier envoi.
       */
      reason: "blocked" | "never_started" | "unreachable";
    };

/** La demande a-t-elle moins de 5 minutes et porte-t-elle un `user_chat_id` ? */
export function inJoinWindow(request: JoinWindowRequest | undefined, now: Date): boolean {
  if (!request || request.userChatId === null) return false;
  const age = now.getTime() - request.requestedAt.getTime();
  return age >= -60_000 && age < JOIN_REQUEST_DM_WINDOW_MS;
}

/** La personne a démarré le bot (ou appuyé sur un de ses boutons), ne l'a pas bloqué, et Telegram n'a rien refusé depuis. */
export function hasStartedBot(state: BotStateLike | undefined): boolean {
  return !!state && !!state.startedAt && state.canDm && !state.blockedAt;
}

/** Joignable : a démarré le bot et ne l'a pas bloqué, ou demande d'adhésion de moins de 5 minutes avec `user_chat_id`. */
export function reachability(
  state: BotStateLike | undefined,
  request: JoinWindowRequest | undefined,
  now: Date,
): Reachability {
  // Blocage connu (Telegram l'a dit : my_chat_member ou « bot was blocked by the user ») : rien, même dans la fenêtre.
  if (state && state.blockedAt && !state.canDm) return { reachable: false, reason: "blocked" };
  if (hasStartedBot(state)) return { reachable: true, via: "started" };
  if (inJoinWindow(request, now)) return { reachable: true, via: "join_window" };
  return { reachable: false, reason: state?.startedAt ? "unreachable" : "never_started" };
}
