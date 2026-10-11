/**
 * Vérification interactive de l'éditeur de texte (`components/editor`) dans un vrai navigateur, sur le serveur de
 * développement local : saisie, gras, italique, souligné, barré, texte masqué, lien (sur une sélection, au curseur,
 * modification), émoji, retour à la ligne, collage nettoyé (HTML, texte brut, presse-papiers réel), compteur, repères
 * {prenom} (surlignage, insertion en un clic), annulation ⌘Z, barre d'outils au clavier.
 *
 * Écran « Programmer un message » (/messages/new, message de canal : repères surlignés « à compléter ») et étape
 * « Message » d'« Écrire à un groupe » (/members/broadcasts/new : repères insérables, remplacés à l'envoi).
 *
 *   node --env-file-if-exists=.env.local --import tsx apps/web/scripts/editor-check.ts \
 *     --browser firefox --base http://localhost:3137 [--widths 1440,390] [--out /tmp/lap-editor-firefox]
 *
 * Sort en erreur (code 1) si une vérification échoue. Captures de contrôle (png) dans --out (dossier temporaire par
 * défaut, jamais docs/captures). Le navigateur doit être installé : `pnpm --filter web exec playwright install firefox`.
 * Base de démonstration LOCALE seulement (compte de vérification de `pnpm db:demo`) : rien n'est enregistré.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { contextOptions, dismissTour, launchBrowser, login, visit } from "./lib/browser";
import { OptionError, parseCaptureOptions } from "./lib/options";

type Check = { name: string; ok: boolean; detail: string };

const EDITOR = "#post-text";
const VALUE = 'input[type="hidden"][name="text"]';

const HELP = `editor-check [--browser chromium|firefox|webkit] [--base url] [--widths 1440,390] [--out dossier]
  Vérifie l'éditeur de texte dans un vrai navigateur (voir l'en-tête de apps/web/scripts/editor-check.ts).`;

async function value(page: Page): Promise<string> {
  return page.locator(VALUE).inputValue();
}

/** Contenu HTML brut de la zone éditable (pour repérer un <div> ou <p> laissé par le navigateur). */
async function editorHtml(page: Page, sel = EDITOR): Promise<string> {
  return page.locator(sel).evaluate((el) => el.innerHTML);
}

async function clear(page: Page, sel = EDITOR): Promise<void> {
  const ed = page.locator(sel);
  await ed.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  // Le navigateur peut laisser un <br> seul : la valeur doit tout de même être vide.
  await page.waitForTimeout(50);
}

/** Sélectionne la première occurrence de `text` dans l'éditeur (sélection du document, comme à la souris). */
async function select(page: Page, text: string, sel = EDITOR): Promise<void> {
  const found = await page.locator(sel).evaluate((el, needle) => {
    (el as HTMLElement).focus();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n as Text).data.indexOf(needle);
      if (i === -1) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      const s = document.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      return true;
    }
    return false;
  }, text);
  if (!found) throw new Error(`texte « ${text} » introuvable dans l'éditeur`);
  await page.waitForTimeout(60); // « selectionchange » traité (boutons enfoncés, sélection mémorisée)
}

/** Curseur à la fin du texte. */
async function caretAtEnd(page: Page, sel = EDITOR): Promise<void> {
  await page.locator(sel).evaluate((el) => {
    (el as HTMLElement).focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = document.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.waitForTimeout(60);
}

/**
 * Collage réel : le contenu voulu est mis dans le presse-papiers par l'événement « copy » du navigateur (⌘C), puis
 * collé dans l'éditeur (⌘V). Firefox ignore les données d'un événement « paste » construit à la main : seule cette
 * voie fait passer le collage par le navigateur comme pour l'utilisateur.
 */
async function pasteData(page: Page, data: Record<string, string>, sel = EDITOR): Promise<void> {
  await page.locator(sel).focus();
  // Écouteur anonyme et à usage unique (une fonction nommée serait renommée par tsx, inconnue dans la page).
  await page.evaluate((d) => {
    document.addEventListener(
      "copy",
      (e) => {
        for (const [type, v] of Object.entries(d)) e.clipboardData?.setData(type, v);
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      { capture: true, once: true },
    );
  }, data);
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await page.waitForTimeout(120);
}

async function pressed(page: Page, label: string): Promise<string | null> {
  return page
    .getByRole("toolbar")
    .first()
    .getByRole("button", { name: label })
    .getAttribute("aria-pressed");
}

async function toolbarButton(page: Page, label: string) {
  return page.getByRole("toolbar").first().getByRole("button", { name: label, exact: true });
}

async function highlightSize(page: Page, name: string): Promise<number | null> {
  return page.evaluate((n) => {
    const css = (globalThis as { CSS?: { highlights?: Map<string, Set<unknown>> } }).CSS;
    if (!css?.highlights) return null;
    return css.highlights.get(n)?.size ?? 0;
  }, name);
}

async function counterText(page: Page): Promise<string> {
  return (await page.locator("#post-text-counter").innerText()).replace(/\s+/g, " ").trim();
}

function expectEq(actual: string, expected: string): void {
  if (actual !== expected)
    throw new Error(`attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
}
function expectContains(actual: string, part: string): void {
  if (!actual.includes(part))
    throw new Error(`${JSON.stringify(part)} absent de ${JSON.stringify(actual)}`);
}

async function messageChecks(page: Page, out: string, tag: string): Promise<Check[]> {
  const checks: Check[] = [];
  const run = async (name: string, fn: () => Promise<string | void>) => {
    try {
      const detail = (await fn()) ?? "";
      checks.push({ name, ok: true, detail });
    } catch (err) {
      checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  };
  const ed = page.locator(EDITOR);
  await ed.waitFor({ state: "visible", timeout: 30_000 });

  await run("saisie au clavier", async () => {
    await clear(page);
    expectEq(await value(page), "");
    await page.keyboard.type("Bonjour tout le monde");
    expectEq(await value(page), "Bonjour tout le monde");
    expectContains(await counterText(page), "21 / 4 096");
  });

  await run("gras (bouton de la barre)", async () => {
    await select(page, "tout");
    await (await toolbarButton(page, "Gras")).click();
    expectEq(await value(page), "Bonjour <b>tout</b> le monde");
    expectEq((await pressed(page, "Gras")) ?? "", "true");
  });

  await run("⌘Z annule le gras", async () => {
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(60);
    expectEq(await value(page), "Bonjour tout le monde");
  });

  await run("italique (raccourci ⌘I)", async () => {
    // Point de départ connu, même si l'étape précédente a échoué.
    if ((await value(page)) !== "Bonjour tout le monde") {
      await clear(page);
      await page.keyboard.type("Bonjour tout le monde");
    }
    await select(page, "monde");
    await page.keyboard.press("ControlOrMeta+i");
    expectEq(await value(page), "Bonjour tout le <i>monde</i>");
  });

  await run("souligné (raccourci ⌘U)", async () => {
    await select(page, "Bonjour");
    await page.keyboard.press("ControlOrMeta+u");
    expectEq(await value(page), "<u>Bonjour</u> tout le <i>monde</i>");
  });

  await run("barré (raccourci ⌘⇧X)", async () => {
    await select(page, "le");
    await page.keyboard.press("ControlOrMeta+Shift+x");
    expectEq(await value(page), "<u>Bonjour</u> tout <s>le</s> <i>monde</i>");
  });

  await run("texte masqué (bouton)", async () => {
    await select(page, "tout");
    await (await toolbarButton(page, "Texte masqué")).click();
    expectEq(
      await value(page),
      "<u>Bonjour</u> <tg-spoiler>tout</tg-spoiler> <s>le</s> <i>monde</i>",
    );
    expectEq((await pressed(page, "Texte masqué")) ?? "", "true");
    // Retiré par un second appui.
    await select(page, "tout");
    await (await toolbarButton(page, "Texte masqué")).click();
    expectEq(await value(page), "<u>Bonjour</u> tout <s>le</s> <i>monde</i>");
  });

  await run("⌘Z annule les mises en forme une à une, ⌘⇧Z les refait", async () => {
    // Cinq mises en forme depuis le texte saisi (italique, souligné, barré, masqué, masqué retiré).
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ControlOrMeta+z");
      await page.waitForTimeout(60);
      seen.push(await value(page));
    }
    expectEq(seen.at(-1)!, "Bonjour tout le monde");
    if (new Set(seen).size !== seen.length)
      throw new Error(`étapes d'annulation en double : ${JSON.stringify(seen)}`);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await page.waitForTimeout(60);
    expectEq(await value(page), "Bonjour tout le <i>monde</i>");
    return `${seen.length} étapes annulées`;
  });

  await run("lien sur une sélection", async () => {
    await clear(page);
    await page.keyboard.type("Voir le site");
    await select(page, "le site");
    await (await toolbarButton(page, "Insérer un lien")).click();
    const url = page.locator("#post-text-link-url");
    await url.waitFor({ state: "visible" });
    if (!(await url.evaluate((el) => el === document.activeElement)))
      throw new Error("le champ Adresse n'a pas le curseur à l'ouverture");
    await url.fill("exemple.com");
    await page.getByRole("button", { name: "Insérer", exact: true }).click();
    await url.waitFor({ state: "hidden" });
    await page.waitForTimeout(150);
    expectEq(await value(page), 'Voir <a href="https://exemple.com">le site</a>');
  });

  await run("lien au curseur (⌘K, texte et adresse)", async () => {
    await caretAtEnd(page);
    await page.keyboard.type(" puis ");
    await page.keyboard.press("ControlOrMeta+k");
    const text = page.locator("#post-text-link-text");
    await text.waitFor({ state: "visible" });
    await text.fill("l'offre");
    await page.locator("#post-text-link-url").fill("t.me/canal");
    await page.keyboard.press("Enter");
    await text.waitFor({ state: "hidden" });
    await page.waitForTimeout(150);
    expectEq(
      await value(page),
      `Voir <a href="https://exemple.com">le site</a> puis <a href="https://t.me/canal">l'offre</a>`,
    );
    // La recherche globale (⌘K ailleurs) ne s'est pas ouverte en plus.
    if (
      await page
        .getByRole("dialog")
        .isVisible()
        .catch(() => false)
    )
      throw new Error("une boîte de dialogue est restée ouverte");
  });

  await run("modifier un lien (curseur dedans)", async () => {
    await select(page, "site");
    const btn = await toolbarButton(page, "Modifier le lien");
    await btn.click();
    const url = page.locator("#post-text-link-url");
    await url.waitFor({ state: "visible" });
    expectEq(await url.inputValue(), "https://exemple.com");
    await url.fill("https://exemple.org/page");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await url.waitFor({ state: "hidden" });
    await page.waitForTimeout(150);
    expectContains(await value(page), '<a href="https://exemple.org/page">le site</a>');
  });

  await run("émoji (menu de la barre)", async () => {
    await clear(page);
    await page.keyboard.type("Top ");
    await (await toolbarButton(page, "Insérer un émoji")).click();
    await page.getByRole("menuitem", { name: "Insérer 🔥" }).click();
    await page.waitForTimeout(250);
    expectEq(await value(page), "Top 🔥");
    await page.keyboard.type("!");
    expectEq(await value(page), "Top 🔥!");
  });

  await run("retour à la ligne (Entrée, Maj+Entrée, ligne vide)", async () => {
    await clear(page);
    await page.keyboard.type("Ligne 1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Ligne 2");
    expectEq(await value(page), "Ligne 1\nLigne 2");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Ligne 4");
    expectEq(await value(page), "Ligne 1\nLigne 2\n\nLigne 4");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Ligne 5");
    expectEq(await value(page), "Ligne 1\nLigne 2\n\nLigne 4\nLigne 5");
    const html = await editorHtml(page);
    if (/<(div|p)[\s>]/i.test(html)) throw new Error(`paragraphe créé par le navigateur : ${html}`);
  });

  await run("Entrée en fin de texte : le curseur passe vraiment à la ligne", async () => {
    await clear(page);
    await page.keyboard.type("Fin");
    const before = await ed.evaluate((el) => (el as HTMLElement).scrollHeight);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Suite");
    expectEq(await value(page), "Fin\nSuite");
    const lines = await ed.evaluate(
      (el) => (el as HTMLElement).innerText.split("\n").filter(Boolean).length,
    );
    if (lines < 2) throw new Error(`texte affiché sur ${lines} ligne(s)`);
    return `hauteur ${before} px avant`;
  });

  await run("collage HTML nettoyé (styles, script, image)", async () => {
    await clear(page);
    await pasteData(page, {
      "text/html":
        '<meta charset="utf-8"><p style="font-weight:700;color:red">Gras collé</p><p><span style="font-style:italic">italique</span> <span style="color:red;font-size:30px">rouge</span> <a href="javascript:alert(1)">piège</a> <a href="https://exemple.com">vrai</a></p><script>window.__pwned=1</script><img src="x" onerror="window.__pwned=2">',
      "text/plain": "Gras collé\nitalique rouge piège vrai",
    });
    const v = await value(page);
    expectEq(
      v,
      '<b>Gras collé</b>\n<i>italique</i> rouge piège <a href="https://exemple.com">vrai</a>',
    );
    const pwned = await page.evaluate(() => (window as { __pwned?: number }).__pwned ?? null);
    if (pwned !== null) throw new Error("un script collé s'est exécuté");
    const html = await editorHtml(page);
    if (/<(img|script|span style)/i.test(html)) throw new Error(`HTML collé non nettoyé : ${html}`);
  });

  await run("collage de texte brut (caractères spéciaux, lignes)", async () => {
    await clear(page);
    await pasteData(page, { "text/plain": "a < b & c > d\nligne 2" });
    expectEq(await value(page), "a &lt; b &amp; c &gt; d\nligne 2");
  });

  await run("collage par le presse-papiers réel (⌘C puis ⌘V)", async () => {
    await clear(page);
    // Source mise en forme hors de l'éditeur, copiée par le raccourci du navigateur.
    await page.evaluate(() => {
      const src = document.createElement("div");
      src.id = "lap-copy-src";
      src.innerHTML = "<strong>Copié</strong> depuis <em>une page</em>";
      document.body.appendChild(src);
      const r = document.createRange();
      r.selectNodeContents(src);
      const s = document.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.keyboard.press("ControlOrMeta+c");
    await ed.click();
    await page.keyboard.press("ControlOrMeta+v");
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById("lap-copy-src")?.remove());
    expectEq(await value(page), "<b>Copié</b> depuis <i>une page</i>");
  });

  await run("compteur (légende, limite, dépassement)", async () => {
    await clear(page);
    await pasteData(page, { "text/plain": "x".repeat(1030) });
    expectContains(await counterText(page), "1 030 / 4 096");
    await clear(page);
    await pasteData(page, { "text/plain": "y".repeat(4100) });
    expectContains(await counterText(page), "4 100 / 4 096");
    await page.getByText("Texte trop long de 4 caractères").first().waitFor({ timeout: 2_000 });
    const invalid = await ed.getAttribute("aria-invalid");
    expectEq(invalid ?? "", "true");
    await clear(page);
    expectContains(await counterText(page), "0 / 4 096");
  });

  await run("repère {prenom} dans un message de canal : surligné « à compléter »", async () => {
    await clear(page);
    await page.keyboard.type("Salut {prenom} et {inconnu} !");
    await page.waitForTimeout(80);
    const warn = await highlightSize(page, "lap-placeholder-warn");
    if (warn === null) return "API de surlignage absente : repères non surlignés (texte intact)";
    if (warn !== 1) throw new Error(`${warn} repère(s) surligné(s) au lieu de 1`);
    expectEq(await value(page), "Salut {prenom} et {inconnu} !");
    await page.screenshot({ path: path.join(out, `${tag}-messages-new-reperes.png`) });
  });

  await run("barre d'outils au clavier (Maj+Tab, Début, flèches, Fin)", async () => {
    await clear(page);
    const active = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return (el?.getAttribute("aria-label") || el?.textContent || "").trim();
      });
    // Maj+Tab depuis le texte : le dernier bouton utilisé de la barre (une seule tabulation pour toute la barre).
    await page.keyboard.press("Shift+Tab");
    const back = await active();
    if (!back) throw new Error("Maj+Tab ne mène pas à la barre d'outils");
    await page.keyboard.press("Home");
    expectEq(await active(), "Gras");
    await page.keyboard.press("ArrowRight");
    expectEq(await active(), "Italique");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    const wrapped = await active();
    await page.keyboard.press("End");
    expectEq(await active(), wrapped);
    // Tab sort de la barre vers le texte.
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    const inEditor = await page.evaluate(() => document.activeElement?.id ?? "");
    expectEq(inEditor, "post-text");
    return `Maj+Tab → « ${back} », dernier bouton « ${wrapped} »`;
  });

  // Texte final pour la capture.
  await clear(page);
  await page.keyboard.type("Ce soir : ");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("tournoi spécial");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Inscriptions jusqu'à 20 h.");
  await page.screenshot({ path: path.join(out, `${tag}-messages-new.png`), fullPage: false });
  checks.push({
    name: "frappe en gras puis normal (⌘B sans sélection)",
    ok: (await value(page)) === "Ce soir : <b>tournoi spécial</b>\nInscriptions jusqu'à 20 h.",
    detail: JSON.stringify(await value(page)),
  });
  return checks;
}

/** Écrire à un groupe : passe à l'étape « Message » et vérifie l'insertion des repères. */
async function broadcastChecks(page: Page, out: string, tag: string): Promise<Check[]> {
  const checks: Check[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      if (
        await page
          .getByRole("group", { name: "Insérer un repère" })
          .first()
          .isVisible()
          .catch(() => false)
      )
        break;
      const next = page.getByRole("button", { name: /^Continuer/ }).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await page.waitForTimeout(400);
    }
    const chips = page.getByRole("group", { name: "Insérer un repère" }).first();
    await chips.waitFor({ state: "visible", timeout: 10_000 });
    const editor = page.locator('[data-slot="rich-text-editor"]').first();
    const id = await editor.getAttribute("id");
    const sel = `#${id}`;
    await clear(page, sel);
    await page.keyboard.type("Salut ");
    await chips.getByRole("button", { name: "Prénom" }).click();
    await page.keyboard.type(" !");
    await page.waitForTimeout(80);
    const text = await editor.evaluate((el) => (el as HTMLElement).innerText.trim());
    const ok = await highlightSize(page, "lap-placeholder");
    const fine = text === "Salut {prenom} !" && (ok === null || ok === 1);
    checks.push({
      name: "repère inséré en un clic (Écrire à un groupe) et mis en évidence",
      ok: fine,
      detail: `texte ${JSON.stringify(text)}, surlignage ${ok === null ? "API absente" : ok}`,
    });
    await editor.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `${tag}-broadcast-reperes.png`) });
  } catch (err) {
    checks.push({
      name: "repère inséré en un clic (Écrire à un groupe) et mis en évidence",
      ok: false,
      detail: err instanceof Error ? err.message.split("\n")[0]! : String(err),
    });
  }
  return checks;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const opts = parseCaptureOptions(argv, process.env);
  const out = argv.some((a) => a === "--out" || a.startsWith("--out="))
    ? path.resolve(opts.out)
    : path.join(tmpdir(), `lap-editor-${opts.browser}`);
  mkdirSync(out, { recursive: true });
  const browser: Browser = await launchBrowser(opts.browser);
  let failed = 0;
  try {
    for (const width of opts.widths) {
      const context = await browser.newContext(contextOptions(width));
      try {
        await login(context, opts);
        const page = await context.newPage();
        const tag = `${opts.browser}-${width}`;
        const v = await visit(page, `${opts.base}/messages/new`, opts.timeoutMs);
        if (v.loadError || (v.httpStatus ?? 200) >= 400)
          throw new Error(`/messages/new : ${v.loadError ?? `statut ${v.httpStatus}`}`);
        await dismissTour(page, 1_500);
        const userAgent = await page.evaluate(() => navigator.userAgent);
        console.log(`\n${opts.browser} ${width} px — ${userAgent}`);
        const checks = await messageChecks(page, out, tag);
        const b = await visit(page, `${opts.base}/members/broadcasts/new`, opts.timeoutMs);
        if (!b.loadError) {
          await dismissTour(page, 500);
          checks.push(...(await broadcastChecks(page, out, tag)));
        } else checks.push({ name: "Écrire à un groupe", ok: false, detail: b.loadError });
        const errors = [...v.errors, ...b.errors].filter(
          (e) => !/Download the React DevTools/.test(e),
        );
        if (errors.length)
          checks.push({ name: "aucune erreur JavaScript", ok: false, detail: errors.join(" | ") });
        for (const c of checks) {
          console.log(`  ${c.ok ? "OK " : "ÉCHEC"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
          if (!c.ok) failed++;
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(
    `\n${failed === 0 ? "Tout est bon" : `${failed} vérification(s) en échec`} — captures dans ${out}`,
  );
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof OptionError ? err.message : err);
    process.exit(err instanceof OptionError ? 2 : 1);
  },
);
