import { PageHeader } from "@/components/admin/page-header";

/** Squelette de la page Aide : même disposition que la page (sommaire à gauche sur grand écran, replié au-dessus sinon). */
export default function HelpLoading() {
  return (
    <>
      <PageHeader
        title="Aide"
        description="Le guide d'utilisation complet, menu par menu, en français simple."
      />
      <div
        role="status"
        className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8"
        aria-busy="true"
      >
        <span className="sr-only">Chargement…</span>
        <div className="space-y-2 max-lg:hidden">
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="h-5 rounded bg-muted motion-safe:animate-pulse"
              style={{ width: `${60 + (i % 4) * 10}%` }}
            />
          ))}
        </div>
        <div className="h-12 rounded-xl border border-border bg-card lg:hidden" />
        <div className="space-y-3 rounded-xl border border-border bg-card p-6">
          {Array.from({ length: 14 }, (_, i) => (
            <div
              key={i}
              className="h-4 rounded bg-muted motion-safe:animate-pulse"
              style={{ width: `${i % 5 === 0 ? 40 : 85 + (i % 3) * 5}%` }}
            />
          ))}
        </div>
      </div>
    </>
  );
}
