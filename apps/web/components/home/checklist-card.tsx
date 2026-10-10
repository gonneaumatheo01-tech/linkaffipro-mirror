import Link from "next/link";
import { ChevronDown, ChevronRight, Circle, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { dismissChecklistAction } from "@/lib/onboarding/actions";
import {
  checklistProgress,
  checklistSummary,
  type ChecklistItem,
} from "@/lib/onboarding/checklist";
import { HomeSection } from "./home-section";

/**
 * Liste « À faire pour démarrer » : lignes cochées d'après la base, chacune avec son lien ; « Masquer » la cache pour
 * cet utilisateur. Affichée jusqu'à ce qu'elle soit finie ou masquée, sous les trois chiffres du jour.
 * Téléphone : repliée sur une ligne (« Pour démarrer : 1 sur 4 », prochaine étape) qui se déplie au toucher, pour que
 * les chiffres du jour et « À faire » restent dans le premier écran. Ordinateur : carte dépliée.
 */
export function ChecklistCard({ items }: { items: readonly ChecklistItem[] }) {
  const { done, total } = checklistProgress(items);
  const { title, next } = checklistSummary(items);
  return (
    <>
      <section aria-label="À faire pour démarrer" className="md:hidden">
        <details className="group/checklist rounded-xl border border-border bg-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-foreground">{title}</span>
              {next ? (
                <span className="block truncate text-note text-muted-foreground">
                  Prochaine étape : {next.label}
                </span>
              ) : null}
            </span>
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform group-open/checklist:rotate-180"
            />
          </summary>
          <div className="border-t border-border px-4 pt-3 pb-2">
            <Progress done={done} total={total} />
            <ChecklistLines items={items} />
            <form action={dismissChecklistAction} className="mt-1 flex justify-end">
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-muted-foreground max-md:h-10"
              >
                Masquer la liste
              </Button>
            </form>
          </div>
        </details>
      </section>
      <HomeSection
        id="pour-demarrer"
        title="À faire pour démarrer"
        description={`Étapes faites : ${done} sur ${total}`}
        className="max-md:hidden"
        action={
          <form action={dismissChecklistAction}>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-muted-foreground max-md:h-10"
            >
              Masquer
            </Button>
          </form>
        }
      >
        <Progress done={done} total={total} />
        <ChecklistLines items={items} className="md:grid-cols-2" />
      </HomeSection>
    </>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Avancement de la mise en route"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} sur ${total}`}
      className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-brand transition-[width]"
        style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
      />
    </div>
  );
}

function ChecklistLines({
  items,
  className,
}: {
  items: readonly ChecklistItem[];
  className?: string;
}) {
  return (
    <ul className={cn("-mx-2 grid gap-x-4", className)}>
      {items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            className="group flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            {item.done ? (
              <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
            ) : (
              <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-body font-medium",
                  item.done ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {item.label}
                <span className="sr-only">{item.done ? " (fait)" : " (à faire)"}</span>
              </span>
              <span className="block text-note text-muted-foreground">{item.hint}</span>
            </span>
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
