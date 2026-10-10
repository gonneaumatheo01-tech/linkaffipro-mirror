import type { ImportedChannel, RecheckResult } from "@linkaffipro/telegram";

/** « 1 canal » / « 3 canaux ». */
export function canaux(n: number): string {
  return `${n} ${n > 1 ? "canaux" : "canal"}`;
}

/** La vérification n'a pas pu se faire (réseau, limite de débit, aucun bot actif) : les droits enregistrés sont conservés. */
function unverifiable(r: Pick<RecheckResult, "status">): boolean {
  return r.status === "unavailable" || r.status === "no_bot";
}

/** Phrase « Droits vérifiés : … » pour un canal (page Canaux, fiche canal). */
export function rightsMessage(r: RecheckResult): string {
  const admins =
    r.admins.length > 0
      ? r.admins.map((a) => `@${a.username}`).join(", ")
      : "aucun de nos bots n'est administrateur";
  const revoked =
    r.revoked.length > 0 ? ` ; droits retirés : ${r.revoked.map((u) => `@${u}`).join(", ")}` : "";
  const warning = r.warning && unverifiable(r) ? ` (${r.warning})` : "";
  return `Droits vérifiés pour « ${r.title} » : ${admins}${revoked}${warning}`;
}

/** Résumé pour tous les canaux : nombre vérifié, canaux sans bot, bots retirés, canaux non vérifiables. */
export function rightsSummary(results: RecheckResult[]): string {
  if (results.length === 0) return "Droits vérifiés : aucun canal actif.";
  const without = results
    .filter((r) => r.admins.length === 0 && !unverifiable(r))
    .map((r) => `« ${r.title} »`);
  const revoked = results.flatMap((r) => r.revoked.map((u) => `@${u} sur « ${r.title} »`));
  const notChecked = results.filter(unverifiable).length;
  const parts = [`Droits vérifiés sur ${canaux(results.length)}`];
  parts.push(
    without.length > 0
      ? `sans bot administrateur : ${without.join(", ")}`
      : "tous ont au moins un bot administrateur",
  );
  if (revoked.length > 0) parts.push(`droits retirés : ${revoked.join(", ")}`);
  if (notChecked > 0)
    parts.push(
      `${notChecked} non vérifiable${notChecked > 1 ? "s" : ""} pour le moment (droits conservés, réessayez dans une minute)`,
    );
  return `${parts.join(" ; ")}.`;
}

/** Issue de l'import d'un canal coché (page « Importer mes canaux »). */
export type ImportOutcome = {
  title: string;
  created?: boolean;
  /** Aucun de nos bots n'a accès au canal (vérifié). */
  withoutBot?: boolean;
  /** Droits non vérifiables pour le moment (429, panne, aucun bot actif) : ni « sans bot », ni « avec bot ». */
  unverified?: boolean;
  error?: string;
};

/** Issue d'un canal importé : « sans bot » seulement si la vérification a conclu qu'aucun de nos bots n'y a accès. */
export function importOutcomeOf(
  r: Pick<ImportedChannel, "title" | "created" | "admins" | "status">,
): ImportOutcome {
  const unverified = r.admins.length === 0 && unverifiable(r);
  return {
    title: r.title,
    created: r.created,
    withoutBot: r.admins.length === 0 && !unverified,
    unverified,
  };
}

/** Nombre maximal de titres cités dans le retour (l'adresse de redirection reste courte). */
const MAX_TITLES = 5;

/**
 * Retour résumé de l'import du compte : « 12 canaux importés, 3 sans bot » plutôt qu'une phrase par canal,
 * et la liste courte des canaux non importés avec la première raison.
 */
export function importSummary(outcomes: ImportOutcome[]): { ok?: string; error?: string } {
  const done = outcomes.filter((o) => !o.error);
  const failed = outcomes.filter((o) => o.error);
  const out: { ok?: string; error?: string } = {};
  if (done.length > 0) {
    const withoutBot = done.filter((o) => o.withoutBot && !o.unverified).length;
    const unverified = done.filter((o) => o.unverified).length;
    const known = done.filter((o) => o.created === false).length;
    let msg = `${canaux(done.length)} importé${done.length > 1 ? "s" : ""}`;
    if (withoutBot > 0) msg += `, ${withoutBot} sans bot`;
    if (known > 0) msg += ` (dont ${known} déjà connu${known > 1 ? "s" : ""}, mis à jour)`;
    msg +=
      withoutBot > 0
        ? " : ajoutez un de nos bots comme administrateur dans Telegram, puis cliquez « Re-vérifier les droits des bots »."
        : ".";
    if (unverified > 0)
      msg += ` ${unverified} non vérifiable${unverified > 1 ? "s" : ""} pour le moment : réessayez « Re-vérifier les droits des bots » dans une minute.`;
    out.ok = msg;
  }
  if (failed.length > 0) {
    const titles = failed.slice(0, MAX_TITLES).map((o) => `« ${o.title} »`);
    const more =
      failed.length > MAX_TITLES
        ? ` et ${failed.length - MAX_TITLES} autre${failed.length - MAX_TITLES > 1 ? "s" : ""}`
        : "";
    const reason = String(failed[0]!.error).slice(0, 160);
    out.error = `${canaux(failed.length)} non importé${failed.length > 1 ? "s" : ""} : ${titles.join(", ")}${more} (${reason}).`;
  }
  return out;
}
