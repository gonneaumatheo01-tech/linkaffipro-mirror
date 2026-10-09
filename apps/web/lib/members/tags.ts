import { prisma } from "@linkaffipro/db";

/**
 * Registre des étiquettes de membres : `Setting` clé `members.tags`, valeur `[{ name, color }]`.
 * Les étiquettes posées sur un membre sont des chaînes dans `Member.tags` (Json). Les automatisations
 * peuvent poser une étiquette absente du registre : elle s'affiche alors en gris.
 */
export const TAGS_SETTING_KEY = "members.tags";

export type TagColor = (typeof TAG_COLORS)[number]["key"];
export type TagDef = { name: string; color: TagColor };

/** Huit couleurs, classes Tailwind écrites en clair (sinon elles ne sont pas générées). */
export const TAG_COLORS = [
  {
    key: "gray",
    label: "Gris",
    className: "border-slate-300 bg-slate-100 text-slate-800",
    swatch: "bg-slate-400",
  },
  {
    key: "red",
    label: "Rouge",
    className: "border-red-300 bg-red-100 text-red-800",
    swatch: "bg-red-500",
  },
  {
    key: "orange",
    label: "Orange",
    className: "border-orange-300 bg-orange-100 text-orange-800",
    swatch: "bg-orange-500",
  },
  {
    key: "yellow",
    label: "Jaune",
    className: "border-amber-300 bg-amber-100 text-amber-800",
    swatch: "bg-amber-400",
  },
  {
    key: "green",
    label: "Vert",
    className: "border-emerald-300 bg-emerald-100 text-emerald-800",
    swatch: "bg-emerald-500",
  },
  {
    key: "teal",
    label: "Turquoise",
    className: "border-teal-300 bg-teal-100 text-teal-800",
    swatch: "bg-teal-500",
  },
  {
    key: "blue",
    label: "Bleu",
    className: "border-blue-300 bg-blue-100 text-blue-800",
    swatch: "bg-blue-500",
  },
  {
    key: "purple",
    label: "Violet",
    className: "border-violet-300 bg-violet-100 text-violet-800",
    swatch: "bg-violet-500",
  },
] as const;

export const TAG_NAME_MAX = 30;
const TAG_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _\-.]{0,29}$/u;

export function isTagColor(v: unknown): v is TagColor {
  return typeof v === "string" && TAG_COLORS.some((c) => c.key === v);
}

/** Nom normalisé (espaces réduits), ou null s'il est invalide. */
export function normalizeTagName(raw: unknown): string | null {
  const name = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return TAG_NAME_RE.test(name) && name.length <= TAG_NAME_MAX ? name : null;
}

export function tagColorClass(color: string | undefined): string {
  return (TAG_COLORS.find((c) => c.key === color) ?? TAG_COLORS[0]).className;
}

/** Lit le registre depuis une valeur JSON quelconque (ignore ce qui est invalide). */
export function parseTagRegistry(value: unknown): TagDef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: TagDef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const name = normalizeTagName((item as { name?: unknown }).name);
    const color = (item as { color?: unknown }).color;
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, color: isTagColor(color) ? color : "gray" });
  }
  return out;
}

export async function getTagRegistry(): Promise<TagDef[]> {
  const s = await prisma.setting.findUnique({ where: { key: TAGS_SETTING_KEY } }).catch(() => null);
  return parseTagRegistry(s?.value);
}

export async function saveTagRegistry(tags: TagDef[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: TAGS_SETTING_KEY },
    create: { key: TAGS_SETTING_KEY, value: tags },
    update: { value: tags },
  });
}

/** Étiquettes d'un membre (depuis `Member.tags`), sans doublon. */
export function memberTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .map((t) => t.trim()),
    ),
  ];
}

/** Couleur d'une étiquette d'après le registre (gris si inconnue). */
export function colorOf(name: string, registry: TagDef[]): TagColor {
  return registry.find((t) => t.name.toLowerCase() === name.toLowerCase())?.color ?? "gray";
}
