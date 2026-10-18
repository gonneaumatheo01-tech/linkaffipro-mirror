import { describe, expect, it } from "vitest";
import type { Message, Update } from "grammy/types";
import {
  adminLinkToken,
  assistantCommandOf,
  assistantReplyLang,
  canReopenConversation,
  classifyAssistantMessage,
  cleanStartSource,
  conversationPersonaId,
  fixedReplyAllowed,
  parseAssistantCommand,
  redactAssistantUpdate,
  reopenStage,
  resetStage,
} from "./logic";

const base = {
  message_id: 1,
  date: 1,
  chat: { id: 42, type: "private" as const, first_name: "Jean" },
};
const msg = (extra: Record<string, unknown>): Message =>
  ({ ...base, ...extra }) as unknown as Message;

describe("source du /start", () => {
  it("garde une source valide telle quelle", () => {
    expect(cleanStartSource("tk01")).toBe("tk01");
    expect(cleanStartSource("  pub_TikTok-07 ")).toBe("pub_TikTok-07");
    expect(cleanStartSource("a".repeat(64))).toBe("a".repeat(64));
  });
  it("refuse le reste : vide, trop long, caractères interdits, jeton de liaison d'un compte", () => {
    expect(cleanStartSource(undefined)).toBeNull();
    expect(cleanStartSource("")).toBeNull();
    expect(cleanStartSource("a".repeat(65))).toBeNull();
    expect(cleanStartSource("tk 01")).toBeNull();
    expect(cleanStartSource("tk01<script>")).toBeNull();
    expect(cleanStartSource("café")).toBeNull();
    expect(cleanStartSource("admin_abcdef")).toBeNull();
  });
});

describe("commandes", () => {
  it("reconnaît /start (avec ou sans source), /stop et /reset", () => {
    expect(parseAssistantCommand("/start")).toEqual({ command: "start", payload: null });
    expect(parseAssistantCommand("/start tk01")).toEqual({ command: "start", payload: "tk01" });
    expect(parseAssistantCommand("/stop")).toEqual({ command: "stop", payload: null });
    expect(parseAssistantCommand("/RESET")).toEqual({ command: "reset", payload: null });
    expect(parseAssistantCommand("/stop@lea_bot", "Lea_Bot")).toEqual({
      command: "stop",
      payload: null,
    });
  });
  it("ignore une autre commande, un texte normal ou une commande adressée à un autre bot", () => {
    expect(parseAssistantCommand("/help")).toBeNull();
    expect(parseAssistantCommand("salut /stop")).toBeNull();
    expect(parseAssistantCommand("/stopper")).toBeNull();
    expect(parseAssistantCommand("/stop@autre_bot", "lea_bot")).toBeNull();
    expect(parseAssistantCommand(undefined)).toBeNull();
  });
});

describe("nature du message reçu", () => {
  it("texte : gardé tel quel, sans média", () => {
    expect(classifyAssistantMessage(msg({ text: "coucou" }))).toEqual({
      text: "coucou",
      media: null,
    });
  });
  it("médias : légende gardée comme texte, sinon texte vide", () => {
    expect(classifyAssistantMessage(msg({ photo: [{ file_id: "p" }], caption: "moi" }))).toEqual({
      text: "moi",
      media: { kind: "photo" },
    });
    expect(classifyAssistantMessage(msg({ sticker: { file_id: "s" } }))).toEqual({
      text: "",
      media: { kind: "sticker" },
    });
    expect(classifyAssistantMessage(msg({ voice: { file_id: "v" } }))?.media).toEqual({
      kind: "voice",
    });
    expect(classifyAssistantMessage(msg({ video_note: { file_id: "v" } }))?.media).toEqual({
      kind: "video",
    });
    // Une animation porte aussi `document` : rangée avec les vidéos.
    expect(
      classifyAssistantMessage(msg({ animation: { file_id: "a" }, document: { file_id: "a" } }))
        ?.media,
    ).toEqual({ kind: "video" });
    expect(classifyAssistantMessage(msg({ document: { file_id: "d" } }))?.media).toEqual({
      kind: "document",
    });
    expect(
      classifyAssistantMessage(msg({ location: { latitude: 1, longitude: 2 } }))?.media,
    ).toEqual({
      kind: "other",
    });
  });
  it("message de service : ignoré", () => {
    expect(classifyAssistantMessage(msg({ write_access_allowed: {} }))).toBeNull();
    expect(classifyAssistantMessage(msg({ pinned_message: { message_id: 3 } }))).toBeNull();
  });
});

describe("langue des textes fixes", () => {
  it("langue de la conversation d'abord", () => {
    expect(
      assistantReplyLang({
        conversationLanguage: "es",
        memberLanguage: "fr",
        personaLanguages: ["fr"],
      }),
    ).toBe("es");
  });
  it("sinon celle de la personne si la persona la parle, sinon la première de la persona", () => {
    expect(assistantReplyLang({ memberLanguage: "en-US", personaLanguages: ["fr", "en"] })).toBe(
      "en",
    );
    expect(assistantReplyLang({ memberLanguage: "de", personaLanguages: ["it", "fr"] })).toBe("it");
    expect(assistantReplyLang({ memberLanguage: "pt-br", personaLanguages: [] })).toBe("pt");
    expect(assistantReplyLang({ memberLanguage: "ru" })).toBe("fr");
  });
});

describe("journal sans texte", () => {
  it("retire textes, légendes et mises en forme (longueur seulement), masque contact et position", () => {
    const update = {
      update_id: 9,
      message: {
        ...base,
        from: { id: 42, is_bot: false, first_name: "Jean" },
        text: "j'habite à Lyon, 06 12 34 56 78",
        entities: [{ type: "phone_number", offset: 17, length: 14 }],
        reply_to_message: { ...base, message_id: 0, text: "Tu viens d'où ?", caption: "x" },
        quote: { text: "d'où", position: 0 },
      },
    } as unknown as Update;
    const red = redactAssistantUpdate(update) as unknown as Record<string, Record<string, unknown>>;
    const json = JSON.stringify(red);
    expect(json).not.toContain("Lyon");
    expect(json).not.toContain("Tu viens");
    expect(json).not.toContain("d'où");
    expect(json).not.toContain("entities");
    expect(red.message!.textLength).toBe(31);
    expect((red.message!.reply_to_message as Record<string, unknown>).textLength).toBe(15);
    expect((red.message!.from as Record<string, unknown>).id).toBe(42);
    // L'update d'origine (traitée par les handlers) reste entière.
    expect((update.message as { text: string }).text).toContain("Lyon");
    // Idempotent.
    expect(redactAssistantUpdate(red as unknown as Update)).toEqual(red);

    const photo = redactAssistantUpdate({
      update_id: 10,
      message: { ...base, photo: [{ file_id: "p" }], caption: "ma photo", caption_entities: [] },
    } as unknown as Update) as unknown as { message: Record<string, unknown> };
    expect(photo.message.captionLength).toBe(8);
    expect(photo.message.caption).toBeUndefined();
    expect(photo.message.caption_entities).toBeUndefined();
    expect(photo.message.photo).toEqual([{ file_id: "p" }]);

    const contact = redactAssistantUpdate({
      update_id: 11,
      message: { ...base, contact: { phone_number: "+33612345678", first_name: "Jean" } },
    } as unknown as Update);
    expect(JSON.stringify(contact)).not.toContain("+3361");
  });
});

describe("liaison d'un compte de l'équipe", () => {
  it("reconnaît le jeton de Mon compte, jamais une source", () => {
    expect(adminLinkToken("admin_abc123")).toBe("abc123");
    expect(adminLinkToken("admin_")).toBe("");
    expect(adminLinkToken("tk01")).toBeNull();
    expect(adminLinkToken(null)).toBeNull();
  });
});

describe("persona de la conversation", () => {
  it("celle de la conversation d'abord, sinon celle du bot", () => {
    expect(conversationPersonaId({ personaId: "a" }, { personaId: "b" })).toBe("a");
    expect(conversationPersonaId({ personaId: null }, { personaId: "b" })).toBe("b");
    expect(conversationPersonaId({ personaId: null }, {})).toBeNull();
  });
});

describe("réouverture", () => {
  const closed = {
    status: "CLOSED" as const,
    closedReason: "BLOCKED",
    stoppedAt: null,
    isMinor: false,
  };
  it("seulement une fermeture due à l'envoi (bot bloqué, personne injoignable)", () => {
    expect(canReopenConversation(closed)).toBe(true);
    expect(canReopenConversation({ ...closed, closedReason: "UNREACHABLE" })).toBe(true);
    expect(canReopenConversation({ ...closed, closedReason: "STOP" })).toBe(false);
    expect(canReopenConversation({ ...closed, closedReason: "TEAM" })).toBe(false);
    expect(canReopenConversation({ ...closed, closedReason: null })).toBe(false);
    expect(canReopenConversation({ ...closed, stoppedAt: new Date() })).toBe(false);
    expect(canReopenConversation({ ...closed, isMinor: true })).toBe(false);
    expect(canReopenConversation({ ...closed, status: "BOT" })).toBe(false);
  });
  it("repart à l'étape d'avant la fermeture", () => {
    expect(reopenStage({ stageBeforeClose: "LINK_SENT", assistantTurns: 3 })).toBe("LINK_SENT");
    expect(reopenStage({ stageBeforeClose: null, assistantTurns: 2 })).toBe("CHAT");
    expect(reopenStage({ stageBeforeClose: "CLOSED", assistantTurns: 0 })).toBe("WELCOME");
  });
});

describe("journal sans texte : aperçu de lien et nom de fichier", () => {
  it("retire l'adresse d'aperçu tapée et le nom du fichier envoyé", () => {
    const update = {
      update_id: 9,
      message: {
        ...base,
        text: "regarde https://exemple.fr/julie",
        link_preview_options: { url: "https://exemple.fr/julie" },
        document: { file_id: "f", file_unique_id: "u", file_name: "CV_Julie_Dupont.pdf" },
      },
    } as unknown as Update;
    const json = JSON.stringify(redactAssistantUpdate(update));
    expect(json).not.toContain("julie");
    expect(json).not.toContain("Julie");
    expect(json).not.toContain("link_preview_options");
    expect(json).toContain('"file_nameLength":19');
  });
});

describe("corrections après relecture", () => {
  it("demande d'arrêt écrite sans barre oblique : vaut /stop", () => {
    expect(assistantCommandOf("STOP")).toEqual({ command: "stop", payload: null, typed: true });
    expect(assistantCommandOf("unsubscribe please")).toMatchObject({
      command: "stop",
      typed: true,
    });
    expect(assistantCommandOf("/stop")).toEqual({ command: "stop", payload: null });
    expect(assistantCommandOf("stop 😂")).toBeNull();
    expect(assistantCommandOf("stop, t'es drôle")).toBeNull();
  });

  it("réponse fixe : jamais vers un mineur ni une conversation bloquée par l'équipe", () => {
    expect(fixedReplyAllowed({ status: "BOT", closedReason: null, isMinor: false })).toBe(true);
    expect(fixedReplyAllowed({ status: "CLOSED", closedReason: "TEAM", isMinor: false })).toBe(
      false,
    );
    expect(fixedReplyAllowed({ status: "CLOSED", closedReason: "MINOR", isMinor: true })).toBe(
      false,
    );
    expect(
      fixedReplyAllowed({ status: "CLOSED", closedReason: "TEAM_CLOSED", isMinor: false }),
    ).toBe(true);
  });

  it("inscription déjà comptée : réouverture et /reset gardent « Inscrite »", () => {
    const convertedAt = new Date("2026-10-18T10:00:00Z");
    expect(reopenStage({ stageBeforeClose: "LINK_SENT", assistantTurns: 3, convertedAt })).toBe(
      "CONVERTED",
    );
    expect(resetStage({ status: "BOT", stage: "CONVERTED", convertedAt })).toBe("CONVERTED");
    expect(resetStage({ status: "BOT", stage: "LINK_SENT", convertedAt: null })).toBe("WELCOME");
    expect(resetStage({ status: "CLOSED", stage: "CLOSED", convertedAt })).toBe("CLOSED");
  });
});
