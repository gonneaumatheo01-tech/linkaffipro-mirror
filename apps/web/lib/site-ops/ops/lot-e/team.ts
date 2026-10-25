/**
 * Phase 34, lot E — cœurs de Réglages → Équipe (invitations, rôles, activation, réinitialisation du mot de passe).
 * Appelés par `app/(admin)/settings/team/actions.ts` et par Kevin. Administrateurs seulement (utilisateurs).
 * « Ajoute Léa à l'équipe comme responsable » = invitation : le cœur crée l'invitation comme le site et rend le lien
 * (`data.inviteUrl`, jamais dans le message ni le journal) ; Kevin l'envoie en privé. Aucun e-mail n'est envoyé.
 * Après un changement de version de session, la valeur en mémoire est oubliée (`forgetSessionVersion` de `@/auth`,
 * chargé à la demande pour que le module reste léger), comme avant pour le site et désormais aussi pour Kevin.
 */
import { z } from "zod";
import { isRole, randomToken, type Role } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import { env } from "@/lib/env";
import { adminOnly, fail, needUser, ok, optBool, preview, resolveNamed, str, viaMeta, type CoreRun, type Fail } from "./common";

export const INVITE_DAYS = 7;
export const RESET_HOURS = 48;

export const ROLE_LABELS: Record<Role, string> = { ADMIN: "administrateur", MANAGER: "responsable" };

/** Rôle venu du site (`ADMIN` / `MANAGER`) ou d'une phrase (« responsable », « admin »). */
export function roleOf(raw: unknown): string {
  const s = str(raw).trim();
  const lower = s.toLowerCase();
  if (["admin", "administrateur", "administratrice"].includes(lower)) return "ADMIN";
  if (["manager", "responsable", "gestionnaire"].includes(lower)) return "MANAGER";
  return s;
}

export function inviteUrlOf(token: string): string {
  return `${env.appBaseUrl}/invite/${token}`;
}

/** Nombre d'administrateurs actifs autres que `excludeId` : on ne retire jamais le dernier. */
async function forgetSession(userId: string): Promise<void> {
  const { forgetSessionVersion } = await import("@/auth");
  forgetSessionVersion(userId);
}

async function otherActiveAdmins(excludeId: string): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: excludeId } } });
}

/** Utilisateur désigné par son identifiant (site), sinon par son e-mail ou son nom (Kevin). */
async function findUserId(input: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; result: Fail }> {
  const id = str(input.userId).trim();
  if (id) return { ok: true, id };
  const raw = str(input.user ?? input.email).trim();
  if (!raw) return { ok: false, result: fail("Pour qui ? Donnez le nom ou l'adresse e-mail de la personne.", "invalid", "userId") };
  const rows = await prisma.user.findMany({ select: { id: true, name: true, email: true } });
  const byEmail = rows.find((r) => r.email.toLowerCase() === raw.toLowerCase());
  if (byEmail) return { ok: true, id: byEmail.id };
  const ref = await resolveNamed({ plural: "personnes", one: "la personne" }, raw, rows.map((r) => ({ id: r.id, name: r.name, extra: [r.email] })));
  return ref.ok ? { ok: true, id: ref.id } : ref;
}

/** Créer une invitation (ADMIN). Le lien revient dans `data.inviteUrl` : aucun e-mail n'est envoyé. */
export const teamInvite: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const email = z
    .string()
    .email()
    .safeParse(str(input.email).trim().toLowerCase());
  const role = input.role === undefined || input.role === null || input.role === "" ? "MANAGER" : roleOf(input.role);
  if (!email.success) return fail("L'adresse e-mail n'est pas valide.", "invalid", "email");
  if (!isRole(role)) return fail("Choisissez un rôle dans la liste.", "invalid", "role");
  const existing = await prisma.user.findUnique({ where: { email: email.data } });
  if (existing)
    return fail(
      "Un compte existe déjà avec cette adresse. Pour lui donner un nouveau mot de passe, utilisez « Réinitialiser le mot de passe » sur sa ligne.",
      "conflict",
      "email",
    );
  if (opts.dryRun)
    return preview({ summary: `Invitation de ${email.data} comme ${ROLE_LABELS[role]} (lien valable ${INVITE_DAYS} jours, envoyé en privé).` });
  const token = randomToken(24);
  const inv = await prisma.invitation.create({
    data: {
      email: email.data,
      role,
      token,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000),
      invitedById: actor.userId!,
    },
  });
  await audit({
    userId: actor.userId,
    action: "invitation.created",
    entityType: "Invitation",
    entityId: inv.id,
    metadata: { email: email.data, role, ...viaMeta(actor) },
  });
  return ok(`Invitation créée pour ${email.data}. Copiez le lien ci-dessous et envoyez-le.`, {
    invitationId: inv.id,
    inviteUrl: inviteUrlOf(token),
    expiresAt: inv.expiresAt.toISOString(),
    role,
  });
};

/** Annuler une invitation (révocation). Kevin peut la désigner par l'e-mail invité. */
export const teamRevokeInvitation: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  let id = str(input.invitationId).trim();
  if (!id && input.email) {
    const inv = await prisma.invitation.findFirst({
      where: { email: str(input.email).trim().toLowerCase(), acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!inv) return fail(`Aucune invitation en attente pour ${str(input.email).trim()}.`, "not_found", "email");
    id = inv.id;
  }
  if (!id) return fail("Invitation introuvable.", "not_found", "invitationId");
  if (opts.dryRun) {
    const inv = await prisma.invitation.findUnique({ where: { id }, select: { email: true } });
    if (!inv) return fail("Invitation introuvable.", "not_found");
    return preview({ summary: `Annulation de l'invitation de ${inv.email}.`, impact: "Le lien d'invitation ne fonctionnera plus." });
  }
  const inv = await prisma.invitation.update({ where: { id }, data: { expiresAt: new Date() } });
  await audit({
    userId: actor.userId,
    action: "invitation.revoked",
    entityType: "Invitation",
    entityId: id,
    metadata: { email: inv.email, ...viaMeta(actor) },
  });
  return ok("Invitation annulée.", { invitationId: id });
};

/**
 * Activer / désactiver un compte. Le site bascule l'état ; Kevin peut dire l'état voulu (`active`), et rien ne change
 * s'il est déjà ainsi. Désactivation : la version de session change pour déconnecter la personne de tous ses appareils.
 */
export const teamToggleUser: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findUserId(input);
  if (!found.ok) return found.result;
  const id = found.id;
  const wanted = optBool(input.active);
  if (id === actor.userId && wanted !== true) return fail("Vous ne pouvez pas désactiver votre propre compte.", "forbidden");
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return fail("Compte introuvable.", "not_found");
  const activate = wanted ?? !user.isActive;
  if (wanted !== undefined && wanted === user.isActive)
    return ok(`${user.name} est déjà ${user.isActive ? "actif" : "désactivé"}.`, { userId: id, unchanged: true });
  if (user.isActive && user.role === "ADMIN" && (await otherActiveAdmins(id)) === 0)
    return fail("Impossible : ce compte est le dernier administrateur actif.", "conflict");
  if (opts.dryRun)
    return preview({
      summary: activate ? `Réactivation du compte de ${user.name} (${user.email}).` : `Désactivation du compte de ${user.name} (${user.email}).`,
      impact: activate ? null : "La personne est déconnectée de tous ses appareils et ne peut plus se connecter.",
    });
  await prisma.user.update({
    where: { id },
    data: { isActive: !user.isActive, ...(user.isActive ? { sessionVersion: { increment: 1 } } : {}) },
  });
  await forgetSession(id);
  await audit({
    userId: actor.userId,
    action: user.isActive ? "user.deactivated" : "user.activated",
    entityType: "User",
    entityId: id,
    metadata: { email: user.email, ...viaMeta(actor) },
  });
  return ok(
    `${user.name} ${user.isActive ? "désactivé : cette personne est déconnectée de tous ses appareils" : "activé : cette personne peut de nouveau se connecter"}.`,
    { userId: id },
  );
};

/** Changer le rôle d'un compte (nouvelle version de session : reconnexion avec le bon rôle). */
export const teamSetRole: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findUserId(input);
  if (!found.ok) return found.result;
  const id = found.id;
  const role = roleOf(input.role);
  if (!isRole(role)) return fail("Choisissez un rôle dans la liste.", "invalid", "role");
  if (id === actor.userId && role !== "ADMIN") return fail("Vous ne pouvez pas retirer votre propre rôle d'administrateur.", "forbidden");
  const before = await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true, email: true, name: true } });
  if (!before) return fail("Compte introuvable.", "not_found");
  if (before.role === role) return ok("Rôle inchangé.", { userId: id, unchanged: true });
  if (before.role === "ADMIN" && before.isActive && (await otherActiveAdmins(id)) === 0)
    return fail("Impossible : ce compte est le dernier administrateur actif.", "conflict");
  if (opts.dryRun)
    return preview({ summary: `${before.name} (${before.email}) passe ${ROLE_LABELS[role]} ; la personne devra se reconnecter.` });
  await prisma.user.update({ where: { id }, data: { role, sessionVersion: { increment: 1 } } });
  await forgetSession(id);
  await audit({
    userId: actor.userId,
    action: "user.role_changed",
    entityType: "User",
    entityId: id,
    metadata: { role, from: before.role, email: before.email, ...viaMeta(actor) },
  });
  return ok("Rôle mis à jour : la personne devra se reconnecter.", { userId: id });
};

/**
 * Réinitialisation du mot de passe (ADMIN) : crée une invitation liée à l'e-mail du compte existant (lien 48 h dans
 * `data.inviteUrl`) ; les invitations précédentes du même e-mail sont annulées.
 */
export const teamResetPassword: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const found = await findUserId(input);
  if (!found.ok) return found.result;
  const id = found.id;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return fail("Compte introuvable.", "not_found");
  if (opts.dryRun)
    return preview({
      summary: `Lien de réinitialisation du mot de passe pour ${user.name} (valable ${RESET_HOURS} h, envoyé en privé).`,
      impact: "Quand la personne l'utilise, son mot de passe est remplacé et toutes ses sessions sont fermées.",
    });
  const token = randomToken(24);
  const [, inv] = await prisma.$transaction([
    prisma.invitation.updateMany({
      where: { email: user.email, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    }),
    prisma.invitation.create({
      data: {
        email: user.email,
        role: user.role,
        token,
        expiresAt: new Date(Date.now() + RESET_HOURS * 3600 * 1000),
        invitedById: actor.userId!,
      },
    }),
  ]);
  await audit({
    userId: actor.userId,
    action: "user.password_reset_requested",
    entityType: "User",
    entityId: id,
    metadata: { invitationId: inv.id, email: user.email, ...viaMeta(actor) },
  });
  return ok(
    `Lien de réinitialisation créé pour ${user.name} (valable ${RESET_HOURS} h). Copiez-le dans « Invitations en attente » et envoyez-le-lui.`,
    { userId: id, invitationId: inv.id, inviteUrl: inviteUrlOf(token), expiresAt: inv.expiresAt.toISOString() },
  );
};

/** Lecture : l'équipe et les invitations en attente (jamais les liens). */
export const teamList: CoreRun = async (_input, actor) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const [users, invitations] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, isActive: true, telegramUserId: true },
    }),
    prisma.invitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
  ]);
  const active = users.filter((u) => u.isActive).length;
  return ok(`${active} compte${active > 1 ? "s" : ""} actif${active > 1 ? "s" : ""}, ${invitations.length} invitation${invitations.length > 1 ? "s" : ""} en attente.`, {
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      telegramLinked: u.telegramUserId != null,
    })),
    invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() })),
  });
};
