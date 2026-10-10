/** Textes de Réglages → Étiquettes de membres (fonctions pures, testées). */
import { fmtNum } from "@/lib/format";

/** « Aucun membre », « 1 membre », « 12 membres ». */
export function memberCountLabel(count: number): string {
  if (count <= 0) return "Aucun membre";
  return `${fmtNum(count)} membre${count > 1 ? "s" : ""}`;
}

/** Phrase de la boîte de confirmation « Supprimer » : ce qui va se passer, sans « Continuer ? » (titre déjà posé). */
export function deleteTagMessage(name: string, count: number): string {
  return count > 0
    ? `L'étiquette « ${name} » sera supprimée et retirée de ${memberCountLabel(count).toLowerCase()}. Les membres eux-mêmes ne sont pas touchés.`
    : `L'étiquette « ${name} » sera supprimée. Aucun membre ne la porte.`;
}

/** Adresse de la liste des membres filtrée sur une étiquette. */
export function membersWithTagHref(name: string): string {
  return `/members?${new URLSearchParams({ tag: name }).toString()}`;
}
