/**
 * Formulaire d'un message de canal avec des emojis animés (phase 12, D10), rendu côté serveur : bandeau « publié par
 * votre compte Telegram, sans boutons », boutons désactivés, offre en lien dans le texte, état du compte, choix imposé
 * quand il y a aussi des boutons, aperçu animé, simple rappel pour un modèle.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MtprotoPublishStatus } from "@linkaffipro/core";

vi.mock("@/app/(admin)/messages/categories/inline-actions", () => ({
  createCategoryInlineAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { PostForm, type PostEmojiActions, type PostFormValues } from "./post-form";

const EMOJI = '<tg-emoji emoji-id="5368324170671202286">🎰</tg-emoji>';

const base: PostFormValues = {
  channelIds: ["c1"],
  scheduledAt: "",
  categoryId: "",
  language: "fr",
  text: `Jackpot ${EMOJI} ce soir`,
  media: [],
  buttons: [],
  pinAfterSend: false,
  unpinPrevious: false,
  deleteAfterMinutes: "",
  disableNotification: false,
  protectContent: false,
  disableLinkPreview: true,
  isTemplate: false,
  templateName: "",
};

const actions: PostEmojiActions = {
  checkAccount: vi.fn(async () => ({ ok: true as const, requestedAt: new Date().toISOString() })),
  accountStatus: vi.fn(async () => null),
  createOfferLink: vi.fn(async () => ({ ok: true as const, html: "", url: "" })),
};

const READY: MtprotoPublishStatus = {
  checkedAt: "2026-10-11T10:00:00.000Z",
  connected: true,
  premium: true,
  user: { id: "42", firstName: "Matt", username: "matt" },
  error: null,
  channels: { c1: { canPost: true, checkedAt: "2026-10-11T10:00:00.000Z" } },
};

type Channel = { id: string; title: string; language: string; vertical: string; type?: string };
const CASINO_VIP: Channel = { id: "c1", title: "Casino VIP", language: "fr", vertical: "CASINO" };
const GROUP: Channel = {
  id: "g1",
  title: "Groupe Casino",
  language: "fr",
  vertical: "CASINO",
  type: "GROUP",
};

function render(
  initial: Partial<PostFormValues>,
  opts: { status?: MtprotoPublishStatus | null; channels?: Channel[] } = {},
): string {
  return renderToStaticMarkup(
    createElement(PostForm, {
      action: async () => undefined,
      channels: opts.channels ?? [CASINO_VIP],
      categories: [],
      campaigns: [],
      initial: { ...base, ...initial },
      abAllowed: true,
      accountStatus: opts.status ?? null,
      emojiActions: actions,
    }),
  );
}

/** Texte visible (balises retirées, entités de base décodées). */
function visible(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("message de canal avec emojis animés, sans bouton", () => {
  const html = render({}, { status: READY });
  const text = visible(html);

  it("bandeau : publié par votre compte Telegram, sans boutons", () => {
    expect(text).toContain(
      "Ce message contient des emojis animés : il sera publié par votre compte Telegram, sans boutons",
    );
    expect(text).toContain("Publié par votre compte · emojis animés");
  });

  it("boutons désactivés, offre proposée comme lien dans le texte", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Pas de boutons[^"]*"[^>]*>/);
    expect(text).toContain("Ajouter l'offre comme lien dans le texte");
  });

  it("le compte peut publier dans le canal, avec « Vérifier »", () => {
    expect(text).toContain("Votre compte Telegram @matt peut publier dans « Casino VIP ».");
    expect(text).toContain("Vérifier");
    // Aucun choix à faire, donc aucun champ de choix envoyé.
    expect(html).not.toContain('name="emojiButtonsChoice"');
    expect(text).not.toContain("Emojis animés ou boutons ?");
  });

  it("aperçu : l'emoji animé est une puce (son emoji de remplacement en attendant l'animation)", () => {
    const preview = /data-slot="telegram-preview"[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? "";
    expect(preview).toContain('data-ce-id="5368324170671202286"');
    expect(preview).toContain('alt="🎰"');
    expect(preview).not.toContain("<tg-emoji");
  });

  it("le texte envoyé garde la balise de l'emoji animé", () => {
    expect(html).toContain(
      'name="text" value="Jackpot &lt;tg-emoji emoji-id=&quot;5368324170671202286&quot;&gt;🎰&lt;/tg-emoji&gt; ce soir"',
    );
  });
});

describe("compte Telegram pas prêt", () => {
  it("aucun compte connecté : la raison et le lien vers les réglages (nouvel onglet)", () => {
    const html = render({}, { status: { ...READY, connected: false } });
    expect(visible(html)).toContain("Aucun compte Telegram connecté");
    expect(html).toMatch(
      /<a href="\/settings\/connectors\/telegram" target="_blank" rel="noopener"[^>]*>Ouvrir Réglages → Connexions → Telegram/,
    );
  });

  it("canal jamais vérifié : la raison propre au canal", () => {
    const html = render({}, { status: { ...READY, channels: {} } });
    expect(visible(html)).toContain(
      "« Casino VIP » : Droits du compte sur ce canal pas encore vérifiés",
    );
  });
});

describe("emojis animés ET boutons", () => {
  const html = render({
    buttons: [[{ text: "Site", type: "URL", url: "https://site.test" }]],
  });
  const text = visible(html);

  it("choix imposé entre les emojis animés et les boutons", () => {
    expect(text).toContain("Emojis animés ou boutons ?");
    expect(text).toContain("Garder les emojis animés (sans boutons)");
    expect(text).toContain("Garder les boutons (emojis normaux)");
    expect(html.match(/name="emojiButtonsChoiceUi"/g)).toHaveLength(2);
    // Pas encore choisi : rien n'est envoyé, le navigateur arrête l'enregistrement.
    expect(html).not.toContain('name="emojiButtonsChoice"');
  });

  it("pas encore de bandeau « publié par votre compte » tant que le choix n'est pas fait", () => {
    expect(text).not.toContain("il sera publié par votre compte Telegram, sans boutons");
  });
});

describe("modèle avec emojis animés", () => {
  it("simple rappel, ni choix ni bandeau", () => {
    const text = visible(
      render({
        isTemplate: true,
        templateName: "Jackpot",
        buttons: [[{ text: "Site", type: "URL", url: "https://site.test" }]],
      }),
    );
    expect(text).toContain("Ce modèle contient des emojis animés");
    expect(text).not.toContain("Emojis animés ou boutons ?");
    expect(text).not.toContain("il sera publié par votre compte Telegram, sans boutons");
  });
});

describe("message sans emoji animé", () => {
  it("rien ne change", () => {
    const text = visible(render({ text: "Bonjour" }));
    expect(text).not.toContain("emojis animés");
    expect(text).not.toContain("Vérifier");
  });
});

describe("« Contenu protégé » et message publié par le compte", () => {
  /** Case « Contenu protégé » et sa phrase (bloc « Avancé », rendu même replié). */
  function protectOption(html: string): string {
    const i = html.indexOf("Contenu protégé</span>");
    const start = html.lastIndexOf("<label", i);
    return html.slice(start, html.indexOf("</label>", i));
  }

  it("publié par le compte : case désactivée, non cochée, rien d'envoyé, phrase claire (et dans le bandeau)", () => {
    const html = render({ protectContent: true }, { status: READY });
    const option = protectOption(html);
    expect(option).toMatch(/data-disabled=""|aria-disabled="true"/);
    expect(visible(option)).toContain(
      "Avec des emojis animés, Telegram ne permet pas de protéger ce message ; vous pouvez protéger tout le canal dans Telegram.",
    );
    expect(html).not.toContain('name="protectContent"');
    // Le bandeau le dit aussi.
    const banner = /data-slot="emoji-publish"[\s\S]*$/.exec(html)?.[0] ?? "";
    expect(visible(banner)).toContain("Telegram ne permet pas de protéger ce message");
  });

  it("sans emoji animé : la case reste utilisable", () => {
    const html = render({ text: "Bonjour", protectContent: true });
    expect(protectOption(html)).not.toMatch(/data-disabled=""|aria-disabled="true"/);
    expect(html).toContain('name="protectContent" value="on"');
  });
});

describe("groupe ou supergroupe : le bot publie lui-même les emojis animés", () => {
  it("groupe seul : ni bandeau du compte, ni choix, boutons actifs, phrase rassurante", () => {
    const html = render(
      {
        channelIds: ["g1"],
        buttons: [[{ text: "Site", type: "URL", url: "https://site.test" }]],
        protectContent: true,
      },
      { channels: [GROUP] },
    );
    const text = visible(html);
    expect(text).not.toContain("il sera publié par votre compte Telegram");
    expect(text).not.toContain("Emojis animés ou boutons ?");
    expect(text).not.toContain("Publié par votre compte · emojis animés");
    expect(text).toContain(
      "Dans « Groupe Casino », le bot publie lui-même les emojis animés, avec les boutons.",
    );
    // Boutons et contenu protégé gardés.
    expect(html).not.toMatch(/<fieldset disabled=""/);
    expect(html).toContain('name="protectContent" value="on"');
  });

  it("canal et groupe cochés : compte dans le canal seulement (seul canal vérifié), bot dans le groupe", () => {
    const html = render(
      { channelIds: ["c1", "g1"] },
      { status: READY, channels: [CASINO_VIP, GROUP] },
    );
    const text = visible(html);
    expect(text).toContain("il sera publié par votre compte Telegram, sans boutons");
    expect(text).toContain("Votre compte Telegram @matt peut publier dans « Casino VIP ».");
    expect(text).not.toContain("« Groupe Casino » : Droits du compte");
    expect(text).toContain(
      "Dans « Groupe Casino », le bot publie lui-même les emojis animés, avec les boutons.",
    );
    // Les boutons restent possibles (ils partiront dans le groupe), et le bandeau ne dit pas le contraire.
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*title="Pas de boutons[^"]*"[^>]*>/);
    expect(text).not.toContain("les boutons sont donc désactivés");
    expect(text).toContain(
      "dans les canaux, ce message part donc sans boutons (ils restent dans les groupes)",
    );
  });
});
