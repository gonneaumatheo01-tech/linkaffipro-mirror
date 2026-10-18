import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Term } from "@/components/admin/help-tip";
import { NumCell } from "@/components/dashboard/cells";
import { fmtMoney, fmtNum } from "@/lib/format";
import { aiCostText, pctText } from "@/lib/conversations/labels";
import type { FigureRow } from "@/lib/conversations/stats";

function plural(n: number, one: string, many: string): string {
  return `${fmtNum(n)} ${n > 1 ? many : one}`;
}

/** Tous les chiffres d'une ligne (volet de détail). */
export function FigureDetail({ r }: { r: FigureRow }) {
  return (
    <DetailList>
      <DetailRow label="Conversations commencées">{fmtNum(r.conversations)}</DetailRow>
      <DetailRow label="Réponses">
        {fmtNum(r.replies)}
        {r.replyRate !== null ? (
          <span className="block text-note text-muted-foreground">
            {pctText(r.replyRate)} des conversations
          </span>
        ) : null}
      </DetailRow>
      <DetailRow label="Liens de l'offre envoyés">{fmtNum(r.linksSent)}</DetailRow>
      <DetailRow label="Liens ouverts">{fmtNum(r.linksOpened)}</DetailRow>
      <DetailRow label="Inscriptions">{fmtNum(r.registrations)}</DetailRow>
      <DetailRow label={<Term term="FTD">Premiers dépôts</Term>}>{fmtNum(r.ftds)}</DetailRow>
      <DetailRow label="Coût de l'IA">
        <span title={fmtMoney(r.costEur, "EUR", { digits: 4 })}>{aiCostText(r.costEur)}</span>
      </DetailRow>
      <DetailRow label="Coût de l'IA par inscription">
        {r.costPerRegistration === null ? "—" : aiCostText(r.costPerRegistration)}
      </DetailRow>
    </DetailList>
  );
}

/**
 * Tableau des chiffres par persona ou par source (5 colonnes ; le reste au clic, dans le volet) : conversations (avec
 * le taux de réponse), liens ouverts (sur les liens envoyés), inscriptions (avec les premiers dépôts), coût de l'IA
 * (avec le coût par inscription). Composant serveur (cellules rendues, `DataTable` client).
 */
export function ConversationStatsTable({
  label,
  nameHeader,
  rows,
  periodText,
  empty,
}: {
  label: string;
  nameHeader: string;
  rows: FigureRow[];
  periodText: string;
  empty: { title: string; description: string };
}) {
  const dataRows: DataTableRow[] = rows.map((r) => ({
    id: r.key,
    detailTitle: r.label,
    detailDescription: periodText,
    cells: {
      name: <span className="break-words whitespace-normal">{r.label}</span>,
      conversations: (
        <NumCell
          value={fmtNum(r.conversations)}
          note={r.replyRate === null ? null : `${pctText(r.replyRate)} de réponses`}
        />
      ),
      opened: (
        <NumCell
          value={fmtNum(r.linksOpened)}
          note={`sur ${plural(r.linksSent, "envoyé", "envoyés")}`}
        />
      ),
      registrations: (
        <NumCell
          value={fmtNum(r.registrations)}
          note={plural(r.ftds, "premier dépôt", "premiers dépôts")}
        />
      ),
      cost: (
        <NumCell
          value={aiCostText(r.costEur)}
          note={
            r.costPerRegistration === null
              ? null
              : `${aiCostText(r.costPerRegistration)} par inscription`
          }
        />
      ),
    },
    sortValues: {
      name: r.label,
      conversations: r.conversations,
      opened: r.linksOpened,
      registrations: r.registrations,
      cost: r.costEur,
    },
    detail: <FigureDetail r={r} />,
  }));
  return (
    <DataTable
      label={label}
      panelSize="md"
      columns={[
        { key: "name", header: nameHeader, className: "md:min-w-40" },
        { key: "conversations", header: "Conversations", align: "right" },
        { key: "opened", header: "Liens ouverts", align: "right", hideOnMobile: true },
        { key: "registrations", header: "Inscriptions", align: "right" },
        { key: "cost", header: "Coût de l'IA", align: "right", hideOnMobile: true },
      ]}
      rows={dataRows}
      empty={empty}
    />
  );
}
