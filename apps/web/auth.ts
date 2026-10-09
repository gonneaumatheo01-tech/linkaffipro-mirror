import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { authConfig } from "./auth.config";
import { loginClearFailures, loginIsThrottled, loginRecordFailure, loginThrottleKeys } from "./lib/security/login-throttle";

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/**
 * Version de session : le jeton porte `sv` (version à la connexion). En base, `User.sessionVersion` est
 * incrémenté au changement de mot de passe, de rôle ou à la désactivation : tout jeton plus ancien est refusé,
 * ce qui déconnecte tous les appareils. La base est consultée au plus une fois par 5 minutes et par utilisateur
 * (cache mémoire du processus) ; `requireUser` (lib/session.ts) fait en plus la comparaison immédiate à chaque page.
 */
const SESSION_VERSION_TTL_MS = 5 * 60_000;
const sessionVersionCache = new Map<string, { sv: number; active: boolean; at: number }>();

/** Oublie la valeur en cache (à appeler après avoir incrémenté la version en base). */
export function forgetSessionVersion(userId: string): void {
  sessionVersionCache.delete(userId);
}

async function currentSessionVersion(userId: string, fresh = false): Promise<{ sv: number; active: boolean } | null> {
  const hit = sessionVersionCache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < SESSION_VERSION_TTL_MS) return hit;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true, isActive: true } });
  if (!u) {
    sessionVersionCache.delete(userId);
    return null;
  }
  const entry = { sv: u.sessionVersion, active: u.isActive, at: Date.now() };
  sessionVersionCache.set(userId, entry);
  return entry;
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = authConfig.callbacks.jwt(params);
      const userId = typeof token.id === "string" ? token.id : null;
      if (params.user || !userId) return token;
      // `unstable_update()` depuis une action serveur : on relit la version en base (jamais la valeur fournie).
      const current = await currentSessionVersion(userId, params.trigger === "update");
      if (!current || !current.active) return null;
      if (params.trigger === "update") token.sv = current.sv;
      if (((token.sv as number | undefined) ?? 0) !== current.sv) return null;
      return token;
    },
  },
  providers: [
    Credentials({
      name: "E-mail et mot de passe",
      credentials: { email: { label: "E-mail", type: "email" }, password: { label: "Mot de passe", type: "password" } },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.trim().toLowerCase();
        const keys = await loginThrottleKeys(email);
        const user = await prisma.user.findUnique({ where: { email } });
        // Au-delà de 10 échecs en 15 minutes (par e-mail ou par IP) : refus sans même vérifier le mot de passe.
        if (await loginIsThrottled(keys, user?.id)) return null;
        if (!user || !user.isActive) {
          await loginRecordFailure(keys);
          return null;
        }
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) {
          await loginRecordFailure(keys);
          await audit({ userId: user.id, action: "auth.login_failed", entityType: "User", entityId: user.id });
          return null;
        }
        await loginClearFailures(keys);
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await audit({ userId: user.id, action: "auth.login", entityType: "User", entityId: user.id });
        return { id: user.id, email: user.email, name: user.name, role: user.role, sessionVersion: user.sessionVersion };
      },
    }),
  ],
});
