/**
 * Mesure d'une page d'atterrissage (phase 15) sur une adresse donnée, locale ou de production :
 *
 *   node --import tsx apps/web/scripts/landing-measure.ts --url "https://go.goolink.eu/j/test?src=tk01" [--runs 10]
 *        [--json /tmp/landing-measure.json] [--beacon] [--host go.goolink.eu]
 *
 * (`--host` : en-tête Host imposé, pour viser la branche du domaine de tracking d'un serveur local.)
 * - temps de première réponse (TTFB) : connexions neuves (DNS + TCP + TLS + attente) et connexion gardée ouverte,
 *   médiane / 90e centile / minimum ;
 * - poids : HTML brut, et tel qu'envoyé compressé (gzip, br) ; limite de 15 Ko ;
 * - aucune redirection (GET et HEAD), en-têtes (type, cache, ETag + 304, CSP, robots) ;
 * - `<head>` : seulement le petit script d'ouverture automatique (phase 16, en ligne, au tout début), aucune ressource
 *   extérieure ; aide « Ouvrir dans le navigateur » et code d'invitation (`data-k`) présents ;
 * - mêmes octets pour tous : la page est demandée avec plusieurs agents utilisateurs (TikTok, Instagram, Safari,
 *   robots, aucun), et avec le marqueur de sortie de l'appli (`tgo=1&vid=…&tgt=…`), et les empreintes comparées (règle 7 du
 *   client : jamais de redirection selon le navigateur) ;
 * - `--beacon` : temps de réponse de `/j/_e` avec un envoi marqué robot (jamais compté dans les chiffres). Sans cette
 *   option, rien n'est envoyé : la mesure ne crée aucune visite.
 * Code de sortie 1 si une vérification échoue. Aucune dépendance : `node:http(s)` seulement.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

type Timing = { dns: number; connect: number; tls: number; ttfb: number; total: number };
type Fetched = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  timing: Timing;
};

const UAS: Record<string, string> = {
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR WKWebView/1 BytedanceWebview/d8a21c6",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 trill_330604 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/33.6.4 ByteLocale/fr BytedanceWebview/d8a21c6",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 326.0.3.32.105 (iPhone14,5; iOS 17_4; fr_FR; fr; scale=3.00; 1170x2532; 584287262)",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A.240305.019.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 Instagram 321.0.0.39.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; fr_FR; 573487456)",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  facebookPreview: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  tiktokCrawler:
    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  none: "",
};

type Options = {
  url: URL;
  runs: number;
  json: string | null;
  beacon: boolean;
  host: string | null;
};

function parseArgs(argv: string[]): Options {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const raw = get("url") ?? argv.find((a) => /^https?:\/\//.test(a));
  if (!raw || argv.includes("--help")) {
    console.log(
      'Usage : node --import tsx apps/web/scripts/landing-measure.ts --url "https://go.goolink.eu/j/<slug>?src=<source>" [--runs 10] [--json fichier] [--beacon]',
    );
    process.exit(raw ? 0 : 2);
  }
  return {
    url: new URL(raw),
    runs: Math.max(1, Math.min(50, Number(get("runs") ?? 10) || 10)),
    json: get("json") ?? null,
    beacon: argv.includes("--beacon"),
    host: get("host") ?? null,
  };
}

/** Une requête, minutée étape par étape (connexion neuve sauf si `agent` est fourni). */
let HOST_HEADER: string | null = null;
const seenSockets = new WeakSet<object>();

function request(
  url: URL,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    agent?: http.Agent | false;
    body?: string;
  } = {},
): Promise<Fetched> {
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const marks: Record<string, number> = {};
    const req = lib.request(
      url,
      {
        method: opts.method ?? "GET",
        headers: {
          "accept-encoding": "identity",
          ...(HOST_HEADER ? { host: HOST_HEADER } : {}),
          ...opts.headers,
        },
        agent: opts.agent ?? false,
      },
      (res) => {
        marks.ttfb = performance.now();
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const end = performance.now();
          const at = (k: string, fallback: number) => (marks[k] ?? fallback) - t0;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            timing: {
              dns: at("lookup", t0),
              connect: at("connect", t0),
              tls: at("secureConnect", marks.connect ?? t0),
              ttfb: (marks.ttfb ?? end) - t0,
              total: end - t0,
            },
          });
        });
        res.on("error", reject);
      },
    );
    req.on("socket", (socket) => {
      // Connexion gardée ouverte : déjà établie, rien à minuter (et pas d'écouteurs empilés).
      if (seenSockets.has(socket)) return;
      seenSockets.add(socket);
      socket.once("lookup", () => (marks.lookup = performance.now()));
      socket.once("connect", () => (marks.connect = performance.now()));
      socket.once("secureConnect", () => (marks.secureConnect = performance.now()));
    });
    req.setTimeout(15_000, () => req.destroy(new Error("délai dépassé (15 s)")));
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { median: r(q(0.5)), p90: r(q(0.9)), min: r(s[0]!), max: r(s.at(-1)!) };
}

function decode(f: Fetched): Buffer {
  const enc = String(f.headers["content-encoding"] ?? "");
  if (enc === "gzip") return gunzipSync(f.body);
  if (enc === "br") return brotliDecompressSync(f.body);
  return f.body;
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 16);

async function main(): Promise<number> {
  const o = parseArgs(process.argv.slice(2));
  HOST_HEADER = o.host;
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) failures.push(what);
    return ok;
  };

  // 1. Première réponse, connexions neuves puis connexion gardée.
  const cold: Timing[] = [];
  for (let i = 0; i < o.runs; i++) cold.push((await request(o.url)).timing);
  const keepAlive =
    o.url.protocol === "https:"
      ? new https.Agent({ keepAlive: true, maxSockets: 1 })
      : new http.Agent({ keepAlive: true, maxSockets: 1 });
  await request(o.url, { agent: keepAlive });
  const warm: Timing[] = [];
  for (let i = 0; i < o.runs; i++) warm.push((await request(o.url, { agent: keepAlive })).timing);
  keepAlive.destroy();

  // 2. Poids et en-têtes.
  const plain = await request(o.url, { headers: { "user-agent": UAS.tiktokIos! } });
  const gzip = await request(o.url, {
    headers: { "user-agent": UAS.tiktokIos!, "accept-encoding": "gzip" },
  });
  const br = await request(o.url, {
    headers: { "user-agent": UAS.tiktokIos!, "accept-encoding": "br, gzip" },
  });
  const html = plain.body.toString("utf8");
  const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  check(plain.status === 200, `GET : statut ${plain.status} (attendu 200, aucune redirection)`);
  check(!plain.headers.location, "GET : en-tête Location présent (redirection)");
  check(plain.body.length < 15 * 1024, `poids ${plain.body.length} octets (limite 15 360)`);
  // Phase 16 : un seul script dans le <head>, en ligne, au tout début (ouverture automatique) ; rien d'extérieur.
  const headScripts = head.match(/<script[^>]*>/gi) ?? [];
  check(
    headScripts.length === 1 && headScripts[0] === "<script>",
    `le <head> doit avoir un seul script en ligne (${headScripts.length})`,
  );
  check(
    head.startsWith('<meta charset="utf-8"><script>'),
    "le script d'ouverture n'est pas au tout début du <head>",
  );
  check(
    !/<link|src=|@import|url\(/i.test(head.replace(/<script>[\s\S]*?<\/script>/i, "")),
    "ressource extérieure dans le <head>",
  );
  check(/<html lang="[a-z]{2}" data-k="[\w-]+">/.test(html), "code d'invitation (data-k) absent");
  check(
    /<div id="h" class="h" role="dialog"[^>]* hidden data-t='/.test(html),
    "aide absente ou visible",
  );
  check((html.match(/<a\s/g) ?? []).length === 1, "la page doit avoir un seul lien (le bouton)");
  check(/href="https:\/\/t\.me\/\+[\w-]+"/.test(html), "bouton sans lien https://t.me/+…");
  check(
    String(plain.headers["content-type"]).startsWith("text/html"),
    "Content-Type n'est pas text/html",
  );
  check(!!plain.headers.etag, "ETag absent");
  check(/noindex/.test(String(plain.headers["x-robots-tag"])), "X-Robots-Tag noindex absent");
  check(
    /script-src 'sha256-/.test(String(plain.headers["content-security-policy"])),
    "CSP de la page absente",
  );
  const revalidate = await request(o.url, {
    headers: { "if-none-match": String(plain.headers.etag ?? "") },
  });
  check(revalidate.status === 304, `If-None-Match : statut ${revalidate.status} (attendu 304)`);
  const headRes = await request(o.url, { method: "HEAD" });
  check(headRes.status === 200 && !headRes.headers.location, `HEAD : statut ${headRes.status}`);
  check(headRes.body.length === 0, "HEAD : corps non vide");

  // 3. Mêmes octets pour tous les visiteurs.
  const byUa: Record<string, { status: number; sha: string; etag: string }> = {};
  for (const [name, ua] of Object.entries(UAS)) {
    const r = await request(o.url, { headers: ua ? { "user-agent": ua } : {} });
    byUa[name] = { status: r.status, sha: sha(decode(r)), etag: String(r.headers.etag ?? "") };
  }
  // Adresse marquée comme après « Ouvrir dans le navigateur » : mêmes octets, aucune redirection.
  const markedUrl = new URL(o.url);
  markedUrl.searchParams.set("tgo", "1");
  markedUrl.searchParams.set("vid", "measure_marker_0001");
  markedUrl.searchParams.set("tgt", Math.floor(Date.now() / 6e4).toString(36));
  const marked = await request(markedUrl, { headers: { "user-agent": UAS.safariIos! } });
  byUa.safariIosMarked = {
    status: marked.status,
    sha: sha(decode(marked)),
    etag: String(marked.headers.etag ?? ""),
  };
  check(!marked.headers.location, "adresse marquée : redirection");
  const hashes = new Set(Object.values(byUa).map((v) => v.sha));
  check(hashes.size === 1, `corps différents selon l'agent utilisateur (${hashes.size} versions)`);
  check(decode(gzip).equals(plain.body), "corps gzip différent du corps brut");
  check(decode(br).equals(plain.body), "corps br différent du corps brut");

  // 4. Envoi des visites (facultatif, marqué robot : jamais compté).
  let beacon: { status: number; ms: number } | null = null;
  if (o.beacon) {
    const pageId = /data-p="([^"]+)"/.exec(html)?.[1] ?? "";
    const source = /data-s="([^"]*)"/.exec(html)?.[1] ?? "";
    const r = await request(new URL("/j/_e", o.url), {
      method: "POST",
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        origin: o.host ? `${o.url.protocol}//${o.host}` : o.url.origin,
        "user-agent": "landing-measure/1.0 (bot; mesure de vitesse)",
      },
      body: JSON.stringify({
        p: pageId,
        s: source,
        v: `measure_${Date.now()}`,
        t: "VIEW",
        m: null,
        q: o.url.search,
      }),
    });
    beacon = { status: r.status, ms: Math.round(r.timing.total * 10) / 10 };
    check(r.status === 204, `/j/_e : statut ${r.status} (attendu 204)`);
  }

  const report = {
    url: o.url.toString(),
    at: new Date().toISOString(),
    runs: o.runs,
    ttfbColdMs: stats(cold.map((t) => t.ttfb)),
    coldPhasesMedianMs: {
      dns: stats(cold.map((t) => t.dns)).median,
      tcp: stats(cold.map((t) => t.connect - t.dns)).median,
      tls: stats(cold.map((t) => t.tls)).median,
    },
    ttfbWarmMs: stats(warm.map((t) => t.ttfb)),
    bytes: {
      html: plain.body.length,
      gzip: gzip.headers["content-encoding"] === "gzip" ? gzip.body.length : null,
      br: br.headers["content-encoding"] === "br" ? br.body.length : null,
      servedEncoding: {
        gzip: gzip.headers["content-encoding"] ?? "aucune",
        br: br.headers["content-encoding"] ?? "aucune",
      },
    },
    headers: {
      "cache-control": plain.headers["cache-control"],
      etag: plain.headers.etag,
      "content-security-policy": plain.headers["content-security-policy"],
      "x-robots-tag": plain.headers["x-robots-tag"],
      vary: plain.headers.vary ?? null,
      server: plain.headers.server ?? null,
    },
    sameBytesForEveryone: hashes.size === 1,
    byUserAgent: byUa,
    beacon,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  if (o.json) writeFileSync(o.json, JSON.stringify(report, null, 2));
  return failures.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
