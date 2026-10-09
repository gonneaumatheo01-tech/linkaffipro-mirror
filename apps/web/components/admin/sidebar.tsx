"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Link2, MessageSquare, Radio, ScrollText, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; adminOnly?: boolean; soon?: boolean };

const ICONS = { BarChart3, Bot, Link2, MessageSquare, Radio, ScrollText, Settings, Users };

export const NAV: NavItem[] = [
  { href: "/", label: "Tableau de bord", icon: "BarChart3" },
  { href: "/channels", label: "Canaux", icon: "Radio" },
  { href: "/bots", label: "Bots", icon: "Bot" },
  { href: "/members", label: "Membres", icon: "Users" },
  { href: "/messages", label: "Messages", icon: "MessageSquare" },
  { href: "/links", label: "Liens", icon: "Link2" },
  { href: "/journal", label: "Journal", icon: "ScrollText" },
  { href: "/settings", label: "Réglages", icon: "Settings", adminOnly: true },
];

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-5 font-semibold tracking-tight">LinkAffi Pro</div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV.filter((i) => !i.adminOnly || isAdmin).map((item) => {
          const Icon = ICONS[item.icon];
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4" />
              <span className="flex-1">{item.label}</span>
              {item.soon ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">bientôt</span> : null}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-4 text-xs text-muted-foreground">Heure affichée : Europe/Paris</div>
    </aside>
  );
}
