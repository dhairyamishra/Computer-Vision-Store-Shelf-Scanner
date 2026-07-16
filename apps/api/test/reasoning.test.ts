import { describe, expect, it } from "vitest";

import {
  combineCaptureWarnings,
  resolveCatalogScope,
} from "../src/reasoning/grok-shelf-reasoner.js";

describe("capture warning assembly", () => {
  it("deduplicates and caps warnings before final audit validation", () => {
    const warnings = combineCaptureWarnings(
      Array.from({ length: 25 }, (_, index) => `warning ${index}`),
      ["warning 0", "  warning 1  "],
    );

    expect(warnings).toHaveLength(20);
    expect(warnings).toEqual(
      expect.arrayContaining(["warning 0", "warning 1"]),
    );
  });
});

describe("catalog category scope", () => {
  const assortment = [
    {
      productId: "water",
      category: "beverages",
      brand: "Clear Spring",
      product: "Sparkling Water",
      variant: null,
      size: "12 oz",
      expectedPresence: true,
      expectedFacings: null,
      expectedShelfPosition: null,
      expectedPriceCents: null,
    },
    {
      productId: "marker",
      category: "stationery",
      brand: "Sharpie",
      product: "Permanent Marker",
      variant: null,
      size: null,
      expectedPresence: true,
      expectedFacings: null,
      expectedShelfPosition: null,
      expectedPriceCents: null,
    },
  ];

  it("selects only the catalog category detected in the evidence", () => {
    expect(resolveCatalogScope("office supplies", assortment)).toMatchObject({
      observedCategory: "stationery",
      catalogCategory: "stationery",
      status: "applied",
      matchingAssortment: [{ productId: "marker" }],
    });
  });

  it("does not apply an unrelated catalog", () => {
    expect(resolveCatalogScope("health and beauty", assortment)).toMatchObject({
      catalogCategory: null,
      status: "no_matching_catalog",
      matchingAssortment: [],
    });
  });
});
