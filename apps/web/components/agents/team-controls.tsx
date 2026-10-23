import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  setAutonomyLevelAction,
  setSimulationAction,
  setTeamPausedAction,
} from "@/app/(admin)/agents/actions";
import type { TeamConfigView } from "@/lib/agents/config";
import { AUTONOMY_LEVELS, TEAM_NAMES, canSetLevel, canSetSimulation, type TeamKey } from "@/lib/agents/teams";

function Hidden({ team, from }: { team: TeamKey; from: string }) {
  return (
    <>
      <input type="hidden" name="team" value={team} />
      <input type="hidden" name="from" value={from} />
    </>
  );
}

/** Bouton Pause / Reprendre d'une équipe (tout le monde). */
export function PauseButton({ team, config, from }: { team: TeamKey; config: TeamConfigView; from: string }) {
  return (
    <form action={setTeamPausedAction}>
      <Hidden team={team} from={from} />
      <input type="hidden" name="paused" value={config.paused ? "0" : "1"} />
      {config.paused ? (
        <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
          Reprendre
        </Button>
      ) : (
        <ConfirmSubmit
          variant="outline"
          size="sm"
          className="max-md:h-10"
          confirmTitle={`Mettre l'équipe ${TEAM_NAMES[team]} en pause ?`}
          confirmLabel="Mettre en pause"
          message="L'équipe ne crée plus aucune mission et celles en cours attendent, jusqu'à ce que vous cliquiez sur « Reprendre »."
        >
          Pause
        </ConfirmSubmit>
      )}
    </form>
  );
}

/**
 * Niveau d'autonomie : trois choix, l'actuel est coché. Le niveau 2 (rien à valider) est réservé aux administrateurs
 * et demande une confirmation qui dit ce qui va se passer.
 */
export function LevelPicker({
  team,
  config,
  role,
  from,
}: {
  team: TeamKey;
  config: TeamConfigView;
  role: string;
  from: string;
}) {
  return (
    <ul className="space-y-2" aria-label="Niveau d'autonomie">
      {AUTONOMY_LEVELS.map((l) => {
        const current = l.value === config.autonomyLevel;
        const allowed = canSetLevel(role, l.value);
        return (
          <li
            key={l.value}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2",
              current ? "border-brand bg-brand-soft/40" : "border-border",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-foreground">
                {l.label}
                {current ? <span className="text-note font-normal text-muted-foreground"> (actuel)</span> : null}
              </p>
              <p className="text-note text-muted-foreground">{l.sentence}</p>
            </div>
            {current ? null : allowed ? (
              <form action={setAutonomyLevelAction}>
                <Hidden team={team} from={from} />
                <input type="hidden" name="level" value={l.value} />
                {l.value === 2 ? (
                  <ConfirmSubmit
                    variant="outline"
                    size="sm"
                    className="max-md:h-10"
                    confirmTitle={`Autonomie totale pour l'équipe ${TEAM_NAMES[team]} ?`}
                    confirmLabel="Passer au niveau 2"
                    message="Plus rien ne vous sera montré avant publication : les posts partiront seuls, et vous ne recevrez que le rapport du matin."
                  >
                    Choisir
                  </ConfirmSubmit>
                ) : (
                  <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                    Choisir
                  </Button>
                )}
              </form>
            ) : (
              <span className="text-note text-muted-foreground">Réservé aux administrateurs</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Simulation : l'arrêter (vrais canaux) est réservé aux administrateurs, avec confirmation ; la remettre est libre. */
export function SimulationSwitch({
  team,
  config,
  role,
  from,
}: {
  team: TeamKey;
  config: TeamConfigView;
  role: string;
  from: string;
}) {
  if (!config.simulation)
    return (
      <form action={setSimulationAction}>
        <Hidden team={team} from={from} />
        <input type="hidden" name="simulation" value="1" />
        <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
          Revenir en simulation
        </Button>
      </form>
    );
  if (!canSetSimulation(role, false))
    return (
      <p className="text-note text-muted-foreground">
        Seul un administrateur peut faire publier cette équipe sur les vrais canaux.
      </p>
    );
  return (
    <form action={setSimulationAction}>
      <Hidden team={team} from={from} />
      <input type="hidden" name="simulation" value="0" />
      <ConfirmSubmit
        variant="outline"
        size="sm"
        className="max-md:h-10"
        destructive
        confirmTitle={`Publier pour de vrai avec l'équipe ${TEAM_NAMES[team]} ?`}
        confirmLabel="Publier sur les vrais canaux"
        message="Les prochains posts de l'équipe partiront sur ses vrais canaux, devant vos membres, et plus sur le canal Test."
      >
        Publier sur les vrais canaux
      </ConfirmSubmit>
    </form>
  );
}
