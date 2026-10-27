import { decideDictAction, proposeDictAction } from "@/app/(admin)/agents/prospection/actions";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { countryName } from "@/lib/agents/analyses";
import { BRAND_STATUSES, BRAND_TYPES, DICT_KINDS, DICT_KIND_LABELS, proposalText, type DictProposal, type DictView } from "@/lib/agents/prospection/dict";
import { languageName } from "@/lib/agents/prospection/display";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

const TYPE_LABEL: Record<string, string> = { bookmaker: "bookmaker", casino: "casino", both: "casino et paris" };

function Words({ title, list }: { title: string; list: string[] }) {
  return (
    <div className="space-y-1">
      <p className="text-note font-medium">
        {title} ({fmtNum(list.length)})
      </p>
      <p className="text-note break-words text-muted-foreground">{list.join(" · ") || "—"}</p>
    </div>
  );
}

function ByLanguage({ title, map }: { title: string; map: Record<string, string[]> }) {
  const langs = Object.keys(map).sort();
  return (
    <AdvancedSection title={title} description={`${fmtNum(langs.length)} langues`}>
      <ul className="space-y-1">
        {langs.map((l) => (
          <li key={l} className="text-note">
            <span className="font-medium">{languageName(l)} :</span> <span className="text-muted-foreground">{map[l]!.join(" · ")}</span>
          </li>
        ))}
      </ul>
    </AdvancedSection>
  );
}

/**
 * Vue « Marques et repères » : ce que l'équipe reconnaît dans un canal (marques par pays, repères de liens
 * d'affiliation, raccourcisseurs, mots qui annoncent un code promo ou un contact). Tout le monde peut proposer un
 * ajout ; il ne sert qu'après validation d'un administrateur (jamais d'ajout silencieux).
 */
export function DictionariesView({ view, proposals, isAdmin }: { view: DictView; proposals: DictProposal[]; isAdmin: boolean }) {
  const pending = proposals.filter((p) => p.status === "PENDING");
  const byCountry = new Map<string, typeof view.brands>();
  for (const b of view.brands) byCountry.set(b.country, [...(byCountry.get(b.country) ?? []), b]);
  return (
    <div className="space-y-6">
      <FormSection id="propositions" title="Propositions d'ajout" description={pending.length ? `${fmtNum(pending.length)} à valider.` : "Aucune proposition en attente."}>
        <form action={proposeDictAction} className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="dict-kind">Ajouter</Label>
            <NativeSelect id="dict-kind" name="kind" defaultValue="brand" wrapperClassName="w-full">
              {DICT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DICT_KIND_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="dict-value">Valeur</Label>
            <Input id="dict-value" name="value" required maxLength={80} placeholder="Celsius, ref, /aff/, bit.ly, code promo…" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dict-country">Marque : pays</Label>
            <Input id="dict-country" name="country" maxLength={6} placeholder="FR ou GLOBAL" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dict-type">Marque : genre</Label>
            <NativeSelect id="dict-type" name="brandType" defaultValue="both" wrapperClassName="w-full">
              {BRAND_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="dict-status">Marque : licence</Label>
            <NativeSelect id="dict-status" name="brandStatus" defaultValue="local" wrapperClassName="w-full">
              {BRAND_STATUSES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="dict-lang">Mot : langue</Label>
            <Input id="dict-lang" name="language" maxLength={2} placeholder="fr, it, de…" />
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="dict-note">Pourquoi (facultatif)</Label>
            <Input id="dict-note" name="note" maxLength={300} />
          </div>
          <div className="flex items-end">
            <Button type="submit" size="sm" className="max-md:h-10">
              Proposer
            </Button>
          </div>
        </form>
        {proposals.length ? (
          <ul className="mt-4 space-y-2">
            {proposals.slice(0, 50).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-2">
                <StatusBadge kind="dictProposal" value={p.status} />
                <span className="text-body">{proposalText(p)}</span>
                <span className="text-note text-muted-foreground">
                  proposé le {fmtDate(new Date(p.proposedAt))}
                  {p.proposedVia === "TELEGRAM" ? " par Kevin" : ""}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
                {isAdmin && p.status === "PENDING" ? (
                  <span className="ml-auto flex gap-2">
                    <form action={decideDictAction}>
                      <input type="hidden" name="proposalId" value={p.id} />
                      <input type="hidden" name="decision" value="APPROVED" />
                      <Button type="submit" size="sm" variant="secondary" className="max-md:h-10">
                        Valider
                      </Button>
                    </form>
                    <form action={decideDictAction}>
                      <input type="hidden" name="proposalId" value={p.id} />
                      <input type="hidden" name="decision" value="REJECTED" />
                      <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                        Refuser
                      </Button>
                    </form>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!isAdmin && pending.length ? <p className="mt-2 text-note text-muted-foreground">Seuls les administrateurs valident ou refusent une proposition.</p> : null}
      </FormSection>

      <FormSection title="Marques reconnues" description={`${fmtNum(view.brands.length)} marques. « Hors licence locale » : souvent le signe d'une audience hors Europe.`}>
        <div className="space-y-2">
          {[...byCountry.entries()].map(([country, list]) => (
            <AdvancedSection key={country} title={country === "GLOBAL" ? "Marques internationales" : countryName(country)} description={`${list.length} marques`}>
              <ul className="space-y-1">
                {list.map((b) => (
                  <li key={b.name} className="text-note">
                    <span className="font-medium">{b.name}</span>{" "}
                    <span className="text-muted-foreground">
                      {TYPE_LABEL[b.type] ?? b.type} · {b.status === "offshore" ? "hors licence locale" : "licence du pays"}
                      {b.offshoreNonEu ? " · audience souvent hors Europe" : ""}
                      {b.added ? " · ajoutée par l'équipe" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </AdvancedSection>
          ))}
        </div>
      </FormSection>

      <FormSection title="Repères des liens d'affiliation" description="Ce qui fait reconnaître un lien d'affiliation dans un post (avec une marque connue ou un raccourcisseur).">
        <div className="space-y-3">
          <Words title="Après « ? » dans l'adresse" list={view.queryParams} />
          <Words title="Dans le chemin de l'adresse" list={view.pathMarkers} />
          <Words title="Raccourcisseurs de liens" list={view.shorteners} />
          <ByLanguage title="Mots qui annoncent un code promo" map={view.promoCodeLabels} />
          <ByLanguage title="Mots qui annoncent un contact" map={view.contactLabels} />
        </div>
      </FormSection>
    </div>
  );
}
