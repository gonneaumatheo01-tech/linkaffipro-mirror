/**
 * Phase 32, chantier A — un réseau dans le Top du jour : UNE ligne de titre, puis les canaux, la valeur cumulée si elle
 * existe (toujours en fourchette, « estimation »), et les preuves. Pur.
 *
 *   Réseau @admin_pub : 3 canaux FR, 5,4k vues/post cumulées
 *   Canaux : @a (niveau A), @b (niveau B), @c (niveau C)
 *   Valeur estimée du réseau : 1 200 à 6 600 €/mois (estimation non calibrée)
 *   Pourquoi ensemble : même contact @admin_pub, même code promo MAXPRONO. Un seul deal pour 3 canaux.
 */
import { esc } from "../../admin/journal";
import { voiceTemplate, type VoiceTable } from "../../boss/voice";
import type { NetworkEvidence } from "../contract-advanced";
import { formatCount } from "../score/format";
import { objectOf } from "../score/settings";

export type NetworkCardInput = {
  mainContact: string | null;
  name: string;
  totalReach: number;
  members: Array<{ handle: string; tier: string | null; countries: string[]; medianViews: number | null; valueEstimate?: unknown }>;
  evidence: readonly NetworkEvidence[];
};

type Head = { who: string; n: number; countries: string; reach: string };

export const NETWORK_CARD_VARIANTS = {
  head: voiceTemplate<Head>([{ who: "@admin_pub", n: 3, countries: "FR", reach: "5,4k" }], (p) => [`Réseau ${p.who} : ${p.n} canaux ${p.countries}, ${p.reach} vues/post cumulées`]),
  why: voiceTemplate<{ proofs: string; n: number }>([{ proofs: "même contact @admin_pub, même code promo MAXPRONO", n: 3 }], (p) => [`Pourquoi ensemble : ${p.proofs}. Un seul deal pour ${p.n} canaux.`]),
} satisfies VoiceTable;

const eurInt = (n: number) => `${Math.round(n).toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")}\u00a0€`;

/** Pays du réseau : « FR », « FR / BE ». */
function countriesText(members: NetworkCardInput["members"]): string {
  const set = [...new Set(members.map((m) => m.countries[0]).filter((c): c is string => !!c))];
  return set.length ? set.slice(0, 4).join(" / ") : "pays inconnu";
}

/** Ligne de titre du réseau (« Réseau @x : 3 canaux FR, 5,4k vues/post cumulées »). Pur. */
export function networkLine(input: NetworkCardInput): string {
  const who = input.mainContact ? esc(input.mainContact) : esc(input.name.replace(/^Réseau\s+/, ""));
  return NETWORK_CARD_VARIANTS.head({ who, n: input.members.length, countries: countriesText(input.members), reach: formatCount(input.totalReach) })[0]!;
}

/** Valeur cumulée (somme des fourchettes des membres qui en ont une), jamais un chiffre seul. */
function valueLine(members: NetworkCardInput["members"]): string | null {
  let low = 0;
  let high = 0;
  let n = 0;
  let calibrated = false;
  for (const m of members) {
    const v = objectOf(m.valueEstimate);
    if (typeof v.low !== "number" || typeof v.high !== "number") continue;
    low += v.low;
    high += v.high;
    n++;
    if (typeof v.calibratedBy === "string" && v.calibratedBy !== "default") calibrated = true;
  }
  if (!n || high <= 0) return null;
  return `Valeur estimée du réseau : ${eurInt(low)} à ${eurInt(high)} par mois (estimation${calibrated ? "" : " non calibrée"}${n < members.length ? `, ${n} canaux sur ${members.length}` : ""})`;
}

const KIND_ORDER = ["same_contact", "same_linked_group", "same_signature", "same_site", "same_promo_code", "cross_forwards", "same_description"];

/** Carte complète d'un réseau (HTML Telegram, échappé). Pur. */
export function renderNetworkCard(input: NetworkCardInput): string {
  const lines = [networkLine(input)];
  lines.push(`Canaux : ${input.members.map((m) => `${esc(m.handle)}${m.tier ? ` (niveau ${m.tier})` : ""}`).join(", ")}`);
  const value = valueLine(input.members);
  if (value) lines.push(value);
  const proofs = [...new Map([...input.evidence].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)).map((e) => [e.detail, e])).keys()].slice(0, 3);
  if (proofs.length) lines.push(NETWORK_CARD_VARIANTS.why({ proofs: esc(proofs.join(", ")), n: input.members.length })[0]!);
  return lines.join("\n");
}
