/**
 * Phase 32, chantier B — textes de Kevin de la boucle Link Affi (rattachement, calibrage, rapport mensuel). Charte
 * `docs/KEVIN-VOIX.md` : tutoiement, phrases courtes, aucune formule, aucun statut technique ; chaque variante passe
 * `voiceCheck` (test `learn/voice.test.ts`).
 */
import { voiceTemplate, type VoiceTable } from "../../boss/voice";

const NBSP = "\u00a0";
type H = { handle: string };
const H_SAMPLES: H[] = [{ handle: "@pronos_fr" }, { handle: "Casino Italia" }];
const q = (s: string) => `«${NBSP}${s}${NBSP}»`;

export const LINK_VARIANTS = {
  linked: voiceTemplate<{ handle: string; id: string }>([{ handle: "@pronos_fr", id: "1234" }], (p) => [
    `C'est rattaché : ${p.handle} = affilié ${p.id}. Je lirai ses vrais résultats chaque mois.`,
    `${p.handle} est rattaché à l'affilié ${p.id}. Je suivrai ses vrais résultats chaque mois.`,
  ]),
  alreadyLinked: voiceTemplate<{ handle: string; id: string }>([{ handle: "@pronos_fr", id: "1234" }], (p) => [`${p.handle} est déjà rattaché à l'affilié ${p.id}.`, `C'était déjà fait : ${p.handle} = affilié ${p.id}.`]),
  idTaken: voiceTemplate<{ id: string; other: string }>([{ id: "1234", other: "@paris_pro" }], (p) => [`L'affilié ${p.id} est déjà rattaché à ${p.other}.`, `${p.other} a déjà l'affilié ${p.id}, je ne le mets pas deux fois.`]),
  notSigned: voiceTemplate<H>(H_SAMPLES, (p) => [`${p.handle} n'est pas encore signé. Je le rattache une fois signé.`, `Je rattache ${p.handle} dès qu'il est signé.`]),
  badId: [`Je n'ai pas compris le numéro d'affilié. Écris par exemple ${q("@pronos_fr = affilié 1234")}.`, `Il me faut un numéro d'affilié, par exemple ${q("@pronos_fr = affilié 1234")}.`],
  unknown: ["Je ne retrouve pas ce canal.", "Ce canal n'est plus dans la liste."],
  askIntro: voiceTemplate<H>(H_SAMPLES, (p) => [
    `Il me manque le numéro d'affilié Link Affi de ${p.handle} pour suivre ses vrais résultats.`,
    `Pour suivre les vrais résultats de ${p.handle}, il me faut son numéro d'affilié Link Affi.`,
  ]),
  askChoices: ["C'est peut-être un de ces affiliés récents :", "Les derniers affiliés arrivés sur Link Affi :"],
  askHow: voiceTemplate<H>(H_SAMPLES, (p) => [`Réponds par le numéro, ou écris ${q(`${p.handle} = affilié 1234`)}.`, `Donne le numéro de la liste, ou écris ${q(`${p.handle} = affilié 1234`)}.`]),
  askHowNoList: voiceTemplate<H>(H_SAMPLES, (p) => [`Écris ${q(`${p.handle} = affilié 1234`)} et je m'occupe du reste.`, `Écris simplement ${q(`${p.handle} = affilié 1234`)}.`]),
  askOthers: voiceTemplate<{ handles: string }>([{ handles: "@a et @b" }], (p) => [`Il me manque aussi celui de ${p.handles}.`, `Même chose pour ${p.handles}.`]),
  choiceOutOfRange: voiceTemplate<{ n: number }>([{ n: 3 }], (p) => [`Je n'ai que ${p.n} choix dans la liste.`, `Choisis entre 1 et ${p.n}.`]),
  notConfigured: ["Link Affi n'est pas branché : je ne peux pas lire les vrais résultats.", "Pas d'accès à Link Affi pour l'instant, donc pas de vrais résultats."],
} satisfies VoiceTable;

export const CALIBRATION_VARIANTS = {
  title: voiceTemplate<{ n: number }>([{ n: 3 }, { n: 1 }], (p) =>
    p.n > 1
      ? [`Calibrage du mois : ${p.n} réglages à te proposer, tirés des vrais résultats Link Affi.`, `J'ai ${p.n} réglages à te proposer ce mois-ci, à partir des vrais résultats Link Affi.`]
      : [`Calibrage du mois : un réglage à te proposer, tiré des vrais résultats Link Affi.`, `J'ai un réglage à te proposer ce mois-ci, à partir des vrais résultats Link Affi.`],
  ),
  how: [`Réponds ${q("applique 1 et 3")} pour en garder. Rien ne change sans toi.`, `Écris ${q("applique 1")} (ou plusieurs numéros). Rien ne bouge sans ton accord.`],
  inReview: voiceTemplate<{ n: number }>([{ n: 2 }], (p) => [`${p.n} autres sont encore en vérification.`, `Encore ${p.n} en vérification, je te les montre après.`]),
  none: voiceTemplate<{ reason: string }>([{ reason: "il faut 3 affiliés et 30 jours de résultats par groupe" }], (p) => [`Pas de calibrage ce mois-ci : ${p.reason}.`, `Rien à recalibrer ce mois-ci : ${p.reason}.`]),
  noChoices: ["Aucun calibrage n'attend ton accord.", "Je n'ai pas de calibrage en attente."],
  applied: voiceTemplate<{ nums: string }>([{ nums: "1 et 3" }], (p) => [
    `C'est appliqué : ${p.nums}. Je compare avant et après pendant 30 jours.`,
    `${p.nums} en place. Je suis l'effet pendant 30 jours, tu peux annuler quand tu veux.`,
  ]),
  applyRefused: voiceTemplate<{ n: number; reason: string }>([{ n: 2, reason: "la limite de 50 % par mois serait dépassée" }], (p) => [`Le ${p.n} n'est pas passé : ${p.reason}.`, `Pas pour le ${p.n} : ${p.reason}.`]),
  applyNothing: ["Aucun réglage appliqué.", "Rien n'a été changé."],
  badChoice: voiceTemplate<{ max: number }>([{ max: 3 }], (p) => [`Choisis entre 1 et ${p.max}.`, `Il n'y a que ${p.max} choix.`]),
  notByRobot: ["Le calibrage ne s'applique jamais tout seul : c'est toi qui choisis.", "Je n'applique pas de calibrage sans ton choix."],
  undone: voiceTemplate<{ n: number }>([{ n: 2 }, { n: 1 }], (p) =>
    p.n > 1 ? [`C'est annulé : les ${p.n} réglages sont revenus comme avant.`, `Annulé, les ${p.n} réglages sont revenus à l'ancienne valeur.`] : ["C'est annulé : le réglage est revenu comme avant.", "Annulé, le réglage a repris son ancienne valeur."],
  ),
  undoSkipped: voiceTemplate<{ n: number }>([{ n: 1 }], (p) => [`${p.n} réglage a été changé depuis, je n'y touche pas.`, `Je laisse ${p.n} réglage modifié depuis, pour ne pas écraser ton changement.`]),
  undoNothing: ["Rien à annuler : aucun calibrage appliqué ces 30 derniers jours.", "Pas de calibrage récent à annuler."],
} satisfies VoiceTable;

export const REPORT_VARIANTS = {
  title: voiceTemplate<{ month: string; signed: number; active: number }>([{ month: "octobre", signed: 4, active: 2 }], (p) => [
    `Ce que rapporte la prospection en ${p.month} : ${p.signed} affiliés signés, dont ${p.active} actifs.`,
    `Prospection, bilan de ${p.month} : ${p.signed} affiliés signés, ${p.active} actifs.`,
  ]),
  empty: voiceTemplate<{ month: string }>([{ month: "octobre" }], (p) => [`Bilan de ${p.month} : aucun affilié signé et rattaché pour l'instant.`, `En ${p.month}, pas encore d'affilié signé et rattaché à suivre.`]),
  noReader: ["Link Affi n'est pas branché : pas de vrais résultats ce mois-ci.", "Pas d'accès à Link Affi, donc pas de vrais résultats ce mois-ci."],
  unlinked: voiceTemplate<{ n: number }>([{ n: 2 }], (p) => [`${p.n} signés n'ont pas encore leur numéro d'affilié, je ne peux pas les suivre.`, `Il manque le numéro d'affilié de ${p.n} signés.`]),
  churn: voiceTemplate<{ handles: string }>([{ handles: "@a" }], (p) => [`Aucun clic depuis 60 jours : ${p.handles}. Tu les passes en arrêtés ?`, `${p.handles} : plus aucun clic depuis 60 jours. Je les note arrêtés si tu veux.`]),
  proposals: voiceTemplate<{ n: number }>([{ n: 3 }], (p) => [`${p.n} réglages proposés juste avant, à toi de choisir.`, `Je t'ai envoyé ${p.n} réglages à choisir.`]),
  qaRejected: ["Le bilan du mois n'a pas passé la vérification, je ne l'envoie pas.", "Je garde le bilan du mois : la vérification l'a bloqué."],
  qaUnavailable: ["La vérification ne répond pas, le bilan du mois attend.", "Je ne peux pas faire vérifier le bilan du mois pour l'instant, il attend."],
} satisfies VoiceTable;

export const PERFORMANCE_VARIANTS = {
  notLinked: voiceTemplate<H>(H_SAMPLES, (p) => [`${p.handle} n'est pas encore rattaché à Link Affi : écris ${q(`${p.handle} = affilié 1234`)}.`, `Il me faut le numéro d'affilié de ${p.handle} pour te donner ses vrais chiffres.`]),
  noResults: voiceTemplate<H>(H_SAMPLES, (p) => [`Pas encore de résultats lus pour ${p.handle}.`, `Je n'ai encore rien lu dans Link Affi pour ${p.handle}.`]),
  noAffiliates: ["Aucun affilié signé et rattaché pour l'instant.", "Pas encore d'affilié signé à suivre."],
} satisfies VoiceTable;
