import { requireUser } from "@/lib/session";
import { Sidebar } from "@/components/admin/sidebar";
import { Header } from "@/components/admin/header";
import { BottomNav } from "@/components/admin/bottom-nav";
import { Shortcuts } from "@/components/admin/shortcuts";

export const dynamic = "force-dynamic";

/**
 * Coque de l'espace connecté : barre de menu nuit à gauche (rail d'icônes sur tablette, barre complète sur
 * ordinateur), en-tête blanc, contenu clair, barre du bas sur téléphone (le contenu lui laisse la place : 56 px +
 * zone sûre iOS). Les marges latérales suivent les zones sûres (encoche d'un iPhone en paysage).
 */
export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  return (
    <div className="flex min-h-dvh">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-[max(0.5rem,env(safe-area-inset-left))] focus:z-50 focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-body focus:font-medium focus:text-brand-foreground"
      >
        Aller au contenu
      </a>
      <Sidebar isAdmin={isAdmin} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Header user={user} />
        <main
          id="contenu"
          tabIndex={-1}
          className="flex-1 pt-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(3.5rem+env(safe-area-inset-bottom)+1.5rem)] pl-[max(1rem,env(safe-area-inset-left))] outline-none md:p-6 md:pr-[max(1.5rem,env(safe-area-inset-right))] lg:p-8 lg:pr-[max(2rem,env(safe-area-inset-right))]"
        >
          {children}
        </main>
        <Shortcuts />
      </div>
      <BottomNav isAdmin={isAdmin} />
    </div>
  );
}
