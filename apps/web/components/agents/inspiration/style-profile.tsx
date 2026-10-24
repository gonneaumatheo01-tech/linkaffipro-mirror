import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import type { ChannelRef } from "@/lib/agents/inspiration-queries";
import type { StyleProfileView } from "@/lib/agents/inspiration";
import { fmtDate } from "@/lib/format";

/** Profil de style tiré de la référence : règles, description, exemples écrits à neuf, points signalés. */
export function StyleProfileBlock({ profile, usedBy }: { profile: StyleProfileView | null; usedBy: ChannelRef[] }) {
  if (!profile)
    return (
      <EmptyState
        title="Pas encore de profil de style"
        description="Kevin écrit le profil après avoir lu au moins 20 posts : ton, structure d'un post type, façon de pousser l'offre, règles et exemples écrits à neuf pour votre canal."
      />
    );
  return (
    <div className="space-y-4">
      <p className="text-note text-muted-foreground">
        Version {profile.version}, du {fmtDate(profile.createdAt)}.{" "}
        {usedBy.length ? (
          <>
            Lu par la Rédaction sur{" "}
            {usedBy.map((c, i) => (
              <span key={c.id}>
                {i > 0 ? ", " : null}
                <Link href={`/channels/${c.id}`} className="text-info underline">
                  {c.title}
                </Link>
              </span>
            ))}
            .
          </>
        ) : (
          "Pas encore utilisé par la Rédaction : il le sera si vous acceptez la proposition « Profil de style »."
        )}
      </p>
      {profile.description ? <p className="whitespace-pre-line text-body text-foreground">{profile.description}</p> : null}
      {profile.rules.length ? (
        <div className="space-y-1">
          <h3 className="text-body font-semibold text-foreground">Règles de style</h3>
          <ol className="list-decimal space-y-1 pl-5 text-body text-foreground">
            {profile.rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {profile.examples.length ? (
        <div className="space-y-2">
          <h3 className="text-body font-semibold text-foreground">Exemples écrits à neuf pour votre canal</h3>
          <ul className="space-y-2">
            {profile.examples.map((e, i) => (
              <li key={i} className="whitespace-pre-line rounded-xl border border-border bg-muted/40 px-4 py-3 text-body text-foreground">
                {e}
              </li>
            ))}
          </ul>
          <p className="text-note text-muted-foreground">Aucun de ces exemples ne reprend 8 mots à la suite d&apos;un post du canal lu.</p>
        </div>
      ) : null}
      {profile.flagged.length ? (
        <div className="space-y-1">
          <h3 className="text-body font-semibold text-foreground">Ce qu&apos;on ne reproduit pas</h3>
          <p className="text-note text-muted-foreground">Ce qu&apos;ils font et qui irait contre vos règles : signalé, jamais repris.</p>
          <ul className="list-disc space-y-0.5 pl-5 text-body text-danger">
            {profile.flagged.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
