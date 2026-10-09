import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { authConfig } from "./auth.config";

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
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) return null;
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) {
          await audit({ userId: user.id, action: "auth.login_failed", entityType: "User", entityId: user.id });
          return null;
        }
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await audit({ userId: user.id, action: "auth.login", entityType: "User", entityId: user.id });
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
});
