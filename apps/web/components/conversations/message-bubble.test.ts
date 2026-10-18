import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toThreadMessage, type ThreadMessageRow } from "@/lib/conversations/thread";
import { jargonIn } from "../../tests/vocabulary/jargon-scan";
import { MessageBubble } from "./message-bubble";

const row = (over: Partial<ThreadMessageRow>): ThreadMessageRow => ({
  id: "m1",
  direction: "OUT",
  author: "ASSISTANT",
  text: "Tu fais quoi ce soir ?",
  media: null,
  meta: {},
  createdAt: new Date("2026-10-18T10:00:00Z"),
  teamUser: null,
  outboundMessage: null,
  ...over,
});

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("bulle d'un message du fil", () => {
  it("partie interrompue : son texte et « Envoi interrompu », jamais « Non envoyé » ni le texte technique", () => {
    const m = toThreadMessage(
      row({
        meta: { interrupted: true },
        outboundMessage: {
          status: "FAILED",
          error:
            "Envoi interrompu (service d'arrière-plan arrêté pendant l'envoi) : message peut-être non reçu.",
        },
      }),
      { name: "Léa", gender: "F" },
    );
    const t = text(renderToStaticMarkup(createElement(MessageBubble, { message: m })));
    expect(t).toContain("Tu fais quoi ce soir ?");
    expect(t).toContain("Envoi interrompu : la personne ne l'a peut-être pas reçu.");
    expect(t).not.toContain("Non envoyé");
    expect(t).not.toContain("arrière-plan");
    expect(t).not.toContain("(message vide)");
    expect(jargonIn(t)).toEqual([]);
  });

  it("envoi raté d'un message de l'équipe : « Non envoyé » avec sa raison (inchangé)", () => {
    const m = toThreadMessage(
      row({
        author: "TEAM",
        teamUser: { name: "Marie" },
        outboundMessage: {
          status: "FAILED",
          error: "Le bot ne peut plus écrire à cette personne.",
        },
      }),
      null,
    );
    const t = text(renderToStaticMarkup(createElement(MessageBubble, { message: m })));
    expect(t).toContain("Non envoyé : Le bot ne peut plus écrire à cette personne.");
  });
});
