import Link from "next/link";
import {
  Bot,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  DoorOpen,
  KeyRound,
  Plug,
  Split,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import type { TodoIcon, TodoLine, TodoTone } from "@/lib/home/todo";
import { HomeSection } from "./home-section";

const ICONS: Record<TodoIcon, LucideIcon> = {
  requests: UserRoundCheck,
  failed: CircleAlert,
  reconnect: Plug,
  rules: DoorOpen,
  ab: Split,
  telegram: Bot,
  ai: KeyRound,
};

const TONES: Record<TodoTone, string> = {
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  neutral: "bg-brand-soft text-brand-ink",
};

/** Bloc « À faire » : une phrase et un lien par chose à faire ; « Rien à faire pour l'instant » sinon. */
export function TodoCard({ lines }: { lines: readonly TodoLine[] }) {
  return (
    <HomeSection
      id="a-faire"
      title={
        <>
          À faire
          {lines.length > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {lines.length}
            </Badge>
          ) : null}
        </>
      }
    >
      {lines.length === 0 ? (
        <EmptyState
          icon={<CircleCheck />}
          title="Rien à faire pour l'instant"
          description="Les demandes à valider et les points à régler apparaîtront ici."
          className="border-0 py-6"
        />
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {lines.map((l) => {
            const Icon = ICONS[l.icon];
            return (
              <li key={l.key}>
                <Link
                  href={l.href}
                  className="group flex min-h-12 items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full [&>svg]:size-4",
                      TONES[l.tone],
                    )}
                  >
                    <Icon />
                  </span>
                  <span className="min-w-0 flex-1 text-body text-foreground">{l.text}</span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </HomeSection>
  );
}
