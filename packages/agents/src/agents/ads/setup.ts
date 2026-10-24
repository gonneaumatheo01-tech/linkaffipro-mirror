/**
 * Questions de mise en route de l'Agent Ads (une seule fois, `Setting` `agents.adsSetupAsked`, marqué avant ; posées
 * par le passage du Grand Chef) : coût par inscription au-dessus duquel conseiller d'arrêter, puis retour sur dépense
 * minimal pour conseiller d'augmenter. Choix 1 / 2 = valeur du milieu × 1,5 / × 2 (chaque univers garde sa propre
 * valeur du milieu quand il en a une), 3 = un chiffre écrit ; « plus tard » = valeurs de départ (× 1,5).
 * TEXT et non CHOICE : une demande à choix refuse un chiffre libre.
 */
import type { AgentsDeps } from "../../types";
import { nowOf, readSetting, writeSetting } from "../../admin/journal";
import { askHuman } from "../../human/requests";
import { registerAnswerAction } from "../../human/respond";
import { loadAdsContext } from "./analysis";
import {
  ADS_THRESHOLDS_KEY,
  ADS_VERTICALS,
  ADS_VERTICAL_LABELS,
  patchThresholds,
  suggestedCostPerRegistration,
  suggestedMinRoas,
  type AdsMedians,
  type AdsVertical,
} from "./thresholds";

export const ADS_SETUP_SETTING = "agents.adsSetupAsked";
const MULTIPLIERS = [1.5, 2] as const;

const eur = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
const dec = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Réponse lue (pur) : « 1 » / « 2 » = multiplicateur, sinon le nombre écrit ; null si illisible. */
export function adsSetupAnswer(value: string): { multiplier: number } | { value: number } | null {
  const t = value.trim().replace(/[).]$/, "");
  if (/^[12]$/.test(t)) return { multiplier: MULTIPLIERS[Number(t) - 1]! };
  const m = /\d+(?:[.,]\d+)?/.exec(t.replace(/^3\s*[).:-]?\s+/, ""));
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? { value: n } : null;
}

/** Texte de la question (pur). */
export function adsSetupQuestion(kind: "cpr" | "roas", m: AdsMedians): { question: string; options: string[]; skip: string } {
  const sugg = (mult: number) => (kind === "cpr" ? suggestedCostPerRegistration(m, "ALL", mult) : suggestedMinRoas(m, "ALL", mult));
  const [a, b] = MULTIPLIERS.map(sugg) as [ReturnType<typeof sugg>, ReturnType<typeof sugg>];
  const fmt = kind === "cpr" ? eur : dec;
  const note = a.fromData ? "" : " (pas encore assez de pubs pour partir de vos chiffres : valeurs raisonnables)";
  const question =
    kind === "cpr"
      ? `Coût par inscription au-dessus duquel je te conseille d'arrêter une pub : 1) ${fmt(a.value)} 2) ${fmt(b.value)} 3) un chiffre${note}. Réponds 1, 2 ou un chiffre (« plus tard » = 1).`
      : `Retour sur dépense minimal pour que je te conseille d'augmenter une pub : 1) ${fmt(a.value)} 2) ${fmt(b.value)} 3) un chiffre${note}. Réponds 1, 2 ou un chiffre (« plus tard » = 1).`;
  return { question, options: [String(a.value), String(b.value)], skip: "1" };
}

export async function ensureAdsSetupQuestions(deps: AgentsDeps): Promise<{ queued: number }> {
  if ((await readSetting(deps, ADS_SETUP_SETTING)) !== undefined) return { queued: 0 };
  // Chiffres lus d'abord : une lecture en échec ne marque pas la question comme posée.
  const { medians } = (await loadAdsContext(deps.prisma, nowOf(deps), { cohorts: false })).thresholds;
  await writeSetting(deps, ADS_SETUP_SETTING, { askedAt: nowOf(deps).toISOString() });
  for (const kind of ["cpr", "roas"] as const) {
    const q = adsSetupQuestion(kind, medians!);
    await askHuman(deps, {
      kind: "TEXT",
      key: kind === "cpr" ? "agents.ads.targetCostPerRegistration" : "agents.ads.minRoas",
      question: q.question,
      options: q.options,
      onAnswer: { action: kind === "cpr" ? "ads-cpr" : "ads-roas", skipAnswer: q.skip, resume: false },
    });
  }
  return { queued: 2 };
}

async function applyAnswer(deps: AgentsDeps, kind: "cpr" | "roas", value: string): Promise<string> {
  const a = adsSetupAnswer(value);
  if (!a) return "Je n'ai pas compris ce chiffre : les valeurs de départ restent en place (modifiables dans Agents → Ads).";
  const { medians } = (await loadAdsContext(deps.prisma, nowOf(deps), { cohorts: false })).thresholds;
  const patch: Partial<Record<AdsVertical, Record<string, number>>> = {};
  const parts: string[] = [];
  for (const v of ADS_VERTICALS) {
    const n =
      "value" in a
        ? a.value
        : (kind === "cpr" ? suggestedCostPerRegistration(medians!, v, a.multiplier) : suggestedMinRoas(medians!, v, a.multiplier)).value;
    patch[v] = kind === "cpr" ? { targetCostPerRegistration: n } : { minRoas: n };
    parts.push(`${ADS_VERTICAL_LABELS[v]} ${kind === "cpr" ? eur(n) : dec(n)}`);
  }
  await writeSetting(deps, ADS_THRESHOLDS_KEY, patchThresholds(await readSetting(deps, ADS_THRESHOLDS_KEY), patch));
  return `${kind === "cpr" ? "Coût par inscription maximal" : "Retour sur dépense minimal"} : ${parts.join(", ")} ✅`;
}

registerAnswerAction("ads-cpr", (deps, { value }) => applyAnswer(deps, "cpr", value));
registerAnswerAction("ads-roas", (deps, { value }) => applyAnswer(deps, "roas", value));
