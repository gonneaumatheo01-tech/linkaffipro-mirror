/**
 * Collisions à la création d'une mission (règle pure) : pas de mission sur un canal inactif ; pas plus de missions
 * actives sur un canal que son quota du jour ; jamais deux équipes sur le même canal.
 */
export type CollisionInput = {
  channel: { isActive: boolean } | null;
  teamKey: string;
  /** Missions actives (non terminées) déjà sur ce canal. */
  activeOnChannel: ReadonlyArray<{ teamKey: string }>;
  postsPerDay: number;
  /** Mission de test (canal Test) : seule la règle « canal actif » s'applique. */
  isTest?: boolean;
};

export function collisionReason(i: CollisionInput): string | null {
  if (!i.channel) return "Canal introuvable.";
  if (!i.channel.isActive) return "Canal inactif : aucune mission.";
  if (i.isTest) return null;
  const other = i.activeOnChannel.find((m) => m.teamKey !== i.teamKey);
  if (other) return `Le canal est déjà suivi par l'équipe ${other.teamKey}.`;
  if (i.activeOnChannel.length >= Math.max(1, i.postsPerDay))
    return `Déjà ${i.activeOnChannel.length} mission(s) en cours sur ce canal (quota ${i.postsPerDay} par jour).`;
  return null;
}
