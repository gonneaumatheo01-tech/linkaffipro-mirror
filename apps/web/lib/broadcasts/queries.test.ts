import { describe, expect, it } from "vitest";
import { progressOf } from "./queries";
import { parseSegmentForm } from "./schema";

describe("envois groupés", () => {
  it("calcule la progression", () => {
    expect(progressOf({ targeted: 0, sent: 0, failed: 0, blocked: 0 })).toEqual({ done: 0, pct: 0 });
    expect(progressOf({ targeted: 10, sent: 7, failed: 1, blocked: 1 })).toEqual({ done: 9, pct: 90 });
  });
  it("lit le segment depuis le formulaire", () => {
    const fd = new FormData();
    fd.append("channelIds", "c1");
    fd.append("channelIds", "c2");
    fd.append("spendLevels", "VIP");
    fd.append("languages", "FR, en");
    fd.append("inactiveDays", "14");
    fd.append("tags", "vip test");
    expect(parseSegmentForm(fd)).toEqual({ channelIds: ["c1", "c2"], spendLevels: ["VIP"], languages: ["fr", "en"], inactiveDays: 14, tags: ["vip", "test"] });
  });
});
