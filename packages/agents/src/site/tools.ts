/**
 * Phase 34, chantier A — outils de l'interprète (Haiku) pour les opérations du site : UN outil par domaine
 * (`site_<domaine>`), paramètres `{ op: <clé du domaine>, params: { … } }`. La description liste chaque opération
 * (« clé : description — exemple ») ; le schéma des paramètres de chaque opération va dans la description de `params`
 * (jamais un champ secret : ceux-là sont demandés en privé par Kevin, jamais à l'IA). La sortie est revalidée par le
 * code (`siteToolDecision`) : outil inconnu, opération d'un autre domaine ou paramètres qui ne sont pas un objet → rien.
 */
import type { AiToolDef } from "@linkaffipro/ai";
import type { SiteDomain, SiteOpMeta } from "./contract";
import { SITE_DOMAIN_LABELS, siteOp, siteOpsByDomain } from "./registry";

export const SITE_TOOL_PREFIX = "site_";

export function siteToolName(domain: SiteDomain): string {
  return `${SITE_TOOL_PREFIX}${domain}`;
}

/** Schéma d'une opération sans ses champs secrets (envoyé à l'IA). */
export function publicParamsOf(meta: Pick<SiteOpMeta, "params" | "secretParams">): Record<string, unknown> {
  const secret = new Set(meta.secretParams ?? []);
  const props = (meta.params?.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(meta.params?.required) ? (meta.params.required as string[]) : [];
  return {
    ...meta.params,
    properties: Object.fromEntries(Object.entries(props).filter(([k]) => !secret.has(k))),
    ...(required.length ? { required: required.filter((k) => !secret.has(k)) } : {}),
  };
}

/** Signature compacte des paramètres (« marque, pays?, univers?: casino|paris ») : moins de texte pour l'IA, même sens. */
export function compactParams(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, { type?: unknown; enum?: unknown[]; items?: { type?: unknown } } | undefined>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return Object.entries(props)
    .map(([k, v]) => {
      const t = Array.isArray(v?.enum) ? v!.enum.map(String).join("|") : v?.type === "array" ? `liste de ${String(v.items?.type ?? "texte")}` : String(v?.type ?? "texte");
      return `${k}${required.has(k) ? "" : "?"}: ${t}`;
    })
    .join(", ");
}

function opLine(op: SiteOpMeta): string {
  const ex = op.examples[0] ? ` — « ${op.examples[0]} »` : "";
  return `${op.key} : ${op.description}${ex}`;
}

/** Outils de l'IA, un par domaine qui a au moins une opération. */
export function siteTools(byDomain: Map<SiteDomain, SiteOpMeta[]> = siteOpsByDomain()): AiToolDef[] {
  const out: AiToolDef[] = [];
  for (const [domain, ops] of byDomain) {
    const schemas = ops.map((o) => `${o.key}(${compactParams(publicParamsOf(o))})`).join(" ; ");
    out.push({
      name: siteToolName(domain),
      description: [
        `${SITE_DOMAIN_LABELS[domain]} (ce qu'on fait sur le site, par une phrase). Opérations :`,
        ...ops.map(opLine),
        "Ne mets jamais une clé, un jeton ou un mot de passe dans params : je les demande moi-même en privé.",
      ].join("\n"),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          op: { type: "string", enum: ops.map((o) => o.key), description: "Clé exacte de l'opération" },
          params: { type: "object", description: `Paramètres de l'opération (« ? » = facultatif, « a|b » = une des valeurs) : ${schemas}` },
        },
        required: ["op"],
      },
    });
  }
  return out;
}

export type SiteToolDecision = { type: "site"; domain: SiteDomain; op: SiteOpMeta; params: Record<string, unknown> };

/** Appel d'outil de l'IA → opération validée, ou null (pas un outil du site, ou sortie invalide). */
export function siteToolDecision(toolUse: { name: string; input: unknown } | null): SiteToolDecision | { type: "invalid"; reason: string } | null {
  if (!toolUse || !toolUse.name.startsWith(SITE_TOOL_PREFIX)) return null;
  const domain = toolUse.name.slice(SITE_TOOL_PREFIX.length) as SiteDomain;
  if (!(domain in SITE_DOMAIN_LABELS)) return { type: "invalid", reason: `outil inconnu : ${toolUse.name.slice(0, 40)}` };
  const input = toolUse.input && typeof toolUse.input === "object" && !Array.isArray(toolUse.input) ? (toolUse.input as Record<string, unknown>) : null;
  if (!input || typeof input.op !== "string") return { type: "invalid", reason: "opération absente" };
  const op = siteOp(input.op);
  if (!op || op.domain !== domain) return { type: "invalid", reason: `opération inconnue : ${String(input.op).slice(0, 40)}` };
  const raw = input.params;
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) return { type: "invalid", reason: "paramètres illisibles" };
  // Les champs secrets ne viennent jamais de l'IA (demandés en privé) : retirés même s'ils sont fournis.
  const secret = new Set(op.secretParams ?? []);
  const params = Object.fromEntries(Object.entries((raw ?? {}) as Record<string, unknown>).filter(([k]) => !secret.has(k)));
  return { type: "site", domain, op, params };
}
