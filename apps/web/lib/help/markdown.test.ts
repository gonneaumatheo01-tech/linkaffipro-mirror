import { describe, expect, it } from "vitest";
import { escapeHtml, extractHeadings, renderInline, renderMarkdown, slugify } from "./markdown";

describe("slugify", () => {
  it("retire les accents et la ponctuation", () => {
    expect(slugify("Les 10 premières minutes")).toBe("les-10-premieres-minutes");
    expect(slugify("Que faire si… le bot ne répond pas ?")).toBe("que-faire-si-le-bot-ne-repond-pas");
    expect(slugify("Réglages → Alertes")).toBe("reglages-alertes");
  });
});

describe("renderInline", () => {
  it("échappe le HTML brut", () => {
    expect(renderInline("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml("a & b \"c\"")).toBe("a &amp; b &quot;c&quot;");
  });
  it("gère gras, italique et code", () => {
    expect(renderInline("du **gras** et de l'*italique* et `du code <b>`")).toBe("du <strong>gras</strong> et de l&#39;<em>italique</em> et <code>du code &lt;b&gt;</code>");
    expect(renderInline("identifiant_de_suivi reste intact")).toBe("identifiant_de_suivi reste intact");
  });
  it("rend les liens sûrs seulement", () => {
    expect(renderInline("[site](https://app.linkaffipro.com)")).toBe('<a href="https://app.linkaffipro.com" target="_blank" rel="noopener noreferrer">site</a>');
    expect(renderInline("[ancre](#les-10-premieres-minutes)")).toBe('<a href="#les-10-premieres-minutes">ancre</a>');
    expect(renderInline("[x](javascript:alert)")).toBe('<a href="#">x</a>');
  });
});

describe("renderMarkdown", () => {
  it("rend titres avec ancres, paragraphes et listes", () => {
    const html = renderMarkdown("# Guide\n\nUn paragraphe\nsur deux lignes.\n\n## Étape\n\n- un\n- deux\n  - sous\n\n1. premier\n2. second\n");
    expect(html).toContain('<h1 id="guide">Guide</h1>');
    expect(html).toContain("<p>Un paragraphe sur deux lignes.</p>");
    expect(html).toContain('<h2 id="etape">Étape</h2>');
    expect(html).toContain("<ul><li>un</li><li>deux<ul><li>sous</li></ul></li></ul>");
    expect(html).toContain("<ol><li>premier</li><li>second</li></ol>");
  });
  it("rend les tableaux simples", () => {
    const html = renderMarkdown("| Alerte | Réaction |\n|---|---|\n| Worker arrêté | Vérifier |\n");
    expect(html).toBe("<table><thead><tr><th>Alerte</th><th>Réaction</th></tr></thead><tbody><tr><td>Worker arrêté</td><td>Vérifier</td></tr></tbody></table>");
  });
  it("dédoublonne les ancres de titres identiques", () => {
    const md = "## À quoi ça sert\n\n## À quoi ça sert\n";
    expect(extractHeadings(md).map((h) => h.id)).toEqual(["a-quoi-ca-sert", "a-quoi-ca-sert-2"]);
    expect(renderMarkdown(md)).toContain('id="a-quoi-ca-sert-2"');
  });
  it("n'exécute jamais de HTML brut dans les blocs", () => {
    const html = renderMarkdown("<img src=x onerror=alert(1)>\n\n> citation <b>x</b>\n\n```\n<pre>\n```\n");
    expect(html).not.toContain("<img");
    expect(html).toContain("<blockquote><p>citation &lt;b&gt;x&lt;/b&gt;</p></blockquote>");
    expect(html).toContain("<pre><code>&lt;pre&gt;</code></pre>");
  });
});
