import Link from "next/link";
import { ChevronDown, LogOut, UserCircle } from "lucide-react";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@linkaffipro/core";
import type { CurrentUser } from "@/lib/session";
import { MobileNav } from "./mobile-nav";

export function Header({ user }: { user: CurrentUser }) {
  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-3">
        <MobileNav isAdmin={user.role === "ADMIN"} />
        <span className="text-sm text-muted-foreground md:hidden">LinkAffi Pro</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className="gap-2">
              <UserCircle className="size-4" />
              <span className="hidden sm:inline">{user.name}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">· {ROLE_LABELS[user.role]}</span>
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem render={<Link href="/account" />}>Mon compte</DropdownMenuItem>
          <DropdownMenuSeparator />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <DropdownMenuItem render={<button type="submit" className="w-full" />}>
              <LogOut className="size-4" />
              Déconnexion
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
