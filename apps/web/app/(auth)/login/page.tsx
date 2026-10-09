import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  if (session?.user) redirect("/");
  const sp = await searchParams;
  const callbackUrl = typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/";
  const inactive = sp.error === "inactive";
  const expired = sp.error === "expired";
  const reset = sp.reset === "1";
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">LinkAffi Pro</h1>
          <p className="text-sm text-muted-foreground">Accès réservé à l&apos;équipe.</p>
        </div>
        <LoginForm callbackUrl={callbackUrl} notice={reset ? "Mot de passe enregistré : connectez-vous avec votre nouveau mot de passe." : null} initialError={inactive ? "Votre compte est désactivé." : expired ? "Votre session a expiré (mot de passe ou droits modifiés) : reconnectez-vous." : null} />
      </div>
    </main>
  );
}
