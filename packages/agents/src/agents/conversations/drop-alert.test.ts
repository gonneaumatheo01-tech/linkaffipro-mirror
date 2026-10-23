import { describe, expect, it } from "vitest";
import type { ConversationProfileStats } from "../../algo/contracts";
import { personaDropAlerts } from "./drop-alert";

const p = (over: Partial<ConversationProfileStats>): ConversationProfileStats => ({
  key: "b1:p1:tk",
  botId: "b1",
  botLabel: "@lea_bot",
  kind: "BOT",
  personaId: "p1",
  personaName: "Léa",
  source: "tk",
  conversations: 50,
  replyRate: 0.5,
  medianMessagesBeforeLink: null,
  dropStage: null,
  medianReplyDelaySec: null,
  replyHours: [],
  linksSent: 0,
  clicks: 0,
  registrations: 10,
  ftds: 0,
  aiCostEur: 0,
  costPerRegistrationEur: null,
  enoughData: true,
  ...over,
});

describe("alerte agents_persona_drop", () => {
  it("chute du taux de réponse de plus de 30 % : alerte, chiffres seulement", () => {
    const [a, ...rest] = personaDropAlerts([p({ replyRate: 0.3 })], [p({})], { minConversations: 30 });
    expect(rest).toEqual([]);
    expect(a).toMatchObject({ kind: "agents_persona_drop", key: "b1:p1:tk", metric: "replyRate", previous: 0.5, current: 0.3 });
    expect(a!.drop).toBeCloseTo(0.4);
    expect(a!.message).toBe("Conversations @lea_bot · Léa · source « tk » : taux de réponse en baisse de 40 % sur 7 jours (50 % → 30 %).");
  });

  it("chute du taux d'inscription, seulement avec assez d'inscriptions avant", () => {
    expect(personaDropAlerts([p({ registrations: 4 })], [p({})], { minConversations: 30 }).map((x) => x.metric)).toEqual(["registrationRate"]);
    expect(personaDropAlerts([p({ registrations: 0 })], [p({ registrations: 3 })], { minConversations: 30 })).toEqual([]);
  });

  it("baisse de 30 % ou moins, ou pas assez de conversations : rien", () => {
    expect(personaDropAlerts([p({ replyRate: 0.36 })], [p({})], { minConversations: 30 })).toEqual([]);
    expect(personaDropAlerts([p({ replyRate: 0.1, conversations: 20 })], [p({})], { minConversations: 30 })).toEqual([]);
    expect(personaDropAlerts([p({ replyRate: 0.1 })], [p({ conversations: 10 })], { minConversations: 30 })).toEqual([]);
    expect(personaDropAlerts([p({ replyRate: 0.1 })], [], { minConversations: 30 })).toEqual([]);
  });
});
