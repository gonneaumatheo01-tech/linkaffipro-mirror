/**
 * Phase 26, section 4 — le groupe de travail de l'équipe : un seul groupe (`Setting boss.groupChatId`), enregistré
 * quand l'admin y ajoute Kevin (ou y écrit « Kevin, c'est ici qu'on bosse »), remplacé seulement après un OUI de
 * l'admin en privé. Kevin ajouté par quelqu'un d'autre, ou dans un autre groupe : silence et une ligne de journal.
 * Réglages : `boss.group.requests` (« group » par défaut, « private » : tout continue en privé avec l'admin) et
 * `boss.group.morning` (rapport du matin dans le groupe : sans réglage, il suit la préférence du rapport privé).
 */
import { agentAudit, agentEvent, esc, nowOf, readSetting, writeSetting } from "../../admin/journal";
import type { AgentsDeps } from "../../types";
import { BOSS_GROUP_MORNING_SETTING, BOSS_GROUP_REQUESTS_SETTING, BOSS_GROUP_SETTING } from "../contract";
import { readBossName } from "../memory";

/** `Setting` : `{ chatId, title }` du groupe d'où Kevin a été retiré (il n'y écrit plus jusqu'à ce que l'admin le remette). */
export const BOSS_GROUP_LEFT_SETTING = "boss.group.left";
/** `Setting` : titre du groupe enregistré (affichage). */
export const BOSS_GROUP_TITLE_SETTING = "boss.group.title";
/** `Setting` : groupe où l'accueil a déjà été dit (une fois). */
export const BOSS_GROUP_WELCOMED_SETTING = "boss.group.welcomed";
/** `Setting` : Kevin peut-il supprimer des messages dans le groupe (droit d'administrateur) ? */
export const BOSS_GROUP_CAN_DELETE_SETTING = "boss.group.canDelete";
/** `Setting` : droit de supprimer déjà demandé (une fois). */
export const BOSS_GROUP_DELETE_ASKED_SETTING = "boss.group.deleteRightAsked";

function asChatId(v: unknown): bigint | null {
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  return null;
}

/** Groupe enregistré, ou null. */
export async function readBossGroupId(deps: Pick<AgentsDeps, "prisma">): Promise<bigint | null> {
  return asChatId(await readSetting(deps, BOSS_GROUP_SETTING));
}

/** Kevin a-t-il été retiré du groupe enregistré (et pas encore remis) ? */
export async function bossGroupLeft(deps: Pick<AgentsDeps, "prisma">, chatId: bigint): Promise<boolean> {
  const v = (await readSetting(deps, BOSS_GROUP_LEFT_SETTING)) as { chatId?: unknown } | undefined;
  return asChatId(v?.chatId) === chatId;
}

/**
 * Groupe où Kevin pose ses questions : le groupe enregistré, s'il y est toujours, si l'admin n'a pas demandé que tout
 * reste en privé et si le messager sait écrire ailleurs qu'à l'admin. Sinon null (envoi privé à l'admin, comme avant).
 */
export async function groupForRequests(deps: AgentsDeps): Promise<bigint | null> {
  if (!deps.admin?.sendTo) return null;
  const id = await readBossGroupId(deps);
  if (!id || (await bossGroupLeft(deps, id))) return null;
  const mode = await readSetting(deps, BOSS_GROUP_REQUESTS_SETTING);
  if (typeof mode === "string" && mode.trim().toLowerCase() === "private") return null;
  return id;
}

/** Valeur explicite d'un réglage oui / non (`true`, « oui », `false`, « non »…), sinon null (pur). */
export function explicitSwitch(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "oui", "yes", "on"].includes(t)) return true;
    if (["false", "non", "no", "off"].includes(t)) return false;
  }
  if (v && typeof v === "object" && typeof (v as { enabled?: unknown }).enabled === "boolean") return (v as { enabled: boolean }).enabled;
  return null;
}

/**
 * Groupe du rapport du matin, ou null. `boss.group.morning` explicitement activé → oui ; explicitement désactivé →
 * non ; sinon il suit la préférence du rapport privé (`privateEnabled` : l'admin qui a refusé le rapport du matin ne le
 * reçoit pas non plus dans le groupe).
 */
export async function groupForMorning(deps: AgentsDeps, opts: { privateEnabled?: boolean } = {}): Promise<bigint | null> {
  if (!deps.admin?.sendTo) return null;
  const id = await readBossGroupId(deps);
  if (!id || (await bossGroupLeft(deps, id))) return null;
  const v = explicitSwitch(await readSetting(deps, BOSS_GROUP_MORNING_SETTING));
  if (v === false) return null;
  if (v === null && opts.privateEnabled === false) return null;
  return id;
}

/** Groupe où Kevin peut écrire (alertes graves, accueil), ou null. */
export async function activeBossGroup(deps: AgentsDeps): Promise<bigint | null> {
  if (!deps.admin?.sendTo) return null;
  const id = await readBossGroupId(deps);
  if (!id || (await bossGroupLeft(deps, id))) return null;
  return id;
}

/** Accueil dit une fois dans le groupe (pur). */
export function groupWelcomeText(bossName: string, adminFirstName: string | null): string {
  return `Salut, moi c'est ${esc(bossName)}. ${esc(adminFirstName?.trim() || "Chef")}, présente-moi l'équipe : qui fait quoi ?`;
}

/** Demande du droit de supprimer des messages (une fois, pur). */
export function deleteRightText(bossName: string): string {
  return `Petit service : nomme-moi administrateur du groupe avec le seul droit « Supprimer des messages ». Si quelqu'un colle une clé ici par erreur, je l'efface aussitôt. — ${esc(bossName)}`;
}

/** Enregistre le groupe (journal + audit, l'ancien est oublié). */
export async function setBossGroup(
  deps: AgentsDeps,
  input: { chatId: bigint; title: string | null; byTelegramId: bigint | null; userId: string | null },
): Promise<void> {
  const previous = await readBossGroupId(deps);
  await writeSetting(deps, BOSS_GROUP_SETTING, input.chatId.toString());
  await writeSetting(deps, BOSS_GROUP_TITLE_SETTING, (input.title ?? "").slice(0, 120));
  await deps.prisma.setting.deleteMany({ where: { key: BOSS_GROUP_LEFT_SETTING } });
  if (previous !== input.chatId) await deps.prisma.setting.deleteMany({ where: { key: BOSS_GROUP_CAN_DELETE_SETTING } });
  await agentEvent(deps, "boss.group.registered", { chatId: input.chatId.toString(), previous: previous?.toString() ?? null });
  await agentAudit(deps, {
    userId: input.userId,
    action: "boss.groupe_equipe",
    entityType: "Setting",
    entityId: BOSS_GROUP_SETTING,
    metadata: { via: "TELEGRAM", chatId: input.chatId.toString(), previous: previous?.toString() ?? null, telegramActorId: input.byTelegramId?.toString() ?? null },
  });
}

/** Accueil à dire maintenant dans ce groupe (une seule fois par groupe), ou null. Marqué avant l'envoi. */
export async function claimGroupWelcome(deps: AgentsDeps, chatId: bigint, adminFirstName: string | null): Promise<string | null> {
  const done = await readSetting(deps, BOSS_GROUP_WELCOMED_SETTING);
  if (asChatId(done) === chatId) return null;
  await writeSetting(deps, BOSS_GROUP_WELCOMED_SETTING, chatId.toString());
  return groupWelcomeText(await readBossName(deps), adminFirstName);
}

/** Demande du droit de supprimer, une seule fois (et seulement si Kevin ne l'a pas déjà), ou null. */
export async function claimDeleteRightAsk(deps: AgentsDeps): Promise<string | null> {
  if ((await readSetting(deps, BOSS_GROUP_CAN_DELETE_SETTING)) === true) return null;
  if ((await readSetting(deps, BOSS_GROUP_DELETE_ASKED_SETTING)) !== undefined) return null;
  await writeSetting(deps, BOSS_GROUP_DELETE_ASKED_SETTING, nowOf(deps).toISOString());
  return deleteRightText(await readBossName(deps));
}

/** Droit de supprimer des messages dans le groupe enregistré (statut de Kevin vu par `my_chat_member`). */
export async function setGroupCanDelete(deps: AgentsDeps, can: boolean): Promise<void> {
  await writeSetting(deps, BOSS_GROUP_CAN_DELETE_SETTING, can);
}

export async function markGroupLeft(deps: AgentsDeps, chatId: bigint): Promise<void> {
  await writeSetting(deps, BOSS_GROUP_LEFT_SETTING, { chatId: chatId.toString(), at: nowOf(deps).toISOString() });
  await agentEvent(deps, "boss.group.left", { chatId: chatId.toString() });
}

/** Nom d'utilisateur du Boss (lien privé « t.me/<boss> »), ou null. */
export async function bossUsername(deps: Pick<AgentsDeps, "prisma">): Promise<string | null> {
  try {
    // Même règle que `adminBot()` (`packages/telegram/src/admin-bot.ts`) : Boss actif, en mode normal, jamais un bot
    // fantôme, le plus récent d'abord.
    const bots = (await deps.prisma.bot.findMany({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "desc" }, take: 10 })) as {
      username?: string;
      mode?: string | null;
    }[];
    const bot = bots.find((b) => (b.mode ?? "STANDARD") === "STANDARD" && !(b.username ?? "").startsWith("userbot_"));
    return bot?.username ?? null;
  } catch {
    return null;
  }
}

/** Lien vers la conversation privée avec Kevin (pur). */
export function privateLink(username: string | null): string {
  return username ? `t.me/${username}` : "en privé";
}
