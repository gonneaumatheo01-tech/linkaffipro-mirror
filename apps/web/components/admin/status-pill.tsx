import { cn } from "@/components/ui/cn";

/**
 * Pastille d'état : fond doux, texte foncé (contraste AA) et point coloré.
 * Usage : `<StatusPill tone="success">Envoyé</StatusPill>`. Pour un statut de la base, préférez
 * `<StatusBadge kind="post" value="SENT" />` (lib/status-badges.tsx), qui choisit le libellé et la nuance.
 */

export const PILL_TONES = [
  "neutral",
  "muted",
  "info",
  "success",
  "warning",
  "danger",
  "brand",
] as const;
export type PillTone = (typeof PILL_TONES)[number];

// Classes écrites en entier (détection Tailwind) ; uniquement des jetons du thème.
const TONE_CLASSES: Record<PillTone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-muted text-foreground", dot: "bg-muted-foreground" },
  muted: { pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
  info: { pill: "bg-info-soft text-info", dot: "bg-info" },
  success: { pill: "bg-success-soft text-success", dot: "bg-success" },
  warning: { pill: "bg-warning-soft text-warning", dot: "bg-warning" },
  danger: { pill: "bg-danger-soft text-danger", dot: "bg-danger" },
  brand: { pill: "bg-brand-soft text-brand-ink", dot: "bg-brand" },
};

/** Classes de la pastille et de son point pour une nuance. */
export function pillToneClasses(tone: PillTone): { pill: string; dot: string } {
  return TONE_CLASSES[tone] ?? TONE_CLASSES.neutral;
}

/** Le point n'est montré que pour un état (réussi, en attente…), pas pour une simple catégorie. */
export function pillShowsDot(tone: PillTone): boolean {
  return tone !== "neutral";
}

export function StatusPill({
  tone = "neutral",
  dot,
  title,
  className,
  children,
}: {
  tone?: PillTone;
  /** Forcer l'affichage (ou non) du point ; par défaut : oui sauf pour « neutral ». */
  dot?: boolean;
  /** Terme technique ou précision au survol. */
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const c = pillToneClasses(tone);
  const showDot = dot ?? pillShowsDot(tone);
  return (
    <span
      data-slot="status-pill"
      data-tone={tone}
      title={title}
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-note font-medium whitespace-nowrap ring-1 ring-current/15 ring-inset",
        c.pill,
        className,
      )}
    >
      {showDot ? (
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", c.dot)} />
      ) : null}
      {children}
    </span>
  );
}
