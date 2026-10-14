import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Term } from "@/components/admin/help-tip";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { attributionText } from "@/lib/affiliates/csv";
import type { AffiliateFigures, CampaignView } from "@/lib/affiliates/figures";
import { fmtDate, fmtDateShort, fmtMoney, fmtNum } from "@/lib/format";

/** « 12 » ou « — » (clics Link Affi pas encore connus). */
export function clicksText(n: number | null): string {
  return n === null ? "—" : fmtNum(n);
}

/** Les chiffres d'une campagne ou d'un affilié, dans l'ordre du parcours (définitions : lib/affiliates/figures.ts). */
export function FiguresList({ f }: { f: AffiliateFigures }) {
  return (
    <DetailList>
      <DetailRow label="Clics (Link Affi, depuis le début)">{clicksText(f.clicks)}</DetailRow>
      <DetailRow label="Demandes pour rejoindre">{fmtNum(f.requests)}</DetailRow>
      <DetailRow label="Acceptés">{fmtNum(f.approved)}</DetailRow>
      <DetailRow label="Présents en ce moment">{fmtNum(f.present)}</DetailRow>
      <DetailRow label="Partis">{fmtNum(f.left)}</DetailRow>
      <DetailRow label="Clics sur les offres">{fmtNum(f.offerClicks)}</DetailRow>
      <DetailRow label="Inscriptions">{fmtNum(f.registrations)}</DetailRow>
      <DetailRow label={<Term term="FTD">Premiers dépôts</Term>}>{fmtNum(f.ftds)}</DetailRow>
      <DetailRow label="Dépôts">
        {fmtMoney(f.depositAmount)}{" "}
        <span className="text-note text-muted-foreground">
          ({fmtNum(f.deposits)} dépôt{f.deposits > 1 ? "s" : ""})
        </span>
      </DetailRow>
      <DetailRow label={<Term term="NGR">Revenu net</Term>}>{fmtMoney(f.revenue)}</DetailRow>
    </DetailList>
  );
}

/**
 * Volet d'une campagne Telegram d'affilié : ce qu'elle est (affilié, canal, durée, état), ses chiffres de la période,
 * la liste dépliable de ses premiers dépôts (chaque membre ouvre sa fiche), et les liens vers ses membres.
 */
export function CampaignDetail({
  campaign,
  affiliateName,
  periodText,
  now,
}: {
  campaign: CampaignView;
  affiliateName: string;
  periodText: string;
  now: Date;
}) {
  const { ref, figures, ftdList } = campaign;
  return (
    <div className="space-y-6">
      <DetailList>
        <DetailRow label="Affilié">{affiliateName}</DetailRow>
        <DetailRow label="Canal">
          <Link
            href={`/channels/${ref.channelId}`}
            className="underline-offset-4 hover:underline max-md:inline-flex max-md:min-h-10 max-md:items-center"
          >
            {ref.channelTitle}
          </Link>
        </DetailRow>
        <DetailRow label="État">{ref.isActive ? "Active" : "Désactivée dans Link Affi"}</DetailRow>
        <DetailRow label="Durée d'attribution">{attributionText(ref.attributionDays)}</DetailRow>
        <DetailRow label="Créée le">{fmtDate(ref.createdAt)}</DetailRow>
        <DetailRow label="Clé de la campagne" mono>
          {ref.campaignKey}
        </DetailRow>
      </DetailList>

      <section aria-label={`Chiffres : ${periodText}`} className="space-y-3">
        <h3 className="text-body font-semibold text-foreground">{periodText}</h3>
        <FiguresList f={figures} />
      </section>

      {ftdList.length > 0 ? (
        <details className="group rounded-lg border border-border">
          <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-body font-medium">
            <span>
              Ses <Term term="FTD">premiers dépôts</Term> ({fmtNum(ftdList.length)})
            </span>
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            />
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {ftdList.map((f) => (
              <li
                key={f.playerId}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2"
              >
                <span className="min-w-0">
                  {f.memberId ? (
                    <Link
                      href={`/members/${f.memberId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {f.memberName}
                    </Link>
                  ) : (
                    <span className="font-medium">{f.memberName}</span>
                  )}
                  <span className="block text-note text-muted-foreground">
                    {f.offerName} · le {fmtDateShort(f.ftdAt, now)}
                  </span>
                </span>
                <span className="tabular-nums">{fmtMoney(f.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="text-note text-muted-foreground">Aucun premier dépôt sur la période.</p>
      )}

      {ref.affiliateId ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/members?${new URLSearchParams({ affiliateId: ref.affiliateId }).toString()}`}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            Les membres de {affiliateName}
          </Link>
          <Link
            href={`/stats?${new URLSearchParams({ affiliateId: ref.affiliateId }).toString()}`}
            className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
          >
            Ses statistiques
          </Link>
        </div>
      ) : null}
    </div>
  );
}
