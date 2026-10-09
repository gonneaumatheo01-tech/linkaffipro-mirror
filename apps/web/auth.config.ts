import type { NextAuthConfig } from "next-auth";

/**
 * Configuration Auth.js sans accès base (utilisable dans le proxy).
 * Le fournisseur « credentials » avec Prisma est ajouté dans auth.ts.
 */
export const authConfig = {
  providers: [],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as "ADMIN" | "MANAGER";
      return session;
    },
  },
} satisfies NextAuthConfig;
