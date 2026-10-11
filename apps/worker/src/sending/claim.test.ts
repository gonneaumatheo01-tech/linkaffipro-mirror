import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const enqueue = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined);
vi.mock("@linkaffipro/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));
vi.mock("@linkaffipro/queue", () => ({ enqueue: (...args: unknown[]) => enqueue(...args) }));

import { claimDuePosts } from "./claim";

describe("réclamation des messages échus", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    enqueue.mockReset();
  });
  it("enfile chaque message réclamé avec un jobId idempotent", async () => {
    queryRaw.mockResolvedValueOnce([{ id: "p1" }, { id: "p2" }]);
    const ids = await claimDuePosts(new Date("2026-10-09T10:00:00Z"));
    expect(ids).toEqual(["p1", "p2"]);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      "telegram-send",
      { type: "post", postId: "p1" },
      expect.objectContaining({ jobId: "post:p1" }),
    );
  });
  it("message déjà essayé puis reprogrammé : nouveau jobId (une tâche terminée gardée par BullMQ ne le bloque pas)", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "p1", attempts: 2 },
      { id: "p2", attempts: 0 },
    ]);
    await claimDuePosts(new Date("2026-10-09T10:00:00Z"));
    expect(enqueue).toHaveBeenNthCalledWith(
      1,
      "telegram-send",
      { type: "post", postId: "p1" },
      { jobId: "post:p1:2", attempts: 1 },
    );
    expect(enqueue).toHaveBeenNthCalledWith(
      2,
      "telegram-send",
      { type: "post", postId: "p2" },
      { jobId: "post:p2", attempts: 1 },
    );
  });
  it("un second tick ne réclame rien (déjà passés en SENDING)", async () => {
    queryRaw.mockResolvedValueOnce([{ id: "p1" }]).mockResolvedValueOnce([]);
    await claimDuePosts();
    await claimDuePosts();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
