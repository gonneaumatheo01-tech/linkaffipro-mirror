/**
 * Squelette de chargement commun aux pages (titre, ligne d'aide, bouton principal, carte de liste),
 * aux couleurs du thème : blocs gris doux sur cartes blanches. L'animation est coupée si l'utilisateur
 * a demandé moins de mouvement ; un texte « Chargement… » est lu par les lecteurs d'écran.
 */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="motion-safe:animate-pulse">
      <span className="sr-only">Chargement…</span>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded-md bg-muted" />
          <div className="h-4 w-80 max-w-full rounded-md bg-muted" />
        </div>
        <div className="h-9 w-36 rounded-lg bg-brand-soft" />
      </div>
      <div className="rounded-xl border border-border bg-card">
        <div className="flex gap-2 border-b border-border p-4">
          <div className="h-8 w-28 rounded-lg bg-muted" />
          <div className="h-8 w-28 rounded-lg bg-muted" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="size-8 shrink-0 rounded-full bg-muted" />
              <div className="h-4 rounded-md bg-muted" style={{ width: `${70 - (i % 3) * 12}%` }} />
              <div className="ml-auto hidden h-4 w-16 rounded-md bg-muted sm:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
