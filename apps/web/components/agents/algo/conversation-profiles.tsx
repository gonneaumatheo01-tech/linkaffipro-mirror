import type { ConversationProfileStats } from "@linkaffipro/agents";
import { DataTable, type DataTableColumn } from "@/components/admin/data-table";
import { StatusPill } from "@/components/admin/status-pill";
import { pctText } from "@/lib/agents/algo/insights";
import { delayText, sourceText, type ReviewNotes } from "@/lib/agents/algo/reports";
import { fmtMoney, fmtNum } from "@/lib/format";
import { fmtDayKey } from "@/lib/periods";
import { statusLabel } from "@/lib/status-badges";

const COLUMNS: DataTableColumn[] = [
  { key: "profile", header: "Profil" },
  { key: "conversations", header: "Conversations", align: "right", sortable: true, sortFirst: "desc" },
  { key: "replyRate", header: "Taux de réponse", align: "right", sortable: true, sortFirst: "desc" },
  { key: "beforeLink", header: "Messages avant le lien", align: "right", hideOnMobile: true, term: "valeur du milieu" },
  { key: "drop", header: "Décrochent surtout à", hideOnMobile: true },
  { key: "delay", header: "Délai de réponse", align: "right", hideOnMobile: true, term: "valeur du milieu" },
  { key: "hours", header: "Heures où ils répondent", hideOnMobile: true },
  { key: "links", header: "Liens · clics", align: "right", hideOnMobile: true },
  { key: "regs", header: "Inscriptions", align: "right", sortable: true, sortFirst: "desc" },
  { key: "ftds", header: "Premiers dépôts", align: "right", sortable: true, sortFirst: "desc", term: "FTD" },
  { key: "cost", header: "Coût de l'IA", align: "right", hideOnMobile: true },
  { key: "cpr", header: "Coût par inscription", align: "right", sortable: true, term: "CPA" },
];

/** Tableau par profil (bot ou compte réel, persona, source) et motifs relevés par l'IA, sans aucun message entier. */
export function ConversationProfiles({
  profiles,
  review,
  weekStart,
  minConversations,
}: {
  profiles: ConversationProfileStats[];
  review: ReviewNotes[];
  weekStart: string | null;
  minConversations: number;
}) {
  const rows = profiles.map((p) => ({
    id: p.key,
    sortValues: {
      conversations: p.conversations,
      replyRate: p.replyRate ?? -1,
      regs: p.registrations,
      ftds: p.ftds,
      cpr: p.costPerRegistrationEur ?? Number.MAX_SAFE_INTEGER,
    },
    cells: {
      profile: (
        <span className="flex flex-col">
          <span className="font-medium text-foreground">{p.personaName ?? p.botLabel}</span>
          <span className="text-note text-muted-foreground">
            {p.kind === "ACCOUNT" ? "Compte réel" : "Bot"} {p.botLabel} · {sourceText(p.source)}
          </span>
          {p.enoughData ? null : (
            <span className="text-note text-muted-foreground">
              Pas encore assez de données ({fmtNum(minConversations)} conversations au moins)
            </span>
          )}
        </span>
      ),
      conversations: fmtNum(p.conversations),
      replyRate: pctText(p.replyRate),
      beforeLink: p.medianMessagesBeforeLink === null ? "—" : fmtNum(p.medianMessagesBeforeLink),
      drop: p.dropStage ? statusLabel("conversationStage", p.dropStage) : "—",
      delay: delayText(p.medianReplyDelaySec),
      hours: p.replyHours.length ? p.replyHours.slice(0, 4).map((h) => `${h} h`).join(", ") : "—",
      links: `${fmtNum(p.linksSent)} · ${fmtNum(p.clicks)}`,
      regs: fmtNum(p.registrations),
      ftds: fmtNum(p.ftds),
      cost: fmtMoney(p.aiCostEur),
      cpr: p.costPerRegistrationEur === null ? "—" : fmtMoney(p.costPerRegistrationEur),
    },
  }));
  const names = new Map(profiles.map((p) => [p.key, p.personaName ?? p.botLabel]));
  return (
    <div className="space-y-4">
      {weekStart ? (
        <p className="text-note text-muted-foreground">
          30 derniers jours, calculés pour la semaine du {fmtDayKey(weekStart)}. Messages avant le lien et délai de
          réponse : valeur du milieu.
        </p>
      ) : null}
      <DataTable
        label="Conversations par profil"
        columns={COLUMNS}
        rows={rows}
        defaultSort={{ key: "conversations", direction: "desc" }}
        empty={{
          title: "Pas encore de chiffres par profil",
          description: "Ils arrivent avec le premier calcul de l'équipe Algorithme (chaque nuit), à partir des conversations des personas.",
        }}
      />
      {review.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-body font-semibold text-foreground">Ce que l&apos;IA a relevé (échantillon anonymisé)</h3>
          <ul className="grid gap-3 md:grid-cols-2">
            {review.map((n, i) => (
              <li key={n.key ?? i} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3 text-note">
                <p className="font-medium text-foreground">{n.label ?? (n.key ? names.get(n.key) : null) ?? "Profil"}</p>
                {n.works.length ? (
                  <div>
                    <StatusPill tone="success">Obtient une réponse</StatusPill>
                    <ul className="mt-1 list-disc pl-5 text-foreground">
                      {n.works.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {n.fails.length ? (
                  <div>
                    <StatusPill tone="warning">Fait fuir</StatusPill>
                    <ul className="mt-1 list-disc pl-5 text-foreground">
                      {n.fails.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {n.drops.length ? (
                  <div>
                    <StatusPill tone="muted">Pourquoi les gens décrochent</StatusPill>
                    <ul className="mt-1 list-disc pl-5 text-foreground">
                      {n.drops.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
