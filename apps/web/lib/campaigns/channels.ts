/**
 * Canaux d'une campagne à l'enregistrement (règle pure) : les formulaires ne montrent que les canaux actifs ; un canal
 * désactivé déjà rattaché à la campagne n'est donc jamais une case à cocher, mais il doit rester dans la campagne
 * (ses messages restent dans le filtre Campagne). Résultat = cases cochées ∪ (anciens canaux ∩ inactifs), sans doublon.
 */
export function keepInactiveChannels(
  checked: readonly string[],
  previous: readonly string[],
  activeIds: ReadonlySet<string>,
): string[] {
  const out = [...new Set(checked.filter(Boolean))];
  for (const id of previous) if (!activeIds.has(id) && !out.includes(id)) out.push(id);
  return out;
}
