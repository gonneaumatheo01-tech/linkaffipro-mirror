/**
 * Avertissement du formulaire des messages (phase 13) : un message publié par le compte Telegram connecté part sans
 * boutons (emojis animés), donc sans bouton d'offre ; un lien d'offre dans le texte est le même pour tout le monde
 * (pas d'identifiant de suivi par membre, pas de paramètre `tg`). Les dépôts qui en viennent ne peuvent pas être
 * crédités aux affiliés Link Affi. Avertissement affiché quand une version publiée par le compte part dans un canal
 * qui compte des membres d'affiliés (attribution en cours). Fonction pure, testée dans affiliate-warning.test.ts.
 */
import type { VersionMode } from "./publisher";

export const AFFILIATE_POST_WARNING =
  "Les dépôts venant de ce post ne pourront pas être crédités aux affiliés : utilisez un bouton d'offre.";

/**
 * Canaux concernés (titres, sans doublon, dans l'ordre des canaux cochés), ou liste vide : aucun avertissement.
 * `affiliateMembers` : membres d'affiliés présents par canal.
 */
export function affiliatePostWarningChannels(input: {
  modeA: VersionMode;
  modeB: VersionMode | null;
  channelIdsA: readonly string[];
  channelIdsB: readonly string[];
  affiliateMembers: Readonly<Record<string, number | undefined>>;
  titleOf: (id: string) => string;
  /** Un canal (pas un groupe) : seul un canal passe par le compte connecté. */
  isChannel: (id: string) => boolean;
  isTemplate: boolean;
}): string[] {
  if (input.isTemplate) return [];
  const ids: string[] = [];
  const add = (list: readonly string[]) => {
    for (const id of list)
      if (id && !ids.includes(id) && input.isChannel(id) && (input.affiliateMembers[id] ?? 0) > 0)
        ids.push(id);
  };
  if (input.modeA === "account") add(input.channelIdsA);
  if (input.modeB === "account") add(input.channelIdsB);
  return ids.map(input.titleOf);
}

/** Précision sous l'avertissement : les canaux en cause. */
export function affiliateWarningDetail(titles: readonly string[]): string | null {
  if (titles.length === 0) return null;
  const list = titles.map((t) => `« ${t} »`);
  const joined =
    list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} et ${list[list.length - 1]}`;
  return titles.length === 1
    ? `${joined} compte des membres amenés par des affiliés Link Affi ; ce message sera publié par votre compte Telegram, sans boutons.`
    : `${joined} comptent des membres amenés par des affiliés Link Affi ; ce message sera publié par votre compte Telegram, sans boutons.`;
}
