import { apiUser } from "@/lib/ai/api-user";
import { withBuiltinSections } from "@/lib/help/builtin-sections";
import { loadGuide } from "@/lib/help/guide";
import { renderMarkdown } from "@/lib/help/markdown";
import { normalizePath, pageHelpFor, type HelpResponse } from "@/lib/help/page-help";
import { guideSections } from "@/lib/help/sections";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Aide de la page courante : GET /api/help?path=/campaigns/abc → sections de docs/GUIDE-UTILISATEUR.md prévues pour
 * cette adresse (table `lib/help/page-help.ts`), complétées des sections intégrées que le guide n'a pas encore
 * (`lib/help/builtin-sections.ts`, même texte que la page /help), rendues en HTML sûr (même rendu que la page /help ; ancres préfixées
 * `aide-`, liens internes vers /help#…). Même contrôle que les pages (`apiUser`) : 401 sans session valide.
 */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return Response.json({ error: "Non connecté." }, { status: 401, headers: NO_STORE });
  const path = normalizePath(new URL(req.url).searchParams.get("path") ?? "/");
  const { help, fallback } = pageHelpFor(path);
  const guide = await loadGuide();
  if (guide.markdown === null) {
    const body: HelpResponse = {
      path,
      label: help.label,
      fallback,
      anchor: null,
      sections: [],
      missing: true,
    };
    return Response.json(body, { headers: NO_STORE });
  }
  const sections = guideSections(withBuiltinSections(guide.markdown), help.sections).map((s) => ({
    id: s.id,
    title: s.title,
    // Le titre de section est un <h3> dans le volet (le titre du volet est le <h2>).
    html: renderMarkdown(s.markdown, {
      idPrefix: "aide-",
      headingOffset: 3 - s.level,
      anchorBase: "/help",
    }),
  }));
  const body: HelpResponse = {
    path,
    label: help.label,
    fallback,
    anchor: sections[0]?.id ?? null,
    sections,
  };
  return Response.json(body, { headers: NO_STORE });
}
