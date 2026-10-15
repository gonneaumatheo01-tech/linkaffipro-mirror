import { prisma } from "@linkaffipro/db";
import { PAYLOAD_LABEL_TYPES, eventLabel } from "./event-labels";

/** Événements relus par lecture (export de 20 000 lignes : quelques lectures ciblées). */
const CHUNK = 5000;

/**
 * Libellés d'une liste d'événements (vue « Événements » du Journal, son export, derniers événements des Statistiques),
 * avec le détail (`payload`) des seuls types dont le libellé en dépend (`PAYLOAD_LABEL_TYPES` : canaux rejoints vérifiés
 * automatiquement, message privé refusé ou non envoyé, phase 14) : une lecture de plus, ciblée, plutôt que le détail de
 * chaque ligne (les mises à jour Telegram brutes sont lourdes). Identifiant de l'événement → libellé.
 */
export async function eventRowLabels(
  rows: ReadonlyArray<{ id: string; type: string }>,
): Promise<Map<string, string>> {
  const need = rows.filter((r) => PAYLOAD_LABEL_TYPES.has(r.type)).map((r) => r.id);
  const payloads = new Map<string, unknown>();
  for (let i = 0; i < need.length; i += CHUNK) {
    const found = await prisma.event.findMany({
      where: { id: { in: need.slice(i, i + CHUNK) } },
      select: { id: true, payload: true },
    });
    for (const f of found) payloads.set(f.id, f.payload);
  }
  return new Map(rows.map((r) => [r.id, eventLabel(r.type, payloads.get(r.id))]));
}
