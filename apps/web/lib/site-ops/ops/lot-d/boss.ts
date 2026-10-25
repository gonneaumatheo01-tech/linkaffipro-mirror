/**
 * Phase 34, lot D — cœurs de la page Agents → Kevin (ADMIN) : plafond mensuel de l'IA du Boss (`Setting`
 * `boss.budget`, journal `boss.budget_saved`) et prénom affiché (`Setting` `boss.name`, journal `boss.name_saved`).
 */
import { MAX_BOSS_BUDGET_EUROS, parseBossBudgetForm, parseBossNameForm } from "@/lib/agents/boss";
import { saveBossBudget, saveBossName } from "@/lib/agents/boss-save";
import { adminOnly, errorText, euros, fail, ok, preview, uid, type CoreRun } from "./kit";

export const runSaveBossBudget: CoreRun = async (fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const parsed = parseBossBudgetForm(fd);
  if (!parsed.ok) return fail(parsed.error, "invalid", "euros");
  if (opts.dryRun) return preview(`Plafond de l'IA de Kevin : ${euros(parsed.data)} par mois.`);
  try {
    await saveBossBudget(parsed.data, uid(actor), actor.via);
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  const amount = (parsed.data / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return ok(
    parsed.data === 0
      ? "Plafond à 0 € : il ne comprend plus que les commandes exactes."
      : `Plafond enregistré : ${amount} € par mois (${MAX_BOSS_BUDGET_EUROS} € au plus).`,
  );
};

export const runSaveBossName: CoreRun = async (fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const parsed = parseBossNameForm(fd);
  if (!parsed.ok) return fail(parsed.error, "invalid", "name");
  if (opts.dryRun) return preview(`Prénom affiché du Boss : ${parsed.data}.`);
  try {
    await saveBossName(parsed.data, uid(actor), actor.via);
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok(`Prénom enregistré : ${parsed.data}.`);
};
