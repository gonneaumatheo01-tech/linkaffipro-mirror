/**
 * Phase 34, chantier F — reprise de la conversation après une autorisation Meta / TikTok ouverte par un lien de Kevin.
 * Au retour (route callback du site, crochet ajouté après la réussite), Kevin écrit dans la conversation d'origine
 * « Meta est connecté : 3 comptes publicitaires trouvés, lesquels je suis ? » avec un bouton par compte (`bsa:<id>:<n>`)
 * et « Tous » (`bsa:<id>:all`). Le choix appelle la fonction du site qui enregistre les comptes suivis (même fonction
 * que la page « Choisir les comptes », branchée par le site : `setBossAdAccountsPort`) ; `AuditLog` `via: TELEGRAM`.
 * Réservé à l'admin (les connecteurs sont des réglages ADMIN).
 */
import { randomBytes } from "node:crypto";
import { adminTelegramId, agentAudit, esc, nowOf, readSetting, writeSetting } from "../../admin/journal";
import { AUTH_LINK_TTL_MS } from "../../site/contract";
import type { AdminButton, AgentsDeps } from "../../types";
import { pick } from "../voice";
import { INPUTS_VARIANTS, OAUTH_ALL_BUTTON } from "./texts";

export const BOSS_INPUT_CALLBACK_PREFIX = "bsa:";
export const OAUTH_RESUME_SETTING_PREFIX = "boss.oauthresume.";
/** Au plus 10 boutons de comptes (au-delà : « Tous », ou la page du site). */
export const OAUTH_RESUME_MAX_BUTTONS = 10;

export type AdPlatform = "META" | "TIKTOK";
export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = { META: "Meta", TIKTOK: "TikTok" };

/**
 * Enregistrement des comptes choisis, branché par le site (même fonction que la page de choix : comptes en attente de
 * la connexion, `saveConnections`). `final` : plus rien à choisir après, la connexion en attente peut être effacée.
 */
export type BossAdAccountsPort = (req: {
  platform: AdPlatform;
  userId: string;
  externalIds: string[];
  final: boolean;
  telegramUserId: string;
}) => Promise<{ ok: true; connected: number } | { ok: false; error: string }>;

let port: BossAdAccountsPort | null = null;

export function setBossAdAccountsPort(next: BossAdAccountsPort | null): void {
  port = next;
}

export function bossAdAccountsPort(): BossAdAccountsPort | null {
  return port;
}

export type OAuthResume = {
  platform: AdPlatform;
  /** Utilisateur du site qui a fait l'autorisation (la connexion en attente est à son nom). */
  userId: string;
  chatId: string;
  accounts: Array<{ externalId: string; name: string }>;
  chosen: string[];
  createdAt: string;
  expiresAt: string;
};

type ResumeDeps = Pick<AgentsDeps, "prisma" | "now" | "logger" | "admin">;

const keyOf = (id: string) => `${OAUTH_RESUME_SETTING_PREFIX}${id}`;

export function isBossInputCallbackData(data: string): boolean {
  return data.startsWith(BOSS_INPUT_CALLBACK_PREFIX);
}

function shortName(name: string): string {
  const n = name.trim() || "Compte";
  return n.length > 40 ? `${n.slice(0, 39)}…` : n;
}

function buttonsOf(id: string, r: OAuthResume): AdminButton[][] {
  const rows: AdminButton[][] = r.accounts
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => !r.chosen.includes(a.externalId))
    .slice(0, OAUTH_RESUME_MAX_BUTTONS)
    .map(({ a, i }) => [{ text: shortName(a.name), callbackData: `${BOSS_INPUT_CALLBACK_PREFIX}${id}:${i}` }]);
  if (r.accounts.length - r.chosen.length > 1) rows.push([{ text: OAUTH_ALL_BUTTON, callbackData: `${BOSS_INPUT_CALLBACK_PREFIX}${id}:all` }]);
  return rows;
}

/** Envoi dans la conversation d'origine : privé de l'admin (son messager) ou autre conversation du même bot. */
async function sendIn(deps: ResumeDeps, chatId: string, html: string, buttons: AdminButton[][]): Promise<boolean> {
  try {
    const admin = await adminTelegramId(deps);
    const sent = admin && admin.toString() === chatId ? await deps.admin?.send(html, { buttons }) : await deps.admin?.sendTo?.(BigInt(chatId), html, { buttons });
    return !!sent;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] reprise après connexion non envoyée");
    return false;
  }
}

/**
 * Crochet du retour d'autorisation : garde les comptes trouvés (15 min, comme la connexion en attente du site) et
 * écrit dans la conversation d'origine. Ne lève jamais.
 */
export async function startOAuthResume(
  deps: ResumeDeps,
  input: { platform: AdPlatform; userId: string; chatId: string; accounts: Array<{ externalId: string; name: string }> },
): Promise<{ sent: boolean; id: string | null }> {
  try {
    if (!input.accounts.length || !/^-?\d+$/.test(input.chatId)) return { sent: false, id: null };
    const now = nowOf(deps);
    const id = randomBytes(6).toString("base64url");
    const r: OAuthResume = {
      platform: input.platform,
      userId: input.userId,
      chatId: input.chatId,
      accounts: input.accounts.map((a) => ({ externalId: String(a.externalId), name: String(a.name ?? "") })),
      chosen: [],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + AUTH_LINK_TTL_MS).toISOString(),
    };
    await writeSetting(deps, keyOf(id), r);
    const text = pick(INPUTS_VARIANTS.oauthConnected({ platform: AD_PLATFORM_LABELS[r.platform], count: r.accounts.length }), "inputs.oauth.connected", r.chatId);
    return { sent: await sendIn(deps, r.chatId, text, buttonsOf(id, r)), id };
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] reprise après connexion");
    return { sent: false, id: null };
  }
}

export type BossInputCallbackResult = { toast?: string; reply?: string; removeButtons?: boolean; buttons?: AdminButton[][] };

/** Bouton `bsa:<id>:<n|all>` appuyé. Admin seulement ; mêmes fonctions que la page de choix du site. */
export async function handleBossInputCallback(deps: ResumeDeps, input: { data: string; fromTelegramId: bigint }): Promise<BossInputCallbackResult> {
  const m = /^bsa:([A-Za-z0-9_-]{4,20}):(all|\d{1,2})$/.exec(input.data);
  const chatKey = input.fromTelegramId.toString();
  if (!m) return { toast: pick(INPUTS_VARIANTS.oauthExpired, "inputs.oauth.expired", chatKey), removeButtons: true };
  const [, id, which] = m as unknown as [string, string, string];
  const admin = await adminTelegramId(deps);
  if (!admin || admin !== input.fromTelegramId) return { toast: pick(INPUTS_VARIANTS.oauthNotYours, "inputs.oauth.notYours", chatKey) };
  const r = (await readSetting(deps, keyOf(id))) as OAuthResume | undefined;
  const now = nowOf(deps);
  if (!r || typeof r !== "object" || new Date(r.expiresAt).getTime() <= now.getTime()) {
    if (r) await deps.prisma.setting.deleteMany({ where: { key: keyOf(id) } });
    return { reply: pick(INPUTS_VARIANTS.oauthExpired, "inputs.oauth.expired", r?.chatId ?? chatKey), removeButtons: true };
  }
  const remaining = r.accounts.filter((a) => !r.chosen.includes(a.externalId));
  const picked = which === "all" ? remaining : remaining.filter((a) => a.externalId === r.accounts[Number(which)]?.externalId);
  if (!picked.length) return { toast: pick(INPUTS_VARIANTS.oauthExpired, "inputs.oauth.expired", r.chatId) };
  const save = bossAdAccountsPort();
  const left = remaining.length - picked.length;
  const out = save
    ? await save({ platform: r.platform, userId: r.userId, externalIds: picked.map((a) => a.externalId), final: left === 0, telegramUserId: chatKey }).catch(
        (err: Error) => ({ ok: false as const, error: err.message }),
      )
    : ({ ok: false, error: "port absent" } as const);
  if (!out.ok) {
    deps.logger?.warn({ err: out.error }, "[boss] comptes publicitaires non enregistrés");
    return { reply: pick(INPUTS_VARIANTS.oauthFailed, "inputs.oauth.failed", r.chatId) };
  }
  const next: OAuthResume = { ...r, chosen: [...r.chosen, ...picked.map((a) => a.externalId)] };
  if (left === 0) await deps.prisma.setting.deleteMany({ where: { key: keyOf(id) } });
  else await writeSetting(deps, keyOf(id), next);
  await agentAudit(deps as AgentsDeps, {
    userId: r.userId,
    action: "boss.connecteurs.comptes_suivis",
    entityType: "ConnectorApp",
    entityId: r.platform,
    metadata: { via: "TELEGRAM", telegramActorId: chatKey, platform: r.platform, externalIds: picked.map((a) => a.externalId) },
  });
  const reply =
    which === "all" && picked.length > 1
      ? pick(INPUTS_VARIANTS.oauthAll({ count: picked.length }), "inputs.oauth.all", r.chatId)
      : pick(INPUTS_VARIANTS.oauthChosen({ name: esc(shortName(picked[0]!.name)), left }), "inputs.oauth.chosen", r.chatId);
  return { reply, removeButtons: true, ...(left > 0 ? { buttons: buttonsOf(id, next) } : {}) };
}
