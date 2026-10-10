import type { Metadata } from "next";
import { CalendarPlus, CircleAlert } from "lucide-react";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { CampaignsCard } from "@/components/home/campaigns-card";
import { ChecklistCard } from "@/components/home/checklist-card";
import { StatusBar } from "@/components/home/status-bar";
import { TodayCards } from "@/components/home/today-cards";
import { TodoCard } from "@/components/home/todo-card";
import { UpcomingCard } from "@/components/home/upcoming-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { homeFigures } from "@/lib/home/figures";
import {
  loadActiveCampaigns,
  loadChecklistInput,
  loadHomeFigures,
  loadStatusInput,
  loadTodoInput,
  loadUpcomingPosts,
} from "@/lib/home/queries";
import { buildStatusBar } from "@/lib/home/status";
import { buildTodo } from "@/lib/home/todo";
import { buildChecklist, checklistVisible } from "@/lib/onboarding/checklist";
import { loadOnboarding } from "@/lib/onboarding/store";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Accueil" };

/** Un bloc en panne n'empêche pas les autres de s'afficher. */
function safe<T>(p: Promise<T>, label: string): Promise<T | null> {
  return p.catch((err: unknown) => {
    console.error(`[accueil] ${label} :`, err instanceof Error ? err.message : err);
    return null;
  });
}

function BlockError({ what }: { what: string }) {
  return (
    <Alert variant="warning" role="status">
      <CircleAlert aria-hidden />
      <AlertDescription>
        {what} n&apos;a pas pu s&apos;afficher. Rechargez la page dans un instant.
      </AlertDescription>
    </Alert>
  );
}

/**
 * Accueil (maquette validée, docs/REFONTE-UX.md) : est-ce que tout marche ? De haut en bas : barre d'état, les trois
 * chiffres du jour, liste « À faire pour démarrer » (tant qu'elle n'est ni finie ni masquée ; repliée sur une ligne sur
 * téléphone), « À faire », « Prochains messages », « Campagnes actives ». Pensé d'abord pour le téléphone : la barre
 * d'état et les trois chiffres tiennent dans le premier écran. Un seul bouton principal : « Programmer un message ».
 * Les pages réservées aux administrateurs renvoient ici avec `?forbidden=1`. Aucun autre paramètre d'adresse n'est lu
 * (les anciens paramètres du tableau de bord mènent à /stats, voir lib/legacy-routes.ts).
 */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const now = new Date();
  const isAdmin = user.role === "ADMIN";
  const [onboarding, checklistInput, figures, status, todoInput, upcoming, campaigns] =
    await Promise.all([
      safe(loadOnboarding(user.id), "visite"),
      safe(loadChecklistInput(user), "pour démarrer"),
      safe(loadHomeFigures(now), "chiffres du jour"),
      safe(loadStatusInput(now), "état"),
      safe(loadTodoInput(user, now), "à faire"),
      safe(loadUpcomingPosts(now), "prochains messages"),
      safe(loadActiveCampaigns(now), "campagnes actives"),
    ]);

  const checklist = checklistInput ? buildChecklist(checklistInput) : [];
  const showChecklist =
    onboarding !== null && checklistInput !== null && checklistVisible(checklist, onboarding);
  const telegramInChecklist =
    showChecklist && checklist.some((i) => i.key === "telegram" && !i.done);

  return (
    <>
      <PageHeader
        title="Accueil"
        description="Ce qui marche, ce qui rapporte et ce qu'il reste à faire aujourd'hui."
        primaryAction={{
          label: "Programmer un message",
          href: "/messages/new",
          icon: <CalendarPlus aria-hidden />,
        }}
      />
      <Flash
        ok={sp.ok}
        error={sp.forbidden ? "Cette page est réservée aux administrateurs." : sp.error}
      />
      <div className="space-y-4 md:space-y-6">
        {status ? (
          <StatusBar bar={buildStatusBar(status)} now={now} isAdmin={isAdmin} />
        ) : (
          <BlockError what="L'état du site" />
        )}
        {figures ? (
          <TodayCards figures={homeFigures(figures.today, figures.yesterday)} />
        ) : (
          <BlockError what="Les chiffres du jour" />
        )}
        {showChecklist ? <ChecklistCard items={checklist} /> : null}
        <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
          {todoInput ? (
            <TodoCard lines={buildTodo({ ...todoInput, telegramInChecklist })} />
          ) : (
            <BlockError what="Le bloc « À faire »" />
          )}
          {upcoming ? (
            <UpcomingCard posts={upcoming} now={now} />
          ) : (
            <BlockError what="Le bloc « Prochains messages »" />
          )}
        </div>
        {campaigns ? (
          <CampaignsCard rows={campaigns.rows} total={campaigns.total} />
        ) : (
          <BlockError what="Le bloc « Campagnes actives »" />
        )}
      </div>
    </>
  );
}
