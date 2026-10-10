import { StatusPill } from "@/components/admin/status-pill";

/** État d'une relance avec les mots de l'interrupteur : « Activée » (vert) ou « Désactivée » (gris). */
export function RuleStatusPill({ active, className }: { active: boolean; className?: string }) {
  return (
    <StatusPill tone={active ? "success" : "muted"} className={className}>
      {active ? "Activée" : "Désactivée"}
    </StatusPill>
  );
}
