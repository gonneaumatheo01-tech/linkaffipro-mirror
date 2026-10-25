"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { loginAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Formulaire de connexion. L'e-mail est un champ contrôlé : React 19 vide le formulaire après l'action, et sans cela
 * l'adresse disparaissait après un mauvais mot de passe (à retaper sur téléphone). Après une erreur, le focus va au
 * mot de passe (le seul champ vidé, celui à retaper).
 */
export function LoginForm({ callbackUrl, initialError, notice = null, initialEmail = "" }: { callbackUrl: string; initialError: string | null; notice?: string | null; initialEmail?: string }) {
  const [state, action, pending] = useActionState(loginAction, { error: initialError });
  const [email, setEmail] = useState(initialEmail);
  const passwordRef = useRef<HTMLInputElement>(null);
  const initialState = useRef(state);
  useEffect(() => {
    // Seulement après un envoi refusé (pas pour l'erreur reçue par l'adresse au chargement) ; l'e-mail est alors
    // forcément rempli (champ obligatoire).
    if (state !== initialState.current && state?.error) passwordRef.current?.focus();
  }, [state]);
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input ref={passwordRef} id="password" name="password" type="password" autoComplete="current-password" required aria-describedby={state?.error ? "login-error" : undefined} />
          </div>
          {notice && !state?.error ? <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-body text-success">{notice}</p> : null}
          {state?.error ? <p id="login-error" role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-body text-danger">{state.error}</p> : null}
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Connexion…" : "Se connecter"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
