/**
 * Recherche du jargon dans le TEXTE visible des écrans (règle 3 de la refonte : « zéro jargon en surface »,
 * table « Vocabulaire » de docs/REFONTE-UX.md). Lit les sources TSX en arbre syntaxique (TypeScript) :
 * - texte entre balises JSX, chaînes rendues dans le JSX (`{cond ? "…" : "…"}`) ;
 * - attributs de texte (`label`, `description`, `placeholder`, `aria-label`, `title` d'un composant qui l'affiche…) ;
 * - propriétés de libellé dans les objets (`label:`, `header:`, `title:`, `description:`…) ;
 * - toute autre chaîne « en phrase » (au moins deux mots), par exemple un message d'erreur passé dans l'adresse.
 * Ne sont PAS lus : les commentaires, les identifiants, les types, les imports, les classes CSS, les comparaisons
 * (`x === "FTD"`), les `case`, les clés (`params.get("segment")`), l'attribut HTML `title` (infobulle : la place
 * du terme technique), le composant `Term` (`term="FTD"`) et la propriété `term`, le contenu des balises `<code>`
 * (adresses, champs techniques), les journaux (`console.*`, `logger.*`).
 * Option `parenthesizedTermsAllowed` (exports CSV seulement) : « Premiers dépôts (FTD) » est accepté, le terme
 * technique entre parenthèses suivant le mot du client ; « FTD » seul ne l'est pas.
 */
import ts from "typescript";

export type JargonRule = { word: string; re: RegExp; instead: string };

/** Lettres et chiffres (avec accents) qui ne doivent pas coller au mot cherché. */
const B = String.raw`[\p{L}\p{N}_]`;
const word = (src: string, flags = "iu") => new RegExp(`(?<!${B}|-)(?:${src})(?!${B}|-)`, flags);

/** Mots interdits en surface et mot du client à employer (docs/REFONTE-UX.md, « Vocabulaire »). */
export const JARGON: JargonRule[] = [
  { word: "FTD", re: word("FTDs?", "u"), instead: "premier dépôt" },
  { word: "NGR", re: word("NGR", "u"), instead: "revenu net" },
  { word: "ROAS", re: word("ROAS", "u"), instead: "retour sur dépense pub" },
  { word: "CPL", re: word("CPL", "u"), instead: "coût par membre" },
  { word: "CPA", re: word("CPA", "u"), instead: "coût par inscription" },
  { word: "sub-ID", re: word("sub[-_ ]?ids?"), instead: "identifiant de suivi" },
  { word: "webhook", re: word("webhooks?"), instead: "connexion" },
  { word: "postback", re: word("postbacks?"), instead: "retour du casino" },
  { word: "cohorte", re: word("cohortes?"), instead: "membres dans le temps" },
  { word: "entonnoir", re: word("entonnoirs?"), instead: "parcours" },
  { word: "segment", re: word("segments?"), instead: "groupe de membres" },
  { word: "séquence", re: word("séquences?"), instead: "messages du bot" },
  { word: "automatisation", re: word("automatisations?"), instead: "relance automatique" },
  { word: "envoi groupé", re: word("envois? group[ée]s?"), instead: "écrire à un groupe" },
  { word: "Dating", re: word("dating"), instead: "Rencontres" },
  // Phase 15 (rubrique « Pages ») : l'adresse d'une page et l'identifiant d'un pixel, dits avec les mots du client.
  { word: "slug", re: word("slugs?"), instead: "adresse de la page" },
  { word: "pixel ID", re: word("pixel[-_ ]?ids?"), instead: "identifiant du pixel" },
  { word: "landing page", re: word("landing[- ]pages?"), instead: "page d'atterrissage" },
  // Phase 20 (médias du personnage) : le fichier d'entraînement du générateur de photos, expliqué au survol (`Term`).
  { word: "LoRA", re: word("loras?"), instead: "fichier du personnage" },
];

/** Mots interdits trouvés dans un texte. */
export function jargonIn(text: string): string[] {
  return JARGON.filter((r) => r.re.test(text)).map((r) => r.word);
}

/** Attributs JSX dont la valeur est lue ou entendue (lecteur d'écran). */
const TEXT_ATTRS = new Set([
  "label",
  "description",
  "placeholder",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "alt",
  "help",
  "hint",
  "message",
  "confirmLabel",
  "confirmTitle",
  "cancelLabel",
  "backLabel",
  "guideLabel",
  "emptyLabel",
  "comparison",
  "noun",
  "caption",
  "detailTitle",
  "detailDescription",
  "subtitle",
  "heading",
  "text",
]);

/** Attributs et propriétés techniques : jamais affichés tels quels. */
const SKIP_NAMES = new Set([
  "term",
  "className",
  "wrapperClassName",
  "href",
  "key",
  "id",
  "htmlFor",
  "name",
  "type",
  "src",
  "icon",
  "kind",
  "variant",
  "tone",
  "size",
  "role",
  "method",
  "action",
  "formAction",
  "pattern",
  "autoComplete",
  "inputMode",
  "data-slot",
  "data-testid",
  "rel",
  "target",
]);

/** Propriétés d'objet qui portent un libellé affiché (colonnes, étapes, cartes, `metadata`). */
const TEXT_KEYS = new Set([
  "label",
  "header",
  "title",
  "description",
  "help",
  "hint",
  "placeholder",
  "message",
  "detailTitle",
  "detailDescription",
  "subtitle",
  "heading",
  "noun",
  "short",
  "long",
  "tooltip",
  "summary",
  "empty",
  "emptyLabel",
  "confirm",
  "confirmLabel",
  "cta",
  "ctaLabel",
  "text",
]);

/**
 * Composants dont l'attribut `title` est une infobulle HTML (le terme technique y a sa place) ;
 * pour les autres composants (PageHeader, EmptyState, FormSection, SidePanel…), `title` est un titre affiché.
 */
const TOOLTIP_TITLE_COMPONENTS = new Set([
  "Button",
  "Badge",
  "StatusPill",
  "StatusBadge",
  "ActiveBadge",
  "Link",
  "UniverseDot",
  "NativeSelect",
  "Input",
  "Textarea",
  "Checkbox",
  "TableCell",
  "TableHead",
  "TableRow",
  "ConfirmSubmit",
]);

/** Appels dont les arguments sont techniques (classes CSS, journaux). */
const SKIP_CALLS =
  /^(cn|clsx|cva|buttonVariants|twMerge|require|console\.\w+|logger\.\w+|log\.\w+)$/;

/** Balises dont le contenu est technique (adresse, champ, commande) et n'est pas traduit. */
const CODE_TAGS = new Set(["code", "kbd", "pre", "samp"]);

export type JargonHit = { line: number; words: string[]; text: string };
export type ScanOptions = {
  parenthesizedTermsAllowed?: boolean;
  /** Mots interdits en plus de `JARGON` (rubrique Agents : termes du moteur, voir `AGENTS_JARGON`). */
  extraRules?: readonly JargonRule[];
};

/** Termes du moteur des agents (phase 19), jamais en surface dans la rubrique Agents. */
export const AGENTS_JARGON: JargonRule[] = [
  { word: "BullMQ", re: word("bullmq"), instead: "file" },
  { word: "worker", re: word("workers?"), instead: "service d'arrière-plan" },
  { word: "API", re: word("APIs?", "u"), instead: "connexion" },
  { word: "JSON", re: word("JSON", "u"), instead: "réglage" },
  { word: "prompt", re: word("prompts?"), instead: "consignes" },
];

/** Retire les parenthèses qui ne contiennent qu'un rappel du terme technique (« (FTD) », « (NGR, €) »). */
function withoutParenthesizedTerms(text: string): string {
  return text.replace(/\(([^()]*)\)/g, (m, inner: string) => (jargonIn(inner).length ? "" : m));
}

type Ctx = "text" | "neutral" | "skip";

/** Une phrase : au moins deux mots (lettres séparées par une espace). */
function isProse(s: string): boolean {
  return /\p{L}[\p{L}'’.,:;!?()«»-]*\s+[\p{L}(«]/u.test(s);
}

function attrName(n: ts.JsxAttribute, sf: ts.SourceFile): string {
  return n.name.getText(sf);
}

function propName(
  n: ts.PropertyAssignment | ts.ShorthandPropertyAssignment,
  sf: ts.SourceFile,
): string {
  const name = n.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return name.getText(sf);
}

function tagNameOf(n: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isJsxElement(n)) return n.openingElement.tagName.getText(sf);
  if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) return n.tagName.getText(sf);
  return null;
}

/** Analyse une source TSX/TS et renvoie les morceaux de texte visible qui contiennent du jargon. */
export function scanSource(
  src: string,
  fileName = "file.tsx",
  options: ScanOptions = {},
): JargonHit[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, kind);
  const hits: JargonHit[] = [];

  const check = (node: ts.Node, text: string, ctx: Ctx) => {
    if (ctx === "skip") return;
    if (ctx === "neutral" && !isProse(text)) return;
    const shown = options.parenthesizedTermsAllowed ? withoutParenthesizedTerms(text) : text;
    const words = [
      ...jargonIn(shown),
      ...(options.extraRules ?? []).filter((r) => r.re.test(shown)).map((r) => r.word),
    ];
    if (words.length === 0) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    hits.push({ line, words, text: text.replace(/\s+/g, " ").trim().slice(0, 120) });
  };

  const visit = (node: ts.Node, ctx: Ctx): void => {
    if (ctx === "skip") return;
    // Types, imports et déclarations de module : jamais affichés.
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return;
    if (ts.isCaseClause(node)) {
      node.statements.forEach((s) => visit(s, ctx));
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      visit(node.expression, ctx);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.EqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsToken ||
        op === ts.SyntaxKind.InKeyword ||
        op === ts.SyntaxKind.InstanceOfKeyword
      )
        return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (SKIP_CALLS.test(callee)) return;
      // `x.includes("FTD")`, `searchParams.get("segment")`, `startsWith("postback")` : la clé (1er argument) est
      // technique ; la valeur (`params.set("error", "…")`, `replace(/…/, "…")`) est lue comme le reste.
      if (
        /\.(includes|startsWith|endsWith|get|has|set|delete|getAll|indexOf|match|test|replace|split)$/.test(
          callee,
        )
      ) {
        visit(node.expression, ctx);
        node.arguments.forEach((a, i) =>
          i === 0 && ts.isStringLiteralLike(a) ? undefined : visit(a, "neutral"),
        );
        return;
      }
      visit(node.expression, "neutral");
      node.arguments.forEach((a) => visit(a, "neutral"));
      return;
    }
    if (ts.isJsxText(node)) {
      check(node, node.text, "text");
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      check(node, node.text, ctx);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      // Chaque morceau de texte est lu seul : `/settings/postbacks?${q}` n'est pas une phrase.
      for (const part of [node.head, ...node.templateSpans.map((s) => s.literal)])
        if (part.text.trim()) check(part, part.text, ctx);
      node.templateSpans.forEach((s) => visit(s.expression, ctx === "text" ? "text" : "neutral"));
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = tagNameOf(node, sf) ?? "";
      if (CODE_TAGS.has(tag)) return;
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tooltipTitle =
        /^[a-z]/.test(tag) || TOOLTIP_TITLE_COMPONENTS.has(tag) || tag.includes(".");
      for (const attr of opening.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attr)) {
          visit(attr.expression, "neutral");
          continue;
        }
        const name = attrName(attr, sf);
        if (!attr.initializer) continue;
        let attrCtx: Ctx = "neutral";
        if (SKIP_NAMES.has(name) || name.startsWith("on")) attrCtx = "skip";
        else if (name === "title") attrCtx = tooltipTitle ? "skip" : "text";
        else if (TEXT_ATTRS.has(name) || name.endsWith("Label") || name.endsWith("Title"))
          attrCtx = "text";
        visit(attr.initializer, attrCtx);
      }
      if (ts.isJsxElement(node)) node.children.forEach((c) => visit(c, "text"));
      return;
    }
    if (ts.isJsxExpression(node)) {
      if (node.expression) visit(node.expression, ctx);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      visit(node.condition, "neutral");
      visit(node.whenTrue, ctx);
      visit(node.whenFalse, ctx);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propName(node, sf);
      let propCtx: Ctx = "neutral";
      if (SKIP_NAMES.has(name)) propCtx = "skip";
      else if (TEXT_KEYS.has(name) || /(Label|Title|Text|Description)$/.test(name))
        propCtx = "text";
      visit(node.initializer, propCtx);
      return;
    }
    if (ts.isJsxFragment(node)) {
      node.children.forEach((c) => visit(c, "text"));
      return;
    }
    // Les autres nœuds transmettent « texte » (parenthèses, `&&`, `??`, tableaux de libellés) ou « neutre ».
    const pass: Ctx =
      ctx === "text" &&
      (ts.isParenthesizedExpression(node) ||
        ts.isBinaryExpression(node) ||
        ts.isArrayLiteralExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node))
        ? "text"
        : "neutral";
    ts.forEachChild(node, (c) => visit(c, pass));
  };

  visit(sf, "neutral");
  return hits;
}
