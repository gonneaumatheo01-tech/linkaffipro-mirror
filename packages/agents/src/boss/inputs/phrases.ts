/**
 * Phase 34, chantier F — repères purs sur l'ordre d'arrivée des messages. Telegram envoie le commentaire d'un transfert
 * (« programme ça demain 20 h ») AVANT les messages transférés : une phrase qui parle de « ça », « ce message », « ce
 * fichier »… attend un court instant avant l'interprète (le contenu a le temps d'être gardé), et un transfert qui arrive
 * juste après une phrase ne reçoit pas d'accusé en plus (la phrase est la demande).
 */
import { normalizeText } from "../../human/answer";

/** Une phrase arrivée moins de 5 s avant un transfert en est le commentaire. */
export const PHRASE_BEFORE_INPUT_MS = 5_000;
/** Attente avant l'interprète pour une phrase qui parle d'un contenu reçu. */
export const INPUT_REFERENCE_DELAY_MS = 2_000;

const REFERENCE =
  /(^|[^\p{L}])(ca|ceci|cela|celui-ci|celui-la|celle-ci|celle-la|ce message|ces messages|ce post|ces posts|ce texte|ce fichier|ces fichiers|ce csv|cette photo|ces photos|cette video|ces videos|le message|le fichier|les messages|les photos|ces joueurs|ces canaux|ces lignes|transfere|transferes|transferee)([^\p{L}]|$)/u;

/** La phrase parle-t-elle d'un contenu envoyé à côté (« envoie ça », « importe ce fichier ») ? Pur. */
export function refersToReceivedInput(text: string): boolean {
  return REFERENCE.test(normalizeText(text));
}
