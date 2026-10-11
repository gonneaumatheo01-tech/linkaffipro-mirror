import { CircleCheck, Link2, TriangleAlert } from "lucide-react";
import { StatusPill, type PillTone } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { GateLinkRowState } from "@/lib/channels/gate-links";
import type { GateLinkView } from "@/lib/channels/gate-links-server";

const STATE_PILL: Record<GateLinkRowState, { tone: PillTone; label: string }> = {
  ok: { tone: "success", label: "Prêt" },
  pending: { tone: "warning", label: "À vérifier" },
  problem: { tone: "danger", label: "À corriger" },
};

/**
 * « Liens des canaux à rejoindre » dans « Qui peut entrer et quand » : état de chaque canal (prêt, à vérifier, à
 * corriger avec la solution en français clair) et « Vérifier les liens ». Placé DANS le formulaire de la règle : le
 * bouton envoie le formulaire vers `checkAction` (`formAction`), sans enregistrer la règle.
 */
export function GateLinksStatus({
  view,
  checkAction,
}: {
  view: GateLinkView;
  checkAction: (formData: FormData) => Promise<void>;
}) {
  const { ok, text } = view.summary;
  return (
    <section
      aria-labelledby="gate-links-title"
      className={cn(
        "space-y-3 rounded-xl border p-4",
        ok ? "border-success/25 bg-success-soft" : "border-warning/25 bg-warning-soft",
      )}
    >
      <div className="flex items-start gap-3">
        {ok ? (
          <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        ) : (
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        )}
        <div className="min-w-0" role="status">
          <h3 id="gate-links-title" className="text-body font-semibold text-foreground">
            Liens des canaux à rejoindre
          </h3>
          <p className="text-body text-foreground">{text}</p>
        </div>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {view.rows.map((r) => {
          const pill = STATE_PILL[r.state];
          return (
            <li key={r.channelId} className="space-y-1 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-body font-medium text-foreground">
                  {r.title}
                </span>
                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
              </div>
              <p className="text-note text-muted-foreground">{r.text}</p>
              {r.solution ? (
                <p className="text-body font-medium text-foreground">{r.solution}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="outline"
          formAction={checkAction}
          data-verify-links=""
          className="max-md:h-10"
        >
          Vérifier les liens
        </Button>
        <p className="text-note text-muted-foreground">
          Crée tout de suite les liens manquants avec nos bots. Aucun message n&apos;est envoyé.
        </p>
      </div>
    </section>
  );
}
