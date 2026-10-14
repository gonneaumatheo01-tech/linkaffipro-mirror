import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TUTORIAL_STEPS, TUTORIAL_TITLE } from "@/lib/affiliates/tutorial";

/** Adresse de la sous-section « Campagnes Telegram des affiliés » (Réglages → Connexions). */
export const AFFILIATE_SETTINGS_HREF = "/settings/connectors#linkaffi-affilies";

/**
 * Mini-tutoriel « Affiliés sur vos canaux » (page Affiliés Link Affi) : les cinq étapes, au premier passage, refermé
 * par « J'ai compris » (mémorisé pour cet utilisateur). Un administrateur a le lien direct vers les deux clés.
 */
export function AffiliateTutorial({
  dismissAction,
  isAdmin,
  dismissed,
}: {
  dismissAction: () => Promise<void>;
  isAdmin: boolean;
  /** Déjà refermé (rouvert à la demande) : pas de bouton « J'ai compris ». */
  dismissed: boolean;
}) {
  return (
    <section
      aria-labelledby="affiliates-tutorial-title"
      className="mb-6 rounded-xl border border-border bg-card p-4 md:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"
        >
          <Lightbulb className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="affiliates-tutorial-title" className="text-title text-foreground">
            {TUTORIAL_TITLE}
          </h2>
          <p className="mt-0.5 text-note text-muted-foreground">
            Vos affiliés Link Affi amènent des membres sur vos canaux ; leurs premiers dépôts leur
            sont crédités dans Link Affi.
          </p>
        </div>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {TUTORIAL_STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-lg border border-border bg-surface p-3">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-night text-note font-semibold text-night-foreground"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-body font-semibold text-foreground">{s.title}</p>
              <p className="mt-0.5 text-note text-muted-foreground">{s.text}</p>
              {i === 0 && isAdmin ? (
                <Link
                  href={AFFILIATE_SETTINGS_HREF}
                  className="mt-1 inline-flex min-h-8 items-center text-note font-medium text-brand-ink underline-offset-4 hover:underline max-md:min-h-10"
                >
                  Ouvrir les deux clés
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {dismissed ? null : (
        <form action={dismissAction} className="mt-4 flex justify-end">
          <Button type="submit" variant="outline" className="max-md:h-10 max-md:w-full">
            J&apos;ai compris
          </Button>
        </form>
      )}
    </section>
  );
}
