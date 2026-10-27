import Link from "next/link";
import { addProspectNoteAction, setProspectStatusAction } from "@/app/(admin)/agents/prospection/actions";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { NOT_LEGAL_ADVICE, countryName } from "@/lib/agents/analyses";
import {
  AUTHENTICITY_LABELS,
  COMPETITION_LABELS,
  CONTACT_TYPE_LABELS,
  CONTENT_TYPE_LABELS,
  DEAL_TYPE_LABELS,
  FAKE_FLAG_LABELS,
  INTENSITY_LABELS,
  RISK_FLAG_LABELS,
  SOURCE_TYPE_LABELS,
  VERTICAL_LABELS,
  brandList,
  breakdownBars,
  channelName,
  countryList,
  flagList,
  languageName,
  monetizationOf,
  prospectHref,
  publicChannelUrl,
} from "@/lib/agents/prospection/display";
import { clientTargets, eventText, statusButtonLabel } from "@/lib/agents/prospection/detail";
import { dealText } from "@/lib/agents/prospection/offers";
import type { ProspectDetail } from "@/lib/agents/prospection/queries";
import { fmtDate, fmtNum, fmtPct } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";
import type { ScoreWeights } from "@linkaffipro/agents";

const CONFIDENCE_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };

function Bars({ p, weights }: { p: ProspectDetail; weights: ScoreWeights }) {
  const bars = breakdownBars(p.scoreBreakdown, weights);
  if (!bars.length) return <p className="text-note text-muted-foreground">Pas encore noté.</p>;
  return (
    <ul className="space-y-2">
      {bars.map((b) => (
        <li key={b.key} className="grid grid-cols-[10rem_1fr_4rem] items-center gap-2 text-note max-sm:grid-cols-[1fr_4rem]">
          <span className="max-sm:col-span-2">{b.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className={`block h-full rounded-full ${b.key === "penalties" ? "bg-destructive" : "bg-brand"}`} style={{ width: `${Math.round(b.ratio * 100)}%` }} />
          </span>
          <span className="text-right tabular-nums">{b.key === "penalties" ? `${b.value}` : `${b.value} / ${b.max}`}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusButtons({ p, isAdmin, back }: { p: ProspectDetail; isAdmin: boolean; back: string }) {
  const targets = clientTargets(p.status).filter((t) => t !== "BLACKLISTED" || isAdmin);
  const simple = targets.filter((t) => t !== "SIGNED" && t !== "BLACKLISTED");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {simple.map((t) => (
          <form key={t} action={setProspectStatusAction}>
            <input type="hidden" name="prospectId" value={p.id} />
            <input type="hidden" name="status" value={t} />
            <input type="hidden" name="back" value={back} />
            <Button type="submit" size="sm" variant={t === "CONTACTED" ? "secondary" : "outline"} className="max-md:h-10">
              {statusButtonLabel(t)}
            </Button>
          </form>
        ))}
        {p.status !== "BLACKLISTED" ? (
          <form action={setProspectStatusAction} className="flex items-end gap-1">
            <input type="hidden" name="prospectId" value={p.id} />
            <input type="hidden" name="status" value="LATER" />
            <input type="hidden" name="back" value={back} />
            <Label htmlFor="pr-later-days" className="sr-only">
              Dans combien de jours
            </Label>
            <NativeSelect id="pr-later-days" name="days" defaultValue="7">
              {[3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  dans {d} jours
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
              Plus tard
            </Button>
          </form>
        ) : null}
      </div>
      {targets.includes("SIGNED") ? (
        <details>
          <summary className="cursor-pointer text-note text-info underline underline-offset-4">Signé : noter l&apos;accord</summary>
          <form action={setProspectStatusAction} className="mt-2 grid gap-2 sm:grid-cols-4 sm:items-end">
            <input type="hidden" name="prospectId" value={p.id} />
            <input type="hidden" name="status" value="SIGNED" />
            <input type="hidden" name="back" value={back} />
            <div className="space-y-1">
              <Label htmlFor="pr-deal">Accord</Label>
              <NativeSelect id="pr-deal" name="dealType" defaultValue="" wrapperClassName="w-full">
                <option value="">Je ne sais pas encore</option>
                {Object.entries(DEAL_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pr-cpa">Prime par joueur (€)</Label>
              <Input id="pr-cpa" name="cpa" inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pr-rev">Part du revenu (%)</Label>
              <Input id="pr-rev" name="revshare" inputMode="decimal" />
            </div>
            <Button type="submit" size="sm" className="max-md:h-10">
              Marquer signé
            </Button>
          </form>
        </details>
      ) : null}
      {targets.includes("BLACKLISTED") ? (
        <form action={setProspectStatusAction}>
          <input type="hidden" name="prospectId" value={p.id} />
          <input type="hidden" name="status" value="BLACKLISTED" />
          <input type="hidden" name="back" value={back} />
          <ConfirmSubmit
            size="sm"
            variant="destructive"
            className="max-md:h-10"
            confirmTitle={`Ne plus jamais montrer ${channelName(p)} ?`}
            message="Ce canal ne reviendra plus jamais dans les listes ni dans les propositions de Kevin. Son statut ne pourra plus changer."
            confirmLabel="Ne plus montrer"
            destructive
          >
            Ne plus montrer
          </ConfirmSubmit>
        </form>
      ) : null}
      <p className="text-note text-muted-foreground">Ces boutons notent ce que vous avez fait : rien n&apos;est envoyé au canal.</p>
    </div>
  );
}

/** Fiche d'un canal trouvé : tout ce que l'équipe a mesuré et lu, la note expliquée, l'avancement et les notes. */
export function ProspectDetailView({ p, weights, isAdmin, now }: { p: ProspectDetail; weights: ScoreWeights; isAdmin: boolean; now: Date }) {
  const url = publicChannelUrl(p);
  const countries = countryList(p.countries);
  const money = monetizationOf(p.monetization);
  const brands = brandList(p.brands);
  const fakes = flagList(p.fakeFlags);
  const risks = flagList(p.riskFlags);
  const contacts = [...p.contacts].sort((a, b) => (CONFIDENCE_ORDER[a.confidence] ?? 4) - (CONFIDENCE_ORDER[b.confidence] ?? 4));
  const back = prospectHref(p.id);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="prospectStatus" value={p.status} />
        {p.tier ? <StatusBadge kind="prospectTier" value={p.tier} /> : null}
        {p.score != null ? <span className="text-body font-semibold tabular-nums">{p.score} / 100</span> : null}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer noopener" className="text-info underline underline-offset-4">
            Ouvrir le canal dans Telegram
          </a>
        ) : null}
        {p.snoozedUntil && p.snoozedUntil > now ? <span className="text-note text-muted-foreground">Remis à plus tard jusqu&apos;au {fmtDate(p.snoozedUntil)}</span> : null}
      </div>
      {p.summaryFr ? <p className="text-body">{p.summaryFr}</p> : null}
      {p.tierReason ? <p className="text-note text-muted-foreground">Pourquoi ce niveau : {p.tierReason}</p> : null}

      <FormSection title="Où en est ce canal">
        <StatusButtons p={p} isAdmin={isAdmin} back={back} />
        {p.dealType || p.dealTerms ? (
          <p className="mt-3 text-note">
            Accord : {p.dealType ? DEAL_TYPE_LABELS[p.dealType] ?? p.dealType : "—"}
            {p.dealTerms ? ` · ${dealText(p.dealTerms).toLowerCase()}` : ""}
            {p.signedAt ? ` · signé le ${fmtDate(p.signedAt)}` : ""}
          </p>
        ) : null}
      </FormSection>

      <div className="grid gap-6 lg:grid-cols-2">
        <FormSection title="Le canal">
          <DetailList>
            <DetailRow label="Genre">{p.kind === "GROUP" ? "Groupe" : "Canal"}</DetailRow>
            <DetailRow label="Marché">
              {VERTICAL_LABELS[p.vertical] ?? p.vertical}
              {p.contentType ? ` · ${CONTENT_TYPE_LABELS[p.contentType] ?? p.contentType}` : ""}
            </DetailRow>
            <DetailRow label="Pays">{countries.length ? countries.map(countryName).join(", ") : "Pas encore déterminé"}{p.geoConfidence != null ? ` (sûr à ${fmtPct(p.geoConfidence, 0)})` : ""}</DetailRow>
            <DetailRow label="Langue">{p.language ? languageName(p.language) : "—"}</DetailRow>
            <DetailRow label="Abonnés">{p.subscribers != null ? fmtNum(p.subscribers) : "—"}</DetailRow>
            <DetailRow label="Vues par post (médiane, 30 jours)">{p.medianViews != null ? fmtNum(p.medianViews) : "—"}</DetailRow>
            <DetailRow label="Part des abonnés qui lisent">{fmtPct(p.viewRate)}</DetailRow>
            <DetailRow label="Posts par jour">{p.postsPerDay != null ? p.postsPerDay.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "—"}</DetailRow>
            <DetailRow label="Réactions par vue">{fmtPct(p.reactionRate, 2)}</DetailRow>
            <DetailRow label="Posts repris d'autres canaux">{fmtPct(p.forwardRatio, 0)}</DetailRow>
            <DetailRow label="Dernier post">{fmtDate(p.lastPostAt)}</DetailRow>
            <DetailRow label="Trouvé par">
              {SOURCE_TYPE_LABELS[p.sourceType] ?? p.sourceType}
              {p.discoveredFrom ? (
                <>
                  {" "}depuis{" "}
                  <Link href={prospectHref(p.discoveredFrom.id)} className="text-info underline underline-offset-4">
                    {channelName(p.discoveredFrom)}
                  </Link>
                </>
              ) : null}
              {p.cocitationCount ? ` · cité par ${fmtNum(p.cocitationCount)} canal${p.cocitationCount > 1 ? "ux" : ""} retenu${p.cocitationCount > 1 ? "s" : ""}` : ""}
            </DetailRow>
            <DetailRow label="Trouvé le">{fmtDate(p.discoveredAt)}</DetailRow>
          </DetailList>
          {p.descriptionRaw ? <p className="mt-3 whitespace-pre-line text-note text-muted-foreground">Description publique : {p.descriptionRaw}</p> : null}
        </FormSection>

        <FormSection title="Détail de la note" description="La note sur 100 est la somme de ces parts, moins les pénalités.">
          <Bars p={p} weights={weights} />
          {p.matchedOffer ? (
            <p className="mt-3 text-note">
              Colle à votre offre <span className="font-medium">{p.matchedOffer.brand}</span> ({dealText(p.matchedOffer.dealTypes).toLowerCase()}).
            </p>
          ) : null}
        </FormSection>
      </div>

      {p.dossier ? (
        <FormSection title="Dossier" description={p.dossierAt ? `Rédigé le ${fmtDate(p.dossierAt)}.` : undefined}>
          <p className="whitespace-pre-line text-body">{p.dossier}</p>
        </FormSection>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <FormSection title="Contacts publics" description="Ceux que le canal affiche pour être contacté. C'est vous qui écrivez.">
          {contacts.length ? (
            <ul className="space-y-2">
              {contacts.map((c) => (
                <li key={c.id} className="text-note">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge kind="contactConfidence" value={c.confidence} />
                    <span className="font-medium break-all">{c.value}</span>
                    <span className="text-muted-foreground">
                      {CONTACT_TYPE_LABELS[c.type] ?? c.type}
                      {c.label ? ` · ${c.label}` : ""}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    Vu dans : {c.source.replace(/^linked_page:/, "page liée ").replace(/^directory:/, "annuaire ")}
                    {c.evidence ? ` · « ${c.evidence} »` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-note text-muted-foreground">Aucun contact public trouvé.</p>
          )}
        </FormSection>

        <FormSection title="Marques et argent">
          <p className="text-note">
            Concurrence : {p.competitiveState ? COMPETITION_LABELS[p.competitiveState] ?? p.competitiveState : "inconnue"}
          </p>
          <ul className="mt-2 space-y-1">
            {money.sellsAds || money.marketplaceListing ? <li className="text-note">Vend de la pub{money.adPrice ? ` : ${money.adPrice}` : ""}{money.marketplaceListing ? " (annonce sur une place de marché)" : ""}</li> : null}
            {money.sellsVip ? <li className="text-note">Vend un accès payant{money.vipPrice ? ` : ${money.vipPrice}` : ""}</li> : null}
            {money.pushesAffiliate ? <li className="text-note">Pousse déjà des marques avec des liens d&apos;affiliation</li> : null}
          </ul>
          {brands.length ? (
            <ul className="mt-3 space-y-1">
              {brands.map((b) => (
                <li key={b.brand} className="text-note">
                  <span className="font-medium">{b.brand}</span>
                  <span className="text-muted-foreground">
                    {b.country ? ` · ${countryName(b.country)}` : ""}
                    {b.intensity ? ` · ${INTENSITY_LABELS[b.intensity] ?? b.intensity}` : ""}
                    {b.links ? ` · ${fmtNum(b.links)} lien${b.links > 1 ? "s" : ""}` : ""}
                    {b.promoCode ? ` · code ${b.promoCode}` : ""}
                    {b.firstSeenAt ? ` · depuis le ${fmtDate(new Date(b.firstSeenAt))}` : ""}
                    {b.lastSeenAt ? ` · dernière fois le ${fmtDate(new Date(b.lastSeenAt))}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-note text-muted-foreground">Aucune marque repérée.</p>
          )}
        </FormSection>
      </div>

      <FormSection title="Signaux à vérifier">
        <ul className="space-y-1">
          {p.authenticity ? (
            <li className="text-note">
              Lecture de l&apos;équipe : {AUTHENTICITY_LABELS[p.authenticity] ?? p.authenticity}
              {p.authenticityReason ? ` (${p.authenticityReason})` : ""}
            </li>
          ) : null}
          {fakes.map((f) => (
            <li key={f} className="text-note text-destructive">
              {FAKE_FLAG_LABELS[f] ?? f}
            </li>
          ))}
          {risks.map((r) => (
            <li key={r} className="text-note text-destructive">
              {RISK_FLAG_LABELS[r] ?? r}
            </li>
          ))}
          {!fakes.length && !risks.length ? <li className="text-note text-muted-foreground">Aucun signal de faux canal ni de risque.</li> : null}
        </ul>
        {p.regulatoryFlag ? (
          <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3">
            <p className="text-note">Règles du pays : {p.regulatoryFlag}</p>
            <p className="text-note text-muted-foreground">{NOT_LEGAL_ADVICE}</p>
          </div>
        ) : null}
      </FormSection>

      <div className="grid gap-6 lg:grid-cols-2">
        <FormSection id="notes" title="Notes">
          <form action={addProspectNoteAction} className="space-y-2">
            <input type="hidden" name="prospectId" value={p.id} />
            <Label htmlFor="pr-note">Ajouter une note</Label>
            <Textarea id="pr-note" name="note" required maxLength={1000} rows={3} placeholder="Veut des visuels mardi" />
            <Button type="submit" size="sm" className="max-md:h-10">
              Ajouter la note
            </Button>
          </form>
          {p.notes.length ? (
            <ul className="mt-4 space-y-2">
              {p.notes.map((n) => (
                <li key={n.id} className="text-note">
                  <span className="text-muted-foreground">{fmtDate(n.createdAt)}{n.authorType !== "client" ? " · équipe" : ""} :</span> {n.note}
                </li>
              ))}
            </ul>
          ) : null}
        </FormSection>

        <FormSection title="Chronologie">
          {p.events.length ? (
            <ol className="space-y-1">
              {p.events.map((e) => (
                <li key={e.id} className="text-note">
                  <span className="text-muted-foreground">{fmtDate(e.createdAt)} :</span> {eventText(e.type, e.payload)}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-note text-muted-foreground">Rien pour l&apos;instant.</p>
          )}
        </FormSection>
      </div>
    </div>
  );
}
