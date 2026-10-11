// Phase 10 : réécriture en base des 63 modèles fournis (`pnpm seed:templates`). Idempotente, relançable sans risque.
//   pnpm db:phase10                                   (base de `.env.local`)
//   railway ssh --service web -- pnpm db:phase10      (production)
//
// Les modèles d'origine contenaient {prenom}, {offre} et {canal}, qu'un message de canal ne remplace pas : ils
// partaient tels quels. La bibliothèque (`seed-templates.ts`) est réécrite sans repère, avec une phrase d'appel et un
// bouton « Offre (campagne) » (campagne choisie à l'utilisation) pour chaque modèle qui citait l'offre.
//
// Règle : un modèle fourni (même `Post.code` « modele:… ») n'est mis à jour QUE s'il est resté tel que la bibliothèque
// l'a inséré : texte d'origine exact, aucun bouton, aucun média, nom de la bibliothèque, et jamais enregistré depuis le
// site (« Modifier » renseigne `updatedById`, quel que soit le champ changé : catégorie, langue, options…). Un modèle
// modifié par l'équipe, sur n'importe quel point, n'est jamais touché. La mise à jour est conditionnée en base (texte
// d'origine, date de dernière modification et absence d'enregistrement depuis le site relus dans la même requête) : une
// modification faite par l'équipe pendant le passage du script l'emporte. Chaque modèle réécrit est inscrit au journal
// des actions (`post.template_rewritten`), avec un résumé par passage (`maintenance.phase10_templates`).
// Un modèle absent n'est pas créé ici : `pnpm seed:templates` insère directement la nouvelle version.
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { buildTemplateRows, type TemplateRow } from "./seed-templates";

/** Action du journal pour chaque modèle réécrit, et pour le résumé d'un passage. */
export const TEMPLATE_REWRITTEN_ACTION = "post.template_rewritten";
export const PHASE10_SUMMARY_ACTION = "maintenance.phase10_templates";

export type Phase10Report = {
  /** Modèles réécrits par ce passage. */
  updated: string[];
  /** Déjà au texte et aux boutons de la phase 10 (passage précédent, ou modèle inchangé). */
  upToDate: string[];
  /** Modifiés par l'équipe (texte, boutons, média, nom, ou enregistrés depuis le site) : jamais touchés. */
  keptByTeam: string[];
  /** Absents de la base (à créer avec `pnpm seed:templates`). */
  missing: string[];
};

/** Accès base utilisé par le script (un PrismaClient ; une base simulée dans les tests unitaires). */
export type Phase10Db = Pick<PrismaClient, "post" | "auditLog">;

function isEmptyButtons(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

function sameButtons(value: unknown, expected: TemplateRow["buttons"]): boolean {
  return JSON.stringify(value ?? []) === JSON.stringify(expected);
}

/** Champs d'un modèle en base relus par le script. */
type StoredTemplate = {
  text: string;
  buttons: unknown;
  mediaAssetIds: unknown;
  templateName: string | null;
  updatedById: string | null;
};

/**
 * Vrai si le modèle est resté tel que la bibliothèque l'a inséré avant la phase 10 (règle pure) : texte d'origine
 * exact, aucun bouton, aucun média, nom de la bibliothèque, jamais enregistré depuis le site. Sinon l'équipe y a
 * touché : le script le laisse tel quel.
 */
export function isUntouchedOriginal(post: StoredTemplate, row: TemplateRow): boolean {
  const original = PHASE9_TEMPLATE_TEXTS[row.code];
  return (
    original !== undefined &&
    post.text === original &&
    isEmptyButtons(post.buttons) &&
    isEmptyButtons(post.mediaAssetIds) &&
    post.templateName === row.templateName &&
    post.updatedById === null
  );
}

/**
 * Réécrit les modèles fournis encore à leur texte d'origine. `log` reçoit le résumé lisible. Retourne les codes
 * classés : réécrits, déjà à jour, gardés (modifiés par l'équipe), absents.
 */
export async function rewriteTemplates(
  db: Phase10Db,
  log: (message: string) => void = console.log,
): Promise<Phase10Report> {
  const rows = buildTemplateRows();
  const existing = await db.post.findMany({
    where: { code: { in: rows.map((r) => r.code) }, isTemplate: true },
    select: {
      id: true,
      code: true,
      text: true,
      buttons: true,
      mediaAssetIds: true,
      templateName: true,
      updatedById: true,
      updatedAt: true,
    },
  });
  const byCode = new Map(existing.map((p) => [p.code, p]));
  const report: Phase10Report = { updated: [], upToDate: [], keptByTeam: [], missing: [] };
  // Nom affiché dans le résumé : le nom actuel du modèle (celui que l'équipe voit), sinon celui de la bibliothèque.
  const names = new Map(
    rows.map((r) => [r.code, byCode.get(r.code)?.templateName || r.templateName]),
  );

  for (const row of rows) {
    const post = byCode.get(row.code);
    if (!post) {
      report.missing.push(row.code);
      continue;
    }
    if (post.text === row.text && sameButtons(post.buttons, row.buttons)) {
      report.upToDate.push(row.code);
      continue;
    }
    if (!isUntouchedOriginal(post, row)) {
      report.keptByTeam.push(row.code);
      continue;
    }
    // Écriture conditionnelle : si l'équipe a modifié le modèle entre la lecture et l'écriture, rien n'est écrit.
    const res = await db.post.updateMany({
      where: { id: post.id, text: post.text, updatedAt: post.updatedAt, updatedById: null },
      data: { text: row.text, buttons: row.buttons as unknown as Prisma.InputJsonValue },
    });
    if (res.count === 0) {
      report.keptByTeam.push(row.code);
      continue;
    }
    await db.auditLog.create({
      data: {
        action: TEMPLATE_REWRITTEN_ACTION,
        entityType: "Post",
        entityId: post.id,
        metadata: {
          code: row.code,
          templateName: row.templateName,
          reason: "phase10",
          offerButton: row.buttons.length > 0,
        },
      },
    });
    report.updated.push(row.code);
  }

  await db.auditLog.create({
    data: {
      action: PHASE10_SUMMARY_ACTION,
      entityType: "System",
      metadata: report as unknown as Prisma.InputJsonValue,
    },
  });

  log(
    `[phase10] ${rows.length} modèles fournis : ${report.updated.length} réécrit(s), ${report.upToDate.length} déjà à jour, ${report.keptByTeam.length} modifié(s) par l'équipe (non touché(s)), ${report.missing.length} absent(s).`,
  );
  for (const code of report.keptByTeam)
    log(`[phase10] modèle « ${names.get(code)} » modifié par l'équipe : non touché.`);
  if (report.missing.length)
    log(
      `[phase10] ${report.missing.length} modèle(s) absent(s) : lancez « pnpm seed:templates » pour les créer (nouvelle version).`,
    );
  return report;
}

/**
 * Texte d'origine (phase 9) de chaque modèle fourni, mention des risques comprise, tel que `pnpm seed:templates` l'a
 * inséré avant la phase 10. Ne jamais modifier : c'est la référence qui dit si l'équipe a touché à un modèle.
 */
export const PHASE9_TEMPLATE_TEXTS: Readonly<Record<string, string>> = {
  "modele:casino:bonus:1":
    "Bonjour {prenom},\n\n<b>{offre}</b> propose un bonus de bienvenue aux nouveaux inscrits du canal {canal}.\nLes conditions (mise minimale, délai) sont indiquées sur la page de l'offre : lisez-les avant de jouer.\n\n👉 Le lien est dans le bouton ci-dessous.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:bonus:2":
    "{prenom}, des tours gratuits sont disponibles cette semaine chez <b>{offre}</b>.\n\nIls s'activent après l'inscription, dans la rubrique « Promotions ». Aucune garantie de gain : jouez seulement ce que vous pouvez vous permettre de perdre.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:bonus:3":
    "Pour les membres de {canal} déjà inscrits chez <b>{offre}</b> : un bonus de recharge est proposé sur le prochain dépôt.\n\nDétails et conditions sur la page de l'offre. Fixez-vous une limite avant de déposer.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:preuve-de-gains:1":
    "Un membre de {canal} a partagé son résultat de la semaine chez <b>{offre}</b> (capture ci-jointe).\n\nC'est son expérience, pas une promesse : les résultats varient et les pertes font partie du jeu.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:preuve-de-gains:2":
    "Retrait reçu par un membre après sa session chez <b>{offre}</b> : délai de traitement sous 48 h, comme annoncé.\n\nNous publions ces retours pour montrer que les paiements suivent, pas pour inciter à jouer plus.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:preuve-de-gains:3":
    "Bilan du mois partagé par la communauté {canal} : des gains pour certains, des pertes pour d'autres.\n\nLe jeu reste un loisir. Si vous sentez que ça vous échappe, faites une pause.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:teasing:1":
    "{prenom}, quelque chose de nouveau arrive sur {canal} cette semaine chez <b>{offre}</b>…\n\nRestez à l'écoute : on vous dit tout dans les prochains jours.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:teasing:2":
    "Un nouveau jeu vient d'être ajouté chez <b>{offre}</b>. On l'a testé : l'ambiance est au rendez-vous.\n\nOn vous en reparle ici avec nos impressions.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:teasing:3":
    "Petit indice pour le week-end : une promotion spéciale {canal} se prépare chez <b>{offre}</b>.\n\nOuvrez l'œil samedi matin.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:rappel:1":
    "Rappel : l'offre <b>{offre}</b> présentée sur {canal} se termine bientôt.\n\nSi elle vous intéresse, prenez le temps de lire les conditions avant d'y participer.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:rappel:2":
    "{prenom}, dernier jour pour profiter de l'offre <b>{offre}</b>.\n\nAucune obligation : jouez seulement si c'est un plaisir, avec un budget fixé à l'avance.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:rappel:3":
    "Vous avez commencé votre inscription chez <b>{offre}</b> sans la terminer ?\n\nLe lien est toujours valable dans le bouton ci-dessous. Prenez votre temps.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:information:1":
    "Comment fonctionne <b>{offre}</b> ?\n\n1. Inscription en 2 minutes.\n2. Dépôt du montant de votre choix (fixez une limite).\n3. Les gains se retirent depuis votre compte, après vérification d'identité.\n\nQuestions ? Répondez à ce message.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:information:2":
    "Rappel des règles de {canal} :\n\n• Respect entre membres.\n• Pas de partage de liens extérieurs.\n• Les offres publiées ici sont vérifiées par l'équipe.\n\nMerci à tous.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:information:3":
    "Un mot sur le jeu responsable.\n\nFixez un budget, respectez-le, et ne jouez jamais pour « se refaire ». Besoin d'aide ? Joueurs Info Service : 09 74 75 13 13 (appel non surtaxé).\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:evenement:1":
    "Tournoi cette semaine chez <b>{offre}</b> : classement et lots annoncés sur la page de l'événement.\n\nParticipation facultative, dans la limite de votre budget.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:evenement:2":
    "{prenom}, ce soir à 21 h : session live commentée par l'équipe de {canal}.\n\nVenez poser vos questions en direct.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:evenement:3":
    "{canal} fête son anniversaire ! Merci à tous les membres.\n\nPour l'occasion, <b>{offre}</b> propose une promotion dédiée : détails et conditions sur la page de l'offre.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:sondage:1":
    "Sondage : quel type de jeu préférez-vous ?\n\n🎰 Machines à sous\n🃏 Blackjack\n🎡 Roulette\n\nRépondez en réaction, ça nous aide à choisir les prochaines offres.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:sondage:2":
    "À quelle heure lisez-vous {canal} le plus souvent ?\n\n☀️ Matin\n🌤 Après-midi\n🌙 Soir\n\nRéagissez à ce message.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:casino:sondage:3":
    "Vous avez testé <b>{offre}</b> ? Donnez votre avis en réaction :\n\n👍 Satisfait\n👎 Déçu\n🤔 Pas encore essayé\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:bonus:1":
    "Bonjour {prenom},\n\n<b>{offre}</b> propose un premier pari remboursé aux nouveaux inscrits de {canal}.\nConditions (cote minimale, délai) sur la page de l'offre.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:bonus:2":
    "Cote boostée ce week-end chez <b>{offre}</b> sur le match phare.\n\nUne cote boostée reste un pari : rien n'est garanti. Misez un montant raisonnable.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:bonus:3":
    "Déjà inscrit chez <b>{offre}</b> ? Un bonus sur le prochain dépôt est proposé aux membres de {canal}.\n\nDétails sur la page de l'offre. Gardez votre budget en tête.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:preuve-de-gains:1":
    "Ticket partagé par un membre de {canal} chez <b>{offre}</b> (capture ci-jointe).\n\nC'est son résultat, pas une promesse : les paris perdants existent aussi, et souvent.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:preuve-de-gains:2":
    "Retrait reçu par un membre après un pari gagnant chez <b>{offre}</b>, traité en 24 h.\n\nOn publie ces retours pour montrer que les paiements suivent.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:preuve-de-gains:3":
    "Bilan de la journée partagé par la communauté : quelques tickets gagnants, d'autres perdus.\n\nParier doit rester un plaisir, jamais une source de revenus.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:teasing:1":
    "{prenom}, le choc du week-end approche. L'équipe de {canal} prépare son analyse.\n\nRendez-vous samedi matin ici même.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:teasing:2":
    "Nouveau sur {canal} : une rubrique hebdomadaire d'analyses. Premier épisode cette semaine.\n\nUne analyse n'est pas un pronostic garanti.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:teasing:3":
    "Une promotion spéciale {canal} arrive chez <b>{offre}</b> pour le prochain grand match.\n\nOn vous dit tout dans les prochains jours.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:rappel:1":
    "Coup d'envoi dans une heure. Si vous pariez chez <b>{offre}</b>, vérifiez vos tickets avant le début du match.\n\nMisez seulement ce que vous pouvez vous permettre de perdre.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:rappel:2":
    "Rappel : l'offre <b>{offre}</b> présentée sur {canal} se termine bientôt.\n\nLisez les conditions avant d'y participer.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:rappel:3":
    "{prenom}, vous avez commencé votre inscription chez <b>{offre}</b> sans la finir ? Le lien est toujours valable dans le bouton ci-dessous.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:information:1":
    "Comment parier chez <b>{offre}</b> ?\n\n1. Inscription et vérification d'identité.\n2. Dépôt du montant de votre choix (fixez une limite).\n3. Choisissez un match, une cote, un montant.\n\nQuestions ? Répondez à ce message.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:information:2":
    "Rappel des règles de {canal} :\n\n• Respect entre membres.\n• Pas de vente de pronostics.\n• Les offres publiées ici sont vérifiées par l'équipe.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:information:3":
    "Un mot sur le jeu responsable.\n\nFixez un budget de paris et tenez-le, ne pariez jamais pour vous refaire. Besoin d'aide ? Joueurs Info Service : 09 74 75 13 13 (appel non surtaxé).\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:evenement:1":
    "Programme du week-end sur {canal} : analyses des principaux matchs, publiées la veille de chaque rencontre.\n\nUne analyse n'est pas un pronostic garanti.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:evenement:2":
    "{prenom}, ce soir à 20 h 45 : suivi du match en direct avec l'équipe de {canal}. Venez échanger.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:evenement:3":
    "La compétition commence ! <b>{offre}</b> propose une promotion dédiée pendant toute sa durée : détails et conditions sur la page de l'offre.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:sondage:1":
    "Sondage : quel sport suivez-vous le plus ?\n\n⚽ Football\n🎾 Tennis\n🏀 Basket\n\nRépondez en réaction.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:sondage:2":
    "À quelle heure lisez-vous {canal} le plus souvent ?\n\n☀️ Matin\n🌤 Après-midi\n🌙 Soir\n\nRéagissez à ce message.\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:sports:sondage:3":
    "Vous avez testé <b>{offre}</b> ? Votre avis en réaction :\n\n👍 Satisfait\n👎 Déçu\n🤔 Pas encore essayé\n\n<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>",
  "modele:dating:bonus:1":
    "Bonjour {prenom},\n\n<b>{offre}</b> offre une période d'essai aux nouveaux membres de {canal}.\nInscription en quelques minutes, sans engagement.",
  "modele:dating:bonus:2":
    "Des crédits de bienvenue sont offerts à l'inscription chez <b>{offre}</b> cette semaine.\n\nDétails sur la page de l'offre.",
  "modele:dating:bonus:3":
    "Pour les membres de {canal} : l'abonnement <b>{offre}</b> est proposé à prix réduit pendant quelques jours.\n\nConditions sur la page de l'offre.",
  "modele:dating:preuve-de-gains:1":
    "Témoignage d'un membre de {canal} inscrit chez <b>{offre}</b> : « Première rencontre après dix jours, une vraie discussion. »\n\nChaque expérience est différente.",
  "modele:dating:preuve-de-gains:2":
    "Cette semaine chez <b>{offre}</b> : des milliers de nouveaux profils actifs dans votre région.\n\nLes chiffres viennent de la plateforme.",
  "modele:dating:preuve-de-gains:3":
    "Retour d'un membre après un mois sur <b>{offre}</b> : profils sérieux, messagerie simple, pas de mauvaise surprise sur la facturation.",
  "modele:dating:teasing:1":
    "{prenom}, l'équipe de {canal} a testé une nouvelle plateforme de rencontres.\n\nNotre avis complet arrive dans les prochains jours.",
  "modele:dating:teasing:2":
    "Une nouvelle fonctionnalité arrive chez <b>{offre}</b> : on vous en parle très bientôt sur {canal}.",
  "modele:dating:teasing:3":
    "Indice pour le week-end : une offre spéciale {canal} se prépare chez <b>{offre}</b>. Ouvrez l'œil samedi.",
  "modele:dating:rappel:1":
    "Rappel : l'offre <b>{offre}</b> présentée sur {canal} se termine bientôt. Le lien est dans le bouton ci-dessous.",
  "modele:dating:rappel:2":
    "{prenom}, votre profil chez <b>{offre}</b> n'est pas terminé ? Une photo et quelques lignes suffisent pour recevoir vos premiers messages.",
  "modele:dating:rappel:3":
    "Dernier jour pour profiter de l'offre <b>{offre}</b> réservée aux membres de {canal}.",
  "modele:dating:information:1":
    "Comment fonctionne <b>{offre}</b> ?\n\n1. Inscription gratuite.\n2. Profil avec photo.\n3. Messagerie avec les profils qui vous plaisent.\n\nQuestions ? Répondez à ce message.",
  "modele:dating:information:2":
    "Rappel des règles de {canal} :\n\n• Respect et bienveillance.\n• Aucune donnée personnelle partagée ici.\n• Les plateformes publiées sont vérifiées par l'équipe.",
  "modele:dating:information:3":
    "Conseils de sécurité pour vos rencontres en ligne :\n\n• Ne partagez jamais vos coordonnées bancaires.\n• Première rencontre dans un lieu public.\n• Signalez tout profil suspect à la plateforme.",
  "modele:dating:evenement:1":
    "{prenom}, ce soir à 21 h : soirée de rencontres en ligne organisée par <b>{offre}</b>. Inscription sur la page de l'événement.",
  "modele:dating:evenement:2":
    "Saint-Valentin approche : <b>{offre}</b> propose une offre dédiée aux membres de {canal}. Détails sur la page de l'offre.",
  "modele:dating:evenement:3":
    "{canal} fête son anniversaire ! Merci à tous les membres. Une surprise vous attend chez <b>{offre}</b> cette semaine.",
  "modele:dating:sondage:1":
    "Sondage : que cherchez-vous en priorité ?\n\n❤️ Une relation sérieuse\n😊 Des rencontres amicales\n🤔 Je ne sais pas encore\n\nRépondez en réaction.",
  "modele:dating:sondage:2":
    "À quelle heure lisez-vous {canal} le plus souvent ?\n\n☀️ Matin\n🌤 Après-midi\n🌙 Soir\n\nRéagissez à ce message.",
  "modele:dating:sondage:3":
    "Vous avez testé <b>{offre}</b> ? Votre avis en réaction :\n\n👍 Satisfait\n👎 Déçu\n🤔 Pas encore essayé",
};

// Exécuté directement (pnpm db:phase10) ; importé par les tests sans rien lancer.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  rewriteTemplates(prisma)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
