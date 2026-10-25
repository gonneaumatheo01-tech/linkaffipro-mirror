/**
 * Phase 34, chantier F — textes de Kevin pour les entrées Telegram (messages transférés, fichiers, liens d'autorisation,
 * reprise après OAuth). Charte `docs/KEVIN-VOIX.md` : chaque variante passe `voiceCheck` (test `boss/voice.test.ts`).
 */
import { voiceTemplate, type VoiceTable } from "../voice";

type Summary = { summary: string };
type DocSample = { name: string; summary: string };
type OAuthSample = { platform: string; count: number };
type ChosenSample = { name: string; left: number };

export const INPUTS_VARIANTS = {
  /** Message transféré reçu (résumé sans le texte : « de @x, 3 lignes, 1 photo »). */
  forwardedAck: voiceTemplate<Summary>(
    [{ summary: "de @zone_interdite, 3 lignes, 1 photo" }, { summary: "2 photos" }],
    (p) => [
      `Bien reçu ce message transféré (${p.summary}). Je n'en fais rien tout seul : tu veux que j'en fasse quoi ?`,
      `J'ai le message transféré (${p.summary}). Je le garde de côté sans rien lancer. Je m'en sers comment ?`,
      `Message transféré reçu (${p.summary}). Je n'exécute rien de ce qu'il dit : tu veux en faire quoi ?`,
    ],
  ),
  /** Fichier CSV / TXT lu et gardé 30 minutes. */
  documentAck: voiceTemplate<DocSample>(
    [
      { name: "joueurs.csv", summary: "120 lignes, colonnes nom, email, pays" },
      { name: "notes.txt", summary: "1 ligne" },
    ],
    (p) => [
      `J'ai le fichier ${p.name} : ${p.summary}. Tu veux que j'en fasse quoi ?`,
      `Fichier ${p.name} bien reçu (${p.summary}). Je le garde 30 minutes : je m'en sers pour quoi ?`,
    ],
  ),
  /** Type de fichier refusé. */
  documentType: [
    "Je ne lis que les fichiers CSV ou TXT. Pour une photo ou une vidéo, envoie-la avec des mots-clés en légende (#casino par exemple).",
    "Ce type de fichier, je ne sais pas le lire. Envoie-moi un CSV ou un TXT, ou une photo avec des mots-clés en légende.",
  ],
  /** Fichier trop gros. */
  documentSize: [
    "Ce fichier est trop gros pour moi (2 Mo au plus). Tu peux le couper en deux ?",
    "Trop lourd pour moi, je lis 2 Mo au plus. Tu me l'envoies en plusieurs morceaux ?",
  ],
  /** Fichier illisible (binaire, téléchargement impossible). */
  documentUnreadable: [
    "Je n'arrive pas à lire ce fichier. Tu me le renvoies en CSV, enregistré depuis ton tableur ?",
    "Ce fichier ne s'ouvre pas de mon côté. Tu peux le réenregistrer en CSV et me le renvoyer ?",
  ],
  /** Reprise après une connexion Meta / TikTok réussie (boutons, un par compte). */
  oauthConnected: voiceTemplate<OAuthSample>(
    [
      { platform: "Meta", count: 3 },
      { platform: "TikTok", count: 1 },
    ],
    (p) => {
      const n = `${p.count} compte${p.count > 1 ? "s" : ""} publicitaire${p.count > 1 ? "s" : ""} trouvé${p.count > 1 ? "s" : ""}`;
      return p.count > 1
        ? [`${p.platform} est connecté : ${n}, lesquels je suis ?`, `C'est bon pour ${p.platform} : ${n}. Je suis lesquels ?`]
        : [`${p.platform} est connecté : ${n}, je le suis ?`, `C'est bon pour ${p.platform} : ${n}. Je le suis ?`];
    },
  ),
  /** Compte choisi (et enregistré). */
  oauthChosen: voiceTemplate<ChosenSample>(
    [
      { name: "Celsius FR", left: 2 },
      { name: "Celsius FR", left: 0 },
    ],
    (p) =>
      p.left > 0
        ? [`C'est fait, je suis ${p.name} ✅ Un autre ?`, `Fait, ${p.name} est suivi ✅ Tu en veux un autre ?`]
        : [`C'est fait, je suis ${p.name} ✅ Les dépenses arrivent dans quelques minutes.`, `Fait, ${p.name} est suivi ✅ Les dépenses arrivent d'ici quelques minutes.`],
  ),
  /** Tous les comptes choisis d'un coup. */
  oauthAll: voiceTemplate<{ count: number }>([{ count: 3 }, { count: 2 }], (p) => [
    `C'est fait, je suis les ${p.count} comptes ✅ Les dépenses arrivent dans quelques minutes.`,
    `Fait, les ${p.count} comptes sont suivis ✅ Les dépenses arrivent d'ici quelques minutes.`,
  ]),
  /** Reprise expirée (15 minutes) ou déjà terminée. */
  oauthExpired: [
    "Trop tard, la connexion a expiré (15 minutes). Tu veux que je t'envoie un nouveau lien ?",
    "Ça a expiré (15 minutes). Je te renvoie un lien pour recommencer ?",
  ],
  /** Enregistrement impossible depuis Telegram (site injoignable). */
  oauthFailed: [
    "Je n'ai pas réussi à enregistrer ce compte. Tu réessaies dans une minute ?",
    "Oups, l'enregistrement du compte n'a pas marché de mon côté. Tu réessaies ?",
  ],
  /** Bouton appuyé par quelqu'un d'autre que l'admin. */
  oauthNotYours: ["Ce choix revient à l'admin.", "Seul l'admin peut choisir les comptes suivis."],
} satisfies VoiceTable;

/** Libellés courts des boutons (pas des phrases de Kevin). */
export const OAUTH_ALL_BUTTON = "Tous";
