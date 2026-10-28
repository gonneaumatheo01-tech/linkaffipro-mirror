/**
 * Phase 32, chantier C — textes de Kevin pour la prospection avancée (alertes, réseaux, valeur estimée, affiliés
 * signés, calibrage, recherche par compte réel). Charte `docs/KEVIN-VOIX.md`, `voiceCheck` en CI (toutes les tables
 * `*_VARIANTS` des fichiers `prospection/kevin*.ts`). Une estimation reste une estimation : jamais un chiffre seul,
 * jamais « rapportera » ; « estimation non calibrée » tant qu'aucun vrai résultat ne l'a ajustée.
 */
import { voiceTemplate, type VoiceTable } from "../boss/voice";
import { plural } from "./kevin-texts";

const N1 = { name: "@pronos_fr" };

export const PROSPECTION_ADVANCED_KEVIN_VARIANTS = {
  notReady: [
    "Cette partie n'est pas encore prête de mon côté. Je te préviens dès qu'elle l'est.",
    "Je ne sais pas encore faire ça ici, ça arrive bientôt. Je te le dis quand c'est en place.",
  ],
  // ------------------------------------------------------------------------------------------ alertes
  alertsNone: ["Aucune alerte en ce moment ✅", "Rien à signaler sur tes prospects pour l'instant ✅"],
  droppedNone: ["Personne n'a lâché son bookmaker ces derniers temps.", "Aucun canal n'a arrêté de pousser sa marque pour l'instant."],
  growthNone: ["Aucun canal en forte hausse pour le moment.", "Pas d'étoile montante en ce moment."],
  alertsHead: voiceTemplate(
    [
      { count: 3, what: "du jour" },
      { count: 1, what: "" },
    ],
    (p) => [`${plural(p.count, "alerte", "alertes")}${p.what ? ` ${p.what}` : ""} :`, `J'ai ${p.count} ${p.count > 1 ? "alertes" : "alerte"}${p.what ? ` ${p.what}` : ""} :`],
  ),
  alertsMore: voiceTemplate([{ more: 4, url: "https://app.linkaffipro.com/agents/prospection/alertes" }], (p) => [`Et ${p.more} autres sur la page des alertes : ${p.url}`, `${p.more} de plus sur le site : ${p.url}`]),
  muteNeedKind: [
    "Quel type d'alerte tu veux couper ? Par exemple «\u00a0plus d'alertes de hausse\u00a0».",
    "Il me manque le type d'alerte. Dis-moi par exemple «\u00a0plus d'alertes de silence\u00a0».",
  ],
  muted: voiceTemplate([{ what: "canal en forte hausse" }], (p) => [
    `C'est coupé : plus d'alertes «\u00a0${p.what}\u00a0». Écris «\u00a0remets les alertes ${p.what}\u00a0» pour les retrouver.`,
    `Ok, je ne t'envoie plus d'alertes «\u00a0${p.what}\u00a0». Tu les remets quand tu veux.`,
  ]),
  unmuted: voiceTemplate([{ what: "canal en forte hausse" }], (p) => [`Les alertes «\u00a0${p.what}\u00a0» reviennent dès demain matin.`, `C'est remis, tu retrouves les alertes «\u00a0${p.what}\u00a0».`]),
  noteAsk: voiceTemplate([N1], (p) => [`Écris ta note sur ${p.name}, je l'ajoute à sa fiche.`, `Je t'écoute : ta note pour ${p.name} ?`]),
  // ------------------------------------------------------------------------------------------ réseaux
  networkNone: voiceTemplate([N1], (p) => [`${p.name} n'est dans aucun réseau pour l'instant : je ne lui trouve pas de canal jumeau.`, `Pas de réseau autour de ${p.name}, il a l'air seul.`]),
  mergeNeedTwo: ["Donne-moi au moins deux canaux, par exemple «\u00a0@a et @b c'est la même personne\u00a0».", "Il me faut deux canaux, comme «\u00a0@a et @b c'est la même personne\u00a0»."],
  mergeDone: voiceTemplate([{ names: "@pronos_fr et @slots_it" }], (p) => [`C'est noté, ${p.names} sont dans le même réseau. Un seul deal pour tous.`, `Fait, je traite ${p.names} comme une seule personne.`]),
  splitDone: voiceTemplate([N1], (p) => [`C'est fait, ${p.name} sort de son réseau. Je ne le regroupe plus avec les autres.`, `Ok, ${p.name} est de nouveau seul, je ne le remets plus dans ce réseau.`]),
  // ------------------------------------------------------------------------------------------ valeur
  valueNone: voiceTemplate([N1], (p) => [`Je n'ai pas encore d'estimation pour ${p.name} : il me manque ses vues ou une offre qui lui va.`, `Pas d'estimation possible pour ${p.name} pour l'instant, il me manque ses chiffres ou une offre.`]),
  uncalibrated: [
    "Estimation non calibrée : je n'ai pas encore assez de vrais résultats d'affiliés pour l'ajuster.",
    "C'est une estimation non calibrée, faute de vrais résultats d'affiliés pour la corriger.",
  ],
  pipelineNone: ["Je n'ai encore aucune valeur estimée dans ton pipeline.", "Aucun canal de ton pipeline n'a encore d'estimation."],
  // ------------------------------------------------------------------------------------------ affiliés
  affiliatesNone: [
    "Tu n'as pas encore d'affilié signé. Dès que tu me dis «\u00a0@x a signé\u00a0», je le suis ici.",
    "Aucun affilié signé pour l'instant. Écris «\u00a0@x a signé\u00a0» quand ça arrive.",
  ],
  affiliatesHead: voiceTemplate([{ count: 3 }, { count: 1 }], (p) => [`${plural(p.count, "affilié signé", "affiliés signés")} :`, `Tes affiliés, ${p.count} :`]),
  notLinked: voiceTemplate([N1], (p) => [
    `${p.name} n'est pas encore rattaché à Link Affi. Écris «\u00a0${p.name} = affilié 1234\u00a0» avec son numéro.`,
    `Il me manque le numéro Link Affi de ${p.name}. Tu me l'écris comme «\u00a0${p.name} = affilié 1234\u00a0» ?`,
  ]),
  perfNone: voiceTemplate([N1], (p) => [`Pas encore de résultat Link Affi pour ${p.name}. Je relis ses chiffres le 1er du mois.`, `Je n'ai encore aucun chiffre Link Affi pour ${p.name}, la relecture passe le 1er du mois.`]),
  linkNeedId: ["Il me manque le numéro d'affilié. Écris par exemple «\u00a0@x = affilié 1234\u00a0».", "Donne-moi son numéro Link Affi, comme «\u00a0@x = affilié 1234\u00a0»."],
  linkDone: voiceTemplate([{ name: "@pronos_fr", id: "1234" }], (p) => [
    `C'est rattaché : ${p.name} est l'affilié ${p.id}. Je lis ses vrais résultats chaque mois.`,
    `Fait, ${p.name} = affilié ${p.id}. Ses chiffres Link Affi arrivent avec la prochaine relecture.`,
  ]),
  linkNotSigned: voiceTemplate([N1], (p) => [`${p.name} n'est pas signé. Dis-moi d'abord «\u00a0${p.name} a signé\u00a0».`, `Je ne rattache que les signés, et ${p.name} ne l'est pas encore.`]),
  evrNone: [
    "Pas encore de comparaison : il me faut des affiliés rattachés avec au moins un mois de résultats.",
    "Je ne peux pas encore comparer, aucun affilié rattaché n'a un mois complet de chiffres.",
  ],
  arpuNeed: ["Il me manque le montant. Écris par exemple «\u00a0l'ARPU est de 80 €\u00a0».", "Combien rapporte un joueur déposant par mois ? Par exemple «\u00a080 € par mois\u00a0»."],
  arpuSet: voiceTemplate([{ amount: 80 }], (p) => [
    `C'est noté : un joueur déposant rapporte ${p.amount} € par mois. Les estimations en revshare en tiennent compte dès la prochaine mise à jour.`,
    `Ok, ${p.amount} € par mois et par joueur déposant. Je recalcule les fourchettes revshare avec ça.`,
  ]),
  arpuCurrent: voiceTemplate(
    [{ amount: 80 }, { amount: null }],
    (p) =>
      p.amount === null
        ? ["Je n'ai pas encore l'ARPU mensuel : sans lui, les offres en revshare n'ont pas d'estimation.", "Pas d'ARPU enregistré pour l'instant, donc pas d'estimation revshare."]
        : [`L'ARPU enregistré est de ${p.amount} € par mois et par joueur déposant.`, `Un joueur déposant compte pour ${p.amount} € par mois dans mes estimations.`],
  ),
  // ------------------------------------------------------------------------------------------ calibrage
  calibrationNone: [
    "Aucun réglage proposé en ce moment. J'en propose quand j'ai au moins 3 affiliés sur 30 jours dans un même groupe.",
    "Rien à ajuster pour l'instant : il me faut 3 affiliés et 30 jours de résultats dans un même groupe.",
  ],
  calibrationHead: voiceTemplate([{ count: 3 }], (p) => [`${plural(p.count, "réglage proposé", "réglages proposés")}, réponds par exemple «\u00a0applique 1\u00a0» :`, `J'ai ${p.count} ${p.count > 1 ? "propositions" : "proposition"}. Dis «\u00a0applique 1 et 3\u00a0» pour celles que tu veux :`]),
  calibrationNeedChoice: ["Lesquelles tu veux appliquer ? Réponds par exemple «\u00a0applique 1 et 3\u00a0».", "Donne-moi les numéros, comme «\u00a0applique 1\u00a0»."],
  calibrationApplied: voiceTemplate([{ choices: "1 et 3" }], (p) => [
    `C'est appliqué (${p.choices}). Je compare avant et après pendant 30 jours. Écris «\u00a0annule le calibrage\u00a0» pour revenir en arrière.`,
    `Fait pour ${p.choices}. Je suis l'effet pendant 30 jours, et «\u00a0annule le calibrage\u00a0» remet tout comme avant.`,
  ]),
  calibrationUndone: ["C'est annulé, les réglages sont revenus comme avant.", "Retour en arrière fait, tout est comme avant le calibrage."],
  // ------------------------------------------------------------------------------------------ compte réel
  accountOffer: [
    "Je peux chercher des canaux directement dans Telegram avec un compte réel, en lecture seule, sans rien rejoindre ni écrire. Ça trouve des canaux absents des annuaires. Tu confirmes ?",
  ],
  accountOfferLater: [
    "Si tu veux, je peux aussi chercher des canaux dans Telegram avec un compte réel, en lecture seule. Écris «\u00a0active la recherche par compte\u00a0» et je te demande confirmation.",
  ],
  accountConfirm: [
    "J'active la recherche par compte réel : lecture seule, rien rejoint ni écrit, 100 recherches par jour et par compte au plus.",
    "Recherche par compte réel en lecture seule, 100 recherches par jour et par compte au plus, je coupe au premier avertissement.",
  ],
  accountEnabled: [
    "C'est activé. La première recherche par compte tourne cette nuit, entre 2 h et 6 h. Je coupe tout seul au premier avertissement de Telegram.",
    "Activé. Je cherche avec le compte réel cette nuit, en lecture seule, et je m'arrête au moindre avertissement.",
  ],
  accountAlreadyOn: ["La recherche par compte réel est déjà active.", "C'est déjà activé de mon côté."],
  accountAlreadyOff: ["La recherche par compte réel est déjà coupée.", "C'est déjà coupé."],
  accountDisabled: ["C'est coupé, je ne cherche plus avec le compte réel.", "Ok, plus de recherche par compte réel. Les autres sources continuent."],
  accountState: voiceTemplate(
    [
      { on: true, today: 12, cap: 100 },
      { on: false, today: 0, cap: 100 },
    ],
    (p) =>
      p.on
        ? [`La recherche par compte réel est active : ${p.today} recherches aujourd'hui, ${p.cap} par compte au plus.`, `Active, avec ${p.today} recherches faites aujourd'hui sur ${p.cap} permises par compte.`]
        : ["La recherche par compte réel est coupée. Écris «\u00a0active la recherche par compte\u00a0» pour la lancer.", "Elle est coupée pour l'instant. Tu la lances avec «\u00a0active la recherche par compte\u00a0»."],
  ),
  accountFloodStopped: voiceTemplate([{ seconds: 120 }], (p) => [
    `Telegram a demandé de ralentir la recherche par compte réel (attente de ${p.seconds} s). Je l'ai coupée par sécurité, rien d'autre n'est touché. Écris «\u00a0active la recherche par compte\u00a0» pour la relancer plus tard.`,
    `Telegram m'a freiné pendant la recherche par compte réel (${p.seconds} s d'attente). Je l'ai coupée tout de suite. Tu la relances avec «\u00a0active la recherche par compte\u00a0» quand tu veux.`,
  ]),
  accountWarningStopped: [
    "Telegram a envoyé un avertissement au compte réel pendant la recherche. Je l'ai coupée tout de suite, le compte n'a rien rejoint ni écrit. Regarde le compte avant de la relancer.",
    "Avertissement de Telegram sur le compte réel : j'ai coupé la recherche aussitôt. Rien n'a été rejoint ni écrit. Vérifie le compte avant de relancer.",
  ],
  // ------------------------------------------------------------------------------------------ questions
  complexNoData: [
    "Je n'ai pas encore assez d'estimations ni de résultats pour répondre. Je te redis ça quand la relecture aura tourné.",
    "Pas assez de chiffres pour te répondre bien. Je reviens vers toi quand j'en aurai plus.",
  ],
} satisfies VoiceTable;
