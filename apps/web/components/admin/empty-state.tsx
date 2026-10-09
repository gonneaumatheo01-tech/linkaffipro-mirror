import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * État vide d'une liste : icône facultative, titre, phrase, bouton d'action facultatif.
 * `action` : lien (`href`) ou contenu libre (`children`, ex. un formulaire).
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
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-1 text-muted-foreground [&>svg]:size-8">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? (
        <Button
          className="mt-2 max-md:h-10"
          variant={action.variant ?? "default"}
          render={<Link href={action.href} />}
        >
          {action.label}
        </Button>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
