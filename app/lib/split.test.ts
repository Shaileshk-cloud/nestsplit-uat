import { describe, it, expect } from "vitest";
import { toPaise, fromPaise, equalSplitPaise, shareSplitPaise, percentSplitPaise } from "./split";

describe("paise conversion", () => {
  it("rounds rupees to integer paise", () => {
    expect(toPaise(3.33)).toBe(333);
    expect(toPaise("10")).toBe(1000);
    expect(toPaise(0.1)).toBe(10);
  });
  it("formats paise back to a fixed-2 string", () => {
    expect(fromPaise(333)).toBe("3.33");
    expect(fromPaise(1000)).toBe("10.00");
  });
});

describe("equalSplitPaise", () => {
  it("divides evenly and always sums to the total", () => {
    const parts = equalSplitPaise(1000, 3);
    expect(parts).toEqual([333, 333, 334]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(1000);
  });
  it("returns [] for zero participants", () => {
    expect(equalSplitPaise(1000, 0)).toEqual([]);
  });
});

describe("shareSplitPaise", () => {
  it("allocates proportionally and sums to the total", () => {
    const parts = shareSplitPaise(1000, [1, 1, 2]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(1000);
    expect(parts[2]).toBeGreaterThan(parts[0]);
  });
  it("returns all zeros when weights are non-positive", () => {
    expect(shareSplitPaise(1000, [0, 0])).toEqual([0, 0]);
  });
});

describe("percentSplitPaise", () => {
  it("allocates by percentage and sums to the total", () => {
    const parts = percentSplitPaise(1000, [10, 20, 70]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(1000);
  });
  it("puts the rounding remainder on the last participant", () => {
    const parts = percentSplitPaise(1000, [33.33, 33.33, 33.34]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(1000);
  });
});
