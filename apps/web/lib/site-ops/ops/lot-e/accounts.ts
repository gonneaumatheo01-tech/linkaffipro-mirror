/**
 * Phase 34, lot E — cœurs des vrais comptes Telegram (Réglages → Comptes, phase 18 / 27 : `@linkaffipro/userbot`).
 * Appelés par `app/(admin)/settings/accounts/actions.ts` et par Kevin. Administrateurs seulement.
 * L'étape « code reçu » (`submitCodeAction`) reste sur le site : Telegram annule un code de connexion recopié dans une
 * conversation Telegram (exclusion documentée, Kevin envoie le lien direct de la page).
 */
import { prisma, audit } from "@linkaffipro/db";
import { normalizePhone } from "@linkaffipro/mtproto";
import { disconnect, ensureShadowBot, refresh, setActive, setPersona, startOnboarding, submitPassword } from "@linkaffipro/userbot";
import { ACCOUNT_PERSONA_REFUSED, isAccountPersonaAllowed } from "@/lib/accounts/persona-choice";
import { adminOnly, fail, ok, optBool, preview, resolveNamed, str, viaMeta, type CoreRun, type Fail } from "./common";

function describe(err: unknown): string {
  return err instanceof Error ? err.message : "Erreur inconnue.";
}

/** Compte désigné par son identifiant (site) ou par son nom, son numéro ou son @ (Kevin). */
async function findAccount(input: Record<string, unknown>): Promise<{ ok: true; id: string; name: string } | { ok: false; result: Fail }> {
  const id = str(input.accountId).trim();
  const raw = str(input.account).trim();
  // Aucun compte désigné (Kevin) : jamais un essai à blanc qui passe sans compte.
  if (!id && !raw) return { ok: false, result: fail("Quel compte Telegram ? Donne son nom ou son numéro.", "invalid", "account") };
  if (id) return { ok: true, id, name: id };
  const rows = await prisma.telegramUserAccount.findMany({ select: { id: true, label: true, phone: true, telegramUsername: true } });
  const ref = await resolveNamed(
    { plural: "comptes Telegram", one: "le compte Telegram" },
    raw,
    rows.map((r) => ({ id: r.id, name: r.label, extra: [r.phone, ...(r.telegramUsername ? [r.telegramUsername, `@${r.telegramUsername}`] : [])] })),
  );
  return ref;
}

/** Étape 1 : numéro → code envoyé, compte en PENDING_CODE. */
export const accountAdd: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const phone = str(input.phone);
  const label = str(input.label).trim();
  if (opts.dryRun) {
    const normalized = normalizePhone(phone);
    if (!normalized) return fail("Envoi du code impossible : Numero invalide : forme attendue +33612345678.", "invalid", "phone");
    return preview({ summary: `J'envoie un code de connexion au ${normalized}${label ? ` (compte « ${label} »)` : ""}.` });
  }
  let id = "";
  try {
    const account = await startOnboarding(phone);
    id = account.id;
    if (label) await prisma.telegramUserAccount.update({ where: { id }, data: { label } });
  } catch (err) {
    return fail(`Envoi du code impossible : ${describe(err)}`, "unavailable");
  }
  await audit({
    userId: actor.userId,
    action: "userbot.account_code_sent",
    entityType: "TelegramUserAccount",
    entityId: id,
    metadata: viaMeta(actor),
  });
  return ok("Code envoye sur Telegram. Saisissez-le pour terminer la connexion.", { accountId: id });
};

/** Étape 3 : mot de passe de validation en deux étapes. */
export const accountSubmitPassword: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findAccount(input);
  if (!found.ok) return found.result;
  const id = found.id;
  const password = str(input.password);
  if (opts.dryRun) {
    const acc = await prisma.telegramUserAccount.findUnique({ where: { id }, select: { label: true, status: true } });
    if (!acc) return fail("Compte Telegram introuvable.", "not_found");
    if (!password) return fail("Entrez le mot de passe de validation en deux étapes.", "invalid", "password");
    return preview({ summary: `Je termine la connexion du compte « ${acc.label} » avec son mot de passe de validation en deux étapes.` });
  }
  try {
    await submitPassword(id, password);
  } catch (err) {
    return fail(describe(err));
  }
  await ensureShadowBot(id).catch(() => undefined);
  await audit({
    userId: actor.userId,
    action: "userbot.account_connected",
    entityType: "TelegramUserAccount",
    entityId: id,
    metadata: viaMeta(actor),
  });
  return ok("Compte connecte.", { accountId: id });
};

/** Active ou désactive le compte (désactivé : le userbot ne le démarre pas). */
export const accountToggle: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findAccount(input);
  if (!found.ok) return found.result;
  const active = optBool(input.active) ?? false;
  if (opts.dryRun) return preview({ summary: `${active ? "Activation" : "Désactivation"} du compte Telegram « ${found.name} ».` });
  await setActive(found.id, active);
  await audit({
    userId: actor.userId,
    action: active ? "userbot.account_activated" : "userbot.account_deactivated",
    entityType: "TelegramUserAccount",
    entityId: found.id,
    metadata: viaMeta(actor),
  });
  return ok("Mis a jour. Redemarrez le userbot pour appliquer.", { accountId: found.id });
};

/** Persona d'un compte : Rencontres ou Paris sportifs (refus côté serveur, quelle que soit la liste affichée). */
export const accountSetPersona: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findAccount(input);
  if (!found.ok) return found.result;
  let personaId = str(input.personaId) || null;
  const personaName = str(input.persona).trim();
  if (!personaId && personaName && !["aucune", "aucun", "none"].includes(personaName.toLowerCase())) {
    const rows = await prisma.persona.findMany({ select: { id: true, name: true } });
    const ref = await resolveNamed({ plural: "personas", one: "la persona" }, personaName, rows);
    if (!ref.ok) return ref.result;
    personaId = ref.id;
  }
  if (personaId) {
    const persona = await prisma.persona.findUnique({ where: { id: personaId }, select: { universe: true } });
    if (!persona) return fail("Persona introuvable : rechargez la page.", "not_found");
    if (!isAccountPersonaAllowed(persona)) return fail(ACCOUNT_PERSONA_REFUSED);
  }
  if (opts.dryRun) return preview({ summary: personaId ? `Je rattache la persona au compte « ${found.name} ».` : `Je retire la persona du compte « ${found.name} ».` });
  await setPersona(found.id, personaId);
  await audit({
    userId: actor.userId,
    action: "userbot.account_persona_changed",
    entityType: "TelegramUserAccount",
    entityId: found.id,
    metadata: { personaId, ...viaMeta(actor) },
  });
  return ok("Persona mise a jour.", { accountId: found.id, personaId });
};

/** Relecture de la session : confirme qu'elle est encore valable. */
export const accountRefresh: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findAccount(input);
  if (!found.ok) return found.result;
  if (opts.dryRun) return preview({ summary: `Je vérifie la session du compte Telegram « ${found.name} ».` });
  const account = await refresh(found.id);
  await audit({
    userId: actor.userId,
    action: "userbot.account_refreshed",
    entityType: "TelegramUserAccount",
    entityId: found.id,
    metadata: { status: account.status, ...viaMeta(actor) },
  });
  return account.status === "ACTIVE" ? ok("Session valide.") : fail(account.lastError ?? "Session invalide.", "unavailable");
};

/** Révoque la session côté Telegram : le compte ne sert plus. */
export const accountDisconnect: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findAccount(input);
  if (!found.ok) return found.result;
  if (opts.dryRun)
    return preview({
      summary: `Déconnexion du compte Telegram « ${found.name} ».`,
      impact: "La session est révoquée côté Telegram et le compte est désactivé.",
    });
  await disconnect(found.id).catch(() => undefined);
  await audit({
    userId: actor.userId,
    action: "userbot.account_disconnected",
    entityType: "TelegramUserAccount",
    entityId: found.id,
    metadata: viaMeta(actor),
  });
  return ok("Compte deconnecte.", { accountId: found.id });
};
