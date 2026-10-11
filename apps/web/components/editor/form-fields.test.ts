import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Garde : chaque formulaire qui utilise l'éditeur envoie toujours le même champ qu'avant (HTML Telegram), et le texte
// s'affiche mis en forme (plus de zone de texte avec des balises visibles).
vi.mock("@/app/(admin)/messages/categories/inline-actions", () => ({
  createCategoryInlineAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { PostForm, type PostFormValues } from "@/components/messages/post-form";
import { BroadcastWizard } from "@/components/broadcasts/broadcast-wizard";
import { MessageTextEditor } from "@/components/broadcasts/message-editor";
import { BotTextEditor } from "@/components/channels/bot-text-editor";
import { MessageField } from "@/components/automations/message-field";

const TEXT = '<b>Bonjour</b> &amp; <a href="https://go.goolink.eu/x">ici</a>';
const HIDDEN_TEXT =
  'value="&lt;b&gt;Bonjour&lt;/b&gt; &amp;amp; &lt;a href=&quot;https://go.goolink.eu/x&quot;&gt;ici&lt;/a&gt;"';

/** Champs cachés d'un rendu : nom → valeur (dans l'ordre). */
function hiddenFields(html: string): Array<[string, string]> {
  return [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [
    m[1]!,
    m[2]!,
  ]);
}

/** Contenu d'une zone éditable (par son id). */
function textbox(html: string, id: string): string | null {
  const m = new RegExp(`<div id="${id}" role="textbox"[^>]*>([\\s\\S]*?)</div>`).exec(html);
  return m ? m[1]! : null;
}

const postValues: PostFormValues = {
  channelIds: ["c1"],
  scheduledAt: "",
  categoryId: "",
  language: "fr",
  text: TEXT,
  media: [],
  buttons: [],
  pinAfterSend: false,
  unpinPrevious: false,
  deleteAfterMinutes: "",
  disableNotification: false,
  protectContent: false,
  disableLinkPreview: false,
  isTemplate: false,
  templateName: "",
};

describe("Messages : création / modification (PostForm)", () => {
  const html = renderToStaticMarkup(
    createElement(PostForm, {
      action: async () => undefined,
      channels: [{ id: "c1", title: "Casino VIP", language: "fr", vertical: "CASINO" }],
      categories: [],
      campaigns: [],
      initial: postValues,
      abAllowed: true,
    }),
  );
  it("envoie le champ caché `text` en HTML Telegram, comme avant", () => {
    expect(html).toContain(`<input type="hidden" name="text" ${HIDDEN_TEXT}/>`);
    expect(hiddenFields(html).filter(([n]) => n === "text")).toHaveLength(1);
  });
  it("le texte s'affiche mis en forme dans l'éditeur, sans zone de texte à balises", () => {
    expect(textbox(html, "post-text")).toBe(
      '<b>Bonjour</b> &amp; <a href="https://go.goolink.eu/x">ici</a>',
    );
    expect(html).not.toContain("<textarea");
    expect(html).toMatch(/role="toolbar" aria-label="Mise en forme : Texte du message"/);
  });
  it("« Améliorer avec l'IA » dans la barre d'outils, compteur relié", () => {
    const toolbar = /role="toolbar"[\s\S]*?<div class="relative">/.exec(html)?.[0] ?? "";
    expect(toolbar).toContain("Améliorer avec l&#x27;IA");
    expect(html).toContain('aria-describedby="post-text-editor-help post-text-counter"');
  });
});

describe("Écrire à un groupe (BroadcastWizard)", () => {
  const html = renderToStaticMarkup(
    createElement(BroadcastWizard, {
      action: async () => undefined,
      testAction: async () => undefined,
      options: {
        channels: [],
        campaigns: [],
        inviteLinks: [],
        categories: [],
        languages: [],
        tags: [],
        bots: [{ id: "b1", name: "Bot casino", username: "casino_bot", vertical: "CASINO" }],
        media: [],
        affiliateCampaigns: [],
      },
      initialSegment: {} as never,
      defaultScheduledAt: "2026-10-11T10:00",
    }),
  );
  it("envoie toujours le champ caché `text` (la version B `textB` n'apparaît qu'avec le test A/B)", () => {
    expect(hiddenFields(html).some(([n]) => n === "text")).toBe(true);
    expect(hiddenFields(html).some(([n]) => n === "textB")).toBe(false);
  });
  it("la zone de texte est l'éditeur mis en forme (sans <textarea>)", () => {
    expect(textbox(html, "broadcast-text")).toBe("");
    expect(html).not.toMatch(/<textarea[^>]*id="broadcast-text"/);
  });
  it("MessageTextEditor (versions A et B) : éditeur sans champ caché à lui (l'assistant écrit text / textB)", () => {
    const b = renderToStaticMarkup(
      createElement(MessageTextEditor, {
        id: "broadcast-text-b",
        text: TEXT,
        setText: () => undefined,
        label: "Texte de la version B",
        hasMedia: true,
      }),
    );
    expect(textbox(b, "broadcast-text-b")).toContain("<b>Bonjour</b>");
    expect(hiddenFields(b)).toEqual([]);
    expect(b).toMatch(/>\d+ \/ 1[\s  ]024</);
  });
});

describe("Messages du bot (BotTextEditor, chaque langue)", () => {
  const html = renderToStaticMarkup(
    createElement(BotTextEditor, {
      id: "APPROVED-fr",
      label: "Texte en français (obligatoire)",
      defaultValue: "Bienvenue {prenom} dans <b>{canal}</b> !",
      required: true,
      examples: { prenom: "Léa", canal: "Casino VIP", liste_canaux: "", delai: "", bot: "" },
      buttons: [],
      mediaCount: 0,
      context: { vertical: "CASINO", language: "fr", hasMedia: false },
      channelId: "c1",
      moment: "APPROVED",
      saveTranslations: async () => ({ ok: true as const }),
    }),
  );
  it("envoie le champ caché `text` (HTML Telegram) avec le formulaire « Enregistrer »", () => {
    expect(hiddenFields(html)).toEqual([
      ["text", "Bienvenue {prenom} dans &lt;b&gt;{canal}&lt;/b&gt; !"],
    ]);
  });
  it("champ obligatoire (français) gardé, libellé relié, repères insérables", () => {
    expect(html).toMatch(/<input tabindex="-1" aria-hidden="true"[^>]*required=""/);
    expect(html).toContain('<label data-slot="label"');
    expect(html).toContain('for="APPROVED-fr"');
    expect(html).toContain(">Prénom</button>");
    expect(html).toContain(">Canaux à rejoindre</button>");
    expect(textbox(html, "APPROVED-fr")).toBe("Bienvenue {prenom} dans <b>{canal}</b> !");
  });
});

describe("Relances automatiques (MessageField : cartes et éditeur à branches)", () => {
  const render = (name?: string) =>
    renderToStaticMarkup(
      createElement(MessageField, {
        id: "rule-text",
        label: "Message",
        value: "Salut {prenom} <i>!</i>",
        onChange: () => undefined,
        name,
        context: { vertical: "CASINO" },
        required: Boolean(name),
      }),
    );
  it("carte (formulaire serveur) : champ caché `text`", () => {
    expect(hiddenFields(render("text"))).toEqual([["text", "Salut {prenom} &lt;i&gt;!&lt;/i&gt;"]]);
  });
  it("éditeur à branches (état du canevas) : pas de champ caché", () => {
    expect(hiddenFields(render())).toEqual([]);
  });
  it("texte mis en forme, repères Prénom / Nom du canal / Nom du bot, IA dans la barre d'outils", () => {
    const html = render("text");
    expect(textbox(html, "rule-text")).toBe("Salut {prenom} <i>!</i>");
    for (const w of ["Prénom", "Nom du canal", "Nom du bot"])
      expect(html).toContain(`>${w}</button>`);
    expect(html).toContain("Améliorer avec l&#x27;IA");
  });
});
