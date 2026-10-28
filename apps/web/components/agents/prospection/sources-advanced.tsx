import { stopAccountSearchAction } from "@/app/(admin)/agents/prospection/advanced-actions";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countryName } from "@/lib/agents/analyses";
import { accountSearchBadge, type AccountSearchState, type AttributionRow } from "@/lib/agents/prospection/advanced";
import type { AttributionData } from "@/lib/agents/prospection/advanced-queries";
import { SOURCE_TYPE_LABELS } from "@/lib/agents/prospection/display";
import { fmtDate, fmtNum, fmtPct } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

function AttributionTable({ rows, label, first, name }: { rows: AttributionRow[]; label: string; first: string; name: (k: string) => string }) {
  if (!rows.length) return <p className="text-note text-muted-foreground">Pas encore assez de canaux notés.</p>;
  return (
    <Table label={label}>
      <TableCaption className="sr-only">{label}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{first}</TableHead>
          <TableHead numeric>Canaux notés</TableHead>
          <TableHead numeric>Part de niveau A</TableHead>
          <TableHead numeric>Part de signés</TableHead>
          <TableHead numeric>Part d&apos;actifs</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell>{name(r.key)}</TableCell>
            <TableCell numeric>{fmtNum(r.total)}</TableCell>
            <TableCell numeric>
              {fmtPct(r.shareA, 0)} <span className="text-muted-foreground">({fmtNum(r.tierA)})</span>
            </TableCell>
            <TableCell numeric>
              {fmtPct(r.shareSigned, 1)} <span className="text-muted-foreground">({fmtNum(r.signed)})</span>
            </TableCell>
            <TableCell numeric>
              {fmtPct(r.shareActive, 1)} <span className="text-muted-foreground">({fmtNum(r.active)})</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Compléments de la vue Sources (phase 32) : attribution (d'où viennent les canaux de niveau A, les signés et les actifs,
 * par source et par pays) et recherche par compte Telegram réel (lecture seule, désactivée par défaut ; état, compteurs
 * du jour, dernier avertissement de Telegram). La page peut seulement COUPER la recherche ; la rallumer passe par Kevin,
 * qui demande une confirmation.
 */
export function SourcesAdvanced({ attribution, account, back }: { attribution: AttributionData; account: AccountSearchState; back: string }) {
  return (
    <div className="space-y-6">
      <FormSection id="attribution" title="Ce que rapporte chaque source" description="Parmi les canaux lus et notés : la part de niveau A, de signés (même s'ils ont arrêté depuis) et d'actifs. Sert à répartir les recherches.">
        <div className="space-y-4">
          <AttributionTable rows={attribution.bySource} label="Résultats par source" first="Source" name={(k) => SOURCE_TYPE_LABELS[k] ?? k} />
          <AttributionTable rows={attribution.byCountry.slice(0, 30)} label="Résultats par pays" first="Pays" name={countryName} />
        </div>
      </FormSection>

      <FormSection
        id="compte-reel"
        title="Recherche par compte réel"
        description="Une recherche de canaux directement dans Telegram avec un compte réel, en lecture seule : aucune adhésion, aucun message, une recherche toutes les 5 secondes, 100 par jour et par compte au plus. Désactivée tant que vous ne l'avez pas confirmée à Kevin."
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="prospectAccountSearch" value={accountSearchBadge(account)} />
            <span className="text-note">
              Aujourd&apos;hui : {fmtNum(account.today)} recherche{account.today > 1 ? "s" : ""}
              {account.perAccount.length ? ` (${account.perAccount.map((a) => `${a.account} : ${fmtNum(a.count)} / ${fmtNum(account.capPerAccount)}`).join(", ")})` : ""}
            </span>
          </div>
          {account.flood ? (
            <p className="text-note text-destructive">
              Telegram a demandé de ralentir le {fmtDate(account.flood.at)}
              {account.flood.seconds ? ` (attente de ${fmtNum(account.flood.seconds)} secondes)` : ""} : la recherche s&apos;est arrêtée d&apos;elle-même et Kevin vous a prévenu.
            </p>
          ) : null}
          {account.enabled ? (
            <form action={stopAccountSearchAction}>
              <input type="hidden" name="back" value={back} />
              <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                Couper la recherche par compte
              </Button>
            </form>
          ) : (
            <p className="text-note text-muted-foreground">Pour l&apos;activer, écrivez à Kevin « active la recherche par compte » : il vous explique et vous demande de confirmer.</p>
          )}
        </div>
      </FormSection>
    </div>
  );
}
