/**
 * « aide » de Kevin (phase 26, voix de la phase 33) : une phrase d'introduction humaine, puis une ligne par thème du
 * catalogue avec des EXEMPLES DE PHRASES qui marchent (plutôt que des descriptions), puis une phrase de fin. Seuls les
 * thèmes présents dans le catalogue sont montrés (une seule source : ajouter une action d'un nouveau thème l'ajoute à
 * l'aide). C'est une liste demandée : la longueur et les puces sont permises (`voiceCheck` avec `allowList` et
 * `allowLong`). 25 lignes au plus, HTML Telegram échappé. Pur (sauf la rotation des variantes).
 */
import { esc } from "../admin/journal";
import type { BossAction, BossTheme } from "./contract";
import { pick, voiceTemplate, type VoiceTable } from "./voice";
import type { SiteDomain, SiteOpMeta } from "../site/contract";
import { SITE_DOMAIN_LABELS, listSiteOps, siteOpsByDomain } from "../site/registry";

/** Phase 34 : thèmes du catalogue + un domaine du site par ligne (tout se fait par Kevin). */
export const BOSS_HELP_MAX_LINES = 40;
/** Détail d'un domaine (« aide campagnes ») : une ligne par opération, 20 au plus. */
export const BOSS_DOMAIN_HELP_MAX = 20;

/** Titres des thèmes, dans l'ordre d'affichage. */
export const BOSS_THEME_LABELS: Record<BossTheme, string> = {
  guide: "Démarrer",
  etat: "État",
  chiffres: "Chiffres",
  demandes: "Demandes et validations",
  equipes: "Équipes",
  canaux: "Canaux",
  rencontres: "Rencontres",
  casino: "Casino",
  paris: "Paris sportifs",
  algorithme: "Algorithme",
  ads: "Pubs",
  tests: "Essais",
};

/** Exemples de phrases par thème (ce que le client peut écrire tel quel). */
export const BOSS_THEME_EXAMPLES: Record<BossTheme, readonly string[]> = {
  guide: ["commencer", "qui fait quoi dans l'équipe ?"],
  etat: ["où en sont les agents ?", "envoie le rapport du jour"],
  chiffres: ["combien j'ai dépensé ce mois ?", "les résultats sur 7 jours"],
  demandes: ["qu'est-ce qui attend ma réponse ?", "ok 12"],
  equipes: ["mets le casino en pause", "passe le dating en vrai"],
  canaux: ["où en est Roulette Pro ?", "mets 3 posts par jour sur Roulette Pro"],
  rencontres: ["montre-moi les personas", "il reste combien de vidéos pour Léa ?"],
  casino: ["c'est quoi les thèmes casino ?", "quelle offre passe sur Roulette Pro ?"],
  paris: ["les paris du jour", "active les corners"],
  algorithme: ["qu'est-ce que l'algorithme propose cette semaine ?", "inspire-toi de t.me/uncanal pour Roulette Pro"],
  ads: ["qu'est-ce que tu conseilles sur mes pubs ?", "montre les seuils des pubs"],
  tests: ["fais un post de test casino", "sors-moi un pari de test corners"],
};

/** Les 5 exemples généraux (gardés pour la compatibilité : ils sont tous dans les thèmes ci-dessus). */
export const BOSS_HELP_EXAMPLES = [
  "mets le casino en pause",
  "combien j'ai dépensé ce mois ?",
  "passe le dating en vrai",
  "qu'est-ce qui attend ma réponse ?",
  "commencer",
] as const;

const LIST_RULES = { allowList: true, allowLong: true } as const;

export const HELP_VARIANTS = {
  intro: voiceTemplate(
    [{ name: "Kevin" }],
    (p: { name: string }) => [
      "Parle-moi comme à un collègue, par écrit ou en vocal. Des phrases qui marchent :",
      `Écris-moi comme tu parles, ${p.name} s'occupe du reste. Par exemple :`,
      "Pas besoin de commande exacte, dis-moi juste ce que tu veux. Quelques idées :",
    ],
    LIST_RULES,
  ),
  domainIntro: voiceTemplate(
    [{ label: "Campagnes" }],
    (p: { label: string }) => [`${p.label} : dis-moi par exemple`, `Pour ${p.label.toLowerCase()}, des phrases qui marchent :`],
    LIST_RULES,
  ),
  domainEmpty: voiceTemplate([{ label: "Campagnes" }], (p: { label: string }) => [
    `${p.label}, je ne sais encore rien y faire. Écris aide pour la liste.`,
    `Rien encore côté ${p.label.toLowerCase()}. Écris aide pour voir le reste.`,
  ]),
  domainOutro: [
    "Dis-le avec tes mots, je comprends aussi les variantes.",
    "Pas besoin de la phrase exacte, je m'adapte.",
  ],
  outro: [
    "Si je ne sais pas faire, je te le dis et je le note pour la suite.",
    "Un truc que je ne sais pas faire ? Je te le dis franchement et je le note.",
    "Le reste, demande toujours : au pire je te dis que je ne sais pas encore.",
  ],
} satisfies VoiceTable;

/** Ligne d'un thème : « • Casino : « … », « … » » (texte brut, l'appelant échappe). */
function themeLine(theme: BossTheme): string {
  const ex = BOSS_THEME_EXAMPLES[theme].map((e) => `« ${e} »`).join(", ");
  return `• ${BOSS_THEME_LABELS[theme]} : ${ex}`;
}

/** Ligne d'un domaine du site : « • Campagnes : « … », « … » » (2 exemples, d'opérations différentes si possible). */
export function domainLine(domain: SiteDomain, ops: readonly Pick<SiteOpMeta, "examples">[]): string | null {
  const firsts = ops.map((o) => o.examples[0]).filter((e): e is string => !!e?.trim());
  const pickEx = [...new Set(firsts.length >= 2 ? firsts : ops.flatMap((o) => o.examples))].slice(0, 2);
  if (!pickEx.length) return null;
  return `• ${SITE_DOMAIN_LABELS[domain]} : ${pickEx.map((e) => `« ${e} »`).join(", ")}`;
}

export function bossHelpText(
  catalog: readonly Pick<BossAction, "key" | "description" | "theme">[],
  name = "Kevin",
  chatId?: bigint | string | null,
  siteOps: readonly SiteOpMeta[] = listSiteOps(),
): string {
  const present = new Set<BossTheme>();
  for (const a of catalog) if (a.description?.trim()) present.add(a.theme);
  const themes = (Object.keys(BOSS_THEME_LABELS) as BossTheme[]).filter((t) => present.has(t));
  const head = pick(HELP_VARIANTS.intro({ name: esc(name) }), "help.intro", chatId ?? null);
  const body = themes.map((t) => esc(themeLine(t)));
  // Phase 34 : un domaine du site par ligne, 2 exemples chacun (« aide campagnes » détaille).
  const domains = [...siteOpsByDomain(siteOps)].map(([d, ops]) => domainLine(d, ops)).filter((l): l is string => !!l).map(esc);
  const tail = pick(HELP_VARIANTS.outro, "help.outro", chatId ?? null);
  return [head, ...[...body, ...domains].slice(0, BOSS_HELP_MAX_LINES - 2), tail].join("\n");
}

/** « aide campagnes » : une ligne par opération du domaine (description et première phrase type). */
export function bossDomainHelpText(domain: SiteDomain, chatId?: bigint | string | null, siteOps: readonly SiteOpMeta[] = listSiteOps()): string {
  const label = SITE_DOMAIN_LABELS[domain];
  const ops = siteOps.filter((o) => o.domain === domain);
  if (!ops.length) return pick(HELP_VARIANTS.domainEmpty({ label: esc(label) }), "help.domain.empty", chatId ?? null);
  const head = pick(HELP_VARIANTS.domainIntro({ label: esc(label) }), "help.domain.intro", chatId ?? null);
  const body = ops.slice(0, BOSS_DOMAIN_HELP_MAX).map((o) => esc(`• ${o.description.replace(/[.\s]+$/, "")} : « ${o.examples[0] ?? o.description} »`));
  return [head, ...body, pick(HELP_VARIANTS.domainOutro, "help.domain.outro", chatId ?? null)].join("\n");
}

/** Toutes les formes de l'aide (tests de la voix) : catalogue complet de tous les thèmes. */
export const HELP_FULL_VARIANTS = {
  full: voiceTemplate(
    [{ name: "Kevin" }],
    (p: { name: string }) => {
      const all = (Object.keys(BOSS_THEME_LABELS) as BossTheme[]).map((t) => ({ key: t, theme: t, description: "x" }));
      return HELP_VARIANTS.intro(p).flatMap((intro) =>
        HELP_VARIANTS.outro.map((outro) => [intro, ...all.map((a) => esc(themeLine(a.theme))), outro].join("\n")),
      );
    },
    LIST_RULES,
  ),
} satisfies VoiceTable;
