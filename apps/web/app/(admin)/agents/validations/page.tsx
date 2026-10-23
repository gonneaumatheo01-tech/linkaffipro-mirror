import type { Metadata } from "next";
import { CheckCheck, MessageCircleQuestion } from "lucide-react";
import { AgentsNav } from "@/components/agents/agents-nav";
import { EditValidationForm } from "@/components/agents/edit-validation-form";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { TabNav } from "@/components/admin/tab-nav";
import { ReadOnlyPreview } from "@/components/broadcasts/read-only-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  loadHumanRequests,
  loadPendingCounts,
  loadValidations,
  type HumanRequestView,
  type ValidationView,
} from "@/lib/agents/queries";
import { teamName } from "@/lib/agents/teams";
import { fmtDate } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";
import { requireUser } from "@/lib/session";
import {
  answerHumanRequestAction,
  decideValidationAction,
  relaunchHumanRequestAction,
  skipHumanRequestAction,
} from "./actions";

export const metadata: Metadata = { title: "Agents · Validations" };
export const dynamic = "force-dynamic";

function ValidationCard({ v }: { v: ValidationView }) {
  return (
    <article className="space-y-4 rounded-xl border border-border bg-card p-4" aria-label={`Validation n° ${v.number}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="neutral">n° {v.number}</StatusPill>
        <span className="font-medium text-foreground">Équipe {teamName(v.teamKey)}</span>
        <span className="text-note text-muted-foreground">
          {v.channelTitle ? `pour ${v.channelTitle}` : "sans canal"} · {fmtDate(v.createdAt)}
        </span>
        {v.simulation ? <StatusPill tone="warning">Simulation : canal Test</StatusPill> : null}
      </div>
      <p className="text-body text-muted-foreground">
        <span className="font-medium text-foreground">Pourquoi on vous le montre : </span>
        {v.reason}
      </p>
      {v.media ? (
        v.media.mimeType.startsWith("video/") ? (
          <video src={`/api/media/${v.media.id}`} controls className="max-h-80 rounded-lg" aria-label="Vidéo du post" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- média privé servi par le site, taille inconnue
          <img src={`/api/media/${v.media.id}`} alt="Média du post" className="max-h-80 rounded-lg" />
        )
      ) : null}
      <ReadOnlyPreview html={v.previewText} buttons={[]} mediaCount={v.media ? 1 : 0} />
      <div className="flex flex-wrap items-start gap-2">
        <form action={decideValidationAction}>
          <input type="hidden" name="validationId" value={v.id} />
          <input type="hidden" name="decision" value="approve" />
          <Button type="submit" variant="outline" className="max-md:h-10">
            ✅ Publier
          </Button>
        </form>
        <form action={decideValidationAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="validationId" value={v.id} />
          <input type="hidden" name="decision" value="reject" />
          <div className="space-y-1">
            <Label htmlFor={`reject-${v.id}`} className="text-note text-muted-foreground">
              Motif du refus (facultatif)
            </Label>
            <Input id={`reject-${v.id}`} name="rejectReason" maxLength={300} className="w-64 max-w-full" />
          </div>
          <ConfirmSubmit
            variant="outline"
            className="max-md:h-10"
            destructive
            confirmTitle="Refuser ce post ?"
            confirmLabel="Refuser"
            message="La mission est annulée et rien ne part ; le motif est noté pour que l'équipe apprenne."
          >
            ❌ Refuser
          </ConfirmSubmit>
        </form>
      </div>
      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-body font-medium focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
          ✏️ Corriger le texte
        </summary>
        <div className="border-t border-border p-3">
          <EditValidationForm validationId={v.id} initialText={v.previewText} action={decideValidationAction} />
        </div>
      </details>
    </article>
  );
}

function RequestAnswerForm({ r }: { r: HumanRequestView }) {
  const id = `answer-${r.id}`;
  return (
    <form action={answerHumanRequestAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="requestId" value={r.id} />
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={id} className="text-note text-muted-foreground">
          Votre réponse
        </Label>
        {r.kind === "CHOICE" && r.options.length ? (
          <NativeSelect id={id} name="answer" wrapperClassName="w-full" defaultValue="">
            <option value="" disabled>
              Choisissez
            </option>
            {r.options.map((o, i) => (
              <option key={i} value={String(i + 1)}>
                {i + 1}. {o}
              </option>
            ))}
          </NativeSelect>
        ) : r.kind === "CONFIRM" ? (
          <NativeSelect id={id} name="answer" wrapperClassName="w-full" defaultValue="">
            <option value="" disabled>
              Choisissez
            </option>
            <option value="oui">Oui</option>
            <option value="non">Non</option>
          </NativeSelect>
        ) : r.kind === "SECRET" ? (
          <Input id={id} name="answer" type="password" autoComplete="new-password" className="font-mono" placeholder="Collez la clé" />
        ) : (
          <Input id={id} name="answer" maxLength={2000} />
        )}
      </div>
      <Button type="submit" variant="outline" className="max-md:h-10">
        Répondre
      </Button>
    </form>
  );
}

function RequestCard({ r }: { r: HumanRequestView }) {
  const open = r.status === "PENDING" || r.status === "QUEUED";
  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="humanRequest" value={r.status} />
        <StatusBadge kind="humanRequestKind" value={r.kind} />
        {r.teamKey ? <span className="text-note text-muted-foreground">Équipe {teamName(r.teamKey)}</span> : null}
        <span className="text-note text-muted-foreground">{fmtDate(r.askedAt ?? r.createdAt)}</span>
      </div>
      <p className="whitespace-pre-line text-body text-foreground">{r.question}</p>
      {r.answerSummary ? <p className="text-note text-muted-foreground">Réponse : {r.answerSummary}</p> : null}
      {r.kind === "MEDIA" && open ? (
        <p className="text-note text-muted-foreground">
          Les médias se déposent en les envoyant au bot sur Telegram, avec les mots-clés demandés.
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        {open && r.kind !== "MEDIA" ? <RequestAnswerForm r={r} /> : null}
        {open ? (
          <form action={skipHumanRequestAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <Button type="submit" variant="ghost" className="max-md:h-10">
              Plus tard
            </Button>
          </form>
        ) : r.status === "EXPIRED" || r.status === "SKIPPED" ? (
          <form action={relaunchHumanRequestAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
              Relancer
            </Button>
          </form>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Validations des agents (phase 19, ADMIN et MANAGER) : les posts qui attendent une décision (aperçu, Publier /
 * Corriger / Refuser, comme sur Telegram) et, dans l'onglet « Demandes », les questions posées par le bot (répondre,
 * passer, relancer). Une seule question est posée à la fois sur Telegram : les autres attendent leur tour.
 */
export default async function ValidationsPage({ searchParams }: PageProps<"/agents/validations">) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab === "demandes" ? "requests" : "validations";
  const [pending, validations, requests] = await Promise.all([
    loadPendingCounts(),
    tab === "validations" ? loadValidations() : null,
    tab === "requests" ? loadHumanRequests() : null,
  ]);

  return (
    <>
      <AgentsNav current="validations" isAdmin={user.role === "ADMIN"} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Validations"
        description="Ce que les agents vous demandent avant d'agir : les posts à valider, et les questions posées par le bot sur Telegram."
        help="Répondre ici ou sur Telegram revient au même : la première réponse compte."
      />
      <TabNav
        label="Validations ou demandes"
        current={tab}
        items={[
          {
            key: "validations",
            href: "/agents/validations",
            label: "Posts à valider",
            count: pending.validations,
            ariaLabel: pending.validations ? `Posts à valider, ${pending.validations} en attente` : undefined,
          },
          {
            key: "requests",
            href: "/agents/validations?tab=demandes",
            label: "Demandes",
            count: pending.requests,
            ariaLabel: pending.requests ? `Demandes, ${pending.requests} ouvertes` : undefined,
          },
        ]}
        phone="grid"
        columns={2}
        className="mb-6"
      />
      <Flash ok={sp.ok} error={sp.error} />

      {validations ? (
        <div className="space-y-10">
          {validations.pending.length === 0 ? (
            <EmptyState
              icon={<CheckCheck />}
              title="Rien à valider"
              description="Quand un agent a besoin de votre accord, le post arrive ici et sur Telegram."
            />
          ) : (
            <section aria-label="Posts à valider" className="space-y-4">
              {validations.pending.map((v) => (
                <ValidationCard key={v.id} v={v} />
              ))}
            </section>
          )}
          {validations.recent.length ? (
            <FormSection title="Dernières décisions" description="Les 20 dernières, sur le site ou sur Telegram.">
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {validations.recent.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-body">
                    <StatusBadge kind="agentValidation" value={v.status} />
                    <span className="text-foreground">
                      n° {v.number} · Équipe {teamName(v.teamKey)}
                      {v.channelTitle ? ` · ${v.channelTitle}` : ""}
                    </span>
                    <span className="text-note text-muted-foreground">
                      {fmtDate(v.decidedAt ?? v.createdAt)}
                      {v.decidedVia === "TELEGRAM" ? " sur Telegram" : v.decidedVia === "SITE" ? " sur le site" : ""}
                    </span>
                    {v.rejectReason ? <span className="text-note text-muted-foreground">Motif : {v.rejectReason}</span> : null}
                  </li>
                ))}
              </ul>
            </FormSection>
          ) : null}
        </div>
      ) : null}

      {requests ? (
        <div className="space-y-10">
          {requests.open.length === 0 ? (
            <EmptyState
              icon={<MessageCircleQuestion />}
              title="Aucune demande ouverte"
              description="Quand un agent a besoin d'une clé, d'un choix ou de médias, le bot vous pose la question sur Telegram ; elle apparaît aussi ici."
            />
          ) : (
            <FormSection
              title="Demandes ouvertes"
              description="La question posée d'abord, puis celles qui attendent leur tour. Une clé collée ici n'est jamais réaffichée."
            >
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {requests.open.map((r) => (
                  <RequestCard key={r.id} r={r} />
                ))}
              </ul>
            </FormSection>
          )}
          {requests.closed.length ? (
            <FormSection title="Demandes closes" description="Les 20 dernières. Une demande passée ou expirée se relance en un clic.">
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {requests.closed.map((r) => (
                  <RequestCard key={r.id} r={r} />
                ))}
              </ul>
            </FormSection>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
