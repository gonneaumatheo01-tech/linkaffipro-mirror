"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Formulaire d'acceptation : `mode="create"` (nouveau compte) ou `mode="reset"` (nouveau mot de passe). */
export function AcceptInviteForm({
  token,
  email,
  mode,
}: {
  token: string;
  email: string;
  mode: "create" | "reset";
}) {
  const [state, action, pending] = useActionState(acceptInviteAction, { error: null });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" value={email} readOnly />
      </div>
      {mode === "create" ? (
        <div className="space-y-2">
          <Label htmlFor="name">Prénom affiché</Label>
          <Input id="name" name="name" required minLength={2} maxLength={60} />
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="password">
          {mode === "reset" ? "Nouveau mot de passe" : "Mot de passe"} (10 caractères minimum)
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirmer le mot de passe</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
      </div>
      {state?.error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-body text-danger">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending
          ? "Enregistrement…"
          : mode === "reset"
            ? "Enregistrer mon nouveau mot de passe"
            : "Créer mon compte"}
      </Button>
    </form>
  );
}
