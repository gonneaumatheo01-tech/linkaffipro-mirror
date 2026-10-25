/**
 * Phase 29, chantier B — alertes du Rapporteur (`alertFor`, réexporté par `reporter.ts`), écrites par le CODE (modèles
 * de texte de la voix de Kevin, variantes `ALERT_VARIANTS` + `pick`) : rapide, gratuit, toujours conforme. Le prompt
 * autorisait Haiku « pour la mise en forme » ou des modèles du code ; les modèles du code suffisent (aucune donnée à
 * reformuler, et le texte doit garder l'adresse et le niveau de risque à l'identique).
 *
 * Formats (section 5 du prompt) :
 * - « ⚠️ Alerte compliance : … Risque : BAN. Source : <url>. Vérifie tes campagnes en cours. » + `LEGAL_DISCLAIMER` ;
 * - « 🔥 Tendance : <résumé> — <url> » (score ≥ 9).
 * Un seul emoji par message (voix de Kevin). Le texte est en HTML Telegram (échappé), prêt à envoyer par le chantier C.
 */
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import { countryLabel, MARKET_LABELS, PLATFORM_LABELS } from "./analysis-labels";
import { clipSentences, cleanLine, escHtml, RISK_LABELS, shorten } from "./citations";
import { LEGAL_DISCLAIMER, type CompliancePlatform, type Market, type RiskLevel } from "./contract";

export type AnalystsAlert = {
  kind: "compliance" | "trend";
  /** Règle (`ComplianceRule.id`) ou entrée (`TrendEntry.id`). */
  refId: string;
  riskLevel: RiskLevel | null;
  url: string | null;
  /** HTML Telegram, voix de Kevin. */
  text: string;
};

/** Règle telle que lue (forme minimale). */
export type AlertRule = {
  id: string;
  platform: CompliancePlatform;
  market: Market;
  country: string;
  rule: string;
  riskLevel: RiskLevel;
  verified: boolean;
  evidence: ReadonlyArray<{ url: string; stance?: "supports" | "contradicts" }>;
};

/** Entrée telle que lue (forme minimale). */
export type AlertEntry = { id: string; summary: string; url: string; verified: boolean; title?: string | null };

type ComplianceParams = { platform: string; scope: string; rule: string; risk: string; url: string; note: string };
type TrendParams = { summary: string; url: string; note: string };

const SAMPLE_COMPLIANCE: ComplianceParams = {
  platform: "Meta",
  scope: "casino, France",
  rule: "Meta refuse les pubs casino qui montrent un bonus de bienvenue sans autorisation écrite",
  risk: "BAN",
  url: "https://transparency.meta.com/policies/ad-standards/restricted-goods-services/online-gambling-games",
  note: "Une seule source pour l'instant, à confirmer.",
};

export const ALERT_VARIANTS = {
  compliance: voiceTemplate([SAMPLE_COMPLIANCE, { ...SAMPLE_COMPLIANCE, platform: "TikTok", scope: "rencontres, toute l'Europe", risk: "élevé", note: "" }], (p: ComplianceParams) => [
    [`⚠️ Alerte compliance sur ${p.platform} (${p.scope}) : ${p.rule}`, `Risque : ${p.risk}. Source : ${p.url}`, p.note, "Vérifie tes campagnes en cours.", LEGAL_DISCLAIMER].filter(Boolean).join("\n"),
    [`⚠️ Alerte compliance, ${p.platform} (${p.scope}) : ${p.rule}`, `Risque : ${p.risk}. Source : ${p.url}`, p.note, "Regarde tes campagnes en cours.", LEGAL_DISCLAIMER].filter(Boolean).join("\n"),
  ]),
  trend: voiceTemplate(
    [
      { summary: "Les vidéos de joueurs qui filment leur écran marchent fort sur TikTok en Espagne.", url: "https://www.reddit.com/r/casinoonline/comments/abc", note: "" },
      { summary: "Les pubs de rencontres avec un vrai témoignage coûtent moins cher en Allemagne.", url: "https://example.com/post", note: " (non vérifié)" },
    ],
    (p: TrendParams) => [`🔥 Tendance : ${p.summary}${p.note} — ${p.url}`, `🔥 Tendance du moment : ${p.summary}${p.note} — ${p.url}`],
  ),
} satisfies VoiceTable;

/** Phrase de la règle pour une alerte : nettoyée, 24 mots au plus par phrase, 260 caractères au plus. */
function ruleSentence(rule: string): string {
  return clipSentences(shorten(cleanLine(rule, 400), 260), 24).replace(/[.!?]+$/u, "") || "nouvelle règle repérée";
}

/** Texte d'une alerte de compliance (pur). */
export function complianceAlertText(rule: AlertRule, chatId?: string | number | null): string {
  const supports = rule.evidence.filter((e) => e.stance !== "contradicts");
  const url = (supports[0] ?? rule.evidence[0])?.url ?? "";
  const contradicted = rule.evidence.some((e) => e.stance === "contradicts");
  const note = contradicted ? "Des sources se contredisent : je garde le risque le plus prudent." : rule.verified ? "" : "Une seule source pour l'instant, à confirmer.";
  const params: ComplianceParams = {
    platform: PLATFORM_LABELS[rule.platform] ?? rule.platform,
    scope: `${MARKET_LABELS[rule.market] ?? rule.market}, ${countryLabel(rule.country)}`,
    rule: ruleSentence(rule.rule),
    risk: RISK_LABELS[rule.riskLevel],
    url,
    note,
  };
  return escHtml(pick(ALERT_VARIANTS.compliance(params), "analysts.alert.compliance", chatId ?? null));
}

/** Texte d'une alerte de tendance (pur). */
export function trendAlertText(entry: AlertEntry, chatId?: string | number | null): string {
  const summary = clipSentences(shorten(cleanLine(entry.summary, 500), 240), 24);
  return escHtml(pick(ALERT_VARIANTS.trend({ summary, url: entry.url, note: entry.verified ? "" : " (non vérifié)" }), "analysts.alert.trend", chatId ?? null));
}

/**
 * Alerte prête à envoyer pour une règle (HIGH / BAN : « Alerte compliance ») ou une entrée (tendance virale). Le choix
 * d'envoyer (seuil `analysts.alert_risk_level`, score ≥ 9) est fait par l'appelant (Compliance, veille, chantier C).
 */
export function alertFor(item: AlertRule | AlertEntry, opts: { chatId?: string | number | null } = {}): AnalystsAlert {
  if ("rule" in item && "platform" in item) {
    const url = item.evidence.find((e) => e.stance !== "contradicts")?.url ?? item.evidence[0]?.url ?? null;
    return { kind: "compliance", refId: item.id, riskLevel: item.riskLevel, url, text: complianceAlertText(item, opts.chatId) };
  }
  const entry = item as AlertEntry;
  return { kind: "trend", refId: entry.id, riskLevel: null, url: entry.url, text: trendAlertText(entry, opts.chatId) };
}
