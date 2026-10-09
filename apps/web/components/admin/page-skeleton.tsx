/** Squelette de chargement commun aux pages (titre, barre d'outils, carte). */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Chargement" className="animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-7 w-48 rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full rounded-md bg-muted" />
      </div>
      <div className="mb-4 flex gap-2">
        <div className="h-8 w-28 rounded-md bg-muted" />
        <div className="h-8 w-28 rounded-md bg-muted" />
      </div>
      <div className="rounded-xl border p-4">
        <div className="space-y-3">
          {Array.from({ length: rows }, (_, i) => (
            <div
              key={i}
              className="h-5 rounded-md bg-muted"
              style={{ width: `${100 - (i % 3) * 12}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
