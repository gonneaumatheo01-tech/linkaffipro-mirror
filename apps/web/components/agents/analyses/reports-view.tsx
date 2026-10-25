import { FileText } from "lucide-react";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { countriesText, evidenceList, reportHref, reportLines, reportSources, reportText } from "@/lib/agents/analyses";
import type { ReportDetail, ReportRow } from "@/lib/agents/analyses-queries";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { EvidenceList } from "./evidence-list";

const marketText = (m: string | null) => (m ? statusLabel("vertical", m) : "Tous les marchés");

/** Vue « Rapports » : le rapport du lundi et les briefings demandés à Kevin, du plus récent au plus ancien. */
export function ReportsView({ rows }: { rows: ReportRow[] }) {
  return (
    <FormSection
      title="Rapports"
      description={rows.length ? `${fmtNum(rows.length)} rapport${rows.length > 1 ? "s" : ""}. Cliquez sur une ligne pour le lire.` : undefined}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="Pas encore de rapport"
          description="Le rapport de la semaine arrive chaque lundi matin par Kevin. Pour un briefing tout de suite, écrivez-lui « briefing casino Allemagne »."
          action={{ href: "/agents/boss", label: "Parler à Kevin", variant: "outline" }}
        />
      ) : (
        <DataTable
          label="Rapports de l'analyse de marché"
          columns={[
            { key: "title", header: "Rapport", className: "whitespace-normal" },
            { key: "type", header: "Genre" },
            { key: "market", header: "Marché", hideOnMobile: true },
            { key: "date", header: "Écrit le" },
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            href: reportHref(r.id),
            cells: {
              title: (
                <span className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">{r.title}</span>
                  <span className="text-note text-muted-foreground">
                    {[r.period, r.countries.length ? countriesText(r.countries) : null, r.requestText ? `« ${r.requestText} »` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              ),
              type: <StatusBadge kind="strategyReport" value={r.reportType} />,
              market: marketText(r.market),
              date: fmtDate(r.createdAt),
            },
            sortValues: { title: r.title, type: r.reportType, market: r.market ?? "", date: r.createdAt.getTime() },
          }))}
        />
      )}
    </FormSection>
  );
}

type ReportRec = { title: string; description: string | null; risk: string | null; verified: boolean; evidence: ReturnType<typeof evidenceList> };

/** Recommandations jointes au rapport (`[{ title, description, risk, sources | evidence, verified }]`). */
function reportRecs(v: unknown): ReportRec[] {
  if (!Array.isArray(v)) return [];
  const out: ReportRec[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : null;
    if (!title) continue;
    const evidence = evidenceList(o.evidence ?? o.sources);
    out.push({
      title,
      description: typeof o.description === "string" && o.description.trim() ? o.description.trim() : null,
      risk: typeof o.risk === "string" ? o.risk : null,
      verified: o.verified === true || (o.verified === undefined && evidence.length > 1),
      evidence,
    });
  }
  return out;
}

/** Lecture en ligne d'un rapport : le texte envoyé par Kevin (liens cliquables), ses sources, ses recommandations. */
export function ReportContent({ report }: { report: ReportDetail }) {
  const body = reportText(report.content) ?? report.summary;
  const lines = reportLines(body);
  const sources = reportSources(report.content);
  const recs = reportRecs(report.recommendations);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="strategyReport" value={report.reportType} />
        <span className="text-note text-muted-foreground">
          {[marketText(report.market), report.countries.length ? countriesText(report.countries) : null, report.period, `écrit le ${fmtDate(report.createdAt)}`, report.sentAt ? `envoyé par Kevin le ${fmtDate(report.sentAt)}` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      {report.requestText ? <p className="text-body text-foreground">Votre question : « {report.requestText} »</p> : null}
      <FormSection title="Le rapport">
        <div className="space-y-1 text-body text-foreground">
          {lines.map((pieces, i) =>
            pieces.every((p) => !p.text.trim()) ? (
              <div key={i} className="h-2" aria-hidden />
            ) : (
              <p key={i}>
                {pieces.map((p, j) =>
                  p.url ? (
                    <a key={j} href={p.url} target="_blank" rel="noreferrer noopener" className="text-info underline underline-offset-4">
                      {p.text}
                    </a>
                  ) : (
                    <span key={j}>{p.text}</span>
                  ),
                )}
              </p>
            ),
          )}
        </div>
      </FormSection>
      {recs.length ? (
        <FormSection title="Recommandations du rapport" description="À décider dans la vue Recommandations ou par Kevin. Rien n'est changé sans vous.">
          <ul className="space-y-3">
            {recs.map((r, i) => (
              <li key={i} className="space-y-1 rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">
                    {i + 1}. {r.title}
                  </span>
                  {r.risk ? <StatusBadge kind="riskLevel" value={r.risk} /> : null}
                  {!r.verified ? <span className="text-note text-muted-foreground">Non vérifiée</span> : null}
                </div>
                {r.description ? <p className="text-note text-foreground">{r.description}</p> : null}
                <EvidenceList items={r.evidence} />
              </li>
            ))}
          </ul>
        </FormSection>
      ) : null}
      {sources.length ? (
        <FormSection title="Sources du rapport">
          <EvidenceList items={sources} label="Sources du rapport" />
        </FormSection>
      ) : null}
    </div>
  );
}
