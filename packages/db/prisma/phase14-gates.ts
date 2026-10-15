// Rattrapage de la phase 14 (décision E3) : demandes restées « en attente des canaux » alors que la personne a rejoint
// les canaux obligatoires sans appuyer sur « ✅ J'ai rejoint » (constat du 15 octobre).
//   pnpm db:phase14                                   (local)
//   railway ssh --service web -- pnpm db:phase14      (production)
//   pnpm db:phase14 --force                           (nouveau passage, sans risque)
//
// Applique à TOUTES les demandes en attente des canaux la vérification de la validation automatique : un canal
// obligatoire est rejoint si la personne en est membre, ou si elle y a une demande à nous en cours, programmée ou
// acceptée (même règle que « ✅ J'ai rejoint », canal d'origine et « aucun canal imposé » de la phase 11 respectés).
// Tous rejoints : acceptation programmée (délai de la règle à partir de maintenant), événement
// `membership.gate_satisfied` { auto: true, trigger: "backfill" }, message « Canaux rejoints » seulement si le bot peut
// encore écrire à la personne. Aucune autre demande n'est touchée (ni règle, ni accueil).
//
// Avant cela, deux réparations (même passage, comptées dans la marque) :
// - états « joignable / a bloqué le bot » hérités : « joignable » sans « Démarrer » (accueil parti dans la fenêtre de
//   5 minutes) → plus joignable, sauf si la personne a déjà écrit au bot en privé (elle reste joignable) ; « a bloqué
//   le bot » posé par un refus qui n'était pas un blocage (aucun événement `member.blocked` pour ce bot) → effacé ;
// - accueils par défaut restés tels que la plateforme les a insérés : réécrits sans « puis appuie sur ✅ J'ai rejoint »
//   (bouton absent avec des canaux « Proposés ») ; un accueil de l'équipe n'est jamais touché.
//
// Idempotent : la marque `Setting` `phase14.gateBackfill` (avec le nombre de demandes validées) est écrite à la fin ;
// ensuite le script affiche le résultat enregistré sans rien toucher. Le worker fait le même rattrapage tout seul au
// premier passage de son filet (toutes les 2 minutes) si la marque manque : le premier des deux qui passe l'écrit.
//
// La vérification est celle du paquet telegram (`runGateBackfillOnce`, join-flow/prisma-auto-gate.ts), importée par
// chemin calculé : le paquet db ne dépend pas du paquet telegram (qui dépend de lui). Le script tourne dans le
// monorepo complet (conteneur web), où packages/telegram et ses dépendances sont présents.
import { pathToFileURL } from "node:url";

/** Marque écrite à la fin du premier passage (même clé que `GATE_BACKFILL_KEY` du paquet telegram). */
export const GATE_BACKFILL_KEY = "phase14.gateBackfill";

/** Résultat du rattrapage (forme `GateBackfillResult` du paquet telegram). */
export type Phase14GateReport = {
  alreadyDone: boolean;
  doneAt: string;
  by: "script" | "worker";
  checked: number;
  satisfied: number;
  satisfiedIds: string[];
  stillPending: number;
  deferred: number;
  withoutGates: number;
  errors: number;
  byChannel: Array<{ channelId: string; title: string; satisfied: number }>;
  /** États « joignable / a bloqué le bot » hérités d'avant la phase 14, réparés. */
  botStates: { canDmCleared: number; blockedCleared: number; wroteKept: number };
  /** Accueils par défaut réécrits sans « ✅ J'ai rejoint » (jamais un texte de l'équipe). */
  sequenceTexts: { updated: number; upToDate: number; keptByTeam: number };
};

type TelegramBackfill = {
  runGateBackfillOnce: (opts: {
    force?: boolean;
    now?: Date;
    by?: "script" | "worker";
  }) => Promise<Phase14GateReport>;
};

/** Lance le rattrapage (fonction du paquet telegram, voir l'en-tête). `force` : nouveau passage malgré la marque. */
export async function phase14GateBackfill(
  opts: { force?: boolean; now?: Date } = {},
): Promise<Phase14GateReport> {
  const spec = new URL("../../telegram/src/join-flow/prisma-auto-gate.ts", import.meta.url).href;
  const mod = (await import(spec)) as TelegramBackfill;
  return mod.runGateBackfillOnce({ ...opts, by: "script" });
}

/** Résumé en français du rattrapage (sortie du script). */
export function phase14Summary(r: Phase14GateReport): string {
  const when = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(r.doneAt));
  const head = r.alreadyDone
    ? `déjà fait le ${when} (par ${r.by === "worker" ? "le service d'arrière-plan" : "ce script"}) : résultat enregistré, aucune demande revérifiée.`
    : `fait le ${when}.`;
  const channels = r.byChannel.map((c) => `« ${c.title} » : ${c.satisfied}`).join(", ");
  return [
    `[phase14] Rattrapage des demandes en attente des canaux : ${head}`,
    `[phase14] ${r.checked} demande(s) relue(s) ; ${r.satisfied} acceptée(s) (canaux obligatoires tous rejoints, acceptation programmée)${channels ? ` — ${channels}` : ""} ; ${r.stillPending} encore en attente des canaux.`,
    ...(r.deferred > 0
      ? [
          `[phase14] ${r.deferred} demande(s) pas entièrement vérifiée(s) (limite d'appels à Telegram) : le service d'arrière-plan les reprend toutes les 2 minutes.`,
        ]
      : []),
    ...(r.withoutGates > 0
      ? [
          `[phase14] ${r.withoutGates} demande(s) dont la règle n'a plus de canaux à rejoindre : laissées telles quelles (bouton « Leur appliquer la nouvelle règle » de la fiche canal).`,
        ]
      : []),
    ...(r.errors > 0 ? [`[phase14] ${r.errors} demande(s) en erreur (voir le journal).`] : []),
    `[phase14] États des membres réparés : ${r.botStates.canDmCleared} personne(s) qui n'avaient jamais démarré le bot ni écrit au bot ne sont plus comptées « joignables » ; ${r.botStates.wroteKept} personne(s) qui avaient écrit au bot restent joignables ; ${r.botStates.blockedCleared} « a bloqué le bot » effacé(s) (refus de Telegram qui n'étaient pas des blocages).`,
    `[phase14] Accueils par défaut : ${r.sequenceTexts.updated} réécrit(s) sans « ✅ J'ai rejoint » ; ${r.sequenceTexts.keptByTeam} accueil(s) de l'équipe jamais touché(s).`,
  ].join("\n");
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  try {
    console.log(phase14Summary(await phase14GateBackfill({ force })));
  } finally {
    // Connexions ouvertes par le paquet telegram (base, file) : fermées pour rendre la main.
    const db = (await import("../src/client")) as { prisma: { $disconnect(): Promise<void> } };
    await db.prisma.$disconnect().catch(() => undefined);
    const queue = (await import(new URL("../../queue/src/client.ts", import.meta.url).href).catch(
      () => null,
    )) as { closeQueues?: () => Promise<void> } | null;
    await queue?.closeQueues?.().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
