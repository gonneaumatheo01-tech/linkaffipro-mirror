import { describe, expect, it } from "vitest";
import { forwardedAlbumKey, forwardedToReferencePost, groupForwardedAlbums, type ForwardedMessage } from "./forwarded";

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

describe("albums transférés (media_group_id) : un seul post", () => {
  const origin = (id: number) => ({ type: "channel" as const, date: 1_791_000_000, chat: { id: -1001234, type: "channel", title: "Casino Exemple", username: "casino_exemple" }, message_id: id });
  const chat = { id: 4242 };
  it("trois photos d'un album → un post (premier numéro, légende non vide, média le plus parlant) ; post seul gardé", () => {
    const album: ForwardedMessage[] = [
      { message_id: 10, date: 1_792_000_000, chat, media_group_id: "g1", photo: [{}], forward_origin: origin(501) },
      { message_id: 11, date: 1_792_000_000, chat, media_group_id: "g1", photo: [{}], caption: "Trois tables ouvertes ce soir", forward_origin: origin(502) },
      { message_id: 12, date: 1_792_000_000, chat, media_group_id: "g1", video: {}, forward_origin: origin(500) },
      { message_id: 13, date: 1_792_000_100, chat, text: "Post seul", forward_origin: origin(510) },
    ];
    const r = groupForwardedAlbums(album);
    expect(r).toHaveLength(2);
    expect(r[0]!.post).toMatchObject({ externalId: 500, text: "Trois tables ouvertes ce soir", mediaKind: "video" });
    expect(r[0]!.origin).toMatchObject({ username: "casino_exemple" });
    expect(r[1]!.post).toMatchObject({ externalId: 510, text: "Post seul" });
    expect(forwardedAlbumKey(album[0]!)).toBe("4242:g1");
    expect(forwardedAlbumKey(album[3]!)).toBeNull();
  });
  it("album masqué : un post, numéro stable tiré de la légende ; deux albums distincts restent distincts", () => {
    const hidden = (id: number, group: string, caption?: string): ForwardedMessage => ({
      message_id: id,
      date: 1_792_000_000,
      chat,
      media_group_id: group,
      photo: [{}],
      ...(caption ? { caption } : {}),
      forward_origin: { type: "hidden_user", date: 1_790_000_000 },
    });
    const r = groupForwardedAlbums([hidden(1, "a"), hidden(2, "a", "Légende de l'album A"), hidden(3, "b", "Album B")]);
    expect(r).toHaveLength(2);
    expect(r[0]!.post.text).toBe("Légende de l'album A");
    expect(r[0]!.post.externalId).toBeLessThan(0);
    expect(groupForwardedAlbums([hidden(2, "a", "Légende de l'album A"), hidden(1, "a")])[0]!.post.externalId).toBe(r[0]!.post.externalId);
  });
});
