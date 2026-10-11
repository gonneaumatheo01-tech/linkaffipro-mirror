"use client";

import { useState } from "react";
import { CircleCheck, Link2, X } from "lucide-react";
import { FormSection } from "@/components/admin/form-section";
import { OfferPicker, type AffiliateOption } from "@/components/campaigns/offer-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";
import {
  DEFAULT_TEXT_OFFER_LABEL,
  TEXT_OFFER_LABEL_MAX,
  textOfferLabelError,
} from "@/lib/posts/offer-link";

export type CreateTextOfferLink = (input: {
  campaignId?: string;
  affiliateCampaignId?: string;
  label: string;
}) => Promise<{ ok: true; html: string; url: string } | { ok: false; error: string }>;

/**
 * « Offre dans le texte » (phase 12, D10) : un message publié par le compte Telegram connecté n'a pas de boutons ;
 * l'offre d'une campagne s'ajoute à la fin du texte comme un lien traqué (clics comptés, sans identifiant de suivi par
 * membre). Le lien est créé tout de suite (campagne et offre vérifiées), puis rattaché au message à l'enregistrement.
 */
export function TextOfferLink({
  campaigns,
  campaignOptions,
  versions,
  createLink,
  onInsert,
  onClose,
}: {
  /** Offres Link Affi actives (nom d'une ancienne offre). */
  campaigns: AffiliateOption[];
  campaignOptions?: CampaignOptionWithOffers[];
  /** Versions qui peuvent recevoir le lien (test A/B : A et B). */
  versions: ReadonlyArray<"A" | "B">;
  createLink: CreateTextOfferLink;
  onInsert: (version: "A" | "B", html: string) => void;
  onClose: () => void;
}) {
  const [offer, setOffer] = useState<{ campaignId?: string; affiliateCampaignId?: string }>({});
  const [label, setLabel] = useState(DEFAULT_TEXT_OFFER_LABEL);
  const [version, setVersion] = useState<"A" | "B">(versions[0] ?? "A");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function add() {
    setDone(null);
    const labelError = textOfferLabelError(label);
    if (labelError) return setError(labelError);
    if (!offer.campaignId) return setError("Choisissez la campagne de l'offre.");
    if (!offer.affiliateCampaignId) return setError("Choisissez l'offre de la campagne.");
    setPending(true);
    setError(null);
    try {
      const r = await createLink({ ...offer, label });
      if (!r.ok) return setError(r.error);
      const target = versions.includes(version) ? version : "A";
      onInsert(target, r.html);
      setDone(
        `Lien « ${label.trim()} » ajouté à la fin du texte${versions.length > 1 ? ` (version ${target})` : ""} : ses clics seront comptés.`,
      );
    } catch {
      setError("Lien impossible à créer : réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative rounded-xl border border-border bg-card p-4 md:p-6">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Fermer « Offre dans le texte »"
        className="absolute top-3 right-3"
        onClick={onClose}
      >
        <X aria-hidden />
      </Button>
      <FormSection
        title="Offre dans le texte"
        description="Un lien vers l'offre d'une campagne, ajouté à la fin du texte. Les clics sont comptés (sans identifiant de suivi par membre)."
        className="[&>div:first-child]:pr-10"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-body font-medium">Campagne et offre</p>
            <OfferPicker
              value={offer}
              onChange={(patch) => {
                setOffer(patch);
                setError(null);
              }}
              campaigns={campaignOptions}
              affiliateCampaigns={campaigns}
              label="Campagne de l'offre du lien"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="text-offer-label">Texte du lien</Label>
            <Input
              id="text-offer-label"
              value={label}
              maxLength={TEXT_OFFER_LABEL_MAX}
              onChange={(e) => {
                setLabel(e.target.value);
                setError(null);
              }}
            />
          </div>
        </div>
        {versions.length > 1 ? (
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-body">
            <legend className="mb-1 font-medium">Dans quel texte ?</legend>
            {versions.map((v) => (
              <label key={v} className="flex items-center gap-2 max-md:min-h-10">
                <input
                  type="radio"
                  name="textOfferVersion"
                  checked={version === v}
                  onChange={() => setVersion(v)}
                  className="size-4 accent-brand"
                />
                Version {v}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={pending} onClick={() => void add()}>
            <Link2 aria-hidden />
            {pending ? "Création du lien…" : "Ajouter au texte"}
          </Button>
          <p aria-live="polite" className="min-w-0 flex-1 text-note">
            {error ? (
              <span className="font-medium text-danger">{error}</span>
            ) : done ? (
              <span className="inline-flex items-start gap-1.5 text-foreground">
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                {done}
              </span>
            ) : null}
          </p>
        </div>
      </FormSection>
    </div>
  );
}
