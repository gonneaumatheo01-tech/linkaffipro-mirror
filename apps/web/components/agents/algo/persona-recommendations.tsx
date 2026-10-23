import Link from "next/link";
import { RecommendationCard } from "@/components/agents/algo/recommendations-list";
import type { RecommendationView } from "@/lib/agents/algo/recommendations";

/**
 * Encart « Propositions de l'équipe Algorithme » de la fiche persona (phase 21) : réglages proposés pour cette persona
 * (exemples de style, échanges avant le lien, relances), avec leurs preuves. Appliquer / Refuser / Annuler :
 * administrateurs ; le moteur passe par la même validation que ce formulaire, jamais par une écriture directe.
 * Rien n'est affiché tant que l'équipe n'a rien proposé.
 */
export function PersonaRecommendations({
  personaId,
  recs,
  role,
}: {
  personaId: string;
  recs: RecommendationView[];
  role: string;
}) {
  const shown = recs.filter((r) => r.status === "PROPOSED" || r.status === "APPLIED").slice(0, 6);
  if (shown.length === 0) return null;
  return (
    <section
      id="propositions-algorithme"
      aria-labelledby="propositions-algorithme-title"
      className="scroll-mt-24 space-y-3 border-t border-border pt-6"
    >
      <h2 id="propositions-algorithme-title" className="text-body font-semibold text-foreground">
        Propositions de l&apos;équipe Algorithme
      </h2>
      <p className="text-note text-muted-foreground">
        Tirées des conversations de cette persona (30 derniers jours). L&apos;identité, l&apos;âge et les règles de la
        persona ne sont jamais touchés. Toutes les mesures sont dans{" "}
        <Link href="/agents/algo#conversations" className="text-brand-ink underline underline-offset-4">
          Ce qui marche
        </Link>
        .
      </p>
      <ul className="space-y-3">
        {shown.map((r) => (
          <RecommendationCard key={r.id} rec={r} role={role} from={`/conversations/personas/${personaId}`} />
        ))}
      </ul>
    </section>
  );
}
