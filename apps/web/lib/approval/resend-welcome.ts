import { audit } from "@linkaffipro/db";
import {
  listGateLinksMissing,
  resendGateWelcomeWithDb,
  type GateLinkProblem,
  type ResendWelcomeOutcome,
} from "@linkaffipro/telegram";

/**
 * « Renvoyer l'accueil avec les liens » (point « À faire » de l'accueil) : pour chaque demande encore en attente d'un
 * canal dont l'accueil est parti sans tous les liens des canaux à rejoindre, recrée les liens avec nos bots puis
 * renvoie l'accueil par la file d'envoi. Jamais automatique : seulement sur clic de l'équipe. Une demande qui n'est plus
 * en attente ne reçoit rien.
 */

function people(n: number): string {
  return `${n} personne${n > 1 ? "s" : ""}`;
}

/** Canaux concernés (« X », « Y ») et bot(s) à ajouter comme administrateur. */
function describe(problems: readonly GateLinkProblem[]): { titles: string[]; who: string } {
  const titles = [...new Set(problems.map((p) => p.title))].map((t) => `« ${t} »`);
  const bots = [...new Set(problems.map((p) => p.suggestedBot).filter(Boolean))].map(
    (b) => `@${b}`,
  );
  return { titles, who: bots.length > 0 ? bots.join(" ou ") : "un de nos bots" };
}

/** Message de retour (accueil du site) à partir des issues de chaque demande. */
export function resendSummary(outcomes: readonly ResendWelcomeOutcome[]): {
  ok?: string;
  error?: string;
} {
  if (outcomes.length === 0) return { ok: "Aucune demande n'attend de liens dans ce canal." };
  const sent = outcomes.filter((o) => o.status === "sent").length;
  const ready = outcomes.filter((o) => o.status === "links_ready").length;
  const still = outcomes.flatMap((o) => (o.status === "still_missing" ? o.missing : []));
  const noBot = outcomes.filter((o) => o.status === "no_bot").length;
  const ok: string[] = [];
  if (sent > 0) ok.push(`Accueil renvoyé avec les liens à ${people(sent)}.`);
  if (ready > 0)
    ok.push(
      `Liens prêts pour ${people(ready)} qui n'${ready > 1 ? "ont" : "a"} pas ouvert la conversation avec le bot : Telegram ne permet pas de ${ready > 1 ? "leur" : "lui"} réécrire en premier, ${ready > 1 ? "elles recevront" : "elle recevra"} les liens en appuyant sur « ✅ J'ai rejoint ».`,
    );
  const errors: string[] = [];
  const noLink = still.filter((p) => p.reason !== "cannot_verify");
  const unchecked = still.filter((p) => p.reason === "cannot_verify");
  if (noLink.length > 0) {
    const { titles, who } = describe(noLink);
    errors.push(
      `Liens toujours impossibles à créer pour ${titles.join(", ")} : ajoutez ${who} comme administrateur de ${titles.length > 1 ? "ces canaux" : "ce canal"} avec le droit « Inviter via un lien », puis réessayez.`,
    );
  }
  // Canal obligatoire avec lien public, mais qu'aucun de nos bots ne peut vérifier : « J'ai rejoint » échouerait encore.
  if (unchecked.length > 0) {
    const { titles, who } = describe(unchecked);
    errors.push(
      `Le bot ne peut toujours pas vérifier ${titles.join(", ")} : ajoutez ${who} comme administrateur de ${titles.length > 1 ? "ces canaux" : "ce canal"}, puis réessayez.`,
    );
  }
  if (still.length > 0) errors.push("Rien n'a été envoyé à ces personnes.");
  if (noBot > 0)
    errors.push(
      `Aucun de nos bots ne peut écrire pour ce canal (${people(noBot)}) : ajoutez un de nos bots comme administrateur du canal.`,
    );
  if (ok.length === 0 && errors.length === 0)
    return { ok: "Ces demandes ne sont plus en attente : rien n'a été envoyé." };
  return {
    ...(ok.length > 0 ? { ok: ok.join(" ") } : {}),
    ...(errors.length > 0 ? { error: errors.join(" ") } : {}),
  };
}

/** Renvoie l'accueil avec les liens aux demandes concernées d'un canal ; audit `membership.gate_welcome_resent`. */
export async function resendGateWelcomeForChannel(
  channelId: string,
  userId: string,
): Promise<{ ok?: string; error?: string; outcomes: ResendWelcomeOutcome[] }> {
  const rows = await listGateLinksMissing({ channelId, limit: 200 });
  const outcomes: ResendWelcomeOutcome[] = [];
  for (const r of rows)
    outcomes.push(await resendGateWelcomeWithDb(r.membershipId, { byUserId: userId }));
  const count = (s: ResendWelcomeOutcome["status"]) =>
    outcomes.filter((o) => o.status === s).length;
  await audit({
    userId,
    action: "membership.gate_welcome_resent",
    entityType: "Channel",
    entityId: channelId,
    metadata: {
      requests: rows.length,
      sent: count("sent"),
      linksReady: count("links_ready"),
      stillMissing: count("still_missing"),
      notPending: count("not_pending") + count("not_found"),
      membershipIds: rows.map((r) => r.membershipId),
    },
  });
  return { ...resendSummary(outcomes), outcomes };
}
