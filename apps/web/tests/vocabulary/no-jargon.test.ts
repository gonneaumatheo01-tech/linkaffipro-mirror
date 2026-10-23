/**
 * Zéro jargon en surface (règle 3 de la refonte, table « Vocabulaire » de docs/REFONTE-UX.md) : aucun mot technique
 * (FTD, NGR, ROAS, CPL, CPA, sub-ID, webhook, postback, cohorte, entonnoir, segment, séquence, automatisation,
 * envoi groupé, Dating) dans le TEXTE visible des écrans. Le terme technique reste disponible au survol : composant
 * `Term` (`<Term term="FTD">premiers dépôts</Term>`), propriété `term` d'une carte ou d'une colonne, attribut `title`.
 * Contrôle statique des sources (comme tests/a11y) : il tourne à chaque `pnpm test`. Analyse : ./jargon-scan.ts.
 *
 * Périmètre : `app/`, `components/` et `lib/` (écrans, libellés partagés, messages d'erreur et retours d'actions).
 * Exports CSV (`…/export/route.ts`) et aide intégrée (`lib/help/`, rendue en Markdown, sans `Term`) : le terme
 * technique est permis entre parenthèses après le mot du client (« Premiers dépôts (FTD) »), jamais seul.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENTS_JARGON, jargonIn, scanSource } from "./jargon-scan";

const WEB = join(__dirname, "..", "..");
const ROOTS = ["app", "components", "lib"];

/**
 * Exceptions (courtes et justifiées) : dossiers où le terme exact est attendu.
 * - Réglages → Avancé (retours du casino) : le partenaire parle de « postback » et de « sub_id » ; c'est la seule
 *   place du terme exact (docs/REFONTE-UX.md). Le moteur `lib/postback` écrit les messages de son journal.
 * - Styleguide : page interne de démonstration de `Term` et `HelpTip`, avec les termes qu'ils montrent.
 */
const EXCEPTIONS = ["app/(admin)/settings/postbacks/", "lib/postback/", "app/(admin)/styleguide/"];

/** Fichiers où « mot du client (terme) » est la seule façon de montrer le terme (pas de survol). */
const PARENTHESES_ALLOWED = /(\/export\/route\.ts$|^lib\/help\/)/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts"))
      out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => sourceFiles(join(WEB, r))).map((f) => ({
  rel: relative(WEB, f).split("\\").join("/"),
  path: f,
}));

function offenders(): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (EXCEPTIONS.some((e) => f.rel.startsWith(e))) continue;
    const hits = scanSource(readFileSync(f.path, "utf8"), f.rel, {
      parenthesizedTermsAllowed: PARENTHESES_ALLOWED.test(f.rel),
    });
    for (const h of hits) out.push(`${f.rel}:${h.line} [${h.words.join(", ")}] ${h.text}`);
  }
  return out;
}

describe("vocabulaire : aucun terme technique en surface", () => {
  it("trouve des écrans à contrôler", () => {
    expect(files.filter((f) => f.rel.endsWith(".tsx")).length).toBeGreaterThan(100);
  });

  it("les exceptions existent et restent courtes", () => {
    expect(EXCEPTIONS.length).toBeLessThanOrEqual(3);
    for (const e of EXCEPTIONS) expect(existsSync(join(WEB, e)), e).toBe(true);
  });

  // Analyse syntaxique de tous les écrans : quelques secondes seul, bien plus pendant la suite complète.
  it("aucun mot technique dans le texte visible (le terme passe par Term, `term` ou `title`)", () => {
    expect(offenders()).toEqual([]);
  }, 60_000);
});

/** Rubrique Agents (phase 19) : en plus du jargon commun, aucun terme du moteur (file, service, réglage brut). */
const AGENTS_ROOTS = ["app/(admin)/agents/", "components/agents/", "lib/agents/"];

describe("vocabulaire de la rubrique Agents", () => {
  it("contrôle bien les écrans de la rubrique", () => {
    expect(files.filter((f) => AGENTS_ROOTS.some((r) => f.rel.startsWith(r))).length).toBeGreaterThan(10);
  });

  it("ni « BullMQ », ni « worker », ni « API », ni « JSON », ni « prompt », ni « Playwright », ni « proxy » en surface", () => {
    const out: string[] = [];
    for (const f of files.filter((x) => AGENTS_ROOTS.some((r) => x.rel.startsWith(r))))
      for (const h of scanSource(readFileSync(f.path, "utf8"), f.rel, { extraRules: AGENTS_JARGON }))
        out.push(`${f.rel}:${h.line} [${h.words.join(", ")}] ${h.text}`);
    expect(out).toEqual([]);
  }, 60_000);

  it("la règle reconnaît les termes du moteur", () => {
    const w = (src: string) =>
      scanSource(src, "x.tsx", { extraRules: AGENTS_JARGON }).flatMap((h) => h.words);
    expect(w(`<p>La file BullMQ du worker</p>`)).toEqual(["BullMQ", "worker"]);
    expect(w(`<p>Clé API au format JSON</p>`)).toEqual(["API", "JSON"]);
    expect(w(`<p>Clé du fournisseur</p>`)).toEqual([]);
    expect(w(`<p>Captures par Playwright via un proxy</p>`)).toEqual(["Playwright", "proxy"]);
    expect(w(`<Term term="proxy : adresse résidentielle">Adresse internet de secours</Term>`)).toEqual([]);
    expect(w(`<p>La cote du pari chez le bookmaker</p>`)).toEqual([]);
  });
});

/** Raccourci : mots trouvés dans un extrait de TSX. */
const words = (src: string, options?: Parameters<typeof scanSource>[2]) =>
  scanSource(src, "x.tsx", options).flatMap((h) => h.words);

describe("le contrôle reconnaît le texte visible", () => {
  it("texte entre balises, attributs de texte et libellés d'objets", () => {
    expect(words(`<p>Premiers dépôts (FTD)</p>`)).toEqual(["FTD"]);
    expect(words(`<PageHeader title="Segments" />`)).toEqual(["segment"]);
    expect(words(`<Input id="s" placeholder="Votre sub-ID" />`)).toEqual(["sub-ID"]);
    expect(words(`<Button aria-label="Reposer le webhook" />`)).toEqual(["webhook"]);
    expect(words(`const cols = [{ key: "ftd", header: "FTD" }];`)).toEqual(["FTD"]);
    expect(words(`const m = { label: "NGR (€)" };`)).toEqual(["NGR"]);
    expect(words(`export const metadata = { title: "Cohortes" };`)).toEqual(["cohorte"]);
    expect(words(`<span>{ok ? "Postback reçu" : "Rien"}</span>`)).toEqual(["postback"]);
    expect(words(`<EmptyState title="Aucun envoi groupé" />`)).toEqual(["envoi groupé"]);
    expect(words(`<p>{\`\${n} séquences\`}</p>`)).toEqual(["séquence"]);
    expect(words(`<UniverseDot label="Dating" />`)).toEqual(["Dating"]);
  });

  it("phrases hors JSX : erreurs, retours d'action, valeurs passées dans l'adresse", () => {
    expect(words(`throw new Error("Séquence introuvable.");`)).toEqual(["séquence"]);
    expect(words(`back({ error: "Automatisation inconnue." });`)).toEqual(["automatisation"]);
    expect(words(`params.set("error", "Entonnoir vide pour cette période");`)).toEqual([
      "entonnoir",
    ]);
    expect(words('redirect(`/x?ok=${encodeURIComponent("ROAS mis à jour")}`);')).toEqual(["ROAS"]);
  });

  it("ignore le survol, les commentaires, les identifiants et les chaînes techniques", () => {
    expect(words(`<span title="Terme technique : FTD">premier dépôt</span>`)).toEqual([]);
    expect(words(`<Button title="Coût par membre (CPL)">Coût</Button>`)).toEqual([]);
    expect(words(`<Term term="FTD">premiers dépôts</Term>`)).toEqual([]);
    expect(words(`<StatCard label="Premiers dépôts" term="FTD" value="3" />`)).toEqual([]);
    expect(
      words(`const c = { key: "roas", header: "Retour sur dépense pub", term: "ROAS" };`),
    ).toEqual([]);
    expect(words(`// FTD et NGR\n/* segment */ const segment = parseSegment(x);`)).toEqual([]);
    expect(words(`<p>{/* sub-ID */}identifiant de suivi</p>`)).toEqual([]);
    expect(words(`if (kind === "postback") return; switch (t) { case "FTD": break; }`)).toEqual([]);
    expect(words(`type T = "FTD" | "NGR"; const where = { type: "FTD" };`)).toEqual([]);
    expect(words(`import { x } from "./segment"; import "@/lib/postback/apply";`)).toEqual([]);
    expect(
      words(`const s = searchParams.get("segment"); revalidatePath("/settings/postbacks");`),
    ).toEqual([]);
    expect(words("redirect(`/settings/postbacks?${q}`);")).toEqual([]);
    expect(words(`<p>Paramètre <code>sub_id</code> transmis</p>`)).toEqual([]);
    expect(words(`<div className="segment-bar" data-slot="webhook" />`)).toEqual([]);
    expect(
      words(`logger.info({ id }, "envoi groupé développé"); console.error("[postback] échec");`),
    ).toEqual([]);
  });

  it("exports CSV : le terme entre parenthèses après le mot du client est permis, seul il ne l'est pas", () => {
    const csv = { parenthesizedTermsAllowed: true };
    expect(words(`const h = [{ label: "Premiers dépôts (FTD)" }];`, csv)).toEqual([]);
    expect(words(`const h = ["Revenu net (NGR, €)", "Coût par membre (CPL, EUR)"];`, csv)).toEqual(
      [],
    );
    expect(words(`const h = [{ label: "FTD" }];`, csv)).toEqual(["FTD"]);
    expect(words(`const h = [{ label: "Premiers dépôts (FTD)" }];`)).toEqual(["FTD"]);
  });

  it("un mot technique est reconnu en entier, pas à l'intérieur d'un autre mot", () => {
    expect(jargonIn("Les segments du mois")).toEqual(["segment"]);
    expect(jargonIn("sub-IDs, subid, sub_id")).toEqual(["sub-ID"]);
    expect(jargonIn("Rencontres (dating)")).toEqual(["Dating"]);
    expect(jargonIn("segmentation, cpanel, FTDX, postbacker")).toEqual([]);
    expect(jargonIn("premier dépôt, revenu net, relance automatique, parcours")).toEqual([]);
  });

  it("médias du personnage (phase 20) : « LoRA » seulement au survol, « fichier du personnage » en surface", () => {
    expect(words(`<Label htmlFor="l">Adresse du LoRA</Label>`)).toEqual(["LoRA"]);
    expect(words(`<p>Collez l'adresse des loras</p>`)).toEqual(["LoRA"]);
    expect(
      words(`<Term term="LoRA : fichier d'entraînement">fichier du personnage</Term>`),
    ).toEqual([]);
    expect(words(`<Input name="loraUrl" id="persona-lora-url" />`)).toEqual([]);
    expect(jargonIn("Fichier du personnage (LoRA)")).toEqual(["LoRA"]);
    expect(jargonIn("flora, explorateur")).toEqual([]);
  });

  it("pages d'atterrissage (phase 15) : ni « slug » ni « pixel ID » en surface ; « join » reste le mot du client", () => {
    expect(words(`<Label htmlFor="s">Slug de la page</Label>`)).toEqual(["slug"]);
    expect(words(`<p>Votre Pixel ID TikTok</p>`)).toEqual(["pixel ID"]);
    expect(words(`<PageHeader title="Landing pages" />`)).toEqual(["landing page"]);
    expect(words(`<Label htmlFor="s">Adresse de la page</Label>`)).toEqual([]);
    expect(words(`<p>Identifiant du pixel TikTok</p>`)).toEqual([]);
    expect(
      words(`<StatCard label="Coût par join" term="join = demande d'adhésion au canal" />`),
    ).toEqual([]);
    expect(
      words(`const where = { slug: params.slug }; landingPublicUrl(base, page.slug, "");`),
    ).toEqual([]);
  });
});
