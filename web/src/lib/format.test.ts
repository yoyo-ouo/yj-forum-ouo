import { describe, expect, it } from "vitest";
import { categoryColor, categoryLabel, stripHtml, textLimit } from "./format";

describe("format helpers", () => {
  it("maps categories", () => {
    expect(categoryLabel("creative")).toBe("创作");
    expect(categoryLabel("unknown")).toBe("unknown");
    expect(categoryColor("question")).toBe("#ef4444");
  });

  it("strips html and limits text", () => {
    expect(stripHtml("<p>你好 <strong>世界</strong></p>")).toBe("你好 世界");
    expect(textLimit("abcdef", 3)).toBe("abc…");
    expect(textLimit("abc", 3)).toBe("abc");
  });
});
