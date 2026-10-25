/**
 * Phase 35, chantier D — textes fixes de Kevin sur les bookmakers lus directement (voix de Kevin,
 * `docs/KEVIN-VOIX.md`) : identifiants, santé des sites (avec le geste à faire), apprentissage, test, navigateur du
 * Mac, matchs et cotes. 2 à 4 variantes chacun, contrôlées par `voice.test.ts` (table `BOOKMAKERS_VARIANTS`).
 * Le bookmaker lu et la façon de lire (lecture directe, page, image) ne sont jamais dans un rapport : seulement ici,
 * quand le client parle des bookmakers.
 */
import { voiceTemplate, voiceVariants, type VoiceTable } from "./voice";

type Site = { site: string };

export const BOOKMAKERS_VARIANTS = {
  // ---------------------------------------------------------------------------------------- identifiants
  askLogin: [
    "Pour lire les matchs et les cotes chez nos bookmakers, il me faut l'e-mail du compte (le même sur tous les sites). Réponds à ce message avec l'e-mail, je l'efface aussitôt. Ou « plus tard ».",
    "J'ai besoin de l'e-mail du compte bookmaker, le même pour tous les sites. Réponds à ce message avec, je l'efface tout de suite. Ou « plus tard ».",
  ],
  askPassword: [
    "Maintenant le mot de passe du compte bookmaker. Réponds à ce message, je l'efface aussitôt. Personne ne le voit, l'IA non plus, et je ne mise jamais.",
    "Et le mot de passe du compte bookmaker ? Réponds à ce message, je l'efface tout de suite. Il reste chiffré, et je ne mise jamais.",
  ],
  credentialsSaved: [
    "C'est rangé pour tous les bookmakers ✅ Je ne les montre à personne.",
    "Fait, ça vaut pour tous les bookmakers ✅ Ils restent chiffrés.",
  ],
  credentialsIncomplete: [
    "Il me manque l'e-mail ou le mot de passe, rien n'est rangé. Tu m'écris « identifiants bookmakers » pour recommencer ?",
    "Je n'ai pas les deux, donc rien n'est rangé. On recommence avec « identifiants bookmakers » ?",
  ],
  credentialsAlready: [
    "J'ai déjà les identifiants des bookmakers ✅ S'ils ont changé, écris « nouveaux identifiants bookmakers ».",
    "Les identifiants des bookmakers sont déjà rangés ✅ S'ils ont changé, écris « nouveaux identifiants bookmakers ».",
  ],
  credentialsAsked: [
    "Je te les demande en privé, une question à la fois. Je les efface aussitôt.",
    "Je te pose la question en privé, l'e-mail puis le mot de passe. J'efface tes messages aussitôt.",
  ],
  credentialsPending: [
    "Je t'ai déjà posé la question en privé, j'attends ta réponse.",
    "La question est déjà partie en privé, je t'attends.",
  ],
  askTestAll: [
    "Je teste les sites d'un coup ? Connexion et une lecture des matchs, aucune mise. Réponds oui ou non.",
    "On teste tous les bookmakers maintenant ? Juste la connexion et la liste des matchs, aucune mise. Oui ou non ?",
  ],
  testAllLater: [
    "Ok, je ne teste rien pour l'instant. Écris « teste les bookmakers » quand tu veux.",
    "Pas de test pour l'instant. Tu me dis « teste les bookmakers » quand tu veux.",
  ],
  testAllUnavailable: [
    "Je ne peux pas lancer le test tout de suite. Tu réessaies avec « teste les bookmakers » dans quelques minutes ?",
    "Le test ne part pas pour l'instant. On réessaie dans quelques minutes ?",
  ],
  testAllNothing: [
    "Aucun bookmaker à tester pour l'instant : il manque leurs adresses.",
    "Rien à tester : aucun bookmaker n'a d'adresse pour l'instant.",
  ],
  testAllStarted: voiceTemplate([{ n: 1 }, { n: 3 }], (p: { n: number }) => [
    `C'est lancé sur ${p.n > 1 ? `les ${p.n} sites` : "le site"}. Je te dis dans quelques minutes si ça passe.`,
    `Je teste ${p.n > 1 ? `les ${p.n} bookmakers` : "le bookmaker"}, résultat dans quelques minutes.`,
  ]),

  // ---------------------------------------------------------------------------------------- santé
  blockedCaptcha: voiceTemplate([{ site: "Sportaza" }], (p: Site) => [
    `${p.site} me demande de prouver que je suis humain, je ne peux plus lire ⚠️ Écris « ouvre le navigateur sur le Mac » et fais le contrôle à la main.`,
    `${p.site} bloque la lecture avec un contrôle anti-robot ⚠️ Dis-moi « ouvre le navigateur sur le Mac », puis passe le contrôle toi-même.`,
  ]),
  blockedTwoFactor: voiceTemplate([{ site: "Celsius" }], (p: Site) => [
    `${p.site} demande un code de connexion ⚠️ Écris « ouvre le navigateur sur le Mac » et tape le code reçu.`,
    `Il faut un code pour se connecter à ${p.site} ⚠️ Dis-moi « ouvre le navigateur sur le Mac » et saisis le code là-bas.`,
  ]),
  blockedPassword: voiceTemplate([{ site: "Bet Portal" }], (p: Site) => [
    `${p.site} refuse le mot de passe ⚠️ Il a changé ? Écris « nouveaux identifiants bookmakers » et je te les redemande en privé.`,
    `Le mot de passe ne passe plus chez ${p.site} ⚠️ Dis-moi « nouveaux identifiants bookmakers », je te les redemande en privé.`,
  ]),
  blockedMoved: voiceTemplate([{ site: "Bet Portal" }], (p: Site) => [
    `Je ne trouve plus le site de ${p.site} ⚠️ Il a changé d'adresse ? Dis-moi par exemple « ${p.site} c'est nouveau-site.com ».`,
    `${p.site} ne répond plus à son adresse ⚠️ Tu me donnes la nouvelle, genre « ${p.site} c'est nouveau-site.com » ?`,
  ]),
  blockedGeo: voiceTemplate([{ site: "Sportaza" }], (p: Site) => [
    `${p.site} refuse notre serveur, donc c'est le Mac qui lit ⚠️ Laisse-le allumé avec ta session ouverte.`,
    `Le serveur est bloqué par ${p.site}, je passe par le Mac ⚠️ Garde-le allumé et ta session ouverte.`,
  ]),
  blockedLoggedOut: voiceTemplate([{ site: "Celsius" }], (p: Site) => [
    `${p.site} me déconnecte à chaque fois ⚠️ Écris « ouvre le navigateur sur le Mac » et connecte-toi une fois à la main.`,
    `Je n'arrive plus à rester connecté à ${p.site} ⚠️ Dis-moi « ouvre le navigateur sur le Mac » et connecte-toi toi-même une fois.`,
  ]),
  blockedFailures: voiceTemplate([{ site: "Celsius", n: 3 }], (p: Site & { n: number }) => [
    `Je n'arrive plus à lire ${p.site} (${p.n} échecs de suite) ⚠️ J'ai déjà réappris le site. Tu veux que j'ouvre le navigateur sur le Mac pour voir ?`,
    `${p.site} ne se lit plus depuis ${p.n} essais ⚠️ Le réapprendre n'a pas suffi. J'ouvre le navigateur sur le Mac pour regarder ?`,
  ]),
  degraded: voiceTemplate([{ site: "Sportaza", pct: 80 }], (p: Site & { pct: number }) => [
    `${p.site} se lit mal en ce moment : ${p.pct} % de lectures réussies sur 24 h. Je continue, et je réapprends le site si ça ne s'arrange pas.`,
    `Lecture un peu fragile sur ${p.site} (${p.pct} % de réussite sur 24 h). Je surveille et je le réapprends tout seul si besoin.`,
  ]),
  relearning: voiceTemplate([{ site: "Celsius" }], (p: Site) => [
    `${p.site} a l'air d'avoir changé, je le réapprends tout seul. Je te dis quand c'est bon.`,
    `Le site de ${p.site} a bougé, je le réapprends. Je te préviens quand c'est reparti.`,
  ]),
  recovered: voiceTemplate([{ site: "Sportaza" }], (p: Site) => [
    `${p.site} se lit de nouveau normalement ✅`,
    `C'est reparti sur ${p.site}, la lecture marche ✅`,
  ]),
  doubleReadFailed: voiceTemplate(
    [{ site: "Sportaza", match: "PSG - OM", bet: "PSG gagne" }],
    (p: Site & { match: string; bet: string }) => [
      `Je n'ai pas pu vérifier la cote de ${p.match} (${p.bet}) deux fois chez ${p.site}, le pari attend : je t'envoie la capture.`,
      `La cote de ${p.match} (${p.bet}) chez ${p.site} n'est pas la même aux deux lectures, le pari attend. Je t'envoie la capture.`,
    ],
  ),

  // ---------------------------------------------------------------------------------------- Kevin : actions
  noSites: [
    "Aucun bookmaker enregistré pour l'instant. Tu m'en ajoutes un, genre « ajoute le bookmaker Celsius, c'est celsius.games » ?",
    "Je n'ai encore aucun bookmaker. Dis-moi par exemple « ajoute le bookmaker Celsius, c'est celsius.games ».",
  ],
  siteUnknown: voiceTemplate(
    [{ name: "Unibet", list: "Celsius, Sportaza, Bet Portal" }],
    (p: { name: string; list: string }) => [
      `Je ne lis pas « ${p.name} » moi-même. Je connais ${p.list}. Tu veux que je l'ajoute ? Donne-moi son adresse.`,
      `« ${p.name} », je ne le lis pas encore. Mes bookmakers : ${p.list}. Tu me donnes son adresse pour l'ajouter ?`,
    ],
  ),
  siteAmbiguous: voiceTemplate(
    [{ list: "Celsius, Sportaza, Bet Portal" }],
    (p: { list: string }) => [`Lequel ? ${p.list}.`, `Quel bookmaker : ${p.list} ?`],
  ),
  siteNoUrl: voiceTemplate([{ site: "Bet Portal" }], (p: Site) => [
    `Il me manque l'adresse de ${p.site}. Tu me la donnes, genre « ${p.site} c'est site.com » ?`,
    `Je n'ai pas l'adresse de ${p.site}. Dis-moi « ${p.site} c'est site.com » et je l'apprends.`,
  ]),
  noCredentials: [
    "Il me faut d'abord les identifiants du compte bookmaker. Je te les demande en privé ?",
    "Je n'ai pas encore les identifiants du compte bookmaker. Écris « identifiants bookmakers » et je te les demande en privé.",
  ],
  learnStarted: voiceTemplate([{ site: "Celsius" }], (p: Site) => [
    `C'est lancé : j'apprends à lire ${p.site}. Ça prend quelques minutes, je te dis quand c'est prêt.`,
    `Je m'occupe d'apprendre ${p.site}, quelques minutes. Je te préviens quand c'est bon.`,
  ]),
  learnAlready: voiceTemplate([{ site: "Celsius" }], (p: Site) => [
    `Je suis déjà en train d'apprendre ${p.site}, je te dis quand c'est prêt.`,
    `${p.site} est déjà en cours d'apprentissage, je te préviens à la fin.`,
  ]),
  learnDone: voiceTemplate([{ site: "Celsius" }], (p: Site) => [
    `${p.site} est prêt ✅ Je lis ses matchs et ses cotes. Essaie « quels matchs sur ${p.site} ce soir ? ».`,
    `C'est bon pour ${p.site} ✅ Tu peux me demander « quels matchs sur ${p.site} ce soir ? ».`,
  ]),
  learnFailed: voiceTemplate(
    [{ site: "Celsius", reason: "le site demande un code" }],
    (p: Site & { reason: string }) => [
      `Je n'ai pas réussi à apprendre ${p.site} ⚠️ ${p.reason}. Je t'ouvre le navigateur sur le Mac pour voir ?`,
      `L'apprentissage de ${p.site} a échoué ⚠️ ${p.reason}. Tu veux que j'ouvre le navigateur sur le Mac ?`,
    ],
  ),
  siteAdded: voiceTemplate([{ site: "Unibet" }], (p: Site) => [
    `${p.site} est ajouté, avec les identifiants communs. J'apprends à le lire, je te dis quand c'est prêt.`,
    `C'est noté pour ${p.site}. Je l'apprends maintenant avec les identifiants communs, je te préviens à la fin.`,
  ]),
  siteAddedNoLearn: voiceTemplate([{ site: "Unibet" }], (p: Site) => [
    `${p.site} est ajouté. Je l'apprends dès que j'ai les identifiants du compte.`,
    `C'est noté pour ${p.site}. Il me faut les identifiants avant de l'apprendre.`,
  ]),
  urlChanged: voiceTemplate(
    [{ site: "Bet Portal", url: "https://betportal.com/" }],
    (p: Site & { url: string }) => [
      `Nouvelle adresse pour ${p.site} : ${p.url}. Je le réapprends.`,
      `C'est noté, ${p.site} est sur ${p.url}. Je le réapprends tout de suite.`,
    ],
  ),
  urlRefused: voiceTemplate(
    [{ reason: "seules les adresses https:// sont acceptées" }],
    (p: { reason: string }) => [
      `Je ne prends pas cette adresse : ${p.reason}. Tu me la renvoies ?`,
      `Cette adresse ne va pas (${p.reason}). Tu m'en donnes une autre ?`,
    ],
  ),
  testStarted: voiceTemplate(
    [
      { site: "Sportaza", mac: false },
      { site: "Sportaza", mac: true },
    ],
    (p: Site & { mac: boolean }) => [
      `C'est lancé : je teste ${p.site}${p.mac ? " depuis le Mac" : ""}, connexion et une lecture des matchs. Résultat dans quelques minutes.`,
      `Je teste ${p.site}${p.mac ? " depuis le Mac" : ""}, je te dis dans quelques minutes si ça passe.`,
    ],
  ),
  testOk: voiceTemplate([{ site: "Sportaza" }], (p: Site) => [
    `${p.site} répond bien ✅ Connexion faite et liste des matchs lue, aucune mise.`,
    `Test réussi sur ${p.site} ✅ Je me connecte et je lis ses matchs sans souci.`,
  ]),
  testFailed: voiceTemplate(
    [{ site: "Sportaza", reason: "le site n'a pas répondu comme prévu" }],
    (p: Site & { reason: string }) => [
      `Le test de ${p.site} n'est pas passé ⚠️ ${p.reason.charAt(0).toUpperCase()}${p.reason.slice(1)}. Tu veux que j'ouvre le navigateur sur le Mac pour voir ?`,
      `${p.site} ne passe pas le test ⚠️ ${p.reason.charAt(0).toUpperCase()}${p.reason.slice(1)}. J'ouvre le navigateur sur le Mac pour regarder ?`,
    ],
  ),
  testTimeout: voiceTemplate([{ site: "Sportaza" }], (p: Site) => [
    `Le test de ${p.site} n'a pas encore pu tourner. Je réessaie plus tard, ou tu regardes si le Mac est allumé ?`,
    `Pas de résultat pour le test de ${p.site} pour l'instant. Le Mac est bien allumé, session ouverte ?`,
  ]),
  browserDone: voiceTemplate([{ site: "Sportaza" }], (p: Site) => [
    `Merci, c'est passé sur ${p.site} ✅ Je reprends la lecture tout seul.`,
    `C'est bon pour ${p.site}, merci ✅ Je relis le site tout seul.`,
  ]),
  marketUnknown: voiceTemplate([{ market: "hors-jeu" }], (p: { market: string }) => [
    `Je ne connais pas le marché « ${p.market} ». Dis-le autrement, par exemple corners, cartons ou buts ?`,
    `« ${p.market} », je ne vois pas ce que c'est comme marché. Corners, cartons, buts ?`,
  ]),
  marketAbsent: voiceTemplate(
    [{ site: "Sportaza", market: "corners", when: "ce soir" }],
    (p: Site & { market: string; when: string }) => [
      `Pas de ${p.market} chez ${p.site} ${p.when} : le site ne les propose pas.`,
      `${p.site} ne propose pas de ${p.market} ${p.when}.`,
    ],
  ),
  marketHead: voiceTemplate(
    [{ site: "Sportaza", market: "corners", when: "ce soir" }],
    (p: Site & { market: string; when: string }) => [
      `${p.market.charAt(0).toUpperCase()}${p.market.slice(1)} chez ${p.site} ${p.when} :`,
      `Chez ${p.site} ${p.when}, côté ${p.market} :`,
    ],
    { allowList: true },
  ),
  siteBlockedNow: voiceTemplate(
    [{ site: "Sportaza", reason: "le site demande un contrôle anti-robot" }],
    (p: Site & { reason: string }) => [
      `${p.site} ne se lit pas en ce moment : ${p.reason}.`,
      `Je ne peux pas lire ${p.site} pour l'instant : ${p.reason}.`,
    ],
  ),
  testUnavailable: [
    "Je ne peux pas lancer ce test pour l'instant. On réessaie dans quelques minutes ?",
    "Le test ne part pas tout de suite. Tu réessaies dans quelques minutes ?",
  ],
  browserStarted: voiceTemplate([{ site: "Sportaza" }], (p: Site) => [
    `C'est lancé : le navigateur s'ouvre sur le Mac, sur ${p.site}. Fais le contrôle ou tape le code, puis laisse-le, je reprends tout seul.`,
    `Le navigateur s'ouvre sur le Mac, sur ${p.site}. Passe le contrôle ou saisis le code, je m'occupe du reste.`,
  ]),
  browserNoMac: [
    "Le Mac ne lit pas en ce moment ⚠️ Allume-le et ouvre ta session, puis redemande-moi.",
    "Je ne vois pas le Mac en ce moment ⚠️ Il faut qu'il soit allumé avec ta session ouverte.",
  ],
  statusHead: voiceTemplate(
    [
      { n: 1, ok: 1 },
      { n: 3, ok: 2 },
    ],
    (p: { n: number; ok: number }) => [
      p.ok === p.n
        ? `${p.n > 1 ? `Les ${p.n} bookmakers se lisent` : "Le bookmaker se lit"} bien ✅`
        : `${p.ok} bookmaker${p.ok > 1 ? "s" : ""} sur ${p.n} se ${p.ok > 1 ? "lisent" : "lit"} bien :`,
      p.ok === p.n
        ? `Tout va bien côté bookmakers ✅`
        : `Côté bookmakers, ${p.ok} sur ${p.n} vont bien :`,
    ],
    { allowList: true },
  ),
  macAlive: voiceTemplate([{ ago: "il y a 1 min" }], (p: { ago: string }) => [
    `Le Mac lit bien, dernier passage ${p.ago}.`,
    `Le Mac tourne, il est passé ${p.ago}.`,
  ]),
  macDown: voiceTemplate([{ ago: "il y a 2 h" }, { ago: "jamais" }], (p: { ago: string }) => [
    p.ago === "jamais"
      ? "Le Mac n'a encore jamais lu. Il doit être allumé, avec ta session ouverte."
      : `Le Mac ne lit plus, dernier passage ${p.ago}. Il est allumé, avec ta session ouverte ?`,
    p.ago === "jamais"
      ? "Je n'ai encore jamais vu le Mac lire. Il faut qu'il soit allumé, session ouverte."
      : `Le Mac ne répond plus depuis ${p.ago.replace(/^il y a /, "")}. Tu vérifies qu'il est allumé, session ouverte ?`,
  ]),
  matchesNone: voiceTemplate(
    [{ site: "Sportaza", when: "ce soir" }],
    (p: Site & { when: string }) => [
      `Aucun match chez ${p.site} ${p.when} pour le moment.`,
      `Rien chez ${p.site} ${p.when} pour l'instant.`,
    ],
  ),
  matchesHead: voiceTemplate(
    [
      { site: "Sportaza", when: "ce soir", n: 1 },
      { site: "Celsius", when: "demain", n: 12 },
    ],
    (p: Site & { when: string; n: number }) => [
      `${p.n} ${p.n > 1 ? "matchs" : "match"} chez ${p.site} ${p.when} :`,
      `Chez ${p.site} ${p.when}, ${p.n} ${p.n > 1 ? "matchs" : "match"} :`,
    ],
    { allowList: true },
  ),
  matchesNotReady: voiceTemplate([{ site: "Celsius" }], (p: Site) => [
    `Je ne sais pas encore lire ${p.site}. Je l'apprends maintenant ?`,
    `${p.site} n'est pas encore appris. Tu veux que je m'y mette ?`,
  ]),
  matchesFailed: voiceTemplate([{ site: "Sportaza" }], (p: Site) => [
    `Je n'ai pas réussi à lire ${p.site} à l'instant ⚠️ Je réessaie dans un moment, ou tu veux que je le teste ?`,
    `La lecture de ${p.site} n'a pas marché ⚠️ Je le teste pour voir ?`,
  ]),
  oddsOk: voiceTemplate(
    [{ site: "Sportaza", match: "PSG - OM", bet: "PSG gagne", odds: "1,85", time: "21 h 04" }],
    (p: Site & { match: string; bet: string; odds: string; time: string }) => [
      `${p.bet} (${p.match}) est à ${p.odds} chez ${p.site}, lu deux fois à ${p.time}.`,
      `Chez ${p.site}, ${p.bet} (${p.match}) : ${p.odds}, vérifié deux fois à ${p.time}.`,
    ],
  ),
  oddsNotFound: voiceTemplate(
    [{ site: "Sportaza", what: "PSG gagne" }],
    (p: Site & { what: string }) => [
      `Je ne trouve pas « ${p.what} » chez ${p.site}. Tu me dis le match exact ?`,
      `Pas de « ${p.what} » chez ${p.site} en ce moment. C'est quel match ?`,
    ],
  ),
  oddsUnsure: voiceTemplate(
    [{ site: "Sportaza", match: "PSG - OM" }],
    (p: Site & { match: string }) => [
      `Je n'ai pas pu lire la même cote deux fois pour ${p.match} chez ${p.site}, donc je ne te donne pas de chiffre.`,
      `Les deux lectures de ${p.match} chez ${p.site} ne collent pas : je préfère ne pas te donner de chiffre.`,
    ],
  ),
  onlyAdmin: [
    "Ça, c'est l'admin qui le fait. Je lui transmets ?",
    "C'est réservé à l'admin, je lui passe le message ?",
  ],
  helpBrowser: voiceVariants(
    [
      "Quand je te demande d'ouvrir le navigateur sur le Mac : écris « ouvre le navigateur sur le Mac », fais le contrôle ou tape le code, et laisse-le. Je reprends tout seul.",
      "Pour un captcha ou un code : « ouvre le navigateur sur le Mac », tu passes le contrôle, je reprends la lecture tout seul.",
    ],
    {},
  ),
} satisfies VoiceTable;
