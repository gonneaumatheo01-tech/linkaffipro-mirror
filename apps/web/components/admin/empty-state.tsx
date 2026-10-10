import Link from "next/link";
import { Inbox } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

/**
 * État vide d'une liste : icône dans un rond orange pâle, titre, une phrase, un bouton principal.
 * - `icon` : icône lucide (par défaut une boîte de réception) ;
 * - `action` : lien (`href`, `label`, `variant` facultative, orange par défaut) ;
 * - `children` : contenu libre sous la phrase (ex. un formulaire) à la place ou en plus du bouton.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: { href: string; label: string; variant?: "default" | "outline" | "secondary" };
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-10 text-center",
        className,
      )}
    >
      <div
        aria-hidden
        className="mb-1 flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink [&>svg]:size-6"
      >
        {icon ?? <Inbox />}
      </div>
      <p className="text-body font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="max-w-md text-body text-muted-foreground">{description}</p>
      ) : null}
      {action ? (
        <Link
          href={action.href}
          className={cn(
            buttonVariants({ variant: action.variant ?? "default" }),
            "mt-2 max-md:h-10",
          )}
        >
          {action.label}
        </Link>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
