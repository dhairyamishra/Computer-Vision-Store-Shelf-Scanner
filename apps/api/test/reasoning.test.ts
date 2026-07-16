import { describe, expect, it } from "vitest";

import { combineCaptureWarnings } from "../src/reasoning/grok-shelf-reasoner.js";

describe("capture warning assembly", () => {
  it("deduplicates and caps warnings before final audit validation", () => {
    const warnings = combineCaptureWarnings(
      Array.from({ length: 25 }, (_, index) => `warning ${index}`),
      ["warning 0", "  warning 1  "],
    );

    expect(warnings).toHaveLength(20);
    expect(warnings).toEqual(expect.arrayContaining(["warning 0", "warning 1"]));
  });
});
