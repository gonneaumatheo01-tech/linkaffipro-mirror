import Link from "next/link";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@linkaffipro/core";
import type { CurrentUser } from "@/lib/session";
import { GlobalSearch } from "./global-search";
import { HelpPanel } from "./help-panel";
import { BrandLogo } from "./brand-logo";
import { initials } from "./nav-logic";

/**
 * En-tête de toutes les pages : fond blanc, bordure basse fine.
 * - téléphone : logo et nom à gauche (la navigation est dans la barre du bas, `BottomNav`) ;
 * - à droite : recherche globale (⌘K), bouton « ? » (aide de la page courante, `HelpPanel`), menu utilisateur
 *   (Mon compte, Déconnexion).
 * Les marges suivent les zones sûres iOS (encoche d'un iPhone en paysage, `viewportFit: "cover"`) et celles du
 * contenu (`<main>` du layout : 16 px, 24 px dès 768 px, 32 px dès 1024 px) : la recherche commence à l'aplomb du
 * titre de la page et le menu du compte finit à l'aplomb des boutons de l'en-tête de page.
 */
export function Header({ user }: { user: CurrentUser }) {
  const role = ROLE_LABELS[user.role];
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] md:pl-6 lg:pr-[max(2rem,env(safe-area-inset-right))] lg:pl-8">
      <Link
        href="/"
        className="-ml-1 flex min-h-10 items-center gap-2 rounded-lg px-1 md:hidden"
        aria-label="LinkAffi Pro, accueil"
      >
        <BrandLogo size={28} />
        <span className="text-body font-semibold tracking-tight text-foreground">LinkAffi Pro</span>
      </Link>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:justify-between">
        <GlobalSearch />
        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          {/* Aide de la page courante (sections du guide) ; repère de la visite guidée : data-tour="help". */}
          <span data-tour="help" className="inline-flex rounded-full">
            <HelpPanel className="max-md:size-10" />
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="h-10 gap-2 rounded-full px-1 md:h-9 md:rounded-lg md:pr-2 md:pl-1"
                  aria-label={`Mon compte : ${user.name}, ${role}`}
                >
                  <span
                    aria-hidden
                    className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-note font-semibold text-brand-ink md:size-7"
                  >
                    {initials(user.name)}
                  </span>
                  <span className="hidden max-w-40 truncate text-body lg:inline">{user.name}</span>
                  <span className="hidden text-note font-normal text-muted-foreground xl:inline">
                    {role}
                  </span>
                  <ChevronDown aria-hidden className="hidden size-3.5 opacity-60 md:inline" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-60">
              <div className="px-2 pt-1.5 pb-2">
                <p className="truncate text-body font-medium text-foreground">{user.name}</p>
                <p className="truncate text-note text-muted-foreground">{user.email}</p>
                <p className="mt-1 text-note text-muted-foreground">{role}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/account" />}>
                <UserRound aria-hidden />
                Mon compte
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <DropdownMenuItem render={<button type="submit" className="w-full" />}>
                  <LogOut aria-hidden />
                  Déconnexion
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
