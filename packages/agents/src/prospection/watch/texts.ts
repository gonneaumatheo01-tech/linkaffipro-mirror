/**
 * Phase 32, chantier A — textes de Kevin du Veilleur (charte `docs/KEVIN-VOIX.md`, `voiceCheck` en CI).
 *
 * Décision : les phrases des alertes sont des gabarits remplis par le code avec les chiffres mesurés (aucun appel
 * d'IA par alerte) ; le modèle Haiku prévu pour « texte des alertes » n'est donc pas appelé : mêmes phrases, zéro coût,
 * aucun chiffre inventé possible. Le QA Global relit quand même le message du matin entier (`ALERT`).
 */
import { esc } from "../../admin/journal";
import { voiceTemplate, type VoiceTable } from "../../boss/voice";
import type { ProspectAlertKind } from "../contract-advanced";
import { formatCount, formatPct } from "../score/format";
import { objectOf } from "../score/settings";

const NBSP = " ";

/** Libellés des types d'alerte (Kevin, site). */
export const ALERT_KIND_LABELS: Readonly<Record<ProspectAlertKind, string>> = {
  AFFILIATE_DROPPED: "marque lâchée",
  NEW_AFFILIATE: "nouvelle marque",
  AFFILIATE_SWITCHED: "changement de marque",
  GROWTH_SPIKE: "canal en hausse",
  DECLINE: "canal en baisse",
  WENT_SILENT: "canal silencieux",
  STARTED_SELLING_ADS: "vend de la pub",
  MARKETPLACE_LISTED: "fiche sur une place de marché",
  CONTACT_CHANGED: "contact changé",
  TIER_UP: "niveau en hausse",
  TIER_DOWN: "niveau en baisse",
  AFFILIATE_NOT_POSTING: "affilié sans nos liens",
  AFFILIATE_PUSHES_COMPETITOR: "affilié qui pousse un concurrent",
  AFFILIATE_RISKY_CLAIM: "phrase à risque d'un affilié",
  AFFILIATE_SILENT: "affilié silencieux",
};

/** Libellés des boutons sous une alerte (pas des phrases de Kevin). */
export const ALERT_BUTTONS = { seen: "✅ Vu", note: "📝 Note", mute: "🔕 Plus pour ce canal", kind: "🔕 Couper ce type" } as const;

type H = { h: string };
type Brand = H & { brand: string; days: number };
type Switch = H & { from: string; to: string };
type Change = H & { change: string; days: number };
type Days = H & { days: number };
type Tier = H & { from: string; to: string };
type Text = H & { what: string };

/** Phrases des alertes (une par type, deux variantes au moins). */
export const WATCH_ALERT_VARIANTS = {
  AFFILIATE_DROPPED: voiceTemplate<Brand>([{ h: "@pronos_fr", brand: "1xbet", days: 23 }], (p) => [
    `${p.h} ne pousse plus ${p.brand} depuis ${p.days} jours. Il cherche peut-être une offre.`,
    `Plus aucun lien ${p.brand} chez ${p.h} depuis ${p.days} jours : bon moment pour le contacter.`,
  ]),
  NEW_AFFILIATE: voiceTemplate<Brand>([{ h: "@pronos_fr", brand: "Betano", days: 0 }], (p) => [
    `${p.h} pousse une nouvelle marque : ${p.brand}. Il est ouvert aux offres.`,
    `Nouvelle marque chez ${p.h} : ${p.brand}.`,
  ]),
  AFFILIATE_SWITCHED: voiceTemplate<Switch>([{ h: "@pronos_fr", from: "1xbet", to: "Betano" }], (p) => [
    `${p.h} est passé de ${p.from} à ${p.to}. Il vient sûrement de signer ailleurs.`,
    `${p.h} a lâché ${p.from} pour ${p.to}.`,
  ]),
  GROWTH_SPIKE: voiceTemplate<Change>([{ h: "@pronos_fr", change: `de 4k à 9k abonnés (+125${NBSP}%)`, days: 30 }], (p) => [
    `${p.h} monte vite : ${p.change} en ${p.days} jours. Un deal coûte moins cher maintenant.`,
    `Canal en forte hausse : ${p.h}, ${p.change} en ${p.days} jours.`,
  ]),
  DECLINE: voiceTemplate<Change>([{ h: "@pronos_fr", change: `de 2,1k à 1,3k vues par post (-38${NBSP}%)`, days: 30 }], (p) => [
    `${p.h} perd de l'audience : ${p.change} en ${p.days} jours.`,
    `Baisse chez ${p.h} : ${p.change} en ${p.days} jours.`,
  ]),
  WENT_SILENT: voiceTemplate<Days>([{ h: "@pronos_fr", days: 24 }], (p) => [
    `${p.h} ne poste plus depuis ${p.days} jours. À savoir avant de le relancer.`,
    `Plus aucun post chez ${p.h} depuis ${p.days} jours.`,
  ]),
  STARTED_SELLING_ADS: voiceTemplate<H>([{ h: "@pronos_fr" }], (p) => [`${p.h} vend maintenant de la pub.`, `${p.h} s'est mis à vendre de la pub.`]),
  MARKETPLACE_LISTED: voiceTemplate<H>([{ h: "@pronos_fr" }], (p) => [`${p.h} a une fiche sur une place de marché de pub.`, `Nouvelle fiche de vente de pub pour ${p.h}.`]),
  CONTACT_CHANGED: voiceTemplate<Text>(
    [
      { h: "@pronos_fr", what: "@maxime_pub remplace @old_pub" },
      { h: "@pronos_fr", what: "plus aucun contact affiché (avant : @old_pub)" },
    ],
    (p) => [`Contact changé chez ${p.h} : ${p.what}.`, `${p.h} a changé de contact : ${p.what}.`],
  ),
  TIER_UP: voiceTemplate<Tier>([{ h: "@pronos_fr", from: "B", to: "A" }], (p) => [`${p.h} passe au niveau ${p.to} (avant ${p.from}).`, `${p.h} monte au niveau ${p.to}, il était ${p.from}.`]),
  TIER_DOWN: voiceTemplate<Tier>([{ h: "@pronos_fr", from: "A", to: "B" }], (p) => [`${p.h} descend au niveau ${p.to} (avant ${p.from}).`, `${p.h} passe du niveau ${p.from} au niveau ${p.to}.`]),
  AFFILIATE_NOT_POSTING: voiceTemplate<Days>([{ h: "@pronos_fr", days: 16 }], (p) => [
    `${p.h} a signé il y a ${p.days} jours et n'a posté aucun de nos liens.`,
    `Aucun de nos liens chez ${p.h}, signé depuis ${p.days} jours.`,
  ]),
  AFFILIATE_PUSHES_COMPETITOR: voiceTemplate<Text>([{ h: "@pronos_fr", what: "Betano" }], (p) => [`${p.h} pousse aussi ${p.what}.`, `${p.h}, signé chez nous, met aussi en avant ${p.what}.`]),
  AFFILIATE_RISKY_CLAIM: voiceTemplate<Text>([{ h: "@pronos_fr", what: "gains garantis" }], (p) => [
    `${p.h} a écrit une phrase à risque : ${p.what}.`,
    `Phrase à risque chez ${p.h} : ${p.what}. Je ne fais rien, je te préviens.`,
  ]),
  AFFILIATE_SILENT: voiceTemplate<Days>([{ h: "@pronos_fr", days: 22 }], (p) => [
    `${p.h} est signé mais ne poste plus depuis ${p.days} jours.`,
    `Plus aucun post chez ${p.h} depuis ${p.days} jours, alors qu'il est signé.`,
  ]),
} satisfies Record<ProspectAlertKind, VoiceTable[string]>;

type Count = { n: number };

/** Message du matin, boutons et coupure d'un type. */
export const WATCH_DIGEST_VARIANTS = {
  header: voiceTemplate<Count>([{ n: 1 }, { n: 8 }], (p) => [
    `${p.n} ${p.n > 1 ? "changements" : "changement"} à voir chez tes canaux ce matin.`,
    `Ce matin, ${p.n} ${p.n > 1 ? "choses ont bougé" : "chose a bougé"} chez tes canaux.`,
  ]),
  qaRejected: ["Les alertes du jour n'ont pas passé la vérification, je ne les envoie pas.", "Je garde les alertes du jour : la vérification les a bloquées."],
  qaUnavailable: ["La vérification ne répond pas, les alertes du jour attendent.", "Je ne peux pas faire vérifier les alertes du jour pour l'instant, elles attendent."],
  muteOffer: voiceTemplate<{ kind: string; n: number }>([{ kind: "canal en baisse", n: 5 }], (p) => [
    `Tu as laissé passer ${p.n} alertes «${NBSP}${p.kind}${NBSP}» de suite. Je coupe ce type ?`,
    `Les alertes «${NBSP}${p.kind}${NBSP}» ne t'intéressent pas on dirait (${p.n} ignorées de suite). Je les coupe ?`,
  ]),
  seen: ["Noté ✅", "C'est vu ✅"],
  askNote: voiceTemplate<H>([{ h: "@pronos_fr" }], (p) => [`Écris ta note sur ${p.h} en un message.`, `Ta note sur ${p.h} ? Un message suffit.`]),
  noteSaved: voiceTemplate<H>([{ h: "@pronos_fr" }], (p) => [`Note ajoutée sur ${p.h} ✅`, `C'est noté sur la fiche de ${p.h} ✅`]),
  noteEmpty: ["Je n'ai pas compris ta note, réécris-la en un message.", "Ta note est vide, réécris-la."],
  mutedProspect: voiceTemplate<H>([{ h: "@pronos_fr" }], (p) => [`Plus d'alertes pour ${p.h}.`, `Je ne te parle plus de ${p.h} dans les alertes.`]),
  mutedKind: voiceTemplate<{ kind: string }>([{ kind: "canal en baisse" }], (p) => [
    `C'est coupé : plus d'alertes «${NBSP}${p.kind}${NBSP}». Dis-moi si tu les veux de nouveau.`,
    `Plus d'alertes «${NBSP}${p.kind}${NBSP}». Tu peux les remettre quand tu veux.`,
  ]),
  unmutedKind: voiceTemplate<{ kind: string }>([{ kind: "canal en baisse" }], (p) => [`Les alertes «${NBSP}${p.kind}${NBSP}» reviennent.`, `C'est remis : alertes «${NBSP}${p.kind}${NBSP}».`]),
  notAllowed: ["Ça, c'est l'admin qui décide.", "Seul l'admin peut changer ça."],
  unknown: ["Je ne retrouve plus cette alerte.", "Cette alerte n'existe plus."],
} satisfies VoiceTable;

const pct = (g: unknown) => (typeof g === "number" && Number.isFinite(g) ? `${g >= 0 ? "+" : ""}${formatPct(g)}` : null);

/** « de 4k à 9k abonnés (+125 %) » ou « de 2,1k à 3k vues par post (+43 %) ». */
export function changeText(data: Record<string, unknown>, prefer: "subs" | "views"): string {
  const subs = typeof data.subscribersFrom === "number" && typeof data.subscribersTo === "number" ? `de ${formatCount(data.subscribersFrom)} à ${formatCount(data.subscribersTo)} abonnés (${pct(data.subsGrowth) ?? "?"})` : null;
  const views = typeof data.viewsFrom === "number" && typeof data.viewsTo === "number" ? `de ${formatCount(data.viewsFrom)} à ${formatCount(data.viewsTo)} vues par post (${pct(data.viewsGrowth) ?? "?"})` : null;
  if (prefer === "views") return views ?? subs ?? "chiffres en mouvement";
  const sg = typeof data.subsGrowth === "number" ? data.subsGrowth : -Infinity;
  const vg = typeof data.viewsGrowth === "number" ? data.viewsGrowth : -Infinity;
  return (sg >= vg ? (subs ?? views) : (views ?? subs)) ?? "chiffres en mouvement";
}

const str = (v: unknown, fallback = "?") => (typeof v === "string" && v.trim() ? esc(v.trim()) : fallback);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);

/** Variantes de la phrase d'une alerte (HTML échappé), prêtes pour `pick`. */
export function alertVariants(kind: ProspectAlertKind, handle: string, rawData: unknown): readonly string[] {
  const d = objectOf(rawData);
  const h = esc(handle);
  const V = WATCH_ALERT_VARIANTS;
  switch (kind) {
    case "AFFILIATE_DROPPED":
    case "NEW_AFFILIATE":
      return V[kind]({ h, brand: str(d.brand), days: num(d.days) });
    case "AFFILIATE_SWITCHED":
      return V.AFFILIATE_SWITCHED({ h, from: str(d.from), to: str(d.to) });
    case "GROWTH_SPIKE":
      return V.GROWTH_SPIKE({ h, change: esc(changeText(d, "subs")), days: num(d.days) });
    case "DECLINE":
      return V.DECLINE({ h, change: esc(changeText(d, "views")), days: num(d.days) });
    case "WENT_SILENT":
    case "AFFILIATE_SILENT":
    case "AFFILIATE_NOT_POSTING":
      return V[kind]({ h, days: num(d.days) });
    case "STARTED_SELLING_ADS":
    case "MARKETPLACE_LISTED":
      return V[kind]({ h });
    case "CONTACT_CHANGED": {
      const from = typeof d.from === "string" && d.from ? esc(d.from) : null;
      const to = typeof d.to === "string" && d.to ? esc(d.to) : null;
      const what = from && to ? `${to} remplace ${from}` : to ? `nouveau contact ${to}` : `plus aucun contact affiché (avant : ${from ?? "?"})`;
      return V.CONTACT_CHANGED({ h, what });
    }
    case "TIER_UP":
    case "TIER_DOWN":
      return V[kind]({ h, from: str(d.from), to: str(d.to) });
    case "AFFILIATE_PUSHES_COMPETITOR":
      return V.AFFILIATE_PUSHES_COMPETITOR({ h, what: str(d.brand, "une autre marque") });
    case "AFFILIATE_RISKY_CLAIM":
      return V.AFFILIATE_RISKY_CLAIM({ h, what: str(d.claim, "promesse risquée") });
  }
}

/** Ligne de preuve (≤ 15 mots, déjà coupée) : « Extrait : « … » ». */
export function evidenceLine(evidence: string | null | undefined): string | null {
  const e = (evidence ?? "").replace(/\s+/g, " ").trim();
  return e ? `Extrait : «${NBSP}${esc(e)}${NBSP}»` : null;
}
