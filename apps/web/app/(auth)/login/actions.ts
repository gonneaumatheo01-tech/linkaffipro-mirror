"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type LoginState = { error: string | null };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const rawCallback = String(formData.get("callbackUrl") ?? "/");
  const callbackUrl = rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/";
  try {
    await signIn("credentials", { email, password, redirectTo: callbackUrl });
    return { error: null };
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: err.type === "CredentialsSignin" ? "E-mail ou mot de passe incorrect." : "Connexion impossible pour le moment." };
    }
    // Auth.js redirige en levant une exception interne : il faut la laisser passer.
    throw err;
  }
}
