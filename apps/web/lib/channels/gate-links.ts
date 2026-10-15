import type { GateMode } from "@linkaffipro/db";

/**
 * Liens des canaux à rejoindre dans « Qui peut entrer et quand » (fiche canal) : règles pures, testées sans base.
 * - `alignGate` : l'exigence enregistrée suit toujours les canaux choisis ;
 * - `gateLinkRows` / `gateLinksSummary` : état de chaque canal à rejoindre (prêt, à vérifier, problème + solution) ;
 * - `gateCheckFlash` : message après l'enregistrement de la règle ou « Vérifier les liens ».
 * Les liens se créent avec n'importe lequel de nos bots administrateurs du canal à rejoindre (paquet telegram,
 * join-flow/gate-links.ts) ; la solution proposée est d'ajouter le bot qui traite les demandes du canal.
 */

/**
 * Exigence alignée sur les canaux choisis : aucun canal (le canal lui-même et les doublons retirés) → aucune
 * exigence ; des canaux enregistrés sans exigence (ancien formulaire en « trois choix ») → obligatoires ; sinon le
 * réglage choisi (obligatoires ou proposés).
 */
export function alignGate(
  gateMode: GateMode,
  gateChannelIds: readonly string[],
  channelId: string,
): { gateMode: GateMode; gateChannelIds: string[] } {
  const ids = [...new Set(gateChannelIds.filter((id) => id && id !== channelId))];
  if (ids.length === 0) return { gateMode: "NONE", gateChannelIds: [] };
  return { gateMode: gateMode === "NONE" ? "REQUIRED" : gateMode, gateChannelIds: ids };
}

/** Résultat d'une vérification (création des liens) pour un canal à rejoindre. */
export type GateCheckResult = {
  channelId: string;
  title: string;
  /**
   * « ok » : lien créé ou déjà prêt ; « public » : lien public du canal ; « no_link » : aucun de nos bots n'a pu créer
   * de lien ; « cannot_verify » : lien public, mais aucun de nos bots ne peut vérifier (canaux obligatoires).
   */
  status: "ok" | "public" | "no_link" | "cannot_verify";
  /** @noms des bots essayés. */
  tried: string[];
};

export type GateLinkRowState = "ok" | "pending" | "problem";

export type GateLinkRow = {
  channelId: string;
  title: string;
  state: GateLinkRowState;
  text: string;
  /** Ce qu'il faut faire, en français clair (problème ou lien à vérifier). */
  solution?: string;
};

function botName(bot: string | null | undefined): string {
  return bot ? `@${bot}` : "un de nos bots";
}

/** « Ajoutez @bot comme administrateur de « X » avec le droit « Inviter via un lien », puis cliquez … ». */
export function gateSolution(title: string, bot: string | null | undefined): string {
  return `Ajoutez ${botName(bot)} comme administrateur de « ${title} » avec le droit « Inviter via un lien », puis cliquez « Vérifier les liens ».`;
}

/**
 * État de chaque canal à rejoindre (lu en base, sans appel à Telegram) :
 * `links` : bot créateur du lien prêt (par canal) ; `admins` : nos bots administrateurs (droit d'inviter) ;
 * `lastCheck` : dernière vérification enregistrée (elle prime : Telegram a pu refuser un bot que la base croit
 * administrateur) ; `solutionBot` : bot qui traite les demandes du canal source.
 */
export function gateLinkRows(input: {
  gateMode: GateMode;
  channels: ReadonlyArray<{ id: string; title: string; username: string | null }>;
  links: Readonly<Record<string, string | null>>;
  admins: Readonly<Record<string, ReadonlyArray<{ username: string; canInvite: boolean | null }>>>;
  lastCheck: readonly GateCheckResult[] | null;
  solutionBot: string | null;
}): GateLinkRow[] {
  const required = input.gateMode === "REQUIRED";
  return input.channels.map((c): GateLinkRow => {
    const admins = input.admins[c.id] ?? [];
    const canVerify = admins.length > 0;
    const solution = gateSolution(c.title, input.solutionBot);
    const base = { channelId: c.id, title: c.title };
    if (c.id in input.links) {
      const by = input.links[c.id];
      return {
        ...base,
        state: "ok",
        text: by ? `Prêt : le lien est créé par @${by}.` : "Prêt : le lien est créé.",
      };
    }
    if (c.username) {
      if (!required || canVerify)
        return { ...base, state: "ok", text: "Prêt : le lien public du canal est envoyé." };
      return {
        ...base,
        state: "problem",
        text: "Le lien public du canal est envoyé, mais le bot ne peut pas vérifier que la personne l'a rejoint.",
        solution,
      };
    }
    const failed = input.lastCheck?.find((r) => r.channelId === c.id && r.status === "no_link");
    if (failed)
      return {
        ...base,
        state: "problem",
        text:
          failed.tried.length > 0
            ? `Telegram a refusé de créer le lien (essayé avec ${failed.tried.join(", ")}).`
            : "Le bot ne peut pas créer de lien vers ce canal.",
        solution,
      };
    if (admins.some((a) => a.canInvite !== false))
      return {
        ...base,
        state: "pending",
        text: "Lien pas encore créé : cliquez « Vérifier les liens ».",
      };
    return {
      ...base,
      state: "problem",
      text: "Le bot ne peut pas créer de lien vers ce canal.",
      solution,
    };
  });
}

/**
 * Phrase d'ensemble au-dessus de la liste (et état « OK » visible quand tout va bien). `gateMode` : canaux
 * « Proposés » (SOFT) → l'accueil n'a que les boutons des canaux, sans « ✅ J'ai rejoint » (phase 14, décision E5).
 */
export function gateLinksSummary(
  rows: readonly GateLinkRow[],
  gateMode: GateMode = "REQUIRED",
): { ok: boolean; text: string } {
  const problems = rows.filter((r) => r.state === "problem").length;
  if (problems === 1)
    return {
      ok: false,
      text: "1 canal pose problème : les personnes ne recevront pas son lien.",
    };
  if (problems > 1)
    return {
      ok: false,
      text: `${problems} canaux posent problème : les personnes ne recevront pas leur lien.`,
    };
  if (rows.some((r) => r.state === "pending"))
    return { ok: false, text: "Liens pas encore vérifiés : cliquez « Vérifier les liens »." };
  return {
    ok: true,
    text:
      gateMode === "SOFT"
        ? "Tout est prêt : le bot envoie un bouton par canal."
        : "Tout est prêt : le bot envoie un bouton par canal et « ✅ J'ai rejoint ».",
  };
}

/** Message après la vérification (enregistrement de la règle ou « Vérifier les liens »). */
export function gateCheckFlash(
  results: readonly GateCheckResult[],
  solutionBot: string | null,
): { ok?: string; error?: string } {
  if (results.length === 0) return {};
  const bad = results.filter((r) => r.status === "no_link" || r.status === "cannot_verify");
  if (bad.length === 0) return { ok: "Liens des canaux à rejoindre vérifiés : tout est prêt." };
  const parts = bad.map((r) => {
    const what =
      r.status === "no_link"
        ? `Le bot ne peut pas créer le lien de « ${r.title} »`
        : `Le bot ne peut pas vérifier que la personne a rejoint « ${r.title} »`;
    const fix = gateSolution(r.title, solutionBot);
    return `${what} : ${fix.charAt(0).toLowerCase()}${fix.slice(1)}`;
  });
  return { error: parts.join(" ") };
}
