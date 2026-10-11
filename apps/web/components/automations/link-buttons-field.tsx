"use client";

import { useId } from "react";
import { Link2, Tag, X } from "lucide-react";
import { OfferPicker } from "@/components/campaigns/offer-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { BUTTON_TYPE_LABELS } from "@/lib/posts/buttons";
import {
  MAX_BUTTONS,
  entriesToButtons,
  isOfferEntry,
  type ButtonEntry,
} from "@/lib/automations/node-form";

/** Les deux sortes de boutons d'un message de relance (mêmes mots que le formulaire de message). */
const KINDS = [
  { value: "offer", label: BUTTON_TYPE_LABELS.OFFER },
  { value: "link", label: BUTTON_TYPE_LABELS.URL },
] as const;

/** Libellé proposé pour un nouveau bouton Offre (modifiable). */
export const DEFAULT_OFFER_LABEL = "Voir l'offre";

/**
 * Boutons sous un message de relance, un bouton par ligne (10 au plus) :
 * - « Offre (campagne) » : on choisit notre campagne puis son offre (même choix que le formulaire de message,
 *   `OfferPicker`) ; à l'envoi, chaque membre reçoit son propre identifiant de suivi, et ses inscriptions, premiers
 *   dépôts et commissions sont attribués à la relance ;
 * - « Lien direct » : une adresse qui commence par https://.
 * La ligne fautive est signalée sous ses champs. Forme enregistrée : voir `entriesToButtons`.
 */
export function LinkButtonsField({
  entries,
  onChange,
  legend = "Boutons sous le message",
}: {
  entries: ButtonEntry[];
  onChange: (next: ButtonEntry[]) => void;
  legend?: string;
}) {
  const uid = useId();
  const check = entriesToButtons(entries);
  const bad = check.ok ? null : check;
  const set = (i: number, patch: Partial<ButtonEntry>) =>
    onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const full = entries.length >= MAX_BUTTONS;
  return (
    <fieldset className="space-y-2">
      <legend className="text-body font-medium text-foreground">{legend}</legend>
      <p id={`${uid}-help`} className="text-note text-muted-foreground">
        Offre : chaque membre reçoit son propre identifiant de suivi, ses inscriptions et premiers
        dépôts sont attribués à la relance. Lien direct : une adresse qui commence par https://.
      </p>
      {entries.length ? (
        <ul className="space-y-2">
          {entries.map((e, i) => {
            const wrong = bad?.index === i;
            const offer = isOfferEntry(e);
            const labelWrong = wrong && !e.text.trim();
            const targetWrong = wrong && !labelWrong;
            const errId = `${uid}-err-${i}`;
            const describedBy = wrong ? errId : `${uid}-help`;
            return (
              <li key={i} className="space-y-2 rounded-lg border border-border p-2">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <NativeSelect
                    aria-label={`Sorte du bouton ${i + 1}`}
                    value={offer ? "offer" : "link"}
                    wrapperClassName="w-full"
                    onChange={(ev) =>
                      set(
                        i,
                        ev.target.value === "offer"
                          ? { kind: "offer", url: "", text: e.text || DEFAULT_OFFER_LABEL }
                          : {
                              kind: undefined,
                              campaignId: undefined,
                              affiliateCampaignId: undefined,
                            },
                      )
                    }
                  >
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="self-center max-md:size-10"
                    aria-label={`Retirer le bouton ${i + 1}`}
                    title="Retirer ce bouton"
                    onClick={() => onChange(entries.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
                <Input
                  value={e.text}
                  maxLength={64}
                  placeholder="Libellé"
                  aria-label={`Libellé du bouton ${i + 1}`}
                  aria-invalid={labelWrong || undefined}
                  aria-describedby={describedBy}
                  onChange={(ev) => set(i, { text: ev.target.value })}
                />
                {offer ? (
                  <OfferPicker
                    value={{ campaignId: e.campaignId, affiliateCampaignId: e.affiliateCampaignId }}
                    onChange={(patch) =>
                      set(i, {
                        campaignId: patch.campaignId,
                        affiliateCampaignId: patch.affiliateCampaignId,
                      })
                    }
                    affiliateCampaigns={[]}
                    label={`Campagne du bouton ${i + 1}`}
                  />
                ) : (
                  <Input
                    value={e.url}
                    inputMode="url"
                    placeholder="https://…"
                    aria-label={`Adresse du bouton ${i + 1}`}
                    aria-invalid={targetWrong || undefined}
                    aria-describedby={describedBy}
                    onChange={(ev) => set(i, { url: ev.target.value })}
                  />
                )}
                {wrong ? (
                  <p id={errId} className="text-note text-danger">
                    {bad.error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="max-md:h-10"
          disabled={full}
          onClick={() =>
            onChange([...entries, { kind: "offer", text: DEFAULT_OFFER_LABEL, url: "" }])
          }
        >
          <Tag aria-hidden />
          Ajouter un bouton Offre
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="max-md:h-10"
          disabled={full}
          onClick={() => onChange([...entries, { text: "", url: "" }])}
        >
          <Link2 aria-hidden />
          Ajouter un lien
        </Button>
      </div>
      {full ? (
        <p className="text-note text-muted-foreground">
          {MAX_BUTTONS} boutons au plus sous un message.
        </p>
      ) : null}
    </fieldset>
  );
}
