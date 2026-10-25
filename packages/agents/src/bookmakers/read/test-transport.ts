/**
 * Phase 35, chantier C — TESTS SEULEMENT : transport « navigateur simulé » vers les sites locaux du chantier B
 * (`startLocalSites`, 127.0.0.1 uniquement). `fetchApi` appelle l'API du site avec la session (jeton Celsius obtenu à
 * l'ouverture d'une page, comme un vrai navigateur) ; `page` lit le HTML rendu par le serveur et suit les LIENS des
 * étapes (un bouton n'ouvre rien : toutes les sections sont déjà dans la page) ; `captureOf` rend une fausse image qui
 * porte le texte de la zone (lu par la fausse IA de vision). Jamais importé par le code de production.
 */
import type { BookmakerTransport, DomStep } from "../contract";
import { candidateNodes } from "./dom-read";
import { descendants, parseHtml, textOf, type HtmlNode } from "./html";

export type TransportCall = { kind: "api" | "page"; siteKey: string; url: string; at: number };

const LOCAL = /^http:\/\/127\.0\.0\.1:\d+\//;

function hrefOf(n: HtmlNode): string | null {
  for (let p: HtmlNode | null = n; p; p = p.parent) if (p.tag === "a" && p.attrs.href) return p.attrs.href;
  for (const d of descendants(n)) if (d.tag === "a" && d.attrs.href) return d.attrs.href;
  return null;
}

function firstNode(root: HtmlNode, step: DomStep): HtmlNode | null {
  for (const c of step.candidates) {
    const n = candidateNodes(root, c)[0];
    if (n) return n;
  }
  return null;
}

/** Fausse image : `data:image/png;base64,` + texte de la zone (lu par `fakeVisionLlm`). */
export function fakeZoneImage(text: string): string {
  return `data:image/png;base64,${Buffer.from(`ZONE:${text}`, "utf8").toString("base64")}`;
}

/** Fausse IA de vision : rend la dernière cote écrite dans la zone (ou ce que `override` impose). */
export function fakeVisionLlm(o: { override?: (zone: string) => string | null } = {}) {
  const calls: Array<{ model: string; user: string; zone: string }> = [];
  return {
    calls,
    async complete(req: { model: string; user: string; images?: Array<{ base64: string }> }) {
      const zone = req.images?.[0] ? Buffer.from(req.images[0].base64, "base64").toString("utf8").replace(/^ZONE:/, "") : "";
      calls.push({ model: req.model, user: req.user, zone });
      const forced = o.override?.(zone);
      if (forced !== undefined && forced !== null) return { text: forced, costCents: 1 };
      const m = /(\d+[.,]\d+)(?!.*\d)/.exec(zone);
      return { text: m ? m[1]! : "NONE", costCents: 1 };
    },
  };
}

export function createLocalTransport(o: { now: () => Date; tokenUrl?: Record<string, string> }): BookmakerTransport & { calls: TransportCall[]; maxInflight: number } {
  const tokens = new Map<string, string | null>();
  const calls: TransportCall[] = [];
  let inflight = 0;
  const t = {
    target: "server" as const,
    calls,
    maxInflight: 0,
    async fetchApi(siteKey: string, req: { method: string; url: string; headers?: string[]; body?: string | null }) {
      if (!LOCAL.test(req.url)) throw new Error(`test : adresse non locale refusée (${req.url})`);
      calls.push({ kind: "api", siteKey, url: req.url, at: o.now().getTime() });
      inflight++;
      t.maxInflight = Math.max(t.maxInflight, inflight);
      try {
        const headers: Record<string, string> = { accept: "application/json" };
        const tok = tokens.get(siteKey);
        if (tok && (req.headers ?? []).some((h) => h.toLowerCase() === "authorization")) headers.authorization = `Bearer ${tok}`;
        const r = await fetch(req.url, { method: req.method, headers, ...(req.body ? { body: req.body } : {}) });
        if (r.status === 401 || r.status === 403) return { authExpired: true as const };
        return { status: r.status, body: await r.text() };
      } finally {
        inflight--;
      }
    },
    async page(siteKey: string, req: { url: string; steps?: Array<{ click?: DomStep; waitFor?: DomStep }>; captureOf?: DomStep | null }) {
      if (!LOCAL.test(req.url)) throw new Error(`test : adresse non locale refusée (${req.url})`);
      inflight++;
      t.maxInflight = Math.max(t.maxInflight, inflight);
      try {
        const open = async (url: string) => {
          calls.push({ kind: "page", siteKey, url, at: o.now().getTime() });
          const r = await fetch(url);
          return { url: r.url || url, html: await r.text() };
        };
        // Session du navigateur : la page obtient le jeton (Celsius), comme le script du vrai site.
        const tokenUrl = o.tokenUrl?.[siteKey];
        if (tokenUrl) {
          const r = await fetch(tokenUrl);
          tokens.set(siteKey, r.ok ? ((await r.json()) as { token?: string }).token ?? null : null);
        }
        let cur = await open(req.url);
        for (const s of req.steps ?? []) {
          if (!s.click) continue;
          const node = firstNode(parseHtml(cur.html), s.click);
          const href = node ? hrefOf(node) : null;
          if (href) cur = await open(new URL(href, cur.url).toString());
        }
        const root = parseHtml(cur.html);
        let image: string | null = null;
        if (req.captureOf) {
          const zone = firstNode(root, req.captureOf);
          image = zone ? fakeZoneImage(textOf(zone)) : null;
        }
        return { url: cur.url, html: cur.html, text: textOf(root), image };
      } finally {
        inflight--;
      }
    },
    async record() {
      return { obstacle: "apprentissage hors du lecteur" };
    },
  };
  return t;
}
