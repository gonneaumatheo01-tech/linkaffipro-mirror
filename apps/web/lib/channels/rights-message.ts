import type { RecheckResult } from "@linkaffipro/telegram";

/** « 1 canal » / « 3 canaux ». */
export function canaux(n: number): string {
  return `${n} ${n > 1 ? "canaux" : "canal"}`;
}

/** Phrase « Droits vérifiés : … » pour un canal (page Canaux, fiche canal). */
export function rightsMessage(r: RecheckResult): string {
  const admins = r.admins.length > 0 ? r.admins.map((a) => `@${a.username}`).join(", ") : "aucun de nos bots n'est administrateur";
  const revoked = r.revoked.length > 0 ? ` ; droits retirés : ${r.revoked.map((u) => `@${u}`).join(", ")}` : "";
  const warning = r.warning && r.admins.length === 0 && !/aucun de nos bots/i.test(r.warning) ? ` (${r.warning})` : "";
  return `Droits vérifiés pour « ${r.title} » : ${admins}${revoked}${warning}`;
}

/** Résumé pour tous les canaux : nombre vérifié, canaux sans bot, bots retirés. */
export function rightsSummary(results: RecheckResult[]): string {
  if (results.length === 0) return "Droits vérifiés : aucun canal actif.";
  const without = results.filter((r) => r.admins.length === 0).map((r) => `« ${r.title} »`);
  const revoked = results.flatMap((r) => r.revoked.map((u) => `@${u} sur « ${r.title} »`));
  const unverifiable = results.filter((r) => r.warning && r.admins.length === 0 && !/aucun de nos bots/i.test(r.warning)).length;
  const parts = [`Droits vérifiés sur ${canaux(results.length)}`];
  parts.push(without.length > 0 ? `sans bot administrateur : ${without.join(", ")}` : "tous ont au moins un bot administrateur");
  if (revoked.length > 0) parts.push(`droits retirés : ${revoked.join(", ")}`);
  if (unverifiable > 0) parts.push(`${unverifiable} non vérifiable${unverifiable > 1 ? "s" : ""} pour le moment`);
  return `${parts.join(" ; ")}.`;
}
