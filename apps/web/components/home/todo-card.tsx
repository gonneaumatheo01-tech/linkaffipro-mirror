import Link from "next/link";
import {
  Bot,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  DoorOpen,
  KeyRound,
  Link2Off,
  Plug,
  Send,
  Split,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { resendGateWelcomeAction } from "@/lib/approval/resend-welcome-action";
import type { TodoAction, TodoIcon, TodoLine, TodoTone } from "@/lib/home/todo";
import { HomeSection } from "./home-section";

const ICONS: Record<TodoIcon, LucideIcon> = {
  requests: UserRoundCheck,
  failed: CircleAlert,
  reconnect: Plug,
  rules: DoorOpen,
  ab: Split,
  telegram: Bot,
  ai: KeyRound,
  links: Link2Off,
};

/** Actions serveur des boutons de ligne (jamais automatiques : seulement sur clic). */
const ACTIONS: Record<TodoAction["kind"], (formData: FormData) => Promise<void>> = {
  "resend-gate-welcome": resendGateWelcomeAction,
};

/** Bouton d'action d'une ligne, sous la phrase (à côté du lien, jamais dedans). */
function LineAction({ action }: { action: TodoAction }) {
  return (
    <form action={ACTIONS[action.kind]} className="pb-2.5 pl-13">
      <input type="hidden" name="channelId" value={action.channelId} />
      <input type="hidden" name="returnTo" value="/" />
      <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
        <Send aria-hidden />
        {action.label}
      </Button>
    </form>
  );
}

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
                {l.action ? <LineAction action={l.action} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </HomeSection>
  );
}
