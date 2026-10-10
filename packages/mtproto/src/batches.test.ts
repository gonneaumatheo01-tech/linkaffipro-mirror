import { describe, expect, it } from "vitest";
import { channelIdToNumber, chunkMessageIds, VIEWS_BATCH_SIZE } from "./batches";

describe("chunkMessageIds", () => {
  it("lots de 100 au maximum, dernier lot plus court", () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const lots = chunkMessageIds(ids);
    expect(VIEWS_BATCH_SIZE).toBe(100);
    expect(lots.map((l) => l.length)).toEqual([100, 100, 50]);
    expect(lots[2]?.[49]).toBe(250);
  });
  it("supprime doublons et valeurs invalides ; liste vide → aucun lot", () => {
    expect(chunkMessageIds([3, 3, 0, -1, 2.5, 7])).toEqual([[3, 7]]);
    expect(chunkMessageIds([])).toEqual([]);
  });
  it("taille personnalisée", () => {
    expect(chunkMessageIds([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(() => chunkMessageIds([1], 0)).toThrow();
  });
});

describe("channelIdToNumber", () => {
  it("convertit BigInt / string / number", () => {
    expect(channelIdToNumber(BigInt("-1001234567890"))).toBe(-1001234567890);
    expect(channelIdToNumber("-1001234567890")).toBe(-1001234567890);
    expect(channelIdToNumber(-100)).toBe(-100);
  });
  it("refuse les valeurs hors entiers sûrs", () => {
    expect(() => channelIdToNumber(BigInt("9007199254740993"))).toThrow();
  });
});
