import { BrandLogo } from "@/components/admin/brand-logo";
import { cn } from "@/components/ui/cn";

/**
 * Écran de marque des pages sans session (connexion, invitation) : fond nuit, logo centré, puis le contenu
 * (titre en blanc et carte blanche). La barre du navigateur du téléphone passe en nuit (`viewport` des pages).
 */
export function BrandScreen({
  children,
  width = "sm",
}: {
  children: React.ReactNode;
  width?: "sm" | "md";
}) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center bg-night px-4 pt-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <div className={cn("w-full space-y-6", width === "md" ? "max-w-md" : "max-w-sm")}>
        <div className="flex justify-center">
          <BrandLogo size={64} />
        </div>
        {children}
      </div>
    </main>
  );
}

/** Couleur nuit de la barre du navigateur (téléphone) sur les écrans de marque. */
export const BRAND_THEME_COLOR = "#020713";
