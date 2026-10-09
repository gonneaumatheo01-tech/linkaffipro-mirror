import type { Role } from "@linkaffipro/core";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    /** `sessionVersion` : version de session portée par le jeton (voir `User.sessionVersion` et auth.ts). */
    user: { id: string; role: Role; sessionVersion: number } & DefaultSession["user"];
  }
  interface User {
    role: Role;
    /** Version de session en base au moment de la connexion. */
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    /** Version de session (`sv`) ; comparée à `User.sessionVersion` en base. */
    sv?: number;
  }
}
