import Link from "next/link";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { StatusPill } from "@/components/admin/status-pill";
import { CREATED_BY_LABELS, STEP_STATUS_LABELS, STEP_STATUS_TONES, payloadSummary } from "@/lib/agents/missions";
import type { MissionView } from "@/lib/agents/queries";
import { agentLabel, teamName } from "@/lib/agents/teams";
import { fmtDate, fmtMoney } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

/** Étapes d'une mission, dans l'ordre, avec leur état, leur résumé et leur coût. */
export function MissionSteps({ mission }: { mission: Pick<MissionView, "steps" | "currentStep"> }) {
  if (mission.steps.length === 0)
    return <p className="text-note text-muted-foreground">Aucune étape commencée pour l&apos;instant.</p>;
  return (
    <ol className="space-y-2">
      {mission.steps.map((s, i) => (
        <li
          key={`${s.agent}-${i}`}
          className="space-y-1 rounded-lg border border-border px-3 py-2"
          aria-current={i === mission.currentStep ? "step" : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-note text-muted-foreground tabular-nums">{i + 1}.</span>
            <span className="text-body font-medium text-foreground">{agentLabel(s.agent)}</span>
            <StatusPill tone={STEP_STATUS_TONES[s.status]}>{STEP_STATUS_LABELS[s.status]}</StatusPill>
            {s.costCents > 0 ? (
              <span className="text-note text-muted-foreground">{fmtMoney(s.costCents / 100)}</span>
            ) : null}
          </div>
          {s.summary ? <p className="text-note text-muted-foreground">{s.summary}</p> : null}
          {s.error ? <p className="text-note text-danger">{s.error}</p> : null}
          {s.startedAt ? (
            <p className="text-note text-muted-foreground">
              {fmtDate(s.startedAt)}
              {s.endedAt ? ` → ${fmtDate(s.endedAt)}` : ""}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Détail d'une mission (volet latéral des listes) : où, quand, combien, et chaque étape. */
export function MissionDetail({ mission }: { mission: MissionView }) {
  const p = payloadSummary(mission.payload);
  return (
    <div className="space-y-6">
      <DetailList>
        <DetailRow label="Équipe">{teamName(mission.teamKey)}</DetailRow>
        <DetailRow label="Statut">
          <StatusBadge kind="agentMission" value={mission.status} />
        </DetailRow>
        <DetailRow label="Type">
          <StatusBadge kind="agentMissionKind" value={mission.kind} />
          {p.format ? ` · ${p.format}` : ""}
        </DetailRow>
        <DetailRow label="Canal visé">{mission.channelTitle ?? "—"}</DetailRow>
        <DetailRow label="Où part le post">
          {p.simulation ? "Canal Test (simulation)" : "Le vrai canal"}
        </DetailRow>
        <DetailRow label="Créée le">{fmtDate(mission.createdAt)}</DetailRow>
        <DetailRow label="Créée par">
          {CREATED_BY_LABELS[mission.createdBy] ?? mission.createdBy}
          {mission.isTest ? " (mission de test)" : ""}
        </DetailRow>
        <DetailRow label="Créneau choisi">{fmtDate(p.slot ?? mission.scheduledFor)}</DetailRow>
        <DetailRow label="Coût">{fmtMoney(mission.costCents / 100)}</DetailRow>
        <DetailRow label="Dernière activité">{fmtDate(mission.lastActivityAt)}</DetailRow>
        {mission.postId ? (
          <DetailRow label="Message programmé">
            <Link href={`/messages/${mission.postId}`} className="text-info underline">
              Ouvrir le message
            </Link>
          </DetailRow>
        ) : null}
        {mission.lastError ? (
          <DetailRow label="Dernière erreur">
            <span className="text-danger">{mission.lastError}</span>
          </DetailRow>
        ) : null}
        {p.reasons.length ? <DetailRow label="Motifs">{p.reasons.join(" · ")}</DetailRow> : null}
      </DetailList>
      <section aria-label="Étapes" className="space-y-2">
        <h3 className="text-body font-semibold text-foreground">Étape par étape</h3>
        <MissionSteps mission={mission} />
      </section>
    </div>
  );
}
