import { HandCoins } from "lucide-react";
import { saveOfferAction, toggleOfferAction } from "@/app/(admin)/agents/prospection/actions";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { VERTICAL_LABELS } from "@/lib/agents/prospection/display";
import { OFFER_VERTICALS, dealText, dealTypesOf, offerCountriesText } from "@/lib/agents/prospection/offers";
import type { OfferRow } from "@/lib/agents/prospection/queries";
import { fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

type OfferFormValues = { id?: string; brand?: string; vertical?: string; countries?: string; cpa?: number; revshare?: number; hybridCpa?: number; hybridRevshare?: number; trackingHint?: string | null; notes?: string | null };

function OfferForm({ v, idp, submit }: { v: OfferFormValues; idp: string; submit: string }) {
  const f = (name: string) => `${idp}-${name}`;
  return (
    <form action={saveOfferAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {v.id ? <input type="hidden" name="offerId" value={v.id} /> : null}
      <div className="space-y-1">
        <Label htmlFor={f("brand")}>Marque</Label>
        <Input id={f("brand")} name="brand" required maxLength={60} defaultValue={v.brand ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={f("vertical")}>Marché</Label>
        <NativeSelect id={f("vertical")} name="vertical" defaultValue={v.vertical ?? "SPORTS"} wrapperClassName="w-full">
          {OFFER_VERTICALS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={f("countries")}>Pays acceptés</Label>
        <Input id={f("countries")} name="countries" required defaultValue={v.countries ?? ""} placeholder="FR, BE, CH" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={f("cpa")}>Prime par joueur (€)</Label>
        <Input id={f("cpa")} name="cpa" inputMode="decimal" defaultValue={v.cpa ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={f("revshare")}>Part du revenu (%)</Label>
        <Input id={f("revshare")} name="revshare" inputMode="decimal" defaultValue={v.revshare ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={f("hcpa")}>Mixte : prime (€)</Label>
        <Input id={f("hcpa")} name="hybridCpa" inputMode="decimal" defaultValue={v.hybridCpa ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={f("hrev")}>Mixte : part (%)</Label>
        <Input id={f("hrev")} name="hybridRevshare" inputMode="decimal" defaultValue={v.hybridRevshare ?? ""} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={f("hint")}>Motif de nos liens (facultatif)</Label>
        <Input id={f("hint")} name="trackingHint" maxLength={200} defaultValue={v.trackingHint ?? ""} placeholder="celsius.example/aff" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={f("notes")}>Notes (facultatif)</Label>
        <Textarea id={f("notes")} name="notes" maxLength={1000} rows={2} defaultValue={v.notes ?? ""} />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" className="max-md:h-10">
          {submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * Vue « Vos offres » : les offres que vous proposez aux affiliés (marque, marché, pays acceptés, prime par joueur, part
 * du revenu, mixte). Elles servent à noter les canaux qui y correspondent ; rien n'est envoyé à personne.
 */
export function OffersView({ offers }: { offers: OfferRow[] }) {
  return (
    <div id="offres" className="space-y-6">
      <FormSection title="Ajouter une offre" description="Donnez au moins une condition. Les montants sont en euros.">
        <OfferForm v={{}} idp="offer-new" submit="Ajouter l'offre" />
      </FormSection>
      <FormSection
        title="Vos offres"
        description={offers.length ? `${fmtNum(offers.filter((o) => o.isActive).length)} active(s) sur ${fmtNum(offers.length)}.` : undefined}
      >
        {!offers.length ? (
          <EmptyState
            icon={<HandCoins />}
            title="Aucune offre pour l'instant"
            description="Sans offre, les canaux sont notés sur l'Europe et le marché seulement. Ajoutez-en une ici, ou écrivez à Kevin « ajoute une offre : Celsius, FR BE, prime par joueur 120 »."
          />
        ) : (
          <ul className="space-y-3">
            {offers.map((o) => {
              const d = dealTypesOf(o.dealTypes);
              const countries = Array.isArray(o.countries) ? (o.countries as string[]).join(", ") : "";
              return (
                <li key={o.id} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{o.brand}</span>
                    <StatusBadge kind="active" value={o.isActive ? "active" : "inactive"} />
                    <span className="text-note text-muted-foreground">{VERTICAL_LABELS[o.vertical] ?? o.vertical}</span>
                  </div>
                  <p className="text-body">{dealText(o.dealTypes)}</p>
                  <p className="text-note text-muted-foreground">
                    {offerCountriesText(o.countries)} · {fmtNum(o.matchedCount)} canal{o.matchedCount > 1 ? "ux" : ""} qui y correspond{o.matchedCount > 1 ? "ent" : ""}
                  </p>
                  {o.notes ? <p className="text-note text-muted-foreground">{o.notes}</p> : null}
                  <div className="flex flex-wrap items-start gap-2">
                    <form action={toggleOfferAction}>
                      <input type="hidden" name="offerId" value={o.id} />
                      <input type="hidden" name="active" value={o.isActive ? "off" : "on"} />
                      <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                        {o.isActive ? "Désactiver" : "Réactiver"}
                      </Button>
                    </form>
                    <details className="w-full">
                      <summary className="cursor-pointer text-note text-info underline underline-offset-4">Modifier</summary>
                      <div className="mt-3">
                        <OfferForm
                          v={{ id: o.id, brand: o.brand, vertical: o.vertical, countries, cpa: d.cpa, revshare: d.revshare, hybridCpa: d.hybrid?.cpa, hybridRevshare: d.hybrid?.revshare, trackingHint: o.trackingHint, notes: o.notes }}
                          idp={`offer-${o.id}`}
                          submit="Enregistrer"
                        />
                      </div>
                    </details>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </FormSection>
    </div>
  );
}
