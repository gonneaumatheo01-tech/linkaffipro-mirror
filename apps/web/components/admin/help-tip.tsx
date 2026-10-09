import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Infobulle « ? » accessible : visible au survol et au focus clavier, `title` en repli.
 * Usage : `<HelpTip>Coût par lead = dépense / membres entrés.</HelpTip>`.
 */
export function HelpTip({
  children,
  label = "Aide",
  className,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const plain = typeof children === "string" ? children : undefined;
  return (
    <span className={cn("group/tip relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        title={plain}
        className="inline-flex size-5 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        ?
      </button>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-md border bg-popover p-2 text-left text-xs font-normal leading-snug whitespace-normal text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}
