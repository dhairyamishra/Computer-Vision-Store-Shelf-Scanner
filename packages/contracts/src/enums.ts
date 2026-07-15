import { z } from "zod";

export const AuditRunStatusSchema = z.enum([
  "created",
  "uploading",
  "uploaded",
  "extracting_frames",
  "selecting_frames",
  "local_detection",
  "managed_reasoning",
  "grounding",
  "persisting",
  "completed",
  "failed",
]);

export const ObservationStatusSchema = z.enum([
  "observed",
  "inferred",
  "uncertain",
  "not_observable",
  "not_applicable",
]);

export const ConfidenceLevelSchema = z.enum(["low", "medium", "high"]);

export const ProductMatchLevelSchema = z.enum([
  "exact_sku",
  "product_family",
  "brand_only",
  "unknown",
]);

export const ShelfPositionSchema = z.enum([
  "top",
  "eye_level",
  "waist_level",
  "bottom",
  "endcap",
  "unknown",
]);

export const CaptureQualityStatusSchema = z.enum([
  "usable",
  "degraded",
  "unusable",
]);

export const CoverageStatusSchema = z.enum([
  "complete",
  "partial",
  "incomplete",
  "unknown",
]);

export const OutOfStockStatusSchema = z.enum([
  "not_determinable",
  "not_out_of_stock",
  "possible",
  "confirmed",
]);

export const InsightTypeSchema = z.enum([
  "restock",
  "increase_facings",
  "pricing_check",
  "planogram_violation",
  "competitor_promotion",
  "manual_review",
]);

export const InsightSeveritySchema = z.enum(["low", "medium", "high"]);

export const AccountResolutionMethodSchema = z.enum([
  "user_selected",
  "location_suggested",
  "manual_override",
]);
