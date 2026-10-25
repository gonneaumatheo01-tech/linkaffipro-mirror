/**
 * Phase 34, chantier A — registre des opérations du site vues par Kevin (pur). Une clé = une opération ; les doublons
 * sont refusés au chargement (deux lots qui déclareraient la même clé cassent tout de suite, jamais en silence).
 */
import type { SiteDomain, SiteOpMeta } from "./contract";
import { SITE_OPS } from "./ops";

/** Libellés des domaines (aide, outils de l'IA, inventaire). */
export const SITE_DOMAIN_LABELS: Record<SiteDomain, string> = {
  canaux: "Canaux",
  messages: "Messages",
  pages: "Pages",
  campagnes: "Campagnes",
  membres: "Membres",
  envois: "Envois",
  automatisations: "Relances automatiques",
  conversations: "Conversations",
  agents: "Agents",
  univers: "Univers",
  reglages: "Réglages",
  connecteurs: "Connexions",
  equipe: "Équipe",
  statistiques: "Statistiques",
};

/** Ordre d'affichage des domaines. */
export const SITE_DOMAINS = Object.keys(SITE_DOMAIN_LABELS) as SiteDomain[];

/** Construit l'index par clé ; lève sur une clé en double ou mal formée. Exporté pour les tests. */
export function indexSiteOps(list: readonly SiteOpMeta[]): Map<string, SiteOpMeta> {
  const map = new Map<string, SiteOpMeta>();
  for (const op of list) {
    if (!/^[a-z_]+\.[a-z0-9_-]+$/.test(op.key)) throw new Error(`Opération du site mal nommée : « ${op.key} » (attendu « <domaine>.<verbe> »)`);
    if (!op.key.startsWith(`${op.domain}.`)) throw new Error(`Opération du site « ${op.key} » rangée dans le domaine « ${op.domain} »`);
    if (map.has(op.key)) throw new Error(`Opération du site en double : « ${op.key} »`);
    map.set(op.key, op);
  }
  return map;
}

const BY_KEY = indexSiteOps(SITE_OPS);

/** Opération par sa clé, ou null. */
export function siteOp(key: string): SiteOpMeta | null {
  return BY_KEY.get(key) ?? null;
}

/** Toutes les opérations. */
export function listSiteOps(): SiteOpMeta[] {
  return [...BY_KEY.values()];
}

/** Opérations groupées par domaine (domaines vides absents), dans l'ordre d'affichage. */
export function siteOpsByDomain(list: readonly SiteOpMeta[] = listSiteOps()): Map<SiteDomain, SiteOpMeta[]> {
  const out = new Map<SiteDomain, SiteOpMeta[]>();
  for (const d of SITE_DOMAINS) {
    const ops = list.filter((o) => o.domain === d);
    if (ops.length) out.set(d, ops);
  }
  return out;
}

/** Domaine d'un nom donné par le client (« campagnes », « campagne », « Réglages »…), ou null. */
export function siteDomainOf(raw: string): SiteDomain | null {
  const n = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/s$/, "");
  if (!n) return null;
  for (const d of SITE_DOMAINS) {
    const label = SITE_DOMAIN_LABELS[d].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (d.replace(/s$/, "") === n || label.replace(/s$/, "") === n || label.split(" ")[0]!.replace(/s$/, "") === n) return d;
  }
  if (/^(relance|automatisation)$/.test(n)) return "automatisations";
  if (/^(connecteur|connexion)$/.test(n)) return "connecteurs";
  if (/^(reglage|parametre)$/.test(n)) return "reglages";
  if (/^(stat|statistique|chiffre)$/.test(n)) return "statistiques";
  return null;
}
