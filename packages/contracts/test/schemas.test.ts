import { describe, expect, it } from "vitest";

import { RawShelfAnalysisSchema, ShelfAuditSchema } from "../src/index.js";

const evidence = {
  frameId: "frame-004",
  timestampMs: 4_000,
  region: {
    xMin: 0.2,
    yMin: 0.1,
    xMax: 0.4,
    yMax: 0.9,
  },
  description: "Tito's label is visible on the center bottle.",
};

const rawAnalysis = {
  schemaVersion: "1.0",
  captureQuality: {
    status: "usable",
    warnings: [],
  },
  observations: [
    {
      observationId: "obs-001",
      matchLevel: "product_family",
      brand: {
        value: "Tito's",
        status: "observed",
        confidence: 0.91,
        confidenceLevel: "high",
        reason: "The brand label is legible in two frames.",
        evidence: [evidence],
      },
      product: {
        value: "Handmade Vodka",
        status: "observed",
        confidence: 0.88,
        confidenceLevel: "high",
        reason: "The product label is legible.",
        evidence: [evidence],
      },
      variant: {
        value: null,
        status: "not_observable",
        confidence: 0.2,
        confidenceLevel: "low",
        reason: "The variant is not visible.",
        evidence: [],
      },
      sizeOrPack: {
        value: null,
        status: "not_observable",
        confidence: 0.2,
        confidenceLevel: "low",
        reason: "Bottle size text is obscured.",
        evidence: [evidence],
      },
      facings: {
        value: 3,
        status: "observed",
        confidence: 0.75,
        confidenceLevel: "medium",
        reason: "Three adjacent bottles are visible in the same shelf row.",
        evidence: [evidence],
      },
      shelfPosition: {
        value: "eye_level",
        status: "inferred",
        confidence: 0.62,
        confidenceLevel: "medium",
        reason: "The shelf is near the center of the visible set.",
        evidence: [evidence],
      },
      catalogCandidates: [],
    },
  ],
  notes: [],
};

describe("shared shelf-audit contracts", () => {
  it("accepts an evidence-backed raw model analysis", () => {
    expect(RawShelfAnalysisSchema.parse(rawAnalysis)).toMatchObject({
      observations: [
        {
          matchLevel: "product_family",
        },
      ],
    });
  });

  it("rejects evidence boxes outside normalized image bounds", () => {
    const invalid = structuredClone(rawAnalysis);
    invalid.observations[0].brand.evidence[0].region.xMax = 1.2;

    expect(() => RawShelfAnalysisSchema.parse(invalid)).toThrow();
  });

  it("rejects inverted evidence boxes", () => {
    const invalid = structuredClone(rawAnalysis);
    invalid.observations[0].brand.evidence[0].region.xMin = 0.8;

    expect(() => RawShelfAnalysisSchema.parse(invalid)).toThrow();
  });

  it("rejects invalid confidence values", () => {
    const invalid = structuredClone(rawAnalysis);
    invalid.observations[0].brand.confidence = 1.01;

    expect(() => RawShelfAnalysisSchema.parse(invalid)).toThrow();
  });

  it("rejects a final audit that labels an uncovered SKU as out of stock", () => {
    expect(() =>
      ShelfAuditSchema.parse({
        auditId: "audit-001",
        schemaVersion: "1.0",
        account: {
          accountId: "account-001",
          resolutionMethod: "user_selected",
        },
        sourceVideo: {
          mediaPath: "uploads/audit-001.mp4",
        },
        status: "completed",
        captureQuality: rawAnalysis.captureQuality,
        observations: rawAnalysis.observations,
        outOfStocks: [
          {
            expectedProductId: "sku-titos-750",
            status: "confirmed",
            coverage: "incomplete",
            reason: "Not observed.",
            evidence: [],
          },
        ],
        insights: [],
        notes: [],
        provenance: {
          pipelineVersion: "0.1.0",
        },
      }),
    ).toThrow();
  });
});
