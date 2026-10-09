import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { authConfig } from "./auth.config";
import { loginClearFailures, loginIsThrottled, loginRecordFailure, loginThrottleKeys } from "./lib/security/login-throttle";

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
});
