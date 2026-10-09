import { describe, expect, it } from "vitest";
import { safeJobId } from "./client";

describe("identifiants de tâche", () => {
  it("remplace les deux-points interdits par BullMQ", () => {
    expect(safeJobId("dm:abc:def")).toBe("dm-abc-def");
    expect(safeJobId("post-1")).toBe("post-1");
    expect(safeJobId(undefined)).toBeUndefined();
  });
});
