import { z } from "zod";

import {
  AccountResolutionMethodSchema,
  AuditRunStatusSchema,
  CaptureQualityStatusSchema,
  ConfidenceLevelSchema,
  CoverageStatusSchema,
  InsightSeveritySchema,
  InsightTypeSchema,
  ObservationStatusSchema,
  OutOfStockStatusSchema,
  ProductMatchLevelSchema,
  ShelfPositionSchema,
} from "./enums.js";

export const SHELF_AUDIT_SCHEMA_VERSION = "1.0" as const;

const normalizedCoordinateSchema = z.number().min(0).max(1);

export const EvidenceRegionSchema = z
  .object({
    xMin: normalizedCoordinateSchema,
    yMin: normalizedCoordinateSchema,
    xMax: normalizedCoordinateSchema,
    yMax: normalizedCoordinateSchema,
  })
  .superRefine((region, context) => {
    if (region.xMin >= region.xMax) {
      context.addIssue({
        code: "custom",
        message: "xMin must be less than xMax.",
        path: ["xMin"],
      });
    }

    if (region.yMin >= region.yMax) {
      context.addIssue({
        code: "custom",
        message: "yMin must be less than yMax.",
        path: ["yMin"],
      });
    }
  });

export const EvidenceRefSchema = z.object({
  frameId: z.string().min(1),
  timestampMs: z.number().int().nonnegative(),
  region: EvidenceRegionSchema.optional(),
  description: z.string().min(1),
});

export const CaptureQualitySchema = z.object({
  status: CaptureQualityStatusSchema,
  warnings: z.array(z.string().min(1)).max(20),
});

export const CatalogCandidateSchema = z.object({
  productId: z.string().min(1),
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
});

const claimFields = {
  status: ObservationStatusSchema,
  confidence: z.number().min(0).max(1),
  confidenceLevel: ConfidenceLevelSchema,
  reason: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).max(12),
};

type ClaimValidationInput = {
  value: unknown;
  status: z.infer<typeof ObservationStatusSchema>;
  confidence: number;
  confidenceLevel: z.infer<typeof ConfidenceLevelSchema>;
};

function validateClaim(
  claim: ClaimValidationInput,
  context: z.RefinementCtx<ClaimValidationInput>,
) {
  if (
    (claim.status === "observed" || claim.status === "inferred") &&
    claim.value === null
  ) {
    context.addIssue({
      code: "custom",
      message: "Observed and inferred claims require a value.",
      path: ["value"],
    });
  }

  if (
    (claim.status === "not_observable" || claim.status === "not_applicable") &&
    claim.value !== null
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Non-observable and non-applicable claims must not contain a value.",
      path: ["value"],
    });
  }

  const expectedLevel =
    claim.confidence >= 0.8
      ? "high"
      : claim.confidence >= 0.5
        ? "medium"
        : "low";

  if (claim.confidenceLevel !== expectedLevel) {
    context.addIssue({
      code: "custom",
      message: "confidenceLevel must agree with the confidence value.",
      path: ["confidenceLevel"],
    });
  }
}

export const StringClaimSchema = z
  .object({ value: z.string().min(1).nullable(), ...claimFields })
  .superRefine(validateClaim);
export const NonNegativeIntegerClaimSchema = z
  .object({ value: z.number().int().nonnegative().nullable(), ...claimFields })
  .superRefine(validateClaim);
export const ShelfPositionClaimSchema = z
  .object({ value: ShelfPositionSchema.nullable(), ...claimFields })
  .superRefine(validateClaim);

export const RawProductObservationSchema = z.object({
  observationId: z.string().min(1),
  matchLevel: ProductMatchLevelSchema,
  brand: StringClaimSchema,
  product: StringClaimSchema,
  variant: StringClaimSchema,
  sizeOrPack: StringClaimSchema,
  facings: NonNegativeIntegerClaimSchema,
  shelfPosition: ShelfPositionClaimSchema,
  catalogCandidates: z.array(CatalogCandidateSchema).max(5),
});

export const RawShelfAnalysisSchema = z.object({
  schemaVersion: z.literal(SHELF_AUDIT_SCHEMA_VERSION),
  observedCategory: z.string().min(1).max(100),
  captureQuality: CaptureQualitySchema,
  observations: z.array(RawProductObservationSchema),
  notes: z.array(z.string().min(1)).max(20),
});

export const CatalogScopeSchema = z.object({
  observedCategory: z.string().min(1).max(100),
  catalogCategory: z.string().min(1).max(100).nullable(),
  status: z.enum(["applied", "no_matching_catalog"]),
});

export const OutOfStockSchema = z
  .object({
    expectedProductId: z.string().min(1),
    status: OutOfStockStatusSchema,
    coverage: CoverageStatusSchema,
    reason: z.string().min(1),
    evidence: z.array(EvidenceRefSchema).max(12),
  })
  .superRefine((outOfStock, context) => {
    if (
      outOfStock.status === "confirmed" &&
      outOfStock.coverage !== "complete"
    ) {
      context.addIssue({
        code: "custom",
        message: "Confirmed out-of-stocks require complete coverage.",
        path: ["coverage"],
      });
    }

    if (outOfStock.status === "confirmed" && outOfStock.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Confirmed out-of-stocks require visual evidence.",
        path: ["evidence"],
      });
    }
  });

export const InsightSchema = z.object({
  type: InsightTypeSchema,
  severity: InsightSeveritySchema,
  title: z.string().min(1),
  recommendedAction: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceRefSchema).min(1).max(12),
});

const safeMediaPathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") && !path.startsWith("\\") && !path.includes(".."),
    "mediaPath must be a relative path within the managed media directory.",
  );

export const ShelfAuditSchema = z.object({
  auditId: z.string().min(1),
  schemaVersion: z.literal(SHELF_AUDIT_SCHEMA_VERSION),
  account: z.object({
    accountId: z.string().min(1),
    resolutionMethod: AccountResolutionMethodSchema,
  }),
  sourceVideo: z.object({
    mediaPath: safeMediaPathSchema,
  }),
  status: AuditRunStatusSchema,
  catalogScope: CatalogScopeSchema,
  captureQuality: CaptureQualitySchema,
  observations: z.array(RawProductObservationSchema),
  outOfStocks: z.array(OutOfStockSchema),
  insights: z.array(InsightSchema),
  notes: z.array(z.string().min(1)).max(20),
  provenance: z.object({
    pipelineVersion: z.string().min(1),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    promptVersion: z.string().min(1).optional(),
    detectorVersion: z.string().min(1).optional(),
  }),
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type RawShelfAnalysis = z.infer<typeof RawShelfAnalysisSchema>;
export type ShelfAudit = z.infer<typeof ShelfAuditSchema>;
