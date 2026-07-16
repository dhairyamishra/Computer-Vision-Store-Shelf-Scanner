import { describe, expect, it } from "vitest";

import {
  combineCaptureWarnings,
  filterVisualWarnings,
  removeKnowledgeBasedClaims,
  repairMojibake,
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

  it("downgrades claims that admit using outside product knowledge", () => {
    const response = removeKnowledgeBasedClaims({
      observations: [
        {
          product: {
            value: "Chocolate-covered cherries",
            status: "inferred",
            confidence: 0.7,
            confidenceLevel: "medium",
            reason: "Cella's is known for chocolate-covered cherries.",
            evidence: [],
          },
        },
      ],
    }) as { observations: Array<{ product: Record<string, unknown> }> };

    expect(response.observations[0].product).toMatchObject({
      value: null,
      status: "not_observable",
      confidence: 0,
      confidenceLevel: "low",
      evidence: [],
    });
  });
});

describe("provider text normalization", () => {
  it("repairs mojibake without changing valid Unicode", () => {
    expect(repairMojibake("trÃ¼ fru")).toBe("trü fru");
    expect(repairMojibake("trü fru")).toBe("trü fru");
    expect(repairMojibake({ brand: "trÃ¼ fru" })).toEqual({
      brand: "trü fru",
    });
  });

  it("keeps visual limitations but excludes catalog and detector warnings", () => {
    expect(
      filterVisualWarnings([
        "Lower shelf labels are blurred.",
        "Catalog contains no matching products.",
        "Local detector failed.",
      ]),
    ).toEqual(["Lower shelf labels are blurred."]);
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
