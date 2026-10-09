// Bibliothèque de modèles de messages prêts à l'emploi, par univers et par catégorie. Idempotent.
// Clé technique : `Post.code` = `modele:<univers>:<categorie>:<n>` (colonne unique) ; `templateName` = titre lisible.
// Exécution : `pnpm seed:templates` (lit `.env.local` à la racine). Ne touche jamais aux modèles créés par l'équipe.
import { PrismaClient, type Vertical } from "@prisma/client";

const prisma = new PrismaClient();

/** Mention obligatoire (casino et paris sportifs), en italique, en fin de message. */
const RISK = "<i>Jouer comporte des risques : endettement, isolement, dépendance.</i>";

type Template = { title: string; text: string };
type Library = Record<Vertical, Record<string, Template[]>>;

const CASINO: Record<string, Template[]> = {
  bonus: [
    {
      title: "Bonus de bienvenue",
      text: "Bonjour {prenom},\n\n<b>{offre}</b> propose un bonus de bienvenue aux nouveaux inscrits du canal {canal}.\nLes conditions (mise minimale, délai) sont indiquées sur la page de l'offre : lisez-les avant de jouer.\n\n👉 Le lien est dans le bouton ci-dessous.",
    },
    {
      title: "Tours gratuits",
      text: "{prenom}, des tours gratuits sont disponibles cette semaine chez <b>{offre}</b>.\n\nIls s'activent après l'inscription, dans la rubrique « Promotions ». Aucune garantie de gain : jouez seulement ce que vous pouvez vous permettre de perdre.",
    },
    {
      title: "Bonus de recharge",
      text: "Pour les membres de {canal} déjà inscrits chez <b>{offre}</b> : un bonus de recharge est proposé sur le prochain dépôt.\n\nDétails et conditions sur la page de l'offre. Fixez-vous une limite avant de déposer.",
    },
  ],
  "preuve-de-gains": [
    {
      title: "Résultat d'un membre",
      text: "Un membre de {canal} a partagé son résultat de la semaine chez <b>{offre}</b> (capture ci-jointe).\n\nC'est son expérience, pas une promesse : les résultats varient et les pertes font partie du jeu.",
    },
    {
      title: "Retrait confirmé",
      text: "Retrait reçu par un membre après sa session chez <b>{offre}</b> : délai de traitement sous 48 h, comme annoncé.\n\nNous publions ces retours pour montrer que les paiements suivent, pas pour inciter à jouer plus.",
    },
    {
      title: "Bilan du mois",
      text: "Bilan du mois partagé par la communauté {canal} : des gains pour certains, des pertes pour d'autres.\n\nLe jeu reste un loisir. Si vous sentez que ça vous échappe, faites une pause.",
    },
  ],
  teasing: [
    {
      title: "Nouveauté à venir",
      text: "{prenom}, quelque chose de nouveau arrive sur {canal} cette semaine chez <b>{offre}</b>…\n\nRestez à l'écoute : on vous dit tout dans les prochains jours.",
    },
    {
      title: "Nouveau jeu",
      text: "Un nouveau jeu vient d'être ajouté chez <b>{offre}</b>. On l'a testé : l'ambiance est au rendez-vous.\n\nOn vous en reparle ici avec nos impressions.",
    },
    {
      title: "Indice du week-end",
      text: "Petit indice pour le week-end : une promotion spéciale {canal} se prépare chez <b>{offre}</b>.\n\nOuvrez l'œil samedi matin.",
    },
  ],
  rappel: [
    {
      title: "Offre bientôt terminée",
      text: "Rappel : l'offre <b>{offre}</b> présentée sur {canal} se termine bientôt.\n\nSi elle vous intéresse, prenez le temps de lire les conditions avant d'y participer.",
    },
    {
      title: "Dernier jour",
      text: "{prenom}, dernier jour pour profiter de l'offre <b>{offre}</b>.\n\nAucune obligation : jouez seulement si c'est un plaisir, avec un budget fixé à l'avance.",
    },
    {
      title: "Inscription non terminée",
      text: "Vous avez commencé votre inscription chez <b>{offre}</b> sans la terminer ?\n\nLe lien est toujours valable dans le bouton ci-dessous. Prenez votre temps.",
    },
  ],
  information: [
    {
      title: "Comment ça marche",
      text: "Comment fonctionne <b>{offre}</b> ?\n\n1. Inscription en 2 minutes.\n2. Dépôt du montant de votre choix (fixez une limite).\n3. Les gains se retirent depuis votre compte, après vérification d'identité.\n\nQuestions ? Répondez à ce message.",
    },
    {
      title: "Règles du canal",
      text: "Rappel des règles de {canal} :\n\n• Respect entre membres.\n• Pas de partage de liens extérieurs.\n• Les offres publiées ici sont vérifiées par l'équipe.\n\nMerci à tous.",
    },
    {
      title: "Jeu responsable",
      text: "Un mot sur le jeu responsable.\n\nFixez un budget, respectez-le, et ne jouez jamais pour « se refaire ». Besoin d'aide ? Joueurs Info Service : 09 74 75 13 13 (appel non surtaxé).",
    },
  ],
  evenement: [
    {
      title: "Tournoi",
      text: "Tournoi cette semaine chez <b>{offre}</b> : classement et lots annoncés sur la page de l'événement.\n\nParticipation facultative, dans la limite de votre budget.",
    },
    {
      title: "Soirée live",
      text: "{prenom}, ce soir à 21 h : session live commentée par l'équipe de {canal}.\n\nVenez poser vos questions en direct.",
    },
    {
      title: "Anniversaire du canal",
      text: "{canal} fête son anniversaire ! Merci à tous les membres.\n\nPour l'occasion, <b>{offre}</b> propose une promotion dédiée : détails et conditions sur la page de l'offre.",
    },
  ],
  sondage: [
    {
      title: "Votre jeu préféré",
      text: "Sondage : quel type de jeu préférez-vous ?\n\n🎰 Machines à sous\n🃏 Blackjack\n🎡 Roulette\n\nRépondez en réaction, ça nous aide à choisir les prochaines offres.",
    },
    {
      title: "Horaire des publications",
      text: "À quelle heure lisez-vous {canal} le plus souvent ?\n\n☀️ Matin\n🌤 Après-midi\n🌙 Soir\n\nRéagissez à ce message.",
    },
    {
      title: "Avis sur l'offre",
      text: "Vous avez testé <b>{offre}</b> ? Donnez votre avis en réaction :\n\n👍 Satisfait\n👎 Déçu\n🤔 Pas encore essayé",
    },
  ],
};

const SPORTS: Record<string, Template[]> = {
  bonus: [
    {
      title: "Pari de bienvenue",
      text: "Bonjour {prenom},\n\n<b>{offre}</b> propose un premier pari remboursé aux nouveaux inscrits de {canal}.\nConditions (cote minimale, délai) sur la page de l'offre.",
    },
    {
      title: "Cote boostée",
      text: "Cote boostée ce week-end chez <b>{offre}</b> sur le match phare.\n\nUne cote boostée reste un pari : rien n'est garanti. Misez un montant raisonnable.",
    },
    {
      title: "Bonus de recharge",
      text: "Déjà inscrit chez <b>{offre}</b> ? Un bonus sur le prochain dépôt est proposé aux membres de {canal}.\n\nDétails sur la page de l'offre. Gardez votre budget en tête.",
    },
  ],
  "preuve-de-gains": [
    {
      title: "Ticket gagnant",
      text: "Ticket partagé par un membre de {canal} chez <b>{offre}</b> (capture ci-jointe).\n\nC'est son résultat, pas une promesse : les paris perdants existent aussi, et souvent.",
    },
    {
      title: "Retrait reçu",
      text: "Retrait reçu par un membre après un pari gagnant chez <b>{offre}</b>, traité en 24 h.\n\nOn publie ces retours pour montrer que les paiements suivent.",
    },
    {
      title: "Bilan de la journée",
      text: "Bilan de la journée partagé par la communauté : quelques tickets gagnants, d'autres perdus.\n\nParier doit rester un plaisir, jamais une source de revenus.",
    },
  ],
  teasing: [
    {
      title: "Gros match à venir",
      text: "{prenom}, le choc du week-end approche. L'équipe de {canal} prépare son analyse.\n\nRendez-vous samedi matin ici même.",
    },
    {
      title: "Nouvelle rubrique",
      text: "Nouveau sur {canal} : une rubrique hebdomadaire d'analyses. Premier épisode cette semaine.\n\nUne analyse n'est pas un pronostic garanti.",
    },
    {
      title: "Indice promo",
      text: "Une promotion spéciale {canal} arrive chez <b>{offre}</b> pour le prochain grand match.\n\nOn vous dit tout dans les prochains jours.",
    },
  ],
  rappel: [
    {
      title: "Coup d'envoi dans 1 h",
      text: "Coup d'envoi dans une heure. Si vous pariez chez <b>{offre}</b>, vérifiez vos tickets avant le début du match.\n\nMisez seulement ce que vous pouvez vous permettre de perdre.",
    },
    {
      title: "Offre bientôt terminée",
      text: "Rappel : l'offre <b>{offre}</b> présentée sur {canal} se termine bientôt.\n\nLisez les conditions avant d'y participer.",
    },
    {
      title: "Inscription non terminée",
      text: "{prenom}, vous avez commencé votre inscription chez <b>{offre}</b> sans la finir ? Le lien est toujours valable dans le bouton ci-dessous.",
    },
  ],
  information: [
    {
      title: "Comment ça marche",
      text: "Comment parier chez <b>{offre}</b> ?\n\n1. Inscription et vérification d'identité.\n2. Dépôt du montant de votre choix (fixez une limite).\n3. Choisissez un match, une cote, un montant.\n\nQuestions ? Répondez à ce message.",
    },
    {
      title: "Règles du canal",
      text: "Rappel des règles de {canal} :\n\n• Respect entre membres.\n• Pas de vente de pronostics.\n• Les offres publiées ici sont vérifiées par l'équipe.",
    },
    {
      title: "Jeu responsable",
      text: "Un mot sur le jeu responsable.\n\nFixez un budget de paris et tenez-le, ne pariez jamais pour vous refaire. Besoin d'aide ? Joueurs Info Service : 09 74 75 13 13 (appel non surtaxé).",
    },
  ],
  evenement: [
    {
      title: "Programme du week-end",
      text: "Programme du week-end sur {canal} : analyses des principaux matchs, publiées la veille de chaque rencontre.\n\nUne analyse n'est pas un pronostic garanti.",
    },
    {
      title: "Soirée live",
      text: "{prenom}, ce soir à 20 h 45 : suivi du match en direct avec l'équipe de {canal}. Venez échanger.",
    },
    {
      title: "Grande compétition",
      text: "La compétition commence ! <b>{offre}</b> propose une promotion dédiée pendant toute sa durée : détails et conditions sur la page de l'offre.",
    },
  ],
  sondage: [
    {
      title: "Votre sport",
      text: "Sondage : quel sport suivez-vous le plus ?\n\n⚽ Football\n🎾 Tennis\n🏀 Basket\n\nRépondez en réaction.",
    },
    {
      title: "Horaire des publications",
      text: "À quelle heure lisez-vous {canal} le plus souvent ?\n\n☀️ Matin\n🌤 Après-midi\n🌙 Soir\n\nRéagissez à ce message.",
    },
    {
      title: "Avis sur l'offre",
      text: "Vous avez testé <b>{offre}</b> ? Votre avis en réaction :\n\n👍 Satisfait\n👎 Déçu\n🤔 Pas encore essayé",
    },
  ],
};

const DATING: Record<string, Template[]> = {
  bonus: [
    {
      title: "Essai gratuit",
      text: "Bonjour {prenom},\n\n<b>{offre}</b> offre une période d'essai aux nouveaux membres de {canal}.\nInscription en quelques minutes, sans engagement.",
    },
    {
      title: "Crédits offerts",
      text: "Des crédits de bienvenue sont offerts à l'inscription chez <b>{offre}</b> cette semaine.\n\nDétails sur la page de l'offre.",
    },
    {
      title: "Abonnement à prix réduit",
      text: "Pour les membres de {canal} : l'abonnement <b>{offre}</b> est proposé à prix réduit pendant quelques jours.\n\nConditions sur la page de l'offre.",
    },
  ],
  "preuve-de-gains": [
    {
      title: "Témoignage",
      text: "Témoignage d'un membre de {canal} inscrit chez <b>{offre}</b> : « Première rencontre après dix jours, une vraie discussion. »\n\nChaque expérience est différente.",
    },
    {
      title: "Chiffres de la semaine",
      text: "Cette semaine chez <b>{offre}</b> : des milliers de nouveaux profils actifs dans votre région.\n\nLes chiffres viennent de la plateforme.",
    },
    {
      title: "Retour d'expérience",
      text: "Retour d'un membre après un mois sur <b>{offre}</b> : profils sérieux, messagerie simple, pas de mauvaise surprise sur la facturation.",
    },
  ],
  teasing: [
    {
      title: "Nouvelle plateforme",
      text: "{prenom}, l'équipe de {canal} a testé une nouvelle plateforme de rencontres.\n\nNotre avis complet arrive dans les prochains jours.",
    },
    {
      title: "Nouveauté à venir",
      text: "Une nouvelle fonctionnalité arrive chez <b>{offre}</b> : on vous en parle très bientôt sur {canal}.",
    },
    {
      title: "Indice du week-end",
      text: "Indice pour le week-end : une offre spéciale {canal} se prépare chez <b>{offre}</b>. Ouvrez l'œil samedi.",
    },
  ],
  rappel: [
    {
      title: "Offre bientôt terminée",
      text: "Rappel : l'offre <b>{offre}</b> présentée sur {canal} se termine bientôt. Le lien est dans le bouton ci-dessous.",
    },
    {
      title: "Profil non terminé",
      text: "{prenom}, votre profil chez <b>{offre}</b> n'est pas terminé ? Une photo et quelques lignes suffisent pour recevoir vos premiers messages.",
    },
    {
      title: "Dernier jour",
      text: "Dernier jour pour profiter de l'offre <b>{offre}</b> réservée aux membres de {canal}.",
    },
  ],
  information: [
    {
      title: "Comment ça marche",
      text: "Comment fonctionne <b>{offre}</b> ?\n\n1. Inscription gratuite.\n2. Profil avec photo.\n3. Messagerie avec les profils qui vous plaisent.\n\nQuestions ? Répondez à ce message.",
    },
    {
      title: "Règles du canal",
      text: "Rappel des règles de {canal} :\n\n• Respect et bienveillance.\n• Aucune donnée personnelle partagée ici.\n• Les plateformes publiées sont vérifiées par l'équipe.",
    },
    {
      title: "Conseils de sécurité",
      text: "Conseils de sécurité pour vos rencontres en ligne :\n\n• Ne partagez jamais vos coordonnées bancaires.\n• Première rencontre dans un lieu public.\n• Signalez tout profil suspect à la plateforme.",
    },
  ],
  evenement: [
    {
      title: "Soirée en ligne",
      text: "{prenom}, ce soir à 21 h : soirée de rencontres en ligne organisée par <b>{offre}</b>. Inscription sur la page de l'événement.",
    },
    {
      title: "Saint-Valentin",
      text: "Saint-Valentin approche : <b>{offre}</b> propose une offre dédiée aux membres de {canal}. Détails sur la page de l'offre.",
    },
    {
      title: "Anniversaire du canal",
      text: "{canal} fête son anniversaire ! Merci à tous les membres. Une surprise vous attend chez <b>{offre}</b> cette semaine.",
    },
  ],
  sondage: [
    {
      title: "Ce que vous cherchez",
      text: "Sondage : que cherchez-vous en priorité ?\n\n❤️ Une relation sérieuse\n😊 Des rencontres amicales\n🤔 Je ne sais pas encore\n\nRépondez en réaction.",
    },
    {
      title: "Horaire des publications",
      text: "À quelle heure lisez-vous {canal} le plus souvent ?\n\n☀️ Matin\n🌤 Après-midi\n🌙 Soir\n\nRéagissez à ce message.",
    },
    {
      title: "Avis sur la plateforme",
      text: "Vous avez testé <b>{offre}</b> ? Votre avis en réaction :\n\n👍 Satisfait\n👎 Déçu\n🤔 Pas encore essayé",
    },
  ],
};

const LIBRARY: Library = { CASINO, SPORTS, DATING };
const VERTICAL_LABELS: Record<Vertical, string> = { CASINO: "Casino", SPORTS: "Paris sportifs", DATING: "Rencontres" };

function withRisk(vertical: Vertical, text: string): string {
  return vertical === "DATING" ? text : `${text}\n\n${RISK}`;
}

/** Canal porteur des modèles d'un univers : premier canal actif de l'univers, sinon premier canal actif. */
async function carrierChannel(vertical: Vertical) {
  const byVertical = await prisma.channel.findFirst({
    where: { isActive: true, vertical },
    orderBy: { createdAt: "asc" },
    include: { primaryBot: true, botAdmins: { where: { revokedAt: null }, include: { bot: true } } },
  });
  const channel =
    byVertical ??
    (await prisma.channel.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      include: { primaryBot: true, botAdmins: { where: { revokedAt: null }, include: { bot: true } } },
    }));
  if (!channel) return null;
  const bot =
    (channel.primaryBot?.isActive ? channel.primaryBot : null) ??
    channel.botAdmins.find((a) => a.bot.isActive)?.bot ??
    (await prisma.bot.findFirst({ where: { isActive: true, vertical }, orderBy: { createdAt: "asc" } })) ??
    (await prisma.bot.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } }));
  if (!bot) return null;
  return { channelId: channel.id, channelTitle: channel.title, botId: bot.id };
}

async function main() {
  const categories = await prisma.messageCategory.findMany({ select: { id: true, slug: true, name: true } });
  const catBySlug = new Map(categories.map((c) => [c.slug, c]));
  let created = 0;
  let skipped = 0;
  let missingCats = 0;
  for (const vertical of Object.keys(LIBRARY) as Vertical[]) {
    const carrier = await carrierChannel(vertical);
    if (!carrier) {
      console.log(`[seed:templates] ${VERTICAL_LABELS[vertical]} : aucun canal actif avec un bot actif, modèles non insérés (ajoutez un canal puis relancez).`);
      continue;
    }
    for (const [slug, list] of Object.entries(LIBRARY[vertical])) {
      const cat = catBySlug.get(slug);
      if (!cat) {
        missingCats++;
        console.log(`[seed:templates] catégorie « ${slug} » absente : lancez d'abord pnpm db:seed.`);
        continue;
      }
      for (const [i, t] of list.entries()) {
        const code = `modele:${vertical.toLowerCase()}:${slug}:${i + 1}`;
        const existing = await prisma.post.findUnique({ where: { code }, select: { id: true } });
        if (existing) {
          skipped++;
          continue;
        }
        await prisma.post.create({
          data: {
            code,
            channelId: carrier.channelId,
            botId: carrier.botId,
            status: "DRAFT",
            isTemplate: true,
            templateName: `${VERTICAL_LABELS[vertical]} · ${cat.name} · ${t.title}`,
            vertical,
            categoryId: cat.id,
            language: "fr",
            text: withRisk(vertical, t.text),
            mediaAssetIds: [],
            buttons: [],
            disableLinkPreview: true,
          },
        });
        created++;
      }
    }
    console.log(`[seed:templates] ${VERTICAL_LABELS[vertical]} : canal porteur « ${carrier.channelTitle} ».`);
  }
  console.log(`[seed:templates] ${created} modèle(s) créé(s), ${skipped} déjà présent(s)${missingCats ? `, ${missingCats} catégorie(s) manquante(s)` : ""}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
