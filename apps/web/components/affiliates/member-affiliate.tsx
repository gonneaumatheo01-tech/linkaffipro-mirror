import { Pencil } from "lucide-react";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { SidePanel } from "@/components/admin/side-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { REASON_MAX, REASON_MIN } from "@/lib/affiliates/attribution";
import {
  affiliateLabel,
  attributionState,
  broughtBySentence,
  campaignLabel,
  type AffiliateCampaignRef,
} from "@/lib/affiliates/scope";
import { fmtDateShort } from "@/lib/format";

/** Affilié d'un membre, tel que la fiche le lit (`Member` et son lien LINKAFFI d'attribution). */
export type MemberAffiliateView = {
  linkaffiCampaignKey: string | null;
  linkaffiAffiliateId: string | null;
  affiliateAttributedAt: Date | null;
  affiliateAttributionEndsAt: Date | null;
  affiliateInviteLinkId: string | null;
  link: {
    campaignName: string | null;
    campaignKey: string | null;
    affiliateName: string | null;
    channelTitle: string;
  } | null;
};

/** Phrase de la fiche : « Amené par Paul · campagne Casino VIP · le 12 oct. 2026 » (+ durée), ou null. */
export function memberAffiliateText(m: MemberAffiliateView, now: Date): string | null {
  if (!m.linkaffiCampaignKey && !m.linkaffiAffiliateId) return null;
  const sentence = broughtBySentence({
    affiliateLabel: affiliateLabel(m.linkaffiAffiliateId, m.link?.affiliateName ?? null),
    campaignLabel: m.linkaffiCampaignKey
      ? campaignLabel({
          campaignName: m.link?.campaignName ?? null,
          campaignKey: m.linkaffiCampaignKey,
        })
      : null,
    attributedAtText: m.affiliateAttributedAt ? fmtDateShort(m.affiliateAttributedAt, now) : null,
  });
  const state = attributionState(m, now);
  if (state.kind === "until") return `${sentence} · jusqu'au ${fmtDateShort(state.endsAt, now)}`;
  if (state.kind === "ended")
    return `${sentence} · attribution terminée le ${fmtDateShort(state.endsAt, now)}`;
  return sentence;
}

/** Choix « campagne d'affilié » : « Paul — Casino VIP (canal Casino VIP) », campagnes actives d'abord. */
function campaignChoice(c: AffiliateCampaignRef): string {
  const off = c.isActive ? "" : " — désactivée";
  return `${affiliateLabel(c.affiliateId, c.affiliateName)} — ${campaignLabel(c)} (canal ${c.channelTitle})${off}`;
}

/**
 * Affilié Link Affi d'un membre (fiche membre, phase 13) : « Amené par … » ; un ADMIN peut le corriger (volet :
 * rattacher à une autre campagne d'affilié existante, ou retirer l'affilié), avec un motif obligatoire, gardé dans le
 * journal. Les autres rôles lisent seulement.
 */
export function MemberAffiliate({
  memberId,
  view,
  now,
  canEdit,
  campaigns,
  changeAction,
  removeAction,
}: {
  memberId: string;
  view: MemberAffiliateView;
  now: Date;
  /** ADMIN, membre non anonymisé. */
  canEdit: boolean;
  /** Campagnes d'affiliés existantes (choix du volet). */
  campaigns: readonly AffiliateCampaignRef[];
  changeAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
}) {
  const text = memberAffiliateText(view, now);
  const attributed = text !== null;
  const choices = [...campaigns]
    .filter((c) => c.inviteLinkId !== view.affiliateInviteLinkId)
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        campaignChoice(a).localeCompare(campaignChoice(b), "fr"),
    );
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <p className={attributed ? "min-w-0" : "min-w-0 text-muted-foreground"}>
        {text ?? "Aucun : il n'est pas venu par le lien d'un affilié."}
      </p>
      {canEdit && (attributed || choices.length > 0) ? (
        <SidePanel
          size="md"
          title="Affilié Link Affi de ce membre"
          description="Corrigez l'affilié qui a amené ce membre. Le motif est gardé dans le journal."
          trigger={
            <Button variant="ghost" size="sm" className="-my-1 max-md:h-10">
              <Pencil aria-hidden />
              Corriger
            </Button>
          }
        >
          <div className="space-y-8">
            <p className="text-body text-muted-foreground">
              {text ??
                "Ce membre n'est rattaché à aucun affilié. Rattachez-le seulement s'il a bien été amené par l'affilié."}
            </p>
            {choices.length > 0 ? (
              <form action={changeAction} className="space-y-4">
                <input type="hidden" name="memberId" value={memberId} />
                <h3 className="text-body font-semibold text-foreground">
                  {attributed ? "Changer d'affilié" : "Rattacher à un affilié"}
                </h3>
                <div className="space-y-1.5">
                  <Label htmlFor="affiliate-campaign">Campagne d&apos;affilié</Label>
                  <NativeSelect
                    id="affiliate-campaign"
                    name="inviteLinkId"
                    required
                    defaultValue=""
                    wrapperClassName="w-full"
                  >
                    <option value="" disabled>
                      Choisissez…
                    </option>
                    {choices.map((c) => (
                      <option key={c.inviteLinkId} value={c.inviteLinkId}>
                        {campaignChoice(c)}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-note text-muted-foreground">
                    Ses prochains clics sur une offre seront crédités à cet affilié, pour la durée
                    de sa campagne.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="affiliate-change-reason">Motif</Label>
                  <Textarea
                    id="affiliate-change-reason"
                    name="reason"
                    required
                    minLength={REASON_MIN}
                    maxLength={REASON_MAX}
                    rows={2}
                    placeholder="Ex. : erreur de lien signalée par l'affilié"
                  />
                </div>
                <Button type="submit" variant="outline" className="max-md:h-10">
                  {attributed ? "Changer d'affilié" : "Rattacher"}
                </Button>
              </form>
            ) : null}
            {attributed ? (
              <form action={removeAction} className="space-y-4 border-t border-border pt-6">
                <input type="hidden" name="memberId" value={memberId} />
                <h3 className="text-body font-semibold text-foreground">Retirer l&apos;affilié</h3>
                <p className="text-note text-muted-foreground">
                  Le membre ne sera plus suivi pour aucun affilié : ses prochains clics sur une
                  offre ne seront plus crédités.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="affiliate-remove-reason">Motif</Label>
                  <Textarea
                    id="affiliate-remove-reason"
                    name="reason"
                    required
                    minLength={REASON_MIN}
                    maxLength={REASON_MAX}
                    rows={2}
                    placeholder="Ex. : membre déjà présent avant la campagne"
                  />
                </div>
                <ConfirmSubmit
                  variant="destructive"
                  className="max-md:h-10"
                  confirmTitle="Retirer l'affilié de ce membre ?"
                  message="Le membre ne sera plus rattaché à aucun affilié. Vous pourrez le rattacher de nouveau à une campagne."
                  confirmLabel="Retirer l'affilié"
                  destructive
                >
                  Retirer l&apos;affilié
                </ConfirmSubmit>
              </form>
            ) : null}
          </div>
        </SidePanel>
      ) : null}
    </div>
  );
}
