/** Phase 27 (relecture adverse) : un post transféré ne garde dans le journal ni texte, ni boutons, ni auteur. */
import { describe, expect, it } from "vitest";
import { inboxMessageFromPayload } from "../admin-chat";
import { FORWARDED_TEXT_REDACTED, redactForwardedUpdate } from "./redact";

const admin = { id: 4242, is_bot: false, first_name: "Admin" };
const priv = { id: 4242, type: "private" };

describe("journal : posts transférés masqués", () => {
  it("forward_origin canal (Bot API 7) : texte, légende, entités, boutons, signature retirés ; longueur et type de média gardés", () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 9,
        date: 1_792_000_000,
        chat: priv,
        from: admin,
        caption: "Écris-moi en DM pour le VIP, places limitées",
        caption_entities: [{ type: "bold", offset: 0, length: 5 }],
        photo: [{ file_id: "abc" }],
        media_group_id: "g1",
        reply_markup: { inline_keyboard: [[{ text: "VIP", url: "https://exemple.invalid" }]] },
        forward_origin: { type: "channel", date: 1, chat: { id: -100, type: "channel", title: "Exemple", username: "exemple" }, message_id: 77, author_signature: "Julie" },
        forward_signature: "Julie",
      },
    };
    const out = redactForwardedUpdate(update) as unknown as { message: Record<string, unknown> };
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/VIP|limitées|Julie|abc|exemple\.invalid/);
    expect(out.message).toMatchObject({ caption: FORWARDED_TEXT_REDACTED(44), media_kind: "photo", forwarded_redacted: true, message_id: 9, chat: priv, from: admin });
    expect(out.message.forward_origin).toEqual({ type: "channel", date: 1, chat: { id: -100, type: "channel", title: "Exemple", username: "exemple" }, message_id: 77 });
    expect(out.message.caption_entities).toBeUndefined();
    expect(out.message.reply_markup).toBeUndefined();
    // Idempotent (reprise des anciens événements).
    expect(redactForwardedUpdate(out)).toBe(out);
  });

  it("transfert masqué (hidden_user, user) et anciens champs : nom de l'expéditeur et personne d'origine retirés", () => {
    const hidden = redactForwardedUpdate({ update_id: 2, message: { message_id: 1, date: 1, chat: priv, from: admin, text: "Un texte du canal", forward_origin: { type: "hidden_user", date: 1, sender_user_name: "Jean Dupont" } } });
    expect(JSON.stringify(hidden)).not.toMatch(/Jean|Un texte/);
    const user = redactForwardedUpdate({ update_id: 3, message: { message_id: 1, date: 1, chat: priv, from: admin, text: "abc", forward_origin: { type: "user", date: 1, sender_user: { id: 5, first_name: "Paul" } } } });
    expect(JSON.stringify(user)).not.toMatch(/Paul|"id":5/);
    const legacy = redactForwardedUpdate({ update_id: 4, edited_message: { message_id: 1, date: 1, chat: { id: -5, type: "supergroup" }, from: admin, text: "abcd", forward_from: { id: 6, first_name: "Luc" }, forward_sender_name: "Luc", forward_date: 1 } });
    expect(JSON.stringify(legacy)).not.toMatch(/Luc|abcd/);
    expect((legacy as { edited_message: { text: string } }).edited_message.text).toBe(FORWARDED_TEXT_REDACTED(4));
  });

  it("message ordinaire de l'admin : intact, toujours lu par tg:inbox ; transféré : plus de texte dans l'inbox", () => {
    const plain = { update_id: 5, message: { message_id: 3, date: 1_792_000_000, chat: priv, from: admin, text: "fait" } };
    expect(redactForwardedUpdate(plain)).toBe(plain);
    expect(inboxMessageFromPayload(plain, 4242n)).toMatchObject({ text: "fait" });
    const fwd = redactForwardedUpdate({ ...plain, message: { ...plain.message, text: "post du canal", forward_origin: { type: "hidden_user", date: 1 } } });
    expect(inboxMessageFromPayload(fwd, 4242n)?.text).toBe(FORWARDED_TEXT_REDACTED(13));
  });
});
