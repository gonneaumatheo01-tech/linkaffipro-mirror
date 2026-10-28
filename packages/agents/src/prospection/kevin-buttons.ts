/**
 * Phase 31, chantier D — boutons sous les prospects et chemin rapide de Kevin (sans IA) :
 * - `prospect:<id>:<action>` (✅ Contacté, 🤝 Signé, 🔎 Dossier, ⏰ Plus tard, ❌ Pas intéressé, type de deal, rappels)
 *   → `handleProspectCallback` (Pipeline). Seuls l'admin et les responsables de l'équipe (ADMIN, MANAGER) changent le
 *   pipeline ; un MEMBER du groupe a seulement un petit message au doigt ;
 * - réponse au montant après « CPA » (« 100 ») → `answerPendingDeal`, avant toute autre lecture du message ;
 * - « @nom » seul, d'un canal connu → sa fiche.
 */
import { adminTelegramId } from "../admin/journal";
import type { BossDeps, BossReply, BossTeamInput } from "../boss/contract";
import { findTeamMember } from "../boss/team/members";
import { pick } from "../boss/voice";
import { PROSPECT_CALLBACK_PREFIX } from "./contract";
import { prospectionPort, type ProspectCallbackOutcome, type ProspectionKevinDeps } from "./kevin-port";
import { prospectionAdvancedFastPath } from "./kevin-advanced";
import { findProspect, prospectDetailLines } from "./kevin-read";
import { PROSPECTION_KEVIN_VARIANTS as V } from "./kevin-texts";

export function isProspectCallbackData(data: string | null | undefined): boolean {
  return typeof data === "string" && data.startsWith(PROSPECT_CALLBACK_PREFIX);
}

/** L'admin, ou un responsable présenté (ADMIN, MANAGER) : peut changer le pipeline. */
export async function mayChangePipeline(deps: Pick<BossDeps, "prisma">, telegramId: bigint | number | string): Promise<boolean> {
  const id = BigInt(telegramId);
  const admin = await adminTelegramId(deps);
  if (admin !== null && admin === id) return true;
  const m = await findTeamMember(deps, id).catch(() => null);
  return !!m && (m.role === "ADMIN" || m.role === "MANAGER");
}

/** Bouton `prospect:…` appuyé (privé de l'admin, groupe de l'équipe, privé d'un membre). Ne lève jamais. */
export async function prospectButton(
  deps: ProspectionKevinDeps,
  input: { data: string; chatId: string | number | bigint; fromTelegramId: bigint | number | string },
): Promise<ProspectCallbackOutcome & { handled: true }> {
  const chatId = String(input.chatId);
  try {
    if (!(await mayChangePipeline(deps, input.fromTelegramId))) return { handled: true, toast: pick(V.buttonNotYours, "prospection.button.notYours", chatId) };
    const r = await prospectionPort(deps).handleProspectCallback(deps, { data: input.data, chatId, actorTelegramId: String(input.fromTelegramId) });
    return { ...r, handled: true };
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[prospection] bouton en échec");
    return { handled: true, toast: "Oups, ça n'a pas marché." };
  }
}

const AT_ONLY = /^@([A-Za-z][A-Za-z0-9_]{3,31})\s*\??$/;

/**
 * Chemin rapide de la prospection (dans `bossFastPath`, avant l'IA) : montant d'un deal en attente, puis « @nom » seul
 * d'un canal connu. Null : la suite décide. Un MEMBER ne répond jamais au montant (le pipeline n'est pas à lui).
 */
export async function prospectionFastPath(deps: BossDeps, input: BossTeamInput): Promise<{ reply: BossReply; actionKey: string } | null> {
  const text = (input.text ?? "").trim();
  if (!text || input.forwarded) return null;
  const d = deps as ProspectionKevinDeps;
  const speaker = input.speaker;
  const chatKey = input.chat ? input.chat.chatId.toString() : ((await adminTelegramId(deps))?.toString() ?? null);
  const canChange = !speaker || speaker.kind === "admin" || speaker.role === "ADMIN" || speaker.role === "MANAGER";
  // Phase 32 : réponse au « 📝 Note » d'une alerte, « @x = affilié 1234 » (avant le montant : la note peut contenir un chiffre).
  const adv = await prospectionAdvancedFastPath(deps, input, { chatKey, canChange });
  if (adv) return adv;
  if (chatKey && canChange && /\d/.test(text) && text.length <= 80) {
    const deal = await prospectionPort(d).answerPendingDeal(d, chatKey, text);
    if (deal) return { reply: { reply: deal }, actionKey: "prospect_statut" };
  }
  const at = AT_ONLY.exec(text);
  if (at) {
    const p = await findProspect(deps, `@${at[1]}`);
    if (p) return { reply: { reply: (await prospectDetailLines(deps, p)).join("\n") }, actionKey: "prospect_detail" };
  }
  return null;
}
