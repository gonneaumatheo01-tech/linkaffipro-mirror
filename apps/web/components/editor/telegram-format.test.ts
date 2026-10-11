import { describe, expect, it } from "vitest";
import { validateTelegramHtml } from "@linkaffipro/core";
import {
  formatsOfAncestors,
  markPlaceholders,
  htmlToTelegram,
  plainPasteToTelegram,
  plainTextToTelegram,
  safeHref,
  telegramToEditorHtml,
  visibleText,
} from "./telegram-format";

/** Aller-retour complet : HTML Telegram → éditeur → HTML Telegram. */
const roundTrip = (tg: string) => htmlToTelegram(telegramToEditorHtml(tg), "editor");

/** Chaque sortie doit passer la validation Telegram existante (celle des actions serveur). */
function expectValid(tg: string) {
  const r = validateTelegramHtml(tg);
  expect(r, tg).toMatchObject({ ok: true });
}

describe("HTML Telegram → éditeur", () => {
  it("mise en forme reprise, sauts de ligne en <br>, texte masqué en span", () => {
    expect(
      telegramToEditorHtml(
        'Salut <b>gras</b> <i>ital</i> <u>sou</u> <s>bar</s>\n<tg-spoiler>caché</tg-spoiler> <a href="https://x.fr">lien</a>',
      ),
    ).toBe(
      'Salut <b>gras</b> <i>ital</i> <u>sou</u> <s>bar</s><br><sub>caché</sub> <a href="https://x.fr">lien</a>',
    );
  });
  it("équivalents Telegram normalisés ; texte masqué affiché en <sub> (commande « subscript » du navigateur)", () => {
    expect(
      telegramToEditorHtml(
        '<strong>a</strong><em>b</em><ins>c</ins><del>d</del><strike>e</strike><span class="tg-spoiler">f</span>',
      ),
    ).toBe("<b>a</b><i>b</i><u>c</u><s>de</s><sub>f</sub>");
  });
  it("ajoute un <br> de mise en page quand le texte finit par un saut de ligne", () => {
    expect(telegramToEditorHtml("a\n")).toBe("a<br><br>");
    expect(telegramToEditorHtml("a")).toBe("a");
    expect(telegramToEditorHtml("<b>a\n</b>")).toBe("<b>a<br></b><br>");
    expect(telegramToEditorHtml("a\n", { fragment: true })).toBe("a<br>");
  });
  it("échappe le texte : aucune balise ne peut passer", () => {
    expect(telegramToEditorHtml("1 &lt; 2 &amp; 3 &gt; 0")).toBe("1 &lt; 2 &amp; 3 &gt; 0");
    expect(telegramToEditorHtml('<img src=x onerror="alert(1)"><script>alert(1)</script>ok')).toBe(
      "ok",
    );
  });
  it("liens : http(s) seulement, attributs échappés", () => {
    expect(telegramToEditorHtml('<a href="javascript:alert(1)">x</a>')).toBe("x");
    expect(telegramToEditorHtml('<a href="https://x.fr/?a=1&amp;b=&quot;2&quot;">x</a>')).toBe(
      '<a href="https://x.fr/?a=1&amp;b=&quot;2&quot;">x</a>',
    );
  });
  it("lit un ancien texte mal formé sans planter (balise non fermée, < isolé)", () => {
    expect(telegramToEditorHtml("a < b <b>gras")).toBe("a &lt; b <b>gras</b>");
  });
});

describe("éditeur → HTML Telegram", () => {
  it("mise en forme d'un navigateur (b, strong, i, em, u, strike, styles) vers les balises Telegram", () => {
    expect(
      htmlToTelegram(
        '<b>a</b><strong>b</strong><i>c</i><em>d</em><u>e</u><strike>f</strike><span style="font-weight: 700;">g</span><span style="font-style: italic">h</span><span style="text-decoration-line: line-through">i</span><span style="text-decoration: underline">j</span>',
      ),
    ).toBe("<b>ab</b><i>cd</i><u>e</u><s>f</s><b>g</b><i>h</i><s>i</s><u>j</u>");
  });
  it("garde ouvertes les balises communes (pas de </b><b> inutiles)", () => {
    expect(htmlToTelegram("<b>gras <i>et italique</i> suite</b>")).toBe(
      "<b>gras <i>et italique</i> suite</b>",
    );
    expect(htmlToTelegram('<b>x <a href="https://a.fr">lien</a></b>')).toBe(
      '<b>x <a href="https://a.fr">lien</a></b>',
    );
  });
  it("un style « normal » annule le gras (Google Docs enveloppe tout dans <b style=font-weight:normal>)", () => {
    expect(
      htmlToTelegram(
        '<b style="font-weight:normal;" id="docs-internal-guid-1">a <span style="font-weight:700">b</span></b>',
      ),
    ).toBe("a <b>b</b>");
  });
  it("Chrome (texte en pre-wrap) : sauts de ligne en caractères, saut final de mise en page retiré", () => {
    expect(htmlToTelegram("A\n\nB\n\n")).toBe("A\n\nB\n");
    expect(htmlToTelegram("A\n\nB\nC")).toBe("A\n\nB\nC");
    expect(htmlToTelegram("A<b>\n</b>")).toBe("A");
    expect(htmlToTelegram("\n")).toBe("");
    expect(htmlToTelegram("<div>a</div><div>\n</div><div>b</div>")).toBe("a\n\nb");
    expect(htmlToTelegram("A\n", "telegram")).toBe("A\n");
  });
  it("sauts de ligne : <br> en \\n, <br> final de mise en page retiré", () => {
    expect(htmlToTelegram("a<br>b")).toBe("a\nb");
    expect(htmlToTelegram("a<br><br>")).toBe("a\n");
    expect(htmlToTelegram("a<br>")).toBe("a");
    expect(htmlToTelegram("<br>")).toBe("");
    expect(htmlToTelegram("a<br><br><br>b")).toBe("a\n\n\nb");
  });
  it("blocs d'un navigateur (div, p) : une ligne chacun, ligne vide gardée", () => {
    expect(htmlToTelegram("a<div>b</div><div><br></div><div>c</div>")).toBe("a\nb\n\nc");
    expect(htmlToTelegram("<div>a<br></div><div>b</div>")).toBe("a\nb");
    expect(htmlToTelegram("<p>a</p><p>b</p>")).toBe("a\nb");
  });
  it("entités : texte décodé puis réécrit (seuls & < > sont échappés)", () => {
    expect(htmlToTelegram("1 &lt; 2 &amp;&amp; &quot;x&quot; &#39;y&#39; &eacute;")).toBe(
      "1 &lt; 2 &amp;&amp; \"x\" 'y' é",
    );
  });
  it("espaces : conservés tels quels dans l'éditeur (espace insécable compris)", () => {
    expect(htmlToTelegram("a  b&nbsp;!  ")).toBe("a  b !  ");
  });
  it("liens : http(s) seulement, adresse échappée, lien vide retiré", () => {
    expect(htmlToTelegram('<a href="https://x.fr/?a=1&amp;b=2">x</a>')).toBe(
      '<a href="https://x.fr/?a=1&amp;b=2">x</a>',
    );
    expect(htmlToTelegram('<a href="tg://user?id=1">x</a> <a href="/relatif">y</a>')).toBe("x y");
    expect(htmlToTelegram('<a href="https://x.fr"></a>')).toBe("");
  });
  it("texte masqué : <sub> de l'éditeur, tg-spoiler, span.tg-spoiler et data-tg-spoiler", () => {
    expect(
      htmlToTelegram('<span class="tg-spoiler">a</span><tg-spoiler>b</tg-spoiler><sub>c</sub>'),
    ).toBe("<tg-spoiler>abc</tg-spoiler>");
    expect(htmlToTelegram('<span data-tg-spoiler="">c</span>')).toBe("<tg-spoiler>c</tg-spoiler>");
    expect(htmlToTelegram('<span style="vertical-align: sub;">d</span>')).toBe(
      "<tg-spoiler>d</tg-spoiler>",
    );
  });
  it("un vrai indice collé depuis le web n'est pas un texte masqué", () => {
    expect(htmlToTelegram("H<sub>2</sub>O", "paste")).toBe("H2O");
  });
  it("règles d'imbrication de Telegram : rien dans un code ni un bloc de code", () => {
    expect(htmlToTelegram("<b>a<code>b</code></b>")).toBe("<b>a</b><code>b</code>");
    expect(htmlToTelegram('<a href="https://x.fr">a<code>b</code></a>')).toBe(
      '<a href="https://x.fr">a</a><code>b</code>',
    );
    expect(htmlToTelegram("<pre><b>x</b>\ny</pre>")).toBe("<pre>x\ny</pre>");
  });
  it("citations : reprises sans saut de ligne ajouté ; deux citations voisines restent distinctes", () => {
    expect(htmlToTelegram("a\n<blockquote>q <b>g</b></blockquote>\nb")).toBe(
      "a\n<blockquote>q <b>g</b></blockquote>\nb",
    );
    expect(htmlToTelegram("<blockquote>a</blockquote><blockquote>b</blockquote>")).toBe(
      "<blockquote>a</blockquote><blockquote>b</blockquote>",
    );
    expect(htmlToTelegram("<blockquote expandable>a</blockquote>")).toBe(
      "<blockquote expandable>a</blockquote>",
    );
  });
  it("balises et attributs interdits retirés, contenu gardé", () => {
    expect(
      htmlToTelegram(
        '<span class="x" onclick="evil()" style="color:red">a</span><font color=red>b</font><mark>c</mark><sup>d</sup>',
      ),
    ).toBe("abcd");
    expect(
      htmlToTelegram("<script>alert(1)</script><style>b{}</style><iframe src=x></iframe>ok"),
    ).toBe("ok");
  });
  it("tg-emoji : l'émoji de secours est gardé", () => {
    expect(htmlToTelegram('<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>')).toBe("👍");
  });
  it("sortie toujours acceptée par validateTelegramHtml", () => {
    for (const html of [
      "<b><i>x</b></i> y",
      "a < b > c & d",
      '<a href="https://x.fr?a=<1>">x</a>',
      "<div><b>a<div>b</div>c</b></div><ul><li>x</li></ul>",
      '<span class="tg-spoiler"><a href="https://x.fr"><b>ok</b></a></span>',
      "<pre><code>x</code></pre><blockquote><code>c</code></blockquote>",
    ])
      expectValid(htmlToTelegram(html, "paste"));
  });
});

describe("aller-retour HTML Telegram → éditeur → HTML Telegram", () => {
  it.each([
    "",
    "Bonjour",
    "Bonjour {prenom},\n\n<b>{offre}</b> propose un bonus.\n👉 Le lien est dans le bouton.",
    "<b>gras</b> <i>ital</i> <u>sou</u> <s>bar</s> <tg-spoiler>caché</tg-spoiler>",
    '<a href="https://go.goolink.eu/abc?x=1&amp;y=2">ici</a>',
    "<b>a <i>b</i> c</b>",
    "ligne 1\nligne 2\n\n\nligne 5",
    "fin avec saut\n",
    "fin avec deux sauts\n\n",
    "<b>gras jusqu'au saut\n</b>",
    "1 &lt; 2 &amp; 3 &gt; 0",
    "  espaces  au début et à la fin  ",
    "<code>x = 1</code> et <pre>bloc\nde code\n</pre>",
    "a\n<blockquote>citation\nsur deux lignes\n</blockquote>\nb",
    "émojis 🔥🎁💰 et insécable !",
  ])("%j", (tg) => {
    expect(roundTrip(tg)).toBe(tg);
    expectValid(roundTrip(tg));
  });
  it("normalise sans changer le sens (équivalents, attributs, ordre des balises)", () => {
    expect(roundTrip('<strong>a</strong> <span class="tg-spoiler">b</span>')).toBe(
      "<b>a</b> <tg-spoiler>b</tg-spoiler>",
    );
    expect(roundTrip("a &quot;b&quot; &#39;c&#39;")).toBe("a \"b\" 'c'");
  });
});

describe("collage", () => {
  it("replie les espaces et sauts de ligne du code source comme un navigateur", () => {
    expect(htmlToTelegram("<p>\n  Bonjour   <b>toi</b>\n</p>\n<p>  Suite </p>", "paste")).toBe(
      "Bonjour <b>toi</b>\nSuite",
    );
  });
  it("Google Docs : gras réel gardé, faux gras ignoré, lignes vides entre paragraphes", () => {
    const docs =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-x"><p dir="ltr" style="line-height:1.38"><span style="font-size:11pt;font-weight:700;white-space:pre-wrap;">Bonus</span><span style="font-size:11pt;font-weight:400;white-space:pre-wrap;"> du jour</span></p><br><p dir="ltr"><span style="font-style:italic;white-space:pre-wrap;">Jouez prudemment.</span></p></b>';
    expect(htmlToTelegram(docs, "paste")).toBe("<b>Bonus</b> du jour\n\n<i>Jouez prudemment.</i>");
  });
  it("Word : commentaires conditionnels, <o:p> et styles mso ignorés", () => {
    const word =
      "<html><head><style>p.MsoNormal{margin:0}</style></head><body><!--StartFragment--><p class=MsoNormal><b>Titre<o:p></o:p></b></p><p class=MsoNormal><span style='mso-spacerun:yes'>&nbsp;</span>Texte<o:p></o:p></p><!--EndFragment--></body></html>";
    expect(htmlToTelegram(word, "paste")).toBe("<b>Titre</b>\n Texte");
  });
  it("listes en puces et numérotées, titres en gras, tableaux sur une ligne", () => {
    expect(
      htmlToTelegram(
        "<h2>Offre</h2><ul><li>Un</li><li><p>Deux</p></li></ul><ol><li>A</li><li>B</li></ol><table><tr><td>x</td><td>y</td></tr></table>",
        "paste",
      ),
    ).toBe("<b>Offre</b>\n• Un\n• Deux\n1. A\n2. B\nx y");
  });
  it("lien souligné par son style : pas de soulignement en plus ; lien relatif retiré", () => {
    expect(
      htmlToTelegram(
        '<a href="https://x.fr"><span style="text-decoration:underline;color:#15c">x</span></a> <a href="/page">y</a>',
        "paste",
      ),
    ).toBe('<a href="https://x.fr">x</a> y');
  });
  it("émoji en image (Gmail) : son texte est gardé ; autres images retirées", () => {
    expect(
      htmlToTelegram('a<img alt="🔥" src="x.png">b<img alt="logo" src="y.png">c', "paste"),
    ).toBe("a🔥bc");
  });
  it("éléments cachés et contenus à ignorer", () => {
    expect(
      htmlToTelegram(
        '<div hidden>a</div><span style="display:none">b</span><button>Copier</button><select><option>x</option></select>c',
        "paste",
      ),
    ).toBe("c");
  });
  it("<pre> collé : espaces et sauts de ligne gardés", () => {
    expect(htmlToTelegram("<pre>  a\n    b</pre>", "paste")).toBe("<pre>  a\n    b</pre>");
  });
});

describe("texte brut", () => {
  it("échappe les entités et garde les sauts de ligne", () => {
    expect(plainTextToTelegram("a < b & c\r\nd")).toBe("a &lt; b &amp; c\nd");
    expect(htmlToTelegram(telegramToEditorHtml(plainTextToTelegram("<b>pas une balise</b>")))).toBe(
      "&lt;b&gt;pas une balise&lt;/b&gt;",
    );
  });
});

describe("collage de texte brut", () => {
  it("HTML Telegram valide collé en texte : repris mis en forme (pas de balises visibles)", () => {
    expect(plainPasteToTelegram('Salut <b>toi</b>\r\n<a href="https://x.fr">ici</a>')).toBe(
      'Salut <b>toi</b>\n<a href="https://x.fr">ici</a>',
    );
  });
  it("texte ordinaire ou HTML invalide : collé comme texte, entités échappées", () => {
    expect(plainPasteToTelegram("3 < 4 & 5 > 2")).toBe("3 &lt; 4 &amp; 5 &gt; 2");
    expect(plainPasteToTelegram("<b>non fermé")).toBe("&lt;b&gt;non fermé");
    expect(plainPasteToTelegram("<div>pas Telegram</div>")).toBe(
      "&lt;div&gt;pas Telegram&lt;/div&gt;",
    );
  });
});

describe("outils", () => {
  it("safeHref : http(s) sans espace seulement", () => {
    expect(safeHref(" https://x.fr/a ")).toBe("https://x.fr/a");
    expect(safeHref("http://x.fr")).toBe("http://x.fr");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://x.fr/a b")).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
  it("visibleText : texte sans balises, entités décodées", () => {
    expect(visibleText("<b>a</b> &amp; <i>b</i>\nc")).toBe("a & b\nc");
  });
  it("formatsOfAncestors : mise en forme au curseur", () => {
    expect(
      formatsOfAncestors([
        { tag: "I", attrs: {} },
        { tag: "A", attrs: { href: "https://x.fr" } },
        { tag: "SUB", attrs: {} },
        { tag: "B", attrs: {} },
      ]),
    ).toEqual({
      bold: true,
      italic: true,
      underline: false,
      strike: false,
      spoiler: true,
      code: false,
      link: "https://x.fr",
    });
  });
});

describe("markPlaceholders (lecture seule)", () => {
  it("met en pastille les repères connus, pas les autres ni ceux des adresses", () => {
    expect(
      markPlaceholders(
        'Salut {prenom} <b>{offre}</b> {xyz} <a href="https://x.fr/{prenom}">ici</a>',
        ["prenom", "offre"],
      ),
    ).toBe(
      'Salut <span class="lap-ph">{prenom}</span> <b><span class="lap-ph">{offre}</span></b> {xyz} <a href="https://x.fr/{prenom}">ici</a>',
    );
  });
});
