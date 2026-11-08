import { describe, expect, it } from "vitest";
import {
  astronomicalToInfinite,
  formatGregorianYear,
  formatInfiniteYear,
  infiniteToAstronomical,
  parseSignedYear,
  signedToAstronomical,
} from "./year";

describe("infinite year conversion", () => {
  it("anchors at 1604", () => {
    expect(infiniteToAstronomical(1, "after")).toBe(1604);
    expect(infiniteToAstronomical(423, "after")).toBe(2026);
    expect(infiniteToAstronomical(1, "before")).toBe(1603);
  });

  it("converts back", () => {
    expect(astronomicalToInfinite(2026)).toEqual({ year: 423, before: false });
    expect(astronomicalToInfinite(1603)).toEqual({ year: 1, before: true });
  });

  it("rejects year zero and parses signed input", () => {
    expect(parseSignedYear("423")).toBe(423);
    expect(parseSignedYear("元年")).toBe(1);
    expect(signedToAstronomical(-1)).toBe(0);
    expect(signedToAstronomical(0)).toBeNull();
  });

  it("formats labels", () => {
    expect(formatInfiniteYear(1, false)).toBe("无限元年");
    expect(formatInfiniteYear(12, true)).toBe("无限前 12 年");
    expect(formatGregorianYear(0)).toBe("公元前 1 年");
  });
});
