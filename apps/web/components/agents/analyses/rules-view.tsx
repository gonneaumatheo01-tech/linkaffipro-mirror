import { Scale } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  COUNTRY_CODES,
  MARKETS,
  NOT_LEGAL_ADVICE,
  PLATFORMS,
  RISKS,
  RISK_ORDER,
  countryName,
  evidenceList,
  viewHref,
  type RuleFilters,
} from "@/lib/agents/analyses";
import type { RuleRow } from "@/lib/agents/analyses-queries";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { EvidenceList } from "./evidence-list";

const SELECT_LABEL = "text-note font-medium text-muted-foreground";

function RuleItem({ r }: { r: RuleRow }) {
  const evidence = evidenceList(r.evidence);
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="riskLevel" value={r.riskLevel} />
        <StatusBadge kind="compliancePlatform" value={r.platform} />
        <StatusBadge kind="vertical" value={r.market} />
        <span className="text-note text-muted-foreground">{countryName(r.country)}</span>
        {r.verified ? (
          <span className="text-note text-success">Vérifiée par plusieurs sources</span>
        ) : (
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-note text-muted-foreground" title="Une seule source, pas encore recoupée">
            Non vérifiée
          </span>
        )}
      </div>
      <p className="text-body text-foreground">{r.rule}</p>
      {r.workaround ? <p className="text-note text-foreground">Ce qui passe mieux : {r.workaround}</p> : null}
      <EvidenceList items={evidence} />
      <p className="text-note text-muted-foreground">Dernière vérification le {fmtDate(r.lastVerifiedAt)}</p>
    </li>
  );
}

/**
 * Vue « Règles publicitaires » : ce qui fait bannir ou passe chez Meta, TikTok… par pays et par marché, avec ses
 * preuves, vérifiée ou non, et la date de la dernière vérification. Jamais un avis juridique (mention fixe).
 */
export function RulesView({ filters, rows }: { filters: RuleFilters; rows: RuleRow[] }) {
  const filtered = Boolean(filters.platform || filters.country || filters.market || filters.risk);
  const sorted = [...rows].sort((a, b) => (RISK_ORDER[a.riskLevel] ?? 9) - (RISK_ORDER[b.riskLevel] ?? 9));
  const risky = rows.filter((r) => r.riskLevel === "HIGH" || r.riskLevel === "BAN").length;
  return (
    <div className="space-y-6">
      <p role="note" className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-body text-foreground">
        {NOT_LEGAL_ADVICE}
      </p>
      <form
        method="get"
        aria-label="Filtrer les règles publicitaires"
        className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-3 sm:items-end md:grid-cols-5 md:p-4"
      >
        <input type="hidden" name="vue" value="regles" />
        <div className="min-w-0 space-y-1">
          <Label htmlFor="rg-plateforme" className={SELECT_LABEL}>
            Plateforme
          </Label>
          <NativeSelect id="rg-plateforme" name="plateforme" defaultValue={filters.platform ?? ""} wrapperClassName="w-full">
            <option value="">Toutes</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {statusLabel("compliancePlatform", p)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="rg-pays" className={SELECT_LABEL}>
            Pays
          </Label>
          <NativeSelect id="rg-pays" name="pays" defaultValue={filters.country ?? ""} wrapperClassName="w-full">
            <option value="">Tous les pays</option>
            {COUNTRY_CODES.map((c) => (
              <option key={c} value={c}>
                {countryName(c)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="rg-marche" className={SELECT_LABEL}>
            Marché
          </Label>
          <NativeSelect id="rg-marche" name="marche" defaultValue={filters.market ?? ""} wrapperClassName="w-full">
            <option value="">Tous les marchés</option>
            {MARKETS.map((m) => (
              <option key={m} value={m}>
                {statusLabel("vertical", m)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="rg-risque" className={SELECT_LABEL}>
            Risque
          </Label>
          <NativeSelect id="rg-risque" name="risque" defaultValue={filters.risk ?? ""} wrapperClassName="w-full">
            <option value="">Tous</option>
            {RISKS.map((r) => (
              <option key={r} value={r}>
                {statusLabel("riskLevel", r)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" className="max-md:h-10">
          Filtrer
        </Button>
      </form>

      <FormSection
        title="Règles publicitaires"
        description={
          rows.length
            ? `${fmtNum(rows.length)} règle${rows.length > 1 ? "s" : ""}${risky ? ` · ${fmtNum(risky)} à risque élevé ou qui font bannir` : ""}. Les plus risquées d'abord.`
            : undefined
        }
      >
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Scale />}
            title={filtered ? "Aucune règle pour ces filtres" : "Pas encore de règle"}
            description={
              filtered
                ? "Une règle « tous les pays » apparaît pour chaque pays. Essayez une autre plateforme ou un autre marché."
                : "L'équipe construit la base à partir des pages officielles de Meta et TikTok et des retours des forums."
            }
            action={filtered ? { href: viewHref("regles"), label: "Effacer les filtres", variant: "outline" } : undefined}
          />
        ) : (
          <ul className="space-y-3">
            {sorted.map((r) => (
              <RuleItem key={r.id} r={r} />
            ))}
          </ul>
        )}
      </FormSection>
    </div>
  );
}
