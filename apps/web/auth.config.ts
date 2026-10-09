import type { NextAuthConfig } from "next-auth";

/**
 * Configuration Auth.js sans accès base (utilisable dans le proxy).
 * Le fournisseur « credentials » avec Prisma et la vérification de la version de session sont ajoutés dans auth.ts.
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
        token.sv = user.sessionVersion ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as "ADMIN" | "MANAGER";
      session.user.sessionVersion = (token.sv as number | undefined) ?? 0;
      return session;
    },
  },
} satisfies NextAuthConfig;
