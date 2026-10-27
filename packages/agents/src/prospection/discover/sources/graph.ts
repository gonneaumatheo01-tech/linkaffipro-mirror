/**
 * Phase 31, chantier A (Sourceur) : source D, graphe Telegram (la plus puissante).
 *
 * Chaque canal lu par l'Enrichisseur produit des candidats (`expandGraph`, appelé à la fin de chaque lecture) :
 * - origines des posts transférés (`forwardedFrom`) → `GRAPH_FORWARD` ;
 * - mentions `@nom` et liens `t.me/<nom>` des posts (texte, liens, boutons) et de la description → `GRAPH_MENTION` ;
 * - dossiers `t.me/addlist/<hash>` : la page publique du dossier est lue (`readFolder`), ses canaux deviennent des
 *   candidats `FOLDER` ; on n'ajoute rien à aucun compte ;
 * - groupe de discussion lié, s'il est public → candidat `GROUP`.
 * Parcours en largeur : `graphDepth = profondeur de la source + 1`, rien au-delà de `prospection.graph_max_depth` ;
 * le canal lui-même, les bots et les usernames officiels de marques sont exclus ; la priorité suit les cocitations
 * (`upsertCandidates`). Le texte des posts reste en mémoire : seuls les usernames en sortent.
 */
import { readSetting } from "../../../admin/journal";
import { isBrandUsername } from "../../dict";
import { PROSPECTION_SETTINGS, type Candidate, type ProspectDiscoveryResult, type ProspectPost, type ProspectionDeps } from "../../contract";
import { upsertCandidates } from "../dedupe";
import { cleanUsername, extractMentions, extractTmeLinks, normalizeProspectUrl } from "../normalize";
import { politeProspectFetch, type PoliteProspectDeps } from "../polite";
import { errorText, htmlText } from "./common";

export type GraphSourceRef = { id: string; graphDepth: number };
export type GraphRead = { posts: ProspectPost[]; description: string | null; linkedGroup?: string | null };

/** Dossiers lus au plus par lecture d'un canal (une page t.me chacun, 3 s d'écart). */
export const MAX_FOLDERS_PER_READ = 3;

/** Profondeur maximale du graphe (réglage, sinon 3). */
export async function graphMaxDepth(deps: ProspectionDeps): Promise<number> {
  const v = Number(await readSetting(deps, PROSPECTION_SETTINGS.graphMaxDepth.key));
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : PROSPECTION_SETTINGS.graphMaxDepth.value;
}

/**
 * Candidats d'une lecture (pur). `self` : username du canal lu (exclu). Rend aussi les hashs des dossiers trouvés.
 * Un canal à la fois transféré et mentionné compte comme transféré (signal le plus fort).
 */
export function graphCandidatesFromRead(
  source: GraphSourceRef & { username?: string | null },
  read: GraphRead,
): { candidates: Candidate[]; folders: string[] } {
  const self = source.username?.toLowerCase() ?? null;
  const depth = source.graphDepth + 1;
  const found = new Map<string, Candidate>();
  const folders: string[] = [];
  const add = (url: string, sourceType: Candidate["sourceType"], detail: string, kind: Candidate["kind"] = null) => {
    const n = normalizeProspectUrl(url);
    if (!n) return;
    if (n.folder) {
      if (!folders.includes(n.folder)) folders.push(n.folder);
      return;
    }
    if (n.username && (n.username === self || isBrandUsername(n.username))) return;
    const prev = found.get(n.channelUrl);
    if (prev) {
      if (prev.sourceType === "GRAPH_MENTION" && sourceType === "GRAPH_FORWARD") prev.sourceType = "GRAPH_FORWARD";
      return;
    }
    found.set(n.channelUrl, { url: n.channelUrl, sourceType, sourceDetail: detail, discoveredFromId: source.id, graphDepth: depth, kind });
  };

  for (const p of read.posts) {
    const where = `post ${p.id}`;
    const fwd = p.forwardedFrom ? cleanUsername(p.forwardedFrom.replace(/^https?:\/\/t\.me\//i, "")) : null;
    if (fwd) add(`https://t.me/${fwd}`, "GRAPH_FORWARD", `transfert, ${where}`);
    else if (p.forwardedFrom && /t\.me\//i.test(p.forwardedFrom)) add(p.forwardedFrom, "GRAPH_FORWARD", `transfert, ${where}`);
    for (const m of [...p.mentions, ...extractMentions(p.text)]) {
      const u = cleanUsername(m);
      if (u) add(`https://t.me/${u}`, "GRAPH_MENTION", `mention, ${where}`);
    }
    for (const l of [...p.links, ...p.buttons.map((b) => b.url), ...extractTmeLinks(p.text)]) {
      for (const t of extractTmeLinks(l)) add(t, "GRAPH_MENTION", `lien, ${where}`);
    }
  }
  if (read.description) {
    for (const m of extractMentions(read.description)) add(`https://t.me/${m}`, "GRAPH_MENTION", "description");
    for (const l of extractTmeLinks(read.description)) add(l, "GRAPH_MENTION", "description");
  }
  if (read.linkedGroup) {
    const n = normalizeProspectUrl(read.linkedGroup);
    if (n && !n.invite && !n.folder && n.username !== self) {
      found.delete(n.channelUrl);
      found.set(n.channelUrl, { url: n.channelUrl, sourceType: "GRAPH_MENTION", sourceDetail: "groupe de discussion lié", discoveredFromId: source.id, graphDepth: depth, kind: "GROUP" });
    }
  }
  return { candidates: [...found.values()], folders };
}

// ---------------------------------------------------------------- dossiers t.me/addlist

export type FolderPage = { ok: true; title: string | null; channels: string[] } | { ok: false; reason: string };

/**
 * Page publique d'un dossier `t.me/addlist/<hash>` : titre et canaux listés (liens `t.me/<nom>` de la page). Une page
 * qui n'annonce que le nombre de discussions ne donne aucun canal (rien n'est deviné).
 */
export function parseFolderPage(html: string, hash: string): FolderPage {
  if (!/tgme_page/.test(html)) return { ok: false, reason: "page de dossier introuvable" };
  const title = htmlText(html.match(/<div class="tgme_page_title"[^>]*>([\s\S]*?)<\/div>/)?.[1]) || null;
  const channels = extractTmeLinks(html).filter((u) => u !== `https://t.me/addlist/${hash}` && !u.includes("/addlist/"));
  return { ok: true, title, channels };
}

/** Lit la page publique d'un dossier (1 requête t.me, 3 s d'écart). Rien n'est ajouté à aucun compte. */
export async function readFolder(deps: ProspectionDeps & PoliteProspectDeps, hash: string): Promise<FolderPage> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(hash)) return { ok: false, reason: "dossier illisible" };
  try {
    const r = await politeProspectFetch(deps, `https://t.me/addlist/${hash}`, { kind: "tme" });
    if (r.status === 404) return { ok: false, reason: "dossier introuvable" };
    if (r.status < 200 || r.status >= 300) return { ok: false, reason: `réponse ${r.status}` };
    return parseFolderPage(r.body, hash);
  } catch (err) {
    return { ok: false, reason: errorText(err) };
  }
}

/**
 * Candidats du graphe après la lecture d'un canal, dédoublonnés (cocitations) et journalisés. `null` : profondeur
 * maximale atteinte ou rien trouvé. Signature figée : appelée par l'Enrichisseur (chantier B).
 */
export async function expandGraph(
  deps: ProspectionDeps & PoliteProspectDeps,
  source: { id: string; graphDepth: number },
  read: { posts: ProspectPost[]; description: string | null; linkedGroup?: string | null },
): Promise<ProspectDiscoveryResult | null> {
  if (source.graphDepth + 1 > (await graphMaxDepth(deps))) return null;
  const row = await deps.prisma.prospect.findUnique({ where: { id: source.id } });
  const { candidates, folders } = graphCandidatesFromRead({ ...source, username: row?.username ?? null }, read);
  const errors: string[] = [];
  for (const hash of folders.slice(0, MAX_FOLDERS_PER_READ)) {
    const f = await readFolder(deps, hash);
    if (!f.ok) {
      errors.push(`Dossier ${hash} : ${f.reason}`);
      continue;
    }
    const known = new Set(candidates.map((c) => c.url));
    for (const url of f.channels) {
      const n = normalizeProspectUrl(url);
      if (!n || n.folder || known.has(n.channelUrl)) continue;
      if (n.username && (n.username === row?.username || isBrandUsername(n.username))) continue;
      known.add(n.channelUrl);
      candidates.push({
        url: n.channelUrl,
        sourceType: "FOLDER",
        sourceDetail: `https://t.me/addlist/${hash}${f.title ? ` (${f.title.slice(0, 60)})` : ""}`,
        discoveredFromId: source.id,
        graphDepth: source.graphDepth + 1,
      });
    }
  }
  if (!candidates.length && !errors.length) return null;
  const vertical = row?.vertical && row.vertical !== "OTHER" ? row.vertical : null;
  return upsertCandidates(
    deps,
    candidates.map((c) => ({ ...c, vertical: c.vertical ?? (vertical === "BOTH" ? null : vertical) })),
    { sourceType: "GRAPH", sourceDetail: row?.channelUrl ?? source.id, languages: row?.language ? [row.language] : [], vertical },
    { errors },
  );
}
