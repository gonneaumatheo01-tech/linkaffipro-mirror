/**
 * Relance unique des demandes encore ouvertes (phase 25, `Setting` `agents.phase25.requestsRelaunched`), depuis le
 * cycle du Grand Chef : la question en cours est renvoyée une fois (en réponse à son premier message), les suivantes
 * restent dans l'ordre de la file (une à la fois, comme toujours). Sans messager admin, rien n'est marqué : le cycle
 * suivant réessaie.
 */
import { agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { confirmButtonsOf, currentHumanRequest, formatQuestion, sendNextHumanRequest } from "../human/requests";
import type { AgentsDeps } from "../types";

export const REQUESTS_RELAUNCHED_KEY = "agents.phase25.requestsRelaunched";

export async function relaunchOpenRequestsOnce(deps: AgentsDeps): Promise<{ relaunched: boolean; open: number }> {
  if ((await readSetting(deps, REQUESTS_RELAUNCHED_KEY)) !== undefined) return { relaunched: false, open: 0 };
  if (!deps.admin) return { relaunched: false, open: 0 };
  const open = await deps.prisma.humanRequest.count({ where: { status: { in: ["QUEUED", "PENDING"] } } });
  // Marqué avant l'envoi : jamais deux relances, même si l'envoi échoue.
  await writeSetting(deps, REQUESTS_RELAUNCHED_KEY, { at: nowOf(deps).toISOString(), open });
  if (open === 0) return { relaunched: false, open };
  const current = await currentHumanRequest(deps);
  if (current) {
    const head = open > 1 ? `🔁 ${open} questions encore ouvertes : je les reprends une par une.\n` : "";
    try {
      const sent = await deps.admin.send(`${head}${formatQuestion(current, { reminder: true })}`, {
        replyToMessageId: current.telegramMessageId ?? undefined,
        buttons: confirmButtonsOf(current),
      });
      // Le nouveau message devient celui auquel répondre ; le rappel 24 h ne repart pas après.
      await deps.prisma.humanRequest.update({
        where: { id: current.id },
        data: { remindedAt: nowOf(deps), ...(sent ? { telegramMessageId: sent.messageId } : {}) },
      });
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, requestId: current.id }, "[agents] relance non envoyée");
    }
  } else await sendNextHumanRequest(deps);
  await agentEvent(deps, "agents.request.relaunched_all", { open, currentId: current?.id ?? null });
  return { relaunched: true, open };
}
