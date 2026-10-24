import { describe, expect, it } from "vitest";
import { forwardedToReferencePost, type ForwardedMessage } from "./forwarded";

const base = { message_id: 77, date: 1_792_000_000 };

describe("posts transférés à Kevin", () => {
  it("origine visible (canal) : identifiant, nom, titre, numéro et date d'origine ; photo, lien, boutons", () => {
    const msg: ForwardedMessage = {
      ...base,
      caption: "🎰 Roulette ce soir, bonus avec le code LUMIERE ! https://exemple.invalid/x",
      caption_entities: [{ type: "url", offset: 50, length: 25 }, { type: "mention", offset: 0, length: 3 }],
      photo: [{ file_id: "a" }],
      reply_markup: { inline_keyboard: [[{ text: "Bonus", url: "https://exemple.invalid/b" }]] },
      forward_origin: { type: "channel", date: 1_791_000_000, chat: { id: -1001234, type: "channel", title: "Casino Exemple", username: "casino_exemple" }, message_id: 345 },
    };
    const r = forwardedToReferencePost(msg)!;
    expect(r.origin).toEqual({ chatId: -1001234n, username: "casino_exemple", title: "Casino Exemple" });
    expect(r.post).toMatchObject({ externalId: 345, mediaKind: "photo", hasButton: true, linkCount: 1, views: null });
    expect(r.post.postedAt.toISOString()).toBe(new Date(1_791_000_000_000).toISOString());
    expect(r.post.text).toContain("Roulette");
  });

  it("origine masquée (hidden_user, user) : origine inconnue, numéro stable et négatif", () => {
    const hidden: ForwardedMessage = { ...base, text: "Écris-moi en DM", forward_origin: { type: "hidden_user", date: 1_790_000_000, sender_user_name: "X" } };
    const a = forwardedToReferencePost(hidden)!;
    const b = forwardedToReferencePost({ ...hidden, message_id: 99 })!;
    expect(a.origin).toBeNull();
    expect(a.post.externalId).toBeLessThan(0);
    expect(b.post.externalId).toBe(a.post.externalId);
    expect(a.post).toMatchObject({ mediaKind: "text", hasButton: false, linkCount: 0 });
    const user = forwardedToReferencePost({ ...base, video: {}, caption: "vidéo", forward_origin: { type: "user", date: 1_790_000_100, sender_user: {} } })!;
    expect(user.origin).toBeNull();
    expect(user.post.mediaKind).toBe("video");
  });

  it("anciens champs (forward_from_chat), sondage, document, autre ; message non transféré → null", () => {
    const legacy = forwardedToReferencePost({ ...base, poll: { question: "Votre jeu ?" }, forward_from_chat: { id: -1009, type: "channel", title: "Ancien" }, forward_from_message_id: 12, forward_date: 1_789_000_000 })!;
    expect(legacy.origin).toEqual({ chatId: -1009n, username: null, title: "Ancien" });
    expect(legacy.post).toMatchObject({ externalId: 12, mediaKind: "poll", text: "Votre jeu ?" });
    expect(forwardedToReferencePost({ ...base, document: {}, forward_origin: { type: "hidden_user", date: 1 } })!.post.mediaKind).toBe("document");
    expect(forwardedToReferencePost({ ...base, sticker: {}, forward_origin: { type: "hidden_user", date: 1 } })!.post.mediaKind).toBe("other");
    expect(forwardedToReferencePost({ ...base, text: "bonjour" })).toBeNull();
  });
});
