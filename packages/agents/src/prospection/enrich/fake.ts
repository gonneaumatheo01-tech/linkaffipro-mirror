/**
 * Phase 31, chantier B — signaux de faux canal calculés par le code (section 3.5). Chaque signal est une pénalité du
 * score ; deux signaux ou plus = jamais niveau A (Évaluateur), et l'IA ne peut pas les effacer (concordance).
 *
 * - `SUSPECT_FAKE_SUBS` : vues médianes ÷ abonnés < 0,03 (abonnés achetés).
 * - `SUSPECT_VIEW_BOT` : coefficient de variation des vues < 0,05 sur au moins 20 posts (vues achetées, constantes).
 * - `SUSPECT_BOT_CONTENT` : tous les posts de même longueur (± 10 caractères autour de la médiane) ET même structure
 *   (type de média, nombre de lignes, lien, boutons), sur au moins 10 posts avec du texte.
 * - `SUSPECT_NO_ENGAGEMENT` : vues médianes ≥ 1 000, réactions activées (le bloc s'affiche sur au moins un post) et
 *   au moins 90 % des posts sans aucune réaction ni commentaire. Décision : l'aperçu n'affiche pas le bloc quand il
 *   est vide, « zéro réaction » se lit donc comme « presque aucun post avec une réaction ».
 * - `GROWTH_SPIKE` : demande un historique des abonnés (phase 32) ; jamais posé ici.
 */
import { PROSPECTION_LIMITS, type FakeFlag, type ProspectMetrics, type ProspectPost } from "../contract";

const BOT_CONTENT_MIN_POSTS = 10;
const NO_ENGAGEMENT_SHARE = 0.9;

function structureKey(p: ProspectPost): string {
  const lines = p.text.split("\n").filter((l) => l.trim()).length;
  return `${p.mediaKind}|${lines}|${p.links.length > 0 ? 1 : 0}|${p.buttons.length}`;
}

export function fakeSignals(posts: ProspectPost[], metrics: ProspectMetrics): FakeFlag[] {
  const flags: FakeFlag[] = [];
  if (metrics.viewRate !== null && metrics.viewRate < PROSPECTION_LIMITS.fakeSubsViewRate) flags.push("SUSPECT_FAKE_SUBS");
  const withViews = posts.filter((p) => typeof p.views === "number").length;
  if (metrics.viewVarianceCv !== null && metrics.viewVarianceCv < PROSPECTION_LIMITS.viewBotCv && withViews >= PROSPECTION_LIMITS.viewBotMinPosts)
    flags.push("SUSPECT_VIEW_BOT");

  const texts = posts.filter((p) => p.text.trim().length > 0 && p.forwardedFrom === null);
  if (texts.length >= BOT_CONTENT_MIN_POSTS) {
    const lengths = texts.map((p) => p.text.trim().length).sort((a, b) => a - b);
    const mid = lengths[Math.floor(lengths.length / 2)]!;
    const sameLength = lengths.every((l) => Math.abs(l - mid) <= PROSPECTION_LIMITS.sameLengthTolerance);
    const sameStructure = new Set(texts.map(structureKey)).size === 1;
    if (sameLength && sameStructure) flags.push("SUSPECT_BOT_CONTENT");
  }

  const reactionsOn = posts.some((p) => p.reactions !== null);
  if (reactionsOn && (metrics.medianViews ?? 0) >= PROSPECTION_LIMITS.noEngagementMinViews && posts.length) {
    const silent = posts.filter((p) => (p.reactions ?? 0) + (p.comments ?? 0) === 0).length;
    if (silent / posts.length >= NO_ENGAGEMENT_SHARE) flags.push("SUSPECT_NO_ENGAGEMENT");
  }
  return flags;
}
