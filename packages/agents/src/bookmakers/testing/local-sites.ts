/**
 * Phase 35 (chantier B) — serveur local des trois bookmakers INVENTÉS (`fixtures/bookmakers/<site>/`), pour les tests
 * seulement : un serveur HTTP par site sur `127.0.0.1` (port libre), variantes réglables à chaud (`setVariant`), journal
 * des requêtes (rythme, jamais de mise). Celsius : API JSON avec jeton « Bearer » ; Sportaza : pages rendues par le
 * serveur ; Bet Portal : WebSocket minimal (`/ws/feed`, messages de `ws-messages.jsonl`). Aucun accès réseau extérieur.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { fileURLToPath } from "node:url";
import {
  CELSIUS_TEST_TOKEN,
  FIXTURE_SITE_KEYS,
  FIXTURE_TODAY,
  type FixtureSiteKey,
  type FixtureVariant,
} from "./world";

export const FIXTURES_DIR = fileURLToPath(
  new URL("../../../fixtures/bookmakers/", import.meta.url),
);

export type LocalSite = {
  key: FixtureSiteKey;
  origin: string;
  baseUrl: string;
  host: string;
  port: number;
};
export type LocalRequest = {
  site: FixtureSiteKey;
  method: string;
  path: string;
  at: number;
  variant: FixtureVariant | null;
};

export type LocalSites = {
  sites: Record<FixtureSiteKey, LocalSite>;
  setVariant(site: FixtureSiteKey, variant: FixtureVariant | null): void;
  variantOf(site: FixtureSiteKey): FixtureVariant | null;
  requests: LocalRequest[];
  stop(): Promise<void>;
};

const BASE_PATH: Record<FixtureSiteKey, string> = {
  celsius: "/",
  sportaza: "/fr/sports",
  betportal: "/",
};

function readFixture(
  site: FixtureSiteKey,
  variant: FixtureVariant | null,
  name: string,
): string | null {
  if (variant) {
    const v = `${FIXTURES_DIR}${site}/${variant}/${name}`;
    if (existsSync(v)) return readFileSync(v, "utf8");
  }
  const b = `${FIXTURES_DIR}${site}/${name}`;
  return existsSync(b) ? readFileSync(b, "utf8") : null;
}

const html = (res: ServerResponse, body: string, status = 200) =>
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(body);
const json = (res: ServerResponse, body: unknown, status = 200) =>
  res
    .writeHead(status, { "content-type": "application/json; charset=utf-8" })
    .end(typeof body === "string" ? body : JSON.stringify(body));

function searchPage(
  title: string,
  results: Array<{ home: string; away: string; url: string; league: string }>,
): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1><ul class="search-results">${results
    .map(
      (r) =>
        `<li class="search-result"><a href="${r.url}">${esc(r.home)} - ${esc(r.away)}</a> <small>${esc(r.league)}</small></li>`,
    )
    .join("")}</ul></body></html>`;
}

type IndexRow = {
  id: string;
  league: string;
  home: string;
  away: string;
  kickoff: string;
  url: string;
};
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function siteHandler(site: FixtureSiteKey, state: { variant: FixtureVariant | null }) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const v = state.variant;
    const isApi = path.startsWith("/api/");
    const money = /\/(cashier|deposit|withdraw|wallet)(\/|$)/.test(path);
    if (money)
      return html(
        res,
        `<!doctype html><html><body><h1>Caisse</h1><button id="deposit">Déposer</button></body></html>`,
      );
    if (v === "captcha" || v === "geo") {
      if (isApi) return json(res, { error: v }, 403);
      return html(res, readFixture(site, v, "index.html") ?? "", v === "geo" ? 403 : 200);
    }
    if (req.method === "POST" && /\/login$/.test(path)) {
      res
        .writeHead(302, { location: BASE_PATH[site], "set-cookie": "sess=ok; Path=/; HttpOnly" })
        .end();
      return;
    }
    const expired = v === "expired";
    const send = (name: string) => {
      const body = readFixture(site, v, name);
      if (body == null) return html(res, "<h1>Introuvable</h1>", 404);
      return name.endsWith(".json") ? json(res, body) : html(res, body);
    };
    if (site === "celsius") {
      if (isApi) {
        if (path === "/api/v2/auth/token")
          return expired
            ? json(res, { error: "session_expired" }, 401)
            : json(res, { token: CELSIUS_TEST_TOKEN, expiresIn: 3600 });
        const auth = req.headers.authorization ?? "";
        if (expired || auth !== `Bearer ${CELSIUS_TEST_TOKEN}`)
          return json(res, { error: "unauthorized" }, 401);
        if (path === "/api/v2/account/balance") return send("account.json");
        if (path === "/api/v2/events") {
          const raw = JSON.parse(readFixture(site, v, "events.json") ?? "{}") as Record<
            string,
            unknown
          >;
          const date = url.searchParams.get("date") ?? FIXTURE_TODAY;
          const pageNo = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
          const size = 5;
          if (v === "changed") {
            const items = (
              (raw.result as { items: Array<{ startTime: string }> }).items ?? []
            ).filter((e) => e.startTime.slice(0, 10) === date);
            const slice = items.slice((pageNo - 1) * size, pageNo * size);
            return json(res, {
              result: { items: slice },
              paging: { page: pageNo, next: pageNo * size < items.length ? pageNo + 1 : null },
            });
          }
          const all = ((raw.data as { events: Array<{ kickoff: string }> }).events ?? []).filter(
            (e) => e.kickoff.slice(0, 10) === date,
          );
          const slice = all.slice((pageNo - 1) * size, pageNo * size);
          return json(res, {
            data: { events: slice },
            meta: {
              page: pageNo,
              pageSize: size,
              total: all.length,
              hasMore: pageNo * size < all.length,
            },
          });
        }
        const m = /^\/api\/v2\/event\/([^/]+)\/markets$/.exec(path);
        if (m) return send(`event-${m[1]}.json`);
        if (path === "/api/v2/search") {
          const q = fold(url.searchParams.get("q") ?? "");
          const raw = JSON.parse(readFixture(site, null, "events.json") ?? "{}") as {
            data: {
              events: Array<{
                id: string;
                league: { name: string };
                participants: { home: string; away: string };
                kickoff: string;
                marketCount: number;
              }>;
            };
          };
          const results = raw.data.events
            .filter(
              (e) =>
                q &&
                (fold(e.participants.home).includes(q) || fold(e.participants.away).includes(q)),
            )
            .map((e) => ({
              id: e.id,
              league: e.league.name,
              home: e.participants.home,
              away: e.participants.away,
              kickoff: e.kickoff,
              n: e.marketCount,
            }));
          return json(res, { results });
        }
        return json(res, { error: "not_found" }, 404);
      }
      if (path === "/") return send("home.html");
      if (expired) return html(res, readFixture(site, "expired", "index.html") ?? "");
      if (path === "/sports/football") return send("football.html");
      if (path === "/sports/search") return send("search.html");
      const ev = /^\/sports\/football\/event\/([^/]+)$/.exec(path);
      if (ev && readFixture(site, v, `event-${ev[1]}.json`) != null) return send("event.html");
      return html(res, "<h1>Introuvable</h1>", 404);
    }
    if (site === "sportaza") {
      if (path === "/fr/sports" || path === "/fr/sports/") return send("home.html");
      if (expired) return html(res, readFixture(site, "expired", "index.html") ?? "");
      if (path === "/fr/sports/football")
        return send(`football-${url.searchParams.get("jour") ?? FIXTURE_TODAY}.html`);
      const mm = /^\/fr\/sports\/match\/([^/]+)$/.exec(path);
      if (mm) return send(`match-${mm[1]}.html`);
      if (path === "/fr/sports/recherche") {
        const q = fold(url.searchParams.get("q") ?? "");
        const rows = JSON.parse(readFixture(site, v, "search-index.json") ?? "[]") as IndexRow[];
        return html(
          res,
          searchPage(
            "Résultats de recherche",
            rows.filter((r) => q && (fold(r.home).includes(q) || fold(r.away).includes(q))),
          ),
        );
      }
      return html(res, "<h1>Introuvable</h1>", 404);
    }
    // Bet Portal
    if (path === "/") return send("home.html");
    if (expired) return html(res, readFixture(site, "expired", "index.html") ?? "");
    if (path === "/football") return send("football.html");
    if (/^\/football\/match\/[^/]+$/.test(path)) return send("match.html");
    if (path === "/search") {
      const q = fold(url.searchParams.get("q") ?? "");
      const rows = JSON.parse(readFixture(site, null, "search-index.json") ?? "[]") as IndexRow[];
      return html(
        res,
        searchPage(
          "Search results",
          rows.filter((r) => q && (fold(r.home).includes(q) || fold(r.away).includes(q))),
        ),
      );
    }
    return html(res, "<h1>Not found</h1>", 404);
  };
}

// --- WebSocket minimal (RFC 6455 : trames texte, client masqué, serveur non masqué) -------------------------------

function wsFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let head: Buffer;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/** Lit les trames complètes d'un tampon ; rend les textes et le reste non lu. */
function wsParse(buf: Buffer): { messages: Array<{ opcode: number; text: string }>; rest: Buffer } {
  const messages: Array<{ opcode: number; text: string }> = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off]!;
    const b1 = buf[off + 1]!;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    const masked = (b1 & 0x80) !== 0;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (buf.length - p < len) break;
    const data = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] = data[i]! ^ mask[i % 4]!;
    messages.push({ opcode: b0 & 0x0f, text: data.toString("utf8") });
    off = p + len;
  }
  return { messages, rest: Buffer.from(buf.subarray(off)) };
}

function betportalWs(state: { variant: FixtureVariant | null }, log: (path: string) => void) {
  return (req: IncomingMessage, socket: Socket) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const key = req.headers["sec-websocket-key"];
    if (path !== "/ws/feed" || typeof key !== "string") {
      socket.destroy();
      return;
    }
    log(path);
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      const parsed = wsParse(Buffer.concat([pending, chunk]));
      pending = parsed.rest;
      for (const m of parsed.messages) {
        if (m.opcode === 8) {
          socket.end(Buffer.from([0x88, 0]));
          return;
        }
        if (m.opcode !== 1) continue;
        let sub: { topic?: string; day?: string; eventId?: string };
        try {
          sub = JSON.parse(m.text) as typeof sub;
        } catch {
          continue;
        }
        const v = state.variant;
        if (v === "expired" || v === "captcha" || v === "geo") {
          socket.write(
            wsFrame(
              JSON.stringify({
                t: "error",
                code: v === "expired" ? 401 : 403,
                msg: v === "expired" ? "session expired" : v,
              }),
            ),
          );
          continue;
        }
        const lines = (readFixture("betportal", v, "ws-messages.jsonl") ?? "")
          .split("\n")
          .filter(Boolean);
        for (const line of lines) {
          const j = JSON.parse(line) as {
            t?: string;
            type?: string;
            day?: string;
            eid?: string;
            payload?: { day?: string; eventId?: string };
          };
          const d = j.day ?? j.payload?.day;
          const e = j.eid ?? j.payload?.eventId;
          const kind = (j.t ?? j.type ?? "").includes("event") ? "events" : "markets";
          if (sub.topic === "events" && kind === "events" && d === (sub.day ?? FIXTURE_TODAY))
            socket.write(wsFrame(line));
          if (sub.topic === "markets" && kind === "markets" && e === sub.eventId)
            socket.write(wsFrame(line));
        }
      }
    });
    socket.on("error", () => undefined);
  };
}

/** Démarre les trois sites (ou ceux demandés) sur 127.0.0.1, ports libres. */
export async function startLocalSites(
  opts: {
    variants?: Partial<Record<FixtureSiteKey, FixtureVariant | null>>;
    only?: FixtureSiteKey[];
  } = {},
): Promise<LocalSites> {
  const states = Object.fromEntries(
    FIXTURE_SITE_KEYS.map((k) => [k, { variant: opts.variants?.[k] ?? null }]),
  ) as Record<FixtureSiteKey, { variant: FixtureVariant | null }>;
  const requests: LocalRequest[] = [];
  const servers: Server[] = [];
  const sockets = new Set<Socket>();
  const sites = {} as Record<FixtureSiteKey, LocalSite>;
  for (const key of opts.only ?? FIXTURE_SITE_KEYS) {
    const handler = siteHandler(key, states[key]);
    const server = createServer((req, res) => {
      requests.push({
        site: key,
        method: req.method ?? "GET",
        path: req.url ?? "/",
        at: Date.now(),
        variant: states[key].variant,
      });
      try {
        handler(req, res);
      } catch (err) {
        if (!res.headersSent) res.writeHead(500).end(String((err as Error).message));
      }
    });
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    if (key === "betportal")
      server.on(
        "upgrade",
        betportalWs(states[key], (path) =>
          requests.push({
            site: key,
            method: "WS",
            path,
            at: Date.now(),
            variant: states[key].variant,
          }),
        ),
      );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    sites[key] = { key, origin, host: "127.0.0.1", port, baseUrl: `${origin}${BASE_PATH[key]}` };
    servers.push(server);
  }
  return {
    sites,
    requests,
    setVariant(site, variant) {
      states[site].variant = variant;
    },
    variantOf(site) {
      return states[site].variant;
    },
    async stop() {
      for (const s of sockets) s.destroy();
      await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    },
  };
}
