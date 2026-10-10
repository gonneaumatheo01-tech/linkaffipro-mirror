/**
 * Manifeste des captures (`docs/captures/index.json`) et index lisible `docs/REFONTE-CAPTURES.md`
 * (fonctions pures, testées dans manifest.test.ts). Une passe partielle (`--pages /,/members`) ne remplace que ses
 * propres lignes : le manifeste garde les autres pages capturées auparavant.
 */
import { sortRoutes } from "./routes";

/**
 * ok : capturée ; absent : 404 (page pas encore créée) ; redirect : l'adresse renvoie ailleurs (ancienne adresse) ;
 * error : réponse 5xx ou échec du chargement (capture faite si possible) ; no-id : fiche sans identifiant en base.
 */
export type CaptureStatus = "ok" | "absent" | "redirect" | "error" | "no-id";

export type CaptureEntry = {
  /** Adresse générique (`/campaigns/[id]`), clé de la ligne. */
  route: string;
  /** Adresse réellement visitée (identifiant réel), null si aucune. */
  path: string | null;
  /** Titre de la page (h1, sinon titre du document). */
  title: string | null;
  status: CaptureStatus;
  httpStatus: number | null;
  redirectedTo: string | null;
  note: string | null;
  /** Fichier par largeur (« 1440 » → accueil-1440.webp). */
  files: Record<string, string>;
  /** Erreurs JavaScript vues pendant le chargement (exceptions et console.error), toutes largeurs. */
  jsErrors: number;
  /** Jusqu'à 3 messages d'erreur distincts (première ligne), pour savoir quoi corriger. */
  errorSamples?: string[];
  capturedAt: string;
};

export type CaptureManifest = { version: 1; updatedAt: string; entries: CaptureEntry[] };

export function emptyManifest(): CaptureManifest {
  return { version: 1, updatedAt: "", entries: [] };
}

/** Lecture tolérante du manifeste (absent ou illisible : vide). */
export function parseManifest(text: string | null): CaptureManifest {
  if (!text) return emptyManifest();
  try {
    const v = JSON.parse(text) as Partial<CaptureManifest>;
    if (!v || v.version !== 1 || !Array.isArray(v.entries)) return emptyManifest();
    return {
      version: 1,
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "",
      entries: v.entries.filter(
        (e): e is CaptureEntry => !!e && typeof e === "object" && typeof e.route === "string",
      ),
    };
  } catch {
    return emptyManifest();
  }
}

/** Les lignes de la nouvelle passe remplacent celles de même adresse ; `prune` ne garde que la nouvelle passe. */
export function mergeEntries(
  prev: readonly CaptureEntry[],
  next: readonly CaptureEntry[],
  opts: { prune?: boolean } = {},
): CaptureEntry[] {
  const byRoute = new Map<string, CaptureEntry>();
  if (!opts.prune) for (const e of prev) byRoute.set(e.route, e);
  for (const e of next) byRoute.set(e.route, e);
  return sortRoutes([...byRoute.keys()]).map((r) => byRoute.get(r)!);
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

function attr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Largeur d'affichage de la miniature : un quart de la largeur réelle, entre 120 et 360 px. */
function thumbWidth(width: number): number {
  return Math.max(120, Math.min(360, Math.round(width / 4)));
}

function statusNote(e: CaptureEntry): string | null {
  switch (e.status) {
    case "absent":
      return `absente (${e.httpStatus ?? 404})`;
    case "redirect": {
      if (!e.redirectedTo) return "redirection";
      const [target, query] = e.redirectedTo.split("?");
      return `redirige vers \`${target}\`${query ? " (avec paramètres)" : ""}`;
    }
    case "no-id":
      return "aucun identifiant dans la base locale (lancez pnpm db:demo)";
    case "error":
      return `erreur${e.httpStatus ? ` ${e.httpStatus}` : ""}`;
    default:
      return null;
  }
}

/** Index markdown : un tableau page / adresse / une image par largeur, miniatures cliquables. */
export function renderIndex(
  manifest: CaptureManifest,
  opts: { imageDir: string; widths: readonly number[] },
): string {
  const widths = [...opts.widths];
  for (const e of manifest.entries)
    for (const w of Object.keys(e.files).map(Number))
      if (Number.isInteger(w) && !widths.includes(w)) widths.push(w);
  const dir = opts.imageDir.replace(/\/+$/, "");
  const lines: string[] = [
    "# Captures d'écran de la refonte",
    "",
    "Index généré par `pnpm captures` (ne pas modifier à la main) : une ligne par page, capture pleine page à chaque",
    "largeur, en webp. Procédure complète (base de démonstration locale, serveur de développement, contrôle axe) :",
    "voir l'en-tête de `apps/web/scripts/captures.ts`.",
    "",
    `Dernière mise à jour : ${manifest.updatedAt ? manifest.updatedAt.slice(0, 16).replace("T", " ") + " UTC" : "jamais"}.`,
    "",
    `| Page | Adresse | ${widths.map((w) => `${w} px`).join(" | ")} |`,
    `| --- | --- | ${widths.map(() => "---").join(" | ")} |`,
  ];
  for (const e of manifest.entries) {
    const title = e.title?.trim() || e.route;
    const notes = [
      statusNote(e),
      e.note,
      e.jsErrors > 0 ? `${e.jsErrors} erreur(s) JavaScript (détail dans index.json)` : null,
    ]
      .filter((x): x is string => !!x)
      .join(" ; ");
    const address = `\`${e.route}\`${notes ? ` : ${notes}` : ""}`;
    const images = widths.map((w) => {
      const f = e.files[String(w)];
      if (!f) return "—";
      const src = `${dir}/${f}`;
      return `<a href="${attr(src)}"><img src="${attr(src)}" alt="${attr(`${title}, ${w} px`)}" width="${thumbWidth(w)}"></a>`;
    });
    lines.push(`| ${cell(title)} | ${cell(address)} | ${images.map(cell).join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}
