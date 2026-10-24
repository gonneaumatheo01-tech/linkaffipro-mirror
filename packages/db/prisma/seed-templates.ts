// Bibliothèque de modèles de messages prêts à l'emploi, par univers et par thème. Idempotent.
// Clé technique : `Post.code` = `modele:<univers>:<thème>:<n>` (colonne unique) ; `templateName` = « <Univers> · <Thème> · <titre> ».
// Les modèles ne dépendent d'aucune catégorie (phase 8 : ce sont les clients qui créent les leurs) : `categoryId` reste
// vide et le thème vit dans le code (filtre « Thème » de la vue Modèles, `apps/web/lib/posts/queries.ts`).
// Exécution : `pnpm seed:templates` (lit `.env.local` à la racine). Ne touche jamais aux modèles créés par l'équipe.
// Phase 10 : un message de canal ne remplace aucun repère ({prenom}, {offre}, {canal}… partiraient tels quels) : les
// textes n'en contiennent plus. Un modèle qui parle de l'offre finit par une phrase d'appel et porte un bouton
// « Offre (campagne) » sans campagne : elle se choisit en utilisant le modèle (le message ne part pas sans elle).
// Les modèles déjà en base se mettent à jour avec `pnpm db:phase10` (`phase10-templates.ts`).
import { pathToFileURL } from "node:url";
import { PrismaClient, type Vertical } from "@prisma/client";

/** Mention obligatoire (casino et paris sportifs), en italique, en fin de message. */
export const RISK_NOTICE =
  "<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>";

/** `offer` : libellé du bouton « Offre (campagne) » sous le message (absent : aucun bouton). */
type Template = { title: string; text: string; offer?: string };
type Theme = keyof typeof THEME_LABELS;
type Library = Record<Vertical, Record<Theme, Template[]>>;

/**
 * Thèmes de la bibliothèque et leur libellé. Même table que `TEMPLATE_THEMES` côté site
 * (`apps/web/lib/posts/queries.ts`) : tout ajout se fait des deux côtés, `queries.test.ts` le vérifie.
 */
export const THEME_LABELS = {
  bonus: "Bonus",
  "preuve-de-gains": "Preuve de gains",
  teasing: "Teasing",
  rappel: "Rappel",
  information: "Information",
  evenement: "Événement",
  sondage: "Sondage",
} as const;

/** Libellés des boutons Offre (≤ 64 caractères, affichés tels quels sous le message). */
const PROFIT = "🎁 J'en profite";
const DISCOVER = "👉 Découvrir";
const START = "👉 Commencer";
const CTA = "👉 Appuyez sur le bouton ci-dessous pour en profiter.";

const CASINO: Record<Theme, Template[]> = {
  bonus: [
    {
      title: "Bonus de bienvenue",
      text: `Bonjour à tous,\n\nNotre casino partenaire propose un <b>bonus de bienvenue</b> aux nouveaux inscrits du canal.\nLes conditions (mise minimale, délai) sont indiquées sur la page de l'offre : lisez-les avant de jouer.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Tours gratuits",
      text: `Des <b>tours gratuits</b> sont disponibles cette semaine chez notre casino partenaire.\n\nIls s'activent après l'inscription, dans la rubrique « Promotions ». Aucune garantie de gain : jouez seulement ce que vous pouvez vous permettre de perdre.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Bonus de recharge",
      text: `Pour les membres du canal déjà inscrits chez notre casino partenaire : un <b>bonus de recharge</b> est proposé sur le prochain dépôt.\n\nDétails et conditions sur la page de l'offre. Fixez-vous une limite avant de déposer.\n\n${CTA}`,
      offer: PROFIT,
    },
  ],
  "preuve-de-gains": [
    {
      title: "Résultat d'un membre",
      text: "Un membre du canal a partagé son résultat de la semaine chez notre casino partenaire (capture ci-jointe).\n\nC'est son expérience, pas une promesse : les résultats varient et les pertes font partie du jeu.\n\n👉 Pour découvrir ce casino, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
    {
      title: "Retrait confirmé",
      text: "Retrait reçu par un membre après sa session chez notre casino partenaire : délai de traitement sous 48 h, comme annoncé.\n\nNous publions ces retours pour montrer que les paiements suivent, pas pour inciter à jouer plus.\n\n👉 Pour découvrir ce casino, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
    {
      title: "Bilan du mois",
      text: "Bilan du mois partagé par la communauté du canal : des gains pour certains, des pertes pour d'autres.\n\nLe jeu reste un loisir. Si vous sentez que ça vous échappe, faites une pause.",
    },
  ],
  teasing: [
    {
      title: "Nouveauté à venir",
      text: "Quelque chose de nouveau arrive sur le canal cette semaine chez notre casino partenaire…\n\nRestez à l'écoute : on vous dit tout dans les prochains jours.\n\n👉 Pour découvrir ce casino dès maintenant, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
    {
      title: "Nouveau jeu",
      text: "Un nouveau jeu vient d'être ajouté chez notre casino partenaire. On l'a testé : l'ambiance est au rendez-vous.\n\nOn vous en reparle ici avec nos impressions.\n\n👉 Pour le découvrir, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
    {
      title: "Indice du week-end",
      text: "Petit indice pour le week-end : une promotion réservée au canal se prépare chez notre casino partenaire.\n\nOuvrez l'œil samedi matin.\n\n👉 Pour découvrir ce casino dès maintenant, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
  ],
  rappel: [
    {
      title: "Offre bientôt terminée",
      text: `Rappel : <b>l'offre présentée sur le canal</b> se termine bientôt.\n\nSi elle vous intéresse, prenez le temps de lire les conditions avant d'y participer.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Dernier jour",
      text: `<b>Dernier jour</b> pour profiter de l'offre du moment.\n\nAucune obligation : jouez seulement si c'est un plaisir, avec un budget fixé à l'avance.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Inscription non terminée",
      text: "Vous avez commencé votre inscription chez notre casino partenaire sans la terminer ?\n\nLe lien est toujours valable : appuyez sur le bouton ci-dessous pour la reprendre. Prenez votre temps.",
      offer: "👉 Terminer mon inscription",
    },
  ],
  information: [
    {
      title: "Comment ça marche",
      text: "Comment fonctionne <b>notre casino partenaire</b> ?\n\n1. Inscription en 2 minutes.\n2. Dépôt du montant de votre choix (fixez une limite).\n3. Les gains se retirent depuis votre compte, après vérification d'identité.\n\nQuestions ? Répondez à ce message.\n\n👉 Pour commencer, appuyez sur le bouton ci-dessous.",
      offer: START,
    },
    {
      title: "Règles du canal",
      text: "Rappel des règles du canal :\n\n• Respect entre membres.\n• Pas de partage de liens extérieurs.\n• Les offres publiées ici sont vérifiées par l'équipe.\n\nMerci à tous.",
    },
    {
      title: "Jeu responsable",
      text: "Un mot sur le jeu responsable.\n\nFixez un budget, respectez-le, et ne jouez jamais pour « se refaire ». Besoin d'aide ? Joueurs Info Service : 09 74 75 13 13 (appel non surtaxé).",
    },
  ],
  evenement: [
    {
      title: "Tournoi",
      text: "<b>Tournoi</b> cette semaine chez notre casino partenaire : classement et lots annoncés sur la page de l'événement.\n\nParticipation facultative, dans la limite de votre budget.\n\n👉 Pour y participer, appuyez sur le bouton ci-dessous.",
      offer: "🏆 Participer",
    },
    {
      title: "Soirée live",
      text: "Ce soir à 21 h : session live commentée par l'équipe du canal.\n\nVenez poser vos questions en direct.",
    },
    {
      title: "Anniversaire du canal",
      text: `Le canal fête son anniversaire ! Merci à tous les membres.\n\nPour l'occasion, notre casino partenaire propose une <b>promotion dédiée</b> : détails et conditions sur la page de l'offre.\n\n${CTA}`,
      offer: PROFIT,
    },
  ],
  sondage: [
    {
      title: "Votre jeu préféré",
      text: "Sondage : quel type de jeu préférez-vous ?\n\n🎰 Machines à sous\n🃏 Blackjack\n🎡 Roulette\n\nRépondez en réaction, ça nous aide à choisir les prochaines offres.",
    },
    {
      title: "Horaire des publications",
      text: "À quelle heure lisez-vous le canal le plus souvent ?\n\n☀️ Matin\n🌤 Après-midi\n🌙 Soir\n\nRéagissez à ce message.",
    },
    {
      title: "Avis sur l'offre",
      text: "Vous avez testé <b>notre casino partenaire</b> ? Donnez votre avis en réaction :\n\n👍 Satisfait\n👎 Déçu\n🤔 Pas encore essayé\n\n👉 Pas encore essayé ? Appuyez sur le bouton ci-dessous pour le découvrir.",
      offer: DISCOVER,
    },
  ],
};

const SPORTS: Record<Theme, Template[]> = {
  bonus: [
    {
      title: "Pari de bienvenue",
      text: `Bonjour à tous,\n\nNotre site de paris partenaire propose un <b>premier pari remboursé</b> aux nouveaux inscrits du canal.\nConditions (cote minimale, délai) sur la page de l'offre.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Cote boostée",
      text: `<b>Cote boostée</b> ce week-end chez notre site de paris partenaire sur le match phare.\n\nUne cote boostée reste un pari : rien n'est garanti. Misez un montant raisonnable.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Bonus de recharge",
      text: `Déjà inscrit chez notre site de paris partenaire ? Un <b>bonus sur le prochain dépôt</b> est proposé aux membres du canal.\n\nDétails sur la page de l'offre. Gardez votre budget en tête.\n\n${CTA}`,
      offer: PROFIT,
    },
  ],
  "preuve-de-gains": [
    {
      title: "Ticket gagnant",
      text: "Ticket partagé par un membre du canal, joué chez notre site de paris partenaire (capture ci-jointe).\n\nC'est son résultat, pas une promesse : les paris perdants existent aussi, et souvent.\n\n👉 Pour découvrir ce site, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
    {
      title: "Retrait reçu",
      text: "Retrait reçu par un membre après un pari gagnant chez notre site de paris partenaire, traité en 24 h.\n\nOn publie ces retours pour montrer que les paiements suivent.\n\n👉 Pour découvrir ce site, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
    {
      title: "Bilan de la journée",
      text: "Bilan de la journée partagé par la communauté : quelques tickets gagnants, d'autres perdus.\n\nParier doit rester un plaisir, jamais une source de revenus.",
    },
  ],
  teasing: [
    {
      title: "Gros match à venir",
      text: "Le choc du week-end approche. L'équipe du canal prépare son analyse.\n\nRendez-vous samedi matin ici même.",
    },
    {
      title: "Nouvelle rubrique",
      text: "Nouveau sur le canal : une rubrique hebdomadaire d'analyses. Premier épisode cette semaine.\n\nUne analyse n'est pas un pronostic garanti.",
    },
    {
      title: "Indice promo",
      text: "Une promotion réservée au canal arrive chez notre site de paris partenaire pour le prochain grand match.\n\nOn vous dit tout dans les prochains jours.\n\n👉 Pour découvrir ce site dès maintenant, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
  ],
  rappel: [
    {
      title: "Coup d'envoi dans 1 h",
      text: "Coup d'envoi dans une heure. Si vous pariez chez notre site partenaire, vérifiez vos tickets avant le début du match.\n\nMisez seulement ce que vous pouvez vous permettre de perdre.\n\n👉 Pour ouvrir le site, appuyez sur le bouton ci-dessous.",
      offer: "⚽ Ouvrir le site",
    },
    {
      title: "Offre bientôt terminée",
      text: `Rappel : <b>l'offre présentée sur le canal</b> se termine bientôt.\n\nLisez les conditions avant d'y participer.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Inscription non terminée",
      text: "Vous avez commencé votre inscription chez notre site de paris partenaire sans la finir ? Le lien est toujours valable : appuyez sur le bouton ci-dessous pour la reprendre.",
      offer: "👉 Terminer mon inscription",
    },
  ],
  information: [
    {
      title: "Comment ça marche",
      text: "Comment parier chez <b>notre site partenaire</b> ?\n\n1. Inscription et vérification d'identité.\n2. Dépôt du montant de votre choix (fixez une limite).\n3. Choisissez un match, une cote, un montant.\n\nQuestions ? Répondez à ce message.\n\n👉 Pour commencer, appuyez sur le bouton ci-dessous.",
      offer: START,
    },
    {
      title: "Règles du canal",
      text: "Rappel des règles du canal :\n\n• Respect entre membres.\n• Pas de vente de pronostics.\n• Les offres publiées ici sont vérifiées par l'équipe.",
    },
    {
      title: "Jeu responsable",
      text: "Un mot sur le jeu responsable.\n\nFixez un budget de paris et tenez-le, ne pariez jamais pour vous refaire. Besoin d'aide ? Joueurs Info Service : 09 74 75 13 13 (appel non surtaxé).",
    },
  ],
  evenement: [
    {
      title: "Programme du week-end",
      text: "Programme du week-end sur le canal : analyses des principaux matchs, publiées la veille de chaque rencontre.\n\nUne analyse n'est pas un pronostic garanti.",
    },
    {
      title: "Soirée live",
      text: "Ce soir à 20 h 45 : suivi du match en direct avec l'équipe du canal. Venez échanger.",
    },
    {
      title: "Grande compétition",
      text: `La compétition commence ! Notre site de paris partenaire propose une <b>promotion dédiée</b> pendant toute sa durée : détails et conditions sur la page de l'offre.\n\n${CTA}`,
      offer: PROFIT,
    },
  ],
  sondage: [
    {
      title: "Votre sport",
      text: "Sondage : quel sport suivez-vous le plus ?\n\n⚽ Football\n🎾 Tennis\n🏀 Basket\n\nRépondez en réaction.",
    },
    {
      title: "Horaire des publications",
      text: "À quelle heure lisez-vous le canal le plus souvent ?\n\n☀️ Matin\n🌤 Après-midi\n🌙 Soir\n\nRéagissez à ce message.",
    },
    {
      title: "Avis sur l'offre",
      text: "Vous avez testé <b>notre site de paris partenaire</b> ? Votre avis en réaction :\n\n👍 Satisfait\n👎 Déçu\n🤔 Pas encore essayé\n\n👉 Pas encore essayé ? Appuyez sur le bouton ci-dessous pour le découvrir.",
      offer: DISCOVER,
    },
  ],
};

const DATING: Record<Theme, Template[]> = {
  bonus: [
    {
      title: "Essai gratuit",
      text: `Bonjour à tous,\n\nNotre site de rencontres partenaire offre une <b>période d'essai</b> aux nouveaux membres du canal.\nInscription en quelques minutes, sans engagement.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Crédits offerts",
      text: `Des <b>crédits de bienvenue</b> sont offerts à l'inscription chez notre site de rencontres partenaire cette semaine.\n\nDétails sur la page de l'offre.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Abonnement à prix réduit",
      text: `Pour les membres du canal : l'abonnement à notre site de rencontres partenaire est proposé <b>à prix réduit</b> pendant quelques jours.\n\nConditions sur la page de l'offre.\n\n${CTA}`,
      offer: PROFIT,
    },
  ],
  "preuve-de-gains": [
    {
      title: "Témoignage",
      text: "Témoignage d'un membre du canal inscrit sur notre site de rencontres partenaire : « Première rencontre après dix jours, une vraie discussion. »\n\nChaque expérience est différente.\n\n👉 Pour découvrir ce site, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
    {
      title: "Chiffres de la semaine",
      text: "Cette semaine sur notre site de rencontres partenaire : des milliers de nouveaux profils actifs dans votre région.\n\nLes chiffres viennent de la plateforme.\n\n👉 Pour découvrir ce site, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
    {
      title: "Retour d'expérience",
      text: "Retour d'un membre après un mois sur notre site de rencontres partenaire : profils sérieux, messagerie simple, pas de mauvaise surprise sur la facturation.\n\n👉 Pour découvrir ce site, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
  ],
  teasing: [
    {
      title: "Nouvelle plateforme",
      text: "L'équipe du canal a testé une nouvelle plateforme de rencontres.\n\nNotre avis complet arrive dans les prochains jours.",
    },
    {
      title: "Nouveauté à venir",
      text: "Une nouvelle fonctionnalité arrive sur notre site de rencontres partenaire : on vous en parle très bientôt ici.\n\n👉 Pour découvrir ce site dès maintenant, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
    {
      title: "Indice du week-end",
      text: "Indice pour le week-end : une offre réservée au canal se prépare sur notre site de rencontres partenaire. Ouvrez l'œil samedi.\n\n👉 Pour découvrir ce site dès maintenant, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
  ],
  rappel: [
    {
      title: "Offre bientôt terminée",
      text: `Rappel : <b>l'offre présentée sur le canal</b> se termine bientôt.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Profil non terminé",
      text: "Votre profil sur notre site de rencontres partenaire n'est pas terminé ? Une photo et quelques lignes suffisent pour recevoir vos premiers messages.\n\n👉 Pour le compléter, appuyez sur le bouton ci-dessous.",
      offer: "👉 Compléter mon profil",
    },
    {
      title: "Dernier jour",
      text: `<b>Dernier jour</b> pour profiter de l'offre réservée aux membres du canal.\n\n${CTA}`,
      offer: PROFIT,
    },
  ],
  information: [
    {
      title: "Comment ça marche",
      text: "Comment fonctionne <b>notre site de rencontres partenaire</b> ?\n\n1. Inscription gratuite.\n2. Profil avec photo.\n3. Messagerie avec les profils qui vous plaisent.\n\nQuestions ? Répondez à ce message.\n\n👉 Pour commencer, appuyez sur le bouton ci-dessous.",
      offer: START,
    },
    {
      title: "Règles du canal",
      text: "Rappel des règles du canal :\n\n• Respect et bienveillance.\n• Aucune donnée personnelle partagée ici.\n• Les plateformes publiées sont vérifiées par l'équipe.",
    },
    {
      title: "Conseils de sécurité",
      text: "Conseils de sécurité pour vos rencontres en ligne :\n\n• Ne partagez jamais vos coordonnées bancaires.\n• Première rencontre dans un lieu public.\n• Signalez tout profil suspect à la plateforme.",
    },
  ],
  evenement: [
    {
      title: "Soirée en ligne",
      text: "Ce soir à 21 h : <b>soirée de rencontres en ligne</b> organisée par notre site partenaire. Inscription sur la page de l'événement.\n\n👉 Pour vous inscrire, appuyez sur le bouton ci-dessous.",
      offer: "💬 Je m'inscris",
    },
    {
      title: "Saint-Valentin",
      text: `Saint-Valentin approche : notre site de rencontres partenaire propose une <b>offre dédiée</b> aux membres du canal. Détails sur la page de l'offre.\n\n${CTA}`,
      offer: PROFIT,
    },
    {
      title: "Anniversaire du canal",
      text: "Le canal fête son anniversaire ! Merci à tous les membres. Une surprise vous attend sur notre site de rencontres partenaire cette semaine.\n\n👉 Pour la découvrir, appuyez sur le bouton ci-dessous.",
      offer: DISCOVER,
    },
  ],
  sondage: [
    {
      title: "Ce que vous cherchez",
      text: "Sondage : que cherchez-vous en priorité ?\n\n❤️ Une relation sérieuse\n😊 Des rencontres amicales\n🤔 Je ne sais pas encore\n\nRépondez en réaction.",
    },
    {
      title: "Horaire des publications",
      text: "À quelle heure lisez-vous le canal le plus souvent ?\n\n☀️ Matin\n🌤 Après-midi\n🌙 Soir\n\nRéagissez à ce message.",
    },
    {
      title: "Avis sur la plateforme",
      text: "Vous avez testé <b>notre site de rencontres partenaire</b> ? Votre avis en réaction :\n\n👍 Satisfait\n👎 Déçu\n🤔 Pas encore essayé\n\n👉 Pas encore essayé ? Appuyez sur le bouton ci-dessous pour le découvrir.",
      offer: DISCOVER,
    },
  ],
};

export const LIBRARY: Library = { CASINO, SPORTS, DATING };
export const VERTICAL_LABELS: Record<Vertical, string> = {
  CASINO: "Casino",
  SPORTS: "Paris sportifs",
  DATING: "Rencontres",
};

function withRisk(vertical: Vertical, text: string): string {
  return vertical === "DATING" ? text : `${text}\n\n${RISK_NOTICE}`;
}

/**
 * Bouton « Offre (campagne) » d'un modèle, au format de `Post.buttons` (type OFFER, voir
 * `apps/worker/src/sending/keyboard.ts`) : ni campagne, ni offre, ni lien. « Utiliser » le modèle demande de choisir la
 * campagne ; le message est refusé tant qu'elle n'est pas choisie (`apps/web/lib/campaigns/offer-button.ts`).
 */
export type TemplateOfferButton = { text: string; type: "OFFER" };

/** Ligne d'un modèle de la bibliothèque, sans canal ni bot (ajoutés à l'insertion). */
export type TemplateRow = {
  code: string;
  templateName: string;
  vertical: Vertical;
  categoryId: null;
  text: string;
  /** Lignes de boutons : `[[bouton Offre]]` si le modèle parle de l'offre, sinon aucune. */
  buttons: TemplateOfferButton[][];
};

/** Les 63 modèles (fonction pure) : code `modele:<univers>:<thème>:<n>`, nom « <Univers> · <Thème> · <titre> », sans catégorie. */
export function buildTemplateRows(vertical?: Vertical): TemplateRow[] {
  const verticals = vertical ? [vertical] : (Object.keys(LIBRARY) as Vertical[]);
  return verticals.flatMap((v) =>
    (Object.entries(LIBRARY[v]) as Array<[Theme, Template[]]>).flatMap(([theme, list]) =>
      list.map((t, i) => ({
        code: `modele:${v.toLowerCase()}:${theme}:${i + 1}`,
        templateName: `${VERTICAL_LABELS[v]} · ${THEME_LABELS[theme]} · ${t.title}`,
        vertical: v,
        categoryId: null,
        text: withRisk(v, t.text),
        buttons: t.offer ? [[{ text: t.offer, type: "OFFER" as const }]] : [],
      })),
    ),
  );
}

/** Accès base utilisé par le script (un PrismaClient ; une base simulée dans les tests). */
export type TemplateDb = Pick<PrismaClient, "channel" | "bot" | "post">;

/** Canal porteur des modèles d'un univers : premier canal actif de l'univers, sinon premier canal actif. */
async function carrierChannel(db: TemplateDb, vertical: Vertical) {
  const include = {
    primaryBot: true,
    botAdmins: { where: { revokedAt: null }, include: { bot: true } },
  } as const;
  const byVertical = await db.channel.findFirst({
    where: { isActive: true, vertical },
    orderBy: { createdAt: "asc" },
    include,
  });
  const channel =
    byVertical ??
    (await db.channel.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      include,
    }));
  if (!channel) return null;
  const bot =
    (channel.primaryBot?.isActive ? channel.primaryBot : null) ??
    channel.botAdmins.find((a) => a.bot.isActive)?.bot ??
    (await db.bot.findFirst({
      where: { isActive: true, vertical, role: "CHANNEL" },
      orderBy: { createdAt: "asc" },
    })) ??
    (await db.bot.findFirst({ where: { isActive: true, role: "CHANNEL" }, orderBy: { createdAt: "asc" } }));
  if (!bot) return null;
  return { channelId: channel.id, channelTitle: channel.title, botId: bot.id };
}

/** Insère les modèles absents (clé : `Post.code`), univers par univers. Idempotent : un modèle déjà présent n'est jamais modifié. */
export async function seedTemplates(
  db: TemplateDb,
  log: (message: string) => void = console.log,
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const vertical of Object.keys(LIBRARY) as Vertical[]) {
    const carrier = await carrierChannel(db, vertical);
    if (!carrier) {
      log(
        `[seed:templates] ${VERTICAL_LABELS[vertical]} : aucun canal actif avec un bot actif, modèles non insérés (ajoutez un canal puis relancez).`,
      );
      continue;
    }
    for (const row of buildTemplateRows(vertical)) {
      const existing = await db.post.findUnique({
        where: { code: row.code },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await db.post.create({
        data: {
          ...row,
          channelId: carrier.channelId,
          botId: carrier.botId,
          status: "DRAFT",
          isTemplate: true,
          language: "fr",
          mediaAssetIds: [],
          disableLinkPreview: true,
        },
      });
      created++;
    }
    log(
      `[seed:templates] ${VERTICAL_LABELS[vertical]} : canal porteur « ${carrier.channelTitle} ».`,
    );
  }
  log(`[seed:templates] ${created} modèle(s) créé(s), ${skipped} déjà présent(s).`);
  return { created, skipped };
}

// Exécuté seulement en script (`pnpm seed:templates`), pas à l'import (tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  seedTemplates(prisma)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
