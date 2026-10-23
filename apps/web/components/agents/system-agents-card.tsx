import Link from "next/link";
import { FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { cycleLate, loadAgentsSystemStatus } from "@/lib/agents/system-status";
import { teamName } from "@/lib/agents/teams";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

/**
 * Carte « Agents » de Réglages → État du système (phase 19) : files du Grand Chef et des équipes, dernier passage du
 * Grand Chef (toutes les 30 minutes), missions bloquées. Composant serveur qui lit lui-même ses données ; une panne
 * s'affiche dans la carte, jamais en erreur de page.
 */
export async function SystemAgentsCard({ now = new Date() }: { now?: Date }) {
  const s = await loadAgentsSystemStatus(now).catch((e: Error) => ({ error: e.message }) as const);
  if ("error" in s)
    return (
      <FormSection title="Agents" description="Le Grand Chef, les équipes et leurs missions.">
        <p className="text-body text-danger">Lecture impossible : {s.error}</p>
      </FormSection>
    );
  const late = cycleLate(s.lastCycleAt, now);
  const failed = s.queues?.reduce((a, q) => a + q.failed, 0) ?? 0;
  return (
    <FormSection
      title="Agents"
      description="Le Grand Chef passe toutes les 30 minutes ; une mission bloquée attend une action ou une reprise."
      actions={
        late || s.stuckTotal > 0 || failed > 0 ? (
          <StatusPill tone="warning">À voir</StatusPill>
        ) : (
          <StatusPill tone="success">Tout va bien</StatusPill>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-body">
          Dernier passage du Grand Chef :{" "}
          <span className={late ? "text-warning" : "text-foreground"}>
            {s.lastCycleAt ? fmtDate(s.lastCycleAt) : "jamais"}
          </span>
          {late ? " (plus d'une heure sans passage)" : ""}
        </p>
        {s.queues ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {s.queues.map((q) => (
              <li key={q.name} className="rounded-lg border border-border px-3 py-2 text-note">
                <span className="block font-medium text-foreground">{q.label}</span>
                <span className="text-muted-foreground">
                  {fmtNum(q.waiting + q.delayed)} en attente · {fmtNum(q.active)} en cours
                  {q.failed ? <span className="text-danger"> · {fmtNum(q.failed)} en échec</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-danger">Files des agents illisibles : {s.queuesError}</p>
        )}
        {s.stuck.length ? (
          <div className="space-y-2">
            <p className="text-body font-medium text-foreground">
              {fmtNum(s.stuckTotal)} mission{s.stuckTotal > 1 ? "s" : ""} bloquée{s.stuckTotal > 1 ? "s" : ""}
            </p>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {s.stuck.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-note">
                  <StatusBadge kind="agentMission" value={m.status} />
                  <Link href={`/agents/${m.teamKey}#missions`} className="text-foreground underline-offset-4 hover:underline">
                    Équipe {teamName(m.teamKey)}
                    {m.channelTitle ? ` · ${m.channelTitle}` : ""}
                  </Link>
                  <span className="text-muted-foreground">{m.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-note text-muted-foreground">Aucune mission bloquée.</p>
        )}
      </div>
    </FormSection>
  );
}
