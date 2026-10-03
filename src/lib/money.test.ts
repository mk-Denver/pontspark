import { coarseFloor, compareDecimal, fiatForSats, formatDecimal, fromMinor, parseFiatInput, priceWithSpread, satsForFiat, toMinor } from "./money";

describe("money", () => {
  it("round-trips decimal strings exactly", () => {
    expect(toMinor("10.5")).toBe(1050n);
    expect(fromMinor(1050n)).toBe("10.50");
    expect(fromMinor(100000n)).toBe("1000");
    expect(() => toMinor("1e3")).toThrow();
    expect(() => toMinor("01")).toThrow();
  });

  it("parses user input", () => {
    expect(parseFiatInput("1,000")).toBe("1000");
    expect(parseFiatInput("12.5")).toBe("12.50");
    expect(parseFiatInput("abc")).toBeNull();
  });

  it("derives sats deterministically from a price", () => {
    expect(satsForFiat("1000", "13500000")).toBe(7407n);
    expect(satsForFiat("1", "100000000")).toBe(1n);
    expect(fiatForSats(7407n, "13500000")).toBe("999.94");
  });

  it("applies spreads to a market price", () => {
    expect(priceWithSpread(10_000_000, 2)).toBe("10200000");
    expect(priceWithSpread(10_000_000, -2.5)).toBe("9750000");
    expect(compareDecimal("10", "9.99")).toBe(1);
  });

  it("formats without float drift", () => {
    expect(formatDecimal("13500000.5", 0)).toBe("13,500,000.5");
    expect(formatDecimal("1000")).toBe("1,000");
  });
  it("rounds limits down to coarse 1-2-5 steps", () => {
    expect(coarseFloor("43712")).toBe("20000");
    expect(coarseFloor("51000")).toBe("50000");
    expect(coarseFloor("199.9")).toBe("100");
    expect(coarseFloor("0.5")).toBe("0");
  });
});
