/**
 * « Bot principal » d'un canal : un bot en mode assistant de conversation n'est jamais proposé (phase 17). Le serveur
 * le refuse aussi (`updateChannelAction`).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChannelSettingsForm, primaryBotChoices } from "./channel-settings-form";

const bots = [
  { id: "b1", username: "casino_bot", mode: "STANDARD" },
  { id: "b2", username: "lea_assistant_bot", mode: "ASSISTANT" },
  { id: "b3", username: "sport_bot" },
];

describe("bot principal : jamais un assistant de conversation", () => {
  it("les bots normaux restent proposés (mode absent = liste déjà filtrée)", () => {
    expect(primaryBotChoices(bots).map((b) => b.id)).toEqual(["b1", "b3"]);
  });

  it("le formulaire ne propose pas l'assistant", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelSettingsForm, {
        channel: {
          id: "ch1",
          title: "Canal",
          vertical: null,
          language: "fr",
          primaryBotId: "b2",
          isActive: true,
          isTest: false,
          isMediaLibrary: false,
        },
        bots,
        action: async () => undefined,
        returnTo: "/channels",
      }),
    );
    expect(html).toContain('value="b1"');
    expect(html).toContain('value="b3"');
    expect(html).not.toContain('value="b2"');
    expect(html).not.toContain("lea_assistant_bot");
  });
});
