import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { customEmojiChipHtml } from "./custom-emoji-chip";
import { FormattedText } from "./formatted-text";
import { RichTextEditor, type RichTextEditorProps } from "./rich-text-editor";

function render(props: Partial<RichTextEditorProps> = {}): string {
  return renderToStaticMarkup(
    createElement(RichTextEditor, {
      id: "msg",
      label: "Texte du message",
      value: "",
      onChange: () => undefined,
      ...props,
    }),
  );
}

/** Contenu de la zone éditable (rendu serveur). */
function textbox(html: string): string {
  const m = /<div[^>]*role="textbox"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  return m?.[1] ?? "";
}

describe("RichTextEditor (rendu serveur)", () => {
  it("zone de saisie accessible : role textbox multiligne, nom, aide et compteur reliés", () => {
    const html = render();
    expect(html).toMatch(/<div[^>]*id="msg"[^>]*role="textbox"/);
    expect(html).toContain('aria-multiline="true"');
    expect(html).toContain('aria-label="Texte du message"');
    expect(html).toContain('contentEditable="true"');
    expect(html).toContain('aria-describedby="msg-editor-help msg-counter"');
    expect(html).toContain('aria-placeholder="Votre message…"');
  });

  it("le texte s'affiche mis en forme, sans balise visible", () => {
    const html = render({
      value: 'Salut <b>gras</b> et <a href="https://x.fr">lien</a>\n<tg-spoiler>caché</tg-spoiler>',
    });
    const content = textbox(html);
    expect(content).toBe(
      'Salut <b>gras</b> et <a href="https://x.fr">lien</a><br><sub>caché</sub>',
    );
    expect(content).not.toContain("&lt;");
  });

  it("envoie le HTML Telegram dans le champ caché demandé (`name`), sinon aucun champ", () => {
    const withName = render({ name: "text", value: '<b>a</b> &amp; "b"' });
    expect(withName).toContain(
      '<input type="hidden" name="text" value="&lt;b&gt;a&lt;/b&gt; &amp;amp; &quot;b&quot;"/>',
    );
    expect(render({ value: "x" })).not.toContain('type="hidden"');
  });

  it("barre d'outils : role toolbar nommé, boutons à bascule (aria-pressed), raccourcis annoncés", () => {
    const html = render();
    expect(html).toMatch(/role="toolbar"[^>]*aria-label="Mise en forme : Texte du message"/);
    expect(html).toContain('aria-controls="msg"');
    for (const name of ["Gras", "Italique", "Souligné", "Barré", "Texte masqué"])
      expect(html).toMatch(new RegExp(`aria-label="${name}" aria-pressed="false"`));
    expect(html).toContain('aria-label="Insérer un lien"');
    expect(html).toContain('aria-keyshortcuts="Control+B Meta+B"');
    expect(html).toContain('aria-label="Insérer un émoji"');
  });

  it("emplacement de l'assistant IA dans la barre d'outils", () => {
    const html = render({ ai: createElement("button", { type: "button" }, "Améliorer avec l'IA") });
    const toolbar = /role="toolbar"[\s\S]*?<\/div><div class="relative">/.exec(html)?.[0] ?? "";
    expect(toolbar).toContain("Améliorer avec l&#x27;IA");
  });

  it("compteur : 4 096 sans média, 1 024 avec, erreur au-delà de 4 096", () => {
    expect(render({ value: "<b>abc</b>" })).toMatch(/>3 \/ 4[\s  ]096</);
    expect(render({ value: "abc", hasMedia: true })).toMatch(/>3 \/ 1[\s  ]024</);
    const over = render({ value: "x".repeat(4100) });
    expect(over).toContain("Texte trop long de 4 caractères");
    expect(over).toContain('aria-invalid="true"');
  });

  it("repères : boutons d'insertion, et avertissement pour un repère qui ne sera pas remplacé", () => {
    const html = render({
      value: "Salut {prenom}, {offre} t'attend",
      placeholders: [{ key: "prenom", label: "Prénom" }],
    });
    expect(html).toMatch(/role="group" aria-label="Insérer un repère"/);
    expect(html).toContain(">Prénom</button>");
    expect(html).toContain("{offre} ne sera pas remplacé ici");
    expect(html).not.toContain("{prenom} ne sera pas");
  });

  it("champ obligatoire : relais de validation du navigateur, vide si le texte est vide", () => {
    const html = render({ required: true });
    const relay = /<input tabindex="-1" aria-hidden="true"[^>]*>/.exec(html)?.[0] ?? "";
    expect(relay).toContain('aria-label="Texte du message"');
    expect(relay).toContain('required=""');
    expect(relay).toContain('value=""');
    expect(html).toContain('aria-required="true"');
    expect(render({ required: true, value: "x" })).toMatch(/<input tabindex="-1"[^>]*value="ok"/);
  });

  it("champ en erreur signalé par le parent", () => {
    expect(render({ invalid: true })).toContain('aria-invalid="true"');
  });

  it("emoji animé : bouton dans la barre d'outils (fenêtre), sauf si le formulaire le refuse", () => {
    const html = render();
    const toolbar = /role="toolbar"[\s\S]*?<\/div><div class="relative">/.exec(html)?.[0] ?? "";
    expect(toolbar).toMatch(
      /aria-label="Insérer un emoji animé"[^>]*aria-haspopup="dialog"|aria-haspopup="dialog"[^>]*aria-label="Insérer un emoji animé"/,
    );
    expect(render({ customEmoji: false })).not.toContain("Insérer un emoji animé");
  });

  it("emoji animé : le bouton porte son nom visible « Emoji animé » (celui du guide et des écrans), pas seulement une icône", () => {
    const html = render();
    const trigger =
      /<button[^>]*aria-label="Insérer un emoji animé"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ??
      "";
    expect(trigger.replace(/<[^>]+>/g, "").trim()).toBe("Emoji animé");
  });

  it("emoji animé : affiché en image indivisible, compté comme son emoji de remplacement", () => {
    const html = render({
      value: 'Salut <tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>',
      name: "text",
    });
    expect(textbox(html)).toBe(`Salut ${customEmojiChipHtml("5368324170671202286", "👍")}`);
    expect(html).toMatch(new RegExp(`>${"Salut 👍".length} \\/ 4[\\s  ]096<`));
    // La valeur soumise garde la balise telle quelle.
    expect(html).toContain(
      'value="Salut &lt;tg-emoji emoji-id=&quot;5368324170671202286&quot;&gt;👍&lt;/tg-emoji&gt;"',
    );
  });
});

describe("FormattedText", () => {
  it("affiche le HTML Telegram mis en forme, repères en évidence, rien d'autre ne passe", () => {
    const html = renderToStaticMarkup(
      createElement(FormattedText, {
        html: "Salut {prenom} <b>gras</b>\n<script>alert(1)</script><img src=x onerror=alert(1)>",
      }),
    );
    expect(html).toBe(
      '<div data-slot="formatted-text" class="lap-rich text-body text-foreground">Salut <span class="lap-ph">{prenom}</span> <b>gras</b><br></div>',
    );
  });
  it("emoji animé : puce avec son emoji de remplacement (animée dans le navigateur)", () => {
    const html = renderToStaticMarkup(
      createElement(FormattedText, {
        html: 'Top <b><tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji></b>',
      }),
    );
    expect(html).toContain(`Top <b>${customEmojiChipHtml("5368324170671202286", "🔥")}</b>`);
  });
});
