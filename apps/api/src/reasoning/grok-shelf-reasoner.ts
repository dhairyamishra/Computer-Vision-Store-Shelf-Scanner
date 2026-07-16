import { readFile } from "node:fs/promises";
import { z } from "zod";

import {
  RawShelfAnalysisSchema,
  SHELF_AUDIT_SCHEMA_VERSION,
  ShelfAuditSchema,
  type ShelfAudit,
} from "@shelf-audit/contracts";

import type { ShelfReasoner } from "./fixture-shelf-reasoner.js";
import type { AccountAssortmentItem } from "../persistence/audit-repository.js";

const rawShelfAnalysisJsonSchema = z.toJSONSchema(RawShelfAnalysisSchema);
const mojibakeMarkers = /[ÃÂ]|â(?:€|€™|€œ|€)/g;

function corruptionCount(value: string): number {
  return (value.match(mojibakeMarkers) ?? []).length;
}

export function repairMojibake(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(repairMojibake);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, repairMojibake(item)]),
    );
  }
  if (
    typeof value !== "string" ||
    corruptionCount(value) === 0 ||
    [...value].some((character) => character.codePointAt(0)! > 255)
  ) {
    return value;
  }
  const repaired = Buffer.from(value, "latin1").toString("utf8");
  return corruptionCount(repaired) < corruptionCount(value) ? repaired : value;
}

export function filterVisualWarnings(warnings: readonly string[]): string[] {
  return warnings.filter(
    (warning) =>
      !/\b(catalog|detector|system|provider|api|model|account)\b/i.test(
        warning,
      ),
  );
}

const outsideKnowledgePattern =
  /\b(known for|typically|common knowledge|generally known|brand familiarity)\b/i;

export function removeKnowledgeBasedClaims(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object") {
    return candidate;
  }
  const analysis = candidate as Record<string, unknown>;
  if (!Array.isArray(analysis.observations)) {
    return analysis;
  }
  for (const observation of analysis.observations) {
    if (!observation || typeof observation !== "object") {
      continue;
    }
    for (const field of [
      "brand",
      "product",
      "variant",
      "sizeOrPack",
      "facings",
      "shelfPosition",
    ]) {
      const claim = (observation as Record<string, unknown>)[field];
      if (
        !claim ||
        typeof claim !== "object" ||
        !outsideKnowledgePattern.test(
          (claim as Record<string, unknown>).reason as string,
        )
      ) {
        continue;
      }
      Object.assign(claim, {
        value: null,
        status: "not_observable",
        confidence: 0,
        confidenceLevel: "low",
        reason: "The supplied images do not visibly support this field.",
        evidence: [],
      });
    }
  }
  return analysis;
}

export class ReasoningError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AI_PROVIDER_NOT_CONFIGURED"
      | "AI_PROVIDER_FAILED"
      | "AI_PROVIDER_INVALID_RESPONSE",
  ) {
    super(message);
    this.name = "ReasoningError";
  }
}

function normalizeProviderOutput(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object") {
    return candidate;
  }
  const analysis = candidate as Record<string, unknown>;
  const captureQuality = analysis.captureQuality;
  if (captureQuality && typeof captureQuality === "object") {
    const quality = captureQuality as Record<string, unknown>;
    if (quality.status === "ok" || quality.status === "good") {
      quality.status = "usable";
    } else if (quality.status === "poor") {
      quality.status = "degraded";
    }
    if (Array.isArray(quality.warnings)) {
      quality.warnings = quality.warnings.slice(0, 20);
    }
  }
  if (typeof analysis.notes === "string") {
    analysis.notes = [analysis.notes];
  } else if (Array.isArray(analysis.notes)) {
    analysis.notes = analysis.notes.slice(0, 20);
  }
  if (!Array.isArray(analysis.observations)) {
    return analysis;
  }
  for (const observation of analysis.observations) {
    if (!observation || typeof observation !== "object") {
      continue;
    }
    const fields = [
      "brand",
      "product",
      "variant",
      "sizeOrPack",
      "facings",
      "shelfPosition",
    ];
    for (const field of fields) {
      const claim = (observation as Record<string, unknown>)[field];
      if (!claim || typeof claim !== "object") {
        continue;
      }
      const normalizedClaim = claim as Record<string, unknown>;
      if (typeof normalizedClaim.confidence === "number") {
        normalizedClaim.confidenceLevel =
          normalizedClaim.confidence >= 0.8
            ? "high"
            : normalizedClaim.confidence >= 0.5
              ? "medium"
              : "low";
      }
      if (Array.isArray(normalizedClaim.evidence)) {
        normalizedClaim.evidence = normalizedClaim.evidence.slice(0, 12);
      }
    }
    const candidates = (observation as Record<string, unknown>)
      .catalogCandidates;
    if (Array.isArray(candidates)) {
      (observation as Record<string, unknown>).catalogCandidates =
        candidates.slice(0, 5);
    }
  }
  return analysis;
}

export function combineCaptureWarnings(
  ...sources: Array<readonly string[] | undefined>
): string[] {
  return [
    ...new Set(
      sources
        .flatMap((warnings) => warnings ?? [])
        .map((warning) => warning.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function normalizeCategory(category: string): string {
  const normalized = category
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");
  if (
    /\b(stationery|stationary|office supplies|writing supplies|pens|markers)\b/.test(
      normalized,
    )
  ) {
    return "stationery";
  }
  if (
    /\b(beverage|beverages|drink|drinks|water|soda|juice)\b/.test(normalized)
  ) {
    return "beverages";
  }
  return normalized.replace(/\s+/g, " ");
}

export function resolveCatalogScope(
  observedCategory: string,
  assortment: readonly AccountAssortmentItem[],
) {
  const normalizedObservedCategory = normalizeCategory(observedCategory);
  const catalogCategory = assortment
    .map((item) => item.category)
    .find(
      (category) => normalizeCategory(category) === normalizedObservedCategory,
    );
  const matchingAssortment = catalogCategory
    ? assortment.filter(
        (item) =>
          normalizeCategory(item.category) ===
          normalizeCategory(catalogCategory),
      )
    : [];

  return {
    observedCategory: normalizedObservedCategory || "unknown",
    catalogCategory: catalogCategory ?? null,
    status: catalogCategory
      ? ("applied" as const)
      : ("no_matching_catalog" as const),
    matchingAssortment,
  };
}

export class GrokShelfReasoner implements ShelfReasoner {
  readonly provider = "xai";
  readonly model: string;

  constructor(
    private readonly options: {
      apiKey?: string;
      model?: string;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.model = options.model ?? "grok-4.5";
  }

  async analyze(
    input: Parameters<ShelfReasoner["analyze"]>[0],
  ): Promise<ShelfAudit> {
    if (!this.options.apiKey) {
      throw new ReasoningError(
        "XAI_API_KEY is required for Grok shelf analysis.",
        "AI_PROVIDER_NOT_CONFIGURED",
      );
    }
    const images = await Promise.all(
      input.frames.map(async (frame) => {
        if (!frame.filePath) {
          throw new ReasoningError(
            "Evidence frame is unavailable.",
            "AI_PROVIDER_FAILED",
          );
        }
        const image = await readFile(frame.filePath);
        return {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${image.toString("base64")}`,
            detail: "high",
          },
        };
      }),
    );
    const catalog = (input.assortment ?? []).map((item) => ({
      productId: item.productId,
      category: item.category,
      brand: item.brand,
      product: item.product,
      variant: item.variant,
      size: item.size,
    }));
    const prompt = `Read this retail shelf conservatively. Return JSON only, with no Markdown. The required top-level object is {schemaVersion:"1.0",observedCategory,captureQuality:{status,warnings},observations,notes}. observedCategory MUST name the visible merchandise category, such as stationery, beverages, or unknown; it is not constrained by the supplied catalog. captureQuality.warnings may describe only visible optical or coverage limits, never catalog, account, API, model, detector, or system state. Every observation MUST contain observationId, matchLevel (exact_sku|product_family|brand_only|unknown), brand, product, variant, sizeOrPack, facings, shelfPosition, and catalogCandidates. Every claim MUST contain value, status, confidence, confidenceLevel, reason, and evidence. Valid claim statuses are observed, inferred, uncertain, not_observable, not_applicable. confidenceLevel MUST be low for confidence below .5, medium for .5 through below .8, high for .8 or above. For not_observable or not_applicable, value MUST be null. shelfPosition.value must be top, eye_level, waist_level, bottom, endcap, or unknown. evidence is an array of {frameId,timestampMs,description}, using only supplied frame IDs. catalogCandidates is an array of {productId,score,reason}; use only supplied catalog productIds AND only for catalog products in the observedCategory. Claims must be based only on readable text, visible packaging, or counted facings in the supplied images. Do not use brand familiarity or outside product knowledge to fill unreadable product, variant, size, or facing fields. Always include every field, using null plus not_observable when the footage cannot support a read. Never invent unreadable labels, SKU matches, or out-of-stocks. Catalog: ${JSON.stringify(catalog)}. Frames: ${JSON.stringify(input.frames.map(({ frameId, timestampMs }) => ({ frameId, timestampMs })))}.`;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        "https://api.x.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "shelf_audit_observation",
                strict: true,
                schema: rawShelfAnalysisJsonSchema,
              },
            },
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: prompt }, ...images],
              },
            ],
          }),
        },
      );
    } catch {
      throw new ReasoningError(
        "Grok could not be reached.",
        "AI_PROVIDER_FAILED",
      );
    }
    if (!response.ok) {
      throw new ReasoningError(
        `Grok analysis failed (${response.status}).`,
        "AI_PROVIDER_FAILED",
      );
    }
    let responseContent = "";
    try {
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      responseContent = body.choices?.[0]?.message?.content ?? "";
      const candidate = JSON.parse(
        responseContent
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, ""),
      ) as {
        captureQuality?: { status?: string };
        notes?: unknown;
      };
      const analysis = RawShelfAnalysisSchema.parse(
        removeKnowledgeBasedClaims(
          normalizeProviderOutput(repairMojibake(candidate)),
        ),
      );
      const catalogScope = resolveCatalogScope(
        analysis.observedCategory,
        input.assortment ?? [],
      );
      const permittedProductIds = new Set(
        catalogScope.matchingAssortment.map((item) => item.productId),
      );
      const observations = analysis.observations.map((observation) => {
        const catalogCandidates = observation.catalogCandidates.filter(
          (candidate) => permittedProductIds.has(candidate.productId),
        );
        return {
          ...observation,
          matchLevel:
            observation.matchLevel === "exact_sku" &&
            catalogCandidates.length === 0
              ? "product_family"
              : observation.matchLevel,
          catalogCandidates,
        };
      });
      return ShelfAuditSchema.parse({
        auditId: input.auditId,
        schemaVersion: SHELF_AUDIT_SCHEMA_VERSION,
        account: {
          accountId: input.account.id,
          resolutionMethod: "user_selected",
        },
        sourceVideo: { mediaPath: input.sourceVideoPath },
        status: "completed",
        evidenceCoverage: input.evidenceCoverage,
        catalogScope: {
          observedCategory: catalogScope.observedCategory,
          catalogCategory: catalogScope.catalogCategory,
          status: catalogScope.status,
        },
        captureQuality: {
          status: input.captureQuality.status,
          warnings: combineCaptureWarnings(
            input.metadata.warnings,
            input.captureQuality.warnings,
            filterVisualWarnings(analysis.captureQuality.warnings),
          ),
        },
        observations,
        outOfStocks: catalogScope.matchingAssortment
          .filter((item) => item.expectedPresence)
          .map((item) => ({
            expectedProductId: item.productId,
            status: "not_determinable",
            coverage: "unknown",
            reason:
              "The selected media does not establish complete coverage or an empty facing.",
            evidence: [],
          })),
        insights: [],
        notes: analysis.notes,
        provenance: {
          pipelineVersion: "grok-v1",
          provider: this.provider,
          model: this.model,
          promptVersion: "shelf-audit-v1",
        },
      });
    } catch (error) {
      console.error("Invalid Grok shelf-audit response", {
        error: error instanceof Error ? error.message : "Unknown error",
        responseContent: responseContent.slice(0, 4_000),
      });
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new ReasoningError(
        `Grok returned an invalid shelf-audit response.${detail}`,
        "AI_PROVIDER_INVALID_RESPONSE",
      );
    }
  }
}
