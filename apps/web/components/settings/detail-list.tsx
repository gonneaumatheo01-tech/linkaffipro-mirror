import { cn } from "@/components/ui/cn";

/**
 * Liste « libellé : valeur » des volets de détail et des blocs techniques de Réglages (`<dl>` en deux colonnes).
 * Usage : `<DetailList><DetailRow label="Devise">EUR</DetailRow></DetailList>`.
 */
export function DetailList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-body",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function DetailRow({
  label,
  children,
  mono,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  /** Valeur technique (identifiant, adresse) en police à chasse fixe. */
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words", mono && "font-mono text-note")}>{children}</dd>
    </>
  );
}
