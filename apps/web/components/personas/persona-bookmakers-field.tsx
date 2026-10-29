"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  MAX_BOOKMAKER_LABEL,
  MAX_PERSONA_BOOKMAKERS,
  emptyBookmakerDraft,
  type PersonaBookmakerDraft,
} from "@/lib/personas/bookmakers";
import type { ChoiceGroup, OfferChoice, VipLinkChoice } from "@/lib/personas/view";
import { cn } from "@/lib/utils";

/**
 * Bookmakers partenaires d'une persona Paris sportifs (bot VIP) : pour chacun, son nom, l'offre Link Affi du lien
 * d'inscription et le lien du canal VIP envoyé quand la personne confirme son dépôt. L'ordre de la liste est l'ordre de
 * proposition (flèches pour le changer). La valeur part avec le brouillon du formulaire ; le serveur vérifie tout.
 */
export function PersonaBookmakersField({
  value,
  onChange,
  offerGroups,
  offers,
  vipLinks,
  error,
}: {
  value: PersonaBookmakerDraft[];
  onChange: (v: PersonaBookmakerDraft[]) => void;
  offerGroups: ChoiceGroup[];
  offers: OfferChoice[];
  vipLinks: VipLinkChoice[];
  error?: string | undefined;
}) {
  const update = (i: number, patch: Partial<PersonaBookmakerDraft>) =>
    onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const move = (i: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [row] = next.splice(i, 1);
    if (row) next.splice(to, 0, row);
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <FormSection
      title="Bookmakers partenaires"
      description="Proposés dans cet ordre : le premier d'abord, le suivant si la personne a déjà un compte dessus. Chacun a son lien d'inscription (l'offre Link Affi) et le lien de son canal VIP, envoyé quand la personne confirme son dépôt."
    >
      {value.length === 0 ? (
        <p className="text-note text-muted-foreground">
          Aucun bookmaker : la persona utilise l&apos;offre ci-dessus, sans lien de canal VIP.
        </p>
      ) : (
        <ol className="space-y-4">
          {value.map((b, i) => {
            const n = i + 1;
            const offer = offers.find((o) => o.id === b.affiliateCampaignId) ?? null;
            const link = vipLinks.find((l) => l.id === b.inviteLinkId) ?? null;
            const offerWarning =
              offer && !offer.isActive
                ? "Cette offre n'est plus active chez Link Affi : aucun lien ne partira."
                : null;
            const linkNote = !b.inviteLinkId
              ? "Sans lien VIP, le bouton du canal VIP ne part pas après le dépôt."
              : link && !link.isActive
                ? "Ce lien a été révoqué : choisissez-en un autre."
                : link
                  ? link.url
                  : null;
            return (
              <li key={i} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-body font-semibold text-foreground">
                    {n}. {b.label.trim() || "Nouveau bookmaker"}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Monter le bookmaker ${n}`}
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Descendre le bookmaker ${n}`}
                      disabled={i === value.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Retirer le bookmaker ${n}`}
                      onClick={() => remove(i)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`book-${i}-label`}>Nom</Label>
                  <Input
                    id={`book-${i}-label`}
                    value={b.label}
                    maxLength={MAX_BOOKMAKER_LABEL}
                    placeholder="Celsius Casino"
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`book-${i}-offer`}>
                    Offre Link Affi (lien d&apos;inscription)
                  </Label>
                  <NativeSelect
                    id={`book-${i}-offer`}
                    value={b.affiliateCampaignId}
                    onChange={(e) => update(i, { affiliateCampaignId: e.target.value })}
                    wrapperClassName="w-full"
                    aria-describedby={`book-${i}-offer-help`}
                  >
                    <option value="">Choisir l&apos;offre…</option>
                    {offerGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </NativeSelect>
                  <p
                    id={`book-${i}-offer-help`}
                    className={cn(
                      "text-note",
                      offerWarning ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {offerWarning ?? "Le bouton d'inscription envoyé pour ce bookmaker."}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`book-${i}-vip`}>Lien du canal VIP</Label>
                  <NativeSelect
                    id={`book-${i}-vip`}
                    value={b.inviteLinkId}
                    onChange={(e) => update(i, { inviteLinkId: e.target.value })}
                    wrapperClassName="w-full"
                    aria-describedby={`book-${i}-vip-help`}
                  >
                    <option value="">Aucun lien</option>
                    {vipLinks.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.isActive ? l.label : `${l.label} (révoqué)`}
                      </option>
                    ))}
                  </NativeSelect>
                  <p
                    id={`book-${i}-vip-help`}
                    className={cn(
                      "text-note break-all",
                      link && !link.isActive ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {linkNote ??
                      "Un lien d'invitation du canal VIP, créé dans la fiche du canal (Liens de partage)."}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {error ? (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      ) : null}
      {value.length < MAX_PERSONA_BOOKMAKERS ? (
        <Button
          type="button"
          variant="outline"
          className="max-md:h-10"
          onClick={() => onChange([...value, emptyBookmakerDraft()])}
        >
          <Plus aria-hidden />
          Ajouter un bookmaker
        </Button>
      ) : null}
    </FormSection>
  );
}
