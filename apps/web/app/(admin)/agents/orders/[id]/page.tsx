import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentsNav } from "@/components/agents/agents-nav";
import { MissionsTable } from "@/components/agents/missions-table";
import { OrderProgress } from "@/components/agents/orders/order-progress";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  EXTEND_CHOICES,
  ORDERS_PATH,
  canExtend,
  canManageOrders,
  canStop,
  capabilityText,
  orderTeamName,
  orderTimeline,
  orderTitle,
  overrideChanges,
  overrideState,
  paramsInWords,
  periodText,
  planLines,
  progressFigures,
  resolvedLines,
} from "@/lib/agents/orders";
import { loadCapabilityDescriptions } from "@/lib/agents/orders-engine";
import { loadOrderDetail } from "@/lib/agents/orders-queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtDayKey } from "@/lib/periods";
import { fmtDate, fmtMoney } from "@/lib/format";
import { parisDayKey } from "@/lib/posts/time";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { extendOrderAction, stopOrderAction } from "../actions";

export const metadata: Metadata = { title: "Agents · Ordre" };
export const dynamic = "force-dynamic";

/**
 * Fiche d'un ordre de Kevin (phase 33) : la phrase d'origine, le récapitulatif envoyé sur Telegram, le plan validé en
 * mots, ce qui était impossible et les replis proposés, la progression, les missions liées (et leurs posts), le
 * réglage temporaire posé sur le canal (période, ce qui change), la chronologie. « Arrêter » et « Prolonger » :
 * administrateurs, avec confirmation ; les responsables lisent.
 */
export default async function OrderPage({ params, searchParams }: PageProps<"/agents/orders/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const now = new Date();
  const today = parisDayKey(now);
  const isAdmin = canManageOrders(user.role);
  const [order, pending, capabilities] = await Promise.all([loadOrderDetail(id), loadPendingCounts(), loadCapabilityDescriptions()]);
  if (!order) notFound();
  const title = orderTitle(order.number);
  const names = { ...order.names, capabilities };
  const figures = progressFigures(order.progress, order.counts);
  const timeline = orderTimeline(order, order.events, order.audits, now);
  const recap = order.recap
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const resolved = resolvedLines(order.plan, names);
  const stoppable = isAdmin && canStop(order.status);
  const extendable = isAdmin && canExtend(order.status);

  return (
    <>
      <AgentsNav current="orders" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title={title}
        backHref={ORDERS_PATH}
        backLabel="Tous les ordres"
        meta={
          <>
            <StatusBadge kind="teamOrder" value={order.status} />
            <StatusBadge kind="teamOrderKind" value={order.kind} />
            <StatusPill tone={order.plan.mode === "real" ? "warning" : "muted"}>{order.plan.mode === "real" ? "En vrai" : "Pour de faux"}</StatusPill>
          </>
        }
        description={`${orderTeamName(order.teamKey)} · ${periodText(order.period)} · demandé le ${fmtDate(order.createdAt)}${order.createdByName ? ` par ${order.createdByName}` : ""}`}
        secondaryActions={
          stoppable || extendable ? (
            <>
              {extendable ? (
                <form action={extendOrderAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="orderId" value={order.id} />
                  <div className="space-y-1">
                    <Label htmlFor="order-extend-days" className="text-note font-medium text-muted-foreground">
                      Prolonger de
                    </Label>
                    <NativeSelect id="order-extend-days" name="days" defaultValue="2" wrapperClassName="w-32">
                      {EXTEND_CHOICES.map((d) => (
                        <option key={d} value={String(d)}>
                          {d} jour{d > 1 ? "s" : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <ConfirmSubmit
                    variant="outline"
                    size="sm"
                    className="max-md:h-10"
                    confirmTitle={`Prolonger ${title} ?`}
                    message="La fin de l'ordre et du réglage temporaire du canal est repoussée du nombre de jours choisi ; l'équipe continue au même rythme. Continuer ?"
                  >
                    Prolonger
                  </ConfirmSubmit>
                </form>
              ) : null}
              {stoppable ? (
                <form action={stopOrderAction}>
                  <input type="hidden" name="orderId" value={order.id} />
                  <ConfirmSubmit
                    variant="outline"
                    size="sm"
                    destructive
                    className="max-md:h-10"
                    confirmTitle={`Arrêter ${title} ?`}
                    message="Les missions pas encore commencées sont annulées et le canal reprend son plan habituel. Ce qui est déjà publié reste publié. Continuer ?"
                  >
                    Arrêter
                  </ConfirmSubmit>
                </form>
              ) : null}
            </>
          ) : undefined
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      {!isAdmin ? (
        <p className="mb-6 text-note text-muted-foreground">Seuls les administrateurs peuvent arrêter ou prolonger un ordre (ou dites-le à Kevin).</p>
      ) : null}

      <div className="space-y-10">
        <FormSection title="La demande" description={order.fromTelegram ? "Votre phrase telle que Kevin l'a reçue sur Telegram." : "La phrase telle que Kevin l'a reçue."}>
          <blockquote className="rounded-xl border border-border bg-card px-4 py-3 text-body text-foreground">« {order.requestText} »</blockquote>
          {recap.length ? (
            <div className="space-y-1">
              <p className="text-body font-medium text-foreground">Récapitulatif de Kevin</p>
              <ul className="space-y-0.5 text-body text-muted-foreground">
                {recap.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </FormSection>

        <FormSection title="Le plan validé" description="Ce que l'équipe fait, vérifié par la plateforme dans ses limites avant le lancement.">
          <DetailList>
            {planLines(order.plan, names).map((l) => (
              <DetailRow key={l.label} label={l.label}>
                {l.value}
              </DetailRow>
            ))}
            <DetailRow label="Progression">
              <OrderProgress figures={figures} status={order.status} />
            </DetailRow>
            <DetailRow label="Coût">{fmtMoney(order.costCents / 100)}</DetailRow>
          </DetailList>
          {order.plan.steps.length ? (
            <div className="space-y-2">
              <p className="text-body font-medium text-foreground">Étapes</p>
              <ol className="list-decimal space-y-2 pl-5 text-body text-foreground">
                {order.plan.steps.map((s, i) => {
                  const params = paramsInWords(s.params, names);
                  return (
                    <li key={`${s.capability}-${i}`}>
                      <span className="font-medium">{capabilityText(s.teamKey, s.capability, names)}</span>
                      <span className="text-muted-foreground"> · {orderTeamName(s.teamKey)}</span>
                      {params.length ? <span className="block text-note text-muted-foreground">{params.join(" · ")}</span> : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
          {resolved.length ? (
            <div className="space-y-1">
              <p className="text-body font-medium text-foreground">Ce que Kevin a compris tout seul</p>
              <ul className="space-y-0.5 text-note text-muted-foreground">
                {resolved.map((r) => (
                  <li key={r.label}>
                    <span className="text-foreground">{r.label}</span> : {r.value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {order.plan.questions.length ? (
            <p className="text-note text-muted-foreground">Question posée : {order.plan.questions.join(" ")}</p>
          ) : null}
        </FormSection>

        {order.impossible.length ? (
          <FormSection title="Ce qui n'a pas pu être pris" description="Kevin a dit pourquoi et proposé des solutions proches, par numéro.">
            <ul className="space-y-3">
              {order.impossible.map((p, i) => (
                <li key={i} className="space-y-1 rounded-xl border border-border bg-card px-4 py-3">
                  <p className="text-body font-medium text-foreground">{p.part}</p>
                  {p.reason ? <p className="text-body text-muted-foreground">{p.reason}</p> : null}
                  {p.alternatives.length ? (
                    <ol className="list-decimal space-y-0.5 pl-5 text-note text-foreground">
                      {p.alternatives.map((a, j) => (
                        <li key={j}>{a}</li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ul>
          </FormSection>
        ) : null}

        <FormSection
          title="Réglage temporaire du canal"
          description="Pendant la période, le canal suit ces réglages au lieu de son plan habituel ; à la fin, il reprend son plan, qui n'a jamais été modifié."
        >
          {order.overrides.length === 0 ? (
            <EmptyState
              title="Aucun réglage temporaire"
              description="Cet ordre ne change pas le plan d'un canal (une question, un réglage, ou une seule publication)."
            />
          ) : (
            <ul className="space-y-3">
              {order.overrides.map((o) => {
                const state = overrideState(o, today);
                return (
                  <li key={o.id} className="space-y-1 rounded-xl border border-border bg-card px-4 py-3">
                    <p className="flex flex-wrap items-center gap-2 text-body font-medium text-foreground">
                      <Link href={`/channels/${o.channelId}`} className="text-info underline">
                        {order.names.channels.get(o.channelId) ?? "Canal retiré"}
                      </Link>
                      <StatusPill tone={state.tone}>{state.label}</StatusPill>
                    </p>
                    <p className="text-note text-muted-foreground">
                      Du {fmtDayKey(o.fromDay)} au {fmtDayKey(o.toDay)}
                      {o.closedAt ? ` · arrêté le ${fmtDate(o.closedAt)}` : ""}
                    </p>
                    <ul className="list-disc space-y-0.5 pl-5 text-note text-foreground">
                      {overrideChanges(o, names, order.channelTeams.get(o.channelId)).map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </FormSection>

        <FormSection
          title="Missions"
          description="Chaque publication préparée pour cet ordre, avec son état. Cliquez sur une ligne pour le détail étape par étape et le lien vers le post."
        >
          {order.progress.perDay.length ? (
            <ul className="flex flex-wrap gap-2 text-note">
              {order.progress.perDay.map((d) => (
                <li key={d.day} className="rounded-lg border border-border bg-card px-3 py-1.5 text-foreground">
                  {fmtDayKey(d.day, false)} : {d.done} faite{d.done > 1 ? "s" : ""}
                  {d.failed ? ` · ${d.failed} en échec` : ""}
                  {d.postIds.length ? ` · ${d.postIds.length} post${d.postIds.length > 1 ? "s" : ""}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {order.missions.length === 0 ? (
            <EmptyState
              title="Pas encore de mission"
              description={
                order.status === "WAITING_CONFIRM"
                  ? "L'ordre attend votre OUI sur Telegram : les missions sont créées au lancement."
                  : "Le Grand Chef crée les missions du jour à chaque passage, dans la fenêtre du canal."
              }
            />
          ) : (
            <MissionsTable missions={order.missions} showTeam />
          )}
        </FormSection>

        <FormSection title="Chronologie" description="De la demande à la fin, les plus anciens d'abord.">
          <ol className="space-y-2 border-l border-border pl-4">
            {timeline.map((t, i) => (
              <li key={i} className="space-y-0.5">
                <p className="text-body text-foreground">
                  <span className="font-medium">{t.label}</span> <span className="text-note text-muted-foreground">· {fmtDate(t.at)}</span>
                </p>
                {t.detail ? <p className="text-note text-muted-foreground">{t.detail}</p> : null}
              </li>
            ))}
          </ol>
        </FormSection>
      </div>
    </>
  );
}
