"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV } from "./sidebar";

export function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <Button variant="ghost" size="icon" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </Button>
      {open ? (
        <nav className="absolute left-0 top-14 z-50 w-full border-b bg-background p-3 shadow-md">
          {NAV.filter((i) => !i.adminOnly || isAdmin).map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-sm hover:bg-accent">
              {item.label}
              {item.soon ? <span className="ml-2 text-xs text-muted-foreground">(bientôt)</span> : null}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
