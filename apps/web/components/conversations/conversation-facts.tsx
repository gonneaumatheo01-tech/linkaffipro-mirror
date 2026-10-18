import Link from "next/link";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Term } from "@/components/admin/help-tip";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { languageName } from "@/lib/members/filters";
import {
  aiCostText,
  assistantWord,
  closedReasonLabel,
  personName,
  sourceLabel,
} from "@/lib/conversations/labels";
import type { ConversationDetail } from "@/lib/conversations/detail";
import { StatusBadge } from "@/lib/status-badges";

const linkClass =
  "font-medium text-brand-ink underline-offset-4 hover:underline max-md:inline-flex max-md:min-h-10 max-md:items-center";

/** Une carte de la colonne de droite (titre `<h2>`, contenu). */
function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-card p-4">
      <h2 id={id} className="mb-3 text-body font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Qui répond, avec « depuis le … par Marie » quand l'équipe a la main, ou la raison de la fermeture. */
function WhoAnswers({ c }: { c: ConversationDetail }) {
  const reason = c.status === "CLOSED" ? closedReasonLabel(c.closedReason) : null;
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge kind="conversationStatus" value={c.status} />
      {c.status === "HUMAN" && c.takenOverAt ? (
        <span className="text-note text-muted-foreground">
          Depuis le {fmtDate(c.takenOverAt)}
          {c.takenOverBy ? `, par ${c.takenOverBy.name}` : ""}
        </span>
      ) : null}
      {reason ? (
        <span className="text-note text-muted-foreground">
          {reason}
          {c.closedAt ? `, le ${fmtDate(c.closedAt)}` : ""}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Colonne de droite de la fiche d'une conversation : la personne (lien vers sa fiche), la persona, d'où elle vient,
 * l'étape, qui répond, la langue, ce que la personne a dit d'elle (faits retenus), le résumé, puis les résultats :
 * liens de l'offre envoyés et ouverts, inscription et premier dépôt rattachés, coût de l'IA. Composant serveur.
 */
export function ConversationFacts({ c }: { c: ConversationDetail }) {
  const name = personName(c.member);
  const opened = c.links.filter((l) => l.firstOpenedAt).length;
  const registered = c.players.find((p) => p.registeredAt) ?? null;
  const deposited = c.players.find((p) => p.ftdAt) ?? null;
  return (
    <div className="space-y-4">
      <Block id="conv-about" title="La conversation">
        <DetailList>
          <DetailRow label="Personne">
            {c.member.anonymizedAt ? (
              name
            ) : (
              <Link href={`/members/${c.member.id}`} className={linkClass}>
                {name}
              </Link>
            )}
            {c.member.username && !c.member.anonymizedAt && !name.startsWith("@") ? (
              <span className="block text-note text-muted-foreground">@{c.member.username}</span>
            ) : null}
          </DetailRow>
          <DetailRow label="Persona">
            {c.persona ? (
              <Link href={`/conversations/personas/${c.persona.id}`} className={linkClass}>
                {c.persona.name}
              </Link>
            ) : (
              <span className="text-muted-foreground">Sans persona</span>
            )}
            <span className="block text-note text-muted-foreground">
              Bot @{c.bot.username}
              {c.bot.isActive ? "" : " (désactivé)"}
            </span>
          </DetailRow>
          <DetailRow label="Source">
            <span title="Le mot après /start dans le lien du bot (pub, page, canal)">
              {sourceLabel(c.source)}
            </span>
          </DetailRow>
          <DetailRow label="Étape">
            <StatusBadge kind="conversationStage" value={c.stage} />
          </DetailRow>
          <DetailRow label="Qui répond">
            <WhoAnswers c={c} />
          </DetailRow>
          <DetailRow label="Langue">
            {languageName(c.language ?? c.member.languageCode) || (
              <span className="text-muted-foreground">—</span>
            )}
          </DetailRow>
          <DetailRow label="Commencée le">{fmtDate(c.createdAt)}</DetailRow>
          <DetailRow label="Messages reçus">{fmtNum(c.memberMessages)}</DetailRow>
        </DetailList>
      </Block>

      <Block id="conv-results" title="Résultats">
        <DetailList>
          <DetailRow label="Liens de l'offre">
            {c.links.length === 0 ? (
              <span className="text-muted-foreground">Aucun lien envoyé</span>
            ) : (
              <>
                {fmtNum(c.links.length)} envoyé{c.links.length > 1 ? "s" : ""}, {fmtNum(opened)}{" "}
                ouvert{opened > 1 ? "s" : ""}
              </>
            )}
          </DetailRow>
          <DetailRow label="Inscription">
            {registered?.registeredAt ? (
              <>
                {fmtDate(registered.registeredAt)}
                <span className="block text-note text-muted-foreground">
                  {registered.offerName}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Pas encore</span>
            )}
          </DetailRow>
          <DetailRow label={<Term term="FTD">Premier dépôt</Term>}>
            {deposited?.ftdAt ? (
              <>
                {fmtDate(deposited.ftdAt)}
                {deposited.ftdAmount !== null ? (
                  <span className="block text-note text-muted-foreground">
                    {fmtMoney(deposited.ftdAmount, deposited.currency)}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">Pas encore</span>
            )}
          </DetailRow>
          <DetailRow label="Coût de l'IA">
            <span title={fmtMoney(c.costEur, "EUR", { digits: 4 })}>{aiCostText(c.costEur)}</span>
          </DetailRow>
        </DetailList>
      </Block>

      <Block id="conv-memory" title={`Ce que ${assistantWord(c.persona?.gender)} retient`}>
        {c.facts.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-body">
            {c.facts.map((f, i) => (
              <li key={i} className="break-words">
                {f}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">
            Rien pour l&apos;instant : seuls les faits que la personne dit d&apos;elle-même (prénom,
            ville, goûts) sont retenus.
          </p>
        )}
        {c.summary ? (
          <div className="mt-3 border-t border-border pt-3">
            <h3 className="mb-1 text-note font-medium text-muted-foreground">
              Résumé des anciens messages
            </h3>
            <p className="whitespace-pre-wrap break-words text-body">{c.summary}</p>
          </div>
        ) : null}
      </Block>
    </div>
  );
}
