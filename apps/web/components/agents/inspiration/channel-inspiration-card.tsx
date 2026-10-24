import Link from "next/link";
import { referenceHref } from "@/lib/agents/inspiration";
import { loadChannelInspiration } from "@/lib/agents/inspiration-queries";
import { StatusBadge } from "@/lib/status-badges";

/**
 * Encart « Inspiré de @xxx » de la fiche d'un canal (phase 27) : le canal d'inspiration dont la Rédaction lit le
 * profil de style pour ce canal, ou les références qui visent ce canal. Rien n'est affiché s'il n'y en a pas.
 */
export async function ChannelInspirationCard({ channelId }: { channelId: string }) {
  const refs = await loadChannelInspiration(channelId).catch(() => []);
  if (refs.length === 0) return null;
  return (
    <section
      aria-labelledby="inspire-de"
      className="mb-6 space-y-2 rounded-xl border border-border bg-card px-4 py-3 md:px-6 md:py-4"
    >
      <h2 id="inspire-de" className="text-body font-semibold text-foreground">
        Inspiré de{" "}
        {refs.map((r, i) => (
          <span key={r.id}>
            {i > 0 ? ", " : null}
            <Link href={referenceHref(r.id)} className="text-info underline">
              {r.name}
            </Link>
          </span>
        ))}
      </h2>
      <ul className="space-y-1">
        {refs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 text-note text-muted-foreground">
            <span className="text-foreground">{r.name}</span>
            <StatusBadge kind="referenceStatus" value={r.status} />
            <span>
              {r.styleInUse
                ? `La Rédaction écrit les posts de ce canal avec son profil de style${r.profileVersion ? ` (version ${r.profileVersion})` : ""}.`
                : "Kevin s'en sert pour comparer et proposer des réglages ; son profil de style n'est pas encore utilisé ici."}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
