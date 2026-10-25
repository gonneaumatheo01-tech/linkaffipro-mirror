import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BRAND_THEME_COLOR, BrandScreen } from "../brand-screen";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };
export const viewport: Viewport = { themeColor: BRAND_THEME_COLOR };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  if (session?.user) redirect("/");
  const sp = await searchParams;
  const callbackUrl = typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/";
  const inactive = sp.error === "inactive";
  const expired = sp.error === "expired";
  const reset = sp.reset === "1";
  // Phase 34 : lien de connexion envoyé par Kevin (`/k/<jeton>`) : e-mail pré-rempli, rien d'autre.
  const email = typeof sp.email === "string" && sp.email.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+$/.test(sp.email) ? sp.email : "";
  return (
    <BrandScreen>
      <div className="space-y-1 text-center">
        <h1 className="text-title text-night-foreground">LinkAffi Pro</h1>
        <p className="text-body text-night-muted">Accès réservé à l&apos;équipe.</p>
      </div>
      <LoginForm callbackUrl={callbackUrl} initialEmail={email} notice={reset ? "Mot de passe enregistré : connectez-vous avec votre nouveau mot de passe." : null} initialError={inactive ? "Votre compte est désactivé." : expired ? "Votre session a expiré (mot de passe ou droits modifiés) : reconnectez-vous." : null} />
    </BrandScreen>
  );
}
