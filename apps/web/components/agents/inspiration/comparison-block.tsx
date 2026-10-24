import type { Measure } from "@linkaffipro/agents";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { StatusPill } from "@/components/admin/status-pill";
import { measureValueText, rawMeasureRows, sampleText, type AnalysisView } from "@/lib/agents/inspiration";
import type { ComparisonBlock as Block } from "@/lib/agents/inspiration-queries";

const FAMILIES: Array<{ key: "rhythm" | "form" | "content" | "results"; title: string }> = [
  { key: "rhythm", title: "Rythme" },
  { key: "form", title: "Forme" },
  { key: "content", title: "Fond" },
  { key: "results", title: "Résultats" },
];

function MeasureList({ title, measures }: { title: string; measures: Measure[] }) {
  if (measures.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <h3 className="text-body font-semibold text-foreground">{title}</h3>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-body">
        {measures.map((m) => (
          <div key={m.key} className="contents">
            <dt className="text-muted-foreground">{m.label}</dt>
            <dd className="text-right text-foreground tabular-nums">
              {measureValueText(m.value, m.unit)}
              {m.sampleSize > 0 ? <span className="block text-note text-muted-foreground">{sampleText(m.sampleSize)}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AnalysisMeasures({ analysis }: { analysis: AnalysisView }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        {FAMILIES.map((f) => (
          <MeasureList key={f.key} title={f.title} measures={analysis[f.key]} />
        ))}
      </div>
      {analysis.peakSlots.length ? (
        <p className="text-body text-foreground">
          <span className="text-muted-foreground">Heures de pointe (Paris) :</span> {analysis.peakSlots.join(", ")}
        </p>
      ) : null}
      {analysis.quotes.length ? (
        <div className="space-y-1">
          <p className="text-note text-muted-foreground">Pour illustrer (10 mots au plus, jamais repris) :</p>
          <ul className="list-disc space-y-0.5 pl-5 text-note text-foreground">
            {analysis.quotes.map((q, i) => (
              <li key={i}>« {q} »</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Bloc « eux / nous / écart » : analyse (gardée ou calculée à l'affichage), sinon mesures brutes des posts lus. */
export function ComparisonBlock({ block }: { block: Block }) {
  if (block.kind === "raw") {
    if (block.raw.count === 0)
      return (
        <EmptyState
          title="Aucun post lu pour l'instant"
          description="Les chiffres apparaissent dès la première lecture. Si le canal est privé, transférez 20 à 30 de ses posts à Kevin."
        />
      );
    return (
      <div className="space-y-3">
        <p className="text-note text-muted-foreground">
          {block.tooFew
            ? `Seulement ${block.raw.count} post${block.raw.count > 1 ? "s" : ""} lu${block.raw.count > 1 ? "s" : ""} : il en faut 20 au moins pour une analyse. Kevin en demande d'autres. En attendant, les chiffres bruts :`
            : "L'analyse complète n'est pas encore faite. En attendant, les chiffres bruts des posts lus :"}
        </p>
        <DataTable
          label="Chiffres des posts lus"
          columns={[
            { key: "label", header: "Mesure", sortable: false },
            { key: "value", header: "Chez eux", sortable: false, className: "whitespace-normal" },
          ]}
          rows={rawMeasureRows(block.raw).map((r) => ({ id: r.label, cells: { label: r.label, value: r.value } }))}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {block.comparisons.length === 0 ? (
        <p className="text-note text-muted-foreground">
          Pas encore de comparaison avec vos canaux : choisissez un canal cible en écrivant à Kevin « c&apos;est pour le canal … ».
        </p>
      ) : (
        block.comparisons.map((c) => (
          <div key={c.channelId} className="space-y-2">
            <h3 className="text-body font-semibold text-foreground">
              Eux / {c.channelTitle}{" "}
              <span className="font-normal text-muted-foreground">
                ({c.ourSampleSize.toLocaleString("fr-FR")} de vos posts sur 28 jours)
              </span>
            </h3>
            <DataTable
              label={`Comparaison avec ${c.channelTitle}`}
              columns={[
                { key: "label", header: "Mesure" },
                { key: "theirs", header: "Eux", align: "right" },
                { key: "ours", header: "Nous", align: "right" },
                { key: "gap", header: "Écart", sortable: false },
              ]}
              rows={c.gaps.map((g) => ({
                id: g.key,
                cells: {
                  label: g.label,
                  theirs: measureValueText(g.theirs, g.unit),
                  ours: measureValueText(g.ours, g.unit),
                  gap: g.matters ? <StatusPill tone="warning">Écart qui compte</StatusPill> : <span className="text-muted-foreground">faible</span>,
                },
                sortValues: { label: g.label, gap: g.matters ? 1 : 0 },
              }))}
              empty={{ title: "Pas de mesure comparable", description: "Vos posts de ce canal sont encore trop peu nombreux." }}
            />
          </div>
        ))
      )}
      <div className="space-y-2">
        <h3 className="text-body font-semibold text-foreground">
          Leurs chiffres{" "}
          <span className="font-normal text-muted-foreground">
            ({block.analysis.sampleSize.toLocaleString("fr-FR")} posts analysés
            {block.source === "computed" ? ", calculés à l'instant" : ""})
          </span>
        </h3>
        <AnalysisMeasures analysis={block.analysis} />
      </div>
    </div>
  );
}
